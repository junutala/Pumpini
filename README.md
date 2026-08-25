# Petrol DMS — Dealer Management System

Full-stack web application for managing petrol/fuel stations. Built with Next.js 14 + Node.js/Express + PostgreSQL.

---

## Features

| Module | Description |
|---|---|
| **Dashboard** | Real-time KPIs, sales charts, tank levels, alert feed |
| **Shifts** | Open/close shifts, assign RFID tags per nozzle, live dispense event stream |
| **Reconciliation** | Blind-drop cash reconciliation with variance alerts (₹50 threshold) |
| **Corporate Sales** | Credit accounts, biometric driver verification, FASTag, per-fill limits, monthly statements |
| **Attendance** | Daily check-in/out, shift assignment, quick-mark roster |
| **Dipstick** | Tank dip readings, volume/density/temperature recording |
| **Users** | Add/edit/deactivate staff, role-based access |
| **Alerts** | Real-time WhatsApp/SMS/Email alerts for variances, low stock, credit limits |
| **Reports** | Date-range reports, fuel-wise/payment-wise breakdown, CSV export |
| **Settings** | Fuel prices, nozzle config, RFID tag management |

**Languages:** English, हिन्दी, தமிழ், తెలుగు, ಕನ್ನಡ, मराठी

---

## Tech Stack

- **Frontend:** Next.js 14, Tailwind CSS, Recharts, Socket.IO client, i18next
- **Backend:** Node.js, Express, Socket.IO, node-cron
- **Database:** PostgreSQL 14+
- **Alerts:** MSG91 (SMS/WhatsApp), Nodemailer (Email)
- **Hardware:** TCP connection to Fuel Management Controller (RFID/nozzle events)

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
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

### Backend
```bash
cd backend
NODE_ENV=production node src/index.js
# Or with PM2:
pm2 start src/index.js --name petrol-dms-api
```

### Frontend
```bash
cd frontend
npm run build
npm run start
# Or deploy to Vercel/Netlify with NEXT_PUBLIC_API_URL pointing to production backend
```

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

| Role | Dashboard | Shifts | Reconcile | Corporate | Attendance | Users | Settings |
|---|---|---|---|---|---|---|---|
| Owner | ✓ Full | ✓ Full | View | ✓ Full | ✓ Full | ✓ Full | ✓ Full |
| Manager | ✓ Full | ✓ Full | View | View | ✓ Full | ✓ (no owner) | Prices |
| Attendant | Own data | Own shift | ✓ Submit | — | — | — | — |
| Corporate | Own account | — | — | Own data | — | — | — |

---

## Project Structure

```
petrol-dms/
├── backend/
│   ├── src/
│   │   ├── db/          migrate.js, pool.js, seed.js
│   │   ├── middleware/  auth.js, errorHandler.js
│   │   ├── routes/      auth, shifts, dispense, reconcile, corporate,
│   │   │                attendance, dipstick, dashboard, alerts, prices,
│   │   │                rfid, stations, users
│   │   ├── services/    rfidService.js, alertService.js, reportService.js
│   │   ├── utils/       logger.js
│   │   └── index.js     Express + Socket.IO server
│   └── .env.example
├── frontend/
│   └── src/
│       ├── app/         dashboard, shifts, dispense, corporate, attendance,
│       │                dipstick, users, alerts, reports, settings, login
│       ├── components/  shared/AppShell, shared/Sidebar
│       ├── hooks/       useSocket.js
│       ├── i18n/        6 language locales
│       └── lib/         api.js, auth.js
└── package.json
```
