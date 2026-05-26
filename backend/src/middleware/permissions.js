// src/middleware/permissions.js
const pool = require('../db/pool');

// Cache permissions per user per station for 5 minutes
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getUserPermissions(userId, stationId) {
  const key = `${userId}:${stationId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.perms;

  // Check if user is owner/superadmin — give all permissions
  const { rows: user } = await pool.query('SELECT role FROM users WHERE id=$1', [userId]);
  if (!user.length) return [];

  if (user[0].role === 'owner') {
    const { rows: mods } = await pool.query('SELECT code FROM permission_modules');
    const perms = mods.map(m => m.code);
    cache.set(key, { perms, ts: Date.now() });
    return perms;
  }

  // Get permissions from role template assignment
  const { rows } = await pool.query(`
    SELECT DISTINCT tp.module_code
    FROM user_role_assignments ura
    JOIN template_permissions tp ON tp.template_id = ura.template_id
    WHERE ura.user_id = $1 AND ura.station_id = $2`,
    [userId, stationId]
  );

  // Fallback: if no template assigned, give basic permissions based on role
  let perms = rows.map(r => r.module_code);
  if (!perms.length) {
    const roleDefaults = {
      manager:   ['dashboard.view','shifts.manage','shifts.view','dispense.entry','dispense.view','reconcile.manage','corporate.manage','corporate.view','attendance.manage','dipstick.entry','dipstick.view','reports.view','alerts.view','prices.manage'],
      attendant: ['dashboard.view','dispense.entry','dispense.view','dipstick.entry','dipstick.view','attendance.view'],
      rsa:       ['dashboard.view','dispense.entry','corporate.view'],
      corporate: ['dashboard.view','corporate.view','reports.view'],
    };
    perms = roleDefaults[user[0].role] || ['dashboard.view'];
  }

  cache.set(key, { perms, ts: Date.now() });
  return perms;
}

// Clear cache for a user (call when permissions change)
function clearPermCache(userId, stationId) {
  cache.delete(`${userId}:${stationId}`);
}

// Express middleware: requirePerm('dispense.entry')
const requirePerm = (module) => async (req, res, next) => {
  try {
    const stationId = req.query.station_id || req.body.station_id || req.params.station_id;
    if (!stationId) return next(); // no station context — allow
    const perms = await getUserPermissions(req.user.id, stationId);
    if (!perms.includes(module)) {
      return res.status(403).json({ error: `Permission denied: ${module}` });
    }
    req.userPermissions = perms;
    next();
  } catch (err) { next(err); }
};

module.exports = { getUserPermissions, clearPermCache, requirePerm };
