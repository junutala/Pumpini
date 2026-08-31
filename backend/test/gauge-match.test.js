// THREE CONSECUTIVE SCANS OF ONE CONSOLE, 31-Aug-2026. Rows copied verbatim from the
// station_artifacts each scan produced. Nothing here is invented.
//
// The reader got a different thing wrong each time and one thing right every time:
//
//   13:53  products SWAPPED           labels 1/3 right    capacities right
//   15:59  "Power" on the petrol row  labels 1/2/3 wrong  capacities right
//   16:11  products all right         labels 1/2/3 wrong  capacities right
//
// So the matcher keys on fuel + CAPACITY. These pin that the two bad reads place
// nothing and the good read places everything — including with wrong tank numbers.
const test = require('node:test');
const assert = require('node:assert');
const { matchGaugeRows } = require('./helpers/gaugeMatch.cjs');

const NAGOLE = [   // === Sri Balaji's configuration, mirrored
  { id: 't1', tank_number: 1, fuel_type: 'diesel',         capacity_ltrs: 22000 },
  { id: 't3', tank_number: 3, fuel_type: 'petrol',         capacity_ltrs: 16000 },
  { id: 't4', tank_number: 4, fuel_type: 'premium_petrol', capacity_ltrs: 9000  },
];
const DILSUKHNAGAR = [
  { id: 'd1', tank_number: 1, fuel_type: 'diesel', capacity_ltrs: 20000 },
  { id: 'd2', tank_number: 2, fuel_type: 'diesel', capacity_ltrs: 20000 },
  { id: 'd3', tank_number: 3, fuel_type: 'petrol', capacity_ltrs: 15000 },
];
const byTank = m => Object.fromEntries(m.pairs.map(([t, r]) => [t.tank_number, r.net_volume_ltrs]));

test('13:53 — the products were swapped, so nothing is placed', () => {
  const m = matchGaugeRows([
    { tank_label:'1', product:'petrol', product_raw:'MS',  net_volume_ltrs:4629.06, capacity_ltrs:22000 },
    { tank_label:'3', product:'diesel', product_raw:'HSD', net_volume_ltrs:7877.26, capacity_ltrs:16000 },
  ], DILSUKHNAGAR);
  assert.equal(m.pairs.length, 0, 'a swapped product must never place a reading');
  assert.equal(m.mismatched.length, 2);
});

test('15:59 — "Power" on the petrol row: the good tank fills, the bad rows do not', () => {
  const m = matchGaugeRows([
    { tank_label:'1', product:'diesel',         product_raw:'HSD',   net_volume_ltrs:4629.06, capacity_ltrs:22000 },
    { tank_label:'2', product:'premium_petrol', product_raw:'Power', net_volume_ltrs:7877.26, capacity_ltrs:16000 },
    { tank_label:'3', product:null,             product_raw:null,    net_volume_ltrs:7231.46, capacity_ltrs:9000  },
  ], NAGOLE);
  assert.deepEqual(byTank(m), { 1: 4629.06 });
  assert.equal(m.mismatched.length, 1, 'premium claiming a 16,000 L tank is refused');
  assert.equal(m.unplaced.length, 1,   'a row with no product at all has no tank to go to');
});

test('16:11 — products right, tank numbers 1/2/3 wrong: ALL THREE still fill correctly', () => {
  const m = matchGaugeRows([
    { tank_label:'1', product:'diesel',         product_raw:'HSD',   net_volume_ltrs:4629.06, capacity_ltrs:22000 },
    { tank_label:'2', product:'petrol',         product_raw:'MS',    net_volume_ltrs:7877.26, capacity_ltrs:16000 },
    { tank_label:'3', product:'premium_petrol', product_raw:'Power', net_volume_ltrs:7231.46, capacity_ltrs:9000  },
  ], NAGOLE);
  assert.deepEqual(byTank(m), { 1: 4629.06, 3: 7877.26, 4: 7231.46 });
  assert.equal(m.mismatched.length, 0);
  // The two the console misnumbered are placed and SAID SO, never silently — but
  // CONFIRMED, because fuel and capacity both agreed. A note, not a warning: the
  // screens count only unconfirmed ones, so this reads 'Success — proceed'.
  assert.equal(m.renumbered.length, 2);
  assert.ok(m.renumbered.every(r => r.confirmed === true));
  assert.equal(m.renumbered.filter(r => !r.confirmed).length, 0, 'nothing for the manager to check');
});

test('a fuel-only match, with no capacity to confirm it, is NOT confirmed', () => {
  // IOCL prints no capacity, so one key placed this. It stays worth a look.
  const m = matchGaugeRows(
    [{ tank_label: '9', product: 'petrol', product_raw: 'Motor Spirit', net_volume_ltrs: 5537.96 }],
    [{ id: 'k3', tank_number: 3, fuel_type: 'petrol', capacity_ltrs: 15000 }]);
  assert.equal(m.pairs.length, 1);
  assert.equal(m.renumbered.length, 1);
  assert.equal(m.renumbered[0].confirmed, false);
});

test('a card-only IOCL console keeps fuel-alone matching (Kamala, 23-Aug rule)', () => {
  // Console numbers 1=MS, 2=HSD, 3=HSD against Settings 1/2/3 diesel/diesel/petrol,
  // and it prints NO capacity. Requiring a second key here would fill one tank of
  // three — exactly what the 23-Aug rule was written to prevent.
  const m = matchGaugeRows([
    { tank_label:'1', product:'petrol', product_raw:'Motor Spirit',      net_volume_ltrs:5537.96 },
    { tank_label:'2', product:'diesel', product_raw:'High Speed Diesel', net_volume_ltrs:5727.95 },
    { tank_label:'3', product:'diesel', product_raw:'High Speed Diesel', net_volume_ltrs:12915.61 },
  ], [
    { id:'k1', tank_number:1, fuel_type:'diesel', capacity_ltrs:20000 },
    { id:'k2', tank_number:2, fuel_type:'diesel', capacity_ltrs:20000 },
    { id:'k3', tank_number:3, fuel_type:'petrol', capacity_ltrs:15000 },
  ]);
  assert.equal(m.pairs.length, 3, 'all three tanks must still fill');
  assert.equal(m.mismatched.length, 0);
});

test('two same-fuel same-size tanks: the tank NUMBER separates them', () => {
  // Highway and Hayat Nagar each run two 22,000 L diesel tanks. Capacity cannot tell
  // them apart, so the number does its proper job as a tiebreaker.
  const m = matchGaugeRows([
    { tank_label:'2', product:'diesel', net_volume_ltrs:6605.26,  capacity_ltrs:22000 },
    { tank_label:'1', product:'diesel', net_volume_ltrs:12609.03, capacity_ltrs:22000 },
  ], [
    { id:'h1', tank_number:1, fuel_type:'diesel', capacity_ltrs:22000 },
    { id:'h2', tank_number:2, fuel_type:'diesel', capacity_ltrs:22000 },
  ]);
  assert.deepEqual(byTank(m), { 1: 12609.03, 2: 6605.26 });
});

test('a volume beyond the installed tank is still refused outright', () => {
  const m = matchGaugeRows(
    [{ tank_label:'1', product:'diesel', net_volume_ltrs:99999, capacity_ltrs:22000 }],
    [{ id:'t1', tank_number:1, fuel_type:'diesel', capacity_ltrs:22000 }]);
  assert.equal(m.pairs.length, 0);
  assert.equal(m.overCapacity.length, 1);
});
