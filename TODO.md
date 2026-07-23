# Pumpini — Parked items (owner-approved backlog)

Items the owner asked to keep on the list. Pick these up when he says
"let's visit the TODO".

Items tagged **🔴 OPERATIONAL · PRIORITY** are the exception — the owner wants
these addressed on priority (not parked), ahead of the general backlog.

> **Revalidated 2026-07-23 against PROD code (`origin/main`), not the doc.**
> The doc had drifted (items get built without the doc being updated). Corrections
> made this pass:
> - **Credit ageing report → REMOVED (already live in prod):** `creditReports.js`
>   `/api/credit-reports/ageing` (FIFO 0-30/31-60/61-90/90+) + `reports/credit`
>   page, sidebar-linked.
> - **§14/§15/§16 operational items are IN PROD since 2026-07-02** (commits
>   `864b7a5`, `d314a3f`, + dip-or-litres) — not "pending staging test". Only their
>   *later* sub-items remain open.
> - **Bank-deposit confirm (§8):** the confirm route is now `deposits.manage`
>   (managers hold it) — the maker≠checker "decision" is de-facto Option A. Flagged
>   for owner ratification, not still-open build.
> - **Dashboard cockpit (§9):** manager cockpit + Intelligence dashboard are BUILT
>   and in prod; only Targets + Product-mix remain owner-HELD.

## 1. AI-search content pass (deferred 2026-06-12)
> Verified 2026-07-23: `/ai`, `/pricing`, `/faq` pages all absent in prod — open.

Goal: make Pumpini surface in Gemini/ChatGPT answers for "petrol pump
software with AI" type probes (currently PetroPulse360 dominates because it
exists on directories/YouTube; Pumpini exists at a single URL).

Claude-side (build on go-ahead):
- [ ] /ai page — plain-text crawlable copy answering "AI chat / AI analytics
      for petrol pump" probes, FAQPage schema
- [ ] /pricing page — crawlable plan details (599/999/1999, 15-day trial)
- [ ] /faq page — "Which petrol pump software has AI in India?" etc., FAQPage schema
- [ ] Directory-listing kit: descriptions in 3 lengths + feature/pricing
      blurbs for copy-paste into Techjockey / SoftwareSuggest / GetApp

Owner-side (only he can do):
- [ ] Google Search Console: verify pumpini.in, submit sitemap, request indexing
- [ ] LinkedIn company page for Pumpini
- [ ] Free listings on 2–3 Indian software directories (use kit above)
- [ ] One short YouTube demo (voice POS + AI chat, even 90s screen record)

Expectation: AI answers lag the web by 4–8 weeks after the above lands.

## 2. Next.js 15 upgrade — security audit clear-out (deferred 2026-06-22)
> Verified 2026-07-23: prod `frontend/package.json` is on **next 14.2.35** — still open.

Revisit AFTER the current deployments are live and stable. `npm audit` flags ~5
advisories fixed only in Next 15.5.16+. We bumped 14.0.4 → 14.2.35 (cleared the
critical auth-bypass within 14.x). The rest need a major 14 → 15 migration
(breaking: async cookies()/headers()/params/searchParams, caching defaults,
React 19), deferred as too risky pre-rollout.

Most flagged surface is N/A for us (image optimizer OFF, no Next middleware, no
`beforeInteractive`, App Router, Vercel-hosted mitigations). When picked up (do
in an isolated worktree, full build + click-through before merge):
- [ ] Bump `next` + `eslint-config-next` to latest 15.x (>=15.5.16)
- [ ] Migrate async request APIs (cookies/headers/params/searchParams)
- [ ] Re-check data fetching/caching defaults (fetch no longer cached by default)
- [ ] `npm run build` + smoke-test every page; then PR to main
- [ ] Add CI (npm ci && build) + commit the workspace lockfile in the same PR

## 3. Dip continuity: closing dip → next opening dip (deferred 2026-06-22)
> Verified 2026-07-23: no dip prefill in prod. NB the **meter** handover mismatch
> check DOES exist (`reconcile.js` opening-vs-prior-closing) — use it as the model.

The closing dipstick of one shift/day is physically the opening dip of the next.
Later: auto-prefill the opening dip from the prior shift's closing dip and flag any
mismatch (a dip "handover tripwire"), instead of re-keying it. Keep manual capture
for now.

## 4. User-management access model — remaining open decisions (deferred 2026-06-22)
> **→ Approach doc: `docs/access-model-cleanup.md`.** Verified 2026-07-23: no
> Auditor responsibility and no owner-self-serve user route in prod — both open.

Done this cycle (do NOT reopen): Add-Attendant (manager-facing), responsibility
create/assign locked to superadmin with the role-affinity guardrail (PR #170),
lite entitlement caps to `['vawe.proof']`. Still open to decide:
- [ ] How much of this to grant OWNERS (self-serve managers/auditors) vs keep
      with the platform admin.
- [ ] Auditor responsibility (e.g. tally.export + reports.view only).

## 5. Admin-set Station Code + attendant display (deferred 2026-06-22)
> Verified 2026-07-23: no `stations.code` column/route/input in prod — not built.

Disambiguation is ALREADY handled (attendant key = mobile, `users.phone` globally
UNIQUE, RLS-scoped). Remaining is the human-readable **Station Code** display aid
(low urgency):
- [ ] Migration: ALTER TABLE stations ADD COLUMN code VARCHAR(8) (nullable).
- [ ] superadmin POST /stations + PATCH /stations/:id accept & return `code`.
- [ ] /admin station create/edit modal: add a "Station Code" input.
- [ ] Show the code in cross-station/admin/group views and (optionally) beside
      attendant names where outlet context helps (e.g. "Kumar · KAM").

## 6. Add a "Pump" layer above nozzles (deferred 2026-06-22)
> Verified 2026-07-23: NO `pumps` table / `nozzles.pump_id` FK in prod. (An OCR
> `pump_id` string IS parsed off receipts in `reconcile.js`, but that's a captured
> text field, not the hierarchy.) — open.

Today the hierarchy is Tank → Nozzle. Add a **Pump** (dispensing unit) layer in
between: Pump → Nozzle(s), with Nozzle still mapped to a Tank. WHY: physical pump
stock slips carry the pump number; capturing it ties meter readings / receipt
images / reconciliation to the exact physical pump.

Scope when picked up:
- [ ] New table `pumps` (id, station_id, pump_number/label, ...). RLS: direct
      station_id isolation (add to rls/02 direct-tables list).
- [ ] `nozzles` gets `pump_id` FK (nullable first for backfill, then required).
      (Can seed off the OCR `pump_id` already captured in reconcile.)
- [ ] Settings → Pumps tab (CRUD), and nozzle form picks its Pump.
- [ ] Show pump number in shift-start/-end, dipstick/receipt capture, dashboards.
- [ ] Backfill: default pump per existing nozzle grouping, or owner maps them.

## 7. Dipstick + attendant entry on an already-open shift (watch item 2026-06-22)
Owner opened a shift but hadn't collected the opening dip / attendants yet, plans
to load them later onto the OPEN shift. Backend allows assign-while-open and
next-day close. IF the open-shift screens don't allow loading the opening dipstick
after the fact, make opening dip enterable on an open shift. Revisit only if owner
reports he can't load it.

## 8. Bank deposit confirmation (reco) — DECISION NOW DE-FACTO MADE, owner to ratify
> **Verified 2026-07-23 (this changed since the doc was written):** the confirm
> route is no longer owner-only. `cashDeposits.js:125` →
> `PATCH /:id/confirm` now uses `requirePerm('deposits.manage')`, and the RECORD
> route (`POST /`) uses the SAME `deposits.manage`. Managers **hold**
> `deposits.manage` (permissions.js manager defaults + Manager_lite seed 006).
> ⇒ **A manager can record AND confirm — including his OWN deposit.** This is
> **Option A** (self-serve), reached as a side effect of the access-model flip
> (`authorize('owner')` → `requirePerm`), NOT a deliberate maker-checker call.

Owner (junutala) to **ratify or revert**:
- [ ] **Ratify Option A** (leave as-is: manager self-confirms) — do nothing, OR
- [ ] **Revert to maker≠checker** (Option B): re-gate `/:id/confirm` to a distinct
      `deposits.confirm` perm that managers DON'T get by default (owner/accountant
      only), and optionally block confirming one's *own* deposit.
Default lean was **B** (independent verification is the whole point of the confirm
step) — so the current live behaviour may be unintended. Worth a conscious call.

## 9. Dashboard cockpit — SHIPPED & navigable; only two levers HELD (2026-06-23)
> **Verified 2026-07-23 (built + reachable in prod, confirmed live via owner
> screenshot — NOT "paused"):** the full three-surface cockpit is live and wired:
> - **Bunk View** (sidebar → `/dashboard`) = manager **Bunk cockpit** (hero +
>   Needs-you + settlement + receivables + fuel health + briefing).
> - **Group View** (sidebar, owner-only `group.view` → `/group-dashboard`) = owner
>   **Operational** rollup (per-outlet + global), with an **Intelligence** button.
> - `/intelligence` = owner **Intelligence dashboard** (Balanced Scorecard +
>   credit-liability **IRR simulator** + money-on-the-table + AI recs, fed by
>   `/groups/:id/dashboard`), with an **Operations** button back to group-dashboard.
>
> The old "PR 2–5" build plan is effectively **DONE**. Only the two owner-HELD
> levers below remain.

DECISIONS locked (kept for reference): margin basis = LAST delivery rate; AI
briefing = rule-based v1; simulator period = actual collection lag; earnings =
gross margin; simulator granularity = outlet level.

Still open — HELD by owner (do NOT build yet; people-management reasons):
- [ ] **Targets on the scorecard** (per-metric target + gap-to-target ₹ + streak).
      HELD: on-the-ground resistance; owner worried managers may quit if pushed on
      accountability. Acceptance must mature first.
- [ ] **Product-mix / non-fuel margin lever** (non-fuel share of margin per outlet).
      HELD: sensitive (exposes above-market pricing / on-paper stock moves). Revisit
      carefully.
- [ ] (nav) confirm the Intelligence page is owner-gated + reachable — it is NOT in
      the standard Sidebar (only `/dashboard` is); verify how owners reach it.

FUTURE: with more outlets, anonymize cross-owner data → anonymous peer-benchmark
inputs (network-effect intelligence). Sequencing rule stands: lead with
manager-FRIENDLY surfaces; bring accountability/benchmarking once trust is there.

## 10. Environment / connector security hardening (deferred 2026-06-28)
> Dashboard-side (Supabase/Vercel/Railway/GitHub) — not verifiable from repo code.
> All still owner actions.

Tier 1 (high value, low effort — mostly dashboard, no code):
- [ ] **2FA on ALL four dashboard accounts** — GitHub, Vercel, Railway, Supabase.
- [ ] **Lock down staging access** — `staging.pumpini.in` is PUBLIC and holds real
      customer PII behind login. Vercel → Deployment Protection on the staging project.
- [ ] **Run Supabase Security Advisor** on prod + staging; fix what it flags.
Tier 2 (defence-in-depth):
- [ ] Supabase: enforce SSL + consider Network Restrictions (allowlist Railway egress).
- [ ] Supabase PITR (point-in-time-recovery add-on) — cheap insurance for a money system.
- [ ] Vercel WAF / rate-limiting on prod.
- [ ] Rotate the prod DB password (typed into a chat during staging build-out) +
      the staging password; update Railway `DATABASE_URL` + redeploy.

## 11. Get document images OUT of Postgres → object storage (deferred 2026-06-28)
> **Verified 2026-07-23: still open.** `delivery_invoices.file_base64`
> (`deliveries.js`) and `image_base64` (`reconcile.js:672`) are still stored as
> base64 TEXT in Postgres.

Most images are already references (`photo_url`, etc.) — good. The two base64
columns inflate size ~33%, bloat backups, slow the DB. Fix = object storage, NOT a
second DB:
- [ ] Move `file_base64` / `image_base64` blobs into Supabase Storage (buckets);
      keep only the URL/path in the DB — same pattern the other images use.
- [ ] Storage lifecycle/retention rules for old-document archival.
- ⚠️ **Medium/high impact** (changes document write/read across deliveries, invoices,
      receipts, meter photos) → staging first, owner physical-tests, then prod.

## 12. GO-LIVE hardening — remaining before the next outlet round
> **Verified 2026-07-23:** no `.github/workflows` build/CI exists in prod (the CI
> gate below is genuinely open — reinforced by the truncated-`stations.js` outage
> that a boot check would have caught). Root causes from Kamala bring-up (bypass-role
> Add-Attendant, pool keepAlive+retry, owner-caps-on-responsibility, margin-tile
> table name, `must_change_password`) are FIXED. Still open:
- [ ] Surface backend error detail in ALL forms (fixed add-attendant only; others
      still show generic catch-alls).
- [ ] Pre-go-live SMOKE TEST checklist, run as EACH role under live RLS.
- [ ] Per-outlet SQL/migration checklist (manual migrations caused repo↔prod drift).
      Consider a tiny migration runner / version tracker.
- [ ] Vercel canonical domain redirect (www → apex) — verify at the Vercel dashboard
      (not in repo).
- [ ] **CI gate: frontend `npm run build` + backend boot check before merge to main.**
      A broken main blocks ALL outlets (a truncated `stations.js` 500'd prod on
      2026-07-22 — a boot check catches exactly this).
- [ ] Document the permission model (Role vs Responsibility vs Plan; owner fail-open;
      owner-only sidebar role-gates).

## 13. Data-entry out-of-sync detection + data-health tripwire (2026-07-02) — 🔴 OPERATIONAL · PRIORITY
> **Verified 2026-07-23:** the **dip-or-litres** shift-start input is **IN PROD**
> (`shift-start/page.js` litres/ATG-HPCL path) — done. The cross-outlet tripwire
> below is NOT built — open. Trade-day dating is fixed in code (dashboard files by
> `shifts.date`); historical rows still need the gated `occurred_at` backfill
> (`ops/staging/backfill-occurred-at.sql`).

Still to build — an **out-of-sync / data-health tripwire**, visible ACROSS outlets:
- [ ] Flag **missing daily dip entry** (no dip for a tank for N days).
- [ ] Flag **overdue weekly physical-dip confirmation**.
- [ ] Flag **late/batch closes** (shift closed ≫ its trade day) and **shifts left
      open** past their day — the mis-dating early-warning.
- [ ] Surface as a small **"data health"** indicator on the dashboard AND in the
      owner/global rollup.

LEARNING: staff skip cadence unless the system nags — ship the tripwire, and add
reconciliation (meter↔POS↔dip, trade-day dating) to the per-role smoke test.

## 14. Orphan / duplicate open shifts (2026-07-02) — 🔴 OPERATIONAL · PRIORITY
> **Verified 2026-07-23: the delete + empty-close ARE IN PROD** (not pending).
> `DELETE /api/shifts/:id` (`shifts.js:134`, commit `864b7a5`, 2026-07-02) with the
> full guard; Delete button (`shift-start/page.js:121`, guarded by `canDelete`);
> "Close empty shift" on End-Shift (`shift-end/page.js:333`, commit `d314a3f`).

Owner model (delivered): manual delete, guarded — button shows ONLY when the shift
has **0 operators** AND **another shift the same date has operators**; backend also
refuses on any real activity. Empty-close (End-Shift) covers the no-sibling case.

Still open:
- [ ] **Lone-orphan delete gap (NEW, found 2026-07-23):** a lone empty orphan (the
      ONLY open shift, no sibling with operators) shows **no Delete button** — the
      guard requires a sibling ("refusing to remove the only shift"). Today the only
      path for it is End-Shift → "Close empty shift" (closes, doesn't delete). If the
      owner wants a lone zero-operator, zero-activity orphan to be *deletable* too,
      relax the guard for that specific case (still block on any real activity).
- [ ] (later) warn/block opening a *second* concurrent shift for one-shift outlets.

## 15. Shift-start: per-attendant go-live (owner request 2026-07-02) — 🔴 OPERATIONAL · PRIORITY
> **Verified 2026-07-23: IN PROD** (not pending). `shift-start/page.js:238,449` —
> bottom CTA "Start Shift" enabled once one operator + nozzle readings are entered;
> assigns an un-added operator on click, then finishes. Per-attendant go-live works.

Still open:
- [ ] (later, if wanted) make the Dipstick step skippable at start too.
