// src/routes/reconcile.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { sendAlert }  = require('../services/alertService');

// POST /api/reconcile  (attendant submits blind drop)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { shift_id, attendant_id, cash_actual, remarks } = req.body;

    // Compute totals from dispense events
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(amount),0)                                   AS total_sales,
        COALESCE(SUM(CASE WHEN payment_mode='cash'  THEN amount ELSE 0 END),0) AS cash_expected,
        COALESCE(SUM(CASE WHEN payment_mode='upi'   THEN amount ELSE 0 END),0) AS upi_total,
        COALESCE(SUM(CASE WHEN payment_mode='credit'THEN amount ELSE 0 END),0) AS credit_total,
        COALESCE(SUM(CASE WHEN payment_mode='card'  THEN amount ELSE 0 END),0) AS card_total
      FROM dispense_events
      WHERE shift_id=$1 AND attendant_id=$2`,
      [shift_id, attendant_id]
    );

    const t = totals[0];
    const variance = parseFloat(cash_actual) - parseFloat(t.cash_expected);

    const { rows } = await pool.query(
      `INSERT INTO shift_reconciliation(
         shift_id, attendant_id, total_sales, cash_expected, cash_actual,
         upi_total, credit_total, card_total, remarks
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(shift_id) DO UPDATE SET
         cash_actual=$5, remarks=$9, reconciled_at=NOW()
       RETURNING *`,
      [shift_id, attendant_id, t.total_sales, t.cash_expected, cash_actual,
       t.upi_total, t.credit_total, t.card_total, remarks || null]
    );

    const reco = rows[0];

    // Alert if variance exceeds ₹50
    const THRESHOLD = 50;
    if (Math.abs(variance) > THRESHOLD) {
      const { rows: shiftRows } = await pool.query(
        `SELECT s.station_id, sh.name AS attendant_name FROM shift_attendants s
         JOIN users sh ON sh.id = s.attendant_id
         WHERE s.shift_id=$1 AND s.attendant_id=$2`, [shift_id, attendant_id]
      );
      if (shiftRows.length) {
        const { station_id, attendant_name } = shiftRows[0];
        await sendAlert({
          station_id,
          alert_type: 'cash_variance',
          severity: Math.abs(variance) > 500 ? 'critical' : 'warning',
          message: `Cash variance ₹${Math.abs(variance).toFixed(2)} detected for ${attendant_name} in shift ${shift_id}. Expected: ₹${t.cash_expected}, Received: ₹${cash_actual}`,
          channels: ['whatsapp', 'sms'],
          io: req.io,
        });
        await pool.query('UPDATE shift_reconciliation SET alert_sent=TRUE WHERE id=$1', [reco.id]);
      }
    }

    res.status(201).json({ ...reco, variance });
  } catch (err) { next(err); }
});

// GET /api/reconcile/:shift_id
router.get('/:shift_id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, u.name AS attendant_name
      FROM shift_reconciliation r
      JOIN users u ON u.id = r.attendant_id
      WHERE r.shift_id = $1`, [req.params.shift_id]);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
