// src/routes/invoices.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
const { requireStationAccess } = require('../middleware/stationAccess');

// POST /api/invoices — save invoice
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('invoice.generate'), async (req, res, next) => {
  try {
    const {
      station_id, corporate_id, invoice_number, invoice_date,
      period_from, period_to, subtotal, cgst_rate, sgst_rate,
      cgst_amount, sgst_amount, total_amount, line_items,
      is_opening_balance,   // pre-go-live balance: create the receivable but DON'T draw down the control total
    } = req.body;

    // One transaction for invoice + line-item marking + sequence bump. The old
    // ON CONFLICT(invoice_number) upsert could silently OVERWRITE another
    // station's invoice on a number collision — now a cross-station collision
    // is a 409, and a same-station resend is an idempotent update.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: existing } = await client.query(
        'SELECT id, station_id FROM gst_invoices WHERE invoice_number=$1 FOR UPDATE',
        [invoice_number]
      );
      if (existing.length && existing[0].station_id !== station_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Invoice number ${invoice_number} is already in use.` });
      }

      let invoice;
      if (existing.length) {
        const { rows } = await client.query(
          `UPDATE gst_invoices SET total_amount=$1, line_items=$2 WHERE id=$3 RETURNING *`,
          [total_amount, JSON.stringify(line_items), existing[0].id]
        );
        invoice = rows[0];
      } else {
        const { rows } = await client.query(
          `INSERT INTO gst_invoices(
             station_id, corporate_id, invoice_number, invoice_date,
             period_from, period_to, subtotal, cgst_rate, sgst_rate,
             cgst_amount, sgst_amount, total_amount, line_items, created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [station_id, corporate_id, invoice_number, invoice_date,
           period_from, period_to, subtotal, cgst_rate, sgst_rate,
           cgst_amount, sgst_amount, total_amount,
           JSON.stringify(line_items), req.user.id]
        );
        invoice = rows[0];
      }

      // Mark transactions as invoiced — scoped to THIS station so a crafted
      // line_items payload can't flag another outlet's sales as billed.
      if (line_items && line_items.length) {
        const ids = line_items.map(t => t.id).filter(Boolean);
        if (ids.length) {
          await client.query(
            `UPDATE dispense_events SET is_invoiced=TRUE, invoice_id=$1
             WHERE id = ANY($2::uuid[]) AND station_id=$3`,
            [invoice.id, ids, station_id]
          );
        }
      }

      await client.query(
        `UPDATE station_settings SET invoice_seq = COALESCE(invoice_seq,1)+1 WHERE station_id=$1`,
        [station_id]
      );

      await client.query('COMMIT');

      // Credit-suspense drawdown (Option A): raising a credit invoice reduces the
      // running credit-customer suspense booked at shift close. Post-commit and
      // best-effort + idempotent per invoice, so invoicing never fails on it.
      try {
        await client.query(`DELETE FROM credit_suspense_entries WHERE reference_type='credit_invoice' AND reference_id=$1`, [invoice.id]);
        if (!is_opening_balance && Number(total_amount) > 0) {
          await client.query(
            `INSERT INTO credit_suspense_entries(station_id, direction, amount, corporate_id, description, reference_type, reference_id, created_by)
             VALUES($1,'out',$2,$3,$4,'credit_invoice',$5,$6)`,
            [station_id, total_amount, corporate_id || null, `Credit invoice ${invoice_number}`, invoice.id, req.user.id]);
        }
      } catch (e) { try { require('../utils/logger').warn('Credit-suspense drawdown skipped: ' + (e.message || e)); } catch { /* noop */ } }

      res.status(201).json(invoice);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        return res.status(409).json({ error: `Invoice number ${invoice_number} is already in use.` });
      }
      throw e;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// GET /api/invoices?station_id=&corporate_id=
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
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
router.get('/saved', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
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

// GET /api/invoices/credit-pending?station_id=
// The control total: credit booked into suspense at shift close (in) minus what
// has already been invoiced to customers (out). The manager invoices customers
// until this nets to zero. No reconciliation — it simply depreciates by each
// invoice's amount.
router.get('/credit-pending', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END),0) AS booked,
         COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS invoiced,
         COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE -amount END),0) AS pending
       FROM credit_suspense_entries WHERE station_id=$1`,
      [station_id]
    );
    res.json({
      booked:   Number(rows[0].booked   || 0),
      invoiced: Number(rows[0].invoiced || 0),
      pending:  Number(rows[0].pending  || 0),
    });
  } catch (err) { next(err); }
});

module.exports = router;
