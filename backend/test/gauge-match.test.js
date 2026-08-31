// THE 31-AUG-2026 SWAP, pinned.
//
// A gauge scan of Sri Balaji's console returned tank_label "1" as MS/petrol and
// tank_label "3" as HSD/diesel. The console prints the exact opposite. Volumes,
// labels and capacities stayed correctly paired; only the two product WORDS traded
// places. "Fuel decides" then put the petrol tank's 7877.26 into a diesel tank.
//
// The rows below are copied verbatim from station_artifacts 89ba600b, the artifact
// that scan produced. Nothing here is invented.
const test = require('node:test');
const assert = require('node:assert');

// The matcher is an ES module in the frontend; this exercises the same rules against
// the same data. Kept in the backend suite because that is the suite CI runs.
const { matchGaugeRows } = require('./helpers/gaugeMatch.cjs');

// Sri Balaji / Nagole, exactly as Settings records them.
const TANKS = [
  { id: 't1', tank_number: 1, fuel_type: 'diesel',         capacity_ltrs: 22000 },
  { id: 't3', tank_number: 3, fuel_type: 'petrol',         capacity_ltrs: 16000 },
  { id: 't4', tank_number: 4, fuel_type: 'premium_petrol', capacity_ltrs: 9000  },
];

// What the console actually prints.
const GOOD = [
  { tank_label: '1', product: 'diesel',         product_raw: 'HSD',   net_volume_ltrs: 4629.06, capacity_ltrs: 22000 },
  { tank_label: '3', product: 'petrol',         product_raw: 'MS',    net_volume_ltrs: 7877.26, capacity_ltrs: 16000 },
  { tank_label: '4', product: 'premium_petrol', product_raw: 'Power', net_volume_ltrs: 7231.46, capacity_ltrs: 9000  },
];

// What the reader returned on 31-Aug: the two product words swapped.
const SWAPPED = [
  { tank_label: '1', product: 'petrol', product_raw: 'MS',  net_volume_ltrs: 4629.06, capacity_ltrs: 22000 },
  { tank_label: '3', product: 'diesel', product_raw: 'HSD', net_volume_ltrs: 7877.26, capacity_ltrs: 16000 },
];

test('a correct table read fills every tank', () => {
  const m = matchGaugeRows(GOOD, TANKS, { table_state: 'used' });
  assert.equal(m.pairs.length, 3);
  assert.equal(m.mismatched.length, 0);
  const byTank = Object.fromEntries(m.pairs.map(([t, r]) => [t.tank_number, r.net_volume_ltrs]));
  assert.equal(byTank[1], 4629.06);   // diesel
  assert.equal(byTank[3], 7877.26);   // petrol
  assert.equal(byTank[4], 7231.46);   // premium
});

test('the swapped read fills NOTHING when the console printed a table', () => {
  const m = matchGaugeRows(SWAPPED, TANKS, { table_state: 'used' });
  assert.equal(m.pairs.length, 0, 'a swapped product must never place a reading');
  assert.equal(m.mismatched.length, 2);
  assert.deepEqual(m.mismatched.map(x => x.console).sort(), ['1', '3']);
});

test('the swap is what SHIPPED before the fix — fuel alone still misplaces it', () => {
  // Not a wish, a record: with no table declared, fuel decides and the figures land
  // in the wrong tanks. This is why the gate is tied to table_state.
  const m = matchGaugeRows(SWAPPED, TANKS, { table_state: 'absent' });
  const byTank = Object.fromEntries(m.pairs.map(([t, r]) => [t.tank_number, r.net_volume_ltrs]));
  assert.equal(byTank[1], 7877.26, 'diesel tank gets the petrol figure');
  assert.equal(byTank[3], 4629.06, 'petrol tank gets the diesel figure');
});

test('a card-only console keeps fuel-alone matching (Kamala/IOCL, 23-Aug rule)', () => {
  // Console numbers 1=MS, 2=HSD, 3=HSD against Settings 1=diesel, 2=diesel, 3=petrol.
  // Requiring both keys here would fill one tank of three, which is what the 23-Aug
  // rule was written to prevent.
  const iocl = [
    { tank_label: '1', product: 'petrol', product_raw: 'Motor Spirit',      net_volume_ltrs: 5537.96 },
    { tank_label: '2', product: 'diesel', product_raw: 'High Speed Diesel', net_volume_ltrs: 5727.95 },
    { tank_label: '3', product: 'diesel', product_raw: 'High Speed Diesel', net_volume_ltrs: 12915.61 },
  ];
  const kamala = [
    { id: 'k1', tank_number: 1, fuel_type: 'diesel', capacity_ltrs: 20000 },
    { id: 'k2', tank_number: 2, fuel_type: 'diesel', capacity_ltrs: 20000 },
    { id: 'k3', tank_number: 3, fuel_type: 'petrol', capacity_ltrs: 15000 },
  ];
  const m = matchGaugeRows(iocl, kamala, { table_state: 'absent' });
  assert.equal(m.pairs.length, 3, 'all three tanks must still fill');
  assert.equal(m.mismatched.length, 0);
});
