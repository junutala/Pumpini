// The two arithmetic checks a gauge scan carries, pinned against REAL rows.
//
// Both were live and one was wrong: `net + ullage = capacity` used a ±1% band and
// flagged 23 of the 33 tank rows on file (70%), including every reading since
// confirmed correct. A check that fails on good data teaches everyone to ignore the
// flag — which is exactly what happened, and why a genuinely swapped read on 31-Aug
// sailed through with checks_ok:false on both bad rows and nobody the wiser.
const test = require('node:test');
const assert = require('node:assert');
const { withGaugeChecks } = require('../src/routes/dipstick');

const run = tank => withGaugeChecks({ tanks: [tank] }).tanks[0];

test('gross − water = net still catches a misread gross', () => {
  // 31-Aug, Dilsukhnagar: gross came back 7800.78 for a true 7888.78.
  const t = run({ gross_volume_ltrs: 7800.78, net_volume_ltrs: 7877.26, water_ltrs: 11.52 });
  assert.equal(t.checks_ok, false);
  assert.ok(t.checks.some(c => c.includes('water')));
});

test('gross − water = net passes a clean row', () => {
  // Sri Balaji diesel: 4633.26 − 4.20 = 4629.06, exactly.
  const t = run({ gross_volume_ltrs: 4633.26, net_volume_ltrs: 4629.06, water_ltrs: 4.20 });
  assert.equal(t.checks_ok, true);
});

test('a shell that exceeds its nameplate is NOT flagged', () => {
  // Sri Balaji diesel: 4629.06 + 19032.94 = 23,662 in a tank called 22,000 — 107.6%.
  // CLAUDE.md, 25-Aug: "THE NAMEPLATE IS NOT THE SHELL VOLUME." This row is correct
  // and the old ±1% band called it an error.
  const t = run({ net_volume_ltrs: 4629.06, ullage_ltrs: 19032.94, capacity_ltrs: 22000 });
  assert.equal(t.checks_ok, true, '107.6% of nameplate is a real shell, not a misread');
});

test('the premium tank at 104.6% of nameplate is not flagged either', () => {
  const t = run({ net_volume_ltrs: 7231.46, ullage_ltrs: 2182.54, capacity_ltrs: 9000 });
  assert.equal(t.checks_ok, true);
});

test('a misread ullage IS still flagged', () => {
  // Hayat Nagar: the 22,000 tank's ullage landed on the 9,000 tank — 215.7%.
  const t = run({ net_volume_ltrs: 7231.46, ullage_ltrs: 19032.94, capacity_ltrs: 9000 });
  assert.equal(t.checks_ok, false);
  assert.ok(t.checks.some(c => c.includes('shell')));
});

test('a tank reading well BELOW its shell is flagged too', () => {
  // Net + ullage should still roughly fill the tank; 60% means a figure is missing.
  const t = run({ net_volume_ltrs: 1000, ullage_ltrs: 4400, capacity_ltrs: 9000 });
  assert.equal(t.checks_ok, false);
});

test('a row with nothing to check against is not flagged', () => {
  // IOCL prints no capacity at all — there is simply no test to run.
  const t = run({ net_volume_ltrs: 5537.96, ullage_ltrs: null, capacity_ltrs: null });
  assert.equal(t.checks_ok, true);
});
