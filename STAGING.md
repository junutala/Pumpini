# Pumpini — Staging environment & promotion runbook

A full, isolated **staging** mirror of production for safe demos and for rehearsing
every change (code **and** schema) before it touches a real outlet.

> The golden rule: **code merges; database and config are *promoted*, never merged.**
> "Seamless" only ever means the code half. The DB + secrets are a deliberate,
> rehearsed, manual step — that is the whole safety mechanism, not a limitation.

---

## 1. Architecture — two parallel stacks

| Layer | Production | Staging |
|---|---|---|
| Git branch | `main` | `staging` (long-lived) |
| Frontend (Vercel) | `main` → **pumpini.in** | `staging` → **staging.pumpini.in** |
| Backend (Railway) | prod env, from `main` | **staging env**, from `staging` |
| Database (Supabase) | prod project | **separate `pumpini-staging` project** |

🔴 **Cardinal rule:** staging's `DATABASE_URL` and Supabase keys point ONLY at the
staging project. Staging code must never reach the prod database. Wire this wrong
and a test can write to a real outlet.

---

## 2. Environment-variable matrix (per backend secret)

Every secret lives in **per-environment variables** (Railway/Vercel dashboards),
never in the repo. "Promote to prod" = set prod's own values, not copy staging's.

| Variable | Treatment | Staging value |
|---|---|---|
| `DATABASE_URL` / `DB_*` | **Distinct** | Staging Supabase connection string |
| `JWT_SECRET` | **Distinct** | Fresh random secret (staging token ≠ prod token) |
| `JWT_EXPIRES_IN` | Reuse | Same as prod (e.g. `8h`) |
| `WEBAUTHN_RP_ID` | **Distinct (domain-bound)** | `staging.pumpini.in` |
| `WEBAUTHN_ORIGIN` | **Distinct (domain-bound)** | `https://staging.pumpini.in` |
| `FRONTEND_URL` | **Distinct** | `https://staging.pumpini.in` (CORS allow-origin) |
| `ANTHROPIC_API_KEY` (Claude) | Reuse OK — **separate key recommended** | New key (ideally a separate Anthropic *workspace* with a budget cap) |
| `GOOGLE_VISION_API_KEY` | Reuse OK — separate key recommended | New restricted key |
| `SARVAM_API_KEY` (voice) | Reuse OK — separate key recommended | New key if available |
| `MSG91_*` (SMS/WhatsApp) | **Separate + sandbox/off** | Test sender, or leave unset so alerts no-op (never text real customers) |
| `WHATSAPP_*` | **Separate + sandbox/off** | Test creds, or unset |
| `SMTP_*` (email) | **Separate + sandbox/off** | Test mailbox (e.g. Mailtrap), or unset |
| `FMC_HOST` / `FMC_PORT` | **Omit** | Unset — no physical fuel controller on staging |
| `NODE_ENV` | Set | `production` (build mode) |
| `PORT`, `LOG_LEVEL`, `DB_SSL` | Set | Per Railway defaults / same as prod |

Frontend (Vercel) env:

| Variable | Staging value |
|---|---|
| `NEXT_PUBLIC_API_URL` | The staging Railway backend URL |
| `NEXT_PUBLIC_BUILD_ID` | Auto — set from `VERCEL_GIT_COMMIT_SHA` per environment |

Rule of thumb:
- **Read-only AI/OCR keys** (Claude, Vision, Sarvam) → reuse works; separate key preferred (cost + blast-radius isolation).
- **Keys that act on the real world** (SMS/WhatsApp/email) → separate + sandboxed or disabled.
- **DB / JWT / WebAuthn / CORS** → defined *by* the environment; never copied from prod.

---

## 3. One-time bring-up (in order — each step feeds the next)

1. **Git:** create the long-lived `staging` branch from `main`.
2. **Supabase:** create the `pumpini-staging` project. Copy its connection string + keys.
3. **Schema:** ⚠️ do **not** replay `pumpini-schema.sql` — it has drifted (only ~23 of 60 tables). Instead **clone the live prod schema**: `pg_dump --schema-only --no-owner --schema=public` from a prod project → load into staging. Then run the **post-clone grant** (see §6) so the app can assume the RLS role. (`pumpini-schema.snapshot.sql` is a committed copy of this dump.)
4. **Railway:** add a `staging` environment/service deploying from `staging`; set the env vars above (`DATABASE_URL` = staging Supabase, fresh `JWT_SECRET`, AI keys, alerts off). Note the backend public URL.
5. **Vercel:** add a staging deploy from `staging`; set `NEXT_PUBLIC_API_URL` = the staging backend URL.
6. **DNS:** point `staging.pumpini.in` at Vercel; add it as the staging custom domain.
7. **Domain-bound vars:** set `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `FRONTEND_URL` to the staging domain on Railway; redeploy.
8. **Data:** load data into staging — either a demo seed, or a full prod-data clone (`pg_dump --data-only`). The data-load procedure and its gotchas are in §6.
9. **Smoke test:** see §5, as each role under live RLS.

---

## 4. Day-to-day promotion workflow

```
feature branch ──PR──▶ staging ──(test)──▶ main
                         │                   │
                  Vercel+Railway       Vercel+Railway
                   STAGING auto         PROD auto
```

1. Branch off `main` → open PR → merge into **`staging`**.
2. Staging frontend + backend auto-deploy.
3. **If the change has DDL:** run the migration SQL on **staging Supabase** first.
   **If it adds env vars:** set them in staging Railway/Vercel.
4. Smoke-test on `staging.pumpini.in` as owner / manager / attendant.
5. **Promote:** merge `staging` → `main` (Vercel + Railway prod auto-deploy). ← the seamless, code-only half
6. Run the **same, already-validated** SQL on **prod Supabase**.
7. Mirror any new env vars into prod Railway/Vercel. Verify prod.

What promotes how, at a glance:
- **Code (Vercel + Railway):** git merge `staging → main`. Automatic.
- **Schema (Supabase):** re-run the validated idempotent SQL on prod. Manual, deliberate.
- **Data:** never promotes either direction (demo data stays in staging; real data stays in prod).
- **Env vars / secrets:** set per environment by hand; never merged.

---

## 5. Pre-promote smoke test (run as EACH role under live RLS)

- [ ] Log in (password + passkey) as owner / manager / attendant
- [ ] Add attendant
- [ ] Open + close a shift (dipstick, operators, settlement)
- [ ] Record a delivery + invoice scan (OCR)
- [ ] Dashboard / cockpit loads (margins owner-only; open-shift sales masked for non-owners)
- [ ] AI chat answers
- [ ] No cross-outlet data leak between tenants

---

## 6. Rebuilding / refreshing staging from prod — the EXACT procedure + gotchas

Staging is a **point-in-time clone**; nothing syncs from prod afterwards. To build
or refresh it, copy **schema** then **data** with `pg_dump`/`psql`. The steps below
are battle-tested — each "gotcha" cost time the first time, so follow them in order.

### 6a. Schema (structure only)
```
pg_dump "<PROD_session_pooler_uri>" --schema-only --no-owner --schema=public -f schema.sql
# In staging SQL editor FIRST (the role the RLS policies reference; pg_dump can't copy it):
#   create role app_authenticated nologin nobypassrls;   -- if it doesn't exist
#   create extension if not exists "uuid-ossp" with schema extensions;
psql "<STAGING_session_pooler_uri>" -f schema.sql
```
Benign load errors to ignore: `schema "public" already exists`, `permission denied
to change default privileges` (Supabase-managed roles — cosmetic).

### 6b. 🔴 GOTCHA #1 — re-grant the RLS role (or every login bounces back to login)
`pg_dump` does **not** copy role memberships. Without this, `SET ROLE
app_authenticated` fails on the first authenticated request, the frontend clears the
token, and login silently bounces. In the **staging SQL editor**:
```sql
GRANT app_authenticated TO postgres;            -- the role the app connects as
GRANT USAGE ON SCHEMA public TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_authenticated;
```

### 6c. Data (only for a full prod-data clone)
`pg_dump --data-only` trips on triggers (double-counted stock) and a circular FK.
So, in the **staging SQL editor**, BEFORE loading:
```sql
-- GOTCHA #2: AFTER-INSERT triggers would re-fire side effects during a bulk load
ALTER TABLE public.corporate_accounts DISABLE TRIGGER trg_detect_corp_duplicates;
ALTER TABLE public.fuel_deliveries    DISABLE TRIGGER trg_increase_stock;
ALTER TABLE public.gst_invoices       DISABLE TRIGGER trg_mark_invoiced;
ALTER TABLE public.dispense_events    DISABLE TRIGGER trg_reduce_stock;
-- GOTCHA #3: corporate_accounts.merged_into_id is a self-FK → circular; drop while loading
ALTER TABLE public.corporate_accounts DROP CONSTRAINT corporate_accounts_merged_into_id_fkey;
```
Then dump + load:
```
pg_dump "<PROD_uri>" --data-only --no-owner --schema=public -f data.sql
psql "<STAGING_uri>" -f data.sql
```
Then re-enable everything:
```sql
ALTER TABLE public.corporate_accounts
  ADD CONSTRAINT corporate_accounts_merged_into_id_fkey
  FOREIGN KEY (merged_into_id) REFERENCES public.corporate_accounts(id);
ALTER TABLE public.corporate_accounts ENABLE TRIGGER trg_detect_corp_duplicates;
ALTER TABLE public.fuel_deliveries    ENABLE TRIGGER trg_increase_stock;
ALTER TABLE public.gst_invoices       ENABLE TRIGGER trg_mark_invoiced;
ALTER TABLE public.dispense_events    ENABLE TRIGGER trg_reduce_stock;
```
Use the **Session pooler** URIs (port 5432); the Transaction pooler (6543) won't work
with `pg_dump`. URL-encode special chars in passwords (`@` → `%40`).

Note: a full prod-data clone carries **real customer PII** into staging — fine for the
owner's own testing, but mask/sanitize if a non-owner will see it. **Prod password
changes do NOT propagate to staging** (it's frozen at clone time).

## 7. Notes
- Keep staging's **schema in lock-step** with prod. The authoritative current schema
  is `pumpini-schema.snapshot.sql` (refresh it whenever prod schema changes).
- Base deploy details (build, ports, CORS) live in `DEPLOYMENT.md`.
