// src/routes/productReturns.js — lube/product returns = GST credit notes.
// A return is ALWAYS against an original invoice, at the invoice price (GST is
// reversed exactly as charged). Cash-customer returns are paid from petty cash;
// credit-customer returns are a book entry that reduces outstanding. Neither
// touches the attendant / blind-drop path. Manager/owner only.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const { addEntry } = require('./pettyCash');

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

// ── PETROL/DIESEL credit notes (against gst_invoices, not product invoices) ──
// A credit customer's "open invoices" are their petrol/diesel credit invoices.
// A credit note here is an AMOUNT adjustment (no product lines) that reduces the
// customer's outstanding, recorded as a corporate_receipts row of payment_type
// 'credit_note' (counts in invoices−receipts, excluded from cash/deposit reports).

// GET /credit-invoices?station_id=&customer_id= — open petrol credit invoices
router.get('/credit-invoices', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, customer_id } = req.query;
    if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });
    const { rows } = await pool.query(`
      SELECT gi.id, gi.invoice_number, gi.invoice_date, gi.total_amount,
             gi.total_amount - COALESCE((SELECT SUM(cr.amount) FROM corporate_receipts cr
                                         WHERE cr.invoice_id = gi.id),0) AS outstanding
      FROM gst_invoices gi
      WHERE gi.station_id = $1 AND gi.corporate_id = $2
      ORDER BY gi.invoice_date DESC, gi.created_at DESC`,
      [station_id, customer_id]);
    res.json(rows.filter(r => Number(r.outstanding) > 0.009));
  } catch (err) { next(err); }
});

// POST /credit-adjustment — issue a credit note against a petrol credit invoice.
// Reduces the customer's outstanding; optionally also draws down the station credit
// suspense (control total) when reduce_suspense is set (mirrors the opening-balance flag).
router.post('/credit-adjustment', authenticate, authorize('owner', 'manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  const { station_id, corporate_id, invoice_id, amount, reason, reduce_suspense } = req.body;
  const amt = parseFloat(amount);
  if (!corporate_id || !invoice_id) return res.status(400).json({ error: 'Customer and invoice are required' });
  if (!amt || amt <= 0)             return res.status(400).json({ error: 'Enter a credit note amount greater than zero' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: inv } = await client.query(`
      SELECT gi.id, gi.invoice_number,
             gi.total_amount - COALESCE((SELECT SUM(cr.amount) FROM corporate_receipts cr
                                         WHERE cr.invoice_id = gi.id),0) AS outstanding
      FROM gst_invoices gi
      WHERE gi.id = $1 AND gi.station_id = $2 AND gi.corporate_id = $3`,
      [invoice_id, station_id, corporate_id]);
    if (!inv.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invoice not found for this customer/station' }); }
    const outstanding = Number(inv[0].outstanding);
    if (amt > outstanding + 1e-6) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Credit note (₹${amt.toFixed(2)}) exceeds the invoice outstanding (₹${outstanding.toFixed(2)}).` });
    }
    const note = ('Credit note vs ' + (inv[0].invoice_number || '') + (reason ? ' — ' + reason : '')).slice(0, 250);
    const { rows: rc } = await client.query(`
      INSERT INTO corporate_receipts(corporate_id, station_id, receipt_date, amount, payment_type, invoice_id, remarks, recorded_by)
      VALUES($1,$2,CURRENT_DATE,$3,'credit_note',$4,$5,$6) RETURNING id`,
      [corporate_id, station_id, amt.toFixed(2), invoice_id, note, req.user.id]);
    if (reduce_suspense) {
      // A credit note REVERSES the invoice. Raising the invoice posted 'out'
      // (drew the control total down), so the credit note posts 'in' — it ADDS
      // the amount back to the control total (e.g. correcting an over-invoice).
      await client.query(`
        INSERT INTO credit_suspense_entries(station_id, direction, amount, corporate_id, description, reference_type, reference_id, created_by)
        VALUES($1,'in',$2,$3,$4,'credit_note',$5,$6)`,
        [station_id, amt.toFixed(2), corporate_id, ('Credit note vs ' + (inv[0].invoice_number || '') + ' — added back to control total').slice(0, 250), rc[0].id, req.user.id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: rc[0].id, amount: amt, invoice_number: inv[0].invoice_number, reduce_suspense: !!reduce_suspense });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
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
      'SELECT id, station_id, customer_type, customer_id, location FROM product_invoices WHERE id=$1', [invoice_id]
    );
    if (!inv.length || inv[0].station_id !== station_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice not found for this station' });
    }
    // Returned stock goes back to the SAME location it was sold from.
    const retLoc = inv[0].location === 'bay' ? 'bay_stock' : 'shop_stock';

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
      await client.query(`UPDATE products SET current_stock = current_stock + $1,
          ${retLoc} = COALESCE(${retLoc},0) + $1, updated_at=NOW() WHERE id=$2`,
        [l.quantity, l.product_id]);
    }

    // Credit customer → reduce outstanding (may go negative = advance).
    // Cash customer → pay out of the manager's petty cash and DEBIT the float
    // ledger in the same transaction so the cash refund is auditable.
    if (settlement === 'outstanding' && inv[0].customer_id) {
      await client.query(
        `UPDATE corporate_accounts SET current_outstanding = current_outstanding - $1 WHERE id=$2`,
        [grand_total.toFixed(2), inv[0].customer_id]
      );
    } else if (settlement === 'petty_cash') {
      await addEntry(client, {
        station_id, direction: 'out', amount: grand_total,
        entry_type: 'refund',
        description: `Cash refund — credit note ${cn_number}`,
        reference_type: 'product_credit_note', reference_id: cn.id,
        created_by: req.user.id,
      });
    }

    await client.query('COMMIT');
    res.status(201).json({ ...cn, items: lines });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// GET /?station_id= — list credit notes
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    // Product returns (product_credit_notes) AND petrol/diesel credit notes
    // (corporate_receipts of type credit_note) share this grid.
    const { rows } = await pool.query(`
      SELECT cn.id, cn.cn_number, cn.created_at, cn.customer_name,
             cn.original_invoice_number, cn.settlement, cn.grand_total,
             u.name AS created_by_name, 'product' AS kind
      FROM product_credit_notes cn
      LEFT JOIN users u ON u.id = cn.created_by
      WHERE cn.station_id = $1
      UNION ALL
      SELECT cr.id,
             'CN/' || upper(substr(cr.id::text, 1, 8)) AS cn_number,
             cr.created_at,
             COALESCE(ca.company_name, 'Credit customer') AS customer_name,
             gi.invoice_number AS original_invoice_number,
             'outstanding' AS settlement,
             cr.amount AS grand_total,
             u2.name AS created_by_name, 'credit_invoice' AS kind
      FROM corporate_receipts cr
      LEFT JOIN corporate_accounts ca ON ca.id = cr.corporate_id
      LEFT JOIN gst_invoices gi ON gi.id = cr.invoice_id
      LEFT JOIN users u2 ON u2.id = cr.recorded_by
      WHERE cr.station_id = $1 AND cr.payment_type = 'credit_note'
      ORDER BY created_at DESC LIMIT 100`, [req.query.station_id]);
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
