// THE WET-STOCK ARITHMETIC — one copy, used by both flows.
//
//     book     = opening + deliveries + testMove − sales
//     variance = actual − book
//
// `testMove` is SIGNED and is almost always zero: a calibration draw leaves the
// nozzle (so the totaliser counted it) and returns to the SAME tank, netting out. It
// is non-zero only when a draw CROSSED tanks — + into this one, − out of it. That is
// the existing treatment in routes/tankReco.js and it is deliberately not "testing
// subtracted from sales", which would double-count the ordinary case.
//
// WHY IT LIVES HERE. Flow v1 reconciles a tank over a SHIFT or a DATE RANGE; Flow v2
// reconciles it between two of its own ATG readings, which are instants, not days.
// Different windows, same arithmetic — and two copies of it is exactly the drift the
// cardinal rule exists to stop. The window is the caller's problem; the sum is this
// file's, and neither flow may hold its own version of the sum.
//
// A VARIANCE NEEDS BOTH ENDS. Without an opening baseline there is nothing to
// reconcile against, and reporting one anyway shows a phantom full-tank loss — so
// book and variance come back null rather than confident.

// n(x) — a number, or null when there is genuinely no figure.
//
// Number(null) is 0, not NaN, and Number('') is 0 too. Left to the default coercion a
// MISSING opening dip reads as a baseline of zero, and the tank then reconciles
// against nothing and reports its whole contents as a loss. That is the phantom
// full-tank loss this file exists to refuse, so absence is checked before coercion.
const n = v => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const r2 = x => +x.toFixed(2);

// opening / deliveries / sales / testMove / actual — litres.
// Returns { book, variance, base } with book and variance null when not reconcilable.
function reconcileTank({ opening, deliveries = 0, sales = 0, testMove = 0, actual }) {
  const o = n(opening), d = n(deliveries) ?? 0, s = n(sales) ?? 0, t = n(testMove) ?? 0;
  const a = n(actual);
  const hasBaseline = o != null;
  const book = hasBaseline ? r2(o + d + t - s) : null;
  const variance = (hasBaseline && a != null) ? r2(a - book) : null;
  // The tolerance is a percentage of what WENT THROUGH the tank, not of the closing
  // figure: a tank that took a delivery has had more chance to drift than one that sat.
  const base = hasBaseline ? o + d : 0;
  return { book, variance, base };
}

// The outlet's own limit for this fuel, floored so a nearly-empty tank does not
// produce a tolerance of a few millilitres. pct/floor come from station_settings —
// stock_tol_pct_petrol / stock_tol_pct_diesel / stock_tol_floor_ltrs.
function toleranceFor({ base, pct, floor }) {
  const b = n(base) ?? 0, p = n(pct) ?? 0, f = n(floor) ?? 0;
  return r2(Math.max(f, b * p / 100));
}

module.exports = { reconcileTank, toleranceFor };
