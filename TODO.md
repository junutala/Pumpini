# Pumpini — Parked items (owner-approved backlog)

Items the owner asked to keep on the list. Pick these up when he says
"let's visit the TODO".

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
