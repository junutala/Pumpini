// src/routes/reconcile.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationVia } = require('../middleware/stationAccess');
const { sendAlert } = require('../services/alertService');
const Anthropic = require('@anthropic-ai/sdk');
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
router.post('/manager', authenticate, authorize('owner', 'manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
    const {
      shift_id, attendant_id, closing_reading, closings, price_per_ltr,
      test_ltrs = 0, card_total = 0, upi_total = 0, cash_actual = 0,
      credit_total = 0, petty_cash = 0,
      resolution, resolution_amount = 0, operator_ack = false, remarks, denomination,
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

    // Reset this shift's MANAGER closings (keep opening + any POS closing), then
    // write the new manager closings; canonical closing = manager else POS.
    await client.query('UPDATE shift_nozzle_readings SET closing_mgr=NULL, closing_reading=closing_pos WHERE shift_id=$1', [shift_id]);
    const valid = readings.filter(r => r && r.nozzle_id && r.closing_reading !== '' && r.closing_reading != null);
    const closeConflicts = [];   // manager's closing vs attendant's closing
    for (const r of valid) {
      const c = await writeSourceMeter(client, { shift_id, nozzle_id: r.nozzle_id, phase:'closing', source:'mgr', reading: Number(r.closing_reading), recorded_by: req.user.id });
      if (c) {
        const { rows: nz } = await client.query('SELECT nozzle_number FROM nozzles WHERE id=$1', [r.nozzle_id]);
        closeConflicts.push({ nozzle_id: r.nozzle_id, nozzle_number: nz[0]?.nozzle_number, ...c });
      }
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
           VALUES($1,$2,$3,$4,$5,$6,$7,'manager',
             (((SELECT date FROM shifts WHERE id=$2)::date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata'))`,
          [stationId, shift_id, w.nozzle_id, w.fuel_type, +(v / w.price).toFixed(3), w.price, mode]);
      }
    }

    await client.query('COMMIT');
    res.json({
      wet_sales: wetSales, dry_sales: dryNonCredit, credit, collections, expected, variance,
      nozzles: wetByNozzle, unvalued_readings: unvalued, source_conflicts: closeConflicts,
    });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// POST /api/reconcile/pos-meter — attendant captures a nozzle's totalizer from
// the POS. OCR via Claude, store the image, and record it as the OPENING (if none
// yet for this shift+nozzle) or the CLOSING, flagging a handover mismatch on open.
router.post('/pos-meter', authenticate, authorize('owner','manager','attendant'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
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

    // Audit image (best-effort).
    try {
      await client.query(
        `INSERT INTO meter_photos(shift_id, nozzle_id, image_base64, media_type, ocr_reading, ocr_legible, recorded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [shift_id, nozzle_id, image_base64, media_type, reading || null, legible, req.user.id]);
    } catch { /* meter_photos not present — OCR still returns */ }

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
    res.json({ reading, legible, notes, phase, mismatch, source_conflict });
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
    const mismatches = [];        // opening vs prior shift's closing (handover chain)
    const sourceConflicts = [];   // manager's opening vs attendant's opening (same nozzle)
    for (const r of valid) {
      const opening = Number(r.opening_reading);
      const conflict = await writeSourceMeter(client, { shift_id, nozzle_id: r.nozzle_id, phase:'opening', source:'mgr', reading: opening, recorded_by: req.user.id });
      const { rows: nz } = await client.query('SELECT nozzle_number FROM nozzles WHERE id=$1', [r.nozzle_id]);
      const nozzleNumber = nz[0]?.nozzle_number;
      if (conflict) sourceConflicts.push({ nozzle_id: r.nozzle_id, nozzle_number: nozzleNumber, ...conflict });

      // The prior shift's closing for this nozzle is what this opening must match.
      const { rows: prev } = await client.query(
        `SELECT snr.closing_reading FROM shift_nozzle_readings snr
         JOIN shifts s ON s.id = snr.shift_id
         WHERE snr.nozzle_id=$1 AND snr.shift_id <> $2 AND s.start_time < $3
           AND snr.closing_reading IS NOT NULL
         ORDER BY s.start_time DESC LIMIT 1`, [r.nozzle_id, shift_id, startTime]);
      const priorClosing = prev.length ? Number(prev[0].closing_reading) : null;
      if (priorClosing != null && Math.abs(opening - priorClosing) > 0.5) {
        mismatches.push({
          nozzle_id: r.nozzle_id, nozzle_number: nozzleNumber,
          opening, prior_closing: priorClosing, delta: +(opening - priorClosing).toFixed(3),
        });
      }
    }
    await client.query('COMMIT');
    res.json({ saved: valid.length, mismatches, source_conflicts: sourceConflicts });
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

// POST /api/reconcile/parse-slip — read a printed pump "Electronic Totalizer"
// slip (ALL nozzles of one pump at once) via Claude vision. Auto-detects the two
// layouts and returns each nozzle's CUMULATIVE VOLUME — the anchor the shift
// open/close uses (litres sold = closing slip − opening slip). One slip can be
// too long for one photo, so the client may call this per photo and merge.
const SLIP_PROMPT = `This image is a printed fuel-dispenser "Electronic Totalizer" / pump report slip. It belongs to ONE pump and lists that pump's nozzles, each with a CUMULATIVE volume totalizer (total litres dispensed over the pump's life).

Two layouts exist — detect which:
- Layout A: header has "FP. ID"; each "Nozzle No1 / No2 …" block has Shif/ShDay/ShMTH lines and a "CumVolume:" (litres) plus "CumSale:" (rupees). Use CumVolume as the nozzle's cumulative volume.
- Layout B: header has "FIP No."; an "Electronic Totalizer" block lists each "Nozzle No. : 0X" with "Ecal Factor", "Atot" (rupees) and "Vtot" (litres). Use Vtot as the nozzle's cumulative volume.

Extract the CUMULATIVE VOLUME for EVERY nozzle visible. Read digits exactly; drop leading zeros and separators but KEEP the decimal point.

Respond with ONLY a JSON object, nothing else:
{
 "slip_type": "A" or "B",
 "pump_id": "<the FP. ID / FIP No. as a plain number string>",
 "nozzles": [ { "nozzle_no": "<1..N>", "cumulative_volume": <number>, "legible": <true|false> } ],
 "legible": <true|false overall>,
 "notes": "<short note; mention any nozzle cut off the page or unclear>"
}
Include ONLY nozzles actually visible in THIS image. Set a nozzle's legible=false (and overall legible=false) if its volume digits are unclear, glare/blur-obscured, mid-roll, or cut off the edge. NEVER guess a digit.`;

router.post('/parse-slip', authenticate, authorize('owner', 'manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
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
    // Normalise: keep numeric cumulative_volume, build the {pump}.{nozzle} label.
    const pump = String(parsed.pump_id ?? '').replace(/[^\d]/g, '') || null;
    const nozzles = parsed.nozzles
      .map(n => {
        const no = String(n.nozzle_no ?? '').replace(/[^\d]/g, '');
        const vol = Number(String(n.cumulative_volume ?? '').toString().replace(/[^\d.]/g, ''));
        return {
          nozzle_no: no || null,
          label: pump && no ? `${pump}.${no}` : null,   // matches our decimal nozzle_number
          cumulative_volume: isFinite(vol) && vol > 0 ? vol : null,
          legible: n.legible === true && isFinite(vol) && vol > 0,
        };
      })
      .filter(n => n.nozzle_no);

    res.json({
      slip_type: parsed.slip_type === 'B' ? 'B' : (parsed.slip_type === 'A' ? 'A' : null),
      pump_id: pump,
      nozzles,
      legible: parsed.legible === true && nozzles.length > 0 && nozzles.every(n => n.legible),
      notes: notes || String(parsed.notes ?? ''),
    });
  } catch (err) { next(err); }
});

module.exports = router;
