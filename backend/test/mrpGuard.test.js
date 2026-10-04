// test/mrpGuard.test.js
//
// WHEN IS A REQUEST CHANGING A PRODUCT'S MRP? Owner, 04-Oct-2026: "restrict MRP edits
// to managers." Since #447 the MRP is the price every product sale is charged at, so
// the guard must catch every change — and must NOT catch a request that leaves the
// price alone, or tying a barcode and receiving stock stop working for the people who
// do them.
const test = require('node:test');
const assert = require('node:assert');
const { mrpChanging } = require('../src/services/mrpGuard');

test('a different price is a change', () => {
  assert.strictEqual(mrpChanging('400.00', 420), true);
  assert.strictEqual(mrpChanging('400.00', '399.99'), true);
});

test('the same price, however it is written, is not a change', () => {
  // The catalogue form sends the whole product back, price included, on every edit.
  assert.strictEqual(mrpChanging('400.00', 400), false);
  assert.strictEqual(mrpChanging('400.00', '400'), false);
  assert.strictEqual(mrpChanging('8.50', '8.5'), false);
});

test('not touching the price is not a change', () => {
  // e.g. the Stock screen tying a barcode sends { barcode } only.
  for (const v of [undefined, null, '']) assert.strictEqual(mrpChanging('400.00', v), false);
});

test('a new product sets an MRP', () => {
  assert.strictEqual(mrpChanging(null, 250), true);
});

test('stock receipt: 0 means "leave the price", exactly as the receipt writes it', () => {
  assert.strictEqual(mrpChanging('400.00', 0, { zeroIsUnset: true }), false);
  assert.strictEqual(mrpChanging('400.00', '0', { zeroIsUnset: true }), false);
  assert.strictEqual(mrpChanging('400.00', 450, { zeroIsUnset: true }), true);
  // Without the flag a typed 0 IS a change (the catalogue would write it).
  assert.strictEqual(mrpChanging('400.00', 0), true);
});
