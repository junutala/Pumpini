// The margin rules, pinned. These three ways of earning are not interchangeable,
// and each of them was producing a WRONG number before this service existed:
// CNG booked ₹0 because a commission has no buy price to subtract, and a product
// with no delivery rate on file booked ₹0 rather than borrowing a sister outlet's.
const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/services/marginService');

test('CNG earns a fixed commission per kg, not sell minus buy', () => {
  // No buy rate anywhere — that is the normal state for CNG, because the IOCL
  // contractor owns the stock. The commission must not depend on one.
  const u = m.unitMargin('cng', 108.00, null, null);
  assert.strictEqual(u.per_unit, 2.03);
  assert.strictEqual(u.basis, 'commission');
});

test('CNG ignores a buy rate even if one happens to be on file', () => {
  // A stray delivery row must not turn the commission back into a subtraction.
  const u = m.unitMargin('CNG', 108.00, 90, { rate: 80, station_name: 'X' });
  assert.strictEqual(u.per_unit, 2.03);
  assert.strictEqual(u.basis, 'commission');
});

test('an own delivery rate is used and is not labelled borrowed', () => {
  const u = m.unitMargin('petrol', 115.09, 111.50, { rate: 100, station_name: 'Peer' });
  assert.ok(Math.abs(u.per_unit - 3.59) < 1e-9);
  assert.strictEqual(u.basis, 'delivery_rate');
  assert.strictEqual(u.borrowed_from, null);
});

test('with no own rate, a sister outlet’s rate is borrowed AND labelled', () => {
  // Adhoc premium: sells at 125.37, no rate of its own; Highway buys at 120.96.
  const u = m.unitMargin('premium_petrol', 125.37, null, { rate: 120.96, station_name: 'Highway Filling Station' });
  assert.ok(Math.abs(u.per_unit - 4.41) < 1e-9);
  assert.strictEqual(u.basis, 'borrowed_rate');
  assert.strictEqual(u.borrowed_from, 'Highway Filling Station');
});

test('no rate anywhere stays UNTRACKED — never a silent zero', () => {
  // The distinction the UI depends on: null means "we cannot cost this", which is
  // a nudge to enter a rate. A 0 would claim the product earns nothing.
  const u = m.unitMargin('petrol', 115.09, null, null);
  assert.strictEqual(u.per_unit, null);
  assert.strictEqual(u.basis, null);
});

test('blended % is over COSTED sales, so an untracked product cannot dilute it', () => {
  const r = m.computeMargin(
    { petrol: 1000, diesel: 500 },
    { petrol: 115090, diesel: 51620 },
    { petrol: { sell: 115.09, own: 111.50 }, diesel: { sell: 103.24, own: null, peer: null } },
  );
  // Only petrol is costed: 1000 × 3.59 = 3590 over 115090 of costed sales.
  assert.ok(Math.abs(r.amount - 3590) < 1e-6);
  assert.ok(Math.abs(r.costed_amount - 115090) < 1e-6);
  assert.ok(Math.abs(r.pct - 3.12) < 0.01);
  assert.strictEqual(r.by_fuel.diesel.margin, null);
});

test('priceRows reports the rate actually USED and the outlet’s own separately', () => {
  const rows = m.priceRows(['premium_petrol'], {
    premium_petrol: { sell: 125.37, own: null, peer: { rate: 120.96, station_name: 'Highway' } },
  });
  assert.strictEqual(rows[0].buy, 120.96);      // what the margin stands on
  assert.strictEqual(rows[0].own_buy, null);    // what this outlet itself has
  assert.strictEqual(rows[0].basis, 'borrowed_rate');
});

test('a CNG row carries no buy price at all', () => {
  const rows = m.priceRows(['cng'], { cng: { sell: 108, own: null, peer: null } });
  assert.strictEqual(rows[0].buy, null);
  assert.strictEqual(rows[0].unit_margin, 2.03);
});
