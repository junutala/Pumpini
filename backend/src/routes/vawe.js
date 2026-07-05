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

module.exports = router;
