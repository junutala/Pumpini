// backend/src/routes/products.js
// Products sub-module — catalogue, stock, sales, invoices

const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');

// ── Helper: next invoice number ───────────────────────────
async function nextInvoiceNumber(stationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO product_invoice_seq(station_id, last_seq)
       VALUES($1, 0) ON CONFLICT(station_id) DO NOTHING`,
      [stationId]
    );
    const { rows } = await client.query(
      `UPDATE product_invoice_seq SET last_seq = last_seq + 1
       WHERE station_id = $1 RETURNING last_seq`,
      [stationId]
    );
    await client.query('COMMIT');
    const seq = String(rows[0].last_seq).padStart(4, '0');
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
    return `LUB-${date}-${seq}`;
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── CATALOGUE ─────────────────────────────────────────────

// GET /api/products/catalogue?station_id=
router.get('/catalogue', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM products
       WHERE station_id=$1 AND is_active=TRUE
       ORDER BY name`,
      [station_id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// GET /api/products/barcode/:code?station_id=
router.get('/barcode/:code', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM products
       WHERE station_id=$1 AND barcode=$2 AND is_active=TRUE`,
      [station_id, req.params.code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// POST /api/products/catalogue
router.post('/catalogue', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, name, brand, barcode, hsn_code, unit='piece',
            selling_price, buying_price=0, gst_rate=18, min_stock_level=5 } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO products
         (station_id,name,brand,barcode,hsn_code,unit,selling_price,
          buying_price,gst_rate,min_stock_level)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [station_id, name, brand||null, barcode||null, hsn_code||null,
       unit, selling_price, buying_price, gst_rate, min_stock_level]
    );
    // require_barcode set separately + guarded so it can't break create
    // before the column migration is applied.
    if (req.body.require_barcode !== undefined) {
      const rb = req.body.require_barcode === true || req.body.require_barcode === 'true';
      try {
        await pool.query('UPDATE products SET require_barcode=$1 WHERE id=$2', [rb, rows[0].id]);
        rows[0].require_barcode = rb;
      } catch { /* require_barcode column not migrated yet */ }
    }
    res.status(201).json(rows[0]);
  } catch(err) {
    if (err.code==='23505') return res.status(409).json({ error:'Barcode already exists for this station' });
    next(err);
  }
});

// PATCH /api/products/catalogue/:id
router.patch('/catalogue/:id', authenticate, requireStationVia('SELECT station_id FROM products WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { name, brand, barcode, hsn_code, unit, selling_price,
            buying_price, gst_rate, min_stock_level, is_active } = req.body;
    // require_barcode handled separately + guarded (column may not be migrated)
    if (req.body.require_barcode !== undefined) {
      const rb = req.body.require_barcode === true || req.body.require_barcode === 'true';
      try { await pool.query('UPDATE products SET require_barcode=$1 WHERE id=$2', [rb, req.params.id]); } catch {}
    }
    const sets=[]; const p=[];
    const add = (col, val) => { if(val!==undefined){ p.push(val); sets.push(`${col}=$${p.length}`); } };
    add('name', name); add('brand', brand); add('barcode', barcode);
    add('hsn_code', hsn_code); add('unit', unit);
    add('selling_price', selling_price); add('buying_price', buying_price);
    add('gst_rate', gst_rate); add('min_stock_level', min_stock_level);
    add('is_active', is_active);
    if (!sets.length) return res.json({ ok:true });
    p.push(new Date()); sets.push(`updated_at=$${p.length}`);
    p.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(',')} WHERE id=$${p.length} RETURNING *`, p
    );
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// DELETE /api/products/catalogue/:id (soft delete)
router.delete('/catalogue/:id', authenticate, requireStationVia('SELECT station_id FROM products WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    await pool.query('UPDATE products SET is_active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(err) { next(err); }
});

// ── STOCK RECEIPTS ────────────────────────────────────────

// GET /api/products/stock?station_id=
router.get('/stock', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(
      `SELECT sr.*, p.name AS product_name, p.unit, p.current_stock
       FROM product_stock_receipts sr
       JOIN products p ON p.id = sr.product_id
       WHERE sr.station_id=$1
       ORDER BY sr.received_at DESC LIMIT 100`,
      [station_id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// POST /api/products/stock — receive stock
router.post('/stock', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, product_id, quantity, buying_price, selling_price, notes } = req.body;

    // Enforce: a require-barcode product must have a barcode tied before receiving
    const { rows: pr } = await pool.query(
      'SELECT require_barcode, barcode FROM products WHERE id=$1', [product_id]
    );
    if (pr.length && pr[0].require_barcode && !pr[0].barcode) {
      return res.status(400).json({ error: 'Assign a barcode to this product before receiving stock.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Insert receipt
      const { rows } = await client.query(
        `INSERT INTO product_stock_receipts
           (station_id, product_id, quantity, buying_price, selling_price, notes, received_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [station_id, product_id, quantity, buying_price||null, selling_price||null,
         notes||null, req.user.id]
      );
      // Update stock level
      await client.query(
        `UPDATE products SET
           current_stock = current_stock + $1,
           buying_price  = COALESCE($2, buying_price),
           selling_price = COALESCE($3, selling_price),
           updated_at    = NOW()
         WHERE id=$4`,
        [quantity, buying_price||null, selling_price||null, product_id]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch(err) { next(err); }
});

// ── SALES / INVOICES ──────────────────────────────────────

// GET /api/products/invoices?station_id=&from=&to=
router.get('/invoices', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, from, to } = req.query;
    let q = `
      SELECT pi.*,
        COUNT(pii.id) AS item_count,
        u.name AS created_by_name
      FROM product_invoices pi
      LEFT JOIN product_invoice_items pii ON pii.invoice_id = pi.id
      LEFT JOIN users u ON u.id = pi.created_by
      WHERE pi.station_id=$1`;
    const p = [station_id];
    if (from) { p.push(from); q += ` AND pi.invoice_date >= $${p.length}`; }
    if (to)   { p.push(to);   q += ` AND pi.invoice_date <= $${p.length}`; }
    q += ' GROUP BY pi.id, u.name ORDER BY pi.created_at DESC LIMIT 100';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch(err) { next(err); }
});

// GET /api/products/invoices/:id — full invoice with items
router.get('/invoices/:id', authenticate, requireStationVia('SELECT station_id FROM product_invoices WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const [inv, items] = await Promise.all([
      pool.query(`
        SELECT pi.*, s.name AS station_name, s.address, s.city, s.state,
          ss.gstn, ss.owner_whatsapp,
          u.name AS created_by_name
        FROM product_invoices pi
        JOIN stations s ON s.id = pi.station_id
        LEFT JOIN station_settings ss ON ss.station_id = pi.station_id
        LEFT JOIN users u ON u.id = pi.created_by
        WHERE pi.id=$1`, [req.params.id]),
      pool.query(
        'SELECT * FROM product_invoice_items WHERE invoice_id=$1 ORDER BY id',
        [req.params.id]
      )
    ]);
    if (!inv.rows.length) return res.status(404).json({ error:'Invoice not found' });
    res.json({ ...inv.rows[0], items: items.rows });
  } catch(err) { next(err); }
});

// POST /api/products/invoices — create sale + invoice
router.post('/invoices', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, customer_type='cash', customer_id, customer_name,
            customer_gstn, payment_mode='cash', items, notes } = req.body;

    if (!items || !items.length) return res.status(400).json({ error:'No items provided' });

    // Enforce: a require-barcode product must have a barcode tied before selling
    const pids = items.map(i => i.product_id).filter(Boolean);
    if (pids.length) {
      const { rows: bad } = await pool.query(
        `SELECT name FROM products WHERE id = ANY($1)
           AND require_barcode = TRUE AND (barcode IS NULL OR barcode = '')`,
        [pids]
      );
      if (bad.length) {
        return res.status(400).json({ error: `Tie a barcode before selling: ${bad.map(b => b.name).join(', ')}` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Calculate totals
      let subtotal=0, total_cgst=0, total_sgst=0, grand_total=0;
      const processedItems = items.map(item => {
        const taxable  = parseFloat(item.quantity) * parseFloat(item.unit_price);
        const gstRate  = parseFloat(item.gst_rate || 18);
        const cgst     = parseFloat((taxable * gstRate / 200).toFixed(2));
        const sgst     = parseFloat((taxable * gstRate / 200).toFixed(2));
        const total    = parseFloat((taxable + cgst + sgst).toFixed(2));
        subtotal    += taxable;
        total_cgst  += cgst;
        total_sgst  += sgst;
        grand_total += total;
        return { ...item, taxable_amount:taxable, cgst_amount:cgst, sgst_amount:sgst, total_amount:total };
      });

      // Generate invoice number
      const invoice_number = await nextInvoiceNumber(station_id);

      // Insert invoice header
      const { rows: invRows } = await client.query(
        `INSERT INTO product_invoices
           (station_id, invoice_number, customer_type, customer_id, customer_name,
            customer_gstn, payment_mode, subtotal, total_cgst, total_sgst,
            grand_total, notes, created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [station_id, invoice_number, customer_type, customer_id||null,
         customer_name||'Cash Customer', customer_gstn||null, payment_mode,
         subtotal.toFixed(2), total_cgst.toFixed(2), total_sgst.toFixed(2),
         grand_total.toFixed(2), notes||null, req.user.id]
      );
      const invoice = invRows[0];

      // Insert line items + deduct stock
      for (const item of processedItems) {
        await client.query(
          `INSERT INTO product_invoice_items
             (invoice_id, product_id, product_name, hsn_code, unit, quantity,
              unit_price, gst_rate, taxable_amount, cgst_amount, sgst_amount, total_amount)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [invoice.id, item.product_id, item.product_name, item.hsn_code||null,
           item.unit||'piece', item.quantity, item.unit_price, item.gst_rate||18,
           item.taxable_amount, item.cgst_amount, item.sgst_amount, item.total_amount]
        );
        // Deduct from stock
        await client.query(
          `UPDATE products SET current_stock = current_stock - $1, updated_at=NOW() WHERE id=$2`,
          [item.quantity, item.product_id]
        );
      }

      // If credit customer, update outstanding
      if (customer_type==='credit' && customer_id) {
        await client.query(
          `UPDATE corporate_accounts
           SET current_outstanding = current_outstanding + $1
           WHERE id=$2`,
          [grand_total.toFixed(2), customer_id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ ...invoice, items: processedItems });
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch(err) { next(err); }
});

// ── LOW STOCK CHECK ───────────────────────────────────────
// GET /api/products/low-stock?station_id=
router.get('/low-stock', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM products
       WHERE station_id=$1
         AND is_active=TRUE
         AND current_stock <= min_stock_level
       ORDER BY current_stock ASC`,
      [station_id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

module.exports = router;
