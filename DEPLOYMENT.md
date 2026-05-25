# 🚀 Pumpini — Deployment Guide
## GitHub + Vercel (Frontend) + Supabase (Database) + Railway (Backend)

---

## Architecture Overview

```
Browser / Mobile
      │
      ▼
┌─────────────────┐     ┌─────────────────────┐
│   Vercel CDN    │────▶│  Next.js Frontend   │  pumpini.vercel.app
│  (Static/SSR)   │     │  (Next.js 14)       │
└─────────────────┘     └──────────┬──────────┘
                                   │ API calls
                         ┌─────────▼──────────┐
                         │  Railway / Render   │  api.pumpini.in
                         │  (Node.js Backend)  │
                         └─────────┬──────────┘
                                   │ pg pool
                         ┌─────────▼──────────┐
                         │     Supabase        │  Free tier → Pro
                         │   (PostgreSQL)      │
                         └─────────────────────┘
```

✅ **Yes — Supabase works perfectly** with this app. It's standard PostgreSQL. The backend just needs the connection string.

---

## Part 1 — Set Up Supabase (Database)

### Step 1.1 — Create a Supabase project
1. Go to [supabase.com](https://supabase.com) → **New project**
2. Name it `pumpini-prod`
3. Choose a **strong DB password** (save it!)
4. Region: **South Asia (ap-south-1)** — closest to India
5. Wait ~2 minutes for provisioning

### Step 1.2 — Get your connection string
1. In Supabase: **Settings → Database → Connection string**
2. Choose **URI** tab
3. Copy the string — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
4. Also note the **individual values** (host, port, user, password, db) for `.env`

### Step 1.3 — Run migrations
You have two options:

**Option A — Supabase SQL Editor (easiest):**
1. In Supabase: go to **SQL Editor**
2. Open `backend/src/db/migrate.js` from your project
3. Copy the SQL inside the `schema` variable (everything between the backticks)
4. Paste it into Supabase SQL Editor → **Run**

**Option B — Run from your local machine:**
```bash
cd backend
cp .env.example .env
# Edit .env: set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD from Supabase
npm install
npm run migrate
npm run seed   # optional: load demo data
```

### Step 1.4 — Enable Row Level Security (optional but recommended)
Supabase has RLS by default — but since the Node.js backend connects with the service role (bypassing RLS), you don't need to configure policies. The backend handles auth via JWT.

---

## Part 2 — Push to GitHub

### Step 2.1 — Create a GitHub repo
1. Go to [github.com/new](https://github.com/new)
2. Name: `pumpini`
3. Private ✓ → **Create repository**

### Step 2.2 — Push your code
```bash
cd petrol-dms    # your project root

git init
git add .
git commit -m "feat: initial Pumpini MVP"

git remote add origin https://github.com/YOUR_USERNAME/pumpini.git
git branch -M main
git push -u origin main
```

### Step 2.3 — Recommended .gitignore
Create `/.gitignore` at the root:
```
node_modules/
.env
.env.local
backend/.env
frontend/.env.local
backend/logs/
backend/uploads/
frontend/.next/
*.zip
```

---

## Part 3 — Deploy Backend to Railway

Railway is the easiest free-tier option for Node.js with WebSockets (Socket.IO). Render works too.

### Step 3.1 — Sign up and create project
1. Go to [railway.app](https://railway.app) → Login with GitHub
2. **New Project → Deploy from GitHub repo → pumpini**
3. Select the `backend` folder as root (Railway auto-detects it)

### Step 3.2 — Set environment variables in Railway
Go to your service → **Variables** tab. Add each one:

```
NODE_ENV=production
PORT=4000

DB_HOST=db.xxxxxxxxxxxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_supabase_db_password

JWT_SECRET=generate_a_64_char_random_string_here
JWT_EXPIRES_IN=8h

FRONTEND_URL=https://pumpini.vercel.app

# Optional: Alert notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@yourdomain.com
SMTP_PASS=your_app_password
MSG91_AUTH_KEY=
```

> **Generate JWT secret:** run `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` locally

### Step 3.3 — Set start command
In Railway service settings → **Start command:**
```
node src/index.js
```

### Step 3.4 — Get your backend URL
Railway gives you a URL like: `https://pumpini-production.up.railway.app`

Save this — you'll need it for the frontend.

---

## Part 4 — Deploy Frontend to Vercel

### Step 4.1 — Sign up and import
1. Go to [vercel.com](https://vercel.com) → Login with GitHub
2. **Add New Project → Import Git Repository → pumpini**
3. Set **Root Directory** to `frontend`
4. Framework: **Next.js** (auto-detected)

### Step 4.2 — Set environment variables in Vercel
Go to project → **Settings → Environment Variables**:

```
NEXT_PUBLIC_API_URL=https://pumpini-production.up.railway.app
```

### Step 4.3 — Deploy
Click **Deploy** — Vercel builds and deploys in ~2 minutes.

Your frontend is live at: `https://pumpini.vercel.app`

### Step 4.4 — Update backend CORS
Go back to Railway → update `FRONTEND_URL`:
```
FRONTEND_URL=https://pumpini.vercel.app
```

---

## Part 5 — Landing Page Deployment

The landing page (`frontend/public/index.html`) is served automatically by Next.js from the `public/` folder.

**Access it at:** `https://pumpini.vercel.app/index.html`

To make it the **homepage** instead of the dashboard, update `frontend/src/app/page.js`:

```js
// Option A: Show landing for logged-out, redirect to dashboard if logged in
'use client';
import { useAuth } from '../lib/auth';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [user, loading]);

  if (loading) return null;
  if (user) return null;  // redirecting
  
  // Redirect to static landing page
  if (typeof window !== 'undefined') {
    window.location.href = '/index.html';
  }
  return null;
}
```

---

## Part 6 — Custom Domain (Optional)

### Vercel custom domain
1. Vercel → Project → **Settings → Domains**
2. Add `pumpini.in` or `app.pumpini.in`
3. Update your DNS registrar (GoDaddy / Namecheap):
   - `A record → 76.76.21.21` (Vercel)
   - Or `CNAME → cname.vercel-dns.com`

### Railway custom domain
1. Railway → Service → **Settings → Domains**
2. Add `api.pumpini.in`
3. `CNAME → your-railway-url.up.railway.app`
4. Update `NEXT_PUBLIC_API_URL=https://api.pumpini.in` in Vercel

---

## Part 7 — Testing Checklist

After deployment, run through this:

### Auth
- [ ] Open `pumpini.vercel.app` → landing page loads
- [ ] Click Login → modal opens
- [ ] Enter `+919999000001` / `demo1234` → redirects to `/dashboard`
- [ ] Language switcher changes UI language

### Dashboard
- [ ] KPI cards show (may be zeros if no data yet)
- [ ] Tank levels display
- [ ] Alerts section loads

### Shifts
- [ ] Open a new shift (Shift 1, today's date)
- [ ] Assign RFID → select attendant, tag, nozzle
- [ ] Check live events panel updates

### Reconciliation
- [ ] Select a closed shift
- [ ] Enter blind drop amount
- [ ] Confirm slip appears with variance

### Corporate
- [ ] Add a corporate account
- [ ] Enroll a driver
- [ ] Verify biometric (use any test ref ID)

### Settings
- [ ] Add a fuel price
- [ ] Add an RFID tag
- [ ] Add a nozzle

---

## Part 8 — Free Tier Limits Reference

| Service | Free Tier | When to Upgrade |
|---|---|---|
| **Supabase** | 500 MB DB, 2 GB bandwidth | ~50 stations active |
| **Railway** | $5 credit/month (hobby) | After testing — ~$10-20/mo |
| **Vercel** | Unlimited hobby deploys | Need team features |
| **Total cost** | ~₹0 to start | ~₹1,500–2,500/mo for production |

---

## Part 9 — Environment Variable Summary

### `backend/.env` (local dev)
```env
PORT=4000
NODE_ENV=development

DB_HOST=db.xxxxxxxxxxxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_supabase_password

JWT_SECRET=your_64_char_random_secret
JWT_EXPIRES_IN=8h

FMC_HOST=127.0.0.1
FMC_PORT=9100

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

MSG91_AUTH_KEY=
MSG91_SENDER_ID=PUMPIN

FRONTEND_URL=http://localhost:3000
```

### `frontend/.env.local` (local dev)
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Part 10 — Local Development with Supabase

You can develop locally while using Supabase as the database:

```bash
# 1. Clone repo
git clone https://github.com/YOUR_USERNAME/pumpini.git
cd pumpini

# 2. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 3. Configure backend
cd backend
cp .env.example .env
# Edit .env with Supabase credentials

# 4. Run migrations (first time only)
npm run migrate
npm run seed

# 5. Start both servers
cd ..
npm run dev
# → Frontend: http://localhost:3000
# → Backend:  http://localhost:4000

# Login: +919999000001 / demo1234
```

---

## Quick Troubleshooting

| Problem | Fix |
|---|---|
| CORS error in browser | Check `FRONTEND_URL` in Railway env vars matches your Vercel URL exactly |
| 401 Unauthorized | JWT_SECRET mismatch between local and Railway — regenerate |
| DB connection refused | Supabase requires SSL — add `?sslmode=require` to DB_HOST connection |
| Socket.IO not connecting | Railway free tier sleeps — upgrade to paid or use Render |
| Vercel build fails | Check `frontend/package.json` has all deps; ensure `next.config.js` is correct |
| Login redirects to blank page | Ensure `NEXT_PUBLIC_API_URL` is set in Vercel env vars |

### Supabase SSL fix
In `backend/src/db/pool.js`, update:
```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,  // use full URL
  ssl: { rejectUnauthorized: false }            // required for Supabase
});
```

And set `DATABASE_URL` in Railway to your full Supabase URI.

---

## Summary — Fastest Path to Live

1. ✅ Create Supabase project → run migrations via SQL Editor
2. ✅ Push code to GitHub
3. ✅ Deploy backend to Railway → set env vars
4. ✅ Deploy frontend to Vercel → set `NEXT_PUBLIC_API_URL`
5. ✅ Test login with seed credentials
6. ✅ Point `pumpini.in` domain when ready

**Total time: ~2 hours first time, 20 minutes after you know the flow.**
