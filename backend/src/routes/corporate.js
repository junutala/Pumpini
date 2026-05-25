// src/routes/corporate.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/corporate
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT *, (credit_limit - current_outstanding) AS available_credit
       FROM corporate_accounts WHERE is_active=TRUE ORDER BY company_name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/corporate
router.post('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { company_name, gst_number, contact_person, contact_phone, contact_email, credit_limit, billing_cycle } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO corporate_accounts(company_name,gst_number,contact_person,contact_phone,contact_email,credit_limit,billing_cycle)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [company_name, gst_number, contact_person, contact_phone, contact_email, credit_limit || 0, billing_cycle || 'monthly']
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/corporate/:id/drivers
router.get('/:id/drivers', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM corporate_drivers WHERE corporate_id=$1 AND is_active=TRUE ORDER BY name',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/corporate/:id/drivers
router.post('/:id/drivers', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { name, phone, vehicle_number, fasttag_id, biometric_ref, per_fill_limit } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO corporate_drivers(corporate_id,name,phone,vehicle_number,fasttag_id,biometric_ref,per_fill_limit)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, name, phone, vehicle_number, fasttag_id, biometric_ref, per_fill_limit]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/corporate/verify-biometric  (called at nozzle terminal)
router.post('/verify-biometric', authenticate, async (req, res, next) => {
  try {
    const { biometric_ref, requested_amount } = req.body;

    const { rows: drivers } = await pool.query(
      `SELECT cd.*, ca.company_name, ca.credit_limit, ca.current_outstanding,
              (ca.credit_limit - ca.current_outstanding) AS available_credit
       FROM corporate_drivers cd
       JOIN corporate_accounts ca ON ca.id = cd.corporate_id
       WHERE cd.biometric_ref=$1 AND cd.is_active=TRUE AND ca.is_active=TRUE`,
      [biometric_ref]
    );

    if (!drivers.length) return res.status(404).json({ error: 'Driver not found or not active' });

    const driver = drivers[0];
    const available = parseFloat(driver.available_credit);
    const requested = parseFloat(requested_amount);

    if (requested > available) {
      return res.status(402).json({
        error: 'Credit limit exceeded',
        available_credit: available,
        requested: requested,
      });
    }

    if (driver.per_fill_limit && requested > parseFloat(driver.per_fill_limit)) {
      return res.status(402).json({
        error: `Exceeds per-fill limit of ₹${driver.per_fill_limit}`,
        per_fill_limit: driver.per_fill_limit,
      });
    }

    res.json({
      verified: true,
      driver_id: driver.id,
      driver_name: driver.name,
      vehicle_number: driver.vehicle_number,
      company_name: driver.company_name,
      available_credit: available,
    });
  } catch (err) { next(err); }
});

// POST /api/corporate/transaction
router.post('/transaction', authenticate, async (req, res, next) => {
  try {
    const { dispense_event_id, corporate_id, driver_id, amount, plate_photo_url, fasttag_read } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: acc } = await client.query(
        'SELECT current_outstanding FROM corporate_accounts WHERE id=$1 FOR UPDATE',
        [corporate_id]
      );
      const credit_before = parseFloat(acc[0].current_outstanding);
      const credit_after  = credit_before + parseFloat(amount);

      await client.query(
        'UPDATE corporate_accounts SET current_outstanding=$1 WHERE id=$2',
        [credit_after, corporate_id]
      );

      const { rows } = await client.query(
        `INSERT INTO corporate_transactions(dispense_event_id,corporate_id,driver_id,amount,credit_before,credit_after,plate_photo_url,fasttag_read)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [dispense_event_id, corporate_id, driver_id, amount, credit_before, credit_after, plate_photo_url, fasttag_read]
      );

      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// GET /api/corporate/:id/statement?month=YYYY-MM
router.get('/:id/statement', authenticate, async (req, res, next) => {
  try {
    const { month } = req.query;
    const start = month ? `${month}-01` : new Date(new Date().setDate(1)).toISOString().slice(0,10);
    const end   = month ? new Date(new Date(start).setMonth(new Date(start).getMonth()+1)).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);

    const { rows } = await pool.query(`
      SELECT ct.*, cd.name AS driver_name, cd.vehicle_number,
             de.quantity_ltrs, de.fuel_type, de.occurred_at, de.rate_per_ltr
      FROM corporate_transactions ct
      JOIN corporate_drivers cd ON cd.id = ct.driver_id
      JOIN dispense_events de ON de.id = ct.dispense_event_id
      WHERE ct.corporate_id=$1 AND de.occurred_at BETWEEN $2 AND $3
      ORDER BY de.occurred_at`, [req.params.id, start, end]);

    const total = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    res.json({ transactions: rows, total_amount: total, period: { start, end } });
  } catch (err) { next(err); }
});

module.exports = router;
