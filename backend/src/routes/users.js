const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authenticate, authorize, bumpTokenVersion } = require('../middleware/auth');
const { getAccessibleStationIds, canAccessStation } = require('../middleware/stationAccess');

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
    let q = `SELECT DISTINCT u.id,u.name,u.phone,u.email,u.role,u.language,u.is_active,u.created_at,u.must_change_password
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
    const { name, email, language, is_active, password } = req.body;
    const sets = []; const p = [];
    if (name !== undefined)      { p.push(name);      sets.push(`name=$${p.length}`); }
    if (email !== undefined)     { p.push(email);     sets.push(`email=$${p.length}`); }
    if (language !== undefined)  { p.push(language);  sets.push(`language=$${p.length}`); }
    if (is_active !== undefined) { p.push(is_active); sets.push(`is_active=$${p.length}`); }
    if (password)                { p.push(await bcrypt.hash(password,12)); sets.push(`password_hash=$${p.length}`); }
    if (req.body.corporate_id !== undefined){ p.push(req.body.corporate_id); sets.push(`corporate_id=$${p.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    p.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${p.length} RETURNING id,name,phone,email,role,language,is_active`,
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

module.exports = router;
