// ONE NOZZLE NAME — the three rules, pinned.
//
// A nozzle is shown as `<pump serial>.<nozzle number>` — exactly as its own slip
// prints it — and nothing else ever reaches a user (CLAUDE.md, owner-set
// 2026-08-20). `nozzles.nozzle_number` ("1.1") is our INTERNAL index.
//
// These pin the JS half against the SQL half's three rules in the same order, so
// the two cannot drift apart silently. The drift they exist to stop already
// happened once: PR #304 named every nozzle coming from the `nozzles` table and
// was believed complete, but the slip reader builds its lines from OCR output, so
// `nozzle_name` was never set there and the internal index reached the manager in
// the unmatched/refused list for four months.
const test = require('node:test');
const assert = require('node:assert');
const { nozzleName } = require('../src/services/pumpService');

test('serial + the explicit slip mapping wins', () => {
  assert.strictEqual(
    nozzleName({ pump_serial: '15BC1412V', nozzle_number: '2.1', slip_nozzle_no: '1' }),
    '15BC1412V.1');
});

test('no slip mapping -> the suffix of our internal number ("1.3" -> "3")', () => {
  assert.strictEqual(
    nozzleName({ pump_serial: 'M1832105', nozzle_number: '1.3', slip_nozzle_no: null }),
    'M1832105.3');
});

test('an internal number with no dot is used whole', () => {
  assert.strictEqual(
    nozzleName({ pump_serial: 'M1832105', nozzle_number: '7', slip_nozzle_no: null }),
    'M1832105.7');
});

test('Kamala CNG — the ONE sanctioned invented serial (the unit prints no slip)', () => {
  assert.strictEqual(
    nozzleName({ pump_serial: 'CNG', nozzle_number: '4.2', slip_nozzle_no: '2' }),
    'CNG.2');
});

test('NO SERIAL -> the stored number, unchanged. Never an invented name', () => {
  assert.strictEqual(nozzleName({ pump_serial: '',   nozzle_number: '1.1' }), '1.1');
  assert.strictEqual(nozzleName({ pump_serial: null, nozzle_number: '1.1' }), '1.1');
  assert.strictEqual(nozzleName({                    nozzle_number: '1.1' }), '1.1');
});

test('`serial` is accepted as well as `pump_serial` — callers join it both ways', () => {
  assert.strictEqual(
    nozzleName({ serial: '17CH2645V', nozzle_number: '3.2', slip_nozzle_no: null }),
    '17CH2645V.2');
});

test('padding on either side is trimmed, never carried into the name', () => {
  assert.strictEqual(
    nozzleName({ pump_serial: '  15BC1412V ', nozzle_number: ' 2.1 ', slip_nozzle_no: ' 1 ' }),
    '15BC1412V.1');
});
