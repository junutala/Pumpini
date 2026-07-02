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

## 3. Dashboard — intended MTD layout not built  🔧 TO-FIX (needs layout confirm)
Owner's intended dashboard: **(a)** two TOP tiles = MTD running totals — **total
amount** + **fuel-type breakup** (litres by fuel); **(b)** a date picker; **(c)** the
picked date shows **attendant-wise settlement INCLUDING fuel type + quantity sold**
per operator.
What we built instead: N per-shift sales tiles (colour-coded) + top date picker +
payment-only settlement (no per-operator fuel type/qty). So:
- NOT built: the two MTD tiles (amount + fuel breakup).
- NOT built: fuel type + quantity per operator in the settlement.
- Date picker is at the TOP, not the bottom.
Data availability (all buildable): MTD amount + fuel litres = SUM(dispense_events)
for the month (station, occurred_at in month) grouped by fuel_type; per-operator fuel
qty = SUM(dispense_events) by attendant_id + fuel_type for the shift.
CONFIRM before building: exact target layout —
- [ ] Do the two MTD tiles REPLACE the per-shift tiles, or sit ABOVE them (keep both)?
- [ ] Keep the per-shift tiles at all, or is the day view = just the attendant
      settlement (with fuel qty)?
- [ ] Date picker at top (as now) or bottom (as recalled)?
- [ ] MTD = calendar month-to-date of the *viewed* date, or always current month?
