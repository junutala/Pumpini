// A NEAR MISS PROPOSES; IT NEVER ASSUMES.
//
// Every misread below is a REAL one, taken from the Sri Balaji scans of 25/26-Aug, and
// the "known" set is that outlet's five actual machines. The point of these cases is
// the boundary: close enough to offer, never close enough to accept on its own.
const test = require('node:test');
const assert = require('node:assert');
const { proposeSerial } = require('../src/lib/serialMatch');

// Sri Balaji's real pumps.
const KNOWN = ['17CH2645V', '17CH2653V', '17EH2900V', '17EH2910V', '17FH3756V'];

test('one letter wrong — 17CH2900V proposes 17EH2900V', () => {
  const p = proposeSerial('17CH2900V', KNOWN);
  assert.strictEqual(p.serial, '17EH2900V');
  assert.strictEqual(p.distance, 1);
});

test('a BADLY chewed read proposes nothing — it earns the loud card', () => {
  // H28253V, a real 26-Aug misread of 17CH2653V, is FOUR edits away. That is a guess,
  // not a near miss, and dressing it as a suggestion teaches the manager to tap through
  // suggestions. It is not silent either: an unproposed line gets the wrong-outlet /
  // no-match card, which is the point of §10 rule 2.
  assert.strictEqual(proposeSerial('H28253V', KNOWN), null);
});

test('A CORRECT SERIAL IS NEVER OFFERED AS A DIFFERENT REAL PUMP', () => {
  // The bug the first draft shipped with. 17CH2645V and 17CH2653V are two of this
  // outlet's OWN machines and sit two edits apart, so a threshold of two turned a
  // perfectly good read into a proposal to change it into its neighbour.
  for (const real of KNOWN) assert.strictEqual(proposeSerial(real, KNOWN), null);
});

test('one digit wrong — 17CH2659V still proposes 17CH2653V', () => {
  const p = proposeSerial('17CH2659V', KNOWN);
  assert.strictEqual(p.serial, '17CH2653V');
  assert.strictEqual(p.distance, 1);
});

test('rubbish is NOT dressed up as a near miss — 2444 proposes nothing', () => {
  // Offering 17FH3756V for "2444" would insult the manager and teach him to tap
  // through the proposal, which is the whole failure mode this is meant to avoid.
  assert.strictEqual(proposeSerial('2444', KNOWN), null);
});

test('an exact match is not a proposal — it is already a match', () => {
  assert.strictEqual(proposeSerial('17CH2645V', KNOWN), null);
});

test('AMBIGUITY IS NOT A PROPOSAL — two machines equally close offers neither', () => {
  // 17EH2900V and 17EH2910V differ by one character, so a read sitting between them is
  // one edit from each. A coin toss dressed as a suggestion is worse than a loud card.
  assert.strictEqual(proposeSerial('17EH29?0V', ['17EH2900V', '17EH2910V']), null);
});

test('nothing configured, nothing proposed', () => {
  assert.strictEqual(proposeSerial('17CH2900V', []), null);
  assert.strictEqual(proposeSerial('', KNOWN), null);
});

test('a serial from ANOTHER outlet is not quietly adopted', () => {
  // Nagole, 20-Aug: the slips were Sri Balaji's machines. Read at Kamala, whose pumps
  // look nothing like them, they must propose nothing at all.
  assert.strictEqual(proposeSerial('17CH2645V', ['15BC1412V', '201807000908', 'CNG']), null);
});
