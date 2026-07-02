# Staging test observations (2026-07-02) — batch into ONE consolidated PR

Owner is testing on staging and highlighting issues; collect here, fix together.
Status: 🟢 accepted/no-change · 🔧 to-fix · ✅ fixed-in-consolidated-PR

---

## 1. Shift-start — dip ⇄ litres entry  🟢 ACCEPTED, no change
Works well. Entering a **dip** shows the computed **litres**; entering **litres** does
NOT back-compute a dip (no inverse of the calibration formula). Owner: that's futile /
fine — **keep as is.**

## 2. Shift-start — staggered operators must not force you off the screen  🔧 TO-FIX
Flow today: open shift → dipstick → add ONE operator → the bottom "Start shift" CTA
adds him **and navigates to the dashboard**. To add the next operator the user must go
Start Shift → past dipstick → pick the next one. With ~6 operators arriving staggered,
that round-trip repeats 6×.
Want: after adding an operator (he goes live immediately), **stay on the Operators
screen** ready to add the next. Leaving to the dashboard should be a separate, explicit
action done once, at the end.
Fix direction (for consolidated PR): "Add operator" already adds + stays + clears the
form — keep that as the primary staggered-add path (label it so it's clearly "add &
start this operator"). Make the bottom CTA an explicit "Done — go to dashboard" that
does NOT auto-navigate on every add. (Going-live already happens on Add via
`/assign` → `/shifts/active`, so no operator waits for the rest.)

## 3. Dashboard — MTD tiles + date-driven settlement  🔧 TO-BUILD (refined spec 2026-07-02)
**A) Two MTD tiles (top):**
  - Tile 1 — **MTD Quantity**, with **SKU/fuel-type breakdown** (litres by fuel only).
  - Tile 2 — **MTD Amount** (₹).
  - Comparison: show **last month's MTD** alongside for now (trend baseline). Later,
    once there's enough history, add **YAGO** (year-ago) for year-on-year trend.
**B) Date nav moves INTO the settlement tile:**
  - the date picker sits on the settlement tile with **◀ / ▶ arrows** to step day by
    day (if aesthetics allow). (Retire the top-hero date picker for this view.)
**C) Attendant-wise settlement for the picked date — columns:**
  `Operator · Fuel type · Quantity sold · Cash · UPI · Card · Credit · Petty · Total · Variance`
  Plus a **TOTAL row**: quantity **by fuel type** + total amount → a full day's view
  with all relevant details.

Current build differs: N per-shift sales tiles + top date picker + payment-only
settlement (no fuel type/qty). This spec REPLACES that body layout.

Data (all buildable): MTD & last-month-MTD = SUM(dispense_events) by fuel over the
month windows; per-operator payments + variance from shift_reconciliation; per-operator
fuel qty = SUM(dispense_events) by attendant_id + fuel_type.

Build-details to resolve at build time:
- [ ] Operator mans multiple fuels (multi-nozzle) → one row per **operator×fuel**, or
      one row per **operator** with fuel(s) listed? (Total row aggregates qty by fuel
      either way — recommend operator×fuel sub-rows, subtotalled per operator.)
- [ ] MTD window = 1st-of-month → viewed date; last month = same 1st→same-day window?
- [ ] Do the current **per-shift tiles** stay, or is the day view now just this
      settlement table? (Reading the spec: settlement table replaces the per-shift
      tiles; MTD tiles replace the top summary.)

## 4. NEW FEATURE — Operator self-close (mobile settlement) screen  🔧 TO-BUILD (larger; likely its OWN PR/phase)
An operator-facing, **mobile-first** screen that feeds shift-close + credit invoicing.
Access: **only the operator whose own shift is OPEN** (resolve via `/shifts/active`);
operators tied to the outlet by **mobile number**. Show the **outlet name** prominently.
Operator does, on their phone:
  1. Capture (photo/OCR) OR manually enter **closing meter readings** for their nozzle(s).
  2. Enter closing **Cash, Card, Credit, UPI, Petty cash**.
  3. NEW field **"Cash adj"** — added to cash (effective cash = cash + cash_adj).
  4. Wires into **credit-customer invoice creation** (record credit → invoice).
Backend: populate THIS attendant's shift-close values (`shift_reconciliation`). Reuse
existing routes where possible: `POST /reconcile/operator-cash` (creates the recon row),
`/reconcile/pos-meter` + `/reconcile/ocr-meter` (totalizer photo/OCR). Consider the
existing **voice** route for voice-to-action.

⚠️ BIG DEPENDENCY: **operator login does not exist yet.** Today attendants are
`users role='attendant'` with a dummy password and **no POS/login** (see TODO §5/§7;
mobile is the intended key). This feature introduces an operator auth surface on a
money system → RLS/station-scoping and credential handling must be right. This is why
it's its own phase, not part of the small consolidated dashboard PR.

OPEN QUESTIONS (resolve before build):
- [ ] Operator auth: mobile + password? OTP? passkey? (new surface — security-sensitive)
- [ ] "cash adj" — store as a **separate column** on shift_reconciliation (audit trail;
      schema add, owner-gated) or fold into cash_actual? (recommend separate.)
- [ ] Credit invoicing: operator picks the credit customer + qty and CREATES the invoice,
      or just records a credit total the manager invoices later?
- [ ] Does operator self-close **replace** the manager-driven `/reconcile` flow, or
      **complement** it (operator submits → manager confirms at shift close)?
- [ ] Voice-to-action: in scope for v1, or fast-follow?
