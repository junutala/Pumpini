// Unit tests for the opening carry-forward — the pure decision function.
//
// `resolveNozzleOpening` is where the owner's 01-Aug rule becomes code: where a
// prior close exists it IS the opening and the client cannot type over it. These
// tests pin the three states apart, because the difference between them is the
// difference between "the manager must read the meter" and "the system already
// knows the number", and a screen that confuses the two teaches managers to ignore
// the warning.
const test = require('node:test');
const assert = require('node:assert');
const { resolveNozzleOpening } = require('../src/services/openingService');

test('a carried close wins over whatever the client sent', () => {
  const r = resolveNozzleOpening({ carried_opening: '105400.250', source: 'carried' }, 105600);
  assert.strictEqual(r.opening, 105400.25);
  assert.strictEqual(r.source, 'carried');
  assert.strictEqual(r.requested, 105600);
  // Flagged, not rejected — the assignment still succeeds on the carried figure.
  assert.strictEqual(r.overridden, true);
});

test('a client figure equal to the carried close is not a discrepancy', () => {
  const r = resolveNozzleOpening({ carried_opening: 105400.25, source: 'carried' }, '105400.25');
  assert.strictEqual(r.opening, 105400.25);
  assert.strictEqual(r.overridden, false);
});

test('the carried close stands even when the client sends nothing', () => {
  const r = resolveNozzleOpening({ carried_opening: 999.5, source: 'carried' }, '');
  assert.strictEqual(r.opening, 999.5);
  assert.strictEqual(r.source, 'carried');
  assert.strictEqual(r.overridden, false);
});

test('no prior leg at all — the client figure is accepted as entered', () => {
  const r = resolveNozzleOpening({ carried_opening: null, source: 'entered' }, '250.75');
  assert.strictEqual(r.opening, 250.75);
  assert.strictEqual(r.source, 'entered');
  assert.strictEqual(r.overridden, false);
});

test('an unsettled prior shift is PENDING, not a new nozzle', () => {
  // The figure is accepted — a shift must be able to start even when yesterday's
  // paperwork is not finished — but it is not reported as a brand-new nozzle. The
  // gap it can leave is caught afterwards by the meter_handover_gap tripwire.
  const r = resolveNozzleOpening(
    { carried_opening: null, source: 'pending', pending_on: { shift_number: 2, date: '2026-08-03' } },
    '105400.250');
  assert.strictEqual(r.opening, 105400.25);
  assert.strictEqual(r.source, 'pending');
  assert.strictEqual(r.overridden, false);
});

test('an unknown nozzle degrades to entered rather than throwing', () => {
  const r = resolveNozzleOpening(undefined, '10');
  assert.strictEqual(r.opening, 10);
  assert.strictEqual(r.source, 'entered');
});

test('no figure anywhere opens at zero rather than NaN', () => {
  const r = resolveNozzleOpening({ carried_opening: null, source: 'entered' }, null);
  assert.strictEqual(r.opening, 0);
  assert.strictEqual(r.source, 'entered');
});
