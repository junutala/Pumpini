// backend/src/routes/products.js
// Products sub-module — catalogue, stock, sales, invoices

const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const stock = require('../services/stockService');
const pricing = require('../services/productPricing');
const { mrpChanging, mrpRefusal } = require('../services/mrpGuard');

// product_invoice_items.mrp / .discount_amount — added 04-Oct-2026 for MRP-inclusive
// pricing. Probed, never try-and-caught: the INSERT runs inside the sale's own
// transaction, where a 42703 would abort the sale. Cached only once TRUE, so the
// owner running the DDL is picked up without a restart.
let _lineDiscountCols = false;
async function hasLineDiscountCols() {
  if (_lineDiscountCols) return true;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='product_invoice_items'
        AND column_name IN ('mrp','discount_amount')`);
  _lineDiscountCols = rows[0].n === 2;
  return _lineDiscountCols;
}

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
    // A new product is a new MRP — manager/owner only (services/mrpGuard).
    if (mrpChanging(null, selling_price)) {
      const no = await mrpRefusal(req, station_id);
      if (no) return res.status(403).json(no);
    }
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
    // Changing the MRP is manager/owner only (services/mrpGuard). The catalogue form
    // sends the whole product, so compare: an edit that leaves the price alone passes.
    if (selling_price !== undefined) {
      const { rows: cur } = await pool.query('SELECT selling_price FROM products WHERE id=$1', [req.params.id]);
      if (cur.length && mrpChanging(cur[0].selling_price, selling_price)) {
        const no = await mrpRefusal(req, req.stationId);
        if (no) return res.status(403).json(no);
      }
    }
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
    // Location the stock is received into. THREE now, not two — the gift store is
    // where promotional stock is parked so the counter cannot sell it out from
    // under a running campaign. Controlled map, because the value picks a COLUMN
    // NAME that is interpolated below; nothing from the body may reach that SQL.
    const LOC_COL  = { shop: 'shop_stock', bay: 'bay_stock', gift: 'gift_stock' };
    const location = LOC_COL[req.body.location] ? req.body.location : 'shop';
    if (location === 'gift' && !(await stock.hasGiftColumn())) {
      return res.status(400).json({ error: 'The gift store is not set up on this database yet.' });
    }
    const locCol = LOC_COL[location];

    // Re-scope product to the validated station: a product_id from another
    // outlet must not be receivable here even though station_id passed the guard.
    const { rows: pr } = await pool.query(
      'SELECT require_barcode, barcode, selling_price FROM products WHERE id=$1 AND station_id=$2', [product_id, station_id]
    );
    if (!pr.length) return res.status(404).json({ error: 'Product not found for this station.' });
    // Receiving stock is open; changing the MRP while doing it is manager/owner only.
    if (mrpChanging(pr[0].selling_price, selling_price, { zeroIsUnset: true })) {
      const no = await mrpRefusal(req, station_id);
      if (no) return res.status(403).json(no);
    }
    if (pr[0].require_barcode && !pr[0].barcode) {
      return res.status(400).json({ error: 'Assign a barcode to this product before receiving stock.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Insert receipt
      const { rows } = await client.query(
        `INSERT INTO product_stock_receipts
           (station_id, product_id, quantity, buying_price, selling_price, notes, received_by, location)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [station_id, product_id, quantity, buying_price||null, selling_price||null,
         notes||null, req.user.id, location]
      );
      // Update total stock + the chosen location bucket (locCol is a controlled enum)
      await client.query(
        `UPDATE products SET
           current_stock = current_stock + $1,
           ${locCol}     = COALESCE(${locCol},0) + $1,
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

// ── STOCK TRANSFERS ───────────────────────────────────────
//
// Moving stock between locations (store → forecourt, and either → the gift store).
// The writer is services/stockService — the campaign's gift issue is the same kind
// of movement and will call it too, so the arithmetic and the source guard live in
// ONE place rather than being re-implemented per caller (CLAUDE.md, one writer per
// concept).
//
// Guarded on `lubes.manage`, matching routes/productReturns.js. The older product
// routes above are gated in the sidebar only; closing that gap is its own slice.

// GET /api/products/stock-by-location?station_id=
// What is where, for the transfer screen's picker — so the manager sees the source
// balance BEFORE he types a figure rather than after it is refused.
router.get('/stock-by-location', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    res.json(await stock.stockByLocation({ station_id: req.query.station_id }));
  } catch (err) { next(err); }
});

// GET /api/products/transfers?station_id=&limit=
router.get('/transfers', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    res.json(await stock.listTransfers({ station_id: req.query.station_id, limit: req.query.limit }));
  } catch (err) { next(err); }
});

// POST /api/products/transfers — move stock between two locations.
router.post('/transfers', authenticate, requireStationAccess({ required: true }), requirePerm('lubes.manage'), async (req, res, next) => {
  try {
    const { station_id, product_id, from_location, to_location, quantity, notes } = req.body;
    const row = await stock.transfer({
      station_id, product_id, from_location, to_location, quantity, notes,
      user_id: req.user.id,
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
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
            customer_gstn, payment_mode='cash', items, notes,
            shift_id, attendant_id } = req.body;
    // Which stock bucket this sale draws from: bay sales (forecourt) vs shop POS.
    const location = req.body.location === 'bay' ? 'bay' : 'shop';
    const locCol   = location === 'bay' ? 'bay_stock' : 'shop_stock';

    if (!items || !items.length) return res.status(400).json({ error:'No items provided' });

    // EVERY LINE IS PRICED FROM THE PRODUCT ROW, not from what the screen sent. The MRP
    // is printed on the pack; the till may change the quantity and give a discount,
    // never the price. Also re-scopes every line to this station.
    const pids = items.map(i => i.product_id);
    if (pids.some(id => !id)) return res.status(400).json({ error: 'Every line needs a product from the catalogue.' });
    const { rows: prodRows } = await pool.query(
      `SELECT id, name, hsn_code, unit, selling_price, gst_rate, buying_price,
              require_barcode, barcode
         FROM products WHERE id = ANY($1) AND station_id = $2`,
      [pids, station_id]
    );
    const byId = new Map(prodRows.map(p => [p.id, p]));
    if (byId.size !== new Set(pids).size) {
      return res.status(400).json({ error: 'One or more products do not belong to this station.' });
    }
    // Enforce: a require-barcode product must have a barcode tied before selling
    const bad = prodRows.filter(p => p.require_barcode && !(p.barcode || '').trim());
    if (bad.length) {
      return res.status(400).json({ error: `Tie a barcode before selling: ${bad.map(b => b.name).join(', ')}` });
    }

    const processedItems = [];
    for (const item of items) {
      const p = byId.get(item.product_id);
      const line = pricing.priceLine({
        quantity: item.quantity, mrp: p.selling_price, gst_rate: p.gst_rate ?? 18,
        buying_price: p.buying_price,
        discount_mode: item.discount_mode, discount_value: item.discount_value,
      });
      if (line.error) return res.status(400).json({ error: `${p.name}: ${line.error}` });
      processedItems.push({
        product_id: p.id, product_name: p.name, hsn_code: p.hsn_code, unit: p.unit || 'piece',
        ...line,
      });
    }
    const { subtotal, total_cgst, total_sgst, grand_total } = pricing.priceInvoice(processedItems);

    // Credit limit applies to LUBE credit too — without this, a corporate capped
    // for fuel could take unlimited oil on credit. Outstanding = uninvoiced fuel
    // credit + prior credit lube invoices (conservative: lube payments aren't
    // netted here, so the gate errs toward blocking, never over-extending).
    if (payment_mode === 'credit') {
      if (!customer_id) return res.status(400).json({ error: 'Credit sale requires a credit customer.' });
      const saleTotal = grand_total;
      const { rows: limitRows } = await pool.query(
        `SELECT credit_limit FROM corporate_station_links
         WHERE corporate_id=$1 AND station_id=$2 AND is_active=TRUE LIMIT 1`,
        [customer_id, station_id]);
      if (!limitRows.length) {
        return res.status(400).json({ error: 'This credit customer is not linked to this station.' });
      }
      const creditLimit = Number(limitRows[0].credit_limit) || 0;
      const { rows: outRows } = await pool.query(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM dispense_events
             WHERE corporate_id=$1 AND station_id=$2 AND payment_mode='credit'
               AND (is_invoiced IS NULL OR is_invoiced=FALSE)
               AND NOT COALESCE(is_voided,FALSE)),0)
         + COALESCE((SELECT SUM(grand_total) FROM product_invoices
             WHERE customer_id=$1 AND station_id=$2 AND payment_mode='credit'),0)
           AS outstanding`,
        [customer_id, station_id]);
      const outstanding = Number(outRows[0].outstanding) || 0;
      if (saleTotal > creditLimit - outstanding) {
        return res.status(400).json({
          error: `Credit limit exceeded. Available credit is ₹${(creditLimit - outstanding).toFixed(2)} but this sale is ₹${saleTotal.toFixed(2)}.`,
          credit_limit: creditLimit, outstanding,
        });
      }
    }

    const withDiscountCols = await hasLineDiscountCols();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Generate invoice number
      const invoice_number = await nextInvoiceNumber(station_id);

      // Insert invoice header
      const { rows: invRows } = await client.query(
        `INSERT INTO product_invoices
           (station_id, invoice_number, customer_type, customer_id, customer_name,
            customer_gstn, payment_mode, subtotal, total_cgst, total_sgst,
            grand_total, notes, created_by, shift_id, attendant_id, location)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [station_id, invoice_number, customer_type, customer_id||null,
         customer_name||'Cash Customer', customer_gstn||null, payment_mode,
         subtotal.toFixed(2), total_cgst.toFixed(2), total_sgst.toFixed(2),
         grand_total.toFixed(2), notes||null, req.user.id,
         shift_id||null, attendant_id||null, location]
      );
      const invoice = invRows[0];

      // Insert line items + deduct stock
      for (const item of processedItems) {
        const lineVals = [invoice.id, item.product_id, item.product_name, item.hsn_code||null,
           item.unit, item.quantity, item.unit_price, item.gst_rate,
           item.taxable_amount, item.cgst_amount, item.sgst_amount, item.total_amount];
        if (withDiscountCols) {
          await client.query(
            `INSERT INTO product_invoice_items
               (invoice_id, product_id, product_name, hsn_code, unit, quantity,
                unit_price, gst_rate, taxable_amount, cgst_amount, sgst_amount, total_amount,
                mrp, discount_amount)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [...lineVals, item.mrp, item.discount_amount]
          );
        } else {
          await client.query(
            `INSERT INTO product_invoice_items
               (invoice_id, product_id, product_name, hsn_code, unit, quantity,
                unit_price, gst_rate, taxable_amount, cgst_amount, sgst_amount, total_amount)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            lineVals
          );
        }
        // Deduct from total + the location bucket this sale draws from
        await client.query(
          `UPDATE products SET current_stock = current_stock - $1,
             ${locCol} = COALESCE(${locCol},0) - $1, updated_at=NOW() WHERE id=$2`,
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
