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
