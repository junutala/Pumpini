// src/routes/productReturns.js — lube/product returns = GST credit notes.
// A return is ALWAYS against an original invoice, at the invoice price (GST is
// reversed exactly as charged). Cash-customer returns are paid from petty cash;
// credit-customer returns are a book entry that reduces outstanding. Neither
// touches the attendant / blind-drop path. Manager/owner only.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');

async function nextCnNumber(client, stationId) {
  await client.query(
    `INSERT INTO product_cn_seq(station_id, last_seq) VALUES($1, 0) ON CONFLICT(station_id) DO NOTHING`,
    [stationId]
  );
  const { rows } = await client.query(
    `UPDATE product_cn_seq SET last_seq = last_seq + 1 WHERE station_id = $1 RETURNING last_seq`,
    [stationId]
  );
  const seq  = String(rows[0].last_seq).padStart(4, '0');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `LUB-CN-${date}-${seq}`;
}

// GET /eligible?station_id=&customer_type=&customer_id=
// Original invoices still within the return-policy window for the chosen party.
router.get('/eligible', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, customer_type = 'cash', customer_id } = req.query;
    const { rows: setRows } = await pool.query(
      'SELECT return_policy_days FROM station_settings WHERE station_id=$1', [station_id]
    );
    const days = setRows[0]?.return_policy_days ?? 30;
    const p = [station_id, days];
    let q = `
      SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.created_at,
             pi.grand_total, pi.customer_name, pi.customer_type
      FROM product_invoices pi
      WHERE pi.station_id = $1
        AND pi.created_at >= NOW() - ($2 || ' days')::interval `;
    if (customer_type === 'credit') {
      p.push(customer_id);
      q += ` AND pi.customer_type='credit' AND pi.customer_id = $${p.length} `;
    } else {
      q += ` AND pi.customer_type = 'cash' `;
    }
    q += ` ORDER BY pi.created_at DESC LIMIT 100`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /invoice/:id/returnable — invoice lines with remaining returnable qty
router.get('/invoice/:id/returnable', authenticate,
  requireStationVia('SELECT station_id FROM product_invoices WHERE id=$1', 'id'),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT pii.*,
          COALESCE((SELECT SUM(q.quantity) FROM product_credit_note_items q
                    WHERE q.invoice_item_id = pii.id), 0) AS already_returned
        FROM product_invoice_items pii
        WHERE pii.invoice_id = $1 ORDER BY pii.id`, [req.params.id]);
      res.json(rows.map(r => ({
        ...r,
        returnable: Math.max(0, parseFloat(r.quantity) - parseFloat(r.already_returned)),
      })));
    } catch (err) { next(err); }
  });

// POST / — create a credit note
router.post('/', authenticate, authorize('owner', 'manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  const { station_id, customer_name, invoice_id, invoice_number, reason, items } = req.body;
  if (!invoice_id)            return res.status(400).json({ error: 'Original invoice is required' });
  if (!items || !items.length) return res.status(400).json({ error: 'No items to return' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: inv } = await client.query(
      'SELECT id, station_id, customer_type, customer_id FROM product_invoices WHERE id=$1', [invoice_id]
    );
    if (!inv.length || inv[0].station_id !== station_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice not found for this station' });
    }

    let subtotal = 0, total_cgst = 0, total_sgst = 0, grand_total = 0;
    const lines = [];
    for (const it of items) {
      const qty = parseFloat(it.quantity);
      if (!qty || qty <= 0) continue;
      const { rows: pii } = await client.query(`
        SELECT pii.*,
          COALESCE((SELECT SUM(q.quantity) FROM product_credit_note_items q WHERE q.invoice_item_id = pii.id), 0) AS already_returned
        FROM product_invoice_items pii WHERE pii.id=$1 AND pii.invoice_id=$2`,
        [it.invoice_item_id, invoice_id]);
      if (!pii.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid invoice line' }); }
      const line = pii[0];
      const remaining = parseFloat(line.quantity) - parseFloat(line.already_returned);
      if (qty > remaining + 1e-9) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Cannot return ${qty} of ${line.product_name} — only ${remaining} returnable against this invoice.` });
      }
      // Reverse at the INVOICE price/rate (GST-correct)
      const unit_price = parseFloat(line.unit_price);
      const gst_rate   = parseFloat(line.gst_rate);
      const taxable = +(qty * unit_price).toFixed(2);
      const cgst    = +(taxable * gst_rate / 200).toFixed(2);
      const sgst    = +(taxable * gst_rate / 200).toFixed(2);
      const total   = +(taxable + cgst + sgst).toFixed(2);
      subtotal += taxable; total_cgst += cgst; total_sgst += sgst; grand_total += total;
      lines.push({ invoice_item_id: line.id, product_id: line.product_id, product_name: line.product_name,
        hsn_code: line.hsn_code, unit: line.unit, quantity: qty, unit_price, gst_rate,
        taxable_amount: taxable, cgst_amount: cgst, sgst_amount: sgst, total_amount: total });
    }
    if (!lines.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No valid return quantities' }); }

    const settlement = inv[0].customer_type === 'credit' ? 'outstanding' : 'petty_cash';
    const cn_number  = await nextCnNumber(client, station_id);

    const { rows: cnRows } = await client.query(
      `INSERT INTO product_credit_notes
         (station_id, cn_number, customer_type, customer_id, customer_name,
          original_invoice_id, original_invoice_number, reason,
          subtotal, total_cgst, total_sgst, grand_total, settlement, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [station_id, cn_number, inv[0].customer_type, inv[0].customer_id || null,
       customer_name || 'Cash Customer', invoice_id, invoice_number || null, reason || null,
       subtotal.toFixed(2), total_cgst.toFixed(2), total_sgst.toFixed(2), grand_total.toFixed(2),
       settlement, req.user.id]
    );
    const cn = cnRows[0];

    for (const l of lines) {
      await client.query(
        `INSERT INTO product_credit_note_items
           (credit_note_id, invoice_item_id, product_id, product_name, hsn_code, unit,
            quantity, unit_price, gst_rate, taxable_amount, cgst_amount, sgst_amount, total_amount)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [cn.id, l.invoice_item_id, l.product_id, l.product_name, l.hsn_code, l.unit,
         l.quantity, l.unit_price, l.gst_rate, l.taxable_amount, l.cgst_amount, l.sgst_amount, l.total_amount]
      );
      await client.query(`UPDATE products SET current_stock = current_stock + $1, updated_at=NOW() WHERE id=$2`,
        [l.quantity, l.product_id]);
    }

    // Credit customer → reduce outstanding (may go negative = advance). Cash → petty cash, no balance change.
    if (settlement === 'outstanding' && inv[0].customer_id) {
      await client.query(
        `UPDATE corporate_accounts SET current_outstanding = current_outstanding - $1 WHERE id=$2`,
        [grand_total.toFixed(2), inv[0].customer_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...cn, items: lines });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// GET /?station_id= — list credit notes
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT cn.*, u.name AS created_by_name
      FROM product_credit_notes cn
      LEFT JOIN users u ON u.id = cn.created_by
      WHERE cn.station_id = $1 ORDER BY cn.created_at DESC LIMIT 100`, [req.query.station_id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /:id — full credit note
router.get('/:id', authenticate,
  requireStationVia('SELECT station_id FROM product_credit_notes WHERE id=$1', 'id'),
  async (req, res, next) => {
    try {
      const [cn, items] = await Promise.all([
        pool.query(`
          SELECT cn.*, s.name AS station_name, s.address, s.city, s.state,
                 ss.gstn, u.name AS created_by_name
          FROM product_credit_notes cn
          JOIN stations s ON s.id = cn.station_id
          LEFT JOIN station_settings ss ON ss.station_id = cn.station_id
          LEFT JOIN users u ON u.id = cn.created_by
          WHERE cn.id = $1`, [req.params.id]),
        pool.query('SELECT * FROM product_credit_note_items WHERE credit_note_id=$1 ORDER BY id', [req.params.id]),
      ]);
      if (!cn.rows.length) return res.status(404).json({ error: 'Credit note not found' });
      res.json({ ...cn.rows[0], items: items.rows });
    } catch (err) { next(err); }
  });

module.exports = router;
