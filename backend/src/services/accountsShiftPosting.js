// src/services/accountsShiftPosting.js
//
// The "pull" materialiser: reads ALREADY-SETTLED shift and delivery data and posts the
// auto-fed accounting events through the engine. It NEVER hooks into shift-close or any
// existing flow — it is invoked on demand (POST /api/accounts/materialize), finds
// settled-but-unposted shifts/deliveries, and posts them. Idempotent throughout:
// source_ref is the shift/delivery id, so a re-run posts only what's new.
//
// Four auto-fed events (see docs/accounts-module-plan.md §3):
//   • fuel_sale     (per shift)    Dr cash/upi/debtors            Cr fuel_sales
//   • petty_cash    (per shift)    Dr petty_cash_expense          Cr cash_in_hand
//   • cogs_fuel     (per shift)    Dr cogs_fuel                   Cr closing_stock_fuel
//   • fuel_purchase (per delivery) Dr closing_stock_fuel          Cr creditors
//
// Money identity (settlementService.js cashPosition): cashValue = total_sales − card −
// upi − credit, so the sale entry balances from shift_reconciliation alone. Not yet
// modelled (later slices): cash variance/short-over, opening float, bank deposits — so
// the cash_in_hand ledger balance is "book cash from sales", not physically-counted cash.
const engine = require('./accountingEngine');
const margin = require('./marginService');   // the ONE source for CNG commission
const { round2 } = engine;

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Moving weighted-average landed cost per fuel_type as of a date, from deliveries only:
//   WAC = Σ(total_value + freight) / Σ(gross_volume_ltrs)
// total_value is taxes-included, freight-excluded (deliveries.js), so we add freight for
// the true landed cost. Falls back to rate_per_ltr×gross when total_value wasn't OCR'd.
async function weightedAvgCostMap(db, stationId, asOf) {
  const { rows } = await db.query(
    `SELECT fuel_type,
            SUM(COALESCE(total_value, rate_per_ltr * gross_volume_ltrs, 0) + COALESCE(freight, 0)) AS cost,
            SUM(gross_volume_ltrs) AS ltrs
       FROM fuel_deliveries
      WHERE station_id = $1 AND COALESCE(dc_date, received_at::date) <= $2
      GROUP BY fuel_type`, [stationId, asOf]);
  const map = {};
  for (const r of rows) {
    const ltrs = Number(r.ltrs) || 0;
    map[r.fuel_type] = ltrs > 0 ? Number(r.cost) / ltrs : 0;
  }
  return map;
}

// Post one settled shift's events. Safe to call repeatedly (engine is idempotent).
// `overallWac` (fuel_type → cost) is the full-history fallback used when a shift predates
// its fuel's delivery record, so early shifts aren't costed at zero.
async function postShift(db, { station_id, shift_id, date, created_by, overallWac }) {
  const { rows: [m] } = await db.query(
    `SELECT COALESCE(SUM(total_sales),0)  AS total_sales,
            COALESCE(SUM(upi_total),0)    AS upi,
            COALESCE(SUM(card_total),0)   AS card,
            COALESCE(SUM(credit_total),0) AS credit,
            COALESCE(SUM(petty_cash),0)   AS petty
       FROM shift_reconciliation
      WHERE shift_id = $1 AND manager_confirmed = true`, [shift_id]);

  const upiCard = round2(Number(m.upi) + Number(m.card));
  const credit  = round2(Number(m.credit));
  const cash    = round2(Number(m.total_sales) - Number(m.card) - Number(m.upi) - Number(m.credit));
  const petty   = round2(Number(m.petty));
  // Derive the total from its parts so the entry always balances to the paisa, even if a
  // stored total_sales drifted. (cash + upiCard + credit ≡ total_sales by the identity.)
  const total = round2(cash + upiCard + credit);

  const out = {};
  if (total > 0) {
    out.sale = await engine.postEvent(db, {
      station_id, type: 'fuel_sale', date, source: 'shift_pull', source_ref: String(shift_id),
      amount: total, amounts: { cash, upi_card: upiCard, credit },
      narration: 'Fuel sales (shift)', created_by,
    });
  }
  if (petty > 0) {
    out.petty = await engine.postEvent(db, {
      station_id, type: 'petty_cash', date, source: 'shift_pull', source_ref: String(shift_id),
      amount: petty, narration: 'Petty cash expenses (shift)', created_by,
    });
  }

  // Per-fuel litres + value for this shift, from the settled dispense_events (present in
  // both POS and blind-drop modes after settlement).
  const { rows: fuel } = await db.query(
    `SELECT fuel_type, COALESCE(SUM(quantity_ltrs),0) AS ltrs, COALESCE(SUM(amount),0) AS amt
       FROM dispense_events
      WHERE shift_id = $1 AND NOT COALESCE(is_voided, false)
      GROUP BY fuel_type`, [shift_id]);

  // COGS = Σ (litres sold per fuel × weighted-avg cost). CNG is EXCLUDED — it's a
  // commission product the outlet never buys, so it has no cost of goods. WAC falls back
  // to the full-history average when this shift predates the fuel's first delivery.
  const wac = await weightedAvgCostMap(db, station_id, date);
  const overall = overallWac || (await weightedAvgCostMap(db, station_id, '9999-12-31'));
  let cogs = 0, cngKg = 0, cngGross = 0;
  for (const f of fuel) {
    if (margin.isCng(f.fuel_type)) { cngKg += Number(f.ltrs); cngGross += Number(f.amt); continue; }
    cogs += Number(f.ltrs) * (wac[f.fuel_type] || overall[f.fuel_type] || 0);
  }
  cogs = round2(cogs);
  if (cogs > 0) {
    out.cogs = await engine.postEvent(db, {
      station_id, type: 'cogs_fuel', date, source: 'shift_pull', source_ref: String(shift_id),
      amount: cogs, narration: 'Cost of fuel sold (shift)', created_by,
    });
  }

  // CNG reclassification: the fuel_sale above booked CNG gross into revenue (it's inside
  // shift_reconciliation.total_sales). Only the commission (kg × CNG_COMMISSION_PER_KG) is
  // the outlet's income; the rest is cash owed to IOCL. Move that pass-through out of
  // revenue into the CNG payable, leaving fuel_sales = liquid gross + CNG commission.
  const cngPassthrough = round2(cngGross - cngKg * margin.CNG_COMMISSION_PER_KG);
  if (cngPassthrough > 0) {
    out.cng = await engine.postEvent(db, {
      station_id, type: 'cng_passthrough', date, source: 'shift_pull', source_ref: String(shift_id),
      amount: cngPassthrough, narration: 'CNG collected, owed to IOCL (net of commission)',
      created_by, party: { type: 'supplier' },
    });
  }
  return out;
}

// Enumerate + post everything settled-but-unposted for a station up to `upto` (IST date).
// `reset: true` first removes the auto-fed journals (source shift_pull / delivery_pull)
// for this station and re-posts them from scratch — the pilot-correction path, used when
// the posting logic changes. Manual entries (source 'manual', etc.) are never touched.
async function materialize(db, stationId, { upto, created_by, reset } = {}) {
  const asOf = upto || todayIST();

  if (reset) {
    await db.query(
      `DELETE FROM accounting_journal
        WHERE station_id = $1 AND source IN ('shift_pull','delivery_pull')`, [stationId]);
  }

  // Go-live cutoff: if opening balances are set, everything up to & including the
  // books-start date is captured in that opening balance sheet, so we post only shifts and
  // deliveries STRICTLY AFTER it (no double-counting). Column/table-tolerant — absent →
  // no cutoff (post all history, the pilot behaviour).
  let goLive = null;
  try {
    const { rows } = await db.query(
      `SELECT books_start_date FROM accounting_opening_balances WHERE station_id=$1`, [stationId]);
    if (rows.length && rows[0].books_start_date) goLive = rows[0].books_start_date;
  } catch { goLive = null; }
  const cutoff = goLive ? ' AND sh.date > $3' : '';
  const cutoffParams = goLive ? [goLive] : [];

  // Full-history WAC per fuel — the fallback for shifts predating a fuel's first delivery.
  const overallWac = await weightedAvgCostMap(db, stationId, '9999-12-31');

  const { rows: shifts } = await db.query(
    `SELECT sh.id, sh.date
       FROM shifts sh
      WHERE sh.station_id = $1 AND sh.date <= $2 AND sh.status IN ('closed','reconciled')${cutoff}
        AND EXISTS (SELECT 1 FROM shift_reconciliation r
                     WHERE r.shift_id = sh.id AND r.manager_confirmed = true)
        AND NOT EXISTS (SELECT 1 FROM accounting_journal j
                     WHERE j.station_id = $1 AND j.event_type = 'fuel_sale'
                       AND j.source_ref = sh.id::text)
      ORDER BY sh.date, sh.shift_number`, [stationId, asOf, ...cutoffParams]);

  let shiftsPosted = 0;
  for (const sh of shifts) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await postShift(client, { station_id: stationId, shift_id: sh.id, date: sh.date, created_by, overallWac });
      await client.query('COMMIT');
      shiftsPosted++;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      try { require('../utils/logger').error(`accounts materialize: shift ${sh.id} failed`, e); } catch { /* noop */ }
    } finally { client.release(); }
  }

  // `paid` may not exist yet (pre-016) — read it tolerantly. A missing column (or NULL)
  // means "unknown" → treated as on-credit (creditors) until the owner classifies it.
  const hasPaid = await (async () => {
    try {
      const { rows } = await db.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='fuel_deliveries' AND column_name='paid' LIMIT 1`);
      return rows.length > 0;
    } catch { return false; }
  })();
  const paidSel = hasPaid ? 'fd.paid' : 'NULL::boolean';

  const delCutoff = goLive ? ' AND COALESCE(fd.dc_date, fd.received_at::date) > $3' : '';
  const { rows: dels } = await db.query(
    `SELECT fd.id,
            COALESCE(fd.dc_date, fd.received_at::date) AS d,
            ${paidSel} AS paid,
            COALESCE(fd.total_value, fd.rate_per_ltr * fd.gross_volume_ltrs, 0) + COALESCE(fd.freight, 0) AS value
       FROM fuel_deliveries fd
      WHERE fd.station_id = $1 AND COALESCE(fd.dc_date, fd.received_at::date) <= $2${delCutoff}
        AND NOT EXISTS (SELECT 1 FROM accounting_journal j
                     WHERE j.station_id = $1 AND j.event_type = 'fuel_purchase'
                       AND j.source_ref = fd.id::text)
      ORDER BY d`, [stationId, asOf, ...cutoffParams]);

  let deliveriesPosted = 0;
  for (const d of dels) {
    if (!(Number(d.value) > 0)) continue;
    const creditTo = d.paid === true ? 'bank' : 'creditors';   // prepaid → bank, else payable
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await engine.postEvent(client, {
        station_id: stationId, type: 'fuel_purchase', date: d.d,
        source: 'delivery_pull', source_ref: String(d.id), amount: round2(Number(d.value)),
        accounts: { credit_to: creditTo },
        narration: d.paid === true ? 'Fuel purchase (prepaid)' : 'Fuel purchase (on credit)',
        created_by, party: { type: 'supplier' },
      });
      await client.query('COMMIT');
      deliveriesPosted++;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      try { require('../utils/logger').error(`accounts materialize: delivery ${d.id} failed`, e); } catch { /* noop */ }
    } finally { client.release(); }
  }

  return {
    as_of: asOf,
    shifts_pending: shifts.length, shifts_posted: shiftsPosted,
    deliveries_scanned: dels.length, deliveries_posted: deliveriesPosted,
  };
}

module.exports = { weightedAvgCostMap, postShift, materialize };
