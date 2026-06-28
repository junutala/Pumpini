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

---

## Ship workflow

- Branch off `origin/main` → push → open PR → **merge to `main` yourself** (owner does not
  merge). Vercel green is the gate; CodeRabbit is advisory.
- **Backend changes need a Railway redeploy**; **frontend is live on Vercel automatically.**
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

## House facts

- Dates: format with `en-IN` + `Asia/Kolkata` (DD MMM YYYY). Never render a raw ISO
  timestamp. India is DD/MM — never MM/DD.
- i18n: user-facing strings go through `tc('key', 'English fallback')`; add Telugu (`te.json`)
  for manager-facing text.
- Attendants = `users` with `role='attendant'` linked via `station_users`; `is_active` +
  `end_date` drive the Start-Shift picker.
