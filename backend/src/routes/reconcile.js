// src/routes/reconcile.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationVia } = require('../middleware/stationAccess');
const { sendAlert } = require('../services/alertService');

// POST /api/reconcile/denomination  — save denomination count (attendant)
router.post('/denomination', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const {
      shift_id, attendant_id,
      note_500=0,note_200=0,note_100=0,note_50=0,
      note_20=0,note_10=0,note_5=0,note_2=0,note_1=0
    } = req.body;
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

    // Compute totals — store but do NOT expose to attendant
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(amount),0)                                            AS total_sales,
        COALESCE(SUM(CASE WHEN payment_mode='cash'   THEN amount ELSE 0 END),0) AS cash_expected,
        COALESCE(SUM(CASE WHEN payment_mode='upi'    THEN amount ELSE 0 END),0) AS upi_total,
        COALESCE(SUM(CASE WHEN payment_mode='credit' THEN amount ELSE 0 END),0) AS credit_total,
        COALESCE(SUM(CASE WHEN payment_mode='card'   THEN amount ELSE 0 END),0) AS card_total
      FROM dispense_events
      WHERE shift_id=$1 AND attendant_id=$2`,
      [shift_id, attendant_id]
    );

    const t        = totals[0];
    const variance = parseFloat(cash_actual) - parseFloat(t.cash_expected);

    const { rows } = await pool.query(
      `INSERT INTO shift_reconciliation(
         shift_id, attendant_id, total_sales, cash_expected, cash_actual,
         upi_total, credit_total, card_total, remarks, manager_confirmed
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)
       ON CONFLICT(shift_id,attendant_id) DO UPDATE SET
         cash_actual=$5, remarks=$9, reconciled_at=NOW(), manager_confirmed=FALSE
       RETURNING *`,
      [shift_id, attendant_id, t.total_sales, t.cash_expected, cash_actual,
       t.upi_total, t.credit_total, t.card_total, remarks||null]
    );

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

module.exports = router;
