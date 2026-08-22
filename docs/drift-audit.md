# Drift audit — duplicate/overlapping surfaces (2026-07-22)

Rapid dev grew multiple forms/endpoints for the same insert. This is the inventory +
fix checklist. Guiding rule: **one backend writer per concept, one reusable form,
thin guarded entry points, search-before-build** (see `CLAUDE.md`).

Fix in small, reversible, **one-concept-per-PR** slices. Money/access risk first.

## Live problems (not just cosmetic)

| ID | Problem | Status |
|----|---------|--------|
| A1 | `POST /auth/register` public + arbitrary `role` (anyone could mint an owner) | **FIXED (slice 1)** — removed; create-user goes through guarded `POST /users` + `POST /users/attendant`, single writer `userService.createUser` |
| A2 | Saving the geofence tab wipes GSTN/PAN/TAN/address + resets variance→50, prefix→'INV' (`POST /stations/:id/settings` is a full upsert; geofence tab sends only 4 fields) | **TODO (slice 2)** — make the upsert partial (COALESCE / don't null unsent columns) |
| A3 | `/admin` "Plan" toggle does NOT drive the access ceiling — it writes `station_subscriptions.plan`; the gate reads `stations.entitlement`, which has **no writer/UI** | **TODO (slice 3)** — add an `/admin` lite↔pumpini switch writing `stations.entitlement` (needed for VAWE Lite too) |
| A4 | Settlement written by 4 endpoints (3 `mode`s); meter readings split across **two tables** (`shift_attendant_nozzles` vs `shift_nozzle_readings`) | **TODO (slice 5 — needs data-model design, not just a form merge)** |
| A5 | Credit-customer: tenant writes `corporate_station_links.credit_limit`, `/admin` writes `corporate_accounts.credit_limit`; `/admin` skips the GSTN dedup | **TODO (slice 4)** — one writer, one credit-limit column, consistent dedup |
| A6 | Tenant Edit-User "Role" dropdown was a silent no-op (`PATCH /users/:id` ignores `role`) | **FIXED (slice 1)** — Edit shows role read-only |
| A7 | Fresh attendant 403'd at `/reconcile/pos-meter` (`settlement.enter`) — `roleDefaults.attendant` was `[]` | **FIXED (slice 1)** — attendant default = `['settlement.enter']` |

## Duplication to collapse to one writer (surfaces may stay)

| Concept | Surfaces today | Target |
|---------|----------------|--------|
| Create user/attendant | `/auth/register` (removed), `/users/attendant`, `/admin/attendants`, `/admin/station-users` | **In progress** — tenant side + hole done (slice 1); fold the two superadmin creators into `userService.createUser` next |
| Create station | tenant `POST /stations` (orphan, no UI) + `/admin/stations` | TODO — remove the orphan |
| Edit station core | `/admin PATCH /stations/:id` + tenant `PATCH /stations/:id/settings` (both write name/gst/oil_co) | TODO — one writer |
| Deactivate attendant | `PATCH /users/:id`, `PATCH /admin/attendants/:id`, `DELETE /admin/station-users/:id` | TODO — converge |
| Password reset | `PATCH /users/:id`, `PATCH /admin/owners/:id`, `PATCH /admin/station-users/:id`, `/auth/forgot-password` | TODO — converge |
| Phone normalizer | auth.js, users/attendant, superadmin (3 impls) | **FIXED (slice 1)** — `utils/phone.js` |
| Assign attendant to a shift (FORM) | `shift-start` two-screen flow **and** a second modal inside `shifts/page.js` | **FIXED (01-Aug-2026)** — the `shifts/page.js` modal is retired; its Add-Attendant button now routes to `/shift-start?shift=<id>`. It had diverged to one-nozzle-only, asked for a float outlets do not give, took no photograph, and offered an opening-meter box the server ignores once the close carries forward. A form that silently discards typed input is worse than none. |
| Opening reading (meter + dip) | client-supplied at shift start | **FIXED (01-Aug-2026)** — `services/openingService` is the single answer; the last close IS the next open, decided server-side. `POST /shifts` seeds opening dips, `POST /shifts/:id/assign` ignores a client-supplied opening where a prior close exists. |
| Stored document images | `dispense_artifacts` (unused) + a planned `dipstick_artifacts` | **FIXED (01-Aug-2026)** — one `station_artifacts` table with a named parent `(entity_type, entity_id)`, one writer `services/artifactService`. `dispense_artifacts` (0 rows) copied over and dropped before a second table could exist. |
| Speech → text (Sarvam) | `routes/voice.js` wrote the Sarvam call out inline; the lead form would have been a second copy | **FIXED (22-Aug-2026)** — `services/transcribeService`. Same endpoint, model and key for every caller; they differ only in `mode` (`codemix` for POS so `parsePOSCommand` still sees both "petrol" and "పెట్రోల్", `translate` for leads so the owner reads English) and in the guard over it (`authenticate` vs public + rate limit). |
| Lead interaction (WRITER) | would have been written twice — public field tool and `/admin` | **FIXED (22-Aug-2026)** — `services/leadService.addInteraction`, called by `routes/leads.js` (public, composes inside the capture transaction via a passed `client`) and `routes/superadmin.js` (authAdmin). One table, one validation, two guards. |
| Record-and-transcribe control (FORM) | `app/lead/page.js` + `components/admin/LeadRail.js` | **FIXED (22-Aug-2026)** — `components/shared/InteractionRecorder`, embedded by both. |

## Known remaining copies (declared, not hidden)

- **MediaRecorder plumbing (3 copies).** `lib/recordAudio.js` (22-Aug-2026) is the one
  helper — probe the mime type, collect chunks, release the tracks — and the lead tool and
  the admin rail use it. `app/pos/page.js` and `components/shared/FloatingChat.js` still
  carry their own inline copies of that same sequence. Migrating them is a separate PR
  with its own impact analysis: `/pos` is a money screen and does not get refactored as a
  side effect of shipping a leads tool. Flagged here rather than left to be rediscovered.

## Dead / broken code to remove

- `/dispense` page manager-settle path (endpoint forces maker=self → manager 403). TODO.
- tenant `POST /stations` (no UI). TODO.
- `/reconcile/operator-cash|shift-meters|shift-opening-meters` (no UI — dead `mgr_cash` flow). TODO.
- `handleAdd('__last__')` stale fn in `/users`. **REMOVED (slice 1).**

## Final status (2026-07-22)

**DONE + on staging:**
- A1 register hole, A6 edit-role no-op, A7 attendant default — slice 1.
- A2 geofence data-loss (partial COALESCE upsert).
- A3 plan toggle now drives `stations.entitlement`.
- A5 credit-limit one-column (dropped vestigial `corporate_accounts.credit_limit` write).
- Create user/attendant: ONE writer (`userService.createUser`) for **every** path —
  tenant `POST /users` + `/users/attendant` AND the superadmin creators
  (`/owners`, `/cco`, `/station-users`, bulk `/attendants`). Phone normalizer unified.
- Dead code removed: `/auth/register`, tenant `POST /stations`, the three dead
  `mgr_cash` reconcile endpoints (operator-cash, shift-meters, shift-opening-meters),
  the `handleAdd('__last__')` stub, and a `DELETE /station-users` double-response.

**DELIBERATELY NOT refactored (reasoned):**
- **Password-reset (multi-path) & deactivate (multi-path):** verified to be *identical
  trivial one-liners* (`bcrypt.hash(pw,12)` / `is_active=`) with NO divergent logic — so
  no drift-bug exists. They live inside working multi-field PATCH handlers used by the 3
  LIVE outlets; routing them through a shared helper is pure DRY that adds regression risk
  for zero fix. Left as-is by design (the one-writer rule is applied where logic genuinely
  diverged — CREATE).
- **Edit-station core (2 writers):** both are now COALESCE-safe partial upserts (A2 style)
  writing the same columns — no divergence/data-loss. Full unification is optional cleanup.

**DEFERRED (needs its own careful change, NOT rushed):**
- **A4 settlement — two meter tables of record → one.** A schema/data-model migration on
  money-critical settlement; scoped as its own PR with a data migration, not a form merge.
- **`/dispense` broken manager-settle path:** a 403 dead UI path (not data-corrupting);
  removal needs whole-page rework — low value.

## Slice log
- **Slice 1 (PR #172, merged):** single user-writer, removed `/auth/register`, shared
  `utils/phone`, attendant default = settlement, Edit-User role read-only, `/users` Add → one call.
- **Slices 2-6 (this PR):** A2 geofence, admin creators → one writer, A3 entitlement, A5
  credit-limit, dead-code removal.
