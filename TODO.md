# Pumpini — Parked items (owner-approved backlog)

Items the owner asked to keep on the list. Pick these up when he says
"let's visit the TODO".

Items tagged **🔴 OPERATIONAL · PRIORITY** are the exception — the owner wants
these addressed on priority (not parked), ahead of the general backlog.

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
Revisit AFTER the current 7 deployments are live and stable.

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

## 5. User-management access model — relook with ample time (deferred 2026-06-22)
For now the platform admin (/admin) creates ALL users (owners, managers,
attendants) and assigns responsibilities. Owners come back to admin for extra
managers / an auditor (e.g. tally upload). Manager_lite is seeded per bunk
(migration 006) WITHOUT user-management. When we revisit, decide:
- [x] "Add Attendant" — DONE 2026-06-22. /add-attendant + POST /users/attendant
      force role='attendant' + station scope + dummy password (no POS/login);
      perm 'attendant.add' on Manager_lite + manager defaults. Manager-facing.
- [ ] SECURITY: lock down responsibility create/assign. Today POST /api/templates
      and /api/templates/assign are authorize('owner','manager') — a manager can
      mint a template with ANY permissions and assign it (privilege escalation).
      Mitigated for now only because managers don't create users. Tighten to
      owner-only (or "can only grant ⊆ your own perms") when we open this up.
- [ ] How much of this to grant OWNERS (self-serve managers/auditors) vs keep
      with the platform admin.
- [ ] Auditor responsibility (e.g. tally.export + reports.view only).
- [ ] MERGE PENDING: Add-User modal Responsibility picker. Built + pushed to
      branch `claude/voice-triggered-forms-1aa121` (commit 2926ce7) but NOT
      merged to main yet — owner wants to test first. The /admin "Add User to
      Station" modal now has a Responsibility dropdown (lists the bunk's
      role_templates, e.g. Manager_lite) so you can assign at creation instead
      of only via the row dropdown afterward. Merge after click-through.

## 6. Root cause: new station-user password "doesn't work" at first login (2026-06-22)
J Madhu (9398013493, Kamala) was created via /admin Add User; owner is "sure"
he set the password, but login rejected it. Admin **Reset PW → known value →
login succeeded**, so the account/phone/RLS are all fine — the stored hash just
didn't match what the owner typed at login. Deferred: owner will create a fresh
test user and reproduce.

NEW EVIDENCE (2026-06-22, narrows it a lot): we bcrypt-verified a freshly
created owner's stored hash directly. Owner Anjayya (+917680985046) hash was
checked against candidates → **exact match for the typed `Welcome@2026`**, NOT
the `Welcome@123` default. So the Add-User modal **does persist the exact typed
password**; the create→hash→store path is sound.
=> The "silent Welcome@123 default" / "modal drops password" theory is
   effectively DISPROVEN. Madhu's one-off failure was almost certainly a
   typo/mismatch between what was typed at creation vs at login that day. No
   code bug. Downgrade this whole item to a non-bug unless it reproduces.

Leading hypotheses (verify, don't assume):
- (downgraded) Password field blank at creation → silent `Welcome@123` default.
  Contradicted by the Anjayya hash check above.
- Human typo/mismatch between create-time and login-time entry. **Most likely.**
- Stray leading/trailing space or autofill mismatch between create vs login.
- (ruled out) phone normalization / is_active / RLS — all verified OK.

When reproducing, capture:
- [ ] Exactly what's typed in the modal Password field at creation (screenshot).
- [ ] The Network `login` response status on first attempt: 401 = hash mismatch
      (password problem, expected); 200-then-bounce = different bug.
Hardening (now nice-to-have, not a bug fix — see NEW EVIDENCE):
- [ ] Make the Add-User Password **required** (no silent Welcome@123 default), OR
      show the effective password back to the admin after create, OR force
      must_change_password=TRUE so the user sets their own on first login.
      Rationale shifts from "fix a bug" to "remove operator ambiguity".

## 7. Admin-set Station Code + attendant display (deferred 2026-06-22)
Owner wants attendants uniquely identifiable so common names (e.g. dozens of
"Kumar") aren't confused across the 7 outlets, especially once POS login goes
live. DECISIONS (owner-approved):
- Attendant unique key / future POS login = **mobile number**. ALREADY ENFORCED:
  POST /users/attendant requires name+phone, users.phone is globally UNIQUE
  (dupes → 409 "already registered"), add-attendant list shows the mobile, and
  RLS scopes each station's attendants. So disambiguation is already handled.
- **Station Code** = a short code (e.g. KAM) the platform admin sets per outlet.
  NOT YET BUILT. Scope when picked up:
  - [ ] Migration: ALTER TABLE stations ADD COLUMN code VARCHAR(8) (nullable).
  - [ ] superadmin POST /stations + PATCH /stations/:id accept & return `code`.
  - [ ] /admin station create/edit modal: add a "Station Code" input.
  - [ ] Show the code in cross-station/admin/group views and (optionally) beside
        attendant names where outlet context helps (e.g. "Kumar · KAM").
  Note: with mobile-as-key already done, the station code is a human-readable
  display aid, not a uniqueness mechanism — low urgency.

## 8. Tank Name/Label field — SKIPPED by owner (2026-06-22)
Considered adding an optional descriptive tank label (e.g. "Diesel — East") so
two same-capacity diesel tanks read clearly for operators. Owner said IGNORE —
plain "Tank 1 / Tank 2" (number = sequential id, not capacity) is fine. Capacity
(20000) goes in the Capacity field. Revisit only if operators ask.

## 9. Add a "Pump" layer above nozzles (deferred 2026-06-22)
Owner request. Today the hierarchy is Tank → Nozzle. Add a **Pump** (a.k.a.
dispensing unit) layer in between, so each nozzle belongs to a numbered pump:
  Tank → (Nozzle) and Pump → Nozzle(s), with Nozzle still mapped to a Tank.
WHY it's valuable: the physical **pump stock slips** (the printed meter/receipt
the operator tears off) carry the **pump number**. Capturing the pump number in
our model lets us tie meter readings, receipt images, and reconciliation to the
exact physical pump — much stronger audit trail and matches what staff read off
the slip.

Scope when picked up:
- [ ] New table `pumps` (id, station_id, pump_number/label, ...). RLS: direct
      station_id isolation (add to rls/02 direct-tables list).
- [ ] `nozzles` gets `pump_id` FK (nullable first for backfill, then required).
- [ ] Settings → Pumps tab (CRUD), and nozzle form picks its Pump.
- [ ] Show pump number in shift-start/-end (operator readings grouped by pump),
      dipstick/receipt capture, and dashboards where nozzle appears.
- [ ] Backfill: create a default pump per existing nozzle grouping, or prompt
      the owner to map existing nozzles to pumps.
Note: a pump typically has 1-2 nozzles (e.g. one per fuel, or two same-fuel
guns). Keep nozzle→tank mapping intact; pump is an organisational/audit layer.

## 10. Dipstick + attendant entry on an already-open shift (watch item 2026-06-22)
Owner opened a shift but hadn't collected the opening dip / attendants yet, plans
to load them later onto the OPEN shift (dip readings + assign operators + pump
receipt images). Confirmed backend allows assign while open and next-day close.
IF the open-shift screens don't allow loading the opening dipstick after the fact
(e.g. dip capture is gated to shift-open only), make opening dip enterable on an
open shift. Revisit only if owner reports he can't load it.

## 11. GO-LIVE LEARNINGS (Kamala, 2026-06-22) → harden before the Vishakhapatnam round
Context: first production outlet bring-up took ~5h vs the ~30min expected. The
time went almost entirely into DIAGNOSING first-time-in-prod issues (RLS freshly
enabled + generic error messages), NOT into building. Most root causes are now
FIXED and benefit every future outlet. Plan: finish the 2 current implementations,
then in the ~8-day gap fix Section B before the next 4 (Vizag).

### A. Root causes already FIXED tonight (should not recur)
- RLS write-path gap: Add Attendant inserts into `users` under a MANAGER's
  (non-bypass) identity — the only user-creation path not on the admin bypass
  role — so RLS blocked it. FIX: run that insert on the bypass role
  (pool.als.run(undefined,…)). LESSON: when RLS is enabled, EVERY write path must
  be tested under a real manager/attendant identity, not just the admin console.
- Stale DB connections ("first click fails, retry works"): idle pooler/NAT drops
  a connection the pool still thinks is alive. FIX: keepAlive + auto-retry on
  connection-layer errors only (pool.js). Global — protects all outlets incl. POS.
- Owner fail-open overrode an assigned responsibility (owner saw the FULL sidebar
  despite Owner_lite). FIX: an assigned responsibility now caps owners too.
- Margin tile 500'd on a non-existent `stock_receipts` table. FIX: correct table
  name (product_stock_receipts). Only surfaced when that screen was hit in prod.
- New users weren't forced to change password (inconsistent with Reset PW).
  FIX: must_change_password=TRUE on create (station-users + owners).

### B. Hardening to do in the 8-day gap (BEFORE Vizag)
- [ ] Surface backend error detail in ALL forms (fixed add-attendant only; others
      still show generic catch-alls). Precise message = minutes, not hours.
- [ ] Pre-go-live SMOKE TEST checklist, run as EACH role (owner/manager/attendant)
      under live RLS: add attendant, open+close shift, dipstick, delivery, invoice,
      dashboard, AI chat. Catches RLS/permission gaps before the client is watching.
- [ ] Per-outlet SQL/migration checklist (which scripts to run in Supabase, in
      order). Manual migrations caused repo↔prod DRIFT tonight (users RLS policy,
      settings.manage top-up). Consider a tiny migration runner / version tracker.
- [ ] Vercel canonical domain redirect (www → apex). The www/apex origin split
      cost time on a phantom "login bounce."
- [ ] CI gate: frontend `npm run build` + backend boot check before merge to main.
      A broken main blocks ALL outlets; tonight we pushed straight to prod ~10x.
- [ ] Document the permission model (Role vs Responsibility vs Plan; owner
      fail-open; owner-only sidebar role-gates). The /admin UI conflates Role and
      Responsibility — caused the Manager_lite-vs-Owner_lite mis-assignment.

### C. Net
The 5h was first-time-RLS-in-prod discovery + generic errors, not inherent
fragility. With Section A fixed and Section B done before Vizag, a fresh outlet
should be close to the ~30min it ought to be.

## 12. Bank deposit confirmation (reco) — who confirms? (pending owner, 2026-06-23)
On Bank Deposits, a recorded deposit shows **"Bank Confirmed: Pending"** until
someone confirms it actually hit the bank. Today that confirm is **owner-only**
(`PATCH /api/cash-deposits/:id/confirm` → `authorize('owner')`), so a MANAGER can
record a deposit but cannot confirm it — it sits Pending. Example: J Madhu
(manager) recorded ₹4,00,000 on 22 Jun → Pending (no owner has confirmed).

This is a **maker-checker / segregation-of-duties** decision, NOT a bug:
- Option A — give the **manager** the confirm (reco) capability (self-serve, faster).
- Option B — **leave confirmation to the accountant/owner** — a separate person
  who *checks what the manager does* (stronger control; manager records, checker
  verifies it reached the bank).

Owner (junutala) to decide and revert. Default lean = **B** (keep maker≠checker;
the whole point of the confirm step is independent verification). If A is chosen:
relax the confirm route to `authorize('owner','manager')` + add a `deposits.confirm`
permission, and decide whether a manager can confirm his *own* deposit or only
another's. No build until the owner confirms the model.

## 13. Dashboard cockpit redesign — DESIGNED + FROZEN, build PAUSED (2026-06-23)
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
      outlet). HELD: **sensitive**. Outlets are forced to sell fuel above the local
      market (roadside automobile shops undercut); to hit OMC targets, stock is
      sometimes moved on paper (paying the GST component to the supplier). Surfacing
      non-fuel margin would expose this. Revisit carefully.

FUTURE: once there are **more outlets**, **anonymize cross-owner data** and feed
owners anonymous peer-benchmark inputs — a network-effect intelligence play.

⚠️ WHY PAUSED: an owner who fears his manager won't turn up tomorrow is signalling
that *sequencing* beats features. A manager-accountability cockpit shipped into
active resistance risks attrition. Resume on the owner's go — lead with the
manager-FRIENDLY surfaces (the action/ops help that makes the manager's day
easier), and bring accountability/benchmarking in only once trust is there.

## 14. Environment / connector security hardening (deferred 2026-06-28)
Owner asked to use the security tooling Supabase/Vercel provide. None are fires;
they make the platform "stronger over time". Pick a calm slot. Prioritised:

Tier 1 (high value, low effort — mostly dashboard, no code):
- [ ] **2FA on ALL four dashboard accounts** — GitHub, Vercel, Railway, Supabase.
      These control prod DB, deploys and secrets; a leaked dashboard login dwarfs any
      app-level risk. Biggest bang for buck.
- [ ] **Lock down staging access** — `staging.pumpini.in` is currently PUBLIC and, since
      we loaded the real-data copy, holds **real customer PII** behind the login. Turn on
      **Vercel → Deployment Protection** (Vercel Auth or password) on the staging project.
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

## 15. Get document images OUT of Postgres → object storage (deferred 2026-06-28)
Most images are already stored as references (`photo_url`, `plate_photo_url`,
`challan_photo_url`, `bank_statement_url`, `logo_url`, `qr_code_url`) — good. BUT two
columns embed the raw image **as base64 text inside Postgres**: `file_base64` and
`image_base64`. base64 inflates size ~33%, bloats every backup, and slows the DB.

Decision (owner-approved direction): the fix is **object storage, NOT a second DB**.
- [ ] Move the `file_base64` / `image_base64` blobs into **Supabase Storage** (buckets);
      keep only the URL/path in the DB — same pattern the other images already use.
- [ ] For old-document lifecycle, use **Storage lifecycle/retention rules** (auto-archive
      or cheapen objects >1 month old) — far simpler than a separate archive database.
- Why NOT a second Postgres DB: adds sync complexity, cross-DB queries, and another
      thing to secure/back up, without fixing the root cause (images shouldn't be in
      Postgres at all).
- ⚠️ **Medium/high impact** (changes how documents are written/read across deliveries,
      invoices, receipts, meter photos) → per the change-management rules, ship to
      **staging first, owner physical-tests**, then prod.

## 16. Data-entry out-of-sync detection + Highway reconciliation learnings (2026-07-02) — 🔴 OPERATIONAL · PRIORITY
Context: chasing "Highway dashboard off by ₹72" opened a deeper audit. What we
learned (all now understood; owner to advise on the data fix):
- **Sales were filed by data-ENTRY time, not trade day.** Manager closes stamped
  `occurred_at = NOW()`, and the dashboard bucketed by `occurred_at::date`. When a
  manager closes days late / in batches, multiple trade days pile onto one calendar
  day → totals that don't reconcile. Affects ALL outlets (Kamala 1-day lag, Highway
  1–3 days). FIXED in code (synthesis now stamps the shift's trade day; per-shift
  dashboard files by `shifts.date`); historical rows need the gated `occurred_at`
  backfill (`ops/staging/backfill-occurred-at.sql`).
- **`shifts.date` is the reliable trade-day label** — trust it over
  `start_time`/`end_time`/`occurred_at`, which are entry-time and lag by days.
- **Dips not entered as agreed.** Owner has AUTOMATED (ATG/HPCL) dip readings, so
  staff skip physical dips. The agreed cadence — enter the HPCL reading DAILY, and a
  PHYSICAL dip confirmation ONCE A WEEK — is not being followed. Highway has ZERO
  dips → wet-stock reco can't run. (Adhoc Highway, by contrast, had demo/garbage
  meter values — separate item, validate later.)

OWNER AGREED (2026-07-02) on the cadence: staff enter the **ATG/HPCL dip every day**
into Pumpini, and a **physical dip once a week**; a large weekly variance is flagged.
Build note: distinguishing "ATG-entered" from "physical" needs a small schema field
(e.g. `dipstick_readings.method`/`source`) — schema change, staging-first, owner-gated.

TODO — build an **out-of-sync / data-health tripwire**, visible ACROSS outlets:
- [ ] Flag **missing daily dip entry** (no dip for a tank for N days).
- [ ] Flag **overdue weekly physical-dip confirmation**.
- [ ] Flag **late/batch closes** (shift closed ≫ its trade day) and **shifts left
      open** past their day — the mis-dating early-warning.
- [ ] Surface as a small **"data health"** indicator on the dashboard AND in the
      owner/global rollup, so out-of-sync entry is obvious at a glance.

LEARNING to keep visible (fold into GO-LIVE LEARNINGS §11 before Vizag): staff skip
cadence (dips, timely closes) unless the system nags — ship the tripwire, and add
reconciliation (meter↔POS↔dip, trade-day dating) to the per-role smoke test.

## 17. Orphan / duplicate open shifts — auto-clean or manual delete (2026-07-02) — 🔴 OPERATIONAL · PRIORITY
At bring-up staff make mistakes and **open multiple shifts** that never close. E.g.
Highway had TWO open shifts at once: `96f749ce` (dated 28 Jun but opened 01 Jul and
never closed = orphan) and `0ba36329` (the real current one). Orphan opens skew the
"live" tiles and block clean reconciliation.
OWNER DECISION (2026-07-02): **manual delete**, guarded — a delete button enabled
ONLY when the shift has **no operators** AND **another shift the same date has
operators** (so you can remove an empty stray, never the real working shift). No
auto-close.
- [x] BUILT (2026-07-02, on branch → staging): `DELETE /api/shifts/:id` with the
      guard + refusal on any real activity (sales/settlement/invoices/deliveries/
      suspense) + safe cleanup of the orphan's opening dips; Delete button on the
      shift-start "Currently open shifts" list, shown only when eligible. **Pending
      staging test**, then prod.
- [ ] (later) warn/block opening a *second* concurrent shift for one-shift outlets.

## 18. Shift-start: per-attendant go-live (owner request 2026-07-02) — 🔴 OPERATIONAL · PRIORITY
Owner: "We can't start the shift until ALL attendants are assigned — start-shift
makes no sense. Let an attendant start operations as soon as HIS nozzle readings
are entered."
Finding: the backend ALREADY activates per-attendant — `POST /shifts/:id/assign`
persists immediately and `/shifts/active` returns that operator's shift right away,
so an operator is live the moment he's added (no all-operators gate in the API). The
friction is the **3-step wizard** (Open → Dipstick → Operators, ending in one "Start —
Shift is live ✓" button), which *feels* like a single upfront setup that isn't live
until the end.
OWNER CLARIFIED (2026-07-02): make the bottom CTA a **"Start shift"** that activates
as soon as ONE operator + his nozzle readings are entered, so an attendant goes live
the moment his readings are recorded — no waiting for the rest.
- [x] BUILT (2026-07-02, on branch → staging): bottom CTA relabelled "Start shift";
      enabled once one operator is added OR the add-form holds a picked operator with
      a nozzle. On click, if the form holds an un-added operator it assigns him first
      (he goes live via the existing `/assign` → `/shifts/active` path), then finishes.
      **Pending staging test.**
- [ ] (later, if wanted) make the Dipstick step skippable at start too.
