# Run every query before a customer does — the plan

Written 23-Sep-2026 for the agent that implements it. Read `learnings.md` (22-Sep "A column name
has never been checked against the database" and 23-Sep "I shipped a query that had never been
run"), `docs/schema-manifest.md`, and the two gates `backend/scripts/ci-sql-schema-check.js` and
`ci-sql-read-check.js` before starting.

The owner, 23-Sep: _"on a few occasions, the field names in frontend does not match with DB names,
and we had an embarrassing situation with the client"_ — _"we had two issues in two days!!!"_

---

## 1. Where we stand — a review of the whole codebase, 23-Sep

Independent scans of `main` at `a7eca51`, run separately from the repo's own gates:

| check                                                                   | result                         |
| ----------------------------------------------------------------------- | ------------------------------ |
| SQL writes: every INSERT / UPDATE column exists in production           | 1,220 of 1,220 ✓ (the CI gate) |
| SQL reads: every `alias.column` resolves to a real column               | 2,826 checked, 0 real misses   |
| Screens → backend: fields a screen sends that the backend never names   | 112 payloads, 0 found          |
| Backend → screens: snake_case fields a screen reads that nothing produces | 1 real (below)               |

**The one real finding.** `frontend/src/app/support/page.js` shows "Last Login" from
`u.last_login_at`, and the `users` table has no login-time column at all — so every user shows
"Never". Either add `last_login_at` to `users` and set it in the login route, or take the column
off the Support screen. The owner's call; say which before building.

**A minor one.** `app/corporate/page.js` sends `contact_person_id` with a corporate account; the
backend keeps only the name (`contact_person`), so the dropdown cannot re-select the person when
the account is edited. Not data loss.

**So the text gates now work — and they are not enough.** Both outages this week were queries that
had simply never been executed before a customer opened the screen, and a gate that reads SQL as
text cannot see these, by its own stated design:

- **Unqualified columns** — `WHERE date = $1`, `ORDER BY name` — skipped to avoid false alarms.
- **Columns reached through a CTE or sub-query alias** — the read gate "poisons" and skips them.
- **Spliced fragments** — `${nm.join}`, `${nm.col}`, `${nm.groupBy}` (48 splices). One helper has
  its own gate (`ci-nozzle-name-check.js`, after 23-Sep); the next helper will not.
- **Types, functions, casts, ambiguous columns, syntax** — `42804`, `42883`, `42702`, `42601`:
  invisible to any text check.
- **A screen that builds its payload in a `form` object** before sending — beyond both the gates
  and tonight's scan.

Each incident so far produced one more text rule for that one shape. The cause is that **no query
runs before production does**. Fix the cause.

---

## 2. The plan — a real Postgres in CI, and every route called once

### Step 1 — A schema-only copy of production, beside the manifest

- `pg_dump --schema-only --no-owner --no-privileges` of production's `public` schema into
  `backend/db/schema.prod.sql`. Regenerate it **in the same sitting** as `schema.prod.json`
  (`docs/schema-manifest.md` already says why a stale copy is worse than none — add this file to
  that page's instructions).
- Supabase specifics: RLS policies may reference `auth.uid()` and roles such as `authenticated`;
  create a stub `auth` schema, the function and the roles in a small `ci-prelude.sql` rather than
  editing the dump. Extensions the dump needs (`uuid-ossp` under `extensions`, `pgcrypto`, …) go
  there too.
- Use the Postgres major version production runs (check it; do not assume).

### Step 2 — A CI job with that database

- A new job in `.github/workflows/ci.yml` with a `postgres` service container; load
  `ci-prelude.sql`, then `schema.prod.sql`, then a fixture seed.
- **Fixtures:** one group, one station, one user per role (owner, manager, attendant, superadmin),
  a pump with nozzles, a tank, an open shift with a leg, a corporate account, a delivery. Reuse
  `backend/src/db/seed.js` if it fits; otherwise a `test/fixtures.sql`. Keep ids fixed so routes
  can be called with them.

### Step 3 — Boot the real app and call every route

- `backend/src/index.js` calls `server.listen` and starts the RFID listener on require. Guard both
  with `if (require.main === module)` so a test can import `app` without side effects. Nothing
  else about production start-up changes.
- Mint a JWT per role with `JWT_SECRET` (the shape `middleware/auth.js` verifies, including `tv`).
- **Enumerate the routes from Express itself** (`app._router.stack`, recursing into routers) — not
  from a hand list, which would go stale the week it was written.
- Call **every GET** with the fixture ids for `:params` and the usual query (`station_id`,
  `shift_id`, `date`). Then every POST / PUT / PATCH / DELETE with a minimal valid body,
  **inside a transaction that is rolled back** (or against a database recreated per run).
- **Fail on any Postgres error of class 42** (`42703` undefined column, `42P01` undefined table,
  `42883` undefined function, `42702` ambiguous column, `42804` datatype mismatch, `42601` syntax)
  and on `22P02` (invalid text representation) — wrap `pool.query` in the test to record them,
  because routes catch errors and answer 500 without saying why. A 4xx is fine: it is validation
  doing its job.
- **Report coverage:** routes called, routes that errored, routes never reached (a route that needs
  a body nobody has written yet). Commit the list of not-yet-covered routes; the build fails when a
  new route is added without being called, so coverage only ever grows.

### Step 4 — Prove the gate, the way learnings.md now demands

"Tested" means shown to fail on the real bug, then pass on the fix (23-Sep learning):

1. Reintroduce `driver_name` in `routes/corporate.js` (the 22-Sep outage) → the job must fail,
   naming the route and `42703`.
2. Reintroduce the `nz` alias in the Nozzle History query (the 23-Sep outage, the one that passed
   seven text gates) → must fail with `42P01`.
3. Restore both → must pass.

Paste all three runs into the PR. A gate proven only on good code is not proven.

### Step 5 — Keep the text gates

They run in seconds and point at a line. The runtime job is the net underneath them, not a
replacement. Keep `ci-sql-schema-check`, `ci-sql-read-check` and `ci-nozzle-name-check`.

### Later — the screens' side

The runtime job proves every query runs; it does not prove a screen reads the field the route
returns. Once it exists, record each GET's response keys from the fixture run and check the
frontend's `row.field` reads against them — the check tonight's scan did by hand, made
permanent. Do this after steps 1–4, not instead of them.

---

## 3. Order and what to hand back

1. The `last_login_at` decision to the owner (§1) — one question, asked on its own.
2. Steps 1–2 (schema copy, CI database, fixtures).
3. Step 3 for every GET first — reads are most of the exposure and need no bodies.
4. Step 4's three proof runs, pasted into the PR.
5. Writes (POST/PUT/PATCH/DELETE) route by route, the uncovered list shrinking each PR.

Follow Pumpini's CLAUDE.md on testing, deployment, and how to report what reached production.
