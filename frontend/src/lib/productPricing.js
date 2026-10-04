// GENERATED from backend/src/services/productPricing.js by
// backend/scripts/ci-product-pricing-sync.js. Do not edit — edit the service and
// run that script with --write. CI fails if the two differ.
// services/productPricing.js
//
// THE PRICE OF A PRODUCT LINE — MRP INCLUSIVE, GST BACKED OUT. The one place the sum
// is done; POST /products/invoices calls it for the totals and the credit-limit check,
// and returns call refundLine. The sale screens and the returns screen use a GENERATED
// copy (frontend/src/lib/productPricing.js, scripts/ci-product-pricing-sync.js) only
// to show the figure before it is charged — never a hand-kept second version.
//
// Owner, 04-Oct-2026: "Change the selling price to MRP. This is the amount that should
// be sold to the customer. The GST has to be back-calculated and not added to the MRP
// ... Ensure that the MRP is the amount that is printed and charged to the customer.
// So, the base price + GST should be equal to mrp."
//
// WHAT IT REPLACED. The invoice took products.selling_price as the PRE-tax rate and
// added GST on top: SBR sold MAK 4T 1L at a ₹400 selling price on 04-Oct and the
// invoice read ₹472.00. A price above MRP cannot be charged to a retail customer.
//
// THE ARITHMETIC IS IN PAISE, so the invariant holds exactly rather than to a float:
//
//     gross    = qty × MRP
//     discount = gross × pct / 100   or   the rupees typed, for the LINE
//     total    = gross − discount                       ← what the customer pays
//     taxable  = total × 100 / (100 + rate)             ← rounded to the paisa, and
//                                                          one paisa up if needed so
//                                                          the GST halves evenly
//     gst      = total − taxable                        ← the remainder, never rounded
//     cgst     = sgst = gst / 2                         ← always equal
//
// so taxable + cgst + sgst === total, always, to the paisa. GST is the REMAINDER, not
// a second rounding, which is the only way the two can never disagree.
//
// unit_price keeps its old meaning — the PRE-GST rate per unit — because every reader
// of product_invoice_items already treats it that way (margin, Tally, returns). It is
// informational and rounded; the line's money lives in taxable/cgst/sgst/total.

const toPaise = v => Math.round(Number(v) * 100);
const rupees  = p => p / 100;

// A discount the screen sent, validated. Returns { paise } or { error }.
function discountPaise(gross, mode, value) {
  if (value === undefined || value === null || value === '') return { paise: 0 };
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return { error: 'Discount must be zero or more.' };
  if (mode === 'pct') {
    if (v > 100) return { error: 'A discount cannot be more than 100%.' };
    return { paise: Math.round(gross * v / 100) };
  }
  const p = toPaise(v);
  if (p > gross) return { error: 'A discount cannot be more than the line total.' };
  return { paise: p };
}

// One line. `mrp`, `gst_rate`, `buying_price` come from the PRODUCT ROW on the server,
// never from the client: the MRP is a printed fact about the pack, not a figure the
// till may change. Only quantity and the discount are the cashier's.
function priceLine({ quantity, mrp, gst_rate, buying_price, discount_mode, discount_value }) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return { error: 'Quantity must be more than zero.' };
  const rate = Number(gst_rate ?? 18);
  if (!Number.isFinite(rate) || rate < 0) return { error: 'GST rate is not valid.' };

  const mrpP  = toPaise(mrp);
  const gross = Math.round(qty * mrpP);
  const d = discountPaise(gross, discount_mode === 'pct' ? 'pct' : 'amt', discount_value);
  if (d.error) return { error: d.error };

  const total   = gross - d.paise;
  let   taxable = Math.round(total * 100 / (100 + rate));
  // CGST and SGST are each half the rate, so on a tax invoice they must be EQUAL. An
  // odd paisa of GST cannot be halved; it goes into the taxable value instead (off by
  // at most one paisa from the exact back-calculation), never into one half of the tax.
  if ((total - taxable) % 2 !== 0) taxable += 1;
  const gst     = total - taxable;
  const cgst    = gst / 2;
  const sgst    = cgst;

  // Below what the outlet paid — an alert, never a refusal (owner, 04-Oct: "give an
  // alert, but let the transaction continue"). Compared per unit, against the buying
  // price as it was entered.
  const buyP = toPaise(buying_price || 0);
  const below_cost = buyP > 0 && total < Math.round(qty * buyP);

  return {
    quantity: qty,
    gst_rate: rate,
    mrp: rupees(mrpP),
    gross: rupees(gross),
    discount_amount: rupees(d.paise),
    total_amount: rupees(total),
    taxable_amount: rupees(taxable),
    cgst_amount: rupees(cgst),
    sgst_amount: rupees(sgst),
    unit_price: Math.round(taxable / qty) / 100,
    net_unit: rupees(Math.round(total / qty)),
    buying_price: rupees(buyP),
    below_cost,
  };
}

// The whole bill, summed in paise so the header agrees with its lines exactly.
function priceInvoice(lines) {
  let sub = 0, cg = 0, sg = 0, grand = 0, disc = 0;
  for (const l of lines) {
    sub += toPaise(l.taxable_amount); cg += toPaise(l.cgst_amount);
    sg  += toPaise(l.sgst_amount);    grand += toPaise(l.total_amount);
    disc += toPaise(l.discount_amount);
  }
  return { subtotal: rupees(sub), total_cgst: rupees(cg), total_sgst: rupees(sg),
           grand_total: rupees(grand), total_discount: rupees(disc) };
}

// A RETURN REFUNDS THE SHARE OF WHAT WAS CHARGED — not unit_price × qty × (1 + rate).
// unit_price is rounded to the paisa, so rebuilding a line from it drifts (4 × ₹8.50 =
// ₹34.00 rebuilds as ₹33.98), and after a discount it rebuilds a price that was never
// charged at all.
//
// The share is taken CUMULATIVELY — what returning (already + now) is worth, less what
// returning `already` was worth — so a line returned in pieces refunds exactly its
// total, never a paisa more or less than was charged.
function refundLine(line, returnQty, alreadyReturned = 0) {
  const qty = Number(line.quantity), r = Number(returnQty), a = Number(alreadyReturned) || 0;
  const upto = (p, n) => Math.round(toPaise(p) * n / qty);
  const total   = upto(line.total_amount, a + r) - upto(line.total_amount, a);
  let   taxable = Math.min(upto(line.taxable_amount, a + r) - upto(line.taxable_amount, a), total);
  if ((total - taxable) % 2 !== 0) taxable += 1;     // equal halves, as on the sale
  const gst     = total - taxable;
  const cgst    = gst / 2;
  return {
    quantity: r,
    unit_price: Number(line.unit_price),
    gst_rate: Number(line.gst_rate),
    taxable_amount: rupees(taxable),
    cgst_amount: rupees(cgst),
    sgst_amount: rupees(gst - cgst),
    total_amount: rupees(total),
  };
}

export { priceLine, priceInvoice, refundLine, discountPaise };
