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

module.exports = { currentPrice, impliedPriceCeiling, stationPriceCeiling, CEILING_FACTOR };
