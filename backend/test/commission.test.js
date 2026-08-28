// THE COMMISSIONING GATE decides whether an outlet may change its whole operating
// model. It should not be reasoned about only by reading it.
const test = require('node:test');
const assert = require('node:assert');
const { wantsFor } = require('../src/services/commissionService');

test('a fully commissioned nozzle wants nothing', () => {
  assert.deepStrictEqual(
    wantsFor({ pump_serial: '17EH2900V', slip_nozzle_no: '1', events: 2 }), []);
});

test('no serial on file is named', () => {
  assert.ok(wantsFor({ pump_serial: null, slip_nozzle_no: '1', events: 1 }).includes('serial'));
});

// THE ONE THAT MATTERS. A blank printed number is exactly what defaultSlipNo() used to
// paper over — Nagole's 6 nozzles carry a serial and NO printed number, and its 20-Aug
// scan matched 0 of 28 lines.
test('a missing printed number is named, not defaulted', () => {
  assert.deepStrictEqual(
    wantsFor({ pump_serial: '17EH2900V', slip_nozzle_no: '', events: 1 }), ['printed_no']);
  assert.deepStrictEqual(
    wantsFor({ pump_serial: '17EH2900V', slip_nozzle_no: '   ', events: 1 }), ['printed_no']);
});

// A NOZZLE WITH NO CHAIN WAS NEVER COMMISSIONED. Every nozzle in production is in this
// state today (checked 28-Aug: 0 genesis events at all eight outlets), which is why the
// gate holds every outlet until somebody scans.
test('no genesis event means not commissioned, however complete the pair looks', () => {
  assert.deepStrictEqual(
    wantsFor({ pump_serial: '17EH2900V', slip_nozzle_no: '1', events: 0 }), ['genesis']);
});

// "0" IS A REAL PRINTED NUMBER on some machines, and a falsy check would have thrown it
// away in silence — the same class of slip as Number(null) reading as a baseline of
// zero in varianceMath.
test('a printed number of "0" counts as read', () => {
  assert.deepStrictEqual(
    wantsFor({ pump_serial: 'M1832105', slip_nozzle_no: '0', events: 1 }), []);
});

test('a bare nozzle wants all three', () => {
  assert.deepStrictEqual(wantsFor({}), ['serial', 'printed_no', 'genesis']);
});
