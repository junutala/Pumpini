// src/services/dispenseService.js
//
// THE one writer for a dispense event (a sale). Extracted from routes/dispense.js so
// coupon capture can reuse it instead of duplicating the insert — the anti-drift rule
// (four ways to create an attendant is the cautionary tale). Behaviour for the POS
// path is unchanged: same SQL, same columns, same credit-limit arithmetic.
//
// Two entry paths exist and are deliberately different in ONE respect only:
//   POS      — price comes from the NOZZLE's fuel type at the CURRENT rate.
//   Coupon   — no nozzle; price comes from (station, fuel, coupon date). See
//              services/couponService.js.
// Everything after the price is resolved is common and lives here.
const pool = require('../db/pool');

function badRequest(message, extra) {
  const e = new Error(message);
  e.status = 400;
  if (extra) Object.assign(e, extra);
  return e;
}

// Sanity bounds. A fat-fingered 999999 litres would pollute every report,
// reconciliation and Tally export downstream. Largest tanker compartment is
// ~20,000 L, so a bulk bowser load still passes comfortably.
function assertQuantity(quantity_ltrs) {
  const qty = Number(quantity_ltrs);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 20000) {
    throw badRequest('Invalid quantity. Enter litres between 0 and 20,000.');
  }
  return qty;
}

// Credit exposure check. NOTE the limit lives on corporate_station_links, not on
// corporate_accounts — it is a per-OUTLET limit, and outstanding is the sum of
// UNINVOICED credit sales at that outlet. Unchanged from the POS path.
async function assertCreditHeadroom({ station_id, corporate_id, amount }, client = pool) {
  if (!corporate_id) throw badRequest('Credit sale requires a credit customer.');

  const { rows: limitRows } = await client.query(
    `SELECT credit_limit FROM corporate_station_links
     WHERE corporate_id = $1 AND station_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [corporate_id, station_id]
  );
  if (!limitRows.length) throw badRequest('This credit customer is not linked to this station.');

  const creditLimit = Number(limitRows[0].credit_limit) || 0;

  const { rows: outRows } = await client.query(
    `SELECT COALESCE(SUM(amount),0) AS outstanding
     FROM dispense_events
     WHERE corporate_id = $1 AND station_id = $2
       AND payment_mode = 'credit'
       AND (is_invoiced IS NULL OR is_invoiced = FALSE)
       AND NOT COALESCE(is_voided,FALSE)`,
    [corporate_id, station_id]
  );
  const outstanding = Number(outRows[0].outstanding) || 0;
  const available   = creditLimit - outstanding;
  const saleAmount  = Number(amount);

  if (saleAmount > available) {
    throw badRequest(
      `Credit limit exceeded. Available credit is ₹${available.toFixed(2)} but this sale is ₹${saleAmount.toFixed(2)}.`,
      { credit_limit: creditLimit, outstanding, available, sale_amount: saleAmount }
    );
  }
  return { credit_limit: creditLimit, outstanding, available };
}

// The insert. `amount` is a GENERATED column (quantity_ltrs * rate_per_ltr) so it is
// never passed — storing quantity + rate freezes the amount on the row, which is what
// makes an invoice reproducible years later regardless of price changes.
//
// event_seq defaults from a sequence, and nozzle_id/shift_id are nullable — a coupon
// keyed in days later has no open shift and no known nozzle, and that is legitimate.
//
// COLUMN-TOLERANT BY CONSTRUCTION: the coupon columns are appended ONLY when a coupon
// is actually supplied. This code deploys BEFORE the owner runs the DDL, so a POS sale
// must never reference coupon_book_id/coupon_no while they do not exist yet — otherwise
// shipping this would 400 every sale at the counter. Coupon capture is gated separately
// (routes/coupons.js answers 503 until the migration lands).
async function insertDispense(input, client = pool) {
  const {
    station_id, shift_id, rfid_tag_id, nozzle_id, attendant_id,
    fuel_type, quantity_ltrs, rate_per_ltr, payment_mode, upi_ref,
    vehicle_number, latitude, longitude, corporate_id,
    coupon_book_id, coupon_no, occurred_at, source,
  } = input;

  const cols = [
    'station_id', 'shift_id', 'rfid_tag_id', 'nozzle_id', 'attendant_id',
    'fuel_type', 'quantity_ltrs', 'rate_per_ltr', 'payment_mode', 'upi_ref',
    'vehicle_number', 'latitude', 'longitude', 'corporate_id',
  ];
  const vals = [
    station_id, shift_id || null, rfid_tag_id || null, nozzle_id || null, attendant_id || null,
    fuel_type, quantity_ltrs, rate_per_ltr,
    payment_mode || 'cash', upi_ref || null,
    vehicle_number || null, latitude || null, longitude || null,
    (payment_mode === 'credit' && corporate_id) ? corporate_id : null,
  ];
  const exprs = vals.map((_, i) => `$${i + 1}`);

  if (coupon_book_id) {
    cols.push('coupon_book_id'); vals.push(coupon_book_id); exprs.push(`$${vals.length}`);
    cols.push('coupon_no');      vals.push(coupon_no);      exprs.push(`$${vals.length}`);
  }
  if (occurred_at) {
    cols.push('occurred_at'); vals.push(occurred_at); exprs.push(`$${vals.length}::timestamptz`);
  }
  if (source) {
    cols.push('source'); vals.push(source); exprs.push(`$${vals.length}`);
  }

  const { rows } = await client.query(
    `INSERT INTO dispense_events(${cols.join(',')}) VALUES(${exprs.join(',')}) RETURNING *`,
    vals
  );
  return rows[0];
}

module.exports = { assertQuantity, assertCreditHeadroom, insertDispense, badRequest };
