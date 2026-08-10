# Pumpini Accounts — build plan (V1)

> An **optional**, switchable bookkeeping layer that gives a single pump owner a
> **Profit & Loss**, a **Balance Sheet**, and a **Finance Dashboard** — built almost
> entirely from data Pumpini already records. *Not* Tally, *not* an ERP. The manager
> records what happened; Pumpini does the accounting.

Owner-agreed design, Aug 2026. This doc is the living spec; keep it in step with the code.

---

## 0. The cardinal constraint (owner-set)

1. **We do NOT touch any existing Pumpini flow.** Reading existing data is fine; changing
   a form, field, or piece of logic that exists today is not.
2. **Any exception is comprehensively analysed and needs explicit owner approval** before
   an existing flow is touched.

Everything below is designed to live *beside* Pumpini, reading its operational tables and
writing only to its own new tables. The whole module hangs off one switch
(`station_settings.accounts_enabled`, default OFF) so it can be dark-launched to one real
outlet and turned off everywhere else.

---

## 1. Architecture in one picture

```
1. EVENTS  (per outlet — "what happened")
   • auto-fed per shift (READ-ONLY from ops): fuel sales, COGS, petty-cash total, stock
   • Bill & Payment form (OCR)     • Owner Money     • supplier payments
        │  each is a typed event: { type, party, amount, date, ref }
        ▼
2. POSTING ENGINE + RULEBOOK   ← PUMPINI-OWNED, ONE COPY, ALL OUTLETS
   • rulebook: transaction_type → which account debits / which credits
   • worker reads unposted events, applies the rule, writes BALANCED double-entry.
     Idempotent (keyed by source ref). Never modifies an existing flow.
        ▼
3. JOURNAL  (per outlet, station-scoped + RLS)
   → P&L, Balance Sheet, Payables, Finance Dashboard
```

**Why a central engine:** the rulebook is Pumpini IP, shared across all outlets (like
`permission_modules` / `plans` / `role_templates` already are). Adding a new transaction
type = one rule row centrally; every outlet gets correct accounting with no per-outlet
code and no redeploy of tenant logic. This is "one writer per concept" raised to the whole
platform — no outlet can drift. The **journal it produces is per-outlet** (station-scoped,
RLS).

---

## 2. The write surface (only what Pumpini can't already see)

The manager is a 10th-pass operator. Keep it to taps, never debits/credits.

| Surface | Who | Flow | Books |
|---|---|---|---|
| **Bill & Payment** (scan) | manager | Scan → confirm → tick **PAID** (+how) → confirm | expense / asset / supplier-payment |
| **Owner Money** (In/Out) | manager | pick In/Out → amount → confirm | drawings / funding / other income |
| *fuel sales, COGS, petty cash, stock, customer receipts* | nobody | **auto-fed, read-only** | — |
| Paying a supplier | manager | in Payables view: pick supplier → tick the outstanding bills → confirm | cash↓ / payable↓ |

### Bill & Payment (the hero screen)
- Scan bill → OCR (reuse the `deliveries.js` invoice scanner → Claude Sonnet vision →
  optional Google Vision pre-pass) → extract vendor, amount, GST, date, invoice no.
- Engine suggests the **expense head** and infers the **vendor type**:
  - **Oil company (fuel)** → **payment only** against the existing OMC payable (the fuel
    purchase/COGS is already auto-fed from Deliveries — re-booking it here would
    double-count). This is the one rule that matters.
  - **Utility / other vendor** → book the **expense** (or **asset**, if the asset flag is
    ticked); if PAID is ticked, also book the payment. Intermediate creditor washes out.
- **Fetch unpaid invoices on supplier selection**: pick a supplier (or it's recognised
  from the scan) → list that supplier's outstanding bills → tick the ones this
  deposit/payment covers. Handles part-payment and one-deposit-covers-many.
- **Vendors are born from the scan** — first sighting creates + remembers the vendor
  (vendor→head learning); no supplier-setup screen to fill first.
- Manager taps: **OCR → confirm → tick PAID → confirm.** Engine writes both the purchase
  and the payment entries invisibly.

### Owner Money (manager-operated, continuous)
Owner transactions happen all day and the manager records them; the engine posts by type:

| Manager records | Engine books |
|---|---|
| Owner took cash / fuel, didn't pay | **Drawings** (equity ↓) |
| Owner deposited money for fuel | **Funding** — Capital, or a repayable **Owner's Loan** |
| Fuel bought on OMC credit, paid later + interest | payable stands; later payment + **interest = finance expense** |

Open item to pin before coding this slice: the owner's *fuel* draw is already metered
through the pump, so decide whether the engine **reads** that dispense and tags it to the
owner, or the manager records it — **one or the other, never both** (double-count).

---

## 3. The per-shift posting model

At shift close, the Accounts module **pulls** the settled figures and materialises
**one summary line per shift per concept** — it never hooks into the existing shift-close
code (rule #1). Idempotent, keyed by `shift_id`.

- **Fuel sales** (inflow) — from settled shift data.
- **COGS** — **Sold Qty × weighted-average purchase cost** (see §4), *not* raw deliveries
  (tankers arrive lumpily; most shifts have no delivery).
- **Petty cash** — one aggregated line from `petty_cash_entries` for the shift. The petty
  cash screen is **left exactly as it is**; Accounts only reads it.
- **Stock** — opening/closing stock (recorded per shift) values the closing-stock asset.

---

## 4. COGS & stock valuation

- **Method:** **Weighted Average** (moving average, recomputed on each delivery).
  - LIFO is **not permitted** under Indian accounting standards (AS 2 / Ind AS 2 allow
    only FIFO or Weighted Average). Fuel physically **commingles** in the tank, so
    weighted-average is also the honest match. Uniform across fuel and lubes.
- **P&L COGS** = Sold Qty × weighted-average cost (cost-of-sales method).
- **Balance-sheet closing stock** = Closing Qty × the *same* weighted-average cost. One
  valuation feeds both, so the P&L credit and the BS asset can never disagree.
- **Wet-stock / evaporation loss** = (Opening + Purchases − Closing − Sold) × cost, shown
  as its **own line** below gross margin (Pumpini already computes `wetstock_loss_ltrs`).
  This reconciles to the periodic identity `Sales − (Opening + Purchases − Closing)` to
  the rupee; net profit is identical, but the loss is visible instead of buried in COGS.
- **Dead / dry stock:** value closing stock at **lower of cost or NRV** — an optional
  write-down (via the adjustments journal) so the balance sheet isn't inflated by stock
  that will only clear at a deep discount. The clearance **loss falls out naturally** in
  product P&L (actual revenue − actual cost); GST is captured as data (no GST returns in
  V1).

---

## 5. The four outlet-specific facts (captured once, never hardcoded)

Each is a fact only the owner knows per outlet → asked once in the setup / opening-balances
wizard, then honoured by rules. **The module asks; it never assumes.**

1. **Are nozzles & underground tanks the outlet's asset or the OMC's?** Per-asset
   `owned_by` flag (outlet / OMC). Only outlet-owned assets appear on the BS and are
   depreciated; OMC-owned kit is at most a note.
2. **OMC "RENT" for the land.** `land_ownership` switch: **owned** → rent is Other Income;
   **leased** → pass-through (receivable from OMC, payable to landowner), net zero to P&L
   bar any spread.
3. **Dry-stock clearance & GST.** Handled in §4 (loss shows in product P&L; closing value
   at lower-of-cost-or-NRV; GST captured as data).
4. **Owner cash infusion / OMC credit.** Infusion is **Capital** (equity) or a repayable
   **Owner's Loan** (liability) — owner picks. Fuel on OMC credit is a **creditor payable**;
   **interest/penalty is a finance expense** that also adds to the payable.

---

## 6. Chart of accounts

Reuse the existing Tally **touchpoint** spine (`tally.js` TOUCHPOINTS + `tally_ledger_map`):
`petrol_sales`, `diesel_sales`, `premium_sales`, `cng_sales`, `lube_sales`, `output_cgst`,
`output_sgst`, `cash_in_hand`, `upi_bank`, `card_bank`, `debtors`, `bank`, `other_income`,
`petty_cash`, `staff_recovery`. Extend with: expense heads (electricity, salaries, rent,
R&M, bank charges, …), `creditors` (payables), `capital`, `drawings`, `fixed_assets`,
`accum_depreciation`, `loans`, and COGS (`fuel_purchase`, `lube_purchase`). No parallel
taxonomy.

---

## 7. Data model (all NEW tables — nothing existing altered)

Each new table ships **idempotent DDL + its RLS policy in the same block** (new tables get
RLS auto-enabled on this Supabase project; RLS-on-with-no-policy silently returns zero
rows). Station-scoped tables copy the standard `station_id IN (SELECT my_stations())`
shape. Code stays column/table-tolerant (probe `information_schema`, never try/catch 42703
inside a transaction).

| Object | Purpose | Scope |
|---|---|---|
| `station_settings.accounts_enabled` (col) | the on/off switch | per station |
| `posting_rules` | transaction_type → debit/credit account template | **Pumpini-global** (superadmin) |
| `accounting_journal` + `_lines` | the balanced double-entry the engine writes | per station + RLS |
| `expenses` + `expense_categories` + `expense_vendor_map` | the expense writer, category taxonomy, vendor→head learning; bill image via `vaweStorage` bucket | per station + RLS |
| `suppliers` + `supplier_bills` + `supplier_payments` | vendors & payables | per station + RLS |
| `accounting_opening_balances` | the balance-sheet anchor, as-of a books-start date | per station + RLS |
| `fixed_assets` | cost, date, `owned_by`, depreciation rate → accumulated depreciation | per station + RLS |
| `accounts_config` | per-outlet facts (land_ownership, etc.) | per station + RLS |

Reads reuse what exists (unchanged): income (`dispense_events`, `product_invoices`,
`gst_invoices`), margin/COGS (`marginService`), receivables + ageing (`creditReports.js`),
cash (`shift_reconciliation` → `cash_deposits`), fuel purchases (`fuel_deliveries`).

---

## 8. The balance sheet — how it tallies without a full GL

Pumpini's operational records are **already implicitly double-entry** (every money event
names both its P&L side and its cash/bank/party side). So the balance sheet is **derived**
and still balances, given two things:

1. **Anchor** with a one-time **opening-balances** entry (capital, fixed assets, opening
   cash/bank/stock/receivables/payables as of a books-start date). *Owner data-entry.*
2. A **small explicit journal** for the events with no operational home: capital,
   drawings, loans, fixed-asset purchase, depreciation, manual adjustments.

Retained earnings = opening retained + period P&L. Everything operational (revenue, COGS,
cash, bank, receivables, payables) stays compute-on-read — the way `creditReports.js` and
`tally.js` already work.

---

## 9. Build sequence — one-concept, reversible PRs, all behind the OFF switch

| # | Slice | Ships |
|---|---|---|
| **1** | **Foundation & flag** *(done)* | `accounts_enabled` switch, `accounts.view`/`accounts.manage` perms, sidebar "Accounts" group, Settings → Accounting toggle, landing scaffold |
| **2** | **Posting engine + rulebook + journal** *(done)* | `accounting_accounts` (chart), `posting_rules`, `accounting_journal(_lines)`; the engine; a read surface (journal + trial balance) |
| 3 | Auto-fed per-shift events | read ops → typed events → engine → journal; P&L base runs off real ops |
| 4 | Bill & Payment (OCR) | expense / asset / supplier-payment capture; unpaid-invoice fetch; vendor learning |
| 5 | Owner Money | drawings / funding events |
| 6 | Suppliers & payables view | outstanding bills, record payment against a bill |
| 7 | Opening balances + fixed assets + Balance Sheet | the wizard, depreciation, adjustments journal, the tallying BS |
| 8 | Finance Dashboard + report polish | P&L, BS, position, receivables/payables tiles + "Needs your attention" |

---

## 10. Slice 1 — what this PR contains (Foundation & flag)

- **DDL** `backend/src/db/migrations/010_accounts_module.sql` — `accounts_enabled` column
  (default FALSE) + `accounts.view` / `accounts.manage` permission modules. Idempotent,
  additive, no new tables (so no RLS this step). **Owner runs it step-by-step in Supabase.**
- **Backend** `routes/stations.js` — column-tolerant `hasAccountsFlag()` probe; GET
  `/settings` returns `accounts_enabled` (FALSE when the column is absent); POST `/settings`
  writes it through the **existing** endpoint, guarded so a pre-DDL deploy can't 42703 the
  settings save.
- **Backend** `config/roles.js` — role-affinity guard: the two modules are owner/accountant
  only.
- **Frontend** sidebar "Accounts" group (owner/accountant, `accounts.view`); Settings →
  **Accounting** tab with the owner-only on/off toggle; `/accounts` landing that self-gates
  on the switch.

**Nothing existing is modified in behaviour** — the flag defaults OFF and nothing reads it
until an outlet turns it on. Rollback: flip the flag off / revert the PR / drop the column.

*Known Slice-1 limitation:* the sidebar entry is gated by permission+role, not yet by the
outlet's `accounts_enabled` flag (the page itself respects the flag). Flag-based nav
hiding lands with the module's own client context in a later slice.

---

## 11. Slice 2 — what this contains (Posting engine + rulebook + journal)

- **DDL** `migrations/011_accounts_ledger.sql` — four new tables, each with its RLS/grant
  in the same block:
  - `accounting_accounts` — the chart of accounts (global, Pumpini-owned; `acct_type` +
    `normal_side` + `statement` so reports classify P&L vs BS without hardcoding).
    Permissive read policy; writes only on the BYPASSRLS owner role.
  - `posting_rules` — the rulebook (global). One `event_type` → N legs; a leg's account is
    a fixed `account_code` **or** pulled from the event via `account_key`; its amount via
    `amount_key`. Adding a transaction type = adding rows here.
  - `accounting_journal` + `accounting_journal_lines` — the per-outlet journal (station-
    scoped RLS, copying the `credit_suspense_entries` shape; lines carry a denormalised
    `station_id` for a direct-station policy). `UNIQUE(station_id, event_type, source_ref)`
    is the idempotency key.
  - Seeds the canonical chart + a starter rulebook (COGS, petty-cash, expense paid/unpaid,
    asset purchase, supplier payment, owner drawings/funding, other income, OMC interest).
- **Engine** `services/accountingEngine.js` — `postEvent` (rulebook-driven), `postJournal`
  (low-level balanced writer, idempotent), `trialBalance`, `listJournal`. Line-building +
  balance check are pure functions.
- **Read API** `routes/accounts.js` mounted at `/api/accounts` — `GET /journal`,
  `GET /trial-balance`. Gated by `accounts.view`; both no-op when the outlet's switch is
  off. New route; no existing flow touched.
- **Self-test** `scripts/accounts-engine-selftest.js` — pure-logic proof the engine
  balances and fails correctly (no DB needed).

No event sources are wired yet (Slice 3), so the engine has no writers in production — the
ledger stays empty until an outlet is enabled *and* its shift/expense events are wired. The
`accountsEnabled()` gate means a not-yet-migrated or switched-off outlet never touches the
ledger tables. **Order of operations: run `011` before switching any outlet on.**
