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
