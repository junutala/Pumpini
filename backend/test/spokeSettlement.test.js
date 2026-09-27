// WHAT HE BROUGHT — the only manual entry in Spoke 3, and the checks on it.
//
// Found in the MBR rehearsal of 27-Sep-2026: only the TOTAL was checked, so a negative
// cash figure hidden behind a larger UPI figure passed as a payment.
const test = require('node:test');
const assert = require('node:assert');
const { settlementProblem } = require('../src/services/spokeService');

test('an ordinary settlement has no problem', () => {
  assert.strictEqual(settlementProblem({ cash: 7010, upi: 0, card: 0, credit: 0, petty: 0 }), null);
});

test('amounts may arrive as strings and blanks, as a form sends them', () => {
  assert.strictEqual(settlementProblem({ cash: '7010', upi: '', card: null, credit: undefined, petty: '0' }), null);
});

test('nothing brought is refused — a settlement may not complete at zero', () => {
  assert.deepStrictEqual(settlementProblem({ cash: 0, upi: 0 }), { code: 'nothing_brought' });
  assert.deepStrictEqual(settlementProblem({}), { code: 'nothing_brought' });
});

test('A NEGATIVE PART IS REFUSED even when the total is positive — the rehearsal case', () => {
  // cash −5,000 with UPI +5,010 used to pass as "₹10 brought".
  assert.deepStrictEqual(settlementProblem({ cash: -5000, upi: 5010 }),
    { code: 'negative_amount', field: 'cash' });
});

test('a part that is not a number is refused, never read as zero', () => {
  assert.deepStrictEqual(settlementProblem({ cash: 'abc', upi: 100 }), { code: 'bad_amount', field: 'cash' });
  assert.deepStrictEqual(settlementProblem({ cash: 100, card: 'Infinity' }), { code: 'bad_amount', field: 'card' });
});

// ── THE READING ITSELF ──────────────────────────────────────────────────────────
const { readingProblem } = require('../src/services/spokeService');

test('a meter figure as the slip prints it is a reading', () => {
  assert.strictEqual(readingProblem(1990.29), null);
  assert.strictEqual(readingProblem('1990.29'), null);
  assert.strictEqual(readingProblem('  2203.890 '), null);
  assert.strictEqual(readingProblem(0), null);
});

test('A COMMA IS REFUSED, not passed to the database — it used to come back as a 500', () => {
  assert.strictEqual(readingProblem('1,990.29'), 'bad_reading');
});

test('blank, negative and non-numbers are refused', () => {
  assert.strictEqual(readingProblem(''), 'no_reading');
  assert.strictEqual(readingProblem(null), 'no_reading');
  assert.strictEqual(readingProblem(-5), 'bad_reading');
  assert.strictEqual(readingProblem('12a'), 'bad_reading');
  assert.strictEqual(readingProblem(NaN), 'bad_reading');
});
