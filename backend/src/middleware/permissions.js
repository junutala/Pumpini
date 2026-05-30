// src/middleware/permissions.js
const pool = require('../db/pool');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getUserPermissions(userId, stationId) {
  const key = `${userId}:${stationId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.perms;

  const { rows: user } = await pool.query(
    'SELECT role FROM users WHERE id=$1', [userId]
  );
  if (!user.length) return [];

  // Owner always gets everything
  if (user[0].role === 'owner') {
    const { rows: mods } = await pool.query('SELECT code FROM permission_modules');
    const perms = mods.map(m => m.code);
    cache.set(key, { perms, ts: Date.now() });
    return perms;
  }

  // PRIORITY 1: Check for custom template assignment
  // Custom template ALWAYS wins over system role
  const { rows: templatePerms } = await pool.query(`
    SELECT DISTINCT tp.module_code
    FROM user_role_assignments ura
    JOIN template_permissions tp ON tp.template_id = ura.template_id
    WHERE ura.user_id = $1 AND ura.station_id = $2`,
    [userId, stationId]
  );

  if (templatePerms.length > 0) {
    // User has a custom template — use ONLY those permissions
    const perms = templatePerms.map(r => r.module_code);
    cache.set(key, { perms, ts: Date.now() });
    return perms;
  }

  // PRIORITY 2: Fall back to system role defaults ONLY if no template assigned
  const roleDefaults = {
    manager:   [
      'dashboard.view','shifts.manage','shifts.view',
      'dispense.entry','dispense.view','reconcile.manage','reconcile.view',
      'corporate.manage','corporate.view','attendance.manage','attendance.view',
      'dipstick.entry','dipstick.view','reports.view','alerts.view','prices.manage',
      'invoice.generate','deliveries.view',
    ],
    attendant: [
      'dashboard.view','dispense.entry','dispense.view',
      'dipstick.entry','dipstick.view','attendance.view','shifts.view',
    ],
    rsa: [
      'dashboard.view','dispense.entry','dispense.view','corporate.view','shifts.view',
    ],
    corporate: [
      'dashboard.view','corporate.view','reports.view','invoice.generate',
    ],
  };

  const perms = roleDefaults[user[0].role] || ['dashboard.view'];
  cache.set(key, { perms, ts: Date.now() });
  return perms;
}

function clearPermCache(userId, stationId) {
  cache.delete(`${userId}:${stationId}`);
  // Also clear all caches for this user across all stations
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

const requirePerm = (module) => async (req, res, next) => {
  try {
    const stationId = req.query.station_id || req.body.station_id || req.params.station_id;
    if (!stationId) return next();
    const perms = await getUserPermissions(req.user.id, stationId);
    if (!perms.includes(module)) {
      return res.status(403).json({ error: `Permission denied: ${module}` });
    }
    req.userPermissions = perms;
    next();
  } catch (err) { next(err); }
};

module.exports = { getUserPermissions, clearPermCache, requirePerm };
