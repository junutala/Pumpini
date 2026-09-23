// test/spokeHandoverMath.test.js
//
// THE MONEY A REASSIGN SHOWS THE MANAGER, pinned.
//
// `/nozzle-events` now prices a handover BEFORE it is recorded: the reading he is
// about to enter, the litres since the last one, the rate, the rupees, and what the
// outgoing man will owe once it lands. Owner, 23-Sep-2026: on Reassign, "show the
// amount due from the existing attendant".
//
// WHY A TEST AND NOT A PRODUCTION RUN. Every other query in this work was verified by
// composing the real string and running it against production — but `nozzle_events` is
// EMPTY at every outlet, including the one where the flow flag is already on, so the
// branch that closes a man's account has no live data to run against. Rather than
// claim a check that could not happen, the arithmetic was lifted out of the database
// call and pinned here.
//
// It must agree, figure for figure, with what outstanding() and outstandingDetail()
// compute in SQL. If it ever does not, the manager confirms one number on the handover
// screen and meets a different one on the settlement screen — and the first time that
// happens he goes back to the register, which is the whole failure this flow exists to
// prevent.
const test = require('node:test');
const assert = require('node:assert');
const { handoverMath } = require('../src/services/spokeService');

test('an ordinary leg: litres since the last reading, at the current price', () => {
  // The real leg behind 23-Sep's incident: 1.2 · M2601076.2, diesel at Rs 104.08.
  const { ltrs, value } = handoverMath({
    prevReading: 2572.900, reading: 4226.390, price: 104.08,
  });
  assert.strictEqual(+ltrs.toFixed(3), 1653.490);
  assert.strictEqual(+value.toFixed(2), 172095.24);
});

test('a reading identical to the one before it charges nothing', () => {
  // A co-event. No fuel moved, only time passed. Kamala's 02-Aug handover closed and
  // reopened eight nozzles at the identical reading to three decimals — a textbook
  // handover, and it must cost the man leaving nothing at all.
  const { ltrs, value } = handoverMath({
    prevReading: 1350.140, reading: 1350.140, price: 116.35,
  });
  assert.strictEqual(ltrs, 0);
  assert.strictEqual(value, 0);
});

test('a reading that goes BACKWARDS floors at zero, never a negative charge', () => {
  // A totaliser only counts up, so this is always a reset, a replacement or a misread.
  // physicsVerdict() raises it separately; the money must not quietly CREDIT the man
  // who is leaving because somebody mistyped a digit.
  const { ltrs, value } = handoverMath({
    prevReading: 4226.390, reading: 2572.900, price: 104.08,
  });
  assert.strictEqual(ltrs, 0);
  assert.strictEqual(value, 0);
});

test('the first reading on a nozzle opens a chain and closes nobody', () => {
  // No previous event means there is no leg to charge. This is the genesis scan.
  const { ltrs, value } = handoverMath({ prevReading: null, reading: 1234.567, price: 104.08 });
  assert.strictEqual(ltrs, 0);
  assert.strictEqual(value, 0);
});

test('litres still count when no price is on file — the rupees are what go to zero', () => {
  // A product with no price yet must not silently lose the LITRES too: the movement is
  // a physical fact, the valuation is the thing we are missing. Same shape as
  // COALESCE(pr.price, 0) in outstanding().
  const { ltrs, value } = handoverMath({ prevReading: 100, reading: 250.5, price: null });
  assert.strictEqual(ltrs, 150.5);
  assert.strictEqual(value, 0);
});

test('a non-numeric reading charges nothing rather than NaN', () => {
  // The box is a free text input until it is submitted. NaN rupees on a money screen
  // is worse than no figure.
  const { ltrs, value } = handoverMath({ prevReading: 100, reading: '', price: 104.08 });
  assert.strictEqual(ltrs, 0);
  assert.strictEqual(value, 0);
});

test('it agrees with outstandingDetail()s SQL, leg for leg', () => {
  // outstandingDetail computes, per leg:
  //   GREATEST(e.reading - COALESCE(p.reading, e.reading), 0) * COALESCE(pr.price, 0)
  // Same inputs must give the same answer, or the handover screen and the settlement
  // screen disagree about one man's money.
  const sql = (prev, read, price) =>
    Math.max(Number(read) - (prev == null ? Number(read) : Number(prev)), 0) * (Number(price) || 0);

  for (const [prev, read, price] of [
    [2572.900, 4226.390, 104.08],
    [1350.140, 1350.140, 116.35],
    [1972.350, 2572.900, 104.08],
    [1743.110, 1972.350, 104.08],
    [621.340,   733.830, 104.08],
  ]) {
    assert.strictEqual(
      +handoverMath({ prevReading: prev, reading: read, price }).value.toFixed(6),
      +sql(prev, read, price).toFixed(6),
      `disagreed on ${prev} -> ${read}`);
  }
});
