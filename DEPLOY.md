# PUMPINI — Deployment Guide

## Architecture
- **Frontend** (Next.js) → Vercel (free)
- **Backend** (Node/Express) → Railway or Render (free tier)
- **Database** (Postgres) → Supabase (already hosted)

---

## Step 1 — Push to GitHub

1. Create a new repo at github.com (e.g. `pumpini-dms`), keep it private
2. In your `C:\pumpini\petrol-dms\` folder, open a terminal and run:
   ```
   git init
   git add .
   git commit -m "Initial commit — PUMPINI DMS with i18n"
   git remote add origin https://github.com/YOUR-USERNAME/pumpini-dms.git
   git push -u origin main
   ```
3. Verify `.env` files are NOT pushed (check GitHub — you should only see `.env.example` files)

---

## Step 2 — Deploy Backend to Railway

1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select your repo, set **Root Directory** to `backend`
3. Add these environment variables in Railway dashboard:
   ```
   DATABASE_URL=postgresql://postgres:[password]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
   JWT_SECRET=your-long-random-secret-here
   JWT_EXPIRES_IN=8h
   NODE_ENV=production
   FRONTEND_URL=https://your-app.vercel.app   ← fill after Step 3
   PORT=4000
   ```
4. Railway will give you a URL like `https://pumpini-backend-xxxx.railway.app`
5. Copy this URL — you need it for Step 3

---

## Step 3 — Deploy Frontend to Vercel

1. Go to vercel.com → New Project → Import your GitHub repo
2. Vercel will detect `vercel.json` and configure automatically
3. **Important:** Edit `vercel.json` before importing — replace `YOUR-BACKEND-URL.railway.app`
   with your actual Railway URL from Step 2
4. Add this environment variable in Vercel dashboard:
   ```
   NEXT_PUBLIC_API_URL=https://pumpini-backend-xxxx.railway.app
   ```
5. Deploy — Vercel builds the frontend and gives you `https://your-app.vercel.app`
6. Go back to Railway and update `FRONTEND_URL` to your Vercel URL (for CORS)

---

## Step 4 — Verify

- Open your Vercel URL → you should see the PUMPINI landing page
- Login with demo credentials: `9999000001` / `demo1234`
- Switch language from the landing page — all translated pages should respond

---

## Local development (unchanged)
```
npm run install:all
npm run dev
```
Backend: http://localhost:4000  
Frontend: http://localhost:3000

---

## Notes
- `vercel.json` rewrites `/api/*` → your Railway backend, so the frontend never needs CORS changes
- The SuperAdmin console (`/admin`) uses a separate JWT and hits `/api/superadmin/*` — same backend
- WebSocket (Live Events page) works on Railway; Vercel serverless can't host it
- Never commit `.env` or `.env.local` — they are in `.gitignore`
