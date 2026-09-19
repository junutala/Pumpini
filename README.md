# Pumpini — Petrol Station Management

Multi-tenant SaaS for running petrol stations — shifts, money, stock and compliance.
Next.js 14 (Vercel) + Node/Express (Railway) + Supabase Postgres with RLS.

> **This is a LIVE production system handling real money for real outlets.** Read
> **`CLAUDE.md`** before changing anything: it carries the working rules, the
> deploy-ordering trap, and the incidents behind both.

---

## Modules

Grouped as the sidebar groups them (`components/shared/Sidebar.js`). Availability is
per-user and per-outlet — see **Roles & Permissions** below; several are behind
per-outlet switches in `station_settings`.

| Area | Modules |
|---|---|
| **Forecourt** | Bunk View (dashboard), Live Events, POS Entry, Shifts, Start/End Shift, Dispense Log, Reconciliation, Settlement, Attendance |
| **Stock** | Dipstick, Deliveries, Stock Reco, Density Register, Tank Recon |
| **Credit** | Credit Customers, Credit Invoices, Credit Receipts, Credit Notes, Credit Coupons, Coupon Books, Credit Dashboard, Credit Reports |
| **Cash** | Petty Cash, Bank Deposits, Cash Integrity, Tally Export |
| **Lubes / products** | Catalogue, Stock, Lube POS, GST Invoices |
| **Accounting** | Accounts, Bill & Payment, Payables, Owner Money, Opening Balances, Balance Sheet |
| **Owner** | Group View, Reports, Alerts, Intelligence |
| **Admin** | Users, Responsibilities, Add Attendant, Settings |
| **Flow v2** *(migration flag, not yet on at any real outlet)* | Tank Recon, Nozzle Events, Attendant Dues |

**Languages:** English, हिन्दी, தமிழ், తెలుగు, ಕನ್ನಡ, मराठी — `frontend/src/i18n/locales/`.
User-facing strings go through `tc('key', 'English fallback')`.

> *Rewritten 19-Sep-2026 at the Phase 1 freeze.* The old ten-row table predated
> accounting, lubes, credit invoicing, petty cash, deposits, Tally and the whole of
> Flow v2 — roughly two thirds of what the product now does was missing from its own
> front page.

---

## Tech Stack

- **Frontend:** Next.js 14, Tailwind CSS, Recharts, Socket.IO client, i18next
- **Backend:** Node.js, Express, Socket.IO, node-cron
- **Database:** Supabase Postgres (17 in production) with **row-level security**
- **Alerts:** MSG91 (SMS/WhatsApp), Nodemailer (Email)
- **Images:** Supabase Storage, private bucket `pumpini-docs` (never Railway, never Postgres)
- **OCR / AI:** slip, gauge-console and invoice reading (`services/visionOcr`, `slipParser`)
- **Hardware:** TCP connection to Fuel Management Controller (RFID/nozzle events) — *optional; the live outlets run without it*

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (production runs 17 on Supabase)
- (Optional) MSG91 account for SMS/WhatsApp alerts
- (Optional) SMTP credentials for email alerts
- (Optional) FMC/Nozzle controller on local network

---

## Setup

### 1. Clone & install dependencies

```bash
git clone <repo>
cd petrol-dms
npm run install:all
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL credentials and API keys
```

### 3. Create the database

```bash
# In PostgreSQL
createdb petrol_dms

# Run migrations
cd backend && npm run migrate

# Seed demo data (optional)
npm run seed
```

Demo credentials after seeding:
- Owner: `+919999000001` / `demo1234`
- Manager: `+919999000002` / `demo1234`
- Attendant: `+919999000003` / `demo1234`

### 4. Configure the frontend

```bash
cd frontend
# Create .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
```

### 5. Run in development

```bash
# From root
npm run dev
# → Backend:  http://localhost:4000
# → Frontend: http://localhost:3000
```

---

## Production Deployment

**Nothing is deployed by hand. Both halves auto-deploy on merge to `main`.**

| Half | Host | Trigger |
|---|---|---|
| Frontend | **Vercel** | merge to `main` |
| Backend | **Railway** | merge to `main` |
| Database | **Supabase Postgres** | ⚠️ **schema DDL is run MANUALLY by the owner** — it does *not* ship with the code |

That last row is the one that breaks production, and it has: code depending on a new
column deploys **before** the migration is applied. See the deploy-ordering rule in
`CLAUDE.md` before shipping anything that needs schema, and `DEPLOY.md` /
`DEPLOYMENT.md` for the full procedure. Railway reports a merge as SKIPPED when it
touches nothing it watches (e.g. a docs-only PR) — that is normal, not a failure.

Rollback is reverting the PR; both hosts redeploy on the revert.

> *Corrected 19-Sep-2026 at the Phase 1 freeze.* This section used to give `pm2 start`
> and `npm run start` recipes for hand-deploying to a server. Nothing has shipped that
> way for months, and following it would have put a second, divergent copy of the
> backend next to the Railway one.

---

## Environment Variables (backend/.env)

| Variable | Description |
|---|---|
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port (default 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `JWT_SECRET` | Long random secret for JWT signing |
| `PSP_ENC_KEY` | Long random secret — AES-256 key for per-outlet payment-provider credentials |
| `JWT_EXPIRES_IN` | Token expiry (default 8h) |
| `FMC_HOST` | Fuel Management Controller IP |
| `FMC_PORT` | FMC TCP port (default 9100) |
| `SMTP_HOST` | SMTP server for email alerts |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `MSG91_AUTH_KEY` | MSG91 API key for SMS/WhatsApp |
| `FRONTEND_URL` | Frontend origin for CORS |

---

## RFID / FMC Integration

The backend connects to a Fuel Management Controller (FMC) via TCP on startup. The FMC must send JSON events in this format:

```json
{
  "rfid": "AABB1122",
  "nozzle_number": 3,
  "station_id": "<uuid>",
  "litres": 12.345,
  "payment_mode": "cash",
  "timestamp": "2025-01-15T08:30:00Z"
}
```

One event per line (newline-delimited JSON). The service auto-reconnects every 5 seconds on disconnect.

---

## Roles & Permissions

**The permission model is code, not a table in a README** — reproduce it here and it
drifts. The authority is `backend/src/middleware/permissions.js`, with
`backend/src/config/responsibilities.js` and `roles.js` beside it.

How a user's permissions are resolved, in order:

1. **Role default** — `roleDefaults[role]` in `permissions.js` (an attendant's default
   is `['settlement.enter']`, which is why a fresh attendant can settle and nothing else).
2. **Assigned responsibility, if any — this REPLACES the role default**, it does not
   add to it. A responsibility template is the whole answer for that user.
3. **Plan ceiling** — `stations.entitlement` caps the result per outlet. `'lite'`
   (free) caps to `['dashboard.view']`; `'pumpini'` (paid) is uncapped. Binary, not
   multi-tier (see `docs/access-model-cleanup.md`).

Resolved permissions are **cached for 5 minutes**, so a permission change is not
always visible instantly — that is the usual explanation for "I granted it and he
still can't see it."

Routes are guarded with `requirePerm('<perm>')`; outlet scoping is enforced by
Postgres RLS *and* app-layer `stationAccess`. Superadmin routes run under `authAdmin`
on the BYPASSRLS role.

> *Rewritten 19-Sep-2026 at the Phase 1 freeze.* The old 4-row matrix (Owner /
> Manager / Attendant / Corporate against seven columns) predated responsibilities and
> the entitlement ceiling entirely, and got the attendant row wrong.

---

## Project Structure

*Refreshed 19-Sep-2026 at the Phase 1 freeze. The previous tree listed 13 routes, 3
services and 11 screens; the real counts are 40, 36 and 58, so it had stopped being a
map and become a museum. Directories are listed with counts rather than every file,
because an exhaustive list is exactly what goes stale.*

```
pumpini/
├── backend/
│   ├── src/
│   │   ├── config/      lfrRates.js, responsibilities.js, roles.js
│   │   ├── db/          pool.js, migrate.js, seed.js, hasColumn.js
│   │   ├── middleware/  auth.js, permissions.js, stationAccess.js, errorHandler.js
│   │   ├── routes/      40 route modules, mounted in index.js under /api/*
│   │   ├── services/    36 services — the WRITERS (see "One writer per concept")
│   │   ├── lib/         calibration, tankVolume — dip→litres, chart-exact
│   │   └── index.js     Express + Socket.IO server
│   ├── scripts/         CI gates (ci-*.js) + operational scripts
│   └── test/            node --test unit tests, run by CI
├── frontend/
│   └── src/
│       ├── app/         58 App Router entries; landing/ is the public homepage
│       ├── components/  shared/ (AppShell, Sidebar, PhotoCapture, Banner…), ui/, admin/
│       ├── hooks/       useSocket.js
│       ├── i18n/        locales/ — en, hi, ta, te, kn, mr
│       └── lib/         api.js, auth.js, nozzle.js, adminApi.js, apiError.js
├── docs/                design + decision records; reference/ holds the OMC
│                        calibration charts every tank figure is checked against
├── ops/                 SQL runbooks (clear-outlet-transactions.sql, clone, staging)
└── CLAUDE.md            the working rules — read this before changing anything
```

### Where the important single writers live

The repo enforces **one writer per concept** (see `CLAUDE.md` and
`docs/drift-audit.md`). The ones worth knowing before you change anything:

| Concept | The one writer |
|---|---|
| Nozzle / pump naming | `services/pumpService` — `nozzleNameExpr` (SQL) + `nozzleName` (JS) |
| Document images | `services/artifactService.save()` → Supabase Storage, bucket `pumpini-docs` |
| Users & attendants | `services/userService.createUser` |
| Opening meter / dip | `services/openingService` — the last close IS the next open |
| Dip → litres | `lib/calibration`, `lib/tankVolume` — reproduces the OMC charts exactly |
| Meter of record | table `shift_attendant_nozzles` — one row per operator per nozzle |
