// test/productPricing.test.js
//
// MRP IS WHAT THE CUSTOMER PAYS. GST IS BACKED OUT OF IT, NEVER ADDED TO IT.
//
// Owner, 04-Oct-2026: "the base price + GST should be equal to mrp." Before this, SBR
// sold MAK 4T 1L at a ₹400 selling price and the invoice read ₹472.00 — GST added on
// top. These cases pin the invariant to the paisa, including the awkward ones.
const test = require('node:test');
const assert = require('node:assert');
const { priceLine, priceInvoice, refundLine } = require('../src/services/productPricing');

const paise = n => Math.round(n * 100);
const adds = l => paise(l.taxable_amount) + paise(l.cgst_amount) + paise(l.sgst_amount);

test('SBR 04-Oct: a ₹400 MRP is charged ₹400, not ₹472', () => {
  const l = priceLine({ quantity: 1, mrp: 400, gst_rate: 18, buying_price: 329 });
  assert.strictEqual(l.total_amount, 400);
  assert.strictEqual(l.taxable_amount, 338.98);
  assert.strictEqual(l.cgst_amount, 30.51);
  assert.strictEqual(l.sgst_amount, 30.51);
  assert.strictEqual(l.below_cost, false);
});

test('base + GST equals the MRP total to the paisa, across awkward figures', () => {
  for (const q of [1, 2, 3, 4, 7, 0.5, 2.5, 12.345])
    for (const m of [8.5, 9.99, 99.99, 123.45, 400, 1234.56])
      for (const r of [0, 5, 12, 18, 28]) {
        const l = priceLine({ quantity: q, mrp: m, gst_rate: r });
        assert.strictEqual(adds(l), paise(l.total_amount), `${q} × ₹${m} @ ${r}%`);
        assert.strictEqual(l.total_amount, Math.round(q * paise(m)) / 100, `${q} × ₹${m} @ ${r}%`);
        assert.strictEqual(l.cgst_amount, l.sgst_amount, `equal halves ${q} × ₹${m} @ ${r}%`);
      }
});

test('a discount in % comes off the line, and the GST is backed out of what is left', () => {
  const l = priceLine({ quantity: 1, mrp: 400, gst_rate: 18, discount_mode: 'pct', discount_value: 10 });
  assert.strictEqual(l.discount_amount, 40);
  assert.strictEqual(l.total_amount, 360);
  assert.strictEqual(adds(l), 36000);
});

test('a discount in rupees comes off the line total', () => {
  const l = priceLine({ quantity: 4, mrp: 8.5, gst_rate: 18, discount_mode: 'amt', discount_value: 2 });
  assert.strictEqual(l.gross, 34);
  assert.strictEqual(l.total_amount, 32);
  assert.strictEqual(adds(l), 3200);
});

test('below the buying price is FLAGGED, not refused', () => {
  const l = priceLine({ quantity: 1, mrp: 400, gst_rate: 18, buying_price: 329,
                        discount_mode: 'pct', discount_value: 20 });
  assert.strictEqual(l.error, undefined);
  assert.strictEqual(l.total_amount, 320);
  assert.strictEqual(l.below_cost, true);
});

test('a discount bigger than the line, or over 100%, or negative, is refused', () => {
  assert.ok(priceLine({ quantity: 1, mrp: 100, discount_mode: 'amt', discount_value: 100.01 }).error);
  assert.ok(priceLine({ quantity: 1, mrp: 100, discount_mode: 'pct', discount_value: 101 }).error);
  assert.ok(priceLine({ quantity: 1, mrp: 100, discount_mode: 'pct', discount_value: -1 }).error);
  assert.ok(priceLine({ quantity: 0, mrp: 100 }).error);
});

test('the invoice header is the sum of its lines, exactly', () => {
  const lines = [priceLine({ quantity: 4, mrp: 8.5, gst_rate: 18 }),
                 priceLine({ quantity: 1, mrp: 400, gst_rate: 18, discount_mode: 'pct', discount_value: 7.5 })];
  const h = priceInvoice(lines);
  assert.strictEqual(paise(h.grand_total), lines.reduce((s, l) => s + paise(l.total_amount), 0));
  assert.strictEqual(paise(h.subtotal) + paise(h.total_cgst) + paise(h.total_sgst), paise(h.grand_total));
});

test('a line returned in pieces refunds exactly what was charged — no paisa lost', () => {
  const l = priceLine({ quantity: 4, mrp: 8.5, gst_rate: 18 });
  const a = refundLine(l, 1, 0), b = refundLine(l, 2, 1), c = refundLine(l, 1, 3);
  assert.strictEqual(paise(a.total_amount) + paise(b.total_amount) + paise(c.total_amount), paise(l.total_amount));
  for (const r of [a, b, c]) {
    assert.strictEqual(adds(r), paise(r.total_amount));
    assert.strictEqual(r.cgst_amount, r.sgst_amount);
  }
});

test('a total that does not divide evenly still refunds to the paisa (₹10.00 over 3)', () => {
  // 3 × ₹4 less ₹2 = ₹10.00. Each third is ₹3.333…; rounding each return alone would
  // refund ₹9.99 in total.
  const l = priceLine({ quantity: 3, mrp: 4, gst_rate: 18, discount_mode: 'amt', discount_value: 2 });
  assert.strictEqual(l.total_amount, 10);
  const parts = [refundLine(l, 1, 0), refundLine(l, 1, 1), refundLine(l, 1, 2)];
  assert.strictEqual(parts.reduce((s, r) => s + paise(r.total_amount), 0), 1000);
});

test('an invoice raised BEFORE the change refunds exactly as charged too', () => {
  // GST-on-top line as stored by the old code: 1 × ₹400 + 18% = ₹472.00
  const old = { quantity: 1, unit_price: 400, gst_rate: 18, taxable_amount: 400,
                cgst_amount: 36, sgst_amount: 36, total_amount: 472 };
  const r = refundLine(old, 1, 0);
  assert.strictEqual(r.total_amount, 472);
  assert.strictEqual(r.taxable_amount, 400);
});
