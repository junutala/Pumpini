// src/services/stockService.js
//
// THE one writer for a MOVEMENT of dry stock between locations.
//
// Pumpini has always had two stock buckets on `products` — `shop_stock` and
// `bay_stock` — chosen at receipt (routes/products.js POST /stock) and at sale
// (POST /invoices), and put back on a return (routes/productReturns.js). What it
// has never had is a way to say "this carton moved from the store to the
// forecourt". So a carton received into the shop and sold at the bay drove
// `bay_stock` negative, silently. Nobody hit it because `products_enabled` is off
// at every outlet, but the gap is real and it is what this file closes.
//
// A THIRD LOCATION, `gift`, exists for promotional stock. It is deliberately a
// LOCATION and not a flag on the product, because "is this a gift" is a property
// of the MOVEMENT, never of the item: the same 1 L of engine oil is sold at the
// counter this morning and given away this afternoon. A flag on the SKU cannot
// express "40 of these 100 are for the campaign"; a quantity in a location can.
// It also earns the ring-fence for free — an invoice draws from shop or bay, so
// stock parked in `gift` cannot be sold out from under a running campaign.
//
// One writer, two callers: the Stock Transfer screen, and (later) the campaign's
// gift issue, which is a movement out of `gift` by another name.
const pool = require('../db/pool');

// The controlled set. These map to column names, so NOTHING outside this list may
// ever reach the SQL below — the column name is interpolated, and a value from the
// request body must not be.
const LOCATIONS = ['shop', 'bay', 'gift'];
const COLUMN = { shop: 'shop_stock', bay: 'bay_stock', gift: 'gift_stock' };

function badRequest(message, extra) {
  const e = new Error(message);
  e.status = 400;
  if (extra) Object.assign(e, extra);
  return e;
}

function assertLocation(loc, label) {
  if (!LOCATIONS.includes(loc)) {
    throw badRequest(`${label} must be one of: ${LOCATIONS.join(', ')}.`);
  }
  return loc;
}

function assertQuantity(quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw badRequest('Enter a quantity greater than zero.');
  }
  return qty;
}

// 🔴 PROBE, NEVER TRY/CATCH 42703 (CLAUDE.md, learned from invoiceNumberService).
//
// This code deploys BEFORE the owner runs the DDL. A transfer touching `gift`
// would name a column that does not exist yet, and inside a BEGIN…COMMIT a failed
// statement ABORTS the whole transaction — the fallback would die with "current
// transaction is aborted" and the operation would fail anyway. A catalog SELECT
// succeeds either way and cannot poison anything, so we ask the catalog first and
// ask it OUTSIDE the transaction.
let giftColumnPresent = null;
async function hasGiftColumn(client = pool) {
  if (giftColumnPresent !== null) return giftColumnPresent;
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='products' AND column_name='gift_stock'
      LIMIT 1`
  );
  giftColumnPresent = rows.length > 0;
  return giftColumnPresent;
}

// Likewise for the movement table itself — step 2 of the migration.
let transferTablePresent = null;
async function hasTransferTable(client = pool) {
  if (transferTablePresent !== null) return transferTablePresent;
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='product_stock_transfers'
      LIMIT 1`
  );
  transferTablePresent = rows.length > 0;
  return transferTablePresent;
}

const NOT_MIGRATED = 'Stock transfer is not set up on this database yet.';

// Move `quantity` of one product from one location to another.
//
// `current_stock` is untouched on purpose: the total did not change, only where it
// sits. That is the difference between this and a receipt or a sale, and it is why
// a transfer can never alter the value of what the outlet holds.
//
// The source bucket is guarded — you cannot move out what is not there. That guard
// is the whole reason this exists rather than two UPDATEs in a route.
async function transfer({ station_id, product_id, from_location, to_location, quantity, notes, user_id }) {
  const from = assertLocation(from_location, 'From location');
  const to   = assertLocation(to_location, 'To location');
  const qty  = assertQuantity(quantity);

  if (from === to) throw badRequest('Choose two different locations.');

  if ((from === 'gift' || to === 'gift') && !(await hasGiftColumn())) {
    throw badRequest('The gift store is not set up on this database yet.');
  }
  if (!(await hasTransferTable())) throw badRequest(NOT_MIGRATED);

  const fromCol = COLUMN[from];
  const toCol   = COLUMN[to];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row, and re-scope the product to the validated station in the same
    // statement: a product_id belonging to another outlet must not be movable here
    // even though station_id passed the route guard.
    const { rows: pr } = await client.query(
      `SELECT name, unit, COALESCE(${fromCol},0) AS available
         FROM products
        WHERE id=$1 AND station_id=$2
        FOR UPDATE`,
      [product_id, station_id]
    );
    if (!pr.length) {
      const e = new Error('Product not found for this station.');
      e.status = 404;
      throw e;
    }

    const available = Number(pr[0].available);
    if (qty > available) {
      throw badRequest(
        `Only ${available} ${pr[0].unit || 'units'} of ${pr[0].name} in ${from}. Cannot move ${qty}.`,
        { available, requested: qty, from_location: from }
      );
    }

    const { rows } = await client.query(
      `INSERT INTO product_stock_transfers
         (station_id, product_id, from_location, to_location, quantity, notes, moved_by)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [station_id, product_id, from, to, qty, notes || null, user_id || null]
    );

    await client.query(
      `UPDATE products SET
         ${fromCol} = COALESCE(${fromCol},0) - $1,
         ${toCol}   = COALESCE(${toCol},0)   + $1,
         updated_at = NOW()
       WHERE id=$2`,
      [qty, product_id]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// A gift going out. THE one writer for stock leaving the gift store, and it is
// deliberately here beside transfer() rather than in the gift service: "stock
// moved" is one concept however it moved, and a second place that decrements a
// location bucket is a second idea of what the arithmetic is.
//
// UNLIKE A TRANSFER, THIS REDUCES current_stock TOO. A transfer changes where
// stock sits; a gift leaves the outlet, so the total held really does fall. That
// asymmetry is the whole difference between the two functions.
//
// Composed into the caller's transaction (client is required): the decrement and
// the gift_issues row are one act, or neither happened. A gift recorded against
// stock that was never taken out is exactly the drift this guards.
//
// There is no movement row: gift_issues IS the record of a gift movement, the way
// product_invoice_items is for a sale and product_stock_receipts for a purchase.
async function consumeFromGift({ station_id, product_id, quantity }, client) {
  if (!client) throw new Error('consumeFromGift must run inside a transaction');
  const qty = assertQuantity(quantity);
  if (!(await hasGiftColumn(client))) throw badRequest('The gift store is not set up on this database yet.');

  const { rows } = await client.query(
    `SELECT name, unit, COALESCE(gift_stock,0) AS available
       FROM products WHERE id=$1 AND station_id=$2 FOR UPDATE`,
    [product_id, station_id]
  );
  if (!rows.length) { const e = new Error('Gift not found for this station.'); e.status = 404; throw e; }

  const available = Number(rows[0].available);
  if (qty > available) {
    throw badRequest(
      `Only ${available} ${rows[0].unit || 'units'} of ${rows[0].name} left in the gift store.`,
      { code: 'out_of_stock', available, requested: qty }
    );
  }

  await client.query(
    `UPDATE products SET
       gift_stock    = COALESCE(gift_stock,0)    - $1,
       current_stock = COALESCE(current_stock,0) - $1,
       updated_at    = NOW()
     WHERE id=$2`,
    [qty, product_id]
  );
  return { name: rows[0].name, unit: rows[0].unit, remaining: available - qty };
}

// Recent movements for an outlet. Joined to the product so the screen never has to
// ask twice, and bounded because this is a ledger that only grows.
async function listTransfers({ station_id, limit = 100 }) {
  if (!(await hasTransferTable())) return [];
  const { rows } = await pool.query(
    `SELECT t.*, p.name AS product_name, p.unit, u.name AS moved_by_name
       FROM product_stock_transfers t
       JOIN products p ON p.id = t.product_id
       LEFT JOIN users u ON u.id = t.moved_by
      WHERE t.station_id=$1
      ORDER BY t.moved_at DESC
      LIMIT $2`,
    [station_id, Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

// Stock by location for the transfer screen's picker — so the manager sees what is
// actually in the source before he types a figure, rather than after.
async function stockByLocation({ station_id }) {
  const giftCol = (await hasGiftColumn()) ? 'COALESCE(gift_stock,0)' : '0';
  const { rows } = await pool.query(
    `SELECT id, name, unit, barcode,
            COALESCE(current_stock,0) AS current_stock,
            COALESCE(shop_stock,0)    AS shop,
            COALESCE(bay_stock,0)     AS bay,
            ${giftCol}                AS gift
       FROM products
      WHERE station_id=$1 AND is_active = TRUE
      ORDER BY name`,
    [station_id]
  );
  return rows;
}

module.exports = {
  LOCATIONS,
  transfer,
  consumeFromGift,
  listTransfers,
  stockByLocation,
  hasGiftColumn,
  hasTransferTable,
};
