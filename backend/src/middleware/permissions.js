// src/middleware/permissions.js
// Access model = Plan(outlet) ∩ Responsibility(user), nested.
//   Responsibility = a custom template (user_role_assignments → template_permissions)
//                    or the role default. Owner = the whole catalog.
//   Plan = the outlet's subscription plan's feature modules (the ceiling).
//   Effective = Responsibility ∩ Plan.
// FAIL-OPEN: if the outlet's plan has no recognised module codes (e.g. it still
// holds free-text marketing features, or no subscription), the plan gate is
// inert — today's behaviour. Gating only "switches on" once a plan is configured
// with real module codes via the admin plan editor.
const pool = require('../db/pool');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Role fallbacks (used only when a user has no custom responsibility template).
// Managers keep the features they reached before via the old umbrella perms.
const roleDefaults = {
  manager: [
    'dashboard.view','shifts.manage','shifts.view',
    'dispense.entry','dispense.view','reconcile.manage','reconcile.view',
    'corporate.manage','corporate.view','attendance.manage','attendance.view',
    'dipstick.entry','dipstick.view','reports.view','alerts.view','prices.manage',
    'invoice.generate','deliveries.view',
    // split-out feature modules (were reachable via the umbrellas above)
    'lubes.manage','pettycash.manage','deposits.manage','stock.reconcile','tally.export','ai_chat.use',
  ],
  attendant: [
    'dashboard.view','dispense.entry','dispense.view',
    'dipstick.entry','dipstick.view','attendance.view','shifts.view','ai_chat.use',
  ],
  rsa: [
    'dashboard.view','dispense.entry','dispense.view','corporate.view','shifts.view','ai_chat.use',
  ],
  corporate: [
    'dashboard.view','corporate.view','reports.view','invoice.generate',
  ],
};

// The outlet's plan feature modules, or null if the plan isn't configured with
// recognised module codes (→ fail open).
async function getPlanModules(stationId, catalog) {
  if (!stationId) return null;
  try {
    const { rows: sub } = await pool.query(
      `SELECT plan FROM station_subscriptions
         WHERE station_id=$1 AND COALESCE(status,'active')='active'
           AND (end_date IS NULL OR end_date >= CURRENT_DATE)
         ORDER BY start_date DESC NULLS LAST LIMIT 1`, [stationId]);
    if (!sub.length || !sub[0].plan) return null;
    const { rows: pl } = await pool.query(
      'SELECT features FROM plans WHERE LOWER(name)=LOWER($1) LIMIT 1', [sub[0].plan]);
    if (!pl.length || pl[0].features == null) return null;
    let features = pl[0].features;
    if (typeof features === 'string') { try { features = JSON.parse(features); } catch { return null; } }
    if (!Array.isArray(features)) return null;
    const mods = features.filter(f => catalog.includes(f)); // ignore free-text features
    return mods.length ? mods : null;
  } catch { return null; }
}

async function getUserPermissions(userId, stationId) {
  const key = `${userId}:${stationId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.perms;

  const { rows: user } = await pool.query('SELECT role FROM users WHERE id=$1', [userId]);
  if (!user.length) return [];
  const role = user[0].role;

  const { rows: mods } = await pool.query('SELECT code FROM permission_modules');
  const catalog = mods.map(m => m.code);

  // Responsibility (user-level grant). A responsibility, IF ASSIGNED, applies to
  // everyone — including owners (ownership ≠ access; lets a financial owner be
  // limited to e.g. a dashboard). Otherwise owner = the whole catalog, other
  // roles = their defaults.
  const { rows: tp } = await pool.query(`
    SELECT DISTINCT tp.module_code
    FROM user_role_assignments ura
    JOIN template_permissions tp ON tp.template_id = ura.template_id
    WHERE ura.user_id = $1 AND ura.station_id = $2`, [userId, stationId]);
  let resp;
  if (tp.length)            resp = tp.map(r => r.module_code);
  else if (role === 'owner') resp = catalog;
  else                       resp = roleDefaults[role] || ['dashboard.view'];

  // Plan (outlet ceiling). Effective = Responsibility ∩ Plan.
  const planMods = await getPlanModules(stationId, catalog);
  let perms;
  if (!planMods) {
    // Fail open: preserve today's behaviour until a plan is configured.
    perms = (role === 'owner') ? ['ALL'] : resp;
  } else {
    perms = resp.filter(p => planMods.includes(p)); // …capped by what the outlet's plan includes
  }

  cache.set(key, { perms, ts: Date.now() });
  return perms;
}

function clearPermCache(userId, stationId) {
  cache.delete(`${userId}:${stationId}`);
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}

const requirePerm = (module) => async (req, res, next) => {
  try {
    const stationId = req.query.station_id || req.body.station_id || req.params.station_id;
    if (!stationId) return next();
    const perms = await getUserPermissions(req.user.id, stationId);
    if (!perms.includes('ALL') && !perms.includes(module)) {
      return res.status(403).json({ error: `Permission denied: ${module}` });
    }
    req.userPermissions = perms;
    next();
  } catch (err) { next(err); }
};

module.exports = { getUserPermissions, clearPermCache, requirePerm };
