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

**Not covered — reads.** `SELECT`, `WHERE`, `ORDER BY` reach through aliases and joins
(`ORDER BY cd.name`, `WHERE s.date = $1`), and resolving an alias to its table needs a
real SQL parser. **Half of the corporate bug lived there** — the broken `ORDER BY` is
why the list failed as well as the insert.

That gap is deliberate, not forgotten. A checker that guesses produces false alarms, and
a gate people learn to ignore is worse than no gate. Extending it to reads with a proper
parser is worth doing and is its own change.

**So a green tick means the writes are sound. It does not mean every query is.**

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
