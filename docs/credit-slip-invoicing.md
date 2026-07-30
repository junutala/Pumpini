# Credit slip books & credit invoicing — design

> Owner-set, 29-Jul-2026. Agreed in discussion; **not yet built**. Build starts with
> the book register (piece 1 below). Read this before writing any code for it —
> several decisions here were reached by rejecting a more obvious approach, and the
> reasoning matters more than the conclusion.

---

## 1. Why — the bolt-on strategy

A competitor sells a **Tally bolt-on** for fuel outlets (shift start, nozzle sales,
credit sales, attendant reco). It is what makes Tally usable for a bunk, and it is
the incumbent. One owner switched to Pumpini after seeing our apps — so we win on
the **forecourt experience**, not on feature count. Tally cannot follow us onto the
driveway.

**Our position (owner call): be the bolt-on, not the replacement.**

- Core statutory reporting stays in **Tally**; the CA keeps working there.
- Pumpini owns the **source data** — the shift floor, the slips, the fuel documents.
- `backend/src/routes/tally.js` (Tally Prime XML, balanced vouchers, idempotent
  `REMOTEID`) is the bridge, and it is an **asset, not a competitor**: it lets us take
  the dealer's daily keying away from Tally while the accountant notices nothing.

We do not win a head-on "replace Tally" argument — Tally's real user is the CA, held
by statutory books, GST returns and audit trail. We win by removing reasons to open
it. Repeat per touchpoint; Tally shrinks to a compliance shell.

**Consequence for this build:** Pumpini mints the credit-invoice number (§6), and
**that number must travel into Tally as the voucher reference**, so the CA's ledger
and the customer's invoice never show different numbers. `REMOTEID` keeps re-import
idempotent.

---

## 2. The two physical documents

### a) Requisition coupon (the credit authorisation)

Pre-printed two-part book (**ORIGINAL + DUPLICATE**, perforated). The credit
customer's driver hands it over to get fuel. One part is retained by the outlet; the
other goes back to the customer **with the credit invoice**.

Real sample:

| Field | Value |
|---|---|
| Coupon No. | 17702 (red serial) |
| Date | 12/07/26 → **12 July 2026** (DD/MM, always) |
| Dealer | Sri Balaji Oil Company — HPCL, Nalgonda |
| Sri (customer) | GVPR |
| Vehicle No. | TS 05 FQ 0975 |
| Petrol | 25 ltrs |
| Diesel / Engine Oil / Others | nil |
| Terms | "Cost thereof will be paid at your current rate Lts/Kgs." |
| Authentication | Signature + round office seal ("Office Seal with Signature is must") |

**The coupon carries QUANTITY, never value.** The rupee amount is derived later from
the selling rate (§5).

### b) Monthly credit invoice (what goes out today, from Tally)

Real sample — `Shree Balaji Oil Co 2627`, GSTIN `36AACFB3245L1ZI`, Telangana (36):

- **Bill To:** SLMI INFRA PROJECT (P) LTD. *(Address, Tel, GSTIN blank on their copy)*
- **Date** 30-Jun-26 · **Inv No.** `BS/2026-2027/31` · **Period** 1-Jun-26 to 30-Jun-26
- Columns: `Sl No. | Chln. Date | Slip No. | Vehicle No. | Description of Goods |
  HSN/SAC | Quantity (Shipped | Billed) | Rate (Incl. of Tax) | Rate | per | Amount`
- 25 lines then "continued …"; slips 1003–1028; petrol @ 115.55, diesel @ 103.68
- Footer: "This is a Computer Generated Invoice"; `IRN` / `Ack No.` / `Ack Date` blank

**One line = one coupon.** Confirmed: `Chln. Date` + `Slip No.` + `Vehicle No.` per row.

Arithmetic verified: 4 × 115.55 = 462.20 · 5 × 115.55 = 577.75 · 2,000 × 103.68 = 2,07,360.00

Two observations from the sample that shaped the design:

- **Slip 1011 is missing** (1003–1028 present, out of slip order, so not a sort
  artifact). It is either on a later page, another customer's, or **unbilled fuel** —
  and from the document alone nobody can tell. This is the gap the book register
  closes (§4).
- **Two lines carry the invoice.** Two 2,000 L diesel fills to TS08UE 6886 at
  ₹2,07,360 each ≈ ₹4.1L of a ~₹4.2L invoice; the other 23 lines total ~₹11k. A
  misread on a bulk line is catastrophic, on a 4 L line trivial ⇒ **magnitude check
  on capture**, and note a 2,000 L "fill" is a bowser load, not a nozzle fill.

---

## 3. The model — REUSE the credit sale, do not build a parallel ledger

> **Corrected 30-Jul-2026.** The first draft of this section proposed a standalone
> slip ledger with its own invoice generator. That was wrong, and building it would
> have created exactly the drift `CLAUDE.md` forbids. Reading the code first showed
> that **most of this already exists**.

### What already exists

`POST /api/invoices` (`routes/invoices.js`) is already a working credit-invoice
generator: it writes `gst_invoices` (with `period_from`/`period_to`, `line_items`
jsonb, opening-balance handling), marks the billed lines, bumps the invoice
sequence, posts the credit-suspense drawdown, and 409s on a cross-station invoice
number collision.

And `dispense_events` — the credit sale record, written by `POST /api/dispense`
(`payment_mode='credit'` + `corporate_id`, with a credit-limit check) — already
carries nearly every column the Tally invoice needs:

| Invoice column | `dispense_events` |
|---|---|
| Chln. Date | `occurred_at` |
| Vehicle No. | `vehicle_number` |
| Description of Goods | `fuel_type` |
| Quantity | `quantity_ltrs` |
| Rate (incl. of tax) | `rate_per_ltr` (NOT NULL) |
| Amount | `amount` — GENERATED as `quantity_ltrs * rate_per_ltr` |
| — | `corporate_id`, `attendant_id`, `shift_id`, `source` (default `'pos'`), `is_voided` |

**Including "mark as invoiced".** `is_invoiced` + `invoice_id` already exist and are
set by the invoice writer in the same transaction. We do **not** add a second flag:
two markers can disagree, one cannot.

Exactly one column is genuinely missing: **the coupon number.**

### So the model is

**The coupon is not a second sale record — it is the paper authorisation for a sale
we already record.** Therefore:

1. **Book register** — genuinely new (`credit_slip_books`, §4). Nothing to reuse.
2. **Coupon capture** — ADD to `dispense_events`: `coupon_book_id`, `coupon_no`,
   plus **`UNIQUE (coupon_book_id, coupon_no)`**. That index *is* the
   no-double-invoicing guarantee — enforced by Postgres rather than by a flag
   someone must remember to set — and it simultaneously kills the
   original-plus-duplicate double-entry risk (each slip is a two-part form). Capture
   funnels through the existing `POST /api/dispense` writer with `source='coupon'`.
3. **Invoice generation** — EXTEND `POST /api/invoices`. Three gaps only: the Tally
   print layout (Slip No. and Vehicle both come free once step 2 lands), FY-aware
   numbering (§6), and a print view.

This keeps **one** credit ledger, **one** invoiced marker, and **one**
credit-suspense drawdown. It is also a much smaller build than the first draft implied.

### Pricing: store the amount at capture, never derive at invoice time

Owner call, 30-Jul: **calculate and store the amount when the coupon is captured**,
with the rate taken as at the coupon date, so fetching a coupon later for invoicing
has no dependency on the rate card.

This needs no new mechanism: `dispense_events.rate_per_ltr` is NOT NULL and `amount`
is a generated column, so storing quantity + rate freezes the amount on the row. The
invoice then simply reads it.

⇒ The historic-rate lookup is a **backfill helper for batch entry** (keying a coupon
days later), not the main pricing path. A coupon captured on the day already has the
right rate. Either way the invoice stays reproducible years later.

**Prices are per OUTLET and genuinely differ.** Verified in prod on the same week:
Kamala petrol ₹116.15 vs Highway ₹115.09, diesel ₹104.23 vs ₹103.24 — about ₹1/L.
On a 4 L fill that is ₹4; on one of the 2,000 L bulk diesel lines it is **₹2,120**.
`fuel_prices.station_id` is already populated on every row (0 nulls), so the striping
exists — it just has to be *used*: resolve `(station, fuel, coupon date)`, never a
global rate. This also lines up with books being per outlet, so there is no
cross-outlet ambiguity to design around.

Resolve rates **once per (fuel, date)** for a whole invoice, not once per line — the
June sample had 25 lines but only a handful of distinct fuel/date pairs.

### Quantity: the manager is the check, not the machine

Owner call, 30-Jul: don't build quantity cross-validation. The coupon is handwritten,
the OCR is advisory, and **nothing auto-commits** — the manager eyeballs every line
before confirming. Responsibility sits with the manager, exactly as with the
gauge-screen scan.

### What is still missing

| Missing | Note |
|---|---|
| Book register | New — this slice |
| `coupon_book_id` / `coupon_no` on `dispense_events` | Additive, next slice |
| FY-aware invoice series | `station_settings` has `invoice_prefix` + `invoice_seq` but no FY dimension (§6) |
| Tally print layout + print view | Rendering over existing data |

**Lubes are out of scope** (owner, 29-Jul) — a GST invoice function already exists for
them. Fuel only, so there is no GST split to compute: petrol/diesel sit outside GST
and the pump rate is already all-inclusive. Note `gst_invoices.cgst_rate`/`sgst_rate`
default to **9** — fuel invoices must pass **0**.

## 4. Slip books — the control record

Modelled on a **cheque book**, deliberately: issue, range, leaf, presented, stopped,
exhausted. Books are **per customer**.

The printer's numbering convention **does not matter** — we define the series and
assign it on one screen, so whatever the books happen to say, the register is the
source of truth. (Owner to confirm the real convention, but nothing depends on it.)

**One validation keeps this unambiguous:** no two *active* books for the same customer
with **overlapping ranges**. Enforce at issue time, and the lookup
`(customer, slip no) → book` is always single-valued. Uniqueness is then
**`(book, leaf)`** — never slip number alone, because slip numbers are demonstrably
not unique across books (the samples show 17702 and 1003–1028, different series).

A part-used book handed over just takes a **"start from" leaf** instead of the printed
first leaf. Same screen, one extra field.

### Validation stack on presenting a slip

1. **Slip no. ∈ a book issued to _this_ customer, book active** — authorisation.
   Catches a forged slip, another customer's book, a book reported lost.
2. **Vehicle ∈ that customer's registered vehicles** — identity. Same
   match-on-one-key-verify-with-another pattern as the gauge-screen tank matching.
3. **Leaf not already presented** — duplicate. Airtight because every slip is a
   two-part original + duplicate, so double entry is a live risk.
4. **Slip date ≥ book issue date** — the post-dated-cheque check.
5. **Quantity vs `per_fill_limit`; balance vs `credit_limit`** — exposure.

**Out-of-range should SUGGEST, not merely reject.** A driver presenting 1211 when the
customer holds 1001–1100 is almost certainly a one-digit OCR misread of 1011. Offer
"not in any book for this customer — did you mean 1011?" Rejection is right; silence
is not.

### What the register buys

"Slip 1011 is missing" goes from unanswerable to definite: presented-and-billed,
unused, cancelled, or **unaccounted**. Only the last is a problem, and today it cannot
be distinguished from the other three. **This leakage detector is the real product;
the invoice is a byproduct.**

---

## 5. Pricing — effective rate as at the slip date

The coupon says "cost thereof will be paid at your current rate", so:

> amount = quantity × the latest `fuel_prices` row for that **station + fuel** whose
> `effective_from` is on or before the **slip date**.

`fuel_prices` is a **change-log, not a daily snapshot** — a row means "this rate holds
until superseded". Indian RSP is stable for long stretches, so a June row is legitimately
the effective rate for a July slip. **Do not treat an old `effective_from` as stale, and
do not block on it** — an earlier draft of this design proposed refusing to price when
the newest rate was more than a day or two old; that would have blocked essentially
every legitimate invoice. Rejected.

What to do instead:

- **Show the working on the invoice preview:** `25 L petrol × ₹110.00 (effective 22 Jun)
  = ₹2,750.00`. Whoever generates the invoice sees which rate was used and when it was
  set. A board change that never got entered is caught there — before the bill goes out.
  Absence of a row cannot distinguish "price did not change" from "nobody entered it";
  this is inherent, and displaying the rate is the proportionate answer.
- **Flag only the genuine edge case:** a price change landing **on the slip's own date**.
  The slip carries a date but no time, so there is no way to know which side of the
  change the fill was on. Rare, and flag that line only.
- **Compare in `Asia/Kolkata`.** `effective_from` is `timestamptz`, the slip date is a
  calendar date in IST. A rate set late in the evening lands on the wrong side of a date
  boundary if compared in UTC.
- Store the **rate applied and its `effective_from`** on the slip row. The invoice must
  be reproducible years later even if prices change a hundred times since.

**Dates are DD/MM, always** (house rule, restated by the owner). `12/07/26` is 12 July.
An OCR reading it as MM/DD gets 7 December — five months wrong on a document that
determines when a debt was incurred.

---

## 6. Invoice numbering — Pumpini owns it

Owner call. This is a **statutory artifact**, so it is a heavier responsibility than
any other number Pumpini mints:

- **Allocate at commit, never before.** The classic failure: reserve number → render
  fails → number burned → unexplainable gap. Assign in the **same transaction** as the
  invoice row.
- **No reuse, no deletion.** A wrong invoice is cancelled by **credit note**
  (`product_credit_notes` exists) — never by freeing the number.
- **Concurrency must be DB-enforced.** Two managers running month-end simultaneously
  must not collide. `SELECT max()+1` in app code will eventually double-issue in
  production; use a row lock or sequence.
- **Immutable once issued.** Sent invoices cannot be edited, only credit-noted.
- **Series is per station, per financial year:** prefix + FY + counter, configured per
  outlet (`BS/` is specific to Shree Balaji Oil Co 2627). Its own series — do **not**
  reuse `product_invoice_seq`; mixing shop and fuel numbering is confusing at audit.

### ⚠️ Cutover

Their Tally is at **`BS/2026-2027/31`**. Pumpini must start at **32**, not 1. That is an
opening-number field **per station, per FY**, set at go-live. Getting it wrong on day
one is painful to unwind.

### Known gap, not a blocker

The template carries **IRN / Ack No. / Ack Date** (blank on the sample). If the dealer
crosses the e-invoicing turnover threshold, invoices need IRP registration and a QR —
which Tally does and Pumpini does not. Fuel sits outside GST, so it may not apply to
these lines at all. **Ask the CA**; better to know now than at a turnover milestone.

---

### Nozzle-image note (30-Jul)

`dispense_events.photo_url` is ALREADY used by an existing upload endpoint in
`routes/dispense.js`, so it must not be overloaded for the nozzle-meter photo. Use a
separate artifacts table keyed to the sale — `(dispense_event_id, kind, storage_path,
media_type, captured_at, ocr jsonb)` with `kind` in `'coupon' | 'nozzle_meter'` — so
enabling the nozzle image later needs no migration, just a new `kind`. Keep
`meter_quantity_ltrs` nullable on `dispense_events` for the meter reading; the
coupon-vs-meter comparison is deliberately NOT built (the manager is the check).

## 7. Rollout — advisory before enforcing

**The single biggest operational risk.** Every book currently in circulation is
unregistered. If enforcement goes live first, **every slip fails validation and credit
sales stop at the counter** — the Start-Shift operator picker failure again, but on a
money path.

Phase it:

1. Register books (including opening position for part-used books).
2. Run the validation stack **advisory** — flag, never block — until coverage looks
   complete.
3. Switch to enforcing, **per station**, so one outlet's incomplete data cannot block
   the others.

---

## 8. Decisions log (29-Jul-2026)

| Question | Answer |
|---|---|
| Books per customer or shared? | **Per customer** |
| Does the printer's series convention matter? | **No** — we define and assign the series on one screen |
| Monthly consolidated or per-coupon invoice? | **Monthly consolidated** (confirmed by the sample: Period 1-Jun to 30-Jun) |
| Lubes / engine oil in scope? | **No — parked.** GST invoice function already exists |
| Invoice numbering owner | **Pumpini** (start at `BS/2026-2027/32`) |
| Replace Tally or feed it? | **Be the bolt-on.** Core reporting stays in Tally; Pumpini's invoice number travels into the Tally voucher |
| Price basis | **Effective rate as at the slip date**, not today's |
| Enforce book ranges from day one? | **No — advisory first**, then per-station enforcement |

### Decisions added 30-Jul-2026

| Question | Answer |
|---|---|
| Books per station or across outlets? | **Per station (outlet).** The units print their own books, so the number sequence is unique per outlet and Pumpini has no control over the printing |
| Consequence | The no-overlap rule is scoped to `station_id` ALONE, not to the customer ⇒ `(station, coupon no)` resolves to one book and therefore one customer. The name on the coupon is a CHECK, not the key |
| Build a parallel slip ledger? | **No.** Reuse `dispense_events` + `POST /api/invoices` (§3). The coupon is the authorisation for a sale we already record |
| Mark coupon as invoiced | Reuse the EXISTING `is_invoiced` / `invoice_id` on `dispense_events` — plus `UNIQUE (coupon_book_id, coupon_no)` as the DB-level guarantee |
| Amount: derive at invoice time? | **No — calculate and store at capture**, rate as at the coupon date. No rate-card dependency when the coupon is fetched later |
| Quantity cross-check vs the meter | **Not built.** Coupon is handwritten, OCR is advisory, nothing auto-commits — the manager verifies and commits |
| Are prices per outlet? | **Yes, already** — `fuel_prices.station_id`, 0 nulls, and outlets genuinely differ (~₹1/L observed) |
| Invoice number format + start number | Set on the **outlet definition screen**. `station_settings` already has `invoice_prefix` + `invoice_seq`; needs an FY dimension |
| Importing existing books | **Excel → SQL**, run by **superadmin only**. No import utility exposed to outlets unless it turns out to be trivial |

### Still open

- The 2,000 L bulk diesel fills — do they go through a coupon, or are they handled
  separately? (bowser load, not a nozzle fill)
- Confirm the `BS/` prefix per outlet and the opening number (**32** for
  `BS/2026-2027/`).
- Does e-invoicing/IRN apply to these fuel lines? (CA question)
- Actual printed series convention (owner checking — nothing depends on it, since the
  register is the source of truth)

---

## 9. Impact-analysis pre-work

Per the checklist at the top of `CLAUDE.md`, to be completed properly in each PR:

1. **Schema** — new tables (book register, slip ledger, fuel-credit invoice + items,
   FY series). All additive; nothing existing altered. Owner-run DDL, step-gated.
2. **Consumers** — new surfaces mostly. Touch points to watch: `corporate_accounts`
   (outstanding), `credit_suspense_entries`, `routes/tally.js` (voucher must carry the
   Pumpini invoice number), the credit dashboard.
3. **Blast radius** — capture and invoicing must degrade gracefully; a failed OCR or a
   missing book must never block a credit sale at the counter (hence §7).
4. **Multi-tenant** — books and slips are station-scoped **and** customer-scoped;
   `corporate_station_links` governs which outlets a customer may draw at. A slip from
   one outlet's book must never validate at another.
5. **Money** — squarely: this bills a paying third party. Every derived amount shows
   its working (§5); nothing auto-issues without a human confirming.
6. **Rollback** — invoices are cancelled by credit note, never deleted. Schema is
   additive, so code revert is clean.
