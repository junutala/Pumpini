// src/routes/templates.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { clearPermCache } = require('../middleware/permissions');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');

// GET /api/templates?station_id=
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
      WHERE rt.station_id = $1
      GROUP BY rt.id ORDER BY rt.is_system DESC, rt.name`,
      [station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/templates — create new template
router.post('/', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, name, description, permissions = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO role_templates(station_id,name,description,created_by)
         VALUES($1,$2,$3,$4) RETURNING *`,
        [station_id, name, description, req.user.id]
      );
      const tmpl = rows[0];
      for (const perm of permissions) {
        await client.query(
          'INSERT INTO template_permissions(template_id,module_code) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [tmpl.id, perm]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ ...tmpl, permissions });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// PUT /api/templates/:id — update template & permissions
router.put('/:id', authenticate, authorize('owner','manager'), requireStationVia('SELECT station_id FROM role_templates WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { name, description, permissions = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE role_templates SET name=$1,description=$2 WHERE id=$3 AND is_system=FALSE RETURNING *`,
        [name, description, req.params.id]
      );
      if (!rows.length) return res.status(403).json({ error: 'Cannot edit system templates' });
      await client.query('DELETE FROM template_permissions WHERE template_id=$1', [req.params.id]);
      for (const perm of permissions) {
        await client.query(
          'INSERT INTO template_permissions(template_id,module_code) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [req.params.id, perm]
        );
      }
      await client.query('COMMIT');
      res.json({ ...rows[0], permissions });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// DELETE /api/templates/:id
router.delete('/:id', authenticate, authorize('owner'), requireStationVia('SELECT station_id FROM role_templates WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM role_templates WHERE id=$1 AND is_system=FALSE RETURNING id',
      [req.params.id]
    );
    if (!rows.length) return res.status(403).json({ error: 'Cannot delete system templates' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// GET /api/templates/modules — all available permission modules
router.get('/modules', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM permission_modules ORDER BY category,label');
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/templates/assign — assign template to user
router.post('/assign', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), requireStationVia('SELECT station_id FROM role_templates WHERE id=$1', 'template_id'), async (req, res, next) => {
  try {
    const { user_id, template_id, station_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO user_role_assignments(user_id,template_id,station_id,assigned_by)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(user_id,station_id) DO UPDATE SET template_id=$2,assigned_by=$4,assigned_at=NOW()
       RETURNING *`,
      [user_id, template_id, station_id, req.user.id]
    );
    clearPermCache(user_id, station_id);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/templates/user-permissions?user_id=&station_id=
router.get('/user-permissions', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { user_id, station_id } = req.query;
    const { getUserPermissions } = require('../middleware/permissions');
    const perms = await getUserPermissions(user_id || req.user.id, station_id);
    res.json({ permissions: perms });
  } catch (err) { next(err); }
});

// GET /api/templates/assignments?station_id= — get all user→template assignments for a station
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

module.exports = router;
