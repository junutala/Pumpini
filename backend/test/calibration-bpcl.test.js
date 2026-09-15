// test/calibration-bpcl.test.js
//
// Pins dipToVolume against BPCL's OWN dip-chart calculator.
//
// Provenance. The dealer at SBR Energies sent BPCL's "TANK CALIBRATION ALL CHARTS"
// workbook (Calicut Territory) — a chart GENERATOR, not a fixed chart: pick a tankage
// from a dropdown, a VLOOKUP pulls that tank's length and diameter, and a circular-
// segment formula turns a dip into litres. Its sheet computes
//
//     V = L · R² · (α − sin α · cos α) · 1000        where cos α = 1 − H/R
//
// which is the same equation as ours rearranged:
//
//     A = r² · acos((r−h)/r) − (r−h) · √(2rh − h²)   =   r² · (α − sin α cos α)
//
// The figures below are BPCL's own computed values for 10KL(1.84D) — inside length
// 3.99 m, diameter 1.84 m — sampled across the full range, empty to full. Over all 367
// of its points our mean deviation was 0.00256 L and the maximum 0.005 L, which is
// exactly our own 2-decimal rounding (their 5268.085 → our 5268.09). No real difference
// anywhere in the range.
//
// 🔴 ONE TRAP, recorded so nobody "fixes" the test to match the wrong number. The
// workbook's PRINTED chart shows 11 L at a 1 cm dip. That cell is a STALE CACHED VALUE —
// its own increment cell reads 12 where the calculation sheet says 0, and the live
// formula behind it computes 7.2046. The values here come from the CALCULATION sheet,
// not the printed one. An official document is not automatically a correct one.
const test   = require('node:test');
const assert = require('node:assert');
const { dipToVolume } = require('../src/lib/calibration');

// 10KL(1.84D) — BPCL's own standard tankage. [dip cm, litres]
const BPCL_10KL = [
  [1.0, 7.2046],
  [1.5, 13.2249],
  [2.0, 20.3444],
  [7.0, 132.1137],
  [13.0, 330.9858],
  [19.0, 578.7853],
  [25.0, 864.3388],
  [31.0, 1180.5708],
  [37.0, 1522.3353],
  [43.0, 1885.5798],
  [49.0, 2266.9402],
  [55.0, 2663.5156],
  [61.0, 3072.7292],
  [67.0, 3492.2382],
  [73.0, 3919.869],
  [79.0, 4353.5705],
  [85.0, 4791.3771],
  [91.0, 5231.3783],
  [91.5, 5268.085],
  [92.0, 5304.7928],
  [92.5, 5341.5006],
  [93.0, 5378.2074],
  [97.0, 5671.692],
  [103.0, 6110.4405],
  [109.0, 6545.7255],
  [115.0, 6975.6029],
  [121.0, 7398.0537],
  [127.0, 7810.95],
  [133.0, 8212.0113],
  [139.0, 8598.7474],
  [145.0, 8968.3779],
  [151.0, 9317.7127],
  [157.0, 9642.9619],
  [163.0, 9939.4073],
  [169.0, 10200.758],
  [175.0, 10417.6274],
  [181.0, 10572.2721],
  [183.0, 10602.381],
  [183.5, 10607.0363],
  [184.0, 10609.5856],
];

test('dipToVolume reproduces BPCL\'s own chart across the full dip range', () => {
  let worst = { dev: 0 };
  for (const [dip, theirs] of BPCL_10KL) {
    const ours = dipToVolume(184, 399, dip);
    const dev  = Math.abs(ours - theirs);
    if (dev > worst.dev) worst = { dip, theirs, ours, dev };
  }
  assert.ok(worst.dev <= 0.01,
    `max deviation ${worst.dev} L at dip ${worst.dip} cm (BPCL ${worst.theirs}, ours ${worst.ours})`);
});

// Two readings taken live from the workbook by the owner, 15-Sep-2026, at the SAME dip
// on two tanks that share a diameter — so they also pin that volume scales with length.
// The 45 KL is SBR Energies' actual tank 1.
test('it matches the live tool on the 45 KL and 70 KL at the same dip', () => {
  assert.strictEqual(dipToVolume(273.8,  825, 64.8),  8788.90);   // 45 KL, D 2.738 x L 8.25
  assert.strictEqual(dipToVolume(273.8, 1300, 64.8), 13849.17);   // 70 KL, D 2.738 x L 13.0
});

// 🔴 THE NAMEPLATE IS NOT THE SHELL VOLUME. Every BPCL standard tank holds more than its
// name — this is the error that under-read Sri Balaji's petrol by 661 L on 25-Aug, and
// SBR's 45 KL would be five times worse. A full dip must give the SHELL volume, never
// the number on the side of the tank.
test('a full dip gives the shell volume, not the nameplate', () => {
  assert.strictEqual(dipToVolume(273.8, 825,   273.8), 48574.77);  // "45 KL"  → +3,574.77 L
  assert.strictEqual(dipToVolume(200,   496.8, 200),   15607.43);  // "15 KL"  →   +607.43 L
  assert.strictEqual(dipToVolume(184,   399,   184),   10609.59);  // "10 KL"  →   +609.59 L
});
