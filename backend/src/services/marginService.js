// WHAT ONE UNIT OF A PRODUCT EARNS — the single writer for margin economics.
//
// Before this file the same arithmetic (`litres × (sell − buy)`) lived in THREE
// places: `routes/groups.js` for the group rollup, `routes/dashboard.js` for the
// bunk cockpit, and — worst of the three — `GroupProductTiles.js`, which recomputed
// it in the BROWSER off the raw sell/buy it was handed. Three copies of one rule is
// exactly the drift the cardinal rule forbids: CNG's commission would have had to be
// remembered in three files, and the frontend copy would have been forgotten.
//
// So the rule lives here, the backend applies it, and the payload now carries the
// ANSWER (`unit_margin` + `basis`) rather than the ingredients. The frontend stops
// owning margin maths entirely.
//
// Three ways a product earns, and they are NOT interchangeable:
//
//   1. 'delivery_rate' — the ordinary case. We bought it, so margin is
//      pump price − what we paid. The buy rate is this outlet's own last delivery.
//
//   2. 'borrowed_rate' — we sell it but have never recorded a delivery rate for it
//      HERE, and a sister outlet in the same group has one for the same product.
//      Using the sister's rate is an ESTIMATE, and it is a far better one than the
//      alternative: with no rate at all the product books ₹0 margin and silently
//      drags the blended figure down, which reads as "this product earns nothing"
//      rather than "we haven't told the system what it cost". Adhoc Highway sells
//      premium at ₹125.37 with no rate on file; Highway buys the same product at
//      ₹120.96. Zero is the one answer we know to be wrong.
//      It is always LABELLED as borrowed — an estimate presented as a fact is worse
//      than no estimate — and the outlet's own rate supersedes it the moment one
//      is recorded.
//
//   3. 'commission' — CNG. There is no purchase price to find, because we never
//      buy the gas: the IOCL contractor owns the stock and we are paid a fixed
//      commission per kg sold. That is why CNG has no opening/closing stock worry
//      and no dip, and it is why `sell − buy` is the WRONG SHAPE for it entirely —
//      not merely a missing input. The pump price is the customer's, not ours.
//
// A note on units. CNG is sold and paid by the KILOGRAM. The dispense figure is
// stored in `quantity_ltrs` for every product, so for CNG that column holds kg — the
// commission multiplies it directly. Nothing here converts anything; the point is
// only that the ₹/kg rate meets a kg quantity.

// ₹ per KG of CNG sold, paid by the IOCL contractor (owner-set, 04-Aug-2026).
// Env-overridable so a renegotiated commission is a Railway variable, not a deploy.
const CNG_COMMISSION_PER_KG = (() => {
  const n = parseFloat(process.env.CNG_COMMISSION_PER_KG);
  return Number.isFinite(n) && n >= 0 ? n : 2.03;
})();

const isCng = ft => String(ft || '').toLowerCase() === 'cng';

// What one litre (or kg) of `fuel_type` earns, and on what authority.
//
// `own`      — this outlet's latest delivery rate, or null.
// `peer`     — { rate, station_name } from a sister outlet, or null.
//
// Returns { per_unit, basis, buy, borrowed_from }. `per_unit` is null ONLY when the
// product genuinely has no basis to compute from — that is the case the UI nudges
// the owner to fix, and it must stay distinguishable from a real zero.
function unitMargin(fuel_type, sell, own, peer) {
  // CNG first: it is a commission, so it needs neither a sell nor a buy price and
  // must never fall through to the subtraction below.
  if (isCng(fuel_type)) {
    return { per_unit: CNG_COMMISSION_PER_KG, basis: 'commission', buy: null, borrowed_from: null };
  }
  if (sell == null) return { per_unit: null, basis: null, buy: null, borrowed_from: null };
  if (own != null)  return { per_unit: sell - own, basis: 'delivery_rate', buy: own, borrowed_from: null };
  if (peer && peer.rate != null) {
    return { per_unit: sell - peer.rate, basis: 'borrowed_rate', buy: peer.rate, borrowed_from: peer.station_name || null };
  }
  return { per_unit: null, basis: null, buy: null, borrowed_from: null };
}

// Margin for a set of quantities. `qtyByFuel` is { fuel_type: litres_or_kg };
// `rates` is { fuel_type: {sell, own, peer} }. Products with no basis contribute
// NOTHING to either side of the ratio — a product we cannot cost must not be
// allowed to dilute the blended percentage, which is why `costed_amount` is
// tracked separately from total sales.
function computeMargin(qtyByFuel, amtByFuel, rates) {
  let amount = 0, costed_amount = 0;
  const by_fuel = {};
  for (const ft of Object.keys(qtyByFuel || {})) {
    const r = rates[ft] || {};
    const u = unitMargin(ft, r.sell, r.own, r.peer);
    const qty = Number(qtyByFuel[ft]) || 0;
    const amt = Number((amtByFuel || {})[ft]) || 0;
    if (u.per_unit != null) {
      amount += qty * u.per_unit;
      costed_amount += amt;
    }
    by_fuel[ft] = { ...u, margin: u.per_unit == null ? null : +(qty * u.per_unit).toFixed(2) };
  }
  return {
    amount: +amount.toFixed(2),
    costed_amount: +costed_amount.toFixed(2),
    pct: costed_amount > 0 ? +(amount / costed_amount * 100).toFixed(2) : null,
    by_fuel,
  };
}

// The price/margin descriptor the UI renders, one row per product the outlet
// touches. This is what lets the frontend stop doing arithmetic: it receives
// `unit_margin` and `basis` and only has to multiply by the litres it is showing.
function priceRows(fuelTypes, rates) {
  return [...fuelTypes].map(ft => {
    const r = rates[ft] || {};
    const u = unitMargin(ft, r.sell, r.own, r.peer);
    return {
      fuel_type: ft,
      sell: r.sell ?? null,
      buy: u.buy,                       // the rate actually USED (own or borrowed)
      own_buy: r.own ?? null,           // what this outlet itself has on file
      unit_margin: u.per_unit == null ? null : +u.per_unit.toFixed(4),
      basis: u.basis,                   // delivery_rate | borrowed_rate | commission | null
      borrowed_from: u.borrowed_from,
    };
  });
}

module.exports = { unitMargin, computeMargin, priceRows, CNG_COMMISSION_PER_KG, isCng };
