const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authenticate, authorize, bumpTokenVersion } = require('../middleware/auth');
const { getAccessibleStationIds, canAccessStation, requireStationAccess } = require('../middleware/stationAccess');

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

// POST /api/users/attendant — manager adds a shift attendant. Minimal by design:
// role is forced to 'attendant', they're scoped to this station, and a dummy
// password is set (attendants don't log in / use POS yet). They become available
// for shift assignment.
router.post('/attendant', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { name, phone, language = 'en', station_id } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length < 10) return res.status(400).json({ error: 'Enter a valid phone number.' });
    const storedPhone = clean.startsWith('91') ? `+${clean}` : `+91${clean}`;
    const hash = await bcrypt.hash('Welcome@123', 12);   // dummy — attendants don't log in yet

    // Creating a user row is a privileged op already authorized above (owner/
    // manager + station access; role forced to 'attendant'). Run it on the BYPASS
    // role — exactly like the superadmin console — by stepping outside the request's
    // RLS identity (als.run(undefined,…)). A manager's identity can't satisfy an
    // insert policy on a brand-new user that isn't linked to any of his stations
    // yet (the station_users link is written a statement later — chicken-and-egg).
    const insertAttendant = () => pool.als.run(undefined, async () => {
      const client = await pool.connect();   // no ALS store → raw bypass owner client
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO users(name,phone,password_hash,role,language,must_change_password)
           VALUES($1,$2,$3,'attendant',$4,TRUE) RETURNING id,name,phone,role,language`,
          [name, storedPhone, hash, language]
        );
        await client.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [station_id, rows[0].id]);
        await client.query('COMMIT');
        return rows[0];
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
    res.status(201).json(created);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'This phone number is already registered.' });
    next(e);
  }
});

module.exports = router;
