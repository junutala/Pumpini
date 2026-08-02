const router  = require('express').Router();
const artifacts = require('../services/artifactService');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authenticate, authorize, bumpTokenVersion } = require('../middleware/auth');
const { getAccessibleStationIds, canAccessStation, requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const { createUser, linkUserToStation } = require('../services/userService');

// Gating note (access-model cleanup): the user *list* + attendant lifecycle
// (deactivate / end-date / force-logout) stay role-gated to owner+manager. GET /users
// is the Start-Shift operator picker's data source — a hot path; and none of these
// routes GRANT permissions or roles, so they are not the privilege-escalation surface.
// That surface (assigning responsibilities) is locked to superadmin in templates.js.
// Adding a shift attendant is the one route flipped to responsibility (`attendant.add`).

// A user is manageable only if they share one of the requester's stations —
// directly (station_users) or as a credit customer linked to one. Without this,
// any owner/manager could PATCH or force-logout ANY user in the system by id.
async function canManageUser(requesterId, targetUserId) {
  const ids = await getAccessibleStationIds(requesterId);
  if (!ids.length) return false;
  const { rows } = await pool.query(
    `SELECT 1
       WHERE EXISTS (SELECT 1 FROM station_users
                      WHERE user_id=$1 AND station_id = ANY($2::uuid[]))
          OR EXISTS (SELECT 1 FROM users u
                      JOIN corporate_station_links csl ON csl.corporate_id = u.corporate_id
                      WHERE u.id=$1 AND csl.station_id = ANY($2::uuid[]))
       LIMIT 1`,
    [targetUserId, ids]
  );
  return rows.length > 0;
}

router.get('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { station_id, role } = req.query;
    // Always scoped to the requester's own stations — a station_id is verified,
    // and omitting it falls back to "all MY stations", never "everyone".
    if (station_id && !(await canAccessStation(req.user.id, station_id))) {
      return res.status(403).json({ error: 'You do not have access to this station.' });
    }
    const scopeIds = station_id ? [station_id] : await getAccessibleStationIds(req.user.id);
    if (!scopeIds.length) return res.json([]);
    const p = [scopeIds];
    let q = `SELECT DISTINCT u.id,u.name,u.phone,u.email,u.role,u.language,u.is_active,u.end_date,u.created_at,u.must_change_password
             FROM users u
             JOIN station_users su ON su.user_id=u.id
             WHERE su.station_id = ANY($1::uuid[])`;
    if (role) { p.push(role); q += ` AND u.role=$${p.length}`; }
    q += ' ORDER BY u.name';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    if (!(await canManageUser(req.user.id, req.params.id))) {
      return res.status(403).json({ error: 'You do not have access to this user.' });
    }
    const { name, email, language, is_active, end_date, password } = req.body;
    const sets = []; const p = [];
    if (name !== undefined)      { p.push(name);      sets.push(`name=$${p.length}`); }
    if (email !== undefined)     { p.push(email);     sets.push(`email=$${p.length}`); }
    if (language !== undefined)  { p.push(language);  sets.push(`language=$${p.length}`); }
    if (is_active !== undefined) { p.push(is_active); sets.push(`is_active=$${p.length}`); }
    // Attendant end-dating (null clears it = reactivate). Pair with is_active from the caller.
    if (end_date !== undefined)  { p.push(end_date || null); sets.push(`end_date=$${p.length}`); }
    if (password)                { p.push(await bcrypt.hash(password,12)); sets.push(`password_hash=$${p.length}`); }
    if (req.body.corporate_id !== undefined){ p.push(req.body.corporate_id); sets.push(`corporate_id=$${p.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    p.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${p.length} RETURNING id,name,phone,email,role,language,is_active,end_date`,
      p
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /:id/force-logout — revoke ALL of a user's active sessions immediately.
// Bumps token_version so every issued JWT for that user fails the next request
// (within the 30s auth cache). Owner/manager only.
router.post('/:id/force-logout', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    if (!(await canManageUser(req.user.id, req.params.id))) {
      return res.status(403).json({ error: 'You do not have access to this user.' });
    }
    await bumpTokenVersion(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/users — owner creates a staff user (any valid role) for a station.
// Single-writer path: the insert goes through userService.createUser, exactly like
// the attendant + superadmin creators, so rules can't drift. Runs on the BYPASS
// role (als.run(undefined,…)) for the same chicken-and-egg reason as /attendant:
// a brand-new user isn't linked to any of the owner's stations until the next
// statement, so the owner's RLS identity can't satisfy the insert policy.
router.post('/', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { station_id, photo_base64, photo_media_type, face_descriptor } = req.body;
    if (station_id && !(await canAccessStation(req.user.id, station_id))) {
      return res.status(403).json({ error: 'You do not have access to this station.' });
    }
    const run = () => pool.als.run(undefined, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const user = await createUser(req.body, client);
        if (station_id) await linkUserToStation(station_id, user.id, client);
        await client.query('COMMIT');
        return user;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection may be dead */ }
        throw e;
      } finally { client.release(); }
    });
    let created;
    try { created = await run(); }
    catch (e) { if (pool.isRetryableConnError(e)) created = await run(); else throw e; }
    // FACE ENROLMENT. Stored against the USER, not a shift, because it is the
    // reference photograph the shift-start pictures are compared against — first by
    // eye, and later by the matcher that replaces the operator picker entirely
    // (owner: "the picture has to fetch the attendant. This is the ultimate goal").
    // Best-effort: a camera that will not co-operate must never stop an outlet
    // adding a member of staff.
    const enrolment = await artifacts.saveAttendantPhoto({
      station_id, user_id: created.id, name: created.name, phase: 'enrolment',
      file_base64: photo_base64, media_type: photo_media_type,
      descriptor: face_descriptor,
      uploaded_by: req.user.id,
    });

    res.status(201).json({ ...created, photo_artifact_id: enrolment ? enrolment.id : null });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// POST /api/users/attendant — manager adds a shift attendant. Role is forced to
// 'attendant', scoped to this station, dummy password (they don't log in / use POS
// yet). Same single-writer service as POST /users, composed in the BYPASS-role
// transaction (a manager's RLS identity can't insert a not-yet-linked user).
router.post('/attendant', authenticate, requireStationAccess({ required: true }), requirePerm('attendant.add'), async (req, res, next) => {
  try {
    const { name, phone, language = 'en', station_id, photo_base64, photo_media_type, face_descriptor } = req.body;

    const insertAttendant = () => pool.als.run(undefined, async () => {
      const client = await pool.connect();   // no ALS store → raw bypass owner client
      try {
        await client.query('BEGIN');
        const user = await createUser(
          { name, phone, password: 'Welcome@123', role: 'attendant', language, mustChangePassword: true },
          client
        );
        await linkUserToStation(station_id, user.id, client);
        await client.query('COMMIT');
        return user;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection may be dead */ }
        throw e;
      } finally { client.release(); }
    });

    // Atomic transaction → safe to re-run once on a stale/dead connection (idle
    // pool drop), so the manager never sees the "first click fails" symptom.
    let created;
    try { created = await insertAttendant(); }
    catch (e) {
      if (pool.isRetryableConnError(e)) created = await insertAttendant();
      else throw e;
    }
    // FACE ENROLMENT. Stored against the USER, not a shift, because it is the
    // reference photograph the shift-start pictures are compared against — first by
    // eye, and later by the matcher that replaces the operator picker entirely
    // (owner: "the picture has to fetch the attendant. This is the ultimate goal").
    // Best-effort: a camera that will not co-operate must never stop an outlet
    // adding a member of staff.
    const enrolment = await artifacts.saveAttendantPhoto({
      station_id, user_id: created.id, name: created.name, phase: 'enrolment',
      file_base64: photo_base64, media_type: photo_media_type,
      descriptor: face_descriptor,
      uploaded_by: req.user.id,
    });

    res.status(201).json({ ...created, photo_artifact_id: enrolment ? enrolment.id : null });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === '23505') return res.status(409).json({ error: 'This phone number is already registered.' });
    next(e);
  }
});

// POST /api/users/:id/photo — take (or re-take) a member of staff's reference
// photograph AFTER he was created. Everyone already on the books predates the
// camera on the Add-Attendant form, so without this their faces could never be
// enrolled at all and the matcher would start life blind to the existing staff.
//
// Same guard as adding one, and then some: the caller must have access to the
// station AND the target must actually be posted there. Access alone is not
// enough — it would let a manager attach a photograph to a user at another
// outlet whose id he happened to know.
router.post('/:id/photo', authenticate, requireStationAccess({ required: true }), requirePerm('attendant.add'), async (req, res, next) => {
  try {
    const { station_id, photo_base64, photo_media_type, face_descriptor } = req.body;
    if (!photo_base64) return res.status(400).json({ error: 'Take a photo first.' });

    const { rows } = await pool.query(
      `SELECT u.id, u.name
         FROM users u
         JOIN station_users su ON su.user_id = u.id AND su.station_id = $2
        WHERE u.id = $1`,
      [req.params.id, station_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'That person is not on this outlet.' });

    const saved = await artifacts.saveAttendantPhoto({
      station_id, user_id: rows[0].id, name: rows[0].name, phase: 'update',
      file_base64: photo_base64, media_type: photo_media_type,
      descriptor: face_descriptor,
      uploaded_by: req.user.id,
    });
    // save() never throws — it returns null when the artifact table has not been
    // migrated yet or the image was too big. Say so plainly instead of reporting
    // a success that stored nothing.
    if (!saved) return res.status(502).json({ error: 'Could not store that photo. Try a smaller/clearer picture.' });
    res.status(201).json({ photo_artifact_id: saved.id });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
