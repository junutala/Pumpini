# Flow v2 — Technical Specification

**Baseline:** `main` @ `22ed684`, 28-Aug-2026. Schema facts were read from the
production database on that date; code facts from the merged tree. Read alongside
`docs/flow-v2-functional-spec.md`, which says *what* and *why*; this says *how*.

---

## 1. Deployment posture

| Piece | Where | How it ships |
|---|---|---|
| Frontend | Vercel | auto-deploys on merge to `main` |
| Backend | Railway | auto-deploys on merge to `main` |
| Schema | Supabase Postgres | **run by hand, by the owner** |

**Code and schema therefore deploy separately, and code lands first.** Every service
in this flow is written for a database that may not yet have its tables:

- A **catalog probe**, cached only once TRUE, decides whether the tables exist —
  `SELECT … FROM information_schema.tables`. Never a failing `SELECT` caught by
  error code: inside a transaction a failed statement **aborts the whole unit of
  work**, so the fallback query dies too. (`invoiceNumberService` learned this on
  30-Jul and broke every credit invoice in production.)
- A false probe is **re-probed**, so the first call after the owner runs the DDL picks
  it up with no restart.
- Every read path degrades to `enabled: false` and an explanatory card, never a 500.

To check whether something exists in production, trust `pumpini-schema.snapshot.sql`
(a full `pg_dump`), not `pumpini-schema.sql` (hand-maintained, drifted).

---

## 2. Data model

Five new tables. All were run by the owner and are **verified live** (28-Aug): RLS
enabled, exactly one isolation policy each, `app_authenticated` holding SELECT and
INSERT.

> A new table on this Supabase project gets RLS **enabled automatically**, and RLS-on
> with-no-policy denies everything — asymmetrically: `SELECT` silently returns zero
> rows while `INSERT` raises. So policy **and** `GRANT` ship in the same DDL block as
> the `CREATE`. (`credit_slip_books` shipped without one on 30-Jul: issuing a coupon
> book failed while its list read as empty.)

### 2.1 `tank_recons` — one reconciliation event

```
id            uuid pk
station_id    uuid not null → stations
taken_at      timestamptz not null default now()   -- THE BOUNDARY INSTANT
status        text not null default 'draft' check in ('draft','confirmed','abandoned')
created_by    uuid → users
confirmed_at  timestamptz
confirmed_by  uuid → users
notes         text
created_at, updated_at   timestamptz not null default now()

index (station_id, taken_at DESC)
policy: FOR ALL USING (station_id IN (SELECT my_stations())) WITH CHECK (same)
```

`taken_at` is the whole point: two consecutive **confirmed** recons define a window,
and both the tank figures and the nozzle totals are read at those instants.

### 2.2 `tank_recon_tanks` — what each tank read, and what it implied

```
id, recon_id → tank_recons ON DELETE CASCADE, tank_id → tanks
volume_ltrs, dip_mm   numeric        -- what was read
source                text check in ('photo','typed')
opening_ltrs, delivered_ltrs, sales_ltrs, testing_ltrs, book_ltrs, variance_ltrs
created_at
UNIQUE (recon_id, tank_id)
```

The six derived columns are **written only on confirm**. Before that they are
computed and returned, never stored — so a draft cannot be mistaken for a finding.

Policy joins through the parent: `EXISTS (SELECT 1 FROM tank_recons r WHERE
r.id = tank_recon_tanks.recon_id AND r.station_id IN (SELECT my_stations()))`.

### 2.3 `tank_recon_nozzles` — Spoke 1's slip readings

```
id, recon_id → tank_recons ON DELETE CASCADE, nozzle_id → nozzles
cumulative_volume, cumulative_amount   numeric
source                                 text check in ('photo','typed')
read_pump_serial, read_nozzle_no       text     -- exactly as the paper printed
UNIQUE (recon_id, nozzle_id)
```

`read_pump_serial` / `read_nozzle_no` are kept **as printed**, beside the nozzle they
were matched to, so a wrong match is auditable after the fact rather than invisible.

### 2.4 `nozzle_events` — Spoke 2, the chain

```
id                  uuid pk
station_id          uuid not null → stations
nozzle_id           uuid not null → nozzles
closes_attendant_id uuid → users     -- NULL on genesis; DERIVED, never sent
opens_attendant_id  uuid → users     -- NULL when the nozzle goes idle
reading             numeric not null -- ONE number: closes one account, opens the next
recorded_at         timestamptz not null default now()
source              text check in ('photo','typed')
is_co_event         boolean not null default false
prev_event_id       uuid → nozzle_events
drift_seconds       integer          -- the co-event's whole purpose
drift_reason        text             -- his own words. NEVER a dropdown
read_pump_serial, read_nozzle_no   text
recorded_by         uuid → users
created_at

index (nozzle_id, recorded_at DESC), (station_id, recorded_at DESC)
```

**One `reading` column, not an opening and a closing.** They cannot disagree because
there is only one of them.

### 2.5 `attendant_settlements` — Spoke 3, what he brought

```
id, station_id → stations, attendant_id → users
settled_at   timestamptz not null default now()
cash, upi, card, credit, petty   numeric not null default 0
notes, recorded_by, created_at

index (attendant_id, settled_at DESC), (station_id, settled_at DESC)
```

**There is deliberately no column for the outstanding.** It is derived on read. A
column would be a second source of truth for a number a manager must not be able to
set.

### 2.6 Columns reused, not added

| Fact | Column | Note |
|---|---|---|
| a machine's identity | `pumps.serial` | one writer: `pumpService` |
| the printed nozzle no | `nozzles.slip_nozzle_no` | the column the matcher already reads |
| "this nozzle was commissioned" | the nozzle's **genesis `nozzle_events` row** | the event *is* the evidence |
| the switch | `station_settings.hub_spokes_migration_enabled` | fifth behaviour flag on that table |
| tolerances | `station_settings.stock_tol_pct_petrol` / `_diesel` / `_floor_ltrs` | 0.75 / 0.50 / 20 |

No "commissioned" boolean exists, on purpose: a flag asserting what the data already
shows is a second truth waiting to drift from the first.

---

## 3. Services — the writers

One service owns each concept. Routes are thin guarded entry points over them.

### `services/reconService`
`hasReconTables` · `lastConfirmed` · `openDraft` · `startDraft` · `saveFigures` ·
`computeVariance` · `confirm` · `abandon`

- `computeVariance` builds the window from `lastConfirmed(...).taken_at` to this
  recon's `taken_at` and returns per-tank figures — **returned, not written**, so the
  screen shows the manager what he is about to confirm before anything is frozen.
- `confirm` takes `FOR UPDATE` on the recon, refuses anything not `draft`
  (`{ locked: true }`), writes the six derived columns, and flips the status — in one
  transaction.

### `services/spokeService`
`hasSpokeTables` · `physicsVerdict` · `recordEvent` · `chain` · `nozzleState` ·
`outstanding` · `settle`

`recordEvent` is the **only** writer of `nozzle_events`, commissioning included:

```
BEGIN
  pg_advisory_xact_lock(hashtext(nozzle_id))   -- per NOZZLE, so two managers
                                               -- closing two pumps do not queue
  prev := last event on this nozzle
  closes_attendant_id := prev.opens_attendant_id      -- DERIVED, inside the lock
  verdict := physicsVerdict(prev, reading, now)
  if verdict and no drift_reason → ROLLBACK, return { refused: verdict }
  is_co_event  := prev exists and prev.reading = reading
  drift_seconds := now − prev.recorded_at
  INSERT …
COMMIT
```

`physicsVerdict` — the only two certainties:

```
delta < 0                     → reading_decreased
delta > (seconds/60) × 40 L   → faster_than_the_pump
otherwise                     → null   (trade; record the drift, stay silent)

MAX_FLOW_LTRS_PER_MIN = 40
MIN_GAP_SECONDS       = 30   -- floor, so a legitimate back-to-back print at the same
                             -- instant is not called impossible by divide-by-nearly-zero
```

`outstanding(station_id)` derives, per attendant:

```
legs    each event with closes_attendant_id, contributing
        GREATEST(reading − prev.reading, 0) litres
priced  litres × the fuel's CURRENT price (fuel_prices.price, latest effective_from)
brought SUM(cash+upi+card+credit+petty) from attendant_settlements
        outstanding = priced.value − brought.handed_over
```

Price changes are deliberately not modelled: the price is updated by hand at the
controller and by hand in Pumpini, and there is no pre/post-change gating to build
(owner-set, 27-Aug).

### `services/commissionService`
`readiness` · `commission` · `wantsFor`

`wantsFor(row)` is pure, so the gate that decides whether an outlet may change its
whole operating model is testable without a database:

```
!pump_id                     → 'pump'        (nowhere for a serial to live)
else !pump_serial            → 'serial'
!slip_nozzle_no (BLANK, not falsy — "0" is a real printed number) → 'printed_no'
!events                      → 'genesis'
```

`commission()` is idempotent and resumable — twelve nozzles are twelve small writes,
not one transaction. A half-finished run leaves the outlet exactly as ready as the
nozzles it got through, and the switch stays refused until all are ready, so a partial
run cannot pretend to be complete. It routes the serial through `pumpService.updatePump`
(and only where none is on file — re-serialising a machine is a Settings act), writes
`slip_nozzle_no` as printed, and calls `spokeService.recordEvent` for the genesis —
**never** giving a second genesis to a nozzle that already has a chain.

### `lib/varianceMath` — the one copy of the sum

```js
const n = v => {
  if (v === null || v === undefined || v === '') return null;  // Number(null) is 0
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

reconcileTank({opening, deliveries, sales, testMove, actual})
  hasBaseline = opening != null
  book        = hasBaseline ? opening + deliveries + testMove − sales : null
  variance    = (hasBaseline && actual != null) ? actual − book : null
  base        = hasBaseline ? opening + deliveries : 0

toleranceFor({base, pct, floor}) = max(floor, base × pct / 100)
```

The `n()` guard is the fix for a real defect the tests caught: `Number(null) === 0`,
so a missing opening dip read as a **baseline of zero** and produced a phantom
full-tank loss.

### `lib/serialMatch` — the near-miss proposal

```
MAX_EDITS       = 1      -- measured, not chosen: 17CH2645V and 17CH2653V are two apart
MAX_LENGTH_GAP  = 3
exact match  → null      -- a correct serial is never offered as a neighbour
tie on distance → null   -- ambiguity is not a proposal
```

### `services/slipEvalService` — the replay bench
`runEval` · `loadArtifacts` · `summarise`. Calls `parseCompositeSlips`, the same
function every screen calls — nothing re-implements the parser. Selection asks only
whether a row **has an image anywhere** (bucket or inline); requiring `file_base64`
made the bench a measure of the storage migration rather than of the reader, and it
would have reported "no artifacts" instead of "the reader got worse" once the prune
step ran.

`scripts/slip-eval.js` is the printing half of the same service, so a CLI run and a
route run cannot disagree.

---

## 4. HTTP surface

All routes: `authenticate` first, then `requireStationAccess({required:true})` (or
`requireStationId('id')` on the stations router).

### Spoke 1 — `/api/tank-recon`

| Method | Path | Permission |
|---|---|---|
| GET | `/?station_id=` | read |
| POST | `/draft` | `stock.reconcile` |
| POST | `/:id/figures` | `stock.reconcile` |
| GET | `/:id/variance?station_id=` | read |
| POST | `/:id/confirm` | `stock.reconcile` |
| POST | `/:id/abandon` | `stock.reconcile` |

`station_id` is taken **explicitly** rather than scoped through `requireStationVia`,
because that middleware would `SELECT` from a table the DDL may not have created yet.
Every `:id` route then re-checks ownership itself (`ownedBy`): without it, a recon id
from another outlet would be readable by anyone holding access to their own. Routes
answer **503 `not_migrated`** rather than 404 when the tables are absent — the feature
exists, this deployment simply cannot serve it.

### Spoke 2 & 3 — `/api/spokes`

| Method | Path | Permission |
|---|---|---|
| GET | `/chain?station_id=&nozzle_id=&limit=` | read |
| GET | `/nozzles?station_id=` | read |
| POST | `/event` | `reconcile.manage` |
| GET | `/outstanding?station_id=` | read |
| POST | `/settle` | `settlement.enter` |

`POST /event` names its fields rather than spreading the body — `closes_attendant_id`
must not be reachable from a request. A physics refusal returns **409** with the
machine code in `error` and the sentence in `message`.

### Commissioning — on the existing stations router

| Method | Path | Guard |
|---|---|---|
| GET | `/api/stations/:id/commissioning` | read |
| POST | `/api/stations/:id/commissioning` | `settings.manage` **and** role `owner` |

### The switch — `POST /api/stations/:id/settings`

Written through the **existing** settings endpoint; no route of its own. Three
refusals, checked **before** the upsert:

| Code | HTTP | When |
|---|---|---|
| `owner_only` | 403 | caller is not the outlet owner |
| `shift_open` | 409 | any shift is open here — **either direction** |
| `not_commissioned` | 409 | **turning ON only**; carries `missing`, `total`, and the offending nozzles with their `wants` |

Because all three sit inside `if (req.body.hub_spokes_migration_enabled !== undefined)`,
the geofence tab and every other partial settings save are untouched.

### The bench — `POST /api/superadmin/slip-eval`

`?latest=N&runs=N[&station=uuid][&artifact=uuid…]`, behind `authAdmin`. Read-only;
`runs` capped at 5 and `latest` at 40, because every run is a paid API call. It exists
as a route because the measurement needs `ANTHROPIC_API_KEY` and
`GOOGLE_VISION_API_KEY`, and those live on **Railway** — the job has to run where the
credential is. Same shape as `runBackfill()`.

---

## 5. Frontend

| Screen | Path |
|---|---|
| Recon — start/resume | `app/tank-recon/page.js` |
| Recon — ATG | `app/tank-recon/atg/page.js` |
| Recon — nozzles (scan + type in one) | `app/tank-recon/nozzles/page.js` |
| Recon — variance | `app/tank-recon/variance/page.js` |
| Spoke 2 — chain + handover | `app/nozzle-events/page.js` |
| Spoke 3 — dues | `app/attendant-dues/page.js` |
| Commissioning | `app/settings/commissioning/page.js` |

### Shared components — the anti-drift surface

| | What it guarantees |
|---|---|
| `components/shared/SettlementBreakup` | The five money fields, once. Shift Close and Attendant Dues render the same component, same order, same `tc()` keys — they cannot drift apart in Telugu while agreeing in English. Exports `emptyBreakup()` and `breakupTotal()` so neither caller invents a shape or a sum. |
| `components/shared/EngineNotice` | Says the backup reader read it, and why. Renders **nothing** when the good engine ran. An unrecognised reason code still shows the card — the point is the fallback, not the explanation. |
| `lib/nozzle → nozName()` | The read side of the one naming writer. Never builds a name; falls back to the stored number only for the minutes a Vercel build can be live against an older Railway. |

### The flag on the client

`lib/auth` reads `hub_spokes_migration_enabled` once per station into `hubSpokesFlow`
and exposes `refreshStationFlags()`. The sidebar remounts on every navigation, so
reading the flag there would cost a fetch per screen; but the auth read keys on the
**station**, which does not change when the switch is flipped — hence the explicit
refresh, which is why the sidebar now updates without a reload.

`Sidebar` swaps `SPOKES_GROUP` in for Shift Open / Shift Close when the flag is on:

```
/tank-recon      stock.reconcile
/nozzle-events   reconcile.manage
/attendant-dues  reconcile.manage
```

Commissioning is reached from the switch card in Settings, which also shows how many
nozzles are still holding the switch — read through the **same endpoint the backend
gate uses**, so the screen and the refusal cannot disagree.

### Errors

`lib/apiError`: `errText()` for what a human reads, `errCode()` for what code branches
on. Never `e.error` by hand — that is how a manager was shown `missing_closing_dip` in
a red box while the server had sent a full sentence in the same response.

---

## 6. Invariants — the things that must stay true

1. **One reading per link in a chain.** No opening column, no closing column.
2. **`closes_attendant_id` is derived, never accepted from a request.**
3. **No column anywhere holds an attendant's outstanding.**
4. **A recon scan can never move an attendant account** — enforced by the table
   boundary, not by a `WHERE` clause.
5. **A nozzle gets at most one genesis event.**
6. **A nozzle's name comes from `pumpService.nozzleNameExpr` / `nozName()`,** never
   built in a page. CI enforces this (`scripts/ci-nozzle-name-check.js`) and it caught
   this very build doing it.
7. **Only the flow branches.** Nozzle naming, calibration, artifact storage, prices,
   users and stations stay single across both flows.
8. **Switching the flag off is never gated.**

---

## 7. Failure modes and blast radius

| If this fails | What the user sees | Why it is contained |
|---|---|---|
| Spoke tables absent | "not switched on for this database yet" card | catalog probe, `enabled:false`, no throw |
| Readiness read throws | switch toggle 500s | inside the flag branch only — every other settings save is untouched |
| Commissioning card fails to load | card simply absent | the **backend** refusal still stands; the guard cannot be lost through a frontend error |
| A slip reads badly | the line is refused with a named reason, or proposes a serial for one tap | nothing is written without a person confirming |
| The good OCR engine is down | the fallback reads it and **says so** on the screen | low-trust read always goes through human confirmation |
| A physics-impossible reading | 409 with a sentence, and a box for his own words | nothing enters the chain unexplained |
| Two managers close the same nozzle | one waits on `pg_advisory_xact_lock` | per-nozzle, so different pumps do not queue |
| Whole flow is wrong | owner switches the flag off | old sidebar and old flow return; data taken meanwhile stays on file |

**Nothing in this flow is on a hot read path of the shift flow.** The only shared
endpoint touched is `POST /reconcile/parse-slips`, which gained two nullable fields
(`serial_suggestion`, `engine`/`fallback_reason`) that existing callers ignore.

---

## 8. Tests and CI

`node --test test/*.test.js` — **75 passing** at this baseline. Note the glob is
**unquoted**: quoted, node receives the literal pattern, and node's own glob support
arrived in v21 while CI pins node 20, so the step silently found no tests for two days.

Flow-v2 coverage of note:

- `varianceMath` — the `Number(null)` baseline bug, caught before it shipped.
- `serialMatch` — that a *correct* serial is never proposed as a neighbour; the test
  is what forced `MAX_EDITS` from 2 to 1.
- `commission` — `"0"` as a real printed number; a nozzle with no pump asking for the
  pump rather than a serial; and the every-nozzle-uncommissioned state production is
  actually in.

Other CI gates: `ci-route-check.js` (40/40 route modules export a valid router),
`ci-nozzle-name-check.js` (no inline nozzle labels anywhere), `node --check` across all
backend source, `next lint` and `next build`.

---

## 9. Known gaps at this baseline

| | Gap |
|---|---|
| 1 | **The replay bench has not been run.** The route exists; the measurement it produces is the validation the plan asks for before trusting any of this on paper. |
| 2 | **Recon cadence is undecided**, and nothing in the code assumes one. |
| 3 | **Clearing an outstanding needs only `settlement.enter`** — the manager, who is often the man who took the cash. |
| 4 | **The owner dashboard is unchanged**, deliberately: it is reworked after the flow is frozen. |
| 5 | **No outlet has a genesis event**, so every outlet is currently held by the commissioning gate. Intended, but it means Flow v2 cannot be switched on anywhere new until somebody scans. |
