// src/routes/invoices.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

// POST /api/invoices — save invoice
router.post('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const {
      station_id, corporate_id, invoice_number, invoice_date,
      period_from, period_to, subtotal, cgst_rate, sgst_rate,
      cgst_amount, sgst_amount, total_amount, line_items
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO gst_invoices(
         station_id, corporate_id, invoice_number, invoice_date,
         period_from, period_to, subtotal, cgst_rate, sgst_rate,
         cgst_amount, sgst_amount, total_amount, line_items, created_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT(invoice_number) DO UPDATE SET
         total_amount=$12, line_items=$13
       RETURNING *`,
      [station_id, corporate_id, invoice_number, invoice_date,
       period_from, period_to, subtotal, cgst_rate, sgst_rate,
       cgst_amount, sgst_amount, total_amount,
       JSON.stringify(line_items), req.user.id]
    );

    // Mark transactions as invoiced
    if (line_items && line_items.length) {
      const ids = line_items.map(t => t.id).filter(Boolean);
      if (ids.length) {
        await pool.query(
          `UPDATE dispense_events SET is_invoiced=TRUE, invoice_id=$1 WHERE id = ANY($2::uuid[])`,
          [rows[0].id, ids]
        );
      }
    }

    // Increment invoice sequence
    await pool.query(
      `UPDATE station_settings SET invoice_seq = COALESCE(invoice_seq,1)+1 WHERE station_id=$1`,
      [station_id]
    );

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/invoices?station_id=&corporate_id=
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { station_id, corporate_id } = req.query;
    let q = `
      SELECT gi.*, ca.company_name
      FROM gst_invoices gi
      JOIN corporate_accounts ca ON ca.id = gi.corporate_id
      WHERE gi.station_id = $1
    `;
    const p = [station_id];
    if (corporate_id) { p.push(corporate_id); q += ` AND gi.corporate_id=$${p.length}`; }
    q += ' ORDER BY gi.created_at DESC';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/invoices/saved?station_id=&corporate_id=
router.get('/saved', authenticate, async (req, res, next) => {
  try {
    const { station_id, corporate_id } = req.query;
    let q = `
      SELECT gi.*, ca.company_name, ca.contact_phone,
        u.name AS created_by_name
      FROM gst_invoices gi
      JOIN corporate_accounts ca ON ca.id = gi.corporate_id
      LEFT JOIN users u ON u.id = gi.created_by
      WHERE gi.station_id = $1
    `;
    const p = [station_id];
    if (corporate_id) { p.push(corporate_id); q += ` AND gi.corporate_id=$${p.length}`; }
    q += ' ORDER BY gi.created_at DESC LIMIT 50';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
