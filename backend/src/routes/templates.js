// src/routes/templates.js
//
// 🔒 Responsibility (role-template) MANAGEMENT is platform-admin (/admin) ONLY.
// Access-model cleanup (docs/access-model-cleanup.md, decision 2026-07-22): the
// create / edit / delete / assign routes that used to live here let a tenant
// owner OR manager mint and assign ANY permission set — the privilege-escalation
// gap (§4.4). They are REMOVED. Responsibilities are now authored and assigned
// exclusively by the superadmin console (see superadmin.js `/templates*`, `authAdmin`).
// This file keeps only READ endpoints, so the app can DISPLAY a user's current
// responsibility/assignments (no mutation, no escalation surface).
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');

// GET /api/templates?station_id= — responsibilities visible for a station (read-only)
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(`
      SELECT rt.*,
        array_agg(tp.module_code ORDER BY tp.module_code) FILTER (WHERE tp.module_code IS NOT NULL) AS permissions,
        COUNT(ura.user_id)::int AS user_count
      FROM role_templates rt
      LEFT JOIN template_permissions tp ON tp.template_id = rt.id
      LEFT JOIN user_role_assignments ura ON ura.template_id = rt.id
      WHERE rt.station_id = $1 OR rt.station_id IS NULL
      GROUP BY rt.id ORDER BY rt.is_system DESC, rt.name`,
      [station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/templates/modules — the function catalog (read-only)
router.get('/modules', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM permission_modules ORDER BY category,label');
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/templates/user-permissions?user_id=&station_id= — effective modules (read-only)
router.get('/user-permissions', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { user_id, station_id } = req.query;
    const { getUserPermissions } = require('../middleware/permissions');
    const perms = await getUserPermissions(user_id || req.user.id, station_id);
    res.json({ permissions: perms });
  } catch (err) { next(err); }
});

// GET /api/templates/assignments?station_id= — user→responsibility map for a station (read-only)
router.get('/assignments', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(`
      SELECT ura.user_id, ura.template_id, rt.name AS template_name,
             u.name AS user_name, u.role AS user_role
      FROM user_role_assignments ura
      JOIN role_templates rt ON rt.id = ura.template_id
      JOIN users u ON u.id = ura.user_id
      WHERE ura.station_id = $1`,
      [station_id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// ── REMOVED (moved to /admin, superadmin-only) ────────────────────────────────
// POST   /api/templates          → superadmin.js  POST   /admin/templates
// PUT    /api/templates/:id       → superadmin.js  PATCH  /admin/templates/:id
// DELETE /api/templates/:id       → superadmin.js  DELETE /admin/templates/:id
// POST   /api/templates/assign    → superadmin.js  POST   /admin/templates/assign
// Any tenant call to these now 404s — responsibility CRUD is platform-admin only,
// by design and by intent (owner instruction 2026-07-22).

module.exports = router;
