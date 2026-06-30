# Org CRM — Decision Record & Pumpini Integration Contract

> **Status:** Draft / agreed direction · **Owner:** junutala · **Date:** 2026-06-30
>
> This document lives in the Pumpini repo because it defines the **Pumpini side** of the
> contract. The CRM itself is a **separate project in its own repo** (see "Why a separate
> repo" below). Nothing about the CRM is built inside Pumpini — only the small, additive
> read endpoint that lets the CRM pull Pumpini's leads.

---

## 1. What we're building

A standalone, **org-level mini-CRM** that sits *on top of* our three products —
**Pumpini**, **Advoice**, and **Leazify** — and gives one place to see and work every
lead across all of them, from first enquiry all the way to **billing**.

- **Aggregates leads** captured on each product's public marketing site.
- **Runs the full pipeline**: `lead → qualified → opportunity/deal → won → invoice/billing`.
- **Talks to each app over its API** (no shared database, no code coupling).
- Each product stays exactly as it is; the CRM is a consumer, not an owner, of their data.

### Why a separate repo (not inside Pumpini)
The CRM spans three products and must not inherit Pumpini's prod/staging deploy rules,
schema, or multi-tenant model. Keeping it in its own repo gives it an independent deploy
pipeline, its own database, and a clean security boundary. Pumpini only exposes a
read API; it has no knowledge of the CRM.

---

## 2. Technology decision

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router, TypeScript)** | One deploy for the internal dashboard **and** the poller/API routes. Industry standard for custom CRMs. |
| Database | **Supabase Postgres** | Matches our existing ops; managed Postgres, nothing exotic. |
| Query layer / migrations | **Drizzle ORM** | SQL-first, lightweight, no query-engine binary, fast serverless cold starts (the pollers run as serverless funcs). Chosen over Prisma (heavier) and over the raw `supabase-js` client (no migrations, awkward for a join-heavy relational CRM). |
| Lead intake | **Scheduled pollers** — the CRM pulls each app's leads API on a cron | Decided: apps need no webhook wiring; CRM owns sync. Trade-off: near-real-time, not instant. |
| Billing | **Stripe** | At the "won → invoice" end of the pipeline. |
| Deploy | **Vercel** | Matches current ops; cron via Vercel Scheduled Functions. |

> **Note on "Supabase vs Prisma":** they're not competitors. Supabase = hosted Postgres +
> auth/storage. The ORM choice (Drizzle) sits *on top of* Supabase's Postgres. We use
> Supabase for the DB and Drizzle as the typed query/migration layer.

### Build vs buy
We considered adopting the open-source **Twenty** CRM. Rejected for v1: none of the
off-the-shelf CRMs model *"aggregate leads from our three specific apps and run them to
billing"* — that aggregation is the whole point, so a tailored mini-CRM is justified.

---

## 3. Architecture (high level)

```
 Pumpini API  ─┐
 Advoice API  ─┼──(poll on cron, API-key auth)──▶  CRM ingest  ──▶  CRM Postgres
 Leazify API  ─┘                                      │            (leads, accounts,
                                                       │             deals, invoices)
                                                       ▼
                                              Next.js dashboard  ──▶  Stripe (billing)
```

- Each product implements the **same read contract** (Section 5). The CRM has one
  `LeadConnector` per app behind a shared interface, so adding a 4th product later is
  just a new connector + credentials.
- The CRM never writes to a product's operational data in v1 (one-way: product → CRM).
  Optional later phase: write lead **status** back so the marketing screen reflects CRM
  progress.

### CRM-side data model (sketch — built in the CRM repo, not here)
```
sources(app, base_url, ...)              -- pumpini | advoice | leazify
leads(id, source_app, source_id, ...)    -- raw inbound, unique (source_app, source_id)
accounts(id, ...)                        -- company/org the lead belongs to
contacts(id, account_id, ...)
deals(id, account_id, stage, amount, ...)-- lead → qualified → won
invoices(id, deal_id, stripe_id, ...)    -- billing
activities(id, ...)                      -- notes, calls, status changes
sync_state(source_app, last_cursor, ...) -- incremental poll bookmark
```

---

## 4. Pumpini today (the starting point)

- **Table `leads`** (global — NOT tenant/station scoped; these are public enquiries):
  `id (uuid), name, station_name, city, state, phone, email, message,
   source ('website'), status ('new'), notes, created_at, updated_at`.
- **Endpoints:**
  - `POST /api/leads` — public create from the marketing "Get in touch" form (no auth, honeypot-protected).
  - `GET/POST/PATCH/DELETE /api/superadmin/leads` — behind `authAdmin` (human superadmin session only).
- **Gap:** there is **no machine-pollable read endpoint**. The CRM cannot use the
  superadmin route (that's a human JWT session). We add one dedicated endpoint below.

---

## 5. The wiring contract — what Pumpini must add

A single, additive, **read-only** endpoint that the CRM polls. **No schema change
required** (every field already exists).

### 5.1 Endpoint
```
GET /api/integrations/crm/leads?updated_since=<ISO8601>&limit=<n>
```
- **Auth:** header `X-API-Key: <CRM_SYNC_API_KEY>`. A dedicated machine key stored in
  Pumpini backend env — **not** a user JWT, **not** the superadmin password. Compared in
  constant time. Reject with `401` if missing/wrong.
- **Incremental sync:** returns leads with `updated_at >= updated_since`, ordered by
  `updated_at ASC, id ASC`. Caller passes the last `updated_at` it saw (minus a small
  overlap, e.g. 1s) as the next `updated_since`. First call: omit → returns from epoch.
- **Pagination:** `limit` (default 100, max 500). If a page is full, the CRM advances the
  cursor and calls again until a short page is returned.
- **Stable shape:** never remove/rename fields; only add.

### 5.2 Response
```json
{
  "leads": [
    {
      "id": "8b1e...-uuid",
      "name": "Ravi Kumar",
      "station_name": "Sri Sai Filling Station",
      "city": "Guntur",
      "state": "Andhra Pradesh",
      "phone": "+919xxxxxxxxx",
      "email": "ravi@example.com",
      "message": "Interested in a demo",
      "source": "website",
      "status": "new",
      "notes": null,
      "created_at": "2026-06-29T10:12:04.000Z",
      "updated_at": "2026-06-29T10:12:04.000Z"
    }
  ],
  "next_updated_since": "2026-06-29T10:12:04.000Z",
  "count": 1
}
```

### 5.3 Field mapping (Pumpini → CRM canonical lead)
| Pumpini field | CRM canonical field | Notes |
|---|---|---|
| `id` | `source_id` | Combined with `source_app='pumpini'` → unique key for dedup/idempotency. |
| `name` | `full_name` | |
| `station_name` | `company` | The prospect's business. |
| `city` | `city` | |
| `state` | `region` | |
| `phone` | `phone` | Primary contact handle. |
| `email` | `email` | |
| `message` | `message` | |
| `source` | `source_channel` | e.g. `website`. |
| `status` | `source_status` | Pumpini's own status; CRM keeps its **own** pipeline stage separately. |
| `created_at` | `received_at` | |
| `updated_at` | `source_updated_at` | Drives the incremental cursor. |
| (constant) | `source_app = 'pumpini'` | Set by the connector. |

### 5.4 Idempotency / dedup
The CRM upserts on `(source_app, source_id)`. Re-polling the same lead (because of cursor
overlap) updates in place — never creates a duplicate. This is why the overlap window is
safe.

### 5.5 Reference implementation (Pumpini backend — to be PR'd separately)
```js
// backend/src/routes/integrations.js   (mounted at /api/integrations)
const router = require('express').Router();
const crypto = require('crypto');
const pool   = require('../db/pool');

function requireCrmKey(req, res, next) {
  const sent = req.get('X-API-Key') || '';
  const want = process.env.CRM_SYNC_API_KEY || '';
  const ok = want.length > 0 &&
    sent.length === want.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// GET /api/integrations/crm/leads?updated_since=ISO&limit=n
router.get('/crm/leads', requireCrmKey, async (req, res, next) => {
  try {
    const since = req.query.updated_since ? new Date(req.query.updated_since) : new Date(0);
    if (Number.isNaN(since.getTime())) return res.status(400).json({ error: 'bad updated_since' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const { rows } = await pool.query(
      `SELECT id, name, station_name, city, state, phone, email, message,
              source, status, notes, created_at, updated_at
         FROM leads
        WHERE updated_at >= $1
        ORDER BY updated_at ASC, id ASC
        LIMIT $2`,
      [since.toISOString(), limit]
    );

    const next_updated_since = rows.length ? rows[rows.length - 1].updated_at : req.query.updated_since || null;
    res.json({ leads: rows, next_updated_since, count: rows.length });
  } catch (err) { next(err); }
});

module.exports = router;
```
Mount in `backend/src/index.js`:
```js
app.use('/api/integrations', require('./routes/integrations'));
```

> ⚠️ This is a **superadmin-grade data export** (all leads, cross-outlet). Treat the
> rollout as **medium impact**: ship to **staging first**, the owner verifies on
> `staging.pumpini.in`, then promote to `main`. See impact analysis below.

---

## 6. Impact analysis (Pumpini-side endpoint)

Per `CLAUDE.md`:
1. **Schema dependency?** No. All selected columns exist in the prod snapshot — **zero DDL**.
2. **Who consumes this?** A brand-new route. Existing screens/endpoints are untouched
   (`POST /api/leads` and the superadmin CRUD are not modified).
3. **Blast radius if it fails?** Isolated; a bug returns `4xx/5xx` to the CRM poller only.
   No core operator path (shifts, sales, cash) is affected.
4. **Multi-tenant safety.** Leads are already global (not outlet-scoped). The endpoint
   exposes the same data the superadmin already sees — but to a machine key, so the key
   must be guarded like a superadmin credential. No per-outlet leakage risk (leads carry
   no outlet scope to leak).
5. **Money / masking.** None. Leads are pre-sales enquiries; no sales/credit/cash/margin.
6. **Rollback.** Remove the route mount (or unset `CRM_SYNC_API_KEY` to hard-401 it).
   No data migration to undo.

**Verdict:** low schema risk, but it's a bulk export behind a new credential → route
through **staging** for the owner's physical check before `main`.

---

## 7. Credentials & env vars

**Pumpini backend (Railway — prod and staging each get their own key):**
```
CRM_SYNC_API_KEY=<random 32+ byte hex, unique per environment>
```

**CRM repo (its own environment):**
```
DATABASE_URL=<supabase postgres connection string>
STRIPE_SECRET_KEY=<...>
PUMPINI_API_URL=https://api.pumpini.in        # staging: https://staging-api.pumpini.in
PUMPINI_API_KEY=<matches Pumpini CRM_SYNC_API_KEY for that env>
ADVOICE_API_URL=...
ADVOICE_API_KEY=...
LEAZIFY_API_URL=...
LEAZIFY_API_KEY=...
```
> The web env "secrets store" is not encrypted-at-rest for editors — use **scoped/rotatable
> keys**, never a prod admin secret.

---

## 8. CRM-side connector interface (built in the CRM repo)

```ts
// One implementation per product; the contract above makes them near-identical.
export interface LeadConnector {
  app: 'pumpini' | 'advoice' | 'leazify';
  // Pull everything updated at/after `since`, following pagination to exhaustion.
  fetchSince(since: string | null): Promise<{ leads: CanonicalLead[]; nextSince: string | null }>;
}

export interface CanonicalLead {
  sourceApp: string;
  sourceId: string;        // product's lead id
  fullName: string;
  company?: string;
  city?: string;
  region?: string;
  phone?: string;
  email?: string;
  message?: string;
  sourceChannel?: string;
  sourceStatus?: string;
  receivedAt: string;
  sourceUpdatedAt: string;
}
```
Poller loop (cron, e.g. every 5 min): for each connector → `fetchSince(sync_state.last_cursor)`
→ upsert leads on `(source_app, source_id)` → save `nextSince` to `sync_state`.

---

## 9. Rollout steps

1. **CRM repo** — create it on GitHub (README-initialised), start a fresh Claude Code web
   session against it, scaffold Next.js + Drizzle + the `pumpini` connector first (it's
   the only one with a known shape today).
2. **Pumpini staging** — PR the read endpoint (Section 5.5) into `staging`, set
   `CRM_SYNC_API_KEY` on staging Railway, owner verifies `GET /api/integrations/crm/leads`.
3. **Promote** — once verified, PR to `main`, set the prod key.
4. **Advoice / Leazify** — implement the same contract on each, add their connectors.
5. **Billing** — wire Stripe at `deal won → invoice`.
6. **(Optional)** Phase 2: write lead status back to each product.

---

## 10. Open items
- Confirm Advoice & Leazify expose (or can add) an equivalent `updated_since` leads read.
- Decide cron cadence (default: 5 min) and whether near-real-time matters.
- Decide if/when status flows back to the products (one-way vs two-way).
