// THE OUTLET'S CURRENT SELLING PRICE — one place to ask.
//
// This query already existed in SEVEN files (settlementService, settlementLedger,
// couponService, spokeService twice, routes/prices, routes/groups, routes/ai-chat).
// This is not yet the one writer for all of them — untangling seven live money paths
// is its own change and is logged in docs/opentasks.md. It is the writer for
// everything new, so the count stops growing here.
const pool = require('../db/pool');

// HOW FAR ABOVE TODAY'S PRICE A LIFETIME AVERAGE MAY SIT.
//
// A nozzle slip prints CUMULATIVE rupees and CUMULATIVE litres, so amount ÷ volume is
// the average price over the whole life of that meter. Prices rise over time, so that
// average sits BELOW today's board price — measured at Kamala on genuine slips,
// ₹90.29 and ₹91.68 against a ₹104.23 diesel price, some 12-13% under.
//
// It can only exceed today's price in one situation: a nozzle commissioned very
// recently, whose short history was priced before a cut. Even then the gap is the size
// of the cut, not of the price. 5% is comfortably more than any single revision and
// still removes the whole ₹109-200 corridor a misread currently hides in.
//
// Deliberately NOT applied to the floor. The floor is a function of how OLD the meter
// is, not of the price, and an old pump can sit far below today's board. Tightening it
// without measurement would reject honest slips — see docs/opentasks.md.
const CEILING_FACTOR = 1.05;

// The price in force now for one fuel at one outlet. Null when the outlet has never
// priced that fuel — the caller must treat that as "no opinion", never as zero.
async function currentPrice(station_id, fuel_type, db = pool) {
  if (!station_id || !fuel_type) return null;
  const { rows } = await db.query(
    `SELECT price FROM fuel_prices
      WHERE station_id = $1 AND fuel_type = $2
      ORDER BY effective_from DESC LIMIT 1`,
    [station_id, fuel_type]
  );
  const p = parseFloat(rows[0]?.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// The highest implied price a slip for THIS fuel may show. Null when unknown, so the
// caller falls back to the absolute band rather than to a number it invented.
async function impliedPriceCeiling(station_id, fuel_type, db = pool) {
  const p = await currentPrice(station_id, fuel_type, db);
  return p == null ? null : +(p * CEILING_FACTOR).toFixed(2);
}

// For a COMPOSITE scan, whose lines belong to different nozzles and therefore
// different fuels: the ceiling of the dearest fuel the outlet sells. Looser than a
// per-fuel ceiling and still far tighter than the flat band — premium at ₹125.87 gives
// ₹132.16 against 200.
async function stationPriceCeiling(station_id, db = pool) {
  if (!station_id) return null;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (fuel_type) price
       FROM fuel_prices WHERE station_id = $1
      ORDER BY fuel_type, effective_from DESC`,
    [station_id]
  );
  const top = rows.map(r => parseFloat(r.price)).filter(p => Number.isFinite(p) && p > 0);
  return top.length ? +(Math.max(...top) * CEILING_FACTOR).toFixed(2) : null;
}

// ── SETTING A PRICE — the one writer ─────────────────────────────────────────
//
// SHIFT-LED: one row in fuel_prices, exactly as before. The outlet closes its shift at
// the change (usually 6 AM) and that is what splits old litres from new.
//
// NOZZLE-LED: there is no shift boundary, so the change must make its own. Owner,
// 27-Sep-2026: "when a price change is effected... scan the Nozzle slips at that point,
// may in the same screen, so that use our suspense concept to push the sales done till
// that point with old price and the settlement nozzle reading with the new pricing."
// And: "IF there are four nozzles tied to a pump dispense different fuel, the pump sends
// out one printout with ALL four nozzles. SO, we should obtain the fuel type that is
// getting a price change and read only those nozzles for that fuel type and not all."
//
// So the new price and one reading per nozzle OF THAT FUEL land in ONE transaction, at
// one moment. Each reading closes the man on the nozzle and reopens the same man at the
// same figure (spokeService.recordEvent): what he sold until now joins his running
// account at the old price, and his next leg opens at the new one. The price starts at
// that moment — never a typed or backdated time, which would bring the straddle back.
// Nozzles of other fuels are never touched, whatever the printout carried.

// WHICH NOZZLES NEED A READING, AND WHICH READINGS TO USE. Pure, so the rule the owner
// set can be tested without a database.
//
//   nozzles  [{ id, fuel_type, head_event_id, nozzle_name }] — the outlet's active nozzles
//   readings [{ nozzle_id, reading, ... }] — whatever the screen sent
//
// A nozzle needs a reading when it sells THIS fuel and has a chain. One with no chain was
// never commissioned: it has no leg to split, and a first reading typed on a price screen
// would be a genesis nobody commissioned. Readings for any other nozzle are IGNORED —
// never written — which is what keeps a mixed-fuel printout from moving a diesel account
// on a petrol price change.
function priceBoundaryPlan({ fuel_type, nozzles = [], readings = [] }) {
  const need = nozzles.filter(n => String(n.fuel_type) === String(fuel_type) && n.head_event_id);
  const needIds = new Set(need.map(n => String(n.id)));
  const given = new Map();
  const ignored = [];
  for (const r of readings || []) {
    const id = String(r?.nozzle_id || '');
    if (needIds.has(id)) given.set(id, r);
    else if (id) ignored.push(id);
  }
  const blank = r => r == null || r.reading == null || String(r.reading).trim() === '';
  const missing = need.filter(n => blank(given.get(String(n.id))));
  const take = need.filter(n => !blank(given.get(String(n.id))))
                   .map(n => ({ nozzle: n, reading: given.get(String(n.id)) }));
  return { need, take, missing, ignored };
}

// Is this outlet nozzle-led? Read OUTSIDE any transaction and tolerant of a missing
// column: this route serves every outlet, and a price must never fail to save because a
// database lacks the flag. No flag means shift-led, which is every outlet but two.
async function isNozzleLed(station_id, db = pool) {
  try {
    const { rows } = await db.query(
      `SELECT hub_spokes_migration_enabled FROM station_settings WHERE station_id = $1`,
      [station_id]);
    return rows[0]?.hub_spokes_migration_enabled === true;
  } catch { return false; }
}

async function setPrice({ station_id, fuel_type, price, effective_from, set_by, readings = [] }) {
  const spokes = require('./spokeService');
  const nozzleLed = (await isNozzleLed(station_id)) && (await spokes.hasSpokeTables());
  if (!nozzleLed) {
    const { rows } = await pool.query(
      `INSERT INTO fuel_prices(station_id,fuel_type,price,effective_from,set_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [station_id, fuel_type, price, effective_from || new Date(), set_by]);
    return { price: rows[0], readings: [] };
  }

  const nozzles = (await spokes.nozzleState(station_id))
    .map(n => ({ ...n, nozzle_name: n.nozzle_name ?? n.nozzle_number }));
  const plan = priceBoundaryPlan({ fuel_type, nozzles, readings });
  if (plan.missing.length) {
    return { refused: 'readings_needed',
             missing: plan.missing.map(n => ({ nozzle_id: n.id, nozzle_name: n.nozzle_name })) };
  }

  const at = new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO fuel_prices(station_id,fuel_type,price,effective_from,set_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [station_id, fuel_type, price, at, set_by]);
    const events = [];
    for (const { nozzle, reading: r } of plan.take) {
      // The same man, closed and reopened: his account runs on, only the price changes.
      const out = await spokes.recordEvent({
        client, station_id, nozzle_id: nozzle.id, reading: r.reading, at,
        opens_attendant_id: nozzle.on_attendant_id || null,
        source: r.source, drift_reason: r.drift_reason,
        read_pump_serial: r.read_pump_serial, read_nozzle_no: r.read_nozzle_no,
        recorded_by: set_by,
      });
      if (!out?.event) {
        await client.query('ROLLBACK');
        return { refused: 'reading_refused', nozzle_id: nozzle.id,
                 nozzle_name: nozzle.nozzle_name, out };
      }
      events.push(out.event);
    }
    await client.query('COMMIT');
    return { price: rows[0], readings: events, ignored: plan.ignored.length };
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

module.exports = { currentPrice, impliedPriceCeiling, stationPriceCeiling, CEILING_FACTOR,
                   setPrice, priceBoundaryPlan, isNozzleLed };
