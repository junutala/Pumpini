// THE RUPEE/LITRE CROSS-CHECK'S CEILING, anchored to the outlet's own board price.
//
// Numbers here are real. The two genuine lines are Kamala's ETOT slip as stored in
// station_artifacts; the diesel price is Kamala's own, ₹104.23.
const test = require('node:test');
const assert = require('node:assert');
const { normalizeSlipNozzles } = require('../src/services/slipParser');
const { CEILING_FACTOR } = require('../src/services/priceService');

const line = (v, a) => ({ nozzle_no: '1', cumulative_volume: v, cumulative_amount: a, legible: true });
const one  = (n, opts) => normalizeSlipNozzles([n], opts)[0];

const DIESEL = 104.23;
const CEILING = DIESEL * CEILING_FACTOR;   // 109.44

test('the two GENUINE Kamala lines pass under the outlet-anchored ceiling', () => {
  // 149,343,626.92 / 1,654,130.51 = 90.29 and 195,417,174.20 / 2,131,447.94 = 91.68 —
  // 12-13% BELOW today's board, because a lifetime average lags a rising price.
  for (const [v, a, want] of [[1654130.51, 149343626.92, 90.29],
                              [2131447.94, 195417174.20, 91.68]]) {
    const r = one(line(v, a), { maxImpliedPrice: CEILING });
    assert.equal(r.implied_price, want);
    assert.equal(r.legible, true, `₹${want} must survive a ₹${CEILING.toFixed(2)} ceiling`);
    assert.equal(r.reject_reason, undefined);
  }
});

test('a line implying ₹195/L is REFUSED — it used to pass the flat ₹200 band', () => {
  const v = 1000000, a = 195000000;              // exactly ₹195.00/L
  assert.equal(one(line(v, a)).legible, true, 'the old flat band accepted this');
  const r = one(line(v, a), { maxImpliedPrice: CEILING });
  assert.equal(r.legible, false);
  assert.equal(r.reject_reason, 'implied_price_out_of_band');
});

test('the ceiling that judged the line travels with it, so a refusal can explain itself', () => {
  const r = one(line(1000, 195000), { maxImpliedPrice: CEILING });
  assert.equal(r.price_ceiling, CEILING);
});

test('no ceiling supplied falls back to the absolute band, unchanged', () => {
  const r = one(line(1654130.51, 149343626.92));
  assert.equal(r.price_ceiling, 200);
  assert.equal(r.legible, true);
});

test('a caller cannot LOOSEN the absolute band', () => {
  // A bad price row must never buy a slip more room than 200.
  const r = one(line(1000, 500000), { maxImpliedPrice: 9999 });   // ₹500/L
  assert.equal(r.price_ceiling, 200);
  assert.equal(r.legible, false);
});

test('a null or nonsense ceiling is ignored rather than trusted', () => {
  for (const bad of [null, undefined, 0, -5, NaN, 'abc']) {
    assert.equal(one(line(1654130.51, 149343626.92), { maxImpliedPrice: bad }).price_ceiling, 200);
  }
});

test('the FLOOR is untouched — an old meter reading well under today’s price still passes', () => {
  // A pump commissioned years ago can sit far below the board. 40 stays until there
  // are real slips to tune it from; a 5% floor would reject the two genuine lines above.
  const r = one(line(1000000, 45000000), { maxImpliedPrice: CEILING });   // ₹45.00/L
  assert.equal(r.implied_price, 45);
  assert.equal(r.legible, true);
});

test('a volume with no amount beside it is still refused outright', () => {
  const r = one({ nozzle_no: '1', cumulative_volume: 140500859, cumulative_amount: null, legible: true },
                { maxImpliedPrice: CEILING });
  assert.equal(r.reject_reason, 'no_amount_to_cross_check');
  assert.equal(r.legible, false);
});
