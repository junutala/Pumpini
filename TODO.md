# Pumpini — Parked items (owner-approved backlog)

Items the owner asked to keep on the list. Pick these up when he says
"let's visit the TODO".

Items tagged **🔴 OPERATIONAL · PRIORITY** are the exception — the owner wants
these addressed on priority (not parked), ahead of the general backlog.

> **Housekeeping (2026-07-23):** this file was pruned to hold ONLY open work.
> Removed because DONE/settled: new-user password "doesn't work" (disproven
> non-bug; `must_change_password` hardening shipped), Tank Name/Label (owner
> SKIPPED), Pumpini Lite SO voice-recording playback (✅ shipped — VAWE PR #98
> + Pumpini PR #184), and the completed access-model sub-items (Add-Attendant,
> responsibility lock-down PR #170, the retired stale branch). See git history
> for the retired detail.

## 1. Credit ageing report
Ageing of credit-customer outstanding (e.g. 0–30 / 31–60 / 61–90 / 90+ days
buckets, by customer, with totals and drill-down to invoices). Discussed
earlier as a needed owner/CA report alongside Tally export.

## 2. AI-search content pass (deferred 2026-06-12)
Goal: make Pumpini surface in Gemini/ChatGPT answers for "petrol pump
software with AI" type probes (currently PetroPulse360 dominates because it
exists on directories/YouTube; Pumpini exists at a single URL).

Claude-side (build on go-ahead):
- [ ] /ai page — plain-text crawlable copy answering "AI chat / AI analytics
      for petrol pump" probes, FAQPage schema
- [ ] /pricing page — crawlable plan details (599/999/1999, 15-day trial)
- [ ] /faq page — "Which petrol pump software has AI in India?" etc.,
      FAQPage schema
- [ ] Directory-listing kit: descriptions in 3 lengths + feature/pricing
      blurbs for copy-paste into Techjockey / SoftwareSuggest / GetApp

Owner-side (only he can do):
- [ ] Google Search Console: verify pumpini.in, submit sitemap, request
      indexing
- [ ] LinkedIn company page for Pumpini
- [ ] Free listings on 2–3 Indian software directories (use kit above)
- [ ] One short YouTube demo (voice POS + AI chat, even 90s screen record)

Expectation: AI answers lag the web by 4–8 weeks after the above lands.

## 3. Next.js 15 upgrade — security audit clear-out (deferred 2026-06-22)
Revisit AFTER the current deployments are live and stable.

Context: `npm audit` on the frontend flags ~5 advisories (high/moderate) that
are **only** fixed in Next 15.5.16+. We bumped Next 14.0.4 → 14.2.35 (cleared
the critical auth-bypass within the safe 14.x line). The remainder need a major
14 → 15 migration (breaking: async cookies()/headers()/params/searchParams,
caching default changes, React 19), so it was deliberately deferred — too risky
to rush before the outlet rollout.

Why it's low urgency for us right now (most flagged surface is N/A):
- image optimizer OFF (`images: { unoptimized: true }`) → all image-optimizer CVEs N/A
- no Next middleware → middleware SSRF / cache-poison / bypass N/A
- no `beforeInteractive` scripts; App Router (not Pages i18n); socket.io (not Next WS)
- Vercel-hosted → platform mitigations cover much of the rest

When picked up (do in an isolated worktree, full build + click-through before merge):
- [ ] Bump `next` + `eslint-config-next` to latest 15.x (>=15.5.16)
- [ ] Migrate async request APIs (cookies/headers/params/searchParams)
- [ ] Re-check data fetching/caching defaults (fetch no longer cached by default)
- [ ] `npm run build` + smoke-test every page; then PR to main
- [ ] Add CI (npm ci && build) + commit the workspace lockfile in the same PR

## 4. Dip continuity: closing dip → next opening dip (deferred 2026-06-22)
The closing dipstick of one shift/day is physically the opening dip of the next
(same as the meter handover). Later: auto-prefill the opening dip from the prior
shift's closing dip and flag any mismatch (a dip "handover tripwire"), instead of
re-keying it. Keep manual capture for now.

## 5. User-management access model — remaining open decisions (deferred 2026-06-22)
> **→ Approach doc: `docs/access-model-cleanup.md`** — full current-state map
> (Role vs Responsibility vs Plan vs Membership vs Superadmin), the target model,
> and where VAWE Lite (`Manager_vawe`/`Owner_vawe`) slots in. Start there.

Done this cycle (do NOT reopen): Add-Attendant (manager-facing), responsibility
create/assign locked to superadmin with the role-affinity guardrail (PR #170),
lite entitlement caps to `['vawe.proof']`. Still open to decide:
- [ ] How much of this to grant OWNERS (self-serve managers/auditors) vs keep
      with the platform admin.
- [ ] Auditor responsibility (e.g. tally.export + reports.view only).

## 6. Admin-set Station Code + attendant display (deferred 2026-06-22)
Owner wants attendants uniquely identifiable so common names (e.g. dozens of
"Kumar") aren't confused across outlets, especially once POS login goes live.
Disambiguation is ALREADY handled (attendant key = mobile, `users.phone` globally
UNIQUE, RLS-scoped). Remaining work is the human-readable **Station Code** display
aid — NOT YET BUILT (low urgency):
- [ ] Migration: ALTER TABLE stations ADD COLUMN code VARCHAR(8) (nullable).
- [ ] superadmin POST /stations + PATCH /stations/:id accept & return `code`.
- [ ] /admin station create/edit modal: add a "Station Code" input.
- [ ] Show the code in cross-station/admin/group views and (optionally) beside
      attendant names where outlet context helps (e.g. "Kumar · KAM").

## 7. Add a "Pump" layer above nozzles (deferred 2026-06-22)
Owner request. Today the hierarchy is Tank → Nozzle. Add a **Pump** (a.k.a.
dispensing unit) layer in between, so each nozzle belongs to a numbered pump:
  Tank → (Nozzle) and Pump → Nozzle(s), with Nozzle still mapped to a Tank.
WHY it's valuable: the physical **pump stock slips** (the printed meter/receipt
the operator tears off) carry the **pump number**. Capturing it lets us tie meter
readings, receipt images, and reconciliation to the exact physical pump — much
stronger audit trail and matches what staff read off the slip.

Scope when picked up:
- [ ] New table `pumps` (id, station_id, pump_number/label, ...). RLS: direct
      station_id isolation (add to rls/02 direct-tables list).
- [ ] `nozzles` gets `pump_id` FK (nullable first for backfill, then required).
- [ ] Settings → Pumps tab (CRUD), and nozzle form picks its Pump.
- [ ] Show pump number in shift-start/-end (operator readings grouped by pump),
      dipstick/receipt capture, and dashboards where nozzle appears.
- [ ] Backfill: create a default pump per existing nozzle grouping, or prompt
      the owner to map existing nozzles to pumps.
Note: a pump typically has 1-2 nozzles. Keep nozzle→tank mapping intact; pump is
an organisational/audit layer.

## 8. Dipstick + attendant entry on an already-open shift (watch item 2026-06-22)
Owner opened a shift but hadn't collected the opening dip / attendants yet, plans
to load them later onto the OPEN shift (dip readings + assign operators + pump
receipt images). Confirmed backend allows assign while open and next-day close.
IF the open-shift screens don't allow loading the opening dipstick after the fact
(e.g. dip capture is gated to shift-open only), make opening dip enterable on an
open shift. Revisit only if owner reports he can't load it.

## 9. GO-LIVE hardening — remaining before the next outlet round (from Kamala bring-up)
Context: first production outlet bring-up took ~5h vs ~30min expected, almost all
in DIAGNOSING first-time-in-prod issues (RLS + generic errors). Root causes are
FIXED (bypass-role Add-Attendant insert, pool keepAlive+retry, owner-caps-on-
responsibility, margin-tile table name, `must_change_password` on create). The
hardening below is what's still open:
- [ ] Surface backend error detail in ALL forms (fixed add-attendant only; others
      still show generic catch-alls). Precise message = minutes, not hours.
- [ ] Pre-go-live SMOKE TEST checklist, run as EACH role (owner/manager/attendant)
      under live RLS: add attendant, open+close shift, dipstick, delivery, invoice,
      dashboard, AI chat. Catches RLS/permission gaps before the client is watching.
- [ ] Per-outlet SQL/migration checklist (which scripts to run in Supabase, in
      order). Manual migrations caused repo↔prod DRIFT. Consider a tiny migration
      runner / version tracker.
- [ ] Vercel canonical domain redirect (www → apex). The www/apex origin split
      cost time on a phantom "login bounce."
- [ ] CI gate: frontend `npm run build` + backend boot check before merge to main.
      A broken main blocks ALL outlets. (Reinforced 2026-07: a truncated
      `stations.js` hand-merge 500'd all of prod — a boot check would have caught it.)
- [ ] Document the permission model (Role vs Responsibility vs Plan; owner
      fail-open; owner-only sidebar role-gates). The /admin UI conflates Role and
      Responsibility.

## 10. Bank deposit confirmation (reco) — who confirms? (pending owner, 2026-06-23)
On Bank Deposits, a recorded deposit shows **"Bank Confirmed: Pending"** until
someone confirms it hit the bank. Today that confirm is **owner-only**
(`PATCH /api/cash-deposits/:id/confirm` → `authorize('owner')`), so a MANAGER can
record a deposit but cannot confirm it.

This is a **maker-checker / segregation-of-duties** decision, NOT a bug:
- Option A — give the **manager** the confirm (reco) capability (self-serve, faster).
- Option B — **leave confirmation to the accountant/owner** — independent check
  (stronger control; manager records, checker verifies it reached the bank).

Owner (junutala) to decide and revert. Default lean = **B**. If A is chosen:
relax the confirm route to `authorize('owner','manager')` + add a `deposits.confirm`
permission, and decide whether a manager can confirm his *own* deposit or only
another's. No build until the owner confirms the model.

## 11. Dashboard cockpit redesign — DESIGNED + FROZEN, build PAUSED (2026-06-23)
Reimagined the dashboards as role-aware "cockpits" that drive decisions, not raw
numbers. Designs frozen via mockups. **Build paused pending ground acceptance** —
see the ⚠️ at the end.

DECISIONS locked:
- Margin cost basis = **LAST delivery rate** per fuel (owner's pick "B").
- AI briefing = **rule-based v1** (LLM version a fast-follow).
- Credit-liability simulator period = **actual collection lag** (invoice→receipt), not contracted terms.
- Earnings-to-procurement = **gross margin** (sell−buy); no overhead visibility.
- Simulator granularity = **outlet level** (managers control credit, not the owner).

MANAGER cockpit (frozen): dark hero (shift state + AI one-liner) · "Needs you"
action band (cash to deposit, credit to invoice, tank low) · Today's money
(sales/margin/litres + payment mix, **blind-drop sealed per shift, reveals at
close**) · Last settlement breakdown (Cash/UPI/Card/Credit/Petty + variance) ·
Receivables ladder (to-invoice→outstanding→overdue 90+) · Fuel health (tank
gauges + days-of-cover + per-tank variance + MTD wet-stock meter) · AI briefing.

OWNER = TWO surfaces (Leazify-style):
- **Operational** — outlet picker = the manager cockpit unmasked, + a **Global**
  rollup (sum of all outlets' manager views; tanks aggregate by fuel; "needs you"
  = cross-outlet exceptions).
- **Intelligence** — Managers' Balanced Scorecard (credit% of sales, gross margin,
  overdue%, wet-stock loss% — ranked, gap-to-best) · interactive **credit-liability
  IRR simulator** (slide cost-of-capital → break-even credit days → flag underwater
  outlets + ₹ at risk; d* = (m/(1−m))×(365/IRR)) · "**recoverable ₹/month**" leak
  ledger (shrinkage + credit drag + idle cash + overdue) · AI recommendations.

BUILD STATE: **PR 1 (bunk-feed metrics) MERGED** (#49 — additive, unused until
pages land). Pending: PR 2 manager page · PR 3 owner feed (per-outlet ratios +
actual collection lag + vs-yesterday) · PR 4 Operational owner dashboard · PR 5
Intelligence owner dashboard.

HELD by owner (2026-06-23) — do NOT build yet:
- [ ] **#2 Targets on the scorecard** (per-metric target + gap-to-target ₹ + streak).
      HELD: heavy **on-the-ground resistance**; owner worried managers may quit if
      pushed on accountability. Acceptance must mature first.
- [ ] **#3 Product-mix / non-fuel margin lever** (non-fuel share of margin per
      outlet). HELD: **sensitive**. Revisit carefully.

FUTURE: once there are **more outlets**, **anonymize cross-owner data** and feed
owners anonymous peer-benchmark inputs — a network-effect intelligence play.

⚠️ WHY PAUSED: an owner who fears his manager won't turn up tomorrow is signalling
that *sequencing* beats features. Resume on the owner's go — lead with the
manager-FRIENDLY surfaces first, bring accountability/benchmarking in once trust is there.

## 12. Environment / connector security hardening (deferred 2026-06-28)
Owner asked to use the security tooling Supabase/Vercel provide. None are fires;
they make the platform "stronger over time". Pick a calm slot. Prioritised:

Tier 1 (high value, low effort — mostly dashboard, no code):
- [ ] **2FA on ALL four dashboard accounts** — GitHub, Vercel, Railway, Supabase.
      These control prod DB, deploys and secrets; biggest bang for buck.
- [ ] **Lock down staging access** — `staging.pumpini.in` is PUBLIC and holds
      **real customer PII** behind the login. Turn on **Vercel → Deployment
      Protection** (Vercel Auth or password) on the staging project.
- [ ] **Run Supabase Security Advisor** (Dashboard → Advisors) on prod + staging; fix
      what it flags (RLS gaps, exposed views, function search_path, etc.).
Tier 2 (defence-in-depth):
- [ ] Supabase: **enforce SSL** + consider **Network Restrictions** (allowlist Railway
      egress IPs) so only the backend can reach the DB.
- [ ] Supabase **PITR** (point-in-time-recovery backup add-on) — cheap insurance for a
      money system.
- [ ] Vercel **WAF / rate-limiting** on prod (bot/abuse protection).
- [ ] **Rotate the prod DB password** (it was typed into a chat during the staging
      build-out) — reset in Supabase + update prod Railway `DATABASE_URL` + redeploy.
      Also rotate the staging password. ~2 min, brief redeploy blip.

## 13. Get document images OUT of Postgres → object storage (deferred 2026-06-28)
Most images are already stored as references (`photo_url`, `plate_photo_url`,
`challan_photo_url`, `bank_statement_url`, `logo_url`, `qr_code_url`) — good. BUT two
columns embed the raw image **as base64 text inside Postgres**: `file_base64` and
`image_base64`. base64 inflates size ~33%, bloats every backup, and slows the DB.

Decision (owner-approved direction): the fix is **object storage, NOT a second DB**.
- [ ] Move the `file_base64` / `image_base64` blobs into **Supabase Storage** (buckets);
      keep only the URL/path in the DB — same pattern the other images already use.
- [ ] For old-document lifecycle, use **Storage lifecycle/retention rules** (auto-archive
      or cheapen objects >1 month old) — far simpler than a separate archive database.
- ⚠️ **Medium/high impact** (changes how documents are written/read across deliveries,
      invoices, receipts, meter photos) → ship to **staging first, owner physical-tests**,
      then prod.

## 14. Data-entry out-of-sync detection + data-health tripwire (2026-07-02) — 🔴 OPERATIONAL · PRIORITY
Context: chasing "Highway dashboard off by ₹72" opened a deeper audit. Learnings
(all understood; trade-day dating FIXED in code — synthesis stamps the shift's trade
day, dashboard files by `shifts.date`; historical rows need the gated `occurred_at`
backfill `ops/staging/backfill-occurred-at.sql`). Trust `shifts.date` over
`start_time`/`end_time`/`occurred_at` (entry-time, lag by days).

Shift-start dip-or-litres input (owner refined: accept EITHER, infer source from the
input — litres = ATG/HPCL reading with `dip_cm` NULL; dip typed = physical check):
- [x] BUILT (on branch → staging): shift-start dip step takes a dip OR a litres value
      per tank. **Pending staging test → then prod.**

Still to build — an **out-of-sync / data-health tripwire**, visible ACROSS outlets:
- [ ] Flag **missing daily dip entry** (no dip for a tank for N days).
- [ ] Flag **overdue weekly physical-dip confirmation**.
- [ ] Flag **late/batch closes** (shift closed ≫ its trade day) and **shifts left
      open** past their day — the mis-dating early-warning.
- [ ] Surface as a small **"data health"** indicator on the dashboard AND in the
      owner/global rollup, so out-of-sync entry is obvious at a glance.

LEARNING to keep visible: staff skip cadence (dips, timely closes) unless the system
nags — ship the tripwire, and add reconciliation (meter↔POS↔dip, trade-day dating)
to the per-role smoke test.

## 15. Orphan / duplicate open shifts — manual delete + empty-close (2026-07-02) — 🔴 OPERATIONAL · PRIORITY
At bring-up staff **open multiple shifts** that never close, skewing "live" tiles and
blocking clean reconciliation. Owner decision: **manual delete**, guarded — a delete
button enabled ONLY when the shift has **no operators** AND **another shift the same
date has operators**. No auto-close.
- [x] BUILT (on branch → staging): `DELETE /api/shifts/:id` (guard + refusal on any
      real activity + safe cleanup of the orphan's opening dips) and empty-shift
      **close** on End-Shift (for the case with no sibling). **Pending staging test →
      then prod.**
- [ ] (later) warn/block opening a *second* concurrent shift for one-shift outlets.

## 16. Shift-start: per-attendant go-live (owner request 2026-07-02) — 🔴 OPERATIONAL · PRIORITY
Owner: "Let an attendant start operations as soon as HIS nozzle readings are entered."
Backend ALREADY activates per-attendant (`POST /shifts/:id/assign` persists immediately;
`/shifts/active` returns that operator's shift). The friction was the 3-step wizard
*feeling* like an all-upfront setup.
- [x] BUILT (on branch → staging): bottom CTA relabelled "Start shift"; enabled once
      one operator + nozzle readings are entered; if the add-form holds an un-added
      operator on click, it assigns him first (goes live), then finishes. **Pending
      staging test → then prod.**
- [ ] (later, if wanted) make the Dipstick step skippable at start too.
