# Access-Model Cleanup — Agreed Plan

> **Status: AGREED 2026-07-21. Execute in a fresh session, staging-first.**
> Pairs with `TODO.md §5` and the deferred "document Role vs Responsibility vs Plan"
> item. **High-impact (auth / money / multi-tenant).**
>
> **🔴 Two tracks, kept strictly separate (owner instruction):**
> 1. **The clean access-model framework is a PURE Pumpini refactor.** It is
>    VAWE-agnostic. After it passes on staging, **only this PR goes to production.**
>    **Do NOT dilute it with any VAWE code.**
> 2. **VAWE Lite merely _consumes_ the clean framework** and stays on **staging**
>    (awaiting the full VAWE build + SO buy-in). No VAWE-specific rows, roles, or UI
>    ride the production access-model PR.

---

## 1. The objective — a clean 3-axis model

A user is assigned, in order:

1. **Scope (WHERE)** — a **group** *or* a **standalone outlet** (which outlets they touch). = membership.
2. **Role (WHO)** — manager / owner / attendant / accountant (their job/identity).
3. **Responsibility (WHAT)** — which **sidebar functions** they may use.

These three are **orthogonal**. The confusion to date is that **Role silently grants
functions** (via `roleDefaults` + `authorize(role)` gates on function routes), so Role
does Responsibility's job.

### The one rule that fixes it
**Role never grants sidebar functions. Only Responsibility does.**

- **Role = identity + a tiny set of hard guardrails** never delegated to a template
  (see §5). No feature bag.
- **Responsibility = the single source of "what's on."** Default-deny — enforced at the
  **API**, not just the UI. Not in your responsibility → you cannot reach it.
- **Scope = membership** (group or outlet). Never the only gate on sensitive data.

---

## 2. Entitlement — retire multi-tier Plans, keep a binary

Multi-tier **Plans (Starter/Pro/Enterprise) are retired.** The market needs only two price
points: **₹0 (free) and ₹1,300 (paid)**. Replace the whole plan machinery with **one binary
flag on the outlet:**

> **`outlet.entitlement` = `lite` (free) | `pumpini` (paid).**

This is the Pumpini-vs-Lite "striping." Kept because it is:
1. the **billing source of truth** (what the outlet pays for),
2. the **safety ceiling** — a `lite` outlet's users can only ever hold the SO-tile
   responsibility; a mis-click in `/admin` can't hand them the full app,
3. the **upgrade switch** — conversion = flip `lite → pumpini` + assign full
   responsibilities. One reversible click.

**Effective access = Responsibility ∩ Entitlement**, where `lite` caps to the SO tile and
`pumpini` is uncapped (responsibility decides). A binary has no fail-open/fail-closed
ambiguity — that question is gone.

---

## 3. Principle — Free is FREE (no dark patterns)

The Lite (free) outlet view is **exactly one clean SO tile.** Deliberately **NO**:
- empty/zero dashboard (reads as "broken," wrecks the SO's "it's free and it works" word),
- "sample/demo" dashboard, or "🔒 locked" upsell tiles — **not now.**

Rationale (owner call): in a tight-knit owner community, credibility and word-of-mouth beat
cheap publicity. **Pumpini earns its wallet share on features, not tricks.** Upgrade
discovery happens naturally (owners talk) and via the already-built, opt-in promo rail —
never by dangling a broken-looking cockpit.

---

## 4. Current state (verified) — what's tangled

| Concept | Lives in | Note |
|---|---|---|
| **Role** | `users.role` / `station_users.role` (free-text `varchar(20)`) | gated by `authorize(...)` + `roleDefaults` + frontend redirects |
| **Responsibility** | `role_templates` + `template_permissions` + `user_role_assignments` | per-(user,station) module set; overrides role default |
| **Plan** | `station_subscriptions` → `plans.features` | **being retired → binary entitlement** |
| **Module catalog** | `permission_modules` | code vocabulary (`shifts.view`, …) |
| **Membership** | `station_users` + owner groups | `requireStationAccess` — membership only |
| **Superadmin** | `superadmins` (separate JWT, BYPASSRLS) | `/admin` UI conflates Role & Responsibility |

### Gaps to close
1. **🔴 Membership-only money leaks** — `GET /dashboard/owner`, `/margin`,
   `/cash-integrity` are gated by membership only → any station member can pull sales /
   margin via API. The single biggest hole.
2. **Role-gated function routes** — `authorize('owner','manager')` lets role bypass the
   responsibility. Must move to `requirePerm(module)`.
3. **`roleDefaults` = fat permission bags** — role acting as responsibility; unknown role
   silently falls back to `['dashboard.view']` (accidental grant).
4. **Template privilege escalation (TODO §5)** — `POST /api/templates` + `/assign` are
   `authorize('owner','manager')` → a manager can mint & assign ANY permissions.
5. **Frontend does not gate by module** — sidebar/landing render by role, not effective
   modules.
6. **`/admin` conflates Role & Responsibility** — caused the Manager_lite/Owner_lite
   mis-assignment.
7. **Drifting sources of truth** for responsibility modules (config vs seed vs superadmin).

---

## 5. Target model — precise

- **Scope:** membership (group or standalone). Assigned first.
- **Role (identity + guardrails only).** Guardrails that stay hard-wired to role and are
  **never** delegated to a responsibility:
  - **Financials/margins = owner-only** (backstop even if a template mistakenly lists it),
  - **Attendant = forecourt/settlement-only** (never the office),
  - **User-management (create users / assign responsibilities) = owner-only** (fixes the
    escalation gap).
  Everything else about role is just: which **default responsibility** to suggest.
- **Responsibility (single function gate).** One canonical, seeded set of templates
  (e.g. *Full Ops*, *Owner Full*, *Accountant/Auditor*, *Cashier*, *Settlement-only*, and —
  **on the VAWE/staging track only** — *SO-tile-only*). Effective modules drive **both** the
  API (`requirePerm` everywhere) **and** the frontend sidebar + landing route.
- **Landing is responsibility-driven:** no `dashboard.view` in your effective modules → you
  never load the money dashboard; you land on your allowed home (settlement, or — staging —
  the SO tile). Same mechanism as today's attendant → `/settlement`.
- **Entitlement (outlet binary):** `Effective = Responsibility ∩ Entitlement`.

### Where VAWE Lite fits (staging track — NOT in the prod PR)
With responsibility as the true gate, **VAWE Lite is just an *SO-tile-only* responsibility on
a normal Manager/Owner role, on a `lite`-entitlement outlet.** No special `$_vawe` role, and
the `$_lite` conflation retires. The Lite provisioning (VAWE → Pumpini user creation), the
tile-only landing specifics, and any Lite-branding all live on **staging** with the rest of
VAWE. The production access-model PR ships the **framework**; VAWE consumes it later.

---

## 6. Execution plan (staged; framework → prod, VAWE → staging)

**Track A — clean access-model framework (staging → then PROD, no VAWE):**
1. **Role registry** — one `config/roles.js`: valid roles, each with a *default
   responsibility* + `operational|restricted` category. Delete scattered `roleDefaults`
   fat bags (keep a thin transitional fallback, see step 6).
2. **Retire Plans → binary `outlet.entitlement`** (`lite|pumpini`). Migrate existing
   subscriptions → set entitlement; `Effective = Responsibility ∩ Entitlement`. (Gated SQL,
   owner-run, step-by-step.)
3. **Canonical responsibility templates**, one seeded source of truth; backfill **every
   existing user** with an explicit responsibility so behaviour is unchanged.
4. **🔴 Close membership-only leaks** — audit every data route; add `requirePerm(module)` to
   the sensitive reads (`dashboard/owner`, `margin`, `cash-integrity`, …). Security core.
5. **Move function routes `authorize(role) → requirePerm(module)`**; shrink role gates to the
   §5 guardrails only. Fix template create/assign → owner-only / ⊆-your-perms.
6. **Frontend renders sidebar + landing from effective modules**; default-deny.
   Drop the transitional `roleDefaults` fallback once every user has a responsibility AND
   every route is `requirePerm`-gated.
7. **Smoke test as each role/responsibility.** Validate on `staging.pumpini.in`.
   → **Then this framework PR (and only this) goes to production.**

**Track B — VAWE Lite (staging only, after Track A lands on staging):**
8. Add the *SO-tile-only* responsibility + `lite` entitlement default for VAWE outlets.
9. VAWE → Pumpini auto-provision (create the two Lite users, deduped) + first-login
   (passkey/OTP; SO forwards enroll link).
10. Confirm a Lite user is 403'd on every money endpoint; lands on the SO tile only.

---

## 7. Risks & rules
- HIGH impact (auth / money / multi-tenant). **Staging first; owner tests physically; SQL
  gated step-by-step.** Per-step rollback.
- **Do not touch `manager_lite` / `owner_lite`** (live: POS masking + shift start/end) until
  they're mapped to canonical templates and verified.
- **Keep Track A free of VAWE.** The production PR is Pumpini access hygiene only.
- Changes are additive + tightening; existing users must keep working throughout.

## 8. Decisions locked (2026-07-21)
1. Role never grants functions; only Responsibility does (role = identity + §5 guardrails).
2. Retire multi-tier Plans → binary `outlet.entitlement` (`lite|pumpini`);
   `Effective = Responsibility ∩ Entitlement`.
3. VAWE Lite = *SO-tile-only* responsibility on a normal role — no `$_vawe`/`$_lite`
   special role; staging track only.
4. Landing/redirect is responsibility-driven.
5. **Free is FREE** — Lite view = one clean SO tile; no empty/sample/locked dashboards.
6. Guardrails hard-wired to role: financials=owner-only, attendant=forecourt-only,
   user-management=owner-only.
7. **Access-model framework ships to production clean; VAWE stays on staging.**

## 9. Key file map
- Role gate: `backend/src/middleware/auth.js` (`authorize`) + routes' `authorize(...)`.
- Module gate / effective perms: `backend/src/middleware/permissions.js`
  (`requirePerm`, `roleDefaults`, `getUserPermissions`, plan ∩ responsibility).
- Membership: `backend/src/middleware/stationAccess.js`.
- Responsibilities: `backend/src/config/responsibilities.js`, seed
  `backend/src/db/migrations/006_seed_manager_lite.sql`, tables
  `role_templates` / `template_permissions` / `user_role_assignments`, superadmin
  `/templates*`.
- Money reads to audit: `backend/src/routes/dashboard.js`.
- Plans to retire: `backend/src/routes/superadmin.js` (`/plans`, `/station-subscriptions`),
  `plans` / `station_subscriptions` tables.
- Frontend landing/redirect pattern: `frontend/src/app/dashboard/page.js` (attendant check).
- Superadmin UI (de-conflate Role vs Responsibility): `frontend/src/app/admin/page.js`.
