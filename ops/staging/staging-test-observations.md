# Staging test tracker (2026-07-02) — close ALL before prod

Owner is testing on staging; collect + sequence, then build in batches.
Status: 🟢 done/accepted · 🔧 to-build · ❓ decision-needed · 🚢 ship

## MASTER SEQUENCE (close these before prod)
| # | Item | Status |
|---|------|--------|
| T1 | Highway data: amount not tallying with shift breakdown (except 1 Jul) — deep-dive OR delete pre-1-Jul | ❓ decision |
| T2 | Dashboard: two **MTD tiles** — Quantity (fuel breakdown) + Amount, vs **last-month MTD** (YAGO later) | ✅ built (branch) |
| T3 | Dashboard: **settlement tile** — move date picker in with ◀/▶; columns + by-fuel total row | ✅ built (branch) |
| T4 | Settlement: **target revenue** = Σ(qty×rate)/operator vs actual → **revenue variance** | ✅ built (branch) |
| T5 | Shift-start: **staggered operators** — stay on Operators screen; explicit Done→dashboard | ✅ built (branch, Batch 1) |
| T6 | **Operator login** (mobile-based) — new auth surface; dependency for T7/T8 | 🔧 ❓ |
| T7 | **Operator self-close** mobile settlement screen | 🔧 |
| T8 | **"Settlement2" responsibility** + assign in Add-Attendant (superadmin + manager) | 🔧 |
| T11 | **Split discharge** — capture per-tank quantity when one delivery fills >1 tank | 🔧 |
| T12 | Settlement "huge variance" — REAL cause: **petty omitted** from accounted total (rate was fine) | ✅ fixed (branch) |
| T1c | Keep Highway's **1st-close shift** (30 Jun 6AM→1 Jul 6AM); prod cleanup must preserve it | 🔧 |
| T9 | Consolidated PR for T2–T5 (+T11) → staging test | 🚢 |
| T10 | Prod go-live: merge → `main`, gated `occurred_at` backfill | 🚢 |

Already on staging, pending test (NOT re-listed — some superseded by T2–T4):
tank-reco fix · stock-reco date picker · occurred_at trade-day fix · dip-or-litres entry ·
start-shift per-operator go-live · orphan delete + close-empty · per-shift tiles + top
date picker (⚠ replaced by T2–T4).

---

## T0 (🟢 accepted, no change) — Shift-start dip ⇄ litres
Dip shows computed litres; litres does NOT back-compute a dip (no inverse). Owner: fine, keep as is.

## T1 — Highway amount vs shift breakdown not tallying (❓ decision)
Highway's amount doesn't tally with the shift breakdown **except on 1 Jul**. Adhoc + Kamala tally fine.
Likely cause: Highway was the **go-live demo outlet** (the "250" seed, two open shifts, messy
meter/handover) — so meter-derived recon (`shift_reconciliation.total_sales`) diverges from
synthesized `dispense_events` amounts on the demo days; 1 Jul (clean shift) tallies.
DECISION (owner): (a) deep-dive per-shift to reconcile the pre-1-Jul figures, OR (b) **delete
Highway data up to 30 Jun** and start clean from 1 Jul. Recommend (b) — it's demo data.
- [ ] Owner picks (a) or (b). Then: I give the diagnostic (a) or the guarded delete SQL (b).

## T12 — Settlement "huge variance" — REAL CAUSE: petty omitted from accounted total  ✅ FIXED (branch)
Owner insisted rates never changed since deploy — correct. My trade-date-rate theory was
WRONG. Decomposition query proved it: per operator, `fuel_value = target (@ current rate)
= total_sales` **exactly** — so the rate is fine and target is right. The variance was
short by **exactly `petty_cash`**: the accounted total was `cash+upi+card+credit` and
LEFT OUT petty. Petty is cash pulled from the drawer for expenses — still money the
operator is accountable for, so it belongs in the total.
FIX (`frontend/src/app/dashboard/page.js`): accounted `total = cash+upi+card+credit+petty`;
`revVar = total − target` (≈0 when clean); per-operator Total cell and tfoot grand-total
both now add petty. Two-line-ish change, no schema, no query change. Variance ≈ 0.

## T1-CORRECTION — keep Highway's 1st-close shift (30 Jun 6AM → 1 Jul 6AM)  🔧
That shift was MATCHING and must be kept; my cleanup `date < 2026-07-01` deleted it
(its shift-date is 30 Jun). Staging: re-refresh from prod to restore, then re-run a
cleanup that EXCLUDES that shift. PROD cleanup MUST preserve it (delete only the
mismatching earlier demo shifts, not the 30→1 close).

## OBSERVATION (2026-07-02) — Highway shows no dashboard data (likely EXPECTED, revisit in testing)
After T1 cleanup, Highway shows MTD 0 + empty settlement. Likely NOT a bug: Highway's
only real sales were the June demo shifts we deleted; its 01-Jul shift was open with no
completed sales → nothing to show. Also it's 02 Jul, so **MTD (July) = 0 for all outlets**
(all data is June) — the dashboard only populates when the settlement date is stepped back
to a June day on Kamala/Adhoc, or once an outlet runs a fresh shift. Confirm during full
testing; if a date WITH data (e.g. a June day on Kamala) also shows blank, that's a real
bug to chase.

## T2 — Dashboard: two MTD tiles
- Tile 1 **MTD Quantity** with **fuel/SKU breakdown** (litres by fuel only).
- Tile 2 **MTD Amount** (₹).
- Compare vs **last month's MTD** for now; **YAGO** later once history exists.
- MTD window: 1st-of-month → viewed date; last month = same 1st→same-day window.
Data: SUM(dispense_events) by fuel over the two month windows.

## T3 — Dashboard: settlement tile (date nav + columns)
- Move date picker ONTO the settlement tile with **◀ / ▶** day-step arrows (retire top-hero picker).
- Columns: `Operator · Fuel type · Quantity sold · Cash · UPI · Card · Credit · Petty · Total · Variance`.
- **TOTAL row**: quantity **by fuel type** + total amount → full day's view.
- Detail: operator mans multiple fuels → operator×fuel sub-rows, subtotalled per operator (recommend).
Data: payments+variance from `shift_reconciliation`; per-operator fuel qty from
SUM(dispense_events) by attendant_id + fuel_type.
NOTE: T2+T3 REPLACE the current per-shift-tiles + top-picker + payment-only settlement body.

## T4 — Settlement: target revenue vs actual → revenue variance
As quantity is shown, compute **target revenue = Σ(quantity × current fuel rate)** per operator,
compare to **actual revenue** (what they collected), show the **variance** per operator (a
sales-integrity check, distinct from the cash over/short variance). Rates from `fuel_prices`.

## T5 — Shift-start: staggered operators
After adding an operator (he goes live immediately via `/assign`), **stay on the Operators
screen** ready for the next (6 operators arrive staggered). "Add operator" stays + resets the
form (keep as the primary path). Make the bottom CTA an explicit "Done → dashboard" that does
NOT auto-navigate on each add.

## T6 — Operator login (mobile) — ❓ new auth surface
Operators tie to the outlet by **mobile number**; login does not exist today (attendants have a
dummy password, no POS/login — TODO §5/§7). Money system → RLS/station-scope + credentials must
be right. Decide: mobile + password? OTP? passkey?  (Dependency for T7/T8.)

## T7 — Operator self-close (mobile settlement) screen
Operator-only (own OPEN shift via `/shifts/active`), **mobile-first**, shows **outlet name**.
Operator: capture (photo/OCR) or manually enter **closing meters** for his nozzles; enter closing
**Cash · Card · Credit · UPI · Petty**; new **"Cash adj"** (adds to cash: effective = cash+adj);
wires into **credit-customer invoice creation**. Feeds this attendant's `shift_reconciliation`
(reuse `/reconcile/operator-cash`, `/reconcile/pos-meter`+`/ocr-meter`). Voice-to-action optional.
- [ ] "Cash adj" — separate audited column vs fold into cash_actual (recommend separate; schema add).
- [ ] Credit: operator creates the invoice, or records a credit total the manager invoices later?
- [ ] Operator self-close replaces or complements the manager `/reconcile` flow?

## T8 — "Settlement2" responsibility + Add-Attendant assignment
- New **responsibility "Settlement2"** that grants access to the T7 screen; assign to attendants.
- Add a dropdown/checkbox to the **Add-Attendant** screen at BOTH **superadmin** and **outlet
  manager** to assign it at creation.
(Relates to TODO §5 — tighten who can grant responsibilities; managers minting perms = escalation.)

## T11 — Split discharge into multiple tanks (recurring; fixed by SQL each time)
A tanker sometimes discharges one fuel into **multiple tanks**; today the delivery entry
captures ONE `tank_id`, so a split is wrong (one tank over, the other shows no delivery)
→ patched by SQL repeatedly. Fix: on the delivery/discharge screen, when the discharge
goes into >1 tank, capture the **quantity discharged per tank**, so per-tank stock + the
stock-reco are right and the **invoice value = Σ per-tank quantities × rate**.
Model: already supported — `fuel_deliveries.invoice_id` lets ONE invoice back SEVERAL
delivery rows (migration 002). So a split = N `fuel_deliveries` rows (one per tank, each
its own `tank_id` + `gross_volume_ltrs`) sharing the DC/invoice. Only the ENTRY UI needs
to accept multiple tank+quantity lines and total them for the invoice. Build in Batch 1.

## T9 — Consolidated PR (T2–T5) → staging test → sign-off
## T10 — Prod go-live: merge branch → `main`; run gated `occurred_at` backfill (snapshot → apply)
