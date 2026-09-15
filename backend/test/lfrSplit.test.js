// test/lfrSplit.test.js
//
// Pins the LFR apportionment. This imports the REAL function out of the deliveries
// route (the same way the gauge tests pin withGaugeChecks) rather than restating the
// rule — a test that re-implements what it is testing passes forever and proves nothing.
//
// The anchor case is a real invoice: BPCL FIIN112710061073, 07-Sep-2026, SBR Energies,
// against fuel invoice 1303629797 of the same date — MS 4 KL + HSD 8 KL, taxable
// ₹4,730.64. The published 'A' site card is ₹443.50/KL (MS) and ₹369.58/KL (HSD).
//
// 🔴 WHAT THIS TEST CAUGHT. The first version of the split apportioned BY VOLUME, and
// this file failed it. Volume alone gives every litre the same ₹0.3942, when the OMC
// actually charged ₹0.4435 on petrol and ₹0.3696 on diesel — the invoice TOTAL comes out
// right and every per-fuel figure comes out wrong, in the same direction every time.
// The rates have to be supplied, because the LFR invoice bills one undifferentiated line
// ("LFR for CC (MS/HSD)") and cannot tell us the split itself.
const test   = require('node:test');
const assert = require('node:assert');

const { apportionLfr } = require('../src/routes/deliveries');

const sum  = rows => +rows.reduce((s, r) => s + r.lfr, 0).toFixed(2);
const A_SITE = { petrol: 443.50, diesel: 369.58 };

// Volume-descending, as the route passes them.
const BPCL_ROWS = [
  { id: 'hsd', fuel_type: 'diesel', gross_volume_ltrs: 8000 },
  { id: 'ms',  fuel_type: 'petrol', gross_volume_ltrs: 4000 },
];

test('with the rate card, it reproduces the OMC\'s own split to the paisa', () => {
  const split = apportionLfr(BPCL_ROWS, 4730.64, A_SITE);
  const byId  = Object.fromEntries(split.map(s => [s.id, s.lfr]));

  assert.strictEqual(split.method, 'per_fuel_rate');
  assert.strictEqual(byId.hsd, 2956.64, 'HSD share must equal 8 KL x 369.58');
  assert.strictEqual(byId.ms,  1774.00, 'MS share must equal 4 KL x 443.50');
  assert.strictEqual(sum(split), 4730.64, 'the parts must sum to the invoice');
});

test('the per-litre rates it implies are the ones a manager can check against the card', () => {
  const split = apportionLfr(BPCL_ROWS, 4730.64, A_SITE);
  assert.strictEqual(+(split[0].lfr / split[0].ltrs).toFixed(4), 0.3696);  // HSD 369.58/KL
  assert.strictEqual(+(split[1].lfr / split[1].ltrs).toFixed(4), 0.4435);  // MS  443.50/KL
});

test('WITHOUT rates it falls back to flat per-litre and says so', () => {
  const split = apportionLfr(BPCL_ROWS, 4730.64);
  assert.strictEqual(split.method, 'flat_per_litre',
    'the caller must be able to tell the owner the attribution is approximate');
  // Every litre carries the same share — right total, approximate attribution.
  assert.strictEqual(+(split[0].lfr / split[0].ltrs).toFixed(4), 0.3942);
  assert.strictEqual(sum(split), 4730.64, 'even approximate, the total is still exact');
});

test('a partial rate card does not half-apply — it falls back for the whole invoice', () => {
  // Diesel known, petrol not. Mixing methods inside one invoice would be indefensible.
  const split = apportionLfr(BPCL_ROWS, 4730.64, { diesel: 369.58 });
  assert.strictEqual(split.method, 'flat_per_litre');
  assert.strictEqual(sum(split), 4730.64);
});

test('the parts always sum to the invoice, even when the split does not divide evenly', () => {
  const rows = [
    { id: 'a', fuel_type: 'diesel', gross_volume_ltrs: 5000 },
    { id: 'b', fuel_type: 'petrol', gross_volume_ltrs: 3333 },
    { id: 'c', fuel_type: 'petrol', gross_volume_ltrs: 1667 },
  ];
  assert.strictEqual(sum(apportionLfr(rows, 1000.01, A_SITE)), 1000.01,
    'rounding must be absorbed, not lost — a column that does not total is one nobody trusts');
  assert.strictEqual(sum(apportionLfr(rows, 1000.01)), 1000.01,
    'and the same holds on the fallback path');
});

test('a single delivery takes the whole invoice', () => {
  const split = apportionLfr([{ id: 'only', fuel_type: 'diesel', gross_volume_ltrs: 12000 }], 5582.16, A_SITE);
  assert.strictEqual(split.length, 1);
  assert.strictEqual(split[0].lfr, 5582.16);
});

test('a zero LFR stays zero on every row rather than becoming NaN', () => {
  const split = apportionLfr(BPCL_ROWS, 0, A_SITE);
  assert.deepStrictEqual(split.map(s => s.lfr), [0, 0]);
});

test('it reports the litres and fuels it split on, so the working can be shown', () => {
  const split = apportionLfr(BPCL_ROWS, 4730.64, A_SITE);
  assert.deepStrictEqual(split.map(s => s.ltrs), [8000, 4000]);
  assert.deepStrictEqual(split.map(s => s.fuel_type), ['diesel', 'petrol']);
});

test('a B-site card gives a different, and much smaller, split', () => {
  // 'B' site: dealer owns the land, OMC owns only the equipment.
  const B_SITE = { petrol: 184.34, diesel: 153.62 };
  const total  = +(4 * 184.34 + 8 * 153.62).toFixed(2);   // 1,966.32
  const split  = apportionLfr(BPCL_ROWS, total, B_SITE);
  const byId   = Object.fromEntries(split.map(s => [s.id, s.lfr]));
  assert.strictEqual(byId.ms,  737.36);
  assert.strictEqual(byId.hsd, 1228.96);
  assert.strictEqual(sum(split), total);
});

// ── Site-category inference ───────────────────────────────────────────────────
// The LFR invoice never says which card it was billed on, and the manager should not
// have to know. Given the volumes and the total, only one card reconciles — so we read
// the category off the paper instead of storing a setting somebody can get wrong.
const { matchCard } = require('../src/config/lfrRates');

test('infers the A-site card from the real BPCL invoice', () => {
  const m = matchCard(BPCL_ROWS, 4730.64);
  assert.ok(m, 'a card must be identified');
  assert.strictEqual(m.category, 'A');
  assert.strictEqual(m.gst_pct, 18);
  assert.strictEqual(m.expected, 4730.64);
  assert.strictEqual(m.delta, 0);
});

test('infers the B-site card from the same volumes billed at B rates', () => {
  const m = matchCard(BPCL_ROWS, 1966.32);   // 4x184.34 + 8x153.62
  assert.ok(m);
  assert.strictEqual(m.category, 'B');
  assert.strictEqual(m.gst_pct, 28);
});

test('refuses to guess when neither card explains the invoice', () => {
  // A revised rate card, or a mis-billed invoice. We must NOT quietly pick the nearest.
  assert.strictEqual(matchCard(BPCL_ROWS, 3500.00), null);
});

test('refuses when a fuel on the invoice is not priced by the card', () => {
  const rows = [{ id: 'c', fuel_type: 'cng', gross_volume_ltrs: 5000 }];
  assert.strictEqual(matchCard(rows, 2217.50), null);
});

test('the inferred card, fed to the split, reproduces the OMC line by line', () => {
  const m = matchCard(BPCL_ROWS, 4730.64);
  const split = apportionLfr(BPCL_ROWS, 4730.64, m.rates_per_kl);
  assert.strictEqual(split.method, 'per_fuel_rate');
  assert.deepStrictEqual(split.map(s => s.lfr), [2956.64, 1774.00]);
});
