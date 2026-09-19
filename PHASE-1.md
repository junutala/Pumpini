# Phase 1 — freeze record (19-Sep-2026)

Owner-set: *"I think we are at a stage that this build can be frozen as Phase 1."*

This file records **what Phase 1 is, what was verified at the freeze, and what is
knowingly left open.** It is a statement of fact about a point in time, not a plan.

- **Code frozen at:** `819a74e` — the last commit that changed anything executable
- **Branch tip:** `25b7eed` — `819a74e` plus this documentation pass, which touched
  only `.md` files, so the two are byte-identical in every file that runs
- **Backup branch:** `phase-1-freeze`, pointing at `25b7eed` (fast-forwarded, nothing
  discarded)
- **Live on:** Vercel (frontend) + Railway (backend) + Supabase Postgres

---

## What Phase 1 is

Four real outlets running on it, and a fifth onboarded this week:

| Outlet | Status |
|---|---|
| Kamala Filling Station | real, live |
| Adhoc Highway Filling Station | real, live |
| Highway Filling Station | real, live |
| Sri Balaji Oil Company | real, live |
| **SBR ENERGIES** | real, **went live 19-Sep-2026** |
| MBR | real (replica of SBR's master data, created 18-Sep for proving changes) |

Plus four fixtures that are **not** real and must be excluded from any analysis:
Dilsukhnagar Bunk, Nagole Petrol Bunk, Hayat Nagar Petrol Bunk, and the unnamed
outlet. **That fixture list is closed** — see House facts in `CLAUDE.md`.

The module inventory is in `README.md`. The working rules, and the incidents that
produced them, are in `CLAUDE.md`. Neither is repeated here.

---

## What was verified at the freeze

Every line below was checked against the code or against production, not assumed.
Where a claim in a document turned out to be false, the document was corrected in the
same pass and the correction is noted in place.

### Verified TRUE

| Claim | Evidence |
|---|---|
| **One meter store.** `shift_attendant_nozzles` is the only meter of record | `shift_nozzle_readings` and `shift_attendants.opening_reading/.closing_reading` **do not exist** in production — `information_schema` returns nothing for either |
| **One artifact table.** `dispense_artifacts` was dropped | not present in production |
| **Dead `mgr_cash` endpoints removed** (`operator-cash`, `shift-meters`, `shift-opening-meters`) | no handlers in `routes/reconcile.js`; three tombstone comments in their place |
| **Tenant `POST /stations` orphan removed** | no root `router.post` in `routes/stations.js` |
| **`handleAdd('__last__')` removed** | no occurrence in `frontend/src` |
| **`/dispense` manager-settle path removed** | no `settle`/`maker` path in the route or the page |
| **One nozzle name reaches every screen** | all 17 nozzle-showing frontend files read through `lib/nozzle.js → nozName()`; none builds its own label; the 6 backend files that query `nozzles` without the one writer deal only in ids, raw slip fields or comments |
| **6 locales present** | `en, hi, ta, te, kn, mr` in `frontend/src/i18n/locales/` |

### Verified FALSE — documents corrected in this pass

| Was claimed | Actually | Fixed in |
|---|---|---|
| *"The script was deleted and a three-line route added instead"* | The route exists; **`backend/scripts/artifacts-to-bucket.js` is still there** (97 lines) — a second writer for the same job | `CLAUDE.md` |
| *"`pos-meter` and `ocr-meter` are two complete copies… both had to be untangled"* | `ocr-meter` **was** removed 04-Aug-2026. `/reconcile/manager` vs `/self-settle` was **not** untangled and is still two copies | `CLAUDE.md` |
| Flow v2 is *"Sri Balaji only"* | `hub_spokes_migration_enabled` is **off at Sri Balaji** and on at **Dilsukhnagar only — a fixture**. No real outlet has ever run Flow v2 | `CLAUDE.md` |
| `A4` — meter tables *"TODO / deferred"* | The meter half is **done**; only the settlement half remains | `docs/drift-audit.md` |
| Four items under *"Dead / broken code to remove"* | **All four already gone.** The list kept reporting finished work | `docs/drift-audit.md` |
| Landing page is `frontend/public/index.html`, served from `public/` | That file does not exist. The landing page is `app/landing/page.js`, rendered at `/` by `app/page.js`, and already **is** the homepage | `DEPLOYMENT.md` |
| Deploy with `pm2 start` / `npm run start` | Both halves **auto-deploy on merge to `main`**; nothing ships by hand | `README.md` |
| Project tree: 13 routes, 3 services, 11 screens | **40 routes, 36 services, 58 screens** | `README.md` |
| Roles as a 4×7 matrix | Predates responsibilities and the entitlement ceiling; the attendant row was wrong | `README.md` |

### Image storage — current reading

Run at the freeze, using the check `CLAUDE.md` prescribes:

```
table                rows    in bucket   still inline
station_artifacts     115           35             99
delivery_invoices      93           93             45
meter_photos           78           78             18
```

`delivery_invoices` and `meter_photos` are **fully** in the bucket. `station_artifacts`
is not: 80 of 115 rows have no `storage_path`. That is partly by design —
`artifactService.save()` only uploads on autocommit, so bytes written inside a caller's
transaction stay inline — but it is worth a backfill pass. Rows counted as both are
backfilled but not yet pruned; pruning is the irreversible step and is owner-gated.

---

## Knowingly open at the freeze

Nothing here is a defect in what shipped. These are the things a Phase 2 would pick up,
recorded so they are not rediscovered as surprises.

1. **🔴 `/reconcile/manager` and `/reconcile/self-settle` are still two copies of the
   settlement maths.** This is the one genuinely open money item (`A4`'s settlement
   half). Both paths are permanent by owner's decision — the problem is that they do
   not yet share a writer, so an improvement to one does not reach the other except by
   somebody remembering.
2. **`backend/scripts/artifacts-to-bucket.js` should probably be deleted.** The
   superadmin route does the same job and is the sanctioned path. Deleting code is a
   change, so it waits for the owner's word rather than riding in on a docs pass.
3. **Flow v2 is built but unproven.** Reachable only behind
   `hub_spokes_migration_enabled`, which no real outlet has on. The composite nozzle
   scan has not been field-tested — owner, 18-Sep: *"I am too scared to restart the
   composite nozzle scan till I go to a location and do it myself."* A defect in that
   screen went unnoticed until 19-Sep precisely because no real outlet can open it.
4. **`station_artifacts` backfill** — 80 rows still inline, above.
5. **Pump-number ↔ serial mapping is verified at SBR only.** Ramana and the owner
   checked SBR's numbering against the printed slips on 19-Sep. Kamala, Highway and
   Adhoc are **unverified** — which is the stated reason the label now shows both
   identities: so those outlets can spot the mismatch and report it.
6. **Plan/design documents that describe unbuilt work.** `docs/voice-triggered-forms.md`
   (proposes `lib/nav.js`, `lib/voiceForms.js`) and `docs/dip-carry-verification.md`
   (proposes `GET /api/shifts/carry-preview`) describe designs, not shipped behaviour.
   None of those three exist. They are proposals and read correctly as such in context,
   but do not cite them as current behaviour.

---

## How to restore Phase 1

`phase-1-freeze` is an ordinary branch, so it can be read, diffed or checked out like
any other:

```bash
git fetch origin phase-1-freeze
git diff phase-1-freeze main          # what has changed since the freeze
git checkout -b restore phase-1-freeze
```

**Two things a branch does NOT back up, and both matter here:**

- **The database.** Schema and data live in Supabase and are not in git. A code
  restore does not undo a migration or recover a row.
- **Branch protection.** `phase-1-freeze` is not protected — this repo has no
  protected branches. Anyone with push access can move or delete it. Making it
  genuinely immutable is a GitHub **Settings → Branches** rule (or a tag), and it is
  the owner's to set; it cannot be done from the code.
