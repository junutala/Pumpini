# The production schema manifest

`backend/db/schema.prod.json` is the list of every relation in production and its
columns. CI reads it and **fails the build on a SQL write naming a column that is not
there** (`backend/scripts/ci-sql-schema-check.js`).

It exists because on **22-Sep-2026** a manager at SBR could not add a vehicle:

```
column "driver_name" of relation "corporate_drivers" does not exist
```

The table has always had `name`. `routes/corporate.js` had invented `driver_name` and
used it in both the INSERT and the list's `ORDER BY`, so the screen was broken in both
directions — at every outlet, since it was written. Nothing could catch it: eslint
reads JavaScript scope and a column name inside a template literal is just text,
`next build` compiles the frontend, and the unit tests never open a database.

---

## 🔴 It must be regenerated whenever the owner runs DDL

The manifest is a photograph of production, and production moves when the owner runs a
migration. **A stale manifest is worse than none** — it fails honest code and passes
broken code, and people stop believing it.

That is not hypothetical. This repo already had a file for exactly this job,
`pumpini-schema.snapshot.sql`, which CLAUDE.md called the thing to trust for *"whether a
column/table/constraint exists in prod"* and named the **#1 prod-break risk** to get
wrong. On 22-Sep-2026 it was **30 tables out of date** — missing `pumps`,
`station_artifacts`, `fuel_test_draws`, `shift_attendance`, the whole accounting module,
the gift module, `nozzle_events` and every `tank_recon*` table. Anyone who consulted it
about those got a confident wrong answer.

So: **run this in the same sitting as the DDL, not "later".**

---

## How to regenerate

Run against production (read-only), then paste the result into the file:

```sql
SELECT string_agg(t || ':' || cols, ';' ORDER BY t)
FROM (
  SELECT table_name AS t, string_agg(column_name, ',' ORDER BY column_name) AS cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
   GROUP BY table_name
) x;
```

And the views, which are listed separately so an INSERT into one is visible as a
mistake rather than silently accepted:

```sql
SELECT string_agg(table_name, ',' ORDER BY table_name)
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type <> 'BASE TABLE';
```

Keep the shape: `generated_at`, `source`, `views`, `tables`. Then run the gate and
watch it pass before committing:

```bash
cd backend && node scripts/ci-sql-schema-check.js
```

---

## What the gate covers, and what it does not

**Covered — the write paths**, because a write names its table in the same breath, so
a finding is a fact and not a guess:

| | |
|---|---|
| `INSERT INTO t (a, b, c)` | every column |
| `ON CONFLICT (...) DO UPDATE SET a = …` | every column, against the INSERT's table |
| `UPDATE t SET a = …, b = …` | every column |

**Reads are covered too**, by a second gate — `ci-sql-read-check.js`, added the same
day once the write gate was green. Half of the corporate bug lived on the read side:
the list's `ORDER BY driver_name` threw no alert, it just 500'd, which is how a screen
goes quietly broken for months.

| | |
|---|---|
| `alias.column` anywhere in a query | alias resolved from `FROM`/`JOIN` |
| bare `ORDER BY col` | only when the query has ONE table, no `JOIN`, no CTE, no subquery |

**What it refuses to judge, on purpose:**

- **An alias ever bound to something that is not a known table is poisoned** and every
  reference through it is skipped. SQL scopes an alias per CTE; the checker reads a
  template literal as one flat string. In `spokeService.outstanding()`,
  `LEFT JOIN nozzle_events p` binds `p` in the `legs` CTE and `FROM priced p` rebinds it
  two CTEs later — the first draft blamed `nozzle_events` for `p.value`, `p.ltrs` and
  `p.last_close`, four confident false findings.
- **Unqualified columns in multi-table queries.** A bare `name` could belong to any
  table in the `FROM` list.
- **Select-list aliases.** `count(*) AS n … ORDER BY n` is legal and common —
  `giftReportService`'s reason tally does exactly that.

A checker that guesses produces false alarms, and **a gate people learn to ignore is
worse than no gate**. So a clean run means every reference these could *prove* is real
— not that every query is sound.

---

## Known-missing tables

`KNOWN_MISSING` in the script lists tables the code writes to that do **not** exist in
production. Today that is `settlement_ledger`, `settlement_ledger_fuel`, `outlet_reco`
and `outlet_reco_fuel` — the materialised reconciliation ledger, whose DDL sits in
`ops/staging/settlement-ledger.sql` and has never been run on production. The feature
has therefore never worked there; both call sites in `routes/reconcile.js` wrap it in
`try/catch` and only log, so it fails silently at every settlement rather than breaking
one.

Each entry carries its reason in a comment. **Remove a name the day its table is
created** — an undocumented skip is how the last one survived.
