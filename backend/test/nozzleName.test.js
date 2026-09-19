// ONE NOZZLE NAME — the rules, pinned.
//
// A nozzle is shown as `<pump no>.<nozzle> · <pump serial>.<nozzle>` —
// `1.1 · M2601076.1` — and nothing else ever reaches a user (CLAUDE.md, owner-set
// 2026-08-20, amended 2026-09-19). The left half is what the forecourt calls it;
// the right half is the identity the nozzle's own slip prints.
// `nozzles.nozzle_number` ("1.1") remains our INTERNAL index.
//
// 🔴 WHY THE PUMP NUMBER IS NEVER ALONE. It is ours by construction — we numbered
// the pumps as they were entered and nobody outside this codebase confirmed them.
// Beside the serial it is FALSIFIABLE: a man who calls that machine pump 1 sees
// `3.1 · 201807000908.1` and tells us. Alone it could never be challenged.
//
// These pin the JS half against the SQL half's rules in the same order, so the two
// cannot drift apart silently. The drift they exist to stop already happened once:
// PR #304 named every nozzle coming from the `nozzles` table and was believed
// complete, but the slip reader builds its lines from OCR output, so `nozzle_name`
// was never set there and the internal index reached the manager in the
// unmatched/refused list for four months.
const test = require('node:test');
const assert = require('node:assert');
const { nozzleName } = require('../src/services/pumpService');

test('pump number + serial, with the explicit slip mapping on both halves', () => {
  assert.strictEqual(
    nozzleName({ pump_number: '2', pump_serial: '15BC1412V', nozzle_number: '2.1', slip_nozzle_no: '1' }),
    '2.1 · 15BC1412V.1');
});

test('no slip mapping -> the suffix of our internal number ("1.3" -> "3")', () => {
  assert.strictEqual(
    nozzleName({ pump_number: '1', pump_serial: 'M1832105', nozzle_number: '1.3', slip_nozzle_no: null }),
    '1.3 · M1832105.3');
});

test('an internal number with no dot is used whole, and gives no pump half', () => {
  assert.strictEqual(
    nozzleName({ pump_serial: 'M1832105', nozzle_number: '7', slip_nozzle_no: null }),
    'M1832105.7');
});

test('Kamala CNG — the ONE sanctioned invented serial (the unit prints no slip)', () => {
  assert.strictEqual(
    nozzleName({ pump_number: '4', pump_serial: 'CNG', nozzle_number: '4.2', slip_nozzle_no: '2' }),
    '4.2 · CNG.2');
});

test('NO SERIAL -> the stored number, unchanged. Never an invented name', () => {
  assert.strictEqual(nozzleName({ pump_number: '1', pump_serial: '',   nozzle_number: '1.1' }), '1.1');
  assert.strictEqual(nozzleName({ pump_number: '1', pump_serial: null, nozzle_number: '1.1' }), '1.1');
  assert.strictEqual(nozzleName({                                      nozzle_number: '1.1' }), '1.1');
});

test('NO PUMP NUMBER -> the slip identity alone. We never show half a label', () => {
  // An unregistered pump, or a row whose query did not fetch pump_number and whose
  // internal number carries no prefix to fall back on.
  assert.strictEqual(
    nozzleName({ pump_serial: 'M2601076', nozzle_number: 'X', slip_nozzle_no: '1' }),
    'M2601076.1');
});

test('pump number falls back to the prefix of our internal number', () => {
  // "3.4" was always pump 3 nozzle 4 — that prefix is where the number came from.
  assert.strictEqual(
    nozzleName({ pump_serial: 'M2601180', nozzle_number: '3.4', slip_nozzle_no: '4' }),
    '3.4 · M2601180.4');
});

test('`serial` is accepted as well as `pump_serial` — callers join it both ways', () => {
  assert.strictEqual(
    nozzleName({ pump_number: '3', serial: '17CH2645V', nozzle_number: '3.2', slip_nozzle_no: null }),
    '3.2 · 17CH2645V.2');
});

test('padding on either side is trimmed, never carried into the name', () => {
  assert.strictEqual(
    nozzleName({ pump_number: ' 2 ', pump_serial: '  15BC1412V ', nozzle_number: ' 2.1 ', slip_nozzle_no: ' 1 ' }),
    '2.1 · 15BC1412V.1');
});
