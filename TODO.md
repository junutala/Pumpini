# Pumpini — Parked items (owner-approved backlog)

Items the owner asked to keep on the list. Pick these up when he says
"let's visit the TODO". Items tagged **🔴 OPERATIONAL · PRIORITY** are the
exception — addressed ahead of the general backlog.

> **Clean slate 2026-07-23.** This list was rebuilt from a full re-validation
> **against the actual prod code** (not the stale doc) and then trimmed of
> everything shipped. Method going forward: derive truth from code, reconcile the
> doc, don't trust its wording.
>
> **Shipped to PROD 2026-07-23 (removed from the list):**
> - **CI gate** — `.github/workflows/ci.yml`: frontend build + backend
>   boot/route-export check on every PR/push to `main`/`staging`. Catches the
>   2026-07-22 truncated-`stations.js` outage class before merge.
> - **base64 → object storage** — delivery-invoice + meter-photo bytes moved out of
>   Postgres into the private `pumpini-docs` Supabase bucket (URL-in-DB, signed
>   reads, column-tolerant). All 25 invoices + 10 meter photos backfilled; verified.
> - **Data-health tripwire** — read-only cross-outlet flags (missing dip, overdue
>   physical dip, stale-open / late-close shifts, dip handover mismatch) on the
>   manager dashboard + owner Group View. Owner-confirmed on staging.
>
> **Also confirmed already-in-prod during the audit (were wrongly listed as open):**
> credit-ageing report, the full dashboard cockpit (Bunk / Group / Intelligence +
> IRR simulator), owner self-serve user creation, and the operational items
> dip-or-litres / orphan-shift delete+close / per-attendant "Start shift".
> **Disposed by owner:** Pump-above-Nozzle layer, Station Code, dipstick prefill.

---

## 1. AI-search content pass (deferred 2026-06-12) — LOW criticality
> Inbound/organic discovery — a *different channel* from the SO-led push that is the
> current go-to-market. No operational bearing; AI answers lag the web 4–8 weeks.
> Verified 2026-07-23: `/ai`, `/pricing`, `/faq` all absent in prod.

Highest-leverage 20% when picked up: `/pricing` + `/faq` (FAQPage schema) +
LinkedIn page + one demo video. The rest is polish.
- [ ] `/ai`, `/pricing`, `/faq` crawlable pages with FAQPage schema
- [ ] Directory-listing kit (Techjockey / SoftwareSuggest / GetApp)
- [ ] Owner-only: Search Console + sitemap, LinkedIn page, 2–3 directory listings, 90s demo video

## 2. Next.js 15 upgrade — security audit clear-out (deferred 2026-06-22) — LOW–MODERATE
> Hygiene, not a fire: the *critical* auth-bypass CVE was already patched inside 14.x;
> residual advisories are mostly N/A for our setup. Prod is on **next 14.2.35**.
> Do it in a calm slot, isolated worktree, full click-through. (The CI gate that this
> item used to also ask for is now DONE — so this is purely the framework bump.)
- [ ] Bump `next` + `eslint-config-next` to 15.x (>=15.5.16)
- [ ] Migrate async request APIs (cookies/headers/params/searchParams); re-check caching defaults
- [ ] `npm run build` + smoke-test every page; PR to main

## 3. User-management access model — remaining decision (deferred 2026-06-22)
> **→ `docs/access-model-cleanup.md`.** Done: Add-Attendant, owner self-serve
> `/users`, superadmin-only responsibility create/assign + role-affinity guardrail
> (PR #170), lite entitlement cap. Genuinely still open:
- [ ] **Auditor responsibility** (e.g. `tally.export` + `reports.view` only) — no auditor role exists.
- [ ] (optional) let the owner assign a responsibility **at creation** on `/users` (today `createUser` sets role only).

## 4. Dipstick + attendant entry on an already-open shift (watch item 2026-06-22)
Backend allows assign-while-open + next-day close. IF the open-shift screens don't let
you load the opening dipstick after the fact, make it enterable on an open shift.
Revisit only if owner reports he can't load it.

## 5. Full accounting module — owner direction (Phase 3/4)
> Owner's plan (2026-07-23): build complete accounting as a side function so outlet
> owners can drop Tally and depend fully on Pumpini. Big piece; sequenced to Phase 3/4.
- [ ] Scope the accounting module (ledgers, Tally-replacement exports, reconciliation).
- [ ] **Fold in the bank-deposit maker-checker decision here.** (Current prod behaviour:
      the deposit confirm route is `deposits.manage`, which managers hold — so a manager
      can confirm his own deposit (Option A / self-serve). Owner chose 2026-07-23 to leave
      it and revisit segregation-of-duties inside this module rather than re-gate now.)

## 6. Dashboard cockpit — two levers still HELD by owner (2026-06-23)
> The cockpit itself is SHIPPED and live (Bunk View, Group View / Operational, and
> Intelligence with the IRR simulator + leak-ledger). Only these two remain, HELD for
> people-management reasons — do NOT build until the owner says acceptance has matured:
- [ ] **Targets on the scorecard** (per-metric target + gap-to-target ₹ + streak). HELD: managers may resist accountability.
- [ ] **Product-mix / non-fuel margin lever.** HELD: sensitive (exposes above-market pricing / on-paper stock moves).

FUTURE: with more outlets, anonymized cross-owner peer-benchmarking (network-effect intelligence).

## 7. Datacube / dashboard pre-aggregation (NEW 2026-07-23) — build when metrics justify
> From the base64/datacube discussion. Dashboards (Bunk cockpit, Group rollup,
> Intelligence) currently **aggregate live from transactional tables on every load**
> (verified — no materialized views / rollup tables). Fine at 7 outlets; bites at scale.
> This fixes **query load** (not DB size — that was base64). **Measure first** — only
> build if dashboard query time / DB CPU actually shows strain.
- [ ] Pragmatic path: a **daily rollup table written at shift-close** (you already synthesize
      sales then) that the dashboards read — native to Postgres, no new infra. (Alt: materialized
      views, or a Redis cache of computed payloads.)
- [ ] ⚠️ The rollup MUST preserve blind-drop masking + owner-only margin + multi-tenant/RLS
      (the live queries enforce these — a naïve rollup could leak masked open-shift sales).
      → medium/high impact, staging-first, its own design/spec.

## 8. Environment / connector security hardening (deferred 2026-06-28)
> Dashboard-side (Supabase/Vercel/Railway/GitHub) — owner actions, not repo code.
- [ ] **2FA on all 4 dashboard accounts** (GitHub, Vercel, Railway, Supabase) — biggest bang for buck.
- [ ] **Lock down staging access** — `staging.pumpini.in` is PUBLIC and holds real PII → Vercel Deployment Protection.
- [ ] **Run Supabase Security Advisor** on prod + staging; fix what it flags.
- [ ] Supabase enforce SSL + Network Restrictions (allowlist Railway egress); PITR backup add-on.
- [ ] Vercel WAF / rate-limiting on prod.
- [ ] Rotate the prod + staging DB passwords (were typed into chat during staging build-out).

## 9. GO-LIVE hardening — remaining before the next outlet round
> The **CI gate is now DONE** (shipped 2026-07-23). Root causes from the Kamala bring-up
> are fixed. Still open:
- [ ] Surface backend error detail in ALL forms (only add-attendant done; others show generic catch-alls).
- [ ] Pre-go-live SMOKE TEST checklist, run as EACH role under live RLS.
- [ ] Per-outlet SQL/migration checklist (manual migrations caused repo↔prod drift). Consider a tiny version tracker.
- [ ] Vercel canonical domain redirect (www → apex) — verify at the Vercel dashboard.
- [ ] Document the permission model (Role vs Responsibility vs Plan; owner fail-open; sidebar role-gates).

## 10. base64 → storage: final space reclaim (tail of the 2026-07-23 migration)
> The bytes are already safely in the `pumpini-docs` bucket and served from it; the old
> `file_base64` / `image_base64` columns were **kept** as a safety net (reads fall back to
> them). To actually reclaim the Postgres space, once confident over a few days:
- [ ] `UPDATE delivery_invoices SET file_base64=NULL WHERE storage_path IS NOT NULL;`
      and the same for `meter_photos.image_base64` — then (later) `DROP COLUMN`. Owner-gated, prod + staging.
- [ ] Re-point `pumpini-schema.snapshot.sql` after the drop.

## 11. Orphan / duplicate open shifts — follow-ups (🔴 OPERATIONAL · PRIORITY)
> The guarded manual delete + empty-shift close ARE in prod. Remaining:
- [ ] **Lone-orphan delete gap:** a lone empty orphan (only open shift, no sibling with operators)
      has no Delete button (the guard requires a sibling) — only End-Shift "Close empty shift" handles it.
      If the owner wants a lone zero-operator, zero-activity orphan to be *deletable*, relax the guard for that case.
- [ ] (later) warn/block opening a *second* concurrent shift for one-shift outlets.

## 12. Shift-start: per-attendant go-live — follow-up (🔴 OPERATIONAL · PRIORITY)
> The "Start shift" per-attendant CTA is in prod. Remaining:
- [ ] (later, if wanted) make the Dipstick step skippable at start too.

## 13. Data-health tripwire — follow-ups (🔴 OPERATIONAL · PRIORITY)
> The tripwire is SHIPPED to prod. Optional follow-ups surfaced during the build:
- [ ] Historical `occurred_at` backfill on old rows (`ops/staging/backfill-occurred-at.sql`) — gated, for clean trade-day dating on history.
- [ ] Tune thresholds once real usage shows the right cadence (`DATA_HEALTH_*` envs; defaults: dip stale 2d, physical dip 7d, open-shift 1d).
