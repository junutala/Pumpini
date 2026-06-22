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
