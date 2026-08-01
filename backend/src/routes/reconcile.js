// src/routes/reconcile.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationVia } = require('../middleware/stationAccess');
const invoiceNo = require('../services/invoiceNumberService');
const { requirePerm } = require('../middleware/permissions');
const { sendAlert } = require('../services/alertService');
const { recomputeShift } = require('../services/settlementLedger');
const { storageConfigured, uploadDocumentBase64 } = require('../services/vaweStorage');
const artifacts  = require('../services/artifactService');
const attendance = require('../services/attendanceService');

// Do the slip-mapping columns exist on nozzles yet? Owner-run DDL means this code
// deploys first; cached only once TRUE so the first scan after the migration
// picks them up without an app restart.
let _hasSlipMapping = false;
async function hasSlipMapping() {
  if (_hasSlipMapping) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='nozzles'
          AND column_name='pump_id' LIMIT 1`);
    _hasSlipMapping = rows.length > 0;
  } catch { _hasSlipMapping = false; }
  return _hasSlipMapping;
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

// Store a meter reading in its source column (manager vs POS), recompute the
// canonical value (manager wins, else POS) used by reconciliation, and report a
// cross-source conflict when the two sources disagree for the same nozzle/phase.
async function writeSourceMeter(client, { shift_id, nozzle_id, phase, source, reading, recorded_by }) {
  const col = `${phase}_${source}`;   // opening_mgr | opening_pos | closing_mgr | closing_pos (controlled inputs)
  await client.query(
    `INSERT INTO shift_nozzle_readings(shift_id, nozzle_id, ${col}, recorded_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(shift_id, nozzle_id) DO UPDATE SET ${col}=$3, recorded_by=$4`,
    [shift_id, nozzle_id, reading, recorded_by]);
  const { rows } = await client.query(
    `UPDATE shift_nozzle_readings
       SET opening_reading = COALESCE(opening_mgr, opening_pos),
           closing_reading = COALESCE(closing_mgr, closing_pos)
     WHERE shift_id=$1 AND nozzle_id=$2
     RETURNING opening_mgr, opening_pos, closing_mgr, closing_pos`,
    [shift_id, nozzle_id]);
  const r = rows[0] || {};
  const mgr = r[`${phase}_mgr`], pos = r[`${phase}_pos`];
  if (mgr != null && pos != null && Math.abs(Number(mgr) - Number(pos)) > 0.5) {
    return { manager: Number(mgr), attendant: Number(pos), delta: +(Number(pos) - Number(mgr)).toFixed(3) };
  }
  return null;
}

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

      const { rows: saRows } = await client.query(`
        SELECT sa.id, sa.opening_reading, sa.opening_cash, sa.nozzle_id,
               n.fuel_type, s.station_id
        FROM shift_attendants sa
        JOIN shifts s ON s.id = sa.shift_id
        LEFT JOIN nozzles n ON n.id = sa.nozzle_id
        WHERE sa.shift_id=$1 AND sa.attendant_id=$2`, [shift_id, attendant_id]);
      if (!saRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Attendant not assigned to this shift' }); }
      const sa = saRows[0];

      // The operator's nozzles (child table); fall back to the legacy single nozzle.
      const { rows: nozRows } = await client.query(`
        SELECT san.nozzle_id, san.opening_reading, n.fuel_type
        FROM shift_attendant_nozzles san JOIN nozzles n ON n.id = san.nozzle_id
        WHERE san.shift_id=$1 AND san.attendant_id=$2`, [shift_id, attendant_id]);
      let opNozzles = nozRows;
      if (!opNozzles.length && sa.nozzle_id) opNozzles = [{ nozzle_id: sa.nozzle_id, opening_reading: sa.opening_reading, fuel_type: sa.fuel_type }];
      if (!opNozzles.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No nozzles assigned to this operator.' }); }

      // Closing readings: { nozzle_id -> {closing_reading, test_ltrs} } (multi), else the single form.
      const closeArr = (Array.isArray(closings) && closings.length)
        ? closings
        : (closing_reading != null ? [{ nozzle_id: sa.nozzle_id, closing_reading, test_ltrs }] : []);
      const closeMap = {};
      for (const c of closeArr) if (c && c.nozzle_id) closeMap[c.nozzle_id] = c;

      // Price per fuel (supplied price applies only to a single-fuel operator).
      const priceCache = {};
      const priceFor = async (fuel) => {
        if (priceCache[fuel] != null) return priceCache[fuel];
        let p = (price_per_ltr && opNozzles.length === 1) ? parseFloat(price_per_ltr) : 0;
        if (!p) {
          const { rows: pr } = await client.query(
            `SELECT price FROM fuel_prices WHERE station_id=$1 AND fuel_type=$2 ORDER BY effective_from DESC LIMIT 1`,
            [sa.station_id, fuel]);
          p = parseFloat(pr[0]?.price || 0);
        }
        priceCache[fuel] = p; return p;
      };

      // Sales = Σ over his nozzles of (closing − opening − test) × price(fuel).
      let salesValue = 0, totalTest = 0;
      const legs = [];
      for (const nz of opNozzles) {
        const c = closeMap[nz.nozzle_id];
        if (!c || c.closing_reading == null || c.closing_reading === '') {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: "A closing reading is missing for one of the operator's nozzles." });
        }
        const opening = parseFloat(nz.opening_reading || 0);
        const closing = parseFloat(c.closing_reading);
        const test    = parseFloat(c.test_ltrs || 0);
        const meterLtrs = closing - opening;
        if (!(meterLtrs >= 0)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Closing reading must be ≥ opening reading for every nozzle.' }); }
        const litres = Math.max(0, meterLtrs - test);
        const price  = await priceFor(nz.fuel_type);
        if (!price) { await client.query('ROLLBACK'); return res.status(400).json({ error: `No current price found for ${nz.fuel_type}.` }); }
        salesValue += litres * price; totalTest += test;
        legs.push({ nozzle_id: nz.nozzle_id, fuel_type: nz.fuel_type, price, litres, value: +(litres*price).toFixed(2), closing });
      }
      salesValue = +salesValue.toFixed(2);

      const openingCash = parseFloat(sa.opening_cash || 0);
      const cardVal   = parseFloat(card_total || 0);
      const upiVal    = parseFloat(upi_total || 0);
      const creditVal = parseFloat(credit_total || 0);    // manual lump → suspense
      const pettyVal  = parseFloat(petty_cash || 0);      // cash out of drawer → petty-cash fund
      const cashValue = +(salesValue - cardVal - upiVal - creditVal).toFixed(2);
      const expectedCash = +(openingCash + cashValue - pettyVal).toFixed(2);
      const cashActual   = parseFloat(cash_actual || 0);
      const variance     = +(cashActual - expectedCash).toFixed(2);

      // Re-create synthesized sales: distribute each payment bucket (incl. the
      // credit lump) across his nozzles by value share — keeps per-fuel litres AND
      // payment-mode totals exact. amount is generated (qty×rate).
      await client.query(`DELETE FROM dispense_events WHERE shift_id=$1 AND attendant_id=$2 AND source='manager'`, [shift_id, attendant_id]);
      for (const leg of legs) {
        const share = salesValue > 0 ? leg.value / salesValue : (1 / legs.length);
        for (const [mode, total] of [['cash', cashValue], ['card', cardVal], ['upi', upiVal], ['credit', creditVal]]) {
          const val = +(total * share).toFixed(2);
          if (val > 0) {
            await client.query(
              `INSERT INTO dispense_events
                 (station_id, shift_id, attendant_id, nozzle_id, fuel_type,
                  quantity_ltrs, rate_per_ltr, payment_mode, source, occurred_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manager',
                 (((SELECT date FROM shifts WHERE id=$2)::date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata'))`,
              [sa.station_id, shift_id, attendant_id, leg.nozzle_id, leg.fuel_type,
               +(val / leg.price).toFixed(3), leg.price, mode]);
          }
        }
      }

      // Persist each nozzle's closing; mirror the last onto sa for legacy reads.
      for (const leg of legs) {
        await client.query(
          `UPDATE shift_attendant_nozzles SET closing_reading=$1 WHERE shift_id=$2 AND attendant_id=$3 AND nozzle_id=$4`,
          [leg.closing, shift_id, attendant_id, leg.nozzle_id]);
      }
      await client.query(`UPDATE shift_attendants SET closing_reading=$1 WHERE shift_id=$2 AND attendant_id=$3`,
        [legs[legs.length - 1].closing, shift_id, attendant_id]);

      // Petty cash/skimming → one top-up into the station petty-cash fund per
      // operator (idempotent on the operator's settlement row).
      await client.query(`DELETE FROM petty_cash_entries WHERE reference_type='shift_close' AND reference_id=$1`, [sa.id]);
      if (pettyVal > 0) {
        const { rows: whoRows } = await client.query('SELECT name FROM users WHERE id=$1', [attendant_id]);
        const { rows: shRows }  = await client.query('SELECT date FROM shifts WHERE id=$1', [shift_id]);
        const dt = shRows[0]?.date ? String(shRows[0].date).slice(0, 10) : '';
        await client.query(
          `INSERT INTO petty_cash_entries(station_id, direction, amount, entry_type, description, reference_type, reference_id, created_by)
           VALUES($1,'in',$2,'topup',$3,'shift_close',$4,$5)`,
          [sa.station_id, pettyVal, `Petty cash @ shift close — ${whoRows[0]?.name || 'operator'}_${dt}`, sa.id, req.user.id]);
      }

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
        meta: { phase: 'close', attendant_id, shift_id },
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
    } catch (e) { await client.query('ROLLBACK'); next(e); }
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

      const { rows: saRows } = await client.query(`
        SELECT sa.id, sa.opening_reading, sa.opening_cash, sa.nozzle_id,
               n.fuel_type, s.station_id, s.status, s.date AS trade_date
        FROM shift_attendants sa
        JOIN shifts s ON s.id = sa.shift_id
        LEFT JOIN nozzles n ON n.id = sa.nozzle_id
        WHERE sa.shift_id=$1 AND sa.attendant_id=$2`, [shift_id, attendant_id]);
      if (!saRows.length) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'You are not assigned to this shift.' }); }
      const sa = saRows[0];
      if (sa.status !== 'open') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This shift is already closed.' }); }

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

      const { rows: nozRows } = await client.query(`
        SELECT san.nozzle_id, san.opening_reading, n.fuel_type
        FROM shift_attendant_nozzles san JOIN nozzles n ON n.id = san.nozzle_id
        WHERE san.shift_id=$1 AND san.attendant_id=$2`, [shift_id, attendant_id]);
      let opNozzles = nozRows;
      if (!opNozzles.length && sa.nozzle_id) opNozzles = [{ nozzle_id: sa.nozzle_id, opening_reading: sa.opening_reading, fuel_type: sa.fuel_type }];
      if (!opNozzles.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No nozzles are assigned to you.' }); }

      const closeArr = (Array.isArray(closings) && closings.length)
        ? closings
        : (closing_reading != null ? [{ nozzle_id: sa.nozzle_id, closing_reading, test_ltrs }] : []);
      const closeMap = {};
      for (const c of closeArr) if (c && c.nozzle_id) closeMap[c.nozzle_id] = c;

      // Board price per fuel — same source the manager close uses.
      const priceCache = {};
      const priceFor = async (fuel) => {
        if (priceCache[fuel] != null) return priceCache[fuel];
        const { rows: pr } = await client.query(
          `SELECT price FROM fuel_prices WHERE station_id=$1 AND fuel_type=$2 ORDER BY effective_from DESC LIMIT 1`,
          [sa.station_id, fuel]);
        const p = parseFloat(pr[0]?.price || 0);
        priceCache[fuel] = p; return p;
      };

      // Sales = Σ over his nozzles of (closing − opening − test) × price.
      let salesValue = 0, totalTest = 0;
      const legs = [];
      for (const nz of opNozzles) {
        const c = closeMap[nz.nozzle_id];
        if (!c || c.closing_reading == null || c.closing_reading === '') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A closing reading is missing for one of your nozzles.' }); }
        const opening = parseFloat(nz.opening_reading || 0);
        const closing = parseFloat(c.closing_reading);
        const test    = parseFloat(c.test_ltrs || 0);
        const meterLtrs = closing - opening;
        if (!(meterLtrs >= 0)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Closing reading must be ≥ opening reading for every nozzle.' }); }
        const litres = Math.max(0, meterLtrs - test);
        const price  = await priceFor(nz.fuel_type);
        if (!price) { await client.query('ROLLBACK'); return res.status(400).json({ error: `No current price found for ${nz.fuel_type}.` }); }
        salesValue += litres * price; totalTest += test;
        legs.push({ nozzle_id: nz.nozzle_id, fuel_type: nz.fuel_type, price, litres, value: +(litres*price).toFixed(2), opening, closing });
      }
      salesValue = +salesValue.toFixed(2);

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
      const cashValue = +(salesValue - cardVal - upiVal - creditVal).toFixed(2);
      const expectedCash = +(openingCash + cashValue - pettyVal).toFixed(2);
      const variance = +(cashActual - expectedCash).toFixed(2);

      // Re-synthesise this operator's sales into dispense_events (per nozzle × mode).
      await client.query(`DELETE FROM dispense_events WHERE shift_id=$1 AND attendant_id=$2 AND source='manager'`, [shift_id, attendant_id]);
      for (const leg of legs) {
        const share = salesValue > 0 ? leg.value / salesValue : (1 / legs.length);
        for (const [mode, total] of [['cash', cashValue], ['card', cardVal], ['upi', upiVal], ['credit', creditVal]]) {
          const val = +(total * share).toFixed(2);
          if (val > 0) {
            await client.query(
              `INSERT INTO dispense_events
                 (station_id, shift_id, attendant_id, nozzle_id, fuel_type,
                  quantity_ltrs, rate_per_ltr, payment_mode, source, occurred_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manager',
                 (((SELECT date FROM shifts WHERE id=$2)::date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata'))`,
              [sa.station_id, shift_id, attendant_id, leg.nozzle_id, leg.fuel_type, +(val/leg.price).toFixed(3), leg.price, mode]);
          }
        }
      }

      // Persist each nozzle's closing (mirror the manager close).
      for (const leg of legs) {
        await client.query(`UPDATE shift_attendant_nozzles SET closing_reading=$1 WHERE shift_id=$2 AND attendant_id=$3 AND nozzle_id=$4`, [leg.closing, shift_id, attendant_id, leg.nozzle_id]);
      }
      await client.query(`UPDATE shift_attendants SET closing_reading=$1 WHERE shift_id=$2 AND attendant_id=$3`, [legs[legs.length-1].closing, shift_id, attendant_id]);

      // Petty → station petty-cash fund (idempotent per operator settlement).
      await client.query(`DELETE FROM petty_cash_entries WHERE reference_type='shift_close' AND reference_id=$1`, [sa.id]);
      if (pettyVal > 0) {
        const { rows: who } = await client.query('SELECT name FROM users WHERE id=$1', [attendant_id]);
        const dt = sa.trade_date ? String(sa.trade_date).slice(0, 10) : '';
        await client.query(
          `INSERT INTO petty_cash_entries(station_id, direction, amount, entry_type, description, reference_type, reference_id, created_by)
           VALUES($1,'in',$2,'topup',$3,'shift_close',$4,$5)`,
          [sa.station_id, pettyVal, `Petty cash @ self-settle — ${who[0]?.name || 'operator'}_${dt}`, sa.id, attendant_id]);
      }

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

      // Write the operator's reconciliation row as FINAL (manager_confirmed=TRUE, no
      // separate manager confirm). mode='operator' marks the source; the shift-end
      // screen and settlement tile read it exactly as a manager-entered line.
      const { rows: recoRows } = await client.query(
        `INSERT INTO shift_reconciliation(
           shift_id, attendant_id, total_sales, cash_expected, cash_actual,
           upi_total, credit_total, card_total, remarks, manager_confirmed, manager_id,
           confirmed_at, reconciled_at, mode, operator_ack, test_ltrs, price_per_ltr, petty_cash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$2,NOW(),NOW(),'operator',TRUE,$10,$11,$12)
         ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
           total_sales=$3, cash_expected=$4, cash_actual=$5, upi_total=$6, credit_total=$7,
           card_total=$8, remarks=$9, manager_confirmed=TRUE, manager_id=$2, confirmed_at=NOW(),
           reconciled_at=NOW(), mode='operator', operator_ack=TRUE, test_ltrs=$10,
           price_per_ltr=$11, petty_cash=$12
         RETURNING *`,
        [shift_id, attendant_id, salesValue, expectedCash, cashActual, upiVal, creditVal, cardVal,
         remarks || null, totalTest, legs[0]?.price || 0, pettyVal]);

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
    } catch (e) { await client.query('ROLLBACK'); next(e); }
    finally { client.release(); }
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

    // Return full reco with variance — only now is it revealed
    res.json({ ...reco, variance });
  } catch(err) { next(err); }
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
// the POS. OCR via Claude, store the image, and record it as the OPENING (if none
// yet for this shift+nozzle) or the CLOSING, flagging a handover mismatch on open.
// Meter OCR during shift close — part of the attendant SETTLEMENT flow, so it is
// gated on settlement.enter (held by attendant + manager + owner), not reconcile.manage.
router.post('/pos-meter', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requirePerm('settlement.enter'),
  async (req, res, next) => {
  const { shift_id, nozzle_id, image_base64, media_type = 'image/jpeg' } = req.body;
  if (!shift_id || !nozzle_id || !image_base64) return res.status(400).json({ error: 'shift_id, nozzle_id and image are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sh } = await client.query('SELECT start_time FROM shifts WHERE id=$1', [shift_id]);
    if (!sh.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Shift not found' }); }
    const startTime = sh[0].start_time;

    // OCR the totalizer
    let reading = '', legible = false, notes = '';
    try {
      const ai = await aiClient.messages.create({
        model: 'claude-haiku-4-5', max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
          { type: 'text', text: 'This image is a fuel dispenser cumulative totalizer (the counter showing total litres dispensed for one nozzle). Read its digits exactly, left to right, ignoring separators (keep a decimal only if clearly shown). Respond with ONLY a JSON object: {"reading":"<digits>","legible":<true|false>,"notes":"<short>"}. legible=false if any digit is unclear, mid-roll, glare-obscured, or you are unsure.' },
        ] }],
      });
      const txt = (ai.content.find(b => b.type === 'text')?.text || '').trim();
      const m = txt.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : {};
      reading = String(parsed.reading ?? '').replace(/[^\d.]/g, '');
      legible = parsed.legible === true && reading !== '';
      notes   = String(parsed.notes ?? '');
    } catch (e) { notes = 'OCR failed: ' + (e.message || 'unknown'); }

    let phase = 'opening', mismatch = null, source_conflict = null;
    if (reading) {
      const num = Number(reading);
      // Phase from the POS's OWN prior capture, so the attendant's first scan is
      // their opening even if the manager already recorded one.
      const { rows: ex } = await client.query(
        'SELECT opening_pos FROM shift_nozzle_readings WHERE shift_id=$1 AND nozzle_id=$2', [shift_id, nozzle_id]);
      phase = (ex.length && ex[0].opening_pos != null) ? 'closing' : 'opening';
      source_conflict = await writeSourceMeter(client, { shift_id, nozzle_id, phase, source:'pos', reading: num, recorded_by: req.user.id });
      if (phase === 'opening') {
        const { rows: prev } = await client.query(
          `SELECT snr.closing_reading FROM shift_nozzle_readings snr
           JOIN shifts s ON s.id = snr.shift_id
           WHERE snr.nozzle_id=$1 AND snr.shift_id <> $2 AND s.start_time < $3 AND snr.closing_reading IS NOT NULL
           ORDER BY s.start_time DESC LIMIT 1`, [nozzle_id, shift_id, startTime]);
        const pc = prev.length ? Number(prev[0].closing_reading) : null;
        if (pc != null && Math.abs(num - pc) > 0.5) mismatch = { prior_closing: pc, delta: +(num - pc).toFixed(3) };
      }
    }
    await client.query('COMMIT');
    // Audit image (best-effort) — stored AFTER commit so the slow bucket upload
    // never holds the shift-close transaction open and a store failure can't touch
    // the saved reading. bytes → private bucket, DB keeps only the path.
    try {
      await storeMeterPhoto({ shift_id, nozzle_id, image_base64, media_type, ocr_reading: reading || null, ocr_legible: legible, recorded_by: req.user.id });
    } catch { /* store failed — OCR + reading already saved and returned */ }
    res.json({ reading, legible, notes, phase, mismatch, source_conflict });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// POST /api/reconcile/shift-opening-meters — REMOVED. Dead (no UI); the live
// opening-meter capture is the attendant's /pos-meter. See docs/drift-audit.md.

// POST /api/reconcile/ocr-meter — read a fuel-pump totalizer photo via Claude
// vision, store the image for audit, return the extracted digits. The manager
// confirms the number on screen; legible=false means "verify before trusting".
router.post('/ocr-meter', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requirePerm('reconcile.manage'),
  async (req, res, next) => {
  try {
    const { shift_id, nozzle_id, image_base64, media_type = 'image/jpeg' } = req.body;
    if (!shift_id || !image_base64) return res.status(400).json({ error: 'shift_id and image are required' });

    let reading = '', legible = false, notes = '';
    try {
      const ai = await aiClient.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
            { type: 'text', text: 'This image is a fuel dispenser cumulative totalizer — a mechanical/electronic counter showing the total litres dispensed for one nozzle over the pump\'s life. Read its digits exactly, left to right, ignoring separators (keep a decimal point only if clearly shown). Respond with ONLY a JSON object and nothing else: {"reading":"<digits as shown>","legible":<true|false>,"notes":"<short note>"}. Set legible=false if any digit is unclear, mid-roll, glare-obscured, or you are not confident.' },
          ],
        }],
      });
      const txt = (ai.content.find(b => b.type === 'text')?.text || '').trim();
      const m = txt.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : {};
      reading = String(parsed.reading ?? '').replace(/[^\d.]/g, '');
      legible = parsed.legible === true && reading !== '';
      notes   = String(parsed.notes ?? '');
    } catch (e) {
      notes = 'OCR failed: ' + (e.message || 'unknown');
    }

    // Keep the image for audit (best-effort). bytes → private bucket, DB keeps
    // only the path; falls back to legacy base64 if storage_path isn't migrated.
    try {
      await storeMeterPhoto({ shift_id, nozzle_id: nozzle_id || null, image_base64, media_type, ocr_reading: reading || null, ocr_legible: legible, recorded_by: req.user.id });
    } catch { /* table not yet created / store failed — OCR result still returns */ }

    res.json({ reading, legible, notes });
  } catch (err) { next(err); }
});

// POST /api/reconcile/parse-slip — read a printed pump "Electronic Totalizer"
// slip (ALL nozzles of one pump at once) via Claude vision. Auto-detects the two
// layouts and returns each nozzle's CUMULATIVE VOLUME — the anchor the shift
// open/close uses (litres sold = closing slip − opening slip). One slip can be
// too long for one photo, so the client may call this per photo and merge.
const SLIP_PROMPT = `This image is a printed fuel-dispenser "Electronic Totalizer" / pump report slip. It belongs to ONE pump and lists that pump's nozzles, each with a CUMULATIVE volume totalizer (total litres dispensed over the pump's life).

Known layouts — detect which, and if it is NONE of them still apply the rules below:
- Layout A: header has "FP. ID"; each "Nozzle No1 / No2 …" block has Shif/ShDay/ShMTH lines and a "CumVolume:" (litres) plus "CumSale:" (rupees). Use CumVolume as the nozzle's cumulative volume.
- Layout B: header has "FIP No."; an "Electronic Totalizer" block lists each "Nozzle No. : 0X" with "Ecal Factor", "Atot" (rupees) and "Vtot" (litres). Use Vtot as the nozzle's cumulative volume.
- Layout C (HPCL "ETOT-MAIN"): header carries PUMP SERIAL NUMBER and MODEL, then "---: ETOT-MAIN :---" and one block per nozzle reading "NOZZLE : 1" followed by "A:<number>", "V:<number>" and "TOT SALES:<number>". Here **V is the VOLUME in litres and is the figure we want**; A is the cumulative AMOUNT in rupees and TOT SALES is a COUNT of transactions. Use V.

🔴 THE SINGLE MOST IMPORTANT RULE: RETURN LITRES, NEVER RUPEES.
Every layout prints a money total beside the volume total, and the money total is the BIGGER number — roughly 100x the litres, because fuel sells at about ₹100 per litre. Whatever the labels look like:
- "V", "Vtot", "CumVolume", "VOLUME", "Ltr" -> LITRES -> this is cumulative_volume.
- "A", "Atot", "CumSale", "AMOUNT", "Rs", "₹" -> RUPEES -> this is cumulative_amount, NOT the volume.
If a block shows 146566859.519 next to 1506431.450, the volume is 1506431.450 — the SMALLER one. Putting the rupee figure in cumulative_volume overstates a nozzle's meter by a hundredfold and destroys the shift's sales calculation, so when the labels are ambiguous prefer the SMALLER of the two totals and say so in notes.

Extract the CUMULATIVE VOLUME for EVERY nozzle visible. Read digits exactly; drop leading zeros and separators but KEEP the decimal point.

Respond with ONLY a JSON object, nothing else:
{
 "slip_type": "A" or "B" or "C" or "other",
 "pump_id": "<the FP. ID / FIP No. as a plain number string, or null>",
 "pump_serial": "<the PUMP SERIAL NUMBER exactly as printed, e.g. 15BC1412V, or null>",
 "nozzles": [ { "nozzle_no": "<the nozzle number AS PRINTED>", "cumulative_volume": <litres>, "cumulative_amount": <rupees or null>, "legible": <true|false> } ],
 "legible": <true|false overall>,
 "notes": "<short note; mention any nozzle cut off the page or unclear>"
}
- pump_serial: copy the PUMP SERIAL NUMBER verbatim, letters and all. It is how we tell WHICH dispenser printed this slip when the slip carries no pump number, so it matters more than pump_id on those layouts. Do not strip characters and do not confuse it with MODEL.
- pump_id: ONLY a genuine pump/FIP identifier — a small number like 1, 2 or 3. A PUMP SERIAL NUMBER ("17CH2653V"), a MODEL ("1224/2224") and a phone number are NOT pump ids: return null instead. A wrong pump id is worse than none, because it is used to match the slip to our nozzles.
- READ nozzle_no OFF THE SLIP. It is the number printed next to that block — "Nozzle No1" -> "1", "Nozzle No. : 03" -> "3". DO NOT renumber the blocks by their position on the page. If the first block you can see is nozzle 3, report 3, NOT 1. A slip photographed in two parts must report the SAME numbers it prints in each part, or the second photo silently overwrites the first photo's readings against the wrong nozzles.
- If a block's nozzle number is itself unreadable, return null for nozzle_no rather than inferring it from order.
Include ONLY nozzles actually visible in THIS image. Set a nozzle's legible=false (and overall legible=false) if its volume digits are unclear, glare/blur-obscured, mid-roll, or cut off the edge. NEVER guess a digit.`;

router.post('/parse-slip', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  requirePerm('reconcile.manage'),
  async (req, res, next) => {
  try {
    const { shift_id, image_base64, media_type = 'image/jpeg' } = req.body;
    if (!shift_id || !image_base64) return res.status(400).json({ error: 'shift_id and image are required' });

    let parsed = null, notes = '';
    try {
      const ai = await aiClient.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
            { type: 'text', text: SLIP_PROMPT },
          ],
        }],
      });
      const txt = (ai.content.find(b => b.type === 'text')?.text || '').trim();
      const m = txt.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      try { require('../utils/logger').warn('parse-slip OCR failed: ' + (e.message || e)); } catch { /* noop */ }
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
    const extraCols = slipCols ? ', p.serial AS pump_serial, n.slip_nozzle_no' : '';
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

    // THE SERIAL IS THE DISPENSER'S IDENTITY. A slip that prints no pump number
    // — the HPCL ETOT-MAIN layout does not — leaves "NOZZLE : 1" ambiguous across
    // every dispenser at the outlet, and no amount of renaming our nozzles can
    // resolve it, because the ambiguity is on the slip's side. The serial is
    // stamped on the unit, never changes, and is printed on every slip it emits.
    // Once mapped in Settings this is an exact lookup with nothing inferred.
    const serialRaw = String(parsed.pump_serial ?? '').trim().toUpperCase();
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
        let swapped = false;
        if (isFinite(vol) && isFinite(amt) && amt > 0 && vol > amt) { swapped = true; vol = amt; }

        // Most specific first: the serial identifies the machine outright, so it
        // beats any numbering convention. Then the qualified pump.nozzle form,
        // then the bare number. Never fall back to position.
        let cands = [];
        let matchedOn = null;
        if (serialRaw && no) {
          cands = bySerial[`${serialRaw}|${no}`] || [];
          matchedOn = cands.length ? 'pump_serial' : null;
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
            ? cands.map(c => ({ id: c.id, nozzle_number: c.nozzle_number, fuel_type: c.fuel_type }))
            : undefined,
        };
      })
      .filter(n => n.nozzle_no);

    const serialKnown = !!(serialRaw && Object.keys(bySerial).some(k => k.startsWith(`${serialRaw}|`)));

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
      ocr: { pump_id: pump, nozzles },
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
        if (nozzles.every(n => n.nozzle_id)) return null;
        if (serialRaw && !serialKnown) {
          return `This slip is from pump serial ${serialRaw}, which is not set up yet. `
               + 'Add it under Settings → Pumps & Nozzles, or enter the readings by hand.';
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

module.exports = router;
