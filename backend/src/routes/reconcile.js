// src/routes/reconcile.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationVia, requireStationAccess } = require('../middleware/stationAccess');
// A near-miss serial PROPOSES the nearest known machine — one tap to confirm — rather
// than being dropped in silence. See lib/serialMatch for why the threshold is one edit.
const { proposeSerial } = require('../lib/serialMatch');
const invoiceNo = require('../services/invoiceNumberService');
const { requirePerm, requireAnyPerm } = require('../middleware/permissions');
const { sendAlert } = require('../services/alertService');
const { recomputeShift } = require('../services/settlementLedger');
const { storageConfigured, uploadDocumentBase64 } = require('../services/vaweStorage');
const artifacts  = require('../services/artifactService');
const settlement = require('../services/settlementService');
const testDraws  = require('../services/testDrawService');
const { closeShiftIfReady } = require('../services/shiftCloseService');

// Does the outlet-level self-settlement switch exist yet? Cached only once TRUE, so
// the first settle after the owner runs the DDL honours it without a restart.
let _hasSelfSettleFlag = false;
async function hasSelfSettleFlag(client = pool) {
  if (_hasSelfSettleFlag) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='self_settlement_enabled' LIMIT 1`);
    _hasSelfSettleFlag = rows.length > 0;
  } catch { _hasSelfSettleFlag = false; }
  return _hasSelfSettleFlag;
}

// Does the outlet-level attendant-led auto-close switch exist yet? Same catalog-first,
// cache-once-TRUE pattern as hasSelfSettleFlag: the column ships in prod but a missing
// one (other envs) must just read FALSE, and the probe is a plain catalog SELECT so it
// is safe to call inside a transaction (see CLAUDE.md — never try/catch 42703 in a tx).
let _hasAutocloseFlag = false;
async function hasAutocloseFlag(client = pool) {
  if (_hasAutocloseFlag) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='attendant_led_autoclose' LIMIT 1`);
    _hasAutocloseFlag = rows.length > 0;
  } catch { _hasAutocloseFlag = false; }
  return _hasAutocloseFlag;
}
const slipParser = require('../services/slipParser');
const pumps      = require('../services/pumpService');
const attendance = require('../services/attendanceService');

// Do the slip-mapping columns exist on nozzles yet? ONE probe for that one question,
// and it lives with the pumps writer — this file used to keep its own identical copy
// (`hasSlipMapping`), which is exactly the duplication the cardinal rule forbids.
const hasSlipMapping = () => pumps.hasPumpNaming(pool);

// Does the draft scan-meter table exist yet? Owner-run DDL means this code deploys
// FIRST, so persist-on-scan and the read endpoint stay table-tolerant: a catalog
// SELECT on pool (autocommit) that cannot poison anything, cached only once TRUE so
// the first scan after the migration picks it up without an app restart.
let _hasScanMeters = false;
async function hasScanMeters(client = pool) {
  if (_hasScanMeters) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='shift_scan_meters' LIMIT 1`);
    _hasScanMeters = rows.length > 0;
  } catch { _hasScanMeters = false; }
  return _hasScanMeters;
}
const Anthropic = require('@anthropic-ai/sdk');

// Store a meter/totalizer audit photo. Preferred: upload the bytes to the private
// doc bucket and keep only the storage PATH in the DB (no base64 blob in Postgres).
// Best-effort by contract (a store failure must never break OCR / shift close), and
// column-tolerant: this deploys BEFORE the DDL adds `storage_path`, so on a missing
// column (42703) it falls back to the legacy base64 insert. image_base64 is nullable
// so there is no NOT-NULL case here. Always call this OUTSIDE / after any open
// transaction (autocommit) so a failed insert can't poison a shift-close tx.
async function storeMeterPhoto({ shift_id, nozzle_id, image_base64, media_type, ocr_reading, ocr_legible, recorded_by }) {
  let path = null;
  if (storageConfigured()) {
    try {
      path = await uploadDocumentBase64({
        prefix: 'meter-photos', scope: shift_id, base64: image_base64, contentType: media_type, filename: 'meter.jpg',
      });
    } catch (e) {
      path = null;
      try { require('../utils/logger').warn('meter-photo upload failed, storing base64: ' + (e.message || e)); } catch { /* noop */ }
    }
  }
  const attempts = [];
  if (path) attempts.push({ cols: ['storage_path'], vals: [path], base64: false });
  attempts.push({ cols: [], vals: [], base64: true });   // legacy base64 shape
  let lastErr;
  for (const a of attempts) {
    const cols = ['shift_id', 'nozzle_id', ...a.cols, ...(a.base64 ? ['image_base64'] : []), 'media_type', 'ocr_reading', 'ocr_legible', 'recorded_by'];
    const vals = [shift_id, nozzle_id, ...a.vals, ...(a.base64 ? [image_base64] : []), media_type, ocr_reading, ocr_legible, recorded_by];
    const ph   = vals.map((_, i) => `$${i + 1}`).join(',');
    try { await pool.query(`INSERT INTO meter_photos(${cols.join(',')}) VALUES(${ph})`, vals); return; }
    catch (e) { lastErr = e; if (e.code === '42703') continue; throw e; }
  }
  throw lastErr;
}

// Great-circle distance in metres (haversine) — for the server-side geofence.
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/reconcile/denomination  — save denomination count (attendant)
router.post('/denomination', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const {
      shift_id, attendant_id,
      note_500=0,note_200=0,note_100=0,note_50=0,
      note_20=0,note_10=0,note_5=0,note_2=0,note_1=0
    } = req.body;
    // Maker-checker: the cash count is the attendant's OWN declaration. Only he
    // may enter it — no superior can make or alter it on his behalf. (Manager-
    // driven mode is the separate, deliberate path: /reconcile/manager.)
    if (!attendant_id || req.user.id !== attendant_id) {
      return res.status(403).json({ error: 'Only the attendant can enter their own cash count. A manager verifies it on handover — they cannot record it for the attendant.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO cash_denominations(
         shift_id,attendant_id,
         note_500,note_200,note_100,note_50,note_20,note_10,note_5,note_2,note_1
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
         note_500=$3,note_200=$4,note_100=$5,note_50=$6,
         note_20=$7,note_10=$8,note_5=$9,note_2=$10,note_1=$11,
         recorded_at=NOW()
       RETURNING *`,
      [shift_id,attendant_id,note_500,note_200,note_100,note_50,
       note_20,note_10,note_5,note_2,note_1]
    );
    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});

// POST /api/reconcile — attendant submits blind drop
// CRITICAL: saves totals in DB but does NOT return them to attendant
router.post('/', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const { shift_id, attendant_id, cash_actual, remarks } = req.body;
    // Maker-checker: only the attendant himself submits his blind drop. A senior
    // may verify on handover (PATCH /:id/confirm) but cannot be the maker.
    if (!attendant_id || req.user.id !== attendant_id) {
      return res.status(403).json({ error: 'Only the attendant can submit their own cash. A manager verifies it on handover — they cannot submit it for the attendant.' });
    }

    // Counted cash must be a sane non-negative number — this is real money.
    const cashNum = Number(cash_actual);
    if (!Number.isFinite(cashNum) || cashNum < 0 || cashNum > 10000000) {
      return res.status(400).json({ error: 'Invalid cash amount.' });
    }

    // Submissions only while the shift is open — a closed shift's books are final.
    const { rows: sh } = await pool.query('SELECT status FROM shifts WHERE id=$1', [shift_id]);
    if (!sh.length) return res.status(404).json({ error: 'Shift not found' });
    if (sh[0].status !== 'open') {
      return res.status(400).json({ error: 'This shift is already closed.' });
    }

    // Compute totals — store but do NOT expose to attendant
    // Settlement = fuel (dispense_events) + bay lube sales (product_invoices)
    // for this attendant/shift, bucketed by the same 4 payment modes.
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(amount),0)                                            AS total_sales,
        COALESCE(SUM(CASE WHEN payment_mode='cash'   THEN amount ELSE 0 END),0) AS cash_expected,
        COALESCE(SUM(CASE WHEN payment_mode='upi'    THEN amount ELSE 0 END),0) AS upi_total,
        COALESCE(SUM(CASE WHEN payment_mode='credit' THEN amount ELSE 0 END),0) AS credit_total,
        COALESCE(SUM(CASE WHEN payment_mode='card'   THEN amount ELSE 0 END),0) AS card_total
      FROM (
        SELECT amount, payment_mode FROM dispense_events
          WHERE shift_id=$1 AND attendant_id=$2 AND NOT COALESCE(is_voided,FALSE)
        UNION ALL
        SELECT grand_total AS amount, payment_mode FROM product_invoices
          WHERE shift_id=$1 AND attendant_id=$2
      ) sales`,
      [shift_id, attendant_id]
    );

    const t = totals[0];
    // The operator was given an opening float at shift start. The end-of-shift
    // drawer = opening float + cash sales, so we reconcile the counted cash
    // against (float + cash sales), not sales alone — otherwise the float reads
    // as a phantom overage every shift. (Manager-driven mode already does this.)
    const { rows: saRows } = await pool.query(
      'SELECT COALESCE(opening_cash,0) AS opening_cash FROM shift_attendants WHERE shift_id=$1 AND attendant_id=$2',
      [shift_id, attendant_id]
    );
    const openingCash  = parseFloat(saRows[0]?.opening_cash || 0);
    const cashExpected = +(parseFloat(t.cash_expected) + openingCash).toFixed(2);

    // Re-submission is allowed only while UNCONFIRMED — once the manager has
    // verified the drop, the row is final (the WHERE makes the update a no-op).
    const { rows } = await pool.query(
      `INSERT INTO shift_reconciliation(
         shift_id, attendant_id, total_sales, cash_expected, cash_actual,
         upi_total, credit_total, card_total, remarks, manager_confirmed
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)
       ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
         cash_actual=$5, remarks=$9, reconciled_at=NOW()
       WHERE shift_reconciliation.manager_confirmed = FALSE
       RETURNING *`,
      [shift_id, attendant_id, t.total_sales, cashExpected, cashNum,
       t.upi_total, t.credit_total, t.card_total, remarks||null]
    );
    if (!rows.length) {
      return res.status(409).json({ error: 'This reconciliation was already confirmed by the manager and cannot be changed.' });
    }

    // Return ONLY what attendant needs — no sales totals, no expected, no variance
    res.status(201).json({
      id:          rows[0].id,
      shift_id,
      attendant_id,
      cash_actual: rows[0].cash_actual,
      submitted:   true,
      message:     'Cash submitted successfully. Please bring cash to manager.',
    });
  } catch(err) { next(err); }
});

// POST /api/reconcile/manager — manager-driven blind-drop close (per attendant).
// The operator did NOTHING in-system; the manager derives sales from the meter
// delta, synthesizes aggregate sales (so dashboards/Tally stay uniform), and
// reconciles cash. Credit stays itemised (logged per customer), never synthesized.
//   sales_ltrs   = (closing − opening) − test_ltrs        (test fuel returns to tank)
//   sales_value  = sales_ltrs × price
//   cash_value   = sales_value − card − UPI − credit(already logged)
//   expected_cash= opening_cash + cash_value
//   variance     = counted_cash − expected_cash   (shortage<0 alerts; overage>0 silent)
router.post('/manager', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requirePerm('reconcile.manage'),
  async (req, res, next) => {
    const {
      shift_id, attendant_id, closing_reading, closings, price_per_ltr,
      test_ltrs = 0, card_total = 0, upi_total = 0, cash_actual = 0,
      credit_total = 0, petty_cash = 0,
      resolution, resolution_amount = 0, operator_ack = false, remarks, denomination,
      // Photograph of the operator being released, mirroring the one taken when he
      // started. Optional — never a reason a settlement cannot be recorded.
      photo_base64, photo_media_type,
    } = req.body;
    if (!shift_id || !attendant_id) return res.status(400).json({ error: 'shift_id and attendant_id are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Line lookup, nozzles and the sale itself all come from settlementService —
      // the SAME code the operator's own settle runs. See that file for why.
      const sa = await settlement.loadOperatorLine(client, { shift_id, attendant_id });

      const opNozzles = await settlement.loadOperatorNozzles(client, {
        shift_id, attendant_id, noneMessage: 'No nozzles assigned to this operator.' });
      // Test fuel comes from the draws recorded at the pump, not from a typed figure.
      // Shared by both settlement paths so the operator's relief is identical whoever
      // closes his line.
      const testByNozzle = await testDraws.testLitresByNozzle({ shift_id, attendant_id }, client);
      const { legs, salesValue, totalTest } = await settlement.computeLegs(client, {
        station_id: sa.station_id, opNozzles, closings, closing_reading, test_ltrs, price_per_ltr,
        testByNozzle,
        missingClosingMessage: "A closing reading is missing for one of the operator's nozzles.",
      });

      const cardVal   = parseFloat(card_total || 0);
      const upiVal    = parseFloat(upi_total || 0);
      const creditVal = parseFloat(credit_total || 0);    // manual lump → suspense
      const pettyVal  = parseFloat(petty_cash || 0);      // cash out of drawer → petty-cash fund
      const cashActual = parseFloat(cash_actual || 0);
      const { cashValue, expectedCash, variance } = settlement.cashPosition({
        salesValue, openingCash: sa.opening_cash, cardVal, upiVal, creditVal, pettyVal, cashActual });

      await settlement.writeSynthesisedSales(client, {
        station_id: sa.station_id, shift_id, attendant_id, legs, salesValue,
        buckets: [['cash', cashValue], ['card', cardVal], ['upi', upiVal], ['credit', creditVal]],
      });
      await settlement.persistClosings(client, { shift_id, attendant_id, legs });

      await settlement.writePettyCash(client, {
        station_id: sa.station_id, attendant_id, settlementRowId: sa.id, pettyVal,
        tradeDate: sa.trade_date, created_by: req.user.id,
      });

      // Credit lump → credit-suspense control account 'in' (idempotent per operator).
      await client.query(`DELETE FROM credit_suspense_entries WHERE shift_id=$1 AND attendant_id=$2 AND reference_type='shift_close' AND direction='in'`, [shift_id, attendant_id]);
      if (creditVal > 0) {
        const { rows: whoRows } = await client.query('SELECT name FROM users WHERE id=$1', [attendant_id]);
        await client.query(
          `INSERT INTO credit_suspense_entries(station_id, direction, amount, shift_id, attendant_id, description, reference_type, reference_id, created_by)
           VALUES($1,'in',$2,$3,$4,$5,'shift_close',$6,$7)`,
          [sa.station_id, creditVal, shift_id, attendant_id, `Credit booked @ shift close — ${whoRows[0]?.name || 'operator'}`, sa.id, req.user.id]);
      }

      if (denomination) {
        const d = denomination;
        await client.query(
          `INSERT INTO cash_denominations(shift_id,attendant_id,note_500,note_200,note_100,note_50,note_20,note_10,note_5,note_2,note_1)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
             note_500=$3,note_200=$4,note_100=$5,note_50=$6,note_20=$7,note_10=$8,note_5=$9,note_2=$10,note_1=$11,recorded_at=NOW()`,
          [shift_id, attendant_id, d.note_500||0, d.note_200||0, d.note_100||0, d.note_50||0, d.note_20||0, d.note_10||0, d.note_5||0, d.note_2||0, d.note_1||0]);
      }

      // Shortage = recovered | salary_deduction (operator agrees). Overage = silent income.
      let resType = resolution || null;
      let resAmt  = parseFloat(resolution_amount || 0);
      if (variance > 0 && !resType) { resType = 'overage_income'; resAmt = variance; }

      const { rows: recoRows } = await client.query(
        `INSERT INTO shift_reconciliation(
           shift_id, attendant_id, total_sales, cash_expected, cash_actual,
           upi_total, credit_total, card_total, remarks,
           manager_confirmed, manager_id, confirmed_at, reconciled_at,
           mode, resolution, resolution_amount, operator_ack, test_ltrs, price_per_ltr, petty_cash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,NOW(),NOW(),'manager',$11,$12,$13,$14,$15,$16)
         ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
           total_sales=$3, cash_expected=$4, cash_actual=$5, upi_total=$6, credit_total=$7,
           card_total=$8, remarks=$9, manager_confirmed=TRUE, manager_id=$10, confirmed_at=NOW(),
           reconciled_at=NOW(), mode='manager', resolution=$11, resolution_amount=$12,
           operator_ack=$13, test_ltrs=$14, price_per_ltr=$15, petty_cash=$16
         RETURNING *`,
        [shift_id, attendant_id, salesValue, expectedCash, cashActual,
         upiVal, creditVal, cardVal, remarks||null, req.user.id,
         resType, resAmt, operator_ack === true || operator_ack === 'true', totalTest, legs[0]?.price || 0, pettyVal]);

      // Close the operator's shift clock and keep his end-of-shift photograph, in
      // the SAME transaction as the settlement — the two describe one event. Both
      // are best-effort internally (artifactService uses a SAVEPOINT, the clock
      // swallows its own errors), so neither can roll back a settled operator.
      const closePhoto = await artifacts.save({
        station_id: sa.station_id,
        entity_type: 'shift_attendant',
        entity_id: sa.id,
        kind: 'attendant_photo',
        file_base64: photo_base64 || null,
        media_type: photo_media_type || null,
        // What the camera thought as he handed over, beside the manager's choice.
        // Advisory: attendant_id is the decision, this is the second opinion.
        meta: { phase: 'close', attendant_id, shift_id,
                ...(artifacts.cleanMatch(req.body.face_match) ? { match: artifacts.cleanMatch(req.body.face_match) } : {}) },
        uploaded_by: req.user.id,
      }, client);
      await attendance.clockOut({
        shift_id, attendant_id,
        artifact_id: closePhoto ? closePhoto.id : null,
      }, client);

      await client.query('COMMIT');

      // Freeze this close into the reconciliation ledger (best-effort — the
      // source tables stay the truth; a ledger hiccup must not fail the close).
      try { await recomputeShift(shift_id); } catch (e) { console.error('[settlementLedger]', e.message); }

      // Owner alert on shortage beyond threshold; overage stays silent.
      if (variance < 0 && Math.abs(variance) > 50) {
        const { rows: who } = await pool.query('SELECT name FROM users WHERE id=$1', [attendant_id]);
        await sendAlert({
          station_id: sa.station_id,
          alert_type: 'cash_variance',
          severity:   Math.abs(variance) > 500 ? 'critical' : 'warning',
          message:    `Manager-mode shortage ₹${Math.abs(variance).toFixed(2)} for ${who[0]?.name || 'operator'}. Expected ₹${expectedCash.toFixed(2)}, received ₹${cashActual.toFixed(2)}${resType === 'salary_deduction' ? ' — flagged for salary deduction' : ''}.`,
          channels:   ['whatsapp', 'sms'],
          io:         req.io,
        });
      }

      res.status(201).json({ ...recoRows[0], variance });
    } catch (e) {
      await client.query('ROLLBACK');
      // A refusal raised by settlementService carries the status it should return —
      // a missing closing is a 400 the operator can act on, not a 500.
      if (e instanceof settlement.SettlementError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
    finally { client.release(); }
  });

// POST /api/reconcile/self-settle — an OPERATOR settles their OWN line from the
// Settlement screen: their nozzle closings (OCR or manual) + payments (cash incl.
// the operator's "cash adj", UPI, card, petty) + itemised credit (per customer).
// Computes their sale, writes their shift_reconciliation row as FINAL (no manager
// confirm), synthesises their dispense_events, and auto-generates one credit invoice
// per customer line. Mirrors POST /manager but is HARD-SCOPED to req.user.id — an
// operator can only ever settle their own line. The manager close is untouched.
router.post('/self-settle', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
    const attendant_id = req.user.id;   // forced — never taken from the body
    const {
      shift_id, closings, closing_reading,
      cash = 0, cash_adj = 0, upi_total = 0, card_total = 0, petty_cash = 0,
      credit_lines = [], test_ltrs = 0, denomination, remarks,
    } = req.body;
    if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Same lookup the manager close runs — 403 rather than 404 here, because the
      // operator is being told this is not his shift, not that nobody was found.
      const sa = await settlement.loadOperatorLine(client, {
        shift_id, attendant_id,
        notFoundStatus: 403, notFoundMessage: 'You are not assigned to this shift.' });

      // OUTLET POLICY, enforced here and not only in the menu. Some outlets run
      // operator self-service and others are manager-led (CLAUDE.md, owner-set
      // 04-Aug); this is the outlet saying which. Server-authoritative for the same
      // reason the geofence below is — hiding a sidebar link is a hint, not a gate,
      // and a settlement recorded down the wrong path at a manager-led outlet is a
      // second record of the same money.
      //
      // PROBED, never try-and-caught. This runs inside a transaction, where a failed
      // statement aborts the whole thing and the fallback dies with it — see CLAUDE.md.
      // A catalog SELECT succeeds either way. An outlet without the column keeps
      // today's behaviour (self-settlement allowed).
      if (await hasSelfSettleFlag(client)) {
        const { rows: pol } = await client.query(
          `SELECT COALESCE(self_settlement_enabled, TRUE) AS ok
             FROM station_settings WHERE station_id=$1`, [sa.station_id]);
        if (pol.length && pol[0].ok === false) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'This outlet settles through the manager. Ask him to close your line at shift end.' });
        }
      }

      // ATTENDANT-LED AUTO-CLOSE (opt-in per outlet). When ON, an operator's self
      // settlement is written PENDING (manager_confirmed=FALSE) — the manager accepts
      // each via PATCH /:id/confirm, and the shift auto-closes on the last accept.
      // When OFF the row is FINAL exactly as before. Probed inside the transaction
      // (catalog SELECT, never try/catch), column-tolerant: a missing column reads
      // FALSE, so an outlet without it keeps today's auto-final behaviour.
      let autocloseFlagOn = false;
      if (await hasAutocloseFlag(client)) {
        const { rows: ac } = await client.query(
          `SELECT COALESCE(attendant_led_autoclose, FALSE) AS on
             FROM station_settings WHERE station_id=$1`, [sa.station_id]);
        autocloseFlagOn = ac.length ? ac[0].on === true : false;
      }
      const pending = autocloseFlagOn === true;

      // Server-side geofence — authoritative. If the outlet has geofencing on, the
      // operator's device coords (sent with the request) must be within the radius.
      // Enforced here so a crafted/jailbroken client can't bypass it; respects the
      // outlet's geo_fence_enabled flag (off → no gate).
      const { rows: geoRows } = await client.query(
        `SELECT geo_fence_enabled, latitude, longitude, COALESCE(geo_fence_radius,500) AS radius
           FROM station_settings WHERE station_id=$1`, [sa.station_id]);
      const gf = geoRows[0];
      if (gf && gf.geo_fence_enabled && gf.latitude != null && gf.longitude != null) {
        const lat = Number(req.body.lat), lng = Number(req.body.lng);
        const onSite = Number.isFinite(lat) && Number.isFinite(lng) &&
          haversineM(lat, lng, Number(gf.latitude), Number(gf.longitude)) <= Number(gf.radius);
        if (!onSite) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'You must be at the outlet to settle — location check failed.' }); }
      }

      const opNozzles = await settlement.loadOperatorNozzles(client, {
        shift_id, attendant_id, noneMessage: 'No nozzles are assigned to you.' });
      // Same source as the manager path — see the note there.
      const testByNozzle = await testDraws.testLitresByNozzle({ shift_id, attendant_id }, client);
      const { legs, salesValue, totalTest } = await settlement.computeLegs(client, {
        station_id: sa.station_id, opNozzles, closings, closing_reading, test_ltrs,
        testByNozzle,
        missingClosingMessage: 'A closing reading is missing for one of your nozzles.',
      });

      // Payments. "Cash adj" folds into cash — cash + adj = the accountable cash.
      const openingCash = parseFloat(sa.opening_cash || 0);
      const cardVal = parseFloat(card_total || 0);
      const upiVal  = parseFloat(upi_total || 0);
      const pettyVal = parseFloat(petty_cash || 0);
      const creditItems = (Array.isArray(credit_lines) ? credit_lines : [])
        .map(l => ({ corporate_id: l.corporate_id, amount: +parseFloat(l.amount || 0).toFixed(2) }))
        .filter(l => l.corporate_id && l.amount > 0);
      const creditVal = +creditItems.reduce((a, l) => a + l.amount, 0).toFixed(2);
      const cashActual = +(parseFloat(cash || 0) + parseFloat(cash_adj || 0)).toFixed(2);
      const { cashValue, expectedCash, variance } = settlement.cashPosition({
        salesValue, openingCash, cardVal, upiVal, creditVal, pettyVal, cashActual });

      await settlement.writeSynthesisedSales(client, {
        station_id: sa.station_id, shift_id, attendant_id, legs, salesValue,
        buckets: [['cash', cashValue], ['card', cardVal], ['upi', upiVal], ['credit', creditVal]],
      });
      await settlement.persistClosings(client, { shift_id, attendant_id, legs });

      await settlement.writePettyCash(client, {
        station_id: sa.station_id, attendant_id, settlementRowId: sa.id, pettyVal,
        tradeDate: sa.trade_date, created_by: req.user.id,
      });

      // Itemised credit → one invoice per customer line, auto-numbered off the station
      // sequence. Idempotent: clear this operator's prior self-settle invoices for the
      // shift (tagged in line_items) before re-creating, so a re-settle doesn't double up.
      await client.query(
        `DELETE FROM gst_invoices WHERE station_id=$1 AND created_by=$2 AND line_items @> $3::jsonb`,
        [sa.station_id, attendant_id, JSON.stringify([{ self_settle_shift: shift_id }])]).catch(() => {});
      const invoices = [];
      for (const item of creditItems) {
        const { rows: link } = await client.query(`SELECT 1 FROM corporate_station_links WHERE corporate_id=$1 AND station_id=$2`, [item.corporate_id, sa.station_id]);
        if (!link.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A selected credit customer is not linked to this outlet.' }); }
        // Same allocator as the credit-invoice screen — one shape, one counter.
        // Previously this produced `INV-<seq>` while the screen produced
        // `INV-<generation date>-<seq>`: two formats off one sequence.
        const { invoice_number } = await invoiceNo.allocate({ station_id: sa.station_id, style: 'plain' }, client);
        const { rows: inv } = await client.query(
          `INSERT INTO gst_invoices(station_id, corporate_id, invoice_number, invoice_date, subtotal, total_amount, line_items, created_by, status)
           VALUES($1,$2,$3,(SELECT date FROM shifts WHERE id=$4),$5,$5,$6,$7,'sent') RETURNING *`,
          [sa.station_id, item.corporate_id, invoice_number, shift_id, item.amount,
           JSON.stringify([{ self_settle_shift: shift_id }]), attendant_id]);
        invoices.push(inv[0]);
      }

      // Write the operator's reconciliation row. In the default (auto-final) mode it is
      // FINAL — manager_confirmed=TRUE, manager_id=self, confirmed_at=NOW() — exactly as
      // before. Under attendant-led auto-close ($13 = pending = TRUE) the three confirm
      // columns become PENDING (manager_confirmed=FALSE, manager_id=NULL, confirmed_at=
      // NULL) so the manager must accept via PATCH /:id/confirm. ONE insert covers both
      // via the bound boolean; everything else (sales math, operator_ack, mode='operator',
      // test/price/petty) is unchanged. mode='operator' marks the source; the shift-end
      // screen and settlement tile read it exactly as a manager-entered line.
      const { rows: recoRows } = await client.query(
        `INSERT INTO shift_reconciliation(
           shift_id, attendant_id, total_sales, cash_expected, cash_actual,
           upi_total, credit_total, card_total, remarks, manager_confirmed, manager_id,
           confirmed_at, reconciled_at, mode, operator_ack, test_ltrs, price_per_ltr, petty_cash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
                NOT $13, CASE WHEN $13 THEN NULL ELSE $2 END, CASE WHEN $13 THEN NULL ELSE NOW() END,
                NOW(),'operator',TRUE,$10,$11,$12)
         ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
           total_sales=$3, cash_expected=$4, cash_actual=$5, upi_total=$6, credit_total=$7,
           card_total=$8, remarks=$9,
           manager_confirmed=NOT $13,
           manager_id=CASE WHEN $13 THEN NULL ELSE $2 END,
           confirmed_at=CASE WHEN $13 THEN NULL ELSE NOW() END,
           reconciled_at=NOW(), mode='operator', operator_ack=TRUE, test_ltrs=$10,
           price_per_ltr=$11, petty_cash=$12
         RETURNING *`,
        [shift_id, attendant_id, salesValue, expectedCash, cashActual, upiVal, creditVal, cardVal,
         remarks || null, totalTest, legs[0]?.price || 0, pettyVal, pending]);

      if (denomination) {
        const d = denomination;
        await client.query(
          `INSERT INTO cash_denominations(shift_id,attendant_id,note_500,note_200,note_100,note_50,note_20,note_10,note_5,note_2,note_1)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
             note_500=$3,note_200=$4,note_100=$5,note_50=$6,note_20=$7,note_10=$8,note_5=$9,note_2=$10,note_1=$11,recorded_at=NOW()`,
          [shift_id, attendant_id, d.note_500||0,d.note_200||0,d.note_100||0,d.note_50||0,d.note_20||0,d.note_10||0,d.note_5||0,d.note_2||0,d.note_1||0]);
      }

      await client.query('COMMIT');

      // Freeze into the reconciliation ledger (best-effort; parked tables tolerated).
      try { await recomputeShift(shift_id); } catch (e) { console.error('[settlementLedger]', e.message); }

      res.status(201).json({ ...recoRows[0], variance, amount_due: salesValue, legs, invoices });
    } catch (e) {
      await client.query('ROLLBACK');
      // A refusal raised by settlementService carries the status it should return —
      // a missing closing is a 400 the operator can act on, not a 500.
      if (e instanceof settlement.SettlementError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
    finally { client.release(); }
  });

// GET /api/reconcile/scan-meters?shift_id=... — read the DRAFT closings the manager
// scanned off the composite slip photo (persisted by POST /parse-slips with persist).
// Read-only convenience for a later slice that pre-fills the operator's self-settlement;
// nothing money-facing reads it. Both the operator (settlement.enter) and the manager
// (reconcile.manage) may read; station scoping is enforced by the guard + RLS.
//
// Registered BEFORE GET /:shift_id so the catch-all param route below does not shadow
// "/scan-meters" as a shift_id. TABLE-TOLERANT: probe first and return [] when the
// owner-run DDL has not created shift_scan_meters yet.
router.get('/scan-meters', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requireAnyPerm('settlement.enter', 'reconcile.manage'),
  async (req, res, next) => {
  try {
    const { shift_id } = req.query;
    if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });
    if (!await hasScanMeters()) return res.json([]);
    const { rows } = await pool.query(
      `SELECT nozzle_id, closing_volume, closing_amount, scanned_at
         FROM shift_scan_meters
        WHERE shift_id = $1
        ORDER BY scanned_at`,
      [shift_id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/reconcile/:shift_id — manager gets list of submissions
// Returns data but hides totals for unconfirmed entries
router.get('/:shift_id', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const isManager = ['owner','manager'].includes(req.user.role);
    const { rows } = await pool.query(`
      SELECT r.*, u.name AS attendant_name,
        r.cash_actual AS cash_submitted
      FROM shift_reconciliation r
      JOIN users u ON u.id = r.attendant_id
      WHERE r.shift_id = $1
      ORDER BY r.reconciled_at DESC`,
      [req.params.shift_id]
    );

    // For non-managers: strip totals from unconfirmed entries
    const sanitized = rows.map(r => {
      if (isManager || r.manager_confirmed) return r;
      // Attendant only sees their own confirmed entry or submission receipt
      if (r.attendant_id === req.user.id) {
        return {
          id:          r.id,
          shift_id:    r.shift_id,
          attendant_id:r.attendant_id,
          cash_actual: r.cash_actual,
          manager_confirmed: r.manager_confirmed,
          attendant_name: r.attendant_name,
        };
      }
      return null;
    }).filter(Boolean);

    res.json(sanitized);
  } catch(err) { next(err); }
});

// PATCH /api/reconcile/:id/confirm — manager confirms receipt, NOW reveals totals
router.patch('/:id/confirm', authenticate, requireStationVia('SELECT s.station_id FROM shift_reconciliation r JOIN shifts s ON s.id=r.shift_id WHERE r.id=$1', 'id'), requirePerm('reconcile.manage'), async (req, res, next) => {
  try {
    const { dispute_type, dispute_notes } = req.body;

    const { rows } = await pool.query(
      `UPDATE shift_reconciliation SET
         manager_confirmed=TRUE,
         manager_id=$2,
         confirmed_at=NOW(),
         dispute_type=$3,
         dispute_notes=$4
       WHERE id=$1 RETURNING *`,
      [req.params.id, req.user.id, dispute_type||null, dispute_notes||null]
    );
    if (!rows.length) return res.status(404).json({ error:'Reconciliation not found' });

    const reco     = rows[0];
    const variance = parseFloat(reco.cash_actual) - parseFloat(reco.cash_expected);

    // NOW fire alert if variance exceeds threshold
    const THRESHOLD = 50;
    if (Math.abs(variance) > THRESHOLD) {
      const { rows: shiftRows } = await pool.query(
        `SELECT sh.station_id, u.name AS attendant_name
         FROM shifts sh
         JOIN users u ON u.id = $2
         WHERE sh.id = $1`,
        [reco.shift_id, reco.attendant_id]
      );
      if (shiftRows.length) {
        await sendAlert({
          station_id:  shiftRows[0].station_id,
          alert_type:  'cash_variance',
          severity:    Math.abs(variance) > 500 ? 'critical' : 'warning',
          message:     `Cash variance ₹${Math.abs(variance).toFixed(2)} for ${shiftRows[0].attendant_name}. Expected: ₹${parseFloat(reco.cash_expected).toFixed(2)}, Received: ₹${parseFloat(reco.cash_actual).toFixed(2)}`,
          channels:    ['whatsapp','sms'],
          io:          req.io,
        });
      }
    }

    // ATTENDANT-LED AUTO-CLOSE. When the outlet runs this mode and this confirm was
    // the LAST operator still pending, close the shift automatically — no manual
    // "close" tap. force:true because "every operator confirmed" IS the all-reconciled
    // condition here; the mandatory closing-dip gate inside closeShiftIfReady still
    // applies and is NOT forced, so a shift with a missing dip comes back
    // {closed:false, reason:'missing_dip'} and the UI tells the manager to enter it.
    // Best-effort and flag-gated: when the flag is OFF nothing here runs and the
    // response is byte-for-byte the old { ...reco, variance }. These queries run on
    // pool (autocommit), so the try/catch is safe (not inside a transaction).
    let auto_close;
    try {
      if (await hasAutocloseFlag()) {
        const { rows: pol } = await pool.query(
          `SELECT COALESCE(ss.attendant_led_autoclose, FALSE) AS on
             FROM station_settings ss
             JOIN shifts s ON s.station_id = ss.station_id
            WHERE s.id=$1`, [reco.shift_id]);
        if (pol.length && pol[0].on === true) {
          // Any operator on this shift still without a manager-confirmed reco row?
          const { rows: outstanding } = await pool.query(
            `SELECT COUNT(*) AS cnt
               FROM shift_attendants sa
              WHERE sa.shift_id=$1
                AND NOT EXISTS (
                  SELECT 1 FROM shift_reconciliation r
                   WHERE r.shift_id=sa.shift_id AND r.attendant_id=sa.attendant_id
                     AND r.manager_confirmed=TRUE
                )`,
            [reco.shift_id]);
          if (parseInt(outstanding[0]?.cnt || 0) === 0) {
            const result = await closeShiftIfReady(pool, reco.shift_id, {
              force: true, io: req.io, user_id: req.user.id });
            auto_close = { closed: result.closed, ...(result.reason ? { reason: result.reason } : {}) };
          }
        }
      }
    } catch (e) { /* auto-close is best-effort — the confirm itself already succeeded */ }

    // Return full reco with variance — only now is it revealed. auto_close is present
    // ONLY when the outlet runs attendant-led mode and this was the last accept.
    res.json({ ...reco, variance, ...(auto_close ? { auto_close } : {}) });
  } catch(err) { next(err); }
});

// POST /api/reconcile/autoclose-check — the manager's progress screen calls this after
// entering the last closing dip, to finalize the auto-close once every operator has
// been accepted. It applies the SAME rules as the last-accept path (closeShiftIfReady
// with force:true — the dip gate still applies and is not forced). Guards mirror the
// confirm route: station-scoped via the shift + reconcile.manage.
//   -> { closed:false, reason:'not_enabled' }         outlet is not in attendant-led mode
//   -> { closed:false, reason:'awaiting_confirm', pending_count }   operators not all accepted
//   -> whatever closeShiftIfReady returns (closed:true | missing_dip | active_pos | not_open)
router.post('/autoclose-check', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requirePerm('reconcile.manage'),
  async (req, res, next) => {
  try {
    const { shift_id } = req.body;
    if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });

    // Flag on for this outlet? Column-tolerant probe; off/absent → not enabled.
    let flagOn = false;
    if (await hasAutocloseFlag()) {
      const { rows } = await pool.query(
        `SELECT COALESCE(ss.attendant_led_autoclose, FALSE) AS on
           FROM station_settings ss
           JOIN shifts s ON s.station_id = ss.station_id
          WHERE s.id=$1`, [shift_id]);
      flagOn = rows.length ? rows[0].on === true : false;
    }
    if (!flagOn) return res.json({ closed: false, reason: 'not_enabled' });

    // Every operator accepted (manager-confirmed reco row)?
    const { rows: outstanding } = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM shift_attendants sa
        WHERE sa.shift_id=$1
          AND NOT EXISTS (
            SELECT 1 FROM shift_reconciliation r
             WHERE r.shift_id=sa.shift_id AND r.attendant_id=sa.attendant_id
               AND r.manager_confirmed=TRUE
          )`,
      [shift_id]);
    const pending_count = parseInt(outstanding[0]?.cnt || 0);
    if (pending_count > 0) return res.json({ closed: false, reason: 'awaiting_confirm', pending_count });

    const result = await closeShiftIfReady(pool, shift_id, {
      force: true, io: req.io, user_id: req.user.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Collections + meter close (simplified manager-driven flow) ───────────────
// The operator did nothing in-system. The manager records what each operator
// handed over (cash + card + UPI) and, once all operators are closed, the
// per-nozzle closing meters. Sales-of-record = the meter (wet) + bay dry sales;
// credit is the manager's separate route. Recon = collections vs (wet+dry−credit).

// POST /api/reconcile/operator-cash + /shift-meters — REMOVED. Dead `mgr_cash`
// flow with no UI (the live paths are attendant self-settle + manager reconcile).
// See docs/drift-audit.md.

// POST /api/reconcile/pos-meter — attendant captures a nozzle's totalizer from
// the POS. OCR via Claude, store the image, hand the number back. It does NOT
// write a meter reading: the settlement is the single writer into
// shift_attendant_nozzles, and this feeds it.
// Meter OCR during shift close — part of the attendant SETTLEMENT flow, so it is
// gated on settlement.enter (held by attendant + manager + owner), not reconcile.manage.
// THE one meter reader: a photograph of a nozzle's totalizer in, the number out.
// Nothing is written — the caller decides what to do with the figure.
//
// This absorbed /reconcile/ocr-meter, which was a complete copy of it differing only
// in requirePerm (reconcile.manage rather than settlement.enter) because neither role
// holds the other's permission. Both are accepted here instead. Shift Open, Shift
// Close, POS and the operator's own settlement screen all send the SAME body and read
// the SAME three fields, so there was never a second behaviour — only a second guard.
// This route is the superset: it also reports the nozzle's opening and whether the
// reading falls below it, which the copy never did and its callers therefore never got.
router.post('/pos-meter', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requireAnyPerm('settlement.enter', 'reconcile.manage'),
  async (req, res, next) => {
  const { shift_id, nozzle_id, image_base64, media_type = 'image/jpeg' } = req.body;
  if (!shift_id || !nozzle_id || !image_base64) return res.status(400).json({ error: 'shift_id, nozzle_id and image are required' });
  try {
    const { rows: sh } = await pool.query('SELECT id FROM shifts WHERE id=$1', [shift_id]);
    if (!sh.length) return res.status(404).json({ error: 'Shift not found' });

    // WHICH nozzle are we reading, and what does its own slip call it. Needed BEFORE
    // the read, because that is what we go looking for on the paper.
    const { rows: nzr } = await pool.query(
      `SELECT n.id, n.nozzle_number, n.slip_nozzle_no, p.serial AS pump_serial
         FROM nozzles n
         LEFT JOIN pumps p ON p.id = n.pump_id AND p.end_date IS NULL
        WHERE n.id = $1`, [nozzle_id]);
    if (!nzr.length) return res.status(404).json({ error: 'Nozzle not found' });
    const want       = nzr[0];
    const wantSerial = String(want.pump_serial ?? '').trim().toUpperCase();
    const wantNo     = String(want.slip_nozzle_no ?? '').trim() || pumps.defaultSlipNo(want.nozzle_number);
    const wantName   = pumps.nozzleName(want);

    // ONE READER. This route used to carry its OWN prompt, describing "a fuel
    // dispenser cumulative totalizer (the counter showing total litres dispensed for
    // one nozzle)" — a mechanical dial, one number. What a manager actually
    // photographs is a PRINTED slip: a header, two nozzles, and three LABELLED
    // figures each (A: rupees, V: litres, TOT SALES: a count). The prompt named none
    // of them, so the model returned the largest run of digits on the page — A, the
    // money — and called itself legible because the DIGITS were sharp. `legible` was
    // certifying character clarity, not field identity.
    //
    // It cost two outlets their trust in the camera:
    //   Kamala   23-Jun  three attempts on one slip, three times the A line
    //                    (149343626.920 / 195417174.200 against a true V of
    //                     1654130.510 / 2131447.940)
    //   Kamala   23-Aug  one number, 1692096.060, returned for TWO nozzles
    //   Sri Bal. 25-Aug  17558851.620 on a nozzle whose real movement that shift
    //                    was 5.78 L — then the same figure again for the next one
    // Every one flagged legible. Both managers typed the readings by hand and
    // stopped scanning, which is the correct response to a lying instrument.
    //
    // slipParser has known the A/V layout since #306 and already refuses a volume
    // the printed amount disagrees with — `legible` on a parsed LINE means it passed
    // that cross-check. It was simply never in this path. Calling it here DELETES a
    // reader rather than adding one, and the guard, the swap detection and the
    // rejection strings all arrive by construction.
    let reading = '', legible = false, notes = '', ocrEngine = null;
    const parsed = await slipParser.parseSlip({ file_base64: image_base64, media_type });
    if (!parsed) {
      notes = 'Could not read that slip — type the reading instead.';
    } else {
      ocrEngine = parsed.engine ?? null;
      const gotSerial = String(parsed.pump_serial ?? '').trim().toUpperCase();
      const line = (parsed.nozzles || []).find(n => String(n.nozzle_no) === String(wantNo));

      // THE SLIP NAMES ITSELF, so check it is the one we asked for. Without this a
      // slip photographed for one nozzle silently supplies another nozzle's meter —
      // exactly what put one figure onto two nozzles at both outlets.
      if (wantSerial && gotSerial && gotSerial !== wantSerial) {
        notes = `That slip is from pump ${gotSerial}, not ${wantSerial}. Photograph ${wantName}'s own slip.`;
      } else if (!line) {
        const seen = (parsed.nozzles || []).map(n => n.nozzle_no).filter(Boolean).join(', ');
        notes = seen
          ? `That slip shows nozzle ${seen}, not ${wantNo}. Photograph ${wantName}'s own slip, or type the reading.`
          : 'No nozzle reading found on that slip — type the reading instead.';
      } else if (!line.legible) {
        // REFUSED BY THE CROSS-CHECK, and say WHY. A figure it threw out is never
        // offered as a pre-fill: a confident wrong meter is worse than no meter.
        notes = line.reject_reason === 'implied_price_out_of_band'
          ? `That reading implies Rs ${line.implied_price}/L — it looks like the amount, not the litres. Type it from the V line.`
          : line.reject_reason === 'no_amount_to_cross_check'
            ? 'The amount did not read, so there is nothing to check the litres against — type the reading.'
            : line.swapped_amount_for_volume
              ? 'The amount and the volume looked swapped on that slip — check it and type the V figure.'
              : 'That line did not read cleanly — type the reading instead.';
      } else {
        reading = String(line.cumulative_volume);
        legible = true;
        notes   = parsed.notes || '';
      }
    }

    // THIS ROUTE DOES NOT WRITE A METER. It reads the slip and hands the number back;
    // the settlement submits it, and the settlement is the one writer into
    // shift_attendant_nozzles.
    //
    // A totalizer cannot run backwards. If the scan is below the opening this nozzle
    // was carried in at, either the photo was misread or it is the wrong nozzle — and
    // the operator must see that before he settles against it, not after.
    let opening_reading = null, below_opening = false;
    if (reading) {
      const { rows: op } = await pool.query(
        `SELECT opening_reading FROM shift_attendant_nozzles
          WHERE shift_id=$1 AND nozzle_id=$2 AND opening_reading IS NOT NULL LIMIT 1`,
        [shift_id, nozzle_id]);
      if (op.length) {
        opening_reading = Number(op[0].opening_reading);
        below_opening = Number(reading) < opening_reading;
      }
    }

    // NO TRANSACTION. This handler only ever SELECTed — it never wrote — yet it held
    // BEGIN..COMMIT open across a 20-second OCR call, tying up a pool connection for
    // the length of somebody's mobile upload for no atomicity at all.
    //
    // Audit image, best-effort: bytes -> private bucket, DB keeps only the path. A
    // store failure must never cost the manager the reading he just took.
    try {
      await storeMeterPhoto({ shift_id, nozzle_id, image_base64, media_type, ocr_reading: reading || null, ocr_legible: legible, recorded_by: req.user.id });
    } catch { /* store failed — the reading is already computed and returned */ }
    res.json({ reading, legible, notes, opening_reading, below_opening, engine: ocrEngine, nozzle_name: wantName });
  } catch (e) { next(e); }
});

// POST /api/reconcile/shift-opening-meters — REMOVED. Dead (no UI); the live
// opening-meter capture is the attendant's /pos-meter. See docs/drift-audit.md.

// POST /api/reconcile/ocr-meter — REMOVED 04-Aug-2026. It was a second copy of /pos-meter
// above, made only so it could carry a different requirePerm. See the cardinal rule
// in CLAUDE.md: a copied block with a changed permission is the tell. Its callers
// (Shift Open, Shift Close) now use /pos-meter, which returns everything ocr-meter
// did and the opening cross-check besides.

router.post('/parse-slip', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requirePerm('reconcile.manage'),
  async (req, res, next) => {
  try {
    const { shift_id, image_base64, media_type = 'image/jpeg' } = req.body;
    if (!shift_id || !image_base64) return res.status(400).json({ error: 'shift_id and image are required' });

    // ONE READER. parseSlip returns null on any failure and has already applied the
    // rupee/litre cross-check in code, so its cumulative_volume is litres or null.
    const parsed = await slipParser.parseSlip({ file_base64: image_base64, media_type });
    if (!parsed) {
      return res.status(422).json({ error: 'Could not read the slip — enter the readings manually.' });
    }
    if (!parsed || !Array.isArray(parsed.nozzles)) {
      return res.status(422).json({ error: 'Could not read the slip — enter the readings manually.' });
    }
    // Normalise, then RESOLVE each slip line to a real nozzle HERE rather than in
    // the browser.
    //
    // This used to hand back only a `{pump}.{nozzle}` label and let each screen do
    // `nozzles.find(x => x.nozzle_number === label)`. Two problems, both live:
    //
    //  1. THAT LABEL SHAPE IS NOT WHAT OUTLETS USE. Real numbering in prod is mixed
    //     — Highway has 1, 2, 3.1, 3.2, 4.1, 4.2, 5, 6, 7, 8; Dilsukhnagar has plain
    //     1, 2. A "1.1" matches none of them, so the slip scan silently found
    //     nothing at three of four outlets and the manager just saw "no nozzle
    //     matched". Accept BOTH shapes instead of dictating one.
    //  2. `.find()` SILENTLY TAKES THE FIRST of several equal candidates. Kamala has
    //     THREE active nozzles numbered "1" (petrol, diesel, CNG) and three numbered
    //     "2", so a matched reading could land on the wrong fuel's nozzle — the same
    //     class of fault the gauge matcher was hardened against after a diesel
    //     reading went into a petrol tank. Ambiguity must REFUSE, not guess.
    //
    // Resolving server-side also means one implementation, not one per screen.
    // A real pump/FIP id is a small number (1, 2, 3…). This used to strip the
    // non-digits off whatever came back, which turned a PUMP SERIAL NUMBER like
    // "17CH2653V" into "172653" and a MODEL "1224/2224" into "12242224" — then
    // built the label "172653.1", which matches no nozzle anywhere. A slip that
    // prints no pump id (the HPCL ETOT-MAIN layout does not) must yield null, so
    // the bare nozzle number is used instead.
    const pumpRaw = String(parsed.pump_id ?? '').replace(/[^\d]/g, '');
    const pump = pumpRaw && pumpRaw.length <= 2 ? pumpRaw : null;

    // pump_serial / slip_nozzle_no arrive with owner-run DDL, so they are named
    // only once present. Probed, never discovered by a failing SELECT.
    const slipCols = await hasSlipMapping();
    // The serial comes from the PUMP now, joined in, rather than repeated on every
    // nozzle. Same lookup, one home for the fact.
    const extraCols = slipCols ? ', p.serial AS pump_serial, p.pump_number, n.slip_nozzle_no' : '';
    const extraJoin = slipCols ? 'LEFT JOIN pumps p ON p.id = n.pump_id AND p.end_date IS NULL' : '';
    const { rows: known } = await pool.query(
      `SELECT n.id, n.nozzle_number, n.fuel_type${extraCols}
         FROM nozzles n
         ${extraJoin}
        WHERE n.is_active
          AND n.station_id = (SELECT station_id FROM shifts WHERE id = $1)`,
      [shift_id]
    );
    const byNumber = {};
    for (const k of known) (byNumber[String(k.nozzle_number).trim()] ||= []).push(k);

    // NOZZLES GROUPED BY THE PUMP THEY HANG OFF. The serial identifies a machine
    // outright, so once we know WHICH machine printed the slip, only that machine's
    // own nozzles can be the answer — and the search must be confined to them.
    //
    // Building a NAME ("<pump>.<nozzle>") and looking it up across the whole outlet
    // was the bug. It assumes every outlet names nozzles pump.nozzle, and Highway
    // does not: its pump 2 carries nozzles named 3.1, 3.2, 4.1 and 4.2, so pump 3's
    // slip asked for "3.1", found pump 2's diesel nozzle, and matched it with
    // confidence. Wrong machine, no ambiguity flagged, and at shift CLOSE that is a
    // closing meter — the figure the day's sales are computed from.
    const byPump = {};
    for (const k of known) {
      if (!k.pump_number) continue;
      (byPump[String(k.pump_number).trim()] ||= []).push(k);
    }
    // Within ONE pump, find the nozzle the slip's number refers to. Tried in order
    // of how much it is asserted rather than inferred, and it REFUSES rather than
    // guessing: a pump whose nozzles are named in the outlet's own way and carry no
    // slip mapping yields nothing here, and the manager types the reading as he
    // always could. Position within the pump is deliberately NOT used — Highway's
    // pump 2 prints 01,02,03,04 for nozzles 3.1, 4.2, 3.2, 4.1, so ordinal position
    // would be right once in four.
    // A line we could not place. Same shape as a resolved one so the screen needs
    // no special case: it simply has no nozzle_id, and the manager types the figure.
    // matched_on carries WHY, so a scan that filled nothing can be explained.
    const unresolved = (n, no, label, vol, amt, swapped, why) => ({
      nozzle_no: no || null,
      label,
      cumulative_volume: isFinite(vol) && vol > 0 ? vol : null,
      cumulative_amount: isFinite(amt) && amt > 0 ? amt : null,
      swapped_amount_for_volume: swapped || undefined,
      legible: n.legible === true && isFinite(vol) && vol > 0 && !swapped,
      nozzle_id: null,
      matched_on: why,
    });

    const withinPump = (pumpNumber, no) => {
      const mine = byPump[pumpNumber] || [];
      if (!mine.length || !no) return [];
      // a. the explicit mapping, set against the nozzle for exactly this purpose
      const mapped = mine.filter(k => k.slip_nozzle_no && String(k.slip_nozzle_no).trim() === no);
      if (mapped.length) return mapped;
      // b. the outlet names nozzles "<pump>.<nozzle>" — the ordinary case
      const dotted = mine.filter(k => String(k.nozzle_number).trim() === `${pumpNumber}.${no}`);
      if (dotted.length) return dotted;
      // c. the outlet names them bare, and the bare name happens to be the
      //    machine's own number — true of Highway's pump 1 (nozzles 1 and 2)
      const bare = mine.filter(k => String(k.nozzle_number).trim() === no);
      return bare;
    };

    // THE SERIAL IS THE DISPENSER'S IDENTITY. A slip that prints no pump number
    // — the HPCL ETOT-MAIN layout does not — leaves "NOZZLE : 1" ambiguous across
    // every dispenser at the outlet, and no amount of renaming our nozzles can
    // resolve it, because the ambiguity is on the slip's side. The serial is
    // stamped on the unit, never changes, and is printed on every slip it emits.
    // Once mapped in Settings this is an exact lookup with nothing inferred.
    const serialRaw = String(parsed.pump_serial ?? '').trim().toUpperCase();

    // SERIAL -> PUMP NUMBER. That is the whole trick, and it needs no extra data:
    // outlets name nozzles pump.nozzle, so once the serial tells us WHICH pump
    // printed the slip, its number plus the nozzle number the slip prints IS the
    // nozzle's name. Pump 1 + "NOZZLE : 1" -> "1.1". Nothing to map, nothing to
    // type, nothing to keep in step.
    const pumpNumberBySerial = {};
    if (slipCols) {
      for (const k of known) {
        if (!k.pump_serial || !k.pump_number) continue;
        pumpNumberBySerial[String(k.pump_serial).trim().toUpperCase()] = String(k.pump_number).trim();
      }
    }

    // Kept as an OVERRIDE only, for a machine that numbers its own nozzles
    // differently from the outlet's convention. Nobody fills it in the ordinary
    // case, because the concatenation above already answers it.
    const bySerial = {};
    if (slipCols) {
      for (const k of known) {
        if (!k.pump_serial || !k.slip_nozzle_no) continue;
        const key = `${String(k.pump_serial).trim().toUpperCase()}|${String(k.slip_nozzle_no).trim()}`;
        (bySerial[key] ||= []).push(k);
      }
    }

    const nozzles = parsed.nozzles
      .map(n => {
        const no = String(n.nozzle_no ?? '').replace(/[^\d]/g, '');
        let vol = Number(String(n.cumulative_volume ?? '').toString().replace(/[^\d.]/g, ''));
        const amt = Number(String(n.cumulative_amount ?? '').toString().replace(/[^\d.]/g, ''));
        const label = pump && no ? `${pump}.${no}` : null;

        // ARITHMETIC CROSS-CHECK — the rupee/litre swap, caught in code as well as
        // in the prompt. Every slip prints a money total beside the volume total,
        // and at ~Rs 100/L the money figure is ~100x the litres. If what came back
        // as the "volume" is the LARGER of the two, it is the amount: reject it
        // rather than record a meter a hundredfold too high, which would show as a
        // colossal phantom sale on the shift.
        // parseSlip has already applied this check and corrected vol. Recomputing
        // alone would then read swapped=false and present a CORRECTED figure as
        // though it had been clean all along, so its verdict is carried through and
        // this stays as a second line of defence.
        let swapped = n.swapped_amount_for_volume === true;
        if (isFinite(vol) && isFinite(amt) && amt > 0 && vol > amt) { swapped = true; vol = amt; }

        // Most specific first: the serial identifies the machine outright, so it
        // beats any numbering convention. Then the qualified pump.nozzle form,
        // then the bare number. Never fall back to position.
        let cands = [];
        let matchedOn = null;
        // 1. THE SERIAL PATH, CONFINED TO THE PUMP IT IDENTIFIES. If the serial
        //    tells us which machine printed this slip, the answer is one of THAT
        //    machine's nozzles or it is nothing — never another pump's. When the
        //    serial is known and this finds no nozzle, we STOP: falling through to
        //    the outlet-wide search below would be free to land on a different
        //    pump, which is exactly the fault this replaces.
        if (serialRaw && no && pumpNumberBySerial[serialRaw]) {
          cands = withinPump(pumpNumberBySerial[serialRaw], no);
          matchedOn = cands.length ? 'pump_serial' : null;
          if (!cands.length) return unresolved(n, no, label, vol, amt, swapped, 'serial_no_nozzle');
        }
        // 2. Serial known but the pump carries no number we can group by — the
        //    explicit mapping is then the only assertion available.
        if (!cands.length && serialRaw && no) {
          cands = bySerial[`${serialRaw}|${no}`] || [];
          matchedOn = cands.length ? 'pump_serial_mapped' : null;
        }
        if (!cands.length && label) { cands = byNumber[label] || []; matchedOn = cands.length ? 'pump.nozzle' : null; }
        if (!cands.length && no)    { cands = byNumber[no] || [];    matchedOn = cands.length ? 'nozzle' : null; }

        const ambiguous = cands.length > 1;
        return {
          nozzle_no: no || null,
          label,
          cumulative_volume: isFinite(vol) && vol > 0 ? vol : null,
          cumulative_amount: isFinite(amt) && amt > 0 ? amt : null,
          // A swap the code had to correct means the labels were read wrongly, so
          // the figure is shown for confirmation rather than quietly trusted.
          swapped_amount_for_volume: swapped || undefined,
          legible: n.legible === true && isFinite(vol) && vol > 0 && !swapped,
          // Null when nothing matched OR when several nozzles share that number —
          // the screen then leaves it for the manager instead of picking one.
          nozzle_id: !ambiguous && cands.length === 1 ? cands[0].id : null,
          matched_on: ambiguous ? 'ambiguous' : matchedOn,
          candidates: ambiguous
            ? cands.map(c => ({ id: c.id, nozzle_number: c.nozzle_number,
                                nozzle_name: pumps.nozzleName(c), fuel_type: c.fuel_type }))
            : undefined,
        };
      })
      .filter(n => n.nozzle_no);

    // Is this serial registered AT ALL? Both maps count. bySerial alone was wrong:
    // it is built only from nozzles carrying an explicit slip_nozzle_no override,
    // which most outlets never set, so a properly registered pump (Adhoc Highway,
    // for one) read as "not set up yet" and the manager was sent to fix something
    // that was already correct.
    const serialKnown = !!(serialRaw && (
      pumpNumberBySerial[serialRaw] ||
      Object.keys(bySerial).some(k => k.startsWith(`${serialRaw}|`))
    ));

    // Keep the SLIP ITSELF. It is the printed evidence behind every opening and
    // closing meter on the shift, and until now it was read and thrown away — the
    // fifth document Pumpini could read but did not keep. Best-effort, as ever.
    const slipArtifact = await artifacts.save({
      station_id: req.stationId,
      entity_type: 'shift',
      entity_id: shift_id,
      kind: 'nozzle_slip',
      file_base64: image_base64,
      media_type,
      // The serial and HOW each line matched are stored, not just the readings.
      // Without them a scan that resolved to the wrong pump cannot be explained
      // after the fact — which is exactly the position we were in on 02-Aug, when
      // the stored ocr held no serial and the only clue was matched_on.
      // WHICH ENGINE READ IT. Recorded on every scan so a later argument about
      // whether Vision or the direct vision call produced a figure is settled by the
      // row, not by inference from how the notes are phrased. That is exactly the
      // position we were in at 11:42 on 20-Aug: a scan went from 0/5 serials to 4/4
      // on an identical image and the only evidence of why was a turn of phrase.
      // AND WHY IT WAS THAT ENGINE. A fallback to claude_vision used to be silent —
      // on 26-Aug it fired on 3 of 8 scans and nothing recorded the cause, so the
      // post-mortem had to infer it from absence. Stored, it is one query away.
      ocr: { pump_id: pump, pump_serial: serialRaw || null, serial_mapped: serialKnown, nozzles,
             engine: parsed.engine ?? null, ocr_chars: parsed.ocr_chars ?? null,
             fallback_reason: parsed.fallback_reason ?? null },
      meta: { pump_id: pump, slip_type: parsed.slip_type ?? null },
      uploaded_by: req.user.id,
    });

    res.json({
      slip_type: parsed.slip_type === 'B' ? 'B' : (parsed.slip_type === 'A' ? 'A' : null),
      pump_id: pump,
      // Echoed so the screen can tell the manager exactly which serial to map in
      // Settings when nothing matched — otherwise "no nozzle matched" is a dead
      // end and he has no idea what to do about it.
      pump_serial: serialRaw || null,
      serial_mapped: serialKnown,
      // ONE wording for the failure, decided here rather than in each screen. The
      // old message was "Slip read, but no nozzle matched" — true, useless, and a
      // dead end: it told the manager nothing he could act on. Naming the serial
      // and the screen that fixes it turns it into an instruction.
      hint: (() => {
        // FIRST, and deliberately BEFORE the everything-matched check. When a slip
        // prints a serial we do not recognise, the match falls through to the pump
        // number printed on the paper — and that number is the MACHINE's own idea,
        // which need not be ours. On 02-Aug a Kamala slip carrying serial
        // 201807000927 (our pump 1, petrol) printed "FP. ID : 2" and resolved
        // confidently onto pump 2's DIESEL nozzles. Every line matched, so this
        // hint stayed silent and only the carry-forward lock stopped a petrol meter
        // being written to a diesel nozzle. A match made on the wrong basis is more
        // dangerous than no match, so it is now said out loud either way.
        if (serialRaw && !serialKnown) {
          const fellBack = nozzles.some(n => n.nozzle_id && (n.matched_on === 'pump.nozzle' || n.matched_on === 'nozzle'));
          return `This slip is from pump serial ${serialRaw}, which is not set up yet. `
               + (fellBack
                   ? 'The readings below were matched on the pump number printed on the slip, which may belong to a DIFFERENT pump — check each nozzle before saving. '
                   : '')
               + 'Add the serial under Settings → Pumps & Nozzles, or enter the readings by hand.';
        }
        if (nozzles.every(n => n.nozzle_id)) return null;
        // The serial named the machine, but none of THAT machine's nozzles could be
        // tied to the number the slip printed. Refusing is correct — the alternative
        // is another pump's nozzle — but the manager needs to know it is fixable.
        const stuck = nozzles.filter(n => n.matched_on === 'serial_no_nozzle');
        if (stuck.length) {
          return 'This pump was recognised, but its nozzles are not yet matched to the numbers '
               + `the machine prints (${stuck.map(n => n.nozzle_no).filter(Boolean).join(', ')}). `
               + 'Set the slip number against each nozzle under Settings → Pumps & Nozzles, '
               + 'or enter the readings by hand.';
        }
        const amb = nozzles.filter(n => n.matched_on === 'ambiguous');
        if (amb.length) {
          return 'More than one nozzle carries that number, so the reading was not filled in '
               + 'automatically. Map this pump\'s serial under Settings → Pumps & Nozzles.';
        }
        return 'None of the nozzles on this slip match this outlet. Check the nozzle numbers '
             + 'under Settings → Pumps & Nozzles, or enter the readings by hand.';
      })(),
      nozzles,
      unmatched: nozzles.filter(n => !n.nozzle_id).length,
      artifact_id: slipArtifact ? slipArtifact.id : null,
      legible: parsed.legible === true && nozzles.length > 0 && nozzles.every(n => n.legible),
      notes: notes || String(parsed.notes ?? ''),
    });
  } catch (err) { next(err); }
});

// POST /api/reconcile/parse-slips — READ-ONLY. The composite sibling of /parse-slip:
// ONE photograph carrying SEVERAL slips (several serials) at once, for the "scan all
// slips at shift open/close" flow. It PARSES, RESOLVES each line to one of our nozzles,
// STORES the image as evidence, and RETURNS both cumulative volume and amount per line.
// It writes NO meter reading anywhere — the settlement form still does the writing.
// Same guards as /parse-slip so it scopes to the shift's station and needs the same perm.
// EITHER A SHIFT OR A STATION. The shift flow scans at open and close; a Flow v2 tank
// recon scans at its own moment and has no shift at all. ONE reader, ONE matcher, two
// ways in — extending this endpoint rather than standing a second one beside it, which
// is how /pos-meter and /ocr-meter became two copies of a single OCR call.
//
// requireStationVia calls next() when its key is absent, so a body carrying no shift_id
// falls through to the station guard with req.stationId still unset.
const stationIfNoShift = (req, res, next) =>
  req.stationId ? next() : requireStationAccess({ required: true })(req, res, next);

router.post('/parse-slips', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  stationIfNoShift,
  requirePerm('reconcile.manage'),
  async (req, res, next) => {
  try {
    const { shift_id, image_base64, media_type = 'image/jpeg', persist = false } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'An image is required.' });
    if (!shift_id && !req.stationId) return res.status(400).json({ error: 'A shift or a station is required.' });

    // ONE READER. parseCompositeSlips returns null on any failure and has already
    // applied the rupee/litre cross-check per nozzle, so each cumulative_volume is
    // litres or null.
    const readDiag = {};
    const parsed = await slipParser.parseCompositeSlips({ file_base64: image_base64, media_type, diag: readDiag });
    if (!parsed || !Array.isArray(parsed.slips)) {
      // A FAILED SCAN IS EVIDENCE, and it used to be thrown away. This answered 422
      // and kept nothing — so the photograph that beat the reader was gone, and the
      // failure was uncountable. That is how slip scanning could die in the first
      // week of August with nobody able to see it, and it meant the HARDEST frames,
      // the ones most worth replaying, were the only ones the bench never got.
      //
      // Best-effort, exactly like the success save below: keeping evidence must
      // never turn a manager's 422 into a 500.
      try {
        await artifacts.save({
          station_id: req.stationId,
          entity_type: 'shift',
          entity_id: shift_id,
          kind: 'nozzle_slip',
          file_base64: image_base64,
          media_type,
          ocr: { composite: true, read_failed: true,
                 engine: readDiag.engine ?? null,
                 fallback_reason: readDiag.fallback_reason ?? null,
                 read_error: readDiag.error ?? null },
          meta: { composite: true, read_failed: true },
          uploaded_by: req.user.id,
        });
      } catch { /* evidence is best-effort; the manager still gets his answer */ }
      return res.status(422).json({ error: 'Could not read the slips — enter the readings manually.' });
    }

    // The station's active nozzles, with the pump serial joined in. Column-tolerant:
    // slip_nozzle_no / pump columns arrive with owner-run DDL, so they are named only
    // once hasSlipMapping() confirms them present.
    const slipCols = await hasSlipMapping();
    const extraCols = slipCols ? ', p.serial AS pump_serial, n.slip_nozzle_no' : '';
    const extraJoin = slipCols ? 'LEFT JOIN pumps p ON p.id = n.pump_id AND p.end_date IS NULL' : '';
    const { rows: known } = await pool.query(
      `SELECT n.id, n.nozzle_number, n.fuel_type${extraCols}
         FROM nozzles n
         ${extraJoin}
        WHERE n.is_active
          AND n.station_id = $1`,
      // req.stationId is set by whichever guard ran — the shift's station, or the
      // station itself. Scoping on it directly means the recon path needs no shift.
      [req.stationId]
    );

    // SERIAL + PRINTED-NOZZLE-NUMBER -> our nozzle. The key is
    // `${UPPER(serial)}|${printedNo}`, where printedNo is the explicit slip mapping if
    // set, else the part of nozzle_number after '.' (Highway's "3.1" -> "1"), else the
    // bare nozzle_number. Verified unique per outlet, so each key maps to exactly one
    // nozzle — no `.find()` picking the first of several equal candidates.
    const bySerialNo = {};
    const serialsKnown = new Set();
    if (slipCols) {
      for (const k of known) {
        if (!k.pump_serial) continue;
        const serial = String(k.pump_serial).trim().toUpperCase();
        serialsKnown.add(serial);
        const nn = String(k.nozzle_number).trim();
        const printedNo = k.slip_nozzle_no != null && String(k.slip_nozzle_no).trim() !== ''
          ? String(k.slip_nozzle_no).trim()
          : (nn.includes('.') ? nn.split('.').pop() : nn);
        bySerialNo[`${serial}|${printedNo}`] = k;
      }
    }

    // Resolve each parsed slip group and its nozzles. A line we could not place simply
    // has no nozzle_id — same shape as a resolved one, so the screen needs no special
    // case and the manager types that figure.
    const slips = parsed.slips.map(s => {
      const serial = String(s.pump_serial ?? '').trim().toUpperCase();
      const lines = (s.nozzles || []).map(n => {
        const no = String(n.nozzle_no ?? '').replace(/[^\d]/g, '');
        const hit = serial && no ? bySerialNo[`${serial}|${no}`] : null;
        return {
          nozzle_id: hit ? hit.id : null,
          nozzle_number: hit ? hit.nozzle_number : null,
          fuel_type: hit ? hit.fuel_type : null,
          slip_no: no || null,
          // THE NAME, on every line, matched or not. Without this the field was
          // never set, every consumer fell through to `nozzle_number`, and our
          // INTERNAL index ("1.1") reached the manager in the one place he reads a
          // nozzle name: the unmatched/refused list after a scan.
          //
          // MATCHED -> the ONE JS writer, off the nozzle's own row, so this name is
          // character-for-character the name every other screen shows. Composing it
          // here instead would fork the convention on case alone: the matcher
          // upper-cases the serial it read (OCR case is unreliable) while
          // nozzleNameExpr only btrim()s the stored one, so a serial saved
          // lower-case in Settings would read `15bc1412v.1` on Shift Close and
          // `15BC1412V.1` here. Every serial in prod is upper-case today and
          // nothing enforces it — which is precisely how the last drift started.
          //
          // UNMATCHED -> no row exists, so the slip's own printed identity IS the
          // name; that is what the convention means by "as its own slip prints it".
          nozzle_name: hit ? pumps.nozzleName(hit) : (serial && no ? `${serial}.${no}` : null),
          cumulative_volume: n.cumulative_volume ?? null,
          cumulative_amount: n.cumulative_amount ?? null,
          swapped_amount_for_volume: n.swapped_amount_for_volume || undefined,
          legible: n.legible === true,
        };
      });
      return {
        pump_serial: serial || null,
        model: s.model ?? null,
        slip_type: ['A', 'B', 'C'].includes(s.slip_type) ? s.slip_type : (s.slip_type ?? null),
        // Is this machine registered at all? Any of its nozzles present in our map.
        serial_known: !!(serial && serialsKnown.has(serial)),
        // A NEAR MISS NAMES ITS CANDIDATE. Null when the serial is already known, when
        // nothing is close, or when two machines are equally close — an ambiguous
        // proposal is a coin toss wearing a suggestion's clothes, and the line goes to
        // the loud card instead. The screen offers it; nothing here accepts it.
        serial_suggestion: (serial && !serialsKnown.has(serial))
          ? proposeSerial(serial, Array.from(serialsKnown))
          : null,
        lines,
      };
    });

    // Keep the composite image as printed evidence behind the shift's meters, exactly
    // as /parse-slip keeps a single slip. Best-effort — a store failure must never fail
    // the response.
    try {
      await artifacts.save({
        station_id: req.stationId,
        // A recon scan has no shift, so its evidence hangs off the OUTLET instead. Both
        // are allowed entity types; what matters is that the photograph is kept either
        // way, because a scan nobody can look at afterwards is how August became an
        // exercise in reconstruction from absence.
        entity_type: shift_id ? 'shift' : 'station',
        entity_id: shift_id || req.stationId,
        kind: 'nozzle_slip',
        file_base64: image_base64,
        media_type,
        ocr: {
          composite: true,
          // Which engine read it, and how many characters Vision returned — see the
          // single-slip save above for why this is recorded rather than inferred.
          engine: parsed.engine ?? null,
          ocr_chars: parsed.ocr_chars ?? null,
          // Why the fallback engine read it, when it did — see the single-slip save.
          fallback_reason: parsed.fallback_reason ?? null,
          slips: slips.map(s => ({
            pump_serial: s.pump_serial,
            slip_type: s.slip_type,
            serial_known: s.serial_known,
            lines: s.lines,
          })),
        },
        meta: { composite: true, slip_count: slips.length },
        uploaded_by: req.user.id,
      });
    } catch { /* store failed — parse + resolve already done and returned */ }

    // OPTIONAL: persist each resolved closing as a DRAFT into shift_scan_meters, so a
    // later slice can pre-fill each operator's self-settlement with the closings the
    // manager scanned. Off by default — the read-only behaviour above is unchanged
    // when persist is falsy.
    //
    // 🔴 NOT shift_attendant_nozzles: a draft there would be read by the carry-forward
    // as a real close and corrupt the next shift's opening. This is a scanner draft,
    // trusted by nothing that touches money.
    //
    // TABLE-TOLERANT and on `pool` (autocommit), never a shared transaction: the table
    // arrives via owner-run DDL AFTER this code deploys, so probe first and, on a
    // missing table or any failure, skip silently and return persisted:false — the
    // parsed result is still returned exactly as before.
    let persisted = false;
    if (persist === true && await hasScanMeters()) {
      try {
        for (const s of slips) {
          for (const l of (s.lines || [])) {
            if (!l.nozzle_id || l.cumulative_volume == null) continue;
            await pool.query(
              `INSERT INTO shift_scan_meters
                 (station_id, shift_id, nozzle_id, closing_volume, closing_amount, scanned_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (shift_id, nozzle_id) DO UPDATE SET
                 closing_volume=$4, closing_amount=$5, scanned_by=$6, scanned_at=now()`,
              [req.stationId, shift_id, l.nozzle_id, l.cumulative_volume, l.cumulative_amount ?? null, req.user.id]);
          }
        }
        persisted = true;
      } catch { persisted = false; /* draft persist failed — parsed result still returned */ }
    }

    res.json({
      slips,
      legible: parsed.legible,
      notes: parsed.notes,
      persisted,
      // WHICH ENGINE READ IT, SAID OUT LOUD. This was already being written into the
      // artifact and then thrown away on the way back to the screen, so a fallback read
      // — the weaker path, taken when Vision is unconfigured, errors or returns too
      // little text — looked exactly like a good one to the person confirming it. On
      // Sri Balaji's 13 stored scans the fallback took 4, and nobody could have known
      // which 4. § 10 rule 2: a fallback read is marked low-trust and always goes
      // through human confirmation, with the reason recorded.
      engine: parsed.engine ?? null,
      fallback_reason: parsed.fallback_reason ?? null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
