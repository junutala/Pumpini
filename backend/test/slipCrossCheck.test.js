// THE RUPEE/LITRE CROSS-CHECK, pinned against the slips that actually broke trust.
//
// A dispenser slip prints THREE labelled figures per nozzle: A (cumulative rupees),
// V (cumulative litres) and TOT SALES (a count). /reconcile/pos-meter used to carry
// its own prompt calling the slip "a cumulative totalizer... read its digits" — a
// mechanical dial, one number — so the model returned the largest run of digits on
// the page, which is A. It then reported itself legible, because the DIGITS were
// sharp; legibility was certifying character clarity, not field identity.
//
// Two outlets stopped scanning because of it. These cases are their real figures.
const test = require('node:test');
const assert = require('node:assert');
const { normalizeSlipNozzles } = require('../src/services/slipParser');

const one = raw => normalizeSlipNozzles([raw])[0];

// ── Kamala, pump 15BC1412V, slip printed 23-JUN-2026 08:00 ────────────────────
test('Kamala nozzle 1 — the true V is accepted', () => {
  const r = one({ nozzle_no: '1', cumulative_volume: '1654130.510', cumulative_amount: '149343626.920', legible: true });
  assert.strictEqual(r.cumulative_volume, 1654130.51);
  assert.strictEqual(r.legible, true, 'a genuine reading must still pass');
  assert.ok(r.implied_price > 40 && r.implied_price < 200, `Rs ${r.implied_price}/L is a real pump price`);
});

test('Kamala nozzle 2 — the true V is accepted', () => {
  const r = one({ nozzle_no: '2', cumulative_volume: '2131447.940', cumulative_amount: '195417174.200', legible: true });
  assert.strictEqual(r.cumulative_volume, 2131447.94);
  assert.strictEqual(r.legible, true);
});

test('THE FAILURE: A returned where V belongs is REFUSED, not offered', () => {
  // What we actually stored on 23-Jun at 09:42:58 for 15BC1412V.2.
  const r = one({ nozzle_no: '2', cumulative_volume: '195417174.200', cumulative_amount: '2131447.940', legible: true });
  assert.strictEqual(r.legible, false, 'the model said legible; the cross-check must overrule it');
  assert.ok(r.swapped_amount_for_volume || r.reject_reason, 'must carry a reason the screen can show');
});

test('a volume with NO amount beside it is refused — nothing to check it against', () => {
  const r = one({ nozzle_no: '1', cumulative_volume: '1654130.510', cumulative_amount: null, legible: true });
  assert.strictEqual(r.legible, false);
  assert.strictEqual(r.reject_reason, 'no_amount_to_cross_check');
});

// ── Sri Balaji, pump 17FH3756V, 25-Aug-2026 20:52 ─────────────────────────────
// Stored reading 17558851.620 on a nozzle whose real movement that shift was 5.78 L.
test('Sri Balaji 25-Aug — the 17.5-million-litre reading is refused', () => {
  const r = one({ nozzle_no: '1', cumulative_volume: '17558851.620', cumulative_amount: '178493.630', legible: true });
  assert.strictEqual(r.legible, false, 'this reached production flagged legible');
});

test('an implied price outside a real pump band is refused', () => {
  // Rs 9.09/L — the misread amount case called out in #306.
  const r = one({ nozzle_no: '1', cumulative_volume: '4013000.00', cumulative_amount: '36478759.7', legible: true });
  assert.strictEqual(r.legible, false);
  assert.strictEqual(r.reject_reason, 'implied_price_out_of_band');
});

test('a line the model itself called illegible stays illegible', () => {
  const r = one({ nozzle_no: '1', cumulative_volume: '1654130.510', cumulative_amount: '149343626.920', legible: false });
  assert.strictEqual(r.legible, false);
});

// ── THE PAIR THAT WAS WRONG TOGETHER ────────────────────────────────────────────
// The implied-price band tests a RATIO, so it catches a digit lost on ONE side and is
// blind to a pair that is wrong in step. Sri Balaji, 26-Aug-2026 12:59, the fallback
// engine, on a serial matching no pump at the outlet — both lines came back
// legible: true because Rs 57 and Rs 54 sit comfortably inside 40–200.
test('168 million litres is refused, however sane the price looks', () => {
  const [a, b] = normalizeSlipNozzles([
    { nozzle_no: '1', cumulative_volume: 168018917.48, cumulative_amount: 9582453838.501, legible: true },
    { nozzle_no: '2', cumulative_volume: 179986210,    cumulative_amount: 9795824538.501, legible: true },
  ]);
  assert.strictEqual(a.reject_reason, 'volume_not_physical');
  assert.strictEqual(b.reject_reason, 'volume_not_physical');
  assert.strictEqual(a.legible, false, 'the model called it legible; the physics does not');
  assert.strictEqual(b.legible, false);
  // And the price it implied was never the problem — it was perfectly plausible.
  assert.ok(a.implied_price === null || (a.implied_price > 40 && a.implied_price < 200));
});

test('a real lifetime totaliser is nowhere near the ceiling', () => {
  // Sri Balaji's busiest nozzle on the same day: 4,022,304.57 L at Rs 91.56.
  const [ok] = normalizeSlipNozzles([
    { nozzle_no: '1', cumulative_volume: 4022304.57, cumulative_amount: 368264002, legible: true },
  ]);
  assert.strictEqual(ok.reject_reason, undefined);
  assert.strictEqual(ok.legible, true);
});
