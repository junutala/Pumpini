// test/switchBackCarry.test.js
//
// SWITCHING BACK FROM NOZZLE-LED — which reading the first shift opens on.
//
// While an outlet runs nozzle-led, every handover goes to nozzle_events and nothing
// to shift_attendant_nozzles. So when it switches back, its last shift leg is as old
// as the day it switched over, and its chain head is the meter as it stands. Owner,
// 23-Sep-2026: "go ahead with the switch-back fix". carryFrom() is the decision; the
// SQL around it only fetches the two candidates.
const test = require('node:test');
const assert = require('node:assert');
const { carryFrom } = require('../src/services/openingService');

const LEG   = { hasLeg: true, legClosing: '1200.000', legAt: '2026-09-10T06:00:00Z' };
const LATER = '2026-09-20T18:00:00Z';
const EARLIER = '2026-09-01T18:00:00Z';

test('no chain at all — the shift leg carries, exactly as before', () => {
  // Every outlet that has never run nozzle-led. This is the case that must not move.
  const r = carryFrom({ ...LEG, chainReading: null, chainAt: null, chainIsGenesis: null });
  assert.deepStrictEqual(r, { carried: '1200.000', from: 'shift' });
});

test('after a nozzle-led period — the newer handover carries, not the stale leg', () => {
  const r = carryFrom({ ...LEG, chainReading: '1925.000', chainAt: LATER, chainIsGenesis: false });
  assert.deepStrictEqual(r, { carried: 1925, from: 'chain' });
});

test('a genesis alone is a starting point, not a handover — the leg still carries', () => {
  // Commissioned while shift-led: the genesis may have been taken mid-leg, and the
  // leg's own close is the later truth.
  const r = carryFrom({ ...LEG, chainReading: '1150.000', chainAt: LATER, chainIsGenesis: true });
  assert.deepStrictEqual(r, { carried: '1200.000', from: 'shift' });
});

test('a shift after the nozzle-led period wins over the older chain', () => {
  const r = carryFrom({ ...LEG, chainReading: '1100.000', chainAt: EARLIER, chainIsGenesis: false });
  assert.deepStrictEqual(r, { carried: '1200.000', from: 'shift' });
});

test('a nozzle with a chain and no shift leg ever carries the chain', () => {
  const r = carryFrom({ hasLeg: false, legClosing: null, legAt: null,
                        chainReading: '300.500', chainAt: LATER, chainIsGenesis: false });
  assert.deepStrictEqual(r, { carried: 300.5, from: 'chain' });
});

test('a genesis with no shift leg ever carries — it is the only true reading', () => {
  // MBR, 23-Sep-2026: ten of twelve nozzles commissioned and never on a shift.
  const r = carryFrom({ hasLeg: false, legClosing: null, legAt: null,
                        chainReading: '1835.630', chainAt: LATER, chainIsGenesis: true });
  assert.deepStrictEqual(r, { carried: 1835.63, from: 'chain' });
});

test('nothing anywhere — nothing to carry', () => {
  const r = carryFrom({ hasLeg: false, legClosing: null, legAt: null,
                        chainReading: null, chainAt: null, chainIsGenesis: null });
  assert.deepStrictEqual(r, { carried: null, from: null });
});
