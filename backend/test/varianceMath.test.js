// THE WET-STOCK ARITHMETIC, pinned — because two flows now share it.
//
// Flow v1 reconciles a tank over a shift or a date range; Flow v2 between two of its
// own ATG readings. Different windows, ONE sum. These cases are the sum, so a change
// made for one flow cannot quietly move the other flow's variance.
const test = require('node:test');
const assert = require('node:assert');
const { reconcileTank, toleranceFor } = require('../src/lib/varianceMath');

test('the plain case — book is opening + deliveries − sales', () => {
  const r = reconcileTank({ opening: 8000, deliveries: 5000, sales: 4900, actual: 8087.56 });
  assert.strictEqual(r.book, 8100);
  assert.strictEqual(r.variance, -12.44);
  // Tolerance is a share of what WENT THROUGH the tank, not of the closing figure.
  assert.strictEqual(r.base, 13000);
});

test('a test draw that stayed in its own tank does not move the book', () => {
  // The totaliser counted the draw and the fuel came back to the SAME tank, so the
  // signed testMove is zero. Subtracting "testing" here would double-count it.
  const a = reconcileTank({ opening: 5000, deliveries: 0, sales: 120, testMove: 0, actual: 4880 });
  assert.strictEqual(a.book, 4880);
  assert.strictEqual(a.variance, 0);
});

test('a draw that CROSSED tanks moves both books, in opposite directions', () => {
  const from = reconcileTank({ opening: 5000, sales: 100, testMove: -10, actual: 4890 });
  const into = reconcileTank({ opening: 3000, sales: 0,   testMove:  10, actual: 3010 });
  assert.strictEqual(from.book, 4890);
  assert.strictEqual(into.book, 3010);
  assert.strictEqual(from.variance, 0);
  assert.strictEqual(into.variance, 0);
});

test('NO BASELINE, NO VARIANCE — never a phantom full-tank loss', () => {
  const r = reconcileTank({ opening: null, deliveries: 5000, sales: 100, actual: 4900 });
  assert.strictEqual(r.book, null);
  assert.strictEqual(r.variance, null);
});

test('no closing figure yet — book stands, variance waits', () => {
  const r = reconcileTank({ opening: 8000, deliveries: 0, sales: 500, actual: null });
  assert.strictEqual(r.book, 7500);
  assert.strictEqual(r.variance, null);
});

test('rubbish in a figure does not become NaN in front of a manager', () => {
  const r = reconcileTank({ opening: 8000, deliveries: 'x', sales: undefined, actual: 7999 });
  assert.strictEqual(r.book, 8000);
  assert.strictEqual(r.variance, -1);
});

test('the tolerance is floored, so a nearly-empty tank is not held to millilitres', () => {
  // 0.75% of 1,000 L is 7.50 — below the 20 L floor, so the floor wins.
  assert.strictEqual(toleranceFor({ base: 1000, pct: 0.75, floor: 20 }), 20);
  // 0.75% of 13,000 L is 97.50 — above the floor, so the percentage wins.
  assert.strictEqual(toleranceFor({ base: 13000, pct: 0.75, floor: 20 }), 97.5);
});
