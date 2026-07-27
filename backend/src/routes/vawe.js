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
const { queueInteractionSignal, queueOutletSync } = require('../services/vaweService');
const { storageConfigured, uploadArtifact } = require('../services/vaweStorage');
const { createUser, linkUserToStation } = require('../services/userService');
const { createStation } = require('../services/stationService');
const { normalizePhone } = require('../utils/phone');
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
    desiredBy, soExecutedAt, status, soAudioUrl, soOwnerAudioUrl,
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
    // COLUMN-TOLERANT: try storing the SO voice-recording URLs (so_audio_url /
    // so_owner_audio_url); if those columns aren't migrated yet the INSERT 42703s,
    // so we fall back to the base upsert (no audio) rather than dropping the whole
    // push. Once the ADD COLUMN SQL is run, the audio lands on the next push.
    const base = [interactionId, pumpiniOutletId, taskName, instruction, desiredBy || null, soExecutedAt, status];
    try {
      await pool.query(
        `INSERT INTO vawe_interactions
           (id, station_id, task_name, instruction, desired_by, so_executed_at, status, so_audio_url, so_owner_audio_url, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (id) DO UPDATE SET
           task_name          = EXCLUDED.task_name,
           instruction        = EXCLUDED.instruction,
           desired_by         = EXCLUDED.desired_by,
           so_executed_at     = EXCLUDED.so_executed_at,
           status             = EXCLUDED.status,
           so_audio_url       = EXCLUDED.so_audio_url,
           so_owner_audio_url = EXCLUDED.so_owner_audio_url,
           updated_at         = now()`,
        [...base, soAudioUrl || null, soOwnerAudioUrl || null]
      );
    } catch (err) {
      if (err.code !== '42703') throw err;   // only tolerate "column does not exist"
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
        base
      );
    }
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

// POST /api/vawe/outlets-resync  — signature-verified (VAWE → Pumpini, same HMAC
// as the inbound webhook). VAWE asks Pumpini to re-push every outlet (coords,
// contacts, brand) so a stale VAWE copy — e.g. coordinates set in Pumpini after
// the last sync — is refreshed, without a manual station re-save. Each outlet is
// queued through the SAME fire-and-forget path a settings-save uses
// (queueOutletSync), so this reuses the proven, idempotent sync. Runs the id
// read on the bypass role (cross-tenant platform action, like the webhook).
router.post('/outlets-resync', async (req, res, next) => {
  const code = checkSignature(req);
  if (code === 503) return res.status(503).json({ error: 'VAWE integration not configured' });
  if (code !== 200) return res.status(401).json({ error: 'Invalid signature' });
  try {
    const { rows } = await pool.als.exit(() => pool.query('SELECT id FROM stations'));
    for (const r of rows) queueOutletSync(r.id);
    logger.info(`VAWE outlets-resync queued ${rows.length} outlets`);
    res.json({ queued: rows.length });
  } catch (err) { next(err); }
});

// POST /api/vawe/provision-lite  — signature-verified (VAWE → Pumpini, same HMAC
// as the inbound webhook). VAWE registered a DIRECT (non-Pumpini) outlet and wants
// its staff to submit proof through the free "Pumpini Lite" SO-tile surface. This:
//   1) ensures the outlet EXISTS in Pumpini. A DIRECT outlet has no Pumpini station
//      yet, so its VAWE ref is "direct:<uuid>"; VAWE sends the bare <uuid> here and
//      we create the station with that exact id (deterministic → idempotent, and
//      the later SO-Instructions interaction push targets the same id). A synced
//      (already-Pumpini) outlet's id already exists → we just flip its tier;
//   2) flips it to entitlement='lite' — the free ceiling: on a lite outlet
//      Effective = Responsibility ∩ ['vawe.proof'], so the paid app is unreachable;
//   3) ensures the manager (and, if given, the owner) exist as users, are linked to
//      the outlet, and carry the "Lite — SO Tile" responsibility (module vawe.proof)
//      so requirePerm('vawe.proof') passes and they land on /lite.
// Body: { pumpiniOutletId, name?, city?, oilCompany?, manager:{name,phone,email?,
//         language?}, owner?:{…same} }. name is REQUIRED when the station must be
// created (a new DIRECT outlet); ignored when the outlet already exists.
// Idempotent: create-if-missing on a deterministic id; dedups users on normalized
// phone; re-assigns the responsibility on conflict; safe to re-run. Runs as ONE
// transaction on the bypass role (no user session — als.exit() steps out of any RLS
// identity), exactly like the webhook, which cross-tenant provisioning requires.
router.post('/provision-lite', async (req, res, next) => {
  const code = checkSignature(req);
  if (code === 503) return res.status(503).json({ error: 'VAWE integration not configured' });
  if (code !== 200) return res.status(401).json({ error: 'Invalid signature' });

  const { pumpiniOutletId, name, city, oilCompany, manager, owner } = req.body || {};
  if (!pumpiniOutletId) return res.status(400).json({ error: 'pumpiniOutletId is required' });
  if (!manager || !manager.name || !manager.phone) {
    return res.status(400).json({ error: 'manager { name, phone } is required' });
  }

  try {
    const result = await pool.als.exit(async () => {
      const client = await pool.connect();   // no ALS store here → real bypass client
      try {
        await client.query('BEGIN');

        // 1) Ensure the outlet exists, then flip it to the free tier. A DIRECT
        //    outlet won't exist yet → create it with the caller-supplied id (so
        //    the id is stable across re-provisions and matches the interaction
        //    push). Creating requires a name; an existing outlet ignores it.
        const { rows: found } = await client.query('SELECT id FROM stations WHERE id=$1', [pumpiniOutletId]);
        if (!found.length) {
          if (!name || !String(name).trim()) { await client.query('ROLLBACK'); return { needName: true }; }
          await createStation(
            { id: pumpiniOutletId, name, city: city || null, oil_company: oilCompany || null, entitlement: 'lite' },
            client
          );
        } else {
          await client.query(`UPDATE stations SET entitlement='lite' WHERE id=$1`, [pumpiniOutletId]);
        }

        // 2) The global "Lite — SO Tile" responsibility (module vawe.proof). Seeded
        //    once per environment; if it's missing the caller must seed it first.
        const { rows: tmpl } = await client.query(
          `SELECT id FROM role_templates WHERE station_id IS NULL AND name='Lite — SO Tile' LIMIT 1`
        );
        if (!tmpl.length) { await client.query('ROLLBACK'); return { noTemplate: true }; }
        const templateId = tmpl[0].id;

        // 3) Ensure each staff user exists (dedup on phone — the one-writer rule),
        //    is linked to the outlet, and carries the tile responsibility.
        const provisioned = [];
        for (const [role, person] of [['manager', manager], ['owner', owner]]) {
          if (!person || !person.name || !person.phone) continue;
          const phone = normalizePhone(person.phone);
          const { rows: existing } = await client.query(
            'SELECT id FROM users WHERE phone=$1 LIMIT 1', [phone]
          );
          let userId;
          if (existing.length) {
            userId = existing[0].id;
          } else {
            // Initial credential = the person's mobile number as BOTH fields. Pumpini
            // login is already by mobile number; here the password is that same
            // 10-digit number the SO entered at creation — so the SO just says "log in
            // with your mobile number as the password." But it is a SHARED-KNOWLEDGE
            // temp (everyone knows a phone number), so mustChangePassword=TRUE forces
            // each person to set their OWN private password on first login before they
            // can use the tile — otherwise anyone could log in as anyone. The future
            // device-passkey enrollment supersedes this. (Owner decision 2026-07-22.)
            const created = await createUser({
              name: person.name, phone: person.phone, email: person.email || null,
              password: person.phone,
              role, language: person.language || 'te', mustChangePassword: true,
            }, client);
            userId = created.id;
          }
          await linkUserToStation(pumpiniOutletId, userId, client);
          await client.query(
            `INSERT INTO user_role_assignments(user_id,template_id,station_id)
             VALUES($1,$2,$3)
             ON CONFLICT(user_id,station_id) DO UPDATE SET template_id=$2, assigned_at=NOW()`,
            [userId, templateId, pumpiniOutletId]
          );
          // Keep the NAME current too. Re-provisioning is how VAWE pushes a
          // corrected contact, and dedup matches on phone alone — so without
          // this an existing row keeps its old name and Pumpini Lite shows the
          // previous person against a live number.
          await client.query(
            `UPDATE users SET name=$2 WHERE id=$1 AND name IS DISTINCT FROM $2`,
            [userId, person.name]
          );
          provisioned.push({ role, userId, phone });
        }

        // RECONCILE: the payload declares who the manager/owner ARE, so anyone
        // else still holding this station's Lite tile is a PREVIOUS holder —
        // typically a manager whose number VAWE just replaced. Without this
        // they keep station access and can still submit proof for an outlet
        // they've left, because linkUserToStation only ever INSERTs.
        //
        // Deliberately narrow: it only revokes users whose assignment IS the
        // "Lite — SO Tile" template at THIS station. Real Pumpini staff on a
        // paid outlet that was flipped to lite hold a different template and
        // are never touched.
        const keep = provisioned.map((p) => p.userId);
        const { rows: revoked } = await client.query(
          `DELETE FROM user_role_assignments
            WHERE station_id = $1
              AND template_id = $2
              AND NOT (user_id = ANY($3::uuid[]))
          RETURNING user_id`,
          [pumpiniOutletId, templateId, keep]
        );
        for (const r of revoked) {
          // Drop the station link as well, so the outlet stops appearing for
          // them at all rather than showing up empty.
          await client.query(
            'DELETE FROM station_users WHERE station_id=$1 AND user_id=$2',
            [pumpiniOutletId, r.user_id]
          );
        }

        await client.query('COMMIT');
        return {
          provisioned,
          stationId: pumpiniOutletId,
          revoked: revoked.map((r) => r.user_id),
        };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
        throw e;
      } finally {
        client.release();
      }
    });

    if (result.needName)   return res.status(400).json({ error: 'name is required to create a new outlet' });
    if (result.noTemplate) return res.status(503).json({ error: '"Lite — SO Tile" responsibility not seeded yet' });

    // The outlet's entitlement changed → drop every cached perm for it so the lite
    // ceiling takes effect on the next request (no 5-min cache wait).
    try { require('../middleware/permissions').clearStationPermCache(pumpiniOutletId); } catch { /* best-effort */ }
    logger.info(
      `VAWE provision-lite: outlet ${pumpiniOutletId} → lite; provisioned ` +
      `${result.provisioned.map(p => p.role).join(', ') || 'none'}` +
      `${result.revoked.length ? `; revoked ${result.revoked.length} previous holder(s)` : ''}`
    );
    // Return the resolved Pumpini station id so VAWE can confirm the deterministic
    // mapping (it equals the id VAWE sent).
    res.json({ ok: true, entitlement: 'lite', pumpiniOutletId: result.stationId, provisioned: result.provisioned, revoked: result.revoked });
  } catch (err) {
    // createUser throws { status, message } for bad input (invalid phone, dup, …).
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/vawe/revoke-lite  — signature-verified (VAWE → Pumpini, same HMAC as
// the inbound webhook). The SO disabled the outlet in VAWE (it changed hands and
// now runs as a separate ADHOC outlet, or it closed), so its staff must stop
// being able to submit proof for it. Strips the "Lite — SO Tile" responsibility
// and the station link for that station.
//
// DELIBERATELY NARROW — it only removes assignments whose template IS the global
// "Lite — SO Tile". Real Pumpini staff at a paid outlet that was once flipped to
// lite hold different templates and are never touched, so this can't strip a
// working outlet's employees. The users themselves are left intact (they may run
// other outlets); only this station's lite access goes.
//
// Idempotent: revoking an already-revoked outlet removes nothing and still 200s.
// Body: { pumpiniOutletId }.
router.post('/revoke-lite', async (req, res, next) => {
  const code = checkSignature(req);
  if (code === 503) return res.status(503).json({ error: 'VAWE integration not configured' });
  if (code !== 200) return res.status(401).json({ error: 'Invalid signature' });

  const { pumpiniOutletId } = req.body || {};
  if (!pumpiniOutletId) return res.status(400).json({ error: 'pumpiniOutletId is required' });

  try {
    const result = await pool.als.exit(async () => {
      const client = await pool.connect();   // no ALS store → real bypass client
      try {
        await client.query('BEGIN');
        const { rows: tmpl } = await client.query(
          `SELECT id FROM role_templates WHERE station_id IS NULL AND name='Lite — SO Tile' LIMIT 1`
        );
        // No template seeded ⇒ nothing was ever granted ⇒ nothing to revoke.
        if (!tmpl.length) { await client.query('ROLLBACK'); return { revoked: [] }; }

        const { rows: revoked } = await client.query(
          `DELETE FROM user_role_assignments
            WHERE station_id = $1 AND template_id = $2
          RETURNING user_id`,
          [pumpiniOutletId, tmpl[0].id]
        );
        for (const r of revoked) {
          await client.query(
            'DELETE FROM station_users WHERE station_id=$1 AND user_id=$2',
            [pumpiniOutletId, r.user_id]
          );
        }
        await client.query('COMMIT');
        return { revoked: revoked.map((r) => r.user_id) };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
        throw e;
      } finally {
        client.release();
      }
    });

    // Access changed → drop the cached perms so the revoke bites immediately
    // rather than after the 5-minute cache window.
    try { require('../middleware/permissions').clearStationPermCache(pumpiniOutletId); } catch { /* best-effort */ }
    logger.info(`VAWE revoke-lite: outlet ${pumpiniOutletId} → revoked ${result.revoked.length} user(s)`);
    res.json({ ok: true, revoked: result.revoked });
  } catch (err) { next(err); }
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
  // Optional columns, tolerated in tiers so a not-yet-migrated column can't 500
  // the tile: owner_can_act (Part B) and the SO voice-recording URLs (so_audio_url
  // / so_owner_audio_url). Try richest → progressively substitute defaults on a
  // 42703. On staging owner_can_act exists but the audio columns may not yet, so
  // tier 2 (real owner_can_act, NULL audio) is the graceful landing until the SQL runs.
  const optTiers = [
    `COALESCE(owner_can_act, false) AS owner_can_act, so_audio_url, so_owner_audio_url`,
    `COALESCE(owner_can_act, false) AS owner_can_act, NULL::text AS so_audio_url, NULL::text AS so_owner_audio_url`,
    `false AS owner_can_act, NULL::text AS so_audio_url, NULL::text AS so_owner_audio_url`,
  ];
  try {
    let rows;
    for (let i = 0; i < optTiers.length; i++) {
      try {
        ({ rows } = await bypass(`SELECT ${base}, ${optTiers[i]} ${tail}`, [req.query.station_id]));
        break;
      } catch (err) {
        if (err.code !== '42703' || i === optTiers.length - 1) throw err;
      }
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
  const { base64, media_type, filename, captureMethod } = req.body || {};
  if (!base64 || !media_type) {
    return res.status(400).json({ error: 'base64 and media_type are required' });
  }
  // How the manager produced the proof — forwarded to VAWE (which owns the
  // artifact record). Not persisted in Pumpini; anything unrecognised is dropped.
  const cm = captureMethod === 'LIVE_CAPTURE' || captureMethod === 'FILE_UPLOAD'
    ? captureMethod : undefined;
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
    // Proof IS completion. Uploading the artifact settles the task: stamp the
    // commit date to now if the manager never set one, flip status→CLOSED, and
    // send FULFILMENT to VAWE so it stops escalating. (Previously upload merely
    // ENABLED a separate "Mark complete" click; a manager who uploaded proof but
    // didn't click complete left the task OPEN and VAWE kept calling the owner.)
    const nowIso = new Date().toISOString();
    const { rows } = await bypass(
      `UPDATE vawe_interactions
          SET artifact_url = $2,
              committed_date = COALESCE(committed_date, $3),
              status = 'CLOSED',
              updated_at = now()
        WHERE id = $1 AND status = 'OPEN'
      RETURNING id, artifact_url, committed_date`,
      [req.params.id, publicUrl, nowIso]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interaction not found or already closed' });
    logger.info(`VAWE interaction ${req.params.id} proof uploaded + auto-completed by user ${req.user.id}`);
    // Tell VAWE the task is fulfilled so it settles the interaction and stops
    // escalating, carrying the proof URL and the (now-stamped) commit date.
    queueInteractionSignal({
      source: 'pumpini',
      signalType: 'FULFILMENT',
      externalRef: req.interactionStationId,
      occurredAt: nowIso,
      data: {
        interactionId: req.params.id,
        artifactUrl: rows[0].artifact_url,
        committedDate: rows[0].committed_date
          ? new Date(rows[0].committed_date).toISOString()
          : nowIso,
        ...(cm ? { captureMethod: cm } : {}),
      },
    });
    res.json({ ok: true, artifact_url: publicUrl, completed: true });
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

// GET /api/vawe/lite-promo — the "Pumpini Lite" promo shown under the SO tile.
// Global single row (id=1), managed from superadmin. TABLE-TOLERANT: if
// lite_promos isn't migrated yet, or anything else fails, return no promo so the
// tile silently shows nothing rather than 500-ing a manager-facing screen.
// Non-sensitive global content → any authenticated user may read it.
router.get('/lite-promo', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT enabled, image_url, headline, body, cta_label, cta_url
         FROM lite_promos WHERE id = 1`
    );
    const p = rows[0];
    const hasContent = p && p.enabled && (p.image_url || p.headline || p.body);
    return res.json({
      promo: hasContent
        ? { imageUrl: p.image_url, headline: p.headline, body: p.body,
            ctaLabel: p.cta_label, ctaUrl: p.cta_url }
        : null,
    });
  } catch {
    return res.json({ promo: null });
  }
});

module.exports = router;
// Exposed for unit tests (pure req/res/next guard — no DB).
module.exports.requireCanAct = requireCanAct;
