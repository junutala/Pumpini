// src/routes/receipts.js — Corporate payment receipts
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireCorporateAccess } = require('../middleware/stationAccess');

// GET /api/receipts?station_id=&corporate_id=&limit=
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, corporate_id, limit = 50 } = req.query;
    let q = `
      SELECT r.*,
        ca.company_name, ca.contact_phone,
        u.name AS recorded_by_name,
        gi.invoice_number
      FROM corporate_receipts r
      JOIN corporate_accounts ca ON ca.id = r.corporate_id
      LEFT JOIN users u ON u.id = r.recorded_by
      LEFT JOIN gst_invoices gi ON gi.id = r.invoice_id
      WHERE 1=1
    `;
    const p = [];
    if (station_id)   { p.push(station_id);   q += ` AND r.station_id=$${p.length}`; }
    if (corporate_id) { p.push(corporate_id); q += ` AND r.corporate_id=$${p.length}`; }
    q += ` ORDER BY r.created_at DESC LIMIT $${p.length + 1}`;
    p.push(limit);
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/receipts — record a receipt, reduce outstanding
router.post('/', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  const {
    corporate_id, station_id, receipt_date, amount,
    payment_type, reference_no, invoice_id, remarks,
  } = req.body;

  if (!corporate_id) return res.status(400).json({ error: 'corporate_id is required' });
  if (!station_id)   return res.status(400).json({ error: 'station_id is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });
  if (!['cash','cheque','rtgs','upi'].includes(payment_type))
    return res.status(400).json({ error: 'Invalid payment_type' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert receipt
    const { rows } = await client.query(
      `INSERT INTO corporate_receipts
         (corporate_id, station_id, receipt_date, amount, payment_type,
          reference_no, invoice_id, remarks, recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [corporate_id, station_id,
       receipt_date || new Date().toISOString().slice(0,10),
       amount, payment_type, reference_no||null,
       invoice_id||null, remarks||null, req.user.id]
    );

    // If linked to invoice, mark it as paid (or partially paid)
    if (invoice_id) {
      await client.query(
        `UPDATE gst_invoices SET
           amount_received = COALESCE(amount_received,0) + $1,
           status = CASE
             WHEN COALESCE(amount_received,0) + $1 >= total_amount THEN 'paid'
             ELSE 'partial'
           END
         WHERE id = $2`,
        [amount, invoice_id]
      );
    }

    await client.query('COMMIT');

    // Return receipt with company name
    const { rows: full } = await pool.query(
      `SELECT r.*, ca.company_name, u.name AS recorded_by_name
       FROM corporate_receipts r
       JOIN corporate_accounts ca ON ca.id = r.corporate_id
       LEFT JOIN users u ON u.id = r.recorded_by
       WHERE r.id = $1`, [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/receipts/summary/:corporate_id — outstanding calc with receipts deducted
router.get('/summary/:corporate_id', authenticate, requireCorporateAccess('corporate_id'), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { corporate_id } = req.params;
    const p = [corporate_id];

    // Total credit sales
    let salesQ = `SELECT COALESCE(SUM(amount),0) AS total_sales
      FROM dispense_events
      WHERE corporate_id=$1 AND payment_mode='credit'`;
    if (station_id) { p.push(station_id); salesQ += ` AND station_id=$${p.length}`; }

    // Total receipts
    let recQ = `SELECT COALESCE(SUM(amount),0) AS total_receipts
      FROM corporate_receipts WHERE corporate_id=$1`;
    if (station_id) recQ += ` AND station_id=$${p.length}`;

    const [{ rows: s }, { rows: r }, { rows: link }] = await Promise.all([
      pool.query(salesQ, p),
      pool.query(recQ, p),
      pool.query(
        `SELECT credit_limit FROM corporate_station_links
         WHERE corporate_id=$1${station_id ? ' AND station_id=$2' : ''} LIMIT 1`,
        station_id ? [corporate_id, station_id] : [corporate_id]
      ),
    ]);

    const total_sales    = parseFloat(s[0].total_sales);
    const total_receipts = parseFloat(r[0].total_receipts);
    const outstanding    = Math.max(0, total_sales - total_receipts);
    const credit_limit   = parseFloat(link[0]?.credit_limit || 0);
    const available      = Math.max(0, credit_limit - outstanding);

    res.json({ total_sales, total_receipts, outstanding, credit_limit, available });
  } catch (err) { next(err); }
});

module.exports = router;
