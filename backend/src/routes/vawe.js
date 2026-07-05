// src/routes/vawe.js
//
// Inbound integration: VAWE → Pumpini. VAWE owns operational-task interactions
// and pushes each one here as an OPEN "SO Instructions" item for the outlet's
// manager (the owner sees it read-only). Signature-authenticated (no user
// session) → runs on the bypass owner role, so RLS is inert — correct for a
// cross-tenant platform webhook. Idempotent: upsert on the VAWE interaction id.
//
//   PUMPINI_WEBHOOK_SECRET – shared secret; verifies the x-vawe-signature HMAC
//
const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const logger  = require('../utils/logger');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const router  = express.Router();

// Timing-safe hex-signature compare over the EXACT raw request bytes
// (captured by the express.json verify hook in index.js).
function checkSignature(req) {
  const secret = process.env.PUMPINI_WEBHOOK_SECRET;
  if (!secret) return 503;
  const provided = req.get('x-vawe-signature');
  if (!provided) return 401;
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  let a, b;
  try { a = Buffer.from(provided, 'hex'); b = Buffer.from(expected, 'hex'); }
  catch { return 401; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 401;
  return 200;
}

router.post('/interactions', async (req, res, next) => {
  const code = checkSignature(req);
  if (code === 503) return res.status(503).json({ error: 'VAWE integration not configured' });
  if (code !== 200) return res.status(401).json({ error: 'Invalid signature' });

  const {
    interactionId, pumpiniOutletId, taskName, instruction,
    desiredBy, soExecutedAt, status,
  } = req.body || {};

  if (!interactionId || !pumpiniOutletId || !taskName || !instruction || !soExecutedAt || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (status !== 'OPEN' && status !== 'CLOSED') {
    return res.status(400).json({ error: 'status must be OPEN or CLOSED' });
  }

  try {
    // Upsert on the VAWE interaction id. VAWE's status drives the tile:
    // OPEN shows it on the manager/owner dashboards; CLOSED removes it.
    await pool.query(
      `INSERT INTO vawe_interactions
         (id, station_id, task_name, instruction, desired_by, so_executed_at, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (id) DO UPDATE SET
         task_name      = EXCLUDED.task_name,
         instruction    = EXCLUDED.instruction,
         desired_by     = EXCLUDED.desired_by,
         so_executed_at = EXCLUDED.so_executed_at,
         status         = EXCLUDED.status,
         updated_at     = now()`,
      [interactionId, pumpiniOutletId, taskName, instruction, desiredBy || null, soExecutedAt, status]
    );
    logger.info(`VAWE interaction ${interactionId} ${status} for station ${pumpiniOutletId}`);
    res.status(202).json({ status: 'accepted' });
  } catch (err) {
    // FK violation = the outlet isn't in Pumpini yet. Terminal (a retry won't
    // fix it), so 400 rather than 500 — VAWE logs it and moves on.
    if (err.code === '23503') {
      logger.warn(`VAWE interaction ${interactionId}: unknown station ${pumpiniOutletId}`);
      return res.status(400).json({ error: 'Unknown outlet' });
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  User-facing "SO Instructions" tile (manager acts, owner observes).
//
//  These are authenticated app routes — NOT signature-verified like the webhook
//  above. Each is guarded by authenticate + a station-access check (the same
//  server-side IDOR boundary the rest of the API uses). Writes additionally
//  require role=manager, so the owner/CCO view is strictly read-only.
// ─────────────────────────────────────────────────────────────────────────────

// Resolve the interaction's parent station for the access check on :id routes.
const viaInteraction = requireStationVia(
  'SELECT station_id FROM vawe_interactions WHERE id = $1', 'id'
);

// Accepted proof types + cap. Artifacts are stored inline as a base64 data URI
// in artifact_url (the house pattern is base64-in-DB — no object store exists).
const ARTIFACT_OK = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ARTIFACT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB decoded

// GET /api/vawe/interactions?station_id=…  — OPEN instructions for one outlet.
// Ordered by the operative deadline (committed date → SO's soft target → age).
router.get('/interactions', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, station_id, task_name, instruction, desired_by, so_executed_at,
              to_char(committed_date, 'YYYY-MM-DD') AS committed_date,
              status, (artifact_url IS NOT NULL) AS has_artifact,
              created_at, updated_at
         FROM vawe_interactions
        WHERE station_id = $1 AND status = 'OPEN'
        ORDER BY COALESCE(committed_date, desired_by::date, so_executed_at::date) ASC,
                 created_at ASC`,
      [req.query.station_id]
    );
    res.json({ interactions: rows });
  } catch (err) { next(err); }
});

// PATCH /api/vawe/interactions/:id/commit  — manager sets/clears the commit-by
// date (the operative deadline). Body: { committed_date: 'YYYY-MM-DD' | null }.
router.patch('/interactions/:id/commit', authenticate, authorize('manager'), viaInteraction, async (req, res, next) => {
  const committed = req.body?.committed_date || null;
  if (committed && !/^\d{4}-\d{2}-\d{2}$/.test(committed)) {
    return res.status(400).json({ error: 'committed_date must be YYYY-MM-DD' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE vawe_interactions
          SET committed_date = $2, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id, to_char(committed_date, 'YYYY-MM-DD') AS committed_date`,
      [req.params.id, committed]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interaction not found or already closed' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/vawe/interactions/:id/artifact  — manager uploads proof.
// Body: { base64, media_type, filename? }. Stored as a data URI in artifact_url.
router.post('/interactions/:id/artifact', authenticate, authorize('manager'), viaInteraction, async (req, res, next) => {
  const { base64, media_type } = req.body || {};
  if (!base64 || !media_type) {
    return res.status(400).json({ error: 'base64 and media_type are required' });
  }
  if (!ARTIFACT_OK.includes(media_type)) {
    return res.status(400).json({ error: 'Unsupported file type. Use a JPG/PNG/WebP image or a PDF.' });
  }
  // Reject oversize before it hits the DB (base64 is ~4/3 of the decoded size).
  if (Math.floor((base64.length * 3) / 4) > ARTIFACT_MAX_BYTES) {
    return res.status(413).json({ error: 'File too large (max 5 MB).' });
  }
  const dataUri = `data:${media_type};base64,${base64}`;
  try {
    const { rows } = await pool.query(
      `UPDATE vawe_interactions
          SET artifact_url = $2, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id`,
      [req.params.id, dataUri]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interaction not found or already closed' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/vawe/interactions/:id/artifact  — fetch the stored proof (data URI).
// Read-only, so any user with station access (manager + owner) may view it.
router.get('/interactions/:id/artifact', authenticate, viaInteraction, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT artifact_url FROM vawe_interactions WHERE id = $1', [req.params.id]
    );
    if (!rows.length || !rows[0].artifact_url) {
      return res.status(404).json({ error: 'No artifact uploaded' });
    }
    res.json({ data_url: rows[0].artifact_url });
  } catch (err) { next(err); }
});

// PATCH /api/vawe/interactions/:id/complete  — manager marks the task done.
// Flips status→CLOSED, which removes the tile from both dashboards.
router.patch('/interactions/:id/complete', authenticate, authorize('manager'), viaInteraction, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE vawe_interactions
          SET status = 'CLOSED', updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interaction not found or already closed' });
    logger.info(`VAWE interaction ${req.params.id} marked complete by user ${req.user.id}`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
