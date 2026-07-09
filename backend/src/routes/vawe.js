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
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, canAccessStation } = require('../middleware/stationAccess');
const { queueInteractionSignal } = require('../services/vaweService');
const { storageConfigured, uploadArtifact } = require('../services/vaweStorage');
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

// vawe_interactions is a cross-tenant PLATFORM table (written by the signed
// inbound webhook, keyed by station_id, with no per-user RLS policy). Under an
// authenticated request's RLS identity (app_authenticated) it default-denies →
// zero rows. So — exactly like the webhook and vaweService — its reads/writes
// run on the BYPASS role via als.exit(). Access is enforced at the app layer
// (the station-access guards below), not by RLS.
const bypass = (text, params) => pool.als.exit(() => pool.query(text, params));

// Guard for :id routes: resolve the interaction's station on the bypass role
// (an identity read would be RLS-filtered to nothing and silently skip the
// check), then verify the caller can access that station under their identity.
// Also resolves owner_can_act (Part B — owner-when-unlocked) column-tolerantly:
// if the column isn't migrated yet the SELECT would 42703, so we fall back to a
// query without it (owner_can_act defaults to false) rather than 500 the tile.
async function loadInteraction(req, res, next) {
  try {
    let row;
    try {
      const { rows } = await bypass(
        `SELECT station_id, COALESCE(owner_can_act, false) AS owner_can_act
           FROM vawe_interactions WHERE id = $1`,
        [req.params.id]
      );
      row = rows[0];
    } catch (err) {
      if (err.code !== '42703') throw err;   // only tolerate "column does not exist"
      const { rows } = await bypass(
        'SELECT station_id, false AS owner_can_act FROM vawe_interactions WHERE id = $1',
        [req.params.id]
      );
      row = rows[0];
    }
    if (!row) return res.status(404).json({ error: 'Interaction not found' });
    if (!(await canAccessStation(req.user.id, row.station_id))) {
      return res.status(403).json({ error: 'You do not have access to this station.' });
    }
    req.interactionStationId = row.station_id;        // for the reverse signal to VAWE
    req.interactionOwnerCanAct = row.owner_can_act === true;
    next();
  } catch (err) { next(err); }
}

// Write guard for the tile actions (commit / artifact / complete). The manager
// can always act; the owner can act ONLY once VAWE has unlocked him — i.e. the
// escalation chain reached the owner cycle and posted /owner-unlock, setting
// owner_can_act=true on this interaction. Everyone else stays read-only. Must
// run AFTER loadInteraction (it reads req.interactionOwnerCanAct).
function requireCanAct(req, res, next) {
  const role = req.user?.role;
  if (role === 'manager') return next();
  if (role === 'owner' && req.interactionOwnerCanAct) return next();
  return res.status(403).json({
    error: 'Only the outlet manager can act on this task until VAWE escalates it to the owner.',
  });
}

// Proof can be an image, a video, or a document. Artifacts are uploaded to a
// public Supabase bucket and artifact_url holds the URL (not base64). Cap kept
// under the 10 MB request-body limit (base64 inflates ~4/3), so ≤ 8 MB decoded.
const ARTIFACT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB decoded
function artifactTypeOk(mt) {
  if (!mt || typeof mt !== 'string') return false;
  return (
    /^(image|video|audio)\//.test(mt) ||
    mt === 'application/pdf' ||
    /^application\/(msword|rtf|vnd\.ms-|vnd\.openxmlformats-officedocument\.)/.test(mt) ||
    mt === 'text/plain' ||
    mt === 'text/csv'
  );
}

// GET /api/vawe/interactions?station_id=…  — OPEN instructions PLUS recently
// CLOSED ones (last 90 days) so the manager keeps a record/proof of what he
// completed. Ordered OPEN-first, then by the operative deadline (committed
// date → SO's soft target → age).
router.get('/interactions', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  // committed_date is returned raw (TIMESTAMPTZ — carries the manager's date AND
  // time; on any environment still on the older DATE column it serializes just
  // as well and COALESCE still coerces it to a comparable type). owner_can_act
  // (Part B) is likewise column-tolerant: if it isn't migrated yet the SELECT
  // 42703s, so we fall back to defaulting it to false rather than 500 the tile.
  const base = `id, station_id, task_name, instruction, desired_by, so_executed_at,
              committed_date,
              status, (artifact_url IS NOT NULL) AS has_artifact, artifact_url,
              created_at, updated_at`;
  const tail = `FROM vawe_interactions
        WHERE station_id = $1
          AND (status = 'OPEN'
               OR (status = 'CLOSED' AND updated_at > now() - interval '90 days'))
        ORDER BY (status = 'OPEN') DESC,
                 COALESCE(committed_date, desired_by, so_executed_at) ASC,
                 created_at ASC`;
  try {
    let rows;
    try {
      ({ rows } = await bypass(
        `SELECT ${base}, COALESCE(owner_can_act, false) AS owner_can_act ${tail}`,
        [req.query.station_id]
      ));
    } catch (err) {
      if (err.code !== '42703') throw err;
      ({ rows } = await bypass(
        `SELECT ${base}, false AS owner_can_act ${tail}`,
        [req.query.station_id]
      ));
    }
    res.json({ interactions: rows });
  } catch (err) { next(err); }
});

// POST /api/vawe/interactions/:id/owner-unlock  — signature-verified (VAWE →
// Pumpini, same HMAC as the inbound webhook). VAWE calls this when the
// escalation chain raises to the owner: it lets the owner act on this
// interaction (commit a date/time, upload proof) himself. Idempotent — a repeat
// call is a no-op. Column-tolerant: if owner_can_act isn't migrated yet we
// return 200 (unlocked:false) so VAWE's fire-and-forget call doesn't error-spam;
// the owner simply can't be unlocked until the Part B SQL is run.
router.post('/interactions/:id/owner-unlock', async (req, res, next) => {
  const code = checkSignature(req);
  if (code === 503) return res.status(503).json({ error: 'VAWE integration not configured' });
  if (code !== 200) return res.status(401).json({ error: 'Invalid signature' });

  const { interactionId } = req.body || {};
  if (!interactionId || interactionId !== req.params.id) {
    return res.status(400).json({ error: 'interactionId must be present and match the URL' });
  }
  try {
    const { rows } = await bypass(
      `UPDATE vawe_interactions
          SET owner_can_act = true, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id`,
      [interactionId]
    );
    logger.info(`VAWE owner-unlock for interaction ${interactionId} (matched ${rows.length})`);
    res.json({ ok: true, unlocked: rows.length > 0 });
  } catch (err) {
    if (err.code === '42703') {
      logger.warn(`VAWE owner-unlock ${interactionId}: owner_can_act column not present yet — run the Part B SQL`);
      return res.status(200).json({ ok: true, unlocked: false, reason: 'owner_can_act column pending migration' });
    }
    next(err);
  }
});

// PATCH /api/vawe/interactions/:id/commit  — manager sets/clears the commit-by
// date (the operative deadline). Body: { committed_date: 'YYYY-MM-DD' | null }.
router.patch('/interactions/:id/commit', authenticate, loadInteraction, requireCanAct, async (req, res, next) => {
  // Accept a full date+time (ISO or any Date-parseable string), or null to
  // clear. Stored as a timestamp — the manager commits a day AND time, which
  // is the operative deadline VAWE escalates against.
  const raw = req.body?.committed_date;
  let committed = null;
  if (raw) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'committed_date must be a valid date and time' });
    }
    committed = d.toISOString();
  }
  try {
    const { rows } = await bypass(
      `UPDATE vawe_interactions
          SET committed_date = $2, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id, committed_date`,
      [req.params.id, committed]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interaction not found or already closed' });
    // Tell VAWE the operative deadline (manager's commit-by date + time).
    queueInteractionSignal({
      source: 'pumpini',
      signalType: 'UPDATE',
      externalRef: req.interactionStationId,
      occurredAt: new Date().toISOString(),
      data: {
        interactionId: req.params.id,
        committedDate: rows[0].committed_date
          ? new Date(rows[0].committed_date).toISOString()
          : null,
      },
    });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/vawe/interactions/:id/artifact  — manager uploads proof (image /
// video / document). Body: { base64, media_type, filename? }. The file is
// uploaded to a public Supabase bucket (object key embeds the outlet id) and
// artifact_url holds the URL. Uploading proof does NOT settle the task — it
// ENABLES "Mark complete"; the manager then completes it deliberately (see
// /complete), which is the single point that sends the FULFILMENT signal.
router.post('/interactions/:id/artifact', authenticate, loadInteraction, requireCanAct, async (req, res, next) => {
  const { base64, media_type, filename } = req.body || {};
  if (!base64 || !media_type) {
    return res.status(400).json({ error: 'base64 and media_type are required' });
  }
  if (!artifactTypeOk(media_type)) {
    return res.status(400).json({ error: 'Unsupported file type. Use an image, video, PDF or document.' });
  }
  if (!storageConfigured()) {
    return res.status(503).json({ error: 'Artifact storage is not configured.' });
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) return res.status(400).json({ error: 'Empty or invalid file.' });
  if (bytes.length > ARTIFACT_MAX_BYTES) {
    return res.status(413).json({ error: 'File too large (max 8 MB).' });
  }
  try {
    const publicUrl = await uploadArtifact({
      stationId: req.interactionStationId,   // outlet id → embedded in the key
      interactionId: req.params.id,
      bytes,
      contentType: media_type,
      filename,
    });
    // Store the URL but keep the task OPEN — uploading proof ENABLES "Mark
    // complete"; the manager settles the task deliberately (see /complete),
    // which is where the FULFILMENT signal is sent.
    const { rows } = await bypass(
      `UPDATE vawe_interactions
          SET artifact_url = $2, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id`,
      [req.params.id, publicUrl]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interaction not found or already closed' });
    logger.info(`VAWE interaction ${req.params.id} proof uploaded by user ${req.user.id}`);
    res.json({ ok: true, artifact_url: publicUrl });
  } catch (err) {
    logger.error(`VAWE artifact upload failed for ${req.params.id}: ${err.message}`);
    return res.status(502).json({ error: 'Could not store the file. Please try again.' });
  }
});

// GET /api/vawe/interactions/:id/artifact  — return the proof URL. Read-only,
// so any user with station access (manager + owner) may view it. artifact_url
// is now a public Supabase URL (older rows may still hold a base64 data URI).
router.get('/interactions/:id/artifact', authenticate, loadInteraction, async (req, res, next) => {
  try {
    const { rows } = await bypass(
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
router.patch('/interactions/:id/complete', authenticate, loadInteraction, requireCanAct, async (req, res, next) => {
  try {
    // Proof-gated: only close once proof has been uploaded. Enforced server-side
    // (not just the disabled button) — close only when artifact_url is present.
    const { rows } = await bypass(
      `UPDATE vawe_interactions
          SET status = 'CLOSED', updated_at = now()
        WHERE id = $1 AND status = 'OPEN' AND artifact_url IS NOT NULL
      RETURNING id, artifact_url`,
      [req.params.id]
    );
    if (!rows.length) {
      // Distinguish "no proof yet" from "not found / already closed".
      const { rows: cur } = await bypass(
        `SELECT status, artifact_url FROM vawe_interactions WHERE id = $1`,
        [req.params.id]
      );
      if (cur.length && cur[0].status === 'OPEN' && !cur[0].artifact_url) {
        return res.status(409).json({ error: 'Upload proof before marking the task complete.' });
      }
      return res.status(404).json({ error: 'Interaction not found or already closed' });
    }
    logger.info(`VAWE interaction ${req.params.id} marked complete by user ${req.user.id}`);
    // Tell VAWE the task is fulfilled so it settles the interaction and stops
    // escalating. Carry the proof URL if the manager already uploaded one.
    queueInteractionSignal({
      source: 'pumpini',
      signalType: 'FULFILMENT',
      externalRef: req.interactionStationId,
      occurredAt: new Date().toISOString(),
      data: {
        interactionId: req.params.id,
        ...(rows[0].artifact_url ? { artifactUrl: rows[0].artifact_url } : {}),
      },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
// Exposed for unit tests (pure req/res/next guard — no DB).
module.exports.requireCanAct = requireCanAct;
