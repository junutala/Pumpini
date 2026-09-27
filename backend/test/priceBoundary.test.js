// A PRICE CHANGE AT A NOZZLE-LED OUTLET READS ONLY THAT FUEL'S NOZZLES.
//
// Owner, 27-Sep-2026: "IF there are four nozzles tied to a pump dispense different fuel,
// the pump sends out one printout with ALL four nozzles. SO, we should obtain the fuel
// type that is getting a price change and read only those nozzles for that fuel type
// and not all and push the settlement into suspense."
const test = require('node:test');
const assert = require('node:assert');
const { priceBoundaryPlan } = require('../src/services/priceService');

// Pump 1 carries four nozzles: two petrol, two diesel. 3.1 is petrol and was never
// commissioned (no chain).
const nozzles = [
  { id: 'p11', fuel_type: 'petrol', head_event_id: 'e1', nozzle_name: '1.1 · M2601076.1' },
  { id: 'd12', fuel_type: 'diesel', head_event_id: 'e2', nozzle_name: '1.2 · M2601076.2' },
  { id: 'p13', fuel_type: 'petrol', head_event_id: 'e3', nozzle_name: '1.3 · M2601076.3' },
  { id: 'd14', fuel_type: 'diesel', head_event_id: 'e4', nozzle_name: '1.4 · M2601076.4' },
  { id: 'p31', fuel_type: 'petrol', head_event_id: null, nozzle_name: '3.1 · M2601180.1' },
];
// The one printout, all four lines read.
const printout = [
  { nozzle_id: 'p11', reading: '1990.29' }, { nozzle_id: 'd12', reading: '2203.89' },
  { nozzle_id: 'p13', reading: '1633.39' }, { nozzle_id: 'd14', reading: '1702.66' },
];

test('A PETROL CHANGE TAKES ONLY THE PETROL LINES of a mixed printout — the owner\'s case', () => {
  const plan = priceBoundaryPlan({ fuel_type: 'petrol', nozzles, readings: printout });
  assert.deepStrictEqual(plan.take.map(t => t.nozzle.id), ['p11', 'p13']);
  assert.deepStrictEqual(plan.ignored.sort(), ['d12', 'd14'], 'the diesel lines are never written');
  assert.deepStrictEqual(plan.missing, []);
});

test('a diesel change takes only the diesel lines of the same printout', () => {
  const plan = priceBoundaryPlan({ fuel_type: 'diesel', nozzles, readings: printout });
  assert.deepStrictEqual(plan.take.map(t => t.nozzle.id), ['d12', 'd14']);
  assert.deepStrictEqual(plan.ignored.sort(), ['p11', 'p13']);
});

test('a nozzle of that fuel with no reading blocks the change — every leg must be split', () => {
  const plan = priceBoundaryPlan({ fuel_type: 'petrol', nozzles,
    readings: [{ nozzle_id: 'p11', reading: '1990.29' }, { nozzle_id: 'p13', reading: '  ' }] });
  assert.deepStrictEqual(plan.missing.map(n => n.id), ['p13']);
});

test('a nozzle never commissioned needs no reading: it has no leg to split', () => {
  const plan = priceBoundaryPlan({ fuel_type: 'petrol', nozzles, readings: printout });
  assert.ok(!plan.need.some(n => n.id === 'p31'));
});

test('a fuel with no commissioned nozzles needs nothing', () => {
  const plan = priceBoundaryPlan({ fuel_type: 'premium_petrol', nozzles, readings: printout });
  assert.deepStrictEqual(plan.need, []);
  assert.deepStrictEqual(plan.missing, []);
  assert.strictEqual(plan.ignored.length, 4);
});
