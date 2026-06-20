// src/routes/reconcile.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationVia } = require('../middleware/stationAccess');
const { sendAlert } = require('../services/alertService');
const Anthropic = require('@anthropic-ai/sdk');
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
router.post('/manager', authenticate, authorize('owner', 'manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
    const {
      shift_id, attendant_id, closing_reading, price_per_ltr,
      test_ltrs = 0, card_total = 0, upi_total = 0, cash_actual = 0,
      resolution, resolution_amount = 0, operator_ack = false, remarks, denomination,
    } = req.body;
    if (!shift_id || !attendant_id) return res.status(400).json({ error: 'shift_id and attendant_id are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: saRows } = await client.query(`
        SELECT sa.opening_reading, sa.opening_cash, sa.nozzle_id,
               n.fuel_type, s.station_id
        FROM shift_attendants sa
        JOIN shifts s ON s.id = sa.shift_id
        LEFT JOIN nozzles n ON n.id = sa.nozzle_id
        WHERE sa.shift_id=$1 AND sa.attendant_id=$2`, [shift_id, attendant_id]);
      if (!saRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Attendant not assigned to this shift' }); }
      const sa = saRows[0];

      // Price: supplied (handles mid-shift revision) else latest fuel price
      let price = parseFloat(price_per_ltr || 0);
      if (!price && sa.fuel_type) {
        const { rows: pr } = await client.query(
          `SELECT price FROM fuel_prices WHERE station_id=$1 AND fuel_type=$2
           ORDER BY effective_from DESC LIMIT 1`, [sa.station_id, sa.fuel_type]);
        price = parseFloat(pr[0]?.price || 0);
      }
      if (!price) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Price per litre is required (no current price found).' }); }

      const openingReading = parseFloat(sa.opening_reading || 0);
      const openingCash    = parseFloat(sa.opening_cash || 0);
      const meterLtrs = parseFloat(closing_reading) - openingReading;
      if (!(meterLtrs >= 0)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Closing reading must be ≥ opening reading.' }); }
      const salesLtrs  = Math.max(0, meterLtrs - parseFloat(test_ltrs || 0));
      const salesValue = +(salesLtrs * price).toFixed(2);

      // Credit already logged per customer for this attendant/shift — not synthesized
      const { rows: cr } = await client.query(`
        SELECT COALESCE(SUM(amount),0) AS credit_value
        FROM dispense_events
        WHERE shift_id=$1 AND attendant_id=$2 AND payment_mode='credit'
          AND NOT COALESCE(is_voided,FALSE)`, [shift_id, attendant_id]);
      const creditValue = parseFloat(cr[0].credit_value || 0);

      const cardVal   = parseFloat(card_total || 0);
      const upiVal    = parseFloat(upi_total || 0);
      const cashValue = +(salesValue - cardVal - upiVal - creditValue).toFixed(2);
      const expectedCash = +(openingCash + cashValue).toFixed(2);
      const cashActual   = parseFloat(cash_actual || 0);
      const variance     = +(cashActual - expectedCash).toFixed(2);

      // Idempotent re-submit: drop prior synthesized rows, re-create cash/card/upi.
      // (Credit is real per-customer data and is left untouched.) amount is a
      // generated column (qty×rate), so we set rate=price and qty=value/price.
      await client.query(`DELETE FROM dispense_events WHERE shift_id=$1 AND attendant_id=$2 AND source='manager'`, [shift_id, attendant_id]);
      for (const [mode, val] of [['cash', cashValue], ['card', cardVal], ['upi', upiVal]]) {
        if (val > 0) {
          await client.query(
            `INSERT INTO dispense_events
               (station_id, shift_id, attendant_id, nozzle_id, fuel_type,
                quantity_ltrs, rate_per_ltr, payment_mode, source, occurred_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manager',NOW())`,
            [sa.station_id, shift_id, attendant_id, sa.nozzle_id, sa.fuel_type,
             +(val / price).toFixed(3), price, mode]);
        }
      }

      await client.query(`UPDATE shift_attendants SET closing_reading=$1 WHERE shift_id=$2 AND attendant_id=$3`,
        [closing_reading, shift_id, attendant_id]);

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
           mode, resolution, resolution_amount, operator_ack, test_ltrs, price_per_ltr)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,NOW(),NOW(),'manager',$11,$12,$13,$14,$15)
         ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
           total_sales=$3, cash_expected=$4, cash_actual=$5, upi_total=$6, credit_total=$7,
           card_total=$8, remarks=$9, manager_confirmed=TRUE, manager_id=$10, confirmed_at=NOW(),
           reconciled_at=NOW(), mode='manager', resolution=$11, resolution_amount=$12,
           operator_ack=$13, test_ltrs=$14, price_per_ltr=$15
         RETURNING *`,
        [shift_id, attendant_id, salesValue, expectedCash, cashActual,
         upiVal, creditValue, cardVal, remarks||null, req.user.id,
         resType, resAmt, operator_ack === true || operator_ack === 'true', test_ltrs||0, price]);

      await client.query('COMMIT');

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
router.patch('/:id/confirm', authenticate, authorize('owner','manager'), requireStationVia('SELECT s.station_id FROM shift_reconciliation r JOIN shifts s ON s.id=r.shift_id WHERE r.id=$1', 'id'), async (req, res, next) => {
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

// POST /api/reconcile/operator-cash — record one operator's collections.
// Creates the shift_reconciliation row the shift close requires. No meter math
// here (that's shift-level); per-operator variance is not computed in this mode.
router.post('/operator-cash', authenticate, authorize('owner','manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
  try {
    const { shift_id, attendant_id, cash_total = 0, card_total = 0, upi_total = 0 } = req.body;
    if (!shift_id || !attendant_id) return res.status(400).json({ error: 'shift_id and attendant_id are required' });
    const cash = Number(cash_total)||0, card = Number(card_total)||0, upi = Number(upi_total)||0;
    if ([cash,card,upi].some(v => !Number.isFinite(v) || v < 0 || v > 10000000)) {
      return res.status(400).json({ error: 'Invalid collection amount.' });
    }
    const collected = +(cash + card + upi).toFixed(2);
    const { rows } = await pool.query(
      `INSERT INTO shift_reconciliation(
         shift_id, attendant_id, total_sales, cash_expected, cash_actual,
         upi_total, credit_total, card_total, manager_confirmed, manager_id,
         confirmed_at, reconciled_at, mode)
       VALUES($1,$2,$3,$3,$4,$5,0,$6,TRUE,$7,NOW(),NOW(),'mgr_cash')
       ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
         total_sales=$3, cash_expected=$3, cash_actual=$4, upi_total=$5,
         card_total=$6, manager_confirmed=TRUE, manager_id=$7,
         confirmed_at=NOW(), reconciled_at=NOW(), mode='mgr_cash'
       RETURNING *`,
      [shift_id, attendant_id, collected, cash, upi, card, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/reconcile/shift-meters — save per-nozzle closing meters, derive wet
// sales (opening = the prior shift's closing for that nozzle), synthesize the wet
// sales into dispense_events (fuel-wise) for dashboards, and return the recon.
router.post('/shift-meters', authenticate, authorize('owner','manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
  const { shift_id, readings = [], fuel_credit = 0 } = req.body;
  if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: shRows } = await client.query('SELECT station_id, start_time FROM shifts WHERE id=$1', [shift_id]);
    if (!shRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Shift not found' }); }
    const stationId = shRows[0].station_id, startTime = shRows[0].start_time;

    // Reset this shift's closings (keep any opening captured at start), then
    // upsert the new closings onto the same (shift, nozzle) rows.
    await client.query('UPDATE shift_nozzle_readings SET closing_reading=NULL WHERE shift_id=$1', [shift_id]);
    const valid = readings.filter(r => r && r.nozzle_id && r.closing_reading !== '' && r.closing_reading != null);
    for (const r of valid) {
      await client.query(
        `INSERT INTO shift_nozzle_readings(shift_id, nozzle_id, closing_reading, recorded_by)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(shift_id, nozzle_id) DO UPDATE SET closing_reading=$3, recorded_by=$4`,
        [shift_id, r.nozzle_id, Number(r.closing_reading), req.user.id]);
    }

    // Wet sales: opening = most recent prior closing for that nozzle (your dummy
    // shift seeds the first). Untagged readings (no nozzle) can't be valued.
    let wetSales = 0; const wetByNozzle = []; let unvalued = 0;
    for (const r of valid) {
      if (!r.nozzle_id) { unvalued++; continue; }
      const closing = Number(r.closing_reading);
      const { rows: nz } = await client.query('SELECT fuel_type FROM nozzles WHERE id=$1', [r.nozzle_id]);
      const fuelType = nz[0]?.fuel_type;
      const { rows: prev } = await client.query(
        `SELECT snr.closing_reading FROM shift_nozzle_readings snr
         JOIN shifts s ON s.id = snr.shift_id
         WHERE snr.nozzle_id=$1 AND snr.shift_id <> $2 AND s.start_time < $3
         ORDER BY s.start_time DESC LIMIT 1`, [r.nozzle_id, shift_id, startTime]);
      const opening = prev.length ? Number(prev[0].closing_reading) : null;
      if (opening == null || !fuelType) { unvalued++; continue; }
      const litres = Math.max(0, closing - opening);
      const { rows: pr } = await client.query(
        `SELECT price FROM fuel_prices WHERE station_id=$1 AND fuel_type=$2 ORDER BY effective_from DESC LIMIT 1`,
        [stationId, fuelType]);
      const price = Number(pr[0]?.price || 0);
      const value = +(litres * price).toFixed(2);
      wetSales += value;
      wetByNozzle.push({ nozzle_id: r.nozzle_id, fuel_type: fuelType, opening, closing, litres, price, value });
    }
    wetSales = +wetSales.toFixed(2);

    // Collections (all operators) + bay dry sales.
    const { rows: col } = await client.query(
      `SELECT COALESCE(SUM(cash_actual),0) cash, COALESCE(SUM(card_total),0) card, COALESCE(SUM(upi_total),0) upi
       FROM shift_reconciliation WHERE shift_id=$1`, [shift_id]);
    const cashC = Number(col[0].cash), cardC = Number(col[0].card), upiC = Number(col[0].upi);
    const collections = +(cashC + cardC + upiC).toFixed(2);
    const { rows: dry } = await client.query(
      `SELECT COALESCE(SUM(grand_total) FILTER (WHERE payment_mode<>'credit'),0) noncredit,
              COALESCE(SUM(grand_total) FILTER (WHERE payment_mode='credit'),0) credit
       FROM product_invoices WHERE shift_id=$1 AND location='bay'`, [shift_id]);
    const dryNonCredit = Number(dry[0].noncredit), dryCredit = Number(dry[0].credit);

    const fuelCredit = Number(fuel_credit || 0);
    const credit   = +(fuelCredit + dryCredit).toFixed(2);
    const expected = +(wetSales + dryNonCredit - fuelCredit).toFixed(2);
    const variance = +(collections - expected).toFixed(2);

    // Synthesize wet sales → dispense_events (fuel-wise). Payment split apportioned
    // by the collection mix (we can't cross fuel×payment without per-txn data).
    // Idempotent: drop prior synthesized rows first.
    await client.query(`DELETE FROM dispense_events WHERE shift_id=$1 AND source='manager'`, [shift_id]);
    const tot = cashC + cardC + upiC;
    const mix = tot > 0 ? { cash: cashC/tot, card: cardC/tot, upi: upiC/tot } : { cash: 1, card: 0, upi: 0 };
    for (const w of wetByNozzle) {
      if (!w.price || w.value <= 0) continue;
      for (const [mode, frac] of [['cash',mix.cash],['card',mix.card],['upi',mix.upi]]) {
        const v = +(w.value * frac).toFixed(2);
        if (v <= 0) continue;
        await client.query(
          `INSERT INTO dispense_events(station_id, shift_id, nozzle_id, fuel_type,
             quantity_ltrs, rate_per_ltr, payment_mode, source, occurred_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,'manager',NOW())`,
          [stationId, shift_id, w.nozzle_id, w.fuel_type, +(v / w.price).toFixed(3), w.price, mode]);
      }
    }

    await client.query('COMMIT');
    res.json({
      wet_sales: wetSales, dry_sales: dryNonCredit, credit, collections, expected, variance,
      nozzles: wetByNozzle, unvalued_readings: unvalued,
    });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// POST /api/reconcile/shift-opening-meters — record per-nozzle OPENING totalizer
// at shift start, and flag any that don't match the prior shift's closing for
// that nozzle (the two-party handover check: this operator's opening should
// equal the previous operator's closing).
router.post('/shift-opening-meters', authenticate, authorize('owner','manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
  const { shift_id, readings = [] } = req.body;
  if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sh } = await client.query('SELECT start_time FROM shifts WHERE id=$1', [shift_id]);
    if (!sh.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Shift not found' }); }
    const startTime = sh[0].start_time;

    const valid = readings.filter(r => r && r.nozzle_id && r.opening_reading !== '' && r.opening_reading != null);
    const mismatches = [];
    for (const r of valid) {
      const opening = Number(r.opening_reading);
      await client.query(
        `INSERT INTO shift_nozzle_readings(shift_id, nozzle_id, opening_reading, recorded_by)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(shift_id, nozzle_id) DO UPDATE SET opening_reading=$3, recorded_by=$4`,
        [shift_id, r.nozzle_id, opening, req.user.id]);

      // The prior shift's closing for this nozzle is what this opening must match.
      const { rows: prev } = await client.query(
        `SELECT snr.closing_reading FROM shift_nozzle_readings snr
         JOIN shifts s ON s.id = snr.shift_id
         WHERE snr.nozzle_id=$1 AND snr.shift_id <> $2 AND s.start_time < $3
           AND snr.closing_reading IS NOT NULL
         ORDER BY s.start_time DESC LIMIT 1`, [r.nozzle_id, shift_id, startTime]);
      const priorClosing = prev.length ? Number(prev[0].closing_reading) : null;
      if (priorClosing != null && Math.abs(opening - priorClosing) > 0.5) {
        const { rows: nz } = await client.query('SELECT nozzle_number FROM nozzles WHERE id=$1', [r.nozzle_id]);
        mismatches.push({
          nozzle_id: r.nozzle_id, nozzle_number: nz[0]?.nozzle_number,
          opening, prior_closing: priorClosing, delta: +(opening - priorClosing).toFixed(3),
        });
      }
    }
    await client.query('COMMIT');
    res.json({ saved: valid.length, mismatches });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// POST /api/reconcile/ocr-meter — read a fuel-pump totalizer photo via Claude
// vision, store the image for audit, return the extracted digits. The manager
// confirms the number on screen; legible=false means "verify before trusting".
router.post('/ocr-meter', authenticate, authorize('owner','manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
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

    // Keep the image for audit (best-effort — works once meter_photos exists).
    try {
      await pool.query(
        `INSERT INTO meter_photos(shift_id, nozzle_id, image_base64, media_type, ocr_reading, ocr_legible, recorded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [shift_id, nozzle_id || null, image_base64, media_type, reading || null, legible, req.user.id]);
    } catch { /* table not yet created / store failed — OCR result still returns */ }

    res.json({ reading, legible, notes });
  } catch (err) { next(err); }
});

module.exports = router;
