# Access-Model Cleanup — Approach Document

> **Status:** approach only — no code yet. Written to drive a clean, staging-first
> refactor in a fresh session. Pairs with `TODO.md §5` ("User-management access
> model — relook") and the go-live item *"Document the permission model (Role vs
> Responsibility vs Plan)"*. **High-impact (auth / money / multi-tenant) → staging
> only, owner tests physically, SQL gated step-by-step.**
>
> Trigger: the model drifted while we layered public tiers (Starter/Pro/Enterprise)
> on top of station-scoped roles + responsibilities. "Who does what" is now unclear.
> We also need **VAWE Lite** (`Manager_vawe` / `Owner_vawe`) to slot in cleanly.

---

## 1. Current state — five overlapping concepts (verified from code)

| Concept | Lives in | What it does |
|---|---|---|
| **Role** | `users.role`, `station_users.role` — free-text `varchar(20)` | owner / manager / attendant / cco / rsa / corporate. Gated by `authorize(...roles)` on routes + `roleDefaults` in `permissions.js` + frontend redirects (attendant → `/settlement`). |
| **Responsibility (template)** | `role_templates` + `template_permissions` + `user_role_assignments` | A per-(user, station) module set. **If assigned, overrides the role default — caps even owners.** e.g. `Manager_lite`. |
| **Plan tier** | `station_subscriptions.plan` → `plans.features` (module codes) | The outlet's **ceiling**. Effective = Responsibility ∩ Plan. Public tiers Starter/Pro/Enterprise. |
| **Module catalog** | `permission_modules` | The vocabulary of module codes (e.g. `shifts.view`). |
| **Membership** | `station_users` + owner groups | `requireStationAccess` — checks *membership only*, **not role or module**. The only server boundary on many endpoints. |
| **Superadmin** | `superadmins` (separate JWT, BYPASSRLS) | Creates all users, assigns responsibilities. `/admin` UI conflates Role and Responsibility. |

**Effective-permission formula (today, from `permissions.js`):**
`perms = (assigned Responsibility, else roleDefaults[role], else owner=ALL) ∩ Plan`
with **fail-open** on the Plan ceiling until a plan is configured with real module codes.

---

## 2. Why it's a mess (concrete drift + gaps)

1. **Two gates that don't compose.** `authorize(role)` (hard) and `requirePerm(module)`
   (soft) are applied **inconsistently** — some sensitive routes have one, some the
   other, some only membership.
2. **🔴 Membership-only data leaks.** `GET /dashboard/owner`, `/dashboard/margin`,
   `/dashboard/cash-integrity` are gated by `requireStationAccess` **only**. Any station
   member can pull that outlet's **sales / margin / cash** straight from the API — the UI
   hiding is cosmetic. (CLAUDE.md itself: stationAccess is the server boundary; the
   frontend is "UI-only.") **This is the single biggest hole and the reason a plain
   "responsibility" cannot isolate a Lite user.**
3. **Privilege escalation (TODO §5).** `POST /api/templates` and `/api/templates/assign`
   are `authorize('owner','manager')` → a manager can mint a template with ANY
   permissions and assign it. Mitigated today only because managers don't create users.
4. **Owner fail-open** (partly fixed): owner = whole catalog unless a responsibility caps
   them — easy to forget to cap.
5. **Plan fail-open:** gating only "switches on" once a plan carries real module codes;
   most outlets are currently ungated by tier.
6. **Free-text role, no registry.** No single list of valid roles; `roleDefaults` keyed by
   string; an unknown role silently falls back to `['dashboard.view']` (accidental grant).
7. **Multiple sources of truth** for a responsibility's modules (`config/responsibilities.js`
   vs seed `006_seed_manager_lite.sql` vs historically a hardcoded copy in superadmin) —
   already drifted once (missing `settings.manage`).
8. **`/admin` UI conflates Role and Responsibility** → the `Manager_lite`-vs-`Owner_lite`
   mis-assignment.

---

## 3. Target model (one clean mental model)

- **Role = WHO you are** (relationship to the outlet). Keep free-text **but add a single
  registry** — one config file listing every valid role, its default module set, and its
  **category**: `operational` (loads the full app) vs `restricted` (redirected to a
  minimal view). Kills scattered `roleDefaults` + the unknown-role fallback.
- **Responsibility = WHAT you may touch** (optional module set that caps the role). **One**
  source of truth: DB templates seeded from a single canonical place; config derives from
  DB, never a second hand-copy.
- **Plan = the outlet CEILING** (tier). Effective = (Responsibility or role default) ∩ Plan.
  Decide fail-open vs fail-closed **explicitly** (see open questions).
- **Membership = WHERE** (which stations). Unchanged — **but never the only gate on
  sensitive data.**
- **Superadmin** UI: separate **Role** (identity) from **Responsibility** (permissions).

**Adopt one principle:** *every data endpoint declares its gate explicitly (role and/or
module). Nothing sensitive is membership-only. Default-deny for `restricted` roles.*

---

## 4. Where VAWE Lite fits (designed in, not bolted on)

- **`Manager_vawe` / `Owner_vawe`** = new roles in the registry, category **`restricted`**.
  `role` is free-text `varchar(20)` → **no schema change** to add them.
- **Three independent walls (deny-by-default):**
  1. Excluded from every `authorize('owner','manager', …)` operational route → 403 by omission.
  2. `roleDefaults[…] = []` → `requirePerm`-gated routes deny too.
  3. A **Lite allowlist middleware**: for `restricted` roles, allow ONLY the VAWE tile
     endpoints (`/vawe/interactions*`) + `/auth/me` — 403 everything else. (Also fixes the
     membership-only leak for these users regardless of endpoint audit progress.)
- **Can act on the SO tile:** `requireCanAct` maps `manager_vawe` ≈ manager,
  `owner_vawe` ≈ owner-when-escalated.
- **Scoped to their one outlet** via membership (`station_users`).
- **Frontend:** dedicated minimal Lite view — only the SO tile (+ the promo rail already
  built) — mirroring the attendant → `/settlement` redirect. Never loads the money dashboard.
- **Upgrade path:** flip the role string `manager_vawe` → `manager` (+ finish station setup
  / assign a responsibility). **Zero migration** — they were already Pumpini users.
- **Auto-provision:** SO creates the outlet in VAWE → VAWE calls Pumpini to create the two
  Lite users (deduped by phone/email) as members of that station. Login via passkey/OTP;
  SO forwards the enroll link from his own WhatsApp.

---

## 5. Cleanup plan (staged, staging-first) — tomorrow

Each step independently testable; stop-and-verify between them.

1. **Write the model down** — this doc + a `config/roles.js` **role registry** (valid roles,
   defaults, `operational`/`restricted`), and de-conflate Role vs Responsibility in `/admin`.
2. **Default-deny for `restricted` roles** — add the Lite allowlist middleware. Inert today
   (no restricted roles exist yet) → safe first move.
3. **🔴 Close the membership-only leaks** — audit EVERY data route; add explicit role/module
   gates to the sensitive reads (`dashboard/owner`, `margin`, `cash-integrity`, …). This is
   the security core and the bulk of the work.
4. **Fix privilege escalation** — template create/assign → owner-only (or "grant ⊆ your own
   perms").
5. **Add `Manager_vawe` / `Owner_vawe` + the Lite view** (the actual VAWE Lite surface).
6. **Auto-provision + login** (VAWE → Pumpini user creation; passkey/OTP first login).
7. **Smoke test as EACH role** (owner / manager / attendant / cco / **Manager_vawe**) — for
   Lite, explicitly try to hit money endpoints and confirm **403**. (TODO already asks for a
   per-role smoke test.)

---

## 6. Risks & rules

- **HIGH impact** — auth, money boundaries, multi-tenant. Staging only; owner tests on
  `staging.pumpini.in`; SQL step-by-step, gated on owner confirmation.
- **Do not touch `manager_lite` / `owner_lite`** — live for POS masking + shift start/end.
  VAWE Lite roles are **distinctly named** to avoid collision.
- Changes are **additive + tightening**; existing users must keep working. Per-step rollback.
- Watch **fail-open flips** — turning the Plan ceiling fail-closed could suddenly restrict
  live outlets; sequence carefully behind the tier rollout.

---

## 7. Open questions (decide tomorrow)

- **Plan gate:** stay fail-open, or flip fail-closed once Starter/Pro/Enterprise carry real
  module codes?
- **Self-serve:** how much do owners get to create managers/auditors vs keep it with
  superadmin?
- **Role storage:** keep free-text + registry, or promote to an enum / `roles` table?
- **Lite login:** passkey vs OTP vs SO-forwarded enroll link — pick one for v1.
- **Lite view extras:** does the Lite view carry the promo/upgrade CTA (ties to the marketing
  rail already shipped)?

---

## 8. Key file map (fast start)

- **Role gate:** `backend/src/middleware/auth.js` (`authorize`) + each route's `authorize(...)`.
- **Module gate / effective perms:** `backend/src/middleware/permissions.js`
  (`requirePerm`, `roleDefaults`, `getUserPermissions`, Plan ∩ Responsibility, fail-open).
- **Membership:** `backend/src/middleware/stationAccess.js` (`requireStationAccess`).
- **Responsibilities:** `backend/src/config/responsibilities.js`, seed
  `backend/src/db/migrations/006_seed_manager_lite.sql`, tables
  `role_templates` / `template_permissions` / `user_role_assignments`, superadmin
  `/templates*` endpoints.
- **Money reads to audit:** `backend/src/routes/dashboard.js`
  (`/owner`, `/manager`, `/margin`, `/cash-integrity`, …).
- **VAWE tile:** `backend/src/routes/vawe.js` (`requireCanAct`),
  `frontend/src/components/shared/SoInstructionsTile.js`,
  `frontend/src/app/dashboard/page.js` (attendant-redirect pattern to copy for the Lite view).
- **Superadmin UI (conflates role/responsibility):** `frontend/src/app/admin/page.js`.
