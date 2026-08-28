// THE TWO CERTAINTIES — and everything else stays silent.
//
// A handover where the readings differ is USUALLY JUST FUEL SOLD IN THE GAP. A manager
// who justifies three litres twice a day learns to click through the warning, and then
// a real reset sails past on the same habit. So only two conditions raise anything, and
// both are physics rather than judgement: a totaliser cannot count down, and a pump
// cannot deliver faster than it can deliver.
const test = require('node:test');
const assert = require('node:assert');
const { physicsVerdict, MAX_FLOW_LTRS_PER_MIN } = require('../src/services/spokeService');

const T0 = '2026-08-27T10:00:00Z';
const at = mins => new Date(Date.parse(T0) + mins * 60000).toISOString();

test('the genesis event has nothing behind it and is never refused', () => {
  assert.strictEqual(physicsVerdict({ prevReading: null, prevAt: null, reading: 1654101.29, at: T0 }), null);
});

test('ordinary trade in the gap is SILENT — this is the important one', () => {
  // 3 litres across a 20-minute handover: the commonest thing on a forecourt.
  const v = physicsVerdict({ prevReading: 1000, prevAt: T0, reading: 1003, at: at(20) });
  assert.strictEqual(v, null, 'a warning here is how managers learn to ignore warnings');
});

test('an identical reading is silent too — that is a co-event, not a fault', () => {
  assert.strictEqual(physicsVerdict({ prevReading: 1000, prevAt: T0, reading: 1000, at: at(5) }), null);
});

test('A READING THAT WENT DOWN is always refused — a totaliser only counts up', () => {
  const v = physicsVerdict({ prevReading: 1654101.29, prevAt: T0, reading: 1654100, at: at(30) });
  assert.strictEqual(v.code, 'reading_decreased');
  assert.ok(v.delta < 0);
});

test('FASTER THAN THE PUMP CAN DELIVER is refused — 400 L in three minutes', () => {
  // The build plan's own example. 3 min x 40 L/min = 120 L is the ceiling.
  const v = physicsVerdict({ prevReading: 1000, prevAt: T0, reading: 1400, at: at(3) });
  assert.strictEqual(v.code, 'faster_than_the_pump');
  assert.strictEqual(v.ceiling, 120);
});

test('a busy pump running flat out is NOT refused', () => {
  // An hour at the full 40 L/min is exactly the ceiling, and must pass.
  const v = physicsVerdict({ prevReading: 1000, prevAt: T0, reading: 1000 + 60 * MAX_FLOW_LTRS_PER_MIN, at: at(60) });
  assert.strictEqual(v, null);
});

test('two prints in the same second do not divide by zero into a false alarm', () => {
  // The gap is floored at 30 s, so a small legitimate movement still passes.
  assert.strictEqual(physicsVerdict({ prevReading: 1000, prevAt: T0, reading: 1005, at: T0 }), null);
  // …but an impossible one at the same instant is still caught.
  assert.strictEqual(
    physicsVerdict({ prevReading: 1000, prevAt: T0, reading: 5000, at: T0 }).code,
    'faster_than_the_pump');
});
