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

## 14. CNG commission rate — move it from an env var to a Settings field (NEW 2026-08-04)
> Shipped 04-Aug (PR #260): CNG margin is a **commission of ₹2.03/kg sold**, not
> `sell − buy`. We never buy the gas — the IOCL contractor owns the stock, which is also
> why CNG has no dip and no opening/closing stock. Before this it booked **₹0** for
> months (₹81,808 unreported at Kamala this FY) because the margin formula everywhere
> was a subtraction and a commission has no buy price to subtract.
>
> The rate currently lives in the `CNG_COMMISSION_PER_KG` env var on Railway, so
> changing it needs a dashboard visit. The owner should be able to change it himself the
> day the contractor revises it.
- [ ] **CNG commission as an editable Settings field**, per outlet, feeding
      `marginService.unitMargin` (keep the env var as the fallback default). Reuse the
      existing Settings form — no new screen, no new route (cardinal rule).
- [ ] Keep it as a **commission**, NOT a fabricated purchase price. The owner proposed
      (04-Aug) setting a CNG buy price of `sell − 2.03` so the ordinary margin maths would
      work, and agreed against it once the two failure modes were shown. **Do not
      re-propose it, and do not "simplify" the commission into a buy rate later:**
      1. **The pump price moves; the commission does not.** Kamala CNG went ₹107.00
         (20-Jun) → ₹108.00 (01-Aug). A buy price pinned at ₹104.97 would have silently
         reported ₹3.03/kg — 49% overstated, ~₹40k/yr at current volume — with nothing
         on screen looking wrong. Two numbers kept in lockstep by memory is the bug.
      2. **A buy rate can only be recorded as a DELIVERY, and a delivery moves stock.**
         `fuel_deliveries` is the only source of `rate_per_ltr`, and prod has
         `trg_increase_stock AFTER INSERT ON fuel_deliveries → increase_tank_stock()`.
         A fake CNG purchase would inflate stock we do not own and cannot dip, breaking
         Stock Reco and days-of-cover to fix a margin figure.

## 15. Group View — reclaim the retired "Outlets" slot for DRIFT reporting (NEW 2026-08-04)
> The **"Outlets" list is retired** from Group View (PR: retire-outlets-tile, 04-Aug). It
> showed, per outlet, four unlabelled figures in a row — `₹1,90,487 · 2.29%` then a red
> **stock loss** badge then `cash ₹896` — and the sales figure landing immediately before
> that badge read as **the loss**. The owner misread his own dashboard that way; that is
> all the evidence a layout needs. It was redundant besides: the outlet PILLS at the top
> already select an outlet and already carry the health dot.
>
> **The slot is reserved, not abandoned.** Do NOT restore the old list to fill the gap.
> What the owner wants there is the thing Group View currently cannot tell him:
- [ ] **Drift / manual-entry report per outlet** — where a tank or nozzle reading was
      TYPED rather than read off the instrument, and where the chain does not tie:
      - `meter_handover_gap` (shipped 04-Aug) — a nozzle's opening ≠ the previous close.
      - `unverified_meter_entry` (shipped) — closing meters always whole litres, i.e.
        typed, not scanned off a slip that prints 3 decimals.
      - `handover_mismatch` (shipped) — a tank's closing dip vs the next opening dip.
      - `pending` openings (shipped 04-Aug) — a shift opened while its predecessor was
        unsettled, so no close could be carried.
      These already exist as data-health flags; this is a per-outlet ROLL-UP of them in
      the group rollup, not a new detector. **Reuse `dataHealthService` — do not write a
      second one** (one-writer rule).
- [ ] **Label every number.** The retired tile's whole failure was unlabelled figures
      sitting next to a coloured badge. Whatever replaces it says what each figure IS,
      or it repeats the mistake in a new costume.

## 16. Kamala — verify 9 historic chain breaks against the physical records (🔴 NEXT SESSION)
> **The owner is bringing the Kamala records.** This is the open thread from 04-Aug:
> the exact rows to check are below so nothing has to be re-derived.
>
> **Context.** The opening-carry fix (#248 for dips, PR #259 for meters) means a nozzle's
> opening now always equals the previous close. Before that, openings could be typed, and
> **9 legs across the three real outlets don't tie**. This is HISTORY — the fix does not
> repair it, it only stops new ones and flags the class via `meter_handover_gap`.
> Nothing has broken since **18-Jul**; 106/106 legs since 01-Aug are exact.
>
> **What the numbers cannot tell us:** whether these are mistyped openings or genuinely
> missing fuel. In the database both look identical. Only the physical records separate
> them — which is why this needs the owner, not another query.

| outlet | nozzle | date | recorded opening | previous close | gap |
|---|---|---|---|---|---|
| Kamala | 1.2 petrol | 29-Jun | 1,572,022.000 | 1,571,270.000 | **+752.000** |
| Kamala | 4.2 CNG | 05-Jul | 254,258.530 | 254,058.530 | +200.000 |
| Kamala | 4.2 CNG | 14-Jul | 261,397.590 | 261,297.590 | +100.000 |
| Kamala | 4.2 CNG | 04-Jul | 253,189.760 | 253,289.760 | **−100.000** |
| Kamala | 4.2 CNG | 18-Jul | 263,821.930 | 263,751.930 | +70.000 |
| Kamala | 4.1 CNG | 14-Jul | 299,707.180 | 299,677.180 | +30.000 |
| Kamala | 2.2 diesel | 26-Jun | 2,138,869.000 | 2,138,886.000 | **−17.000** |
| Highway | 3.2 petrol | 10-Jul | 519,879.160 | 519,879.960 | −0.800 |
| Adhoc | 1.1 / 1.2 premium | 09-Jul | — | 250.000 (setup seed) | **NOT a break — commissioning artifact, ignore** |

- [ ] **Start with 29-Jun petrol 1.2 (+752 L)** — the only one large enough to be real fuel
      (~₹75,000 at pump price) and the only single-event, non-round figure. Everything else
      is small or patterned.
- [ ] **The 5 CNG rows are almost certainly typing, not loss.** Every figure is round
      (200 / 100 / −100 / 70 / 30) and one is NEGATIVE — a totalizer cannot run backwards,
      so that opening was simply entered below the prior close. Confirm the habit with the
      operator rather than hunting for gas.
- [ ] **Highway −0.8 L and Kamala −17 L**: note and close. Immaterial.
- [ ] Scale check so the conclusion stays proportionate: **1,269 L against 246,347 L sold
      at Kamala = 0.52%**, all of it before 18-Jul. Highway is 0.8 L in 209,775 L. Adhoc
      is clean.

> **Do not re-run the discovery.** The query that produced this table is in the 04-Aug
> session: `shift_attendant_nozzles` joined to itself via `LATERAL` on the previous leg
> by `shifts.start_time`, filtered to the three real outlets and `abs(gap) > 0.0005`.
> Re-deriving it invites a different filter and a different answer.

---

## 17. Capture the pump's RUPEE totalizer alongside the litre one (NEW 2026-08-16)

Owner-requested, deliberately deferred: **capture only, build nothing on it yet.**
Raised out of Srinivas Yarramada's (Sri Balaji) round-amount rounding claim — the
analysis of that claim is `docs/round-amount-rounding-drift.md` and is settled; this
item is the *useful* half that came out of it.

**Already true, no work needed.** `parse-slip` reads the ETOT slip's `A:` (rupees) line
as well as `V:` (litres) and stores both in the `nozzle_slip` artifact's `ocr` JSON,
per nozzle, with the photograph and the pump serial. It also guards the swap where the
rupee figure is mistaken for the volume. Nothing is being thrown away today — it is
simply in a JSON blob rather than a queryable column, and no outlet has scanned a slip
in prod yet, so there is no history.

- [ ] **Add the two columns** to the ONE meter store, so the rupee register lives beside
      the litres and never becomes a second home for the same fact:
      ```sql
      ALTER TABLE public.shift_attendant_nozzles
        ADD COLUMN IF NOT EXISTS opening_amount numeric(14,3),
        ADD COLUMN IF NOT EXISTS closing_amount numeric(14,3);
      ```
      Additive and nullable, so code may ship either side of the DDL. Owner-run, one step.
- [ ] **Populate from `parse-slip`** on scan. Written by that path only; **read by nothing.**
      No settlement change, no screen change, no behaviour change.
- [ ] **Backfill** from `station_artifacts.ocr` for any slip already scanned before the
      columns existed — the JSON holds `cumulative_amount` per nozzle, so the history is
      recoverable rather than lost.
- [ ] **Only then** consider the actual prize: settle the operator on the money the pump
      says it took, instead of inferring it as `(closing V − opening V) × rate`. Two
      independent totalizers give a cross-check that no amount of volume arithmetic can —
      a rate changed mid-shift, a misread slip, a tampered meter. That is the enhancement
      worth building, and it is a control argument, **not** a recover-lost-money argument.

> **Do not justify this on the rounding.** It was measured: ₹1.26 across three outlets in
> two months, order of ₹8 a year, and the bias runs opposite to the way it was reported.
> `docs/round-amount-rounding-drift.md` carries the working and both queries so the
> conclusion can be re-run rather than re-argued.

---

## 18. Lead tool — the enhancement batch after the owner's field days (NEW 2026-08-22)

> Parked deliberately. The owner is running `pumpini.in/lead` himself for two or
> three days before hiring a temp resource, and wants everything below shipped as
> **one enhancement** informed by that use — not drip-fed now. Do not pick single
> items off this list early; wait for his field feedback and fold it in.

### 18a. Revoking a temp's access — a blacklist does NOT work

The gate accepts **any** mobile number entered twice (owner's call 22-Aug). So
there is nothing to revoke: an ex-temp who is blacklisted types another ten
digits and is straight back in. A blacklist is the appearance of revocation
without the substance, and it costs exactly as much to maintain as the thing
that would actually work.

**The only mechanism that revokes is a whitelist**, which the owner declined on
22-Aug when revocation was not yet a requirement. It is now. Proposed shape:

- A small `lead_agents` table — `mobile`, `name`, `is_active`, `end_date`.
  Mirrors how attendants are already governed (`is_active` + `end_date` drive the
  Start-Shift picker — see CLAUDE.md house facts), so a fortnight's hire lapses on
  its own rather than relying on the owner remembering.
- 🔴 New table ⇒ its RLS policy ships in the SAME DDL block. Not station-scoped
  (a lead belongs to no outlet), so mirror `leads`/`lead_interactions`: public
  INSERT is not even needed here — superadmin SELECT plus whatever the login path
  requires. Check `pg_policies` before calling it done.
- Managed from the `/admin` Leads screen. One writer, thin guarded routes.
- **Falls out for free:** `captured_by` becomes a NAME on every lead instead of a
  bare number, and "which temp produced what" becomes answerable.

**🔴 Deployment gotcha — this one locks a temp out mid-street if missed.** The
instant the whitelist goes live an unlisted number stops working. Seed the table
from the `captured_by` values already in `leads` **in the same migration**, so
everyone currently in the field keeps working and notices nothing.

**The honest alternative is to do nothing.** An ex-temp can only ADD leads, never
read one, and the owner reviews this data daily — junk from an unfamiliar number
is obvious and deletable in a click. That is cleanup rather than prevention, and
with one or two temps he personally knows it may genuinely be enough. Decide by
whether he expects to hire and release people repeatedly.

### 18a-bis. No way to add a phone to an existing lead (hit 23-Aug-2026)

The owner came back from Arcot Road with two manager numbers — Satish 9585700617
for Selvan, Arul 9751473216 for Tnccf — and **could not enter them**. A lead filed
by a refusal CTA has no number by design, and nothing in the UI edits one
afterwards: the rail card shows the phone but cannot change it, and the /admin
Leads table exposes only status and notes. He had to ask for a SQL update, which
is not a workflow.

The backend already allows it — `PATCH /superadmin/leads/:id` accepts `phone` and
`name` (both are in `LEAD_FIELDS`). So this is a UI gap only: an editable phone
(and name) on the rail card, writing through the PATCH that already exists. No
new endpoint, no new writer.

Two things settled while this came up, so they are not re-litigated:

- **The name convention is the owner's:** *"that's the same style I am entering
  if the manager number is given"* — `Satish - Manager`, with the role in the
  text. `leads.name` is nominally the OWNER; the suffix is what stops a manager
  being read as one later.
- **A separate owner-number field was deliberately NOT added.** Owner,
  23-Aug: *"We will think later how to add owner number later, if required."*
  Do not build a second phone column on a hunch — one number plus an honest label
  is holding fine.

Uma service station stays deliberately blank: the attendant did not share a
number. The card now reads "No number yet" rather than offering a dead link.

### 18b. Language selector on /lead — deferred, may never be needed

Owner, 22-Aug: *"I dont intend to hire a doctorate in computer applications guy
for this job. So, keeping it simple helps all of us."* No language button was
added, and the recorder tells Sarvam `en-IN` (from `localStorage.i18nextLng`,
defaulting to `en`).

This has NOT bitten yet: the owner's own Tamil-inflected speech transcribed
cleanly to English with the `en-IN` hint and `mode: 'translate'`. Revisit only if
a temp speaking pure Tamil or Telugu produces poor transcripts. **Check the
zero-UI option first** — Sarvam may accept an auto-detect language code, which
would fix it without putting a single control on the screen.

### 18c. Things deliberately NOT built — do not re-propose without new reason

Each was considered on 22-Aug and rejected with the owner. Re-raising any of
these needs a NEW argument, not a fresh pair of eyes:

- **A photograph of the outlet on the refusal CTAs.** The strongest proof of
  presence, and unsafe here: the one manager who refuses to share owner details
  is exactly the one who reacts badly to a camera. Owner: *"what if he calls
  police? this could lead to bigger problems."*
- **GPS gating, cluster/impossible-travel warnings, effort scoring.** The owner
  takes over from the second interaction onward, so there is no incentive to fake
  a visit he will personally work. *"I cannot be policing my job."*
- **A "location is off" banner on the temp's screen.** He watches this data daily
  and will phone the temp by the second or third lead if map pins stop arriving —
  faster than a banner a temp can dismiss.
- **Showing coordinates/accuracy/clock to the temp.** His own three captures sat
  3.3 m apart with the device reporting ±14–17 m: ordinary consumer-GPS jitter. A
  latitude a temp can do nothing with is decoration, and it also means any "same
  place" test could only ever work in tens of metres, never metres.
- **Mandatory fields.** They collide with the two CTAs, which by their nature have
  no owner name and no mobile. The only floor kept is that SAVE must carry ONE of
  mobile / owner name / outlet name, so the row is not a ghost.

### 18d. Known remaining duplication (also in docs/drift-audit.md)

`app/pos/page.js` and `components/shared/FloatingChat.js` still hold their own
inline MediaRecorder copies of what is now `lib/recordAudio.js`. Migrating them is
its own PR with its own impact analysis — `/pos` is a money screen and does not
get refactored as a side effect of lead-tool work.
