# Pumpini — agent working rules

> **THIS IS A LIVE, MULTI-TENANT, PRODUCTION SYSTEM handling real money for real petrol
> stations.** A careless change can blank a critical screen for every outlet at once.
> Read this before you touch anything.

---

## 🔴 MANDATORY: Impact analysis before EVERY change

Before you merge anything, you must work through this and state your findings in the PR
description. This is not optional — a skipped impact analysis already took down the
Start-Shift operator picker once (a `SELECT` of a not-yet-migrated column).

1. **Schema dependency?** Does my code read/write any column, table, enum value, or
   constraint that doesn't already exist in production? If yes, see the deploy-ordering
   rule below — this is the #1 way to break prod.
2. **Who consumes this?** If I change a query, endpoint, or shared helper, list EVERY
   screen/flow that uses it. A backend endpoint usually feeds several screens — including
   critical paths. (Example: `GET /users?role=attendant` powers BOTH the Add-Attendant
   page AND the Start-Shift operator picker. Breaking it stops shifts from starting.)
3. **Blast radius if it fails?** Does a failure degrade gracefully, or does it 500 a core
   path? A missing *optional* column must never crash a read endpoint — guard it.
4. **Multi-tenant safety.** Could this leak or cross-scope data between outlets/owners?
   (RLS + app-layer `stationAccess`. Superadmin routes run on the BYPASSRLS role.)
5. **Money / masking.** Does it touch sales, credit suspense, petty cash, margins, or
   blind-drop masking? Margin is owner-only; open-shift sales are masked for non-owners.
6. **Rollback.** If this is wrong in prod, how is it undone?

If you can't answer these, do not merge.

---

## 🔴 Deploy ordering — code and schema deploy SEPARATELY

- **Frontend → Vercel**, **Backend → Railway**: both **auto-deploy on merge to `main`**.
- **Database → Supabase Postgres**: schema changes (`ALTER`/`CREATE`) are **run MANUALLY by
  the owner**. They do NOT happen automatically on deploy. `pumpini-schema.sql` is the
  canonical place to append idempotent DDL; `backend/src/db/migrate.js` is a separate runner.
- **To check whether a column/table/constraint exists in prod, trust
  `pumpini-schema.snapshot.sql`** (a full `pg_dump` of prod), NOT `pumpini-schema.sql` —
  the latter is a partial hand-maintained file (~23 of 60 tables) that has drifted. This
  is the #1 prod-break risk: code shipping a `SELECT` of a column the repo schema doesn't
  show but prod-checking the snapshot would have caught.

**Therefore: code that depends on a new column/table WILL deploy before the migration is
applied, and break.** When a change needs schema:

- **Put `⚠️ RUN THIS SQL FIRST` with the exact statements at the TOP of the PR body**, and
  do not consider the change "shipped" until the owner confirms the SQL is run.
- **Prefer column-tolerant code**: don't `SELECT new_col` in a hot read path until the
  column is guaranteed present; or wrap so a missing column can't 500 the endpoint.
- Make all DDL idempotent (`ADD COLUMN IF NOT EXISTS`, etc.) so re-running is safe.
- **🔴 INSIDE A TRANSACTION, PROBE — NEVER "TRY AND CATCH 42703".** A failed statement
  ABORTS the whole transaction, so the fallback query dies with *"current transaction is
  aborted, commands ignored until end of transaction block"* and the operation fails
  anyway. The try/catch pattern in `deliveries.js insertDeliveryInvoice` is safe ONLY
  because it runs on `pool` outside a transaction — it is **not** portable into a
  `BEGIN…COMMIT` block. Inside one, check `information_schema.columns` first (a catalog
  SELECT succeeds either way and cannot poison the transaction), or use a SAVEPOINT.
  (Learned 30-Jul-2026: `invoiceNumberService` caught 42703 inside the credit-invoice
  transaction and broke every credit invoice in prod until the DDL was run.)
- **🔴 A NEW TABLE MUST SHIP ITS RLS POLICY IN THE SAME DDL BLOCK.** New tables get RLS
  **enabled automatically** on this Supabase project, and RLS-on-with-no-policy denies
  everything. The failure is asymmetric, which is why it slips through: `SELECT` silently
  returns **zero rows** (the screen just looks empty) while `INSERT` raises *"new row
  violates row-level security policy"*. Copy the shape every station-scoped table already
  uses — `FOR ALL USING (station_id IN (SELECT my_stations())) WITH CHECK (same)` — and
  check with `SELECT * FROM pg_policies WHERE tablename='...'` before calling it done.
  (Learned 30-Jul-2026: `credit_slip_books` shipped without one and issuing a coupon book
  failed while its list read as empty.)

---

## Ship workflow

- Branch off `origin/main` → push → open PR → **merge to `main` yourself** (owner does not
  merge). Vercel green is the gate; CodeRabbit is advisory.
- **Both auto-deploy on merge** — Railway (backend) and Vercel (frontend). No manual
  redeploy step. Railway marks a merge SKIPPED ("no changes to watched files") when it
  touches nothing it watches, e.g. a docs-only PR. *(Corrected 29-Jul-2026: this line
  used to read "backend changes need a Railway redeploy", contradicting the deploy-ordering
  section above and sending a session chasing a button that does not need pressing.)*
- Never `cd` into or hardcode a local worktree path. Work via GitHub.

---

## 🔴 Change-management rules (owner-set) — how EVERY change ships

There is now a full **staging** mirror (`staging` branch → staging Railway →
`staging.pumpini.in` → separate Supabase project). See `STAGING.md`. These rules sit
on top of the impact analysis above and are not optional:

1. **Impact analysis is mandatory.** Work the checklist at the top of this file and
   state the findings in the PR. No change ships without it.
2. **Low / no impact** — degrades gracefully, no schema/money/masking/RLS/multi-tenant
   or hot-read-path surface, trivial rollback → raise **two PRs: one into `main`
   (prod) and one into `staging`**, and merge both, so the two environments stay in
   lockstep. No physical test required.
3. **Medium / high impact** — touches schema, money (sales/credit/cash/petty/margin),
   RLS/multi-tenant, blind-drop masking, a core flow, or a hot read path → deploy to
   **`staging` only** first. **The owner tests it physically** on `staging.pumpini.in`.
   Only after the owner's explicit all-clear does it go to **production** (`main`).
4. **SQL runs step-by-step, gated on the owner.** Present DDL/migrations as discrete,
   ordered steps. After each step, **wait for the owner to confirm it ran in Supabase**
   before giving the next. Never hand over a multi-step SQL sequence to run all at once.

When unsure which bucket a change is in, treat it as **medium/high** and route it
through staging. Staging exists precisely so the owner verifies risky changes before
they touch real outlets.

## 🔴 One writer per concept (anti-drift rule) — owner-set 2026-07-22

Rapid dev grew **multiple forms/endpoints for the same insert** (e.g. FOUR ways to
create an attendant, TWO credit-limit columns, TWO meter tables). That drift is a
money/access risk. The standing rule now:

1. **One backend WRITER per concept.** The actual insert/update logic (SQL, validation,
   dedup, which columns) lives in ONE service function (e.g. `services/userService.createUser`).
   Every path funnels through it. Callers may pass a transaction `client` to compose.
2. **One FORM component per concept.** A single reusable form; other flows EMBED it, never
   re-implement it. One travel route to the DB.
3. **Different trust boundaries = thin guarded entry points, not divergent logic.** Tenant
   (JWT + `requirePerm`) and superadmin (`authAdmin`) may be SEPARATE routes, but both call
   the SAME service. Don't duplicate the insert to change the guard.
4. **Search before you build.** Before adding a new form/endpoint for an existing concept,
   `grep` for the existing writer and REUSE/extend it. Never stack "forms above forms."

The living inventory + fix checklist is `docs/drift-audit.md`. Fix drift in small,
reversible, one-concept-per-PR slices.

## 🔴 ONE meter store — the spare tires are retired (owner-set 2026-08-01)

There is exactly **one** place a nozzle's opening and closing meter lives:
**`shift_attendant_nozzles`**, one row per operator per nozzle. Do not add a second.

Two others existed and are now dropped: `shift_attendants.opening_reading` /
`.closing_reading` (a single pair on the OPERATOR row, mirroring "the first nozzle"
on assign and "the last leg" on close — for a man on four nozzles that is not a
summary, it is a wrong number) and `shift_nozzle_readings` (a manager-vs-POS
comparison store). The good table is clean: 876 rows, not one negative and not one
impossible movement. The retired pair held **70 negative and 150 impossible**
readings.

**Why this was dangerous even though the money was always right.** The settlement
validates `closing >= opening` per nozzle and refuses otherwise, so the bad figures
could never become money — but the **carry-forward** read all three tables in a
`COALESCE`. A nozzle missing its good row would have carried a garbage figure
straight into a live opening, and the shift would have been measured against it.
**A fallback onto a table the money does not trust is not resilience; it is a quiet
path from bad data into the one number a shift is judged by.**

`/reconcile/pos-meter` no longer writes a meter at all — it OCRs the photograph and
hands the number back, and the settlement writes it. One writer.

## 🗓️ Next session — agreed agenda (owner, 2026-08-01 evening)

1. **Rewire the attendant self-settlement form** onto `shift_attendant_nozzles`
   properly. The path is deliberate and stays; it just has to drink from the one
   table. (Backend already points there; check the form end to end.)
2. **One more sanity sweep for multiple sources of truth.** The meter store was one;
   `docs/drift-audit.md` lists the rest. Find any other concept with two homes.
3. **Peel the test outlets off PRODUCTION.** Only **Kamala**, **Adhoc Highway** and
   **Highway** are real. Dilsukhnagar Bunk, VAWE-1, the unnamed outlet and their
   data are test fixtures that now live in staging, and every analysis run against
   prod has to filter them out by hand — which is how a wrong conclusion gets drawn.
   Precondition the owner set: **VAWE live and staging at parity with production**,
   then demos run on staging and prod holds only real outlets.

## House facts

- Dates: format with `en-IN` + `Asia/Kolkata` (DD MMM YYYY). Never render a raw ISO
  timestamp. India is DD/MM — never MM/DD.
- **Real outlets in production: Kamala, Adhoc Highway, Highway.** Everything else in
  prod is a test fixture — exclude it before drawing any conclusion from prod data.
- i18n: user-facing strings go through `tc('key', 'English fallback')`; add Telugu (`te.json`)
  for manager-facing text.
- Attendants = `users` with `role='attendant'` linked via `station_users`; `is_active` +
  `end_date` drive the Start-Shift picker.
