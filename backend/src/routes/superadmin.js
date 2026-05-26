// src/routes/superadmin.js
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');

const authAdmin = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    req.admin = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET + '_admin');
    if (!req.admin.isSuperAdmin) return res.status(403).json({ error: 'Not superadmin' });
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
};

// POST /api/superadmin/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM superadmins WHERE email=$1 AND is_active=TRUE', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: rows[0].id, name: rows[0].name, email: rows[0].email, isSuperAdmin: true },
      process.env.JWT_SECRET + '_admin',
      { expiresIn: '12h' }
    );
    res.json({ token, admin: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  } catch (err) { next(err); }
});

// GET /api/superadmin/platform-stats
router.get('/platform-stats', authAdmin, async (req, res, next) => {
  try {
    const [groups, stations, users, todaySales] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM owner_groups WHERE is_active=TRUE'),
      pool.query('SELECT COUNT(*)::int AS count FROM stations'),
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active=TRUE'),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM dispense_events WHERE occurred_at::date=CURRENT_DATE`),
    ]);
    res.json({
      total_groups:   groups.rows[0].count,
      total_stations: stations.rows[0].count,
      total_users:    users.rows[0].count,
      today_sales:    todaySales.rows[0].total,
    });
  } catch (err) { next(err); }
});

// ── Owner Groups ────────────────────────────────────
router.get('/groups', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT og.*,
        COUNT(DISTINCT ogm.user_id)::int AS owner_count,
        COUNT(DISTINCT sgm.station_id)::int AS station_count,
        s.plan, s.status AS sub_status, s.trial_ends_at
      FROM owner_groups og
      LEFT JOIN owner_group_members ogm ON ogm.group_id = og.id
      LEFT JOIN station_groups stg ON stg.owner_group_id = og.id
      LEFT JOIN station_group_members sgm ON sgm.station_group_id = stg.id
      LEFT JOIN subscriptions s ON s.owner_group_id = og.id
      GROUP BY og.id, s.plan, s.status, s.trial_ends_at
      ORDER BY og.created_at DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/groups', authAdmin, async (req, res, next) => {
  try {
    const { name, description, billing_email, plan = 'trial' } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO owner_groups(name,description,created_by) VALUES($1,$2,$3) RETURNING *`,
        [name, description, req.admin.id]
      );
      await client.query(
        `INSERT INTO subscriptions(owner_group_id,plan,billing_email) VALUES($1,$2,$3)`,
        [rows[0].id, plan, billing_email]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

router.patch('/groups/:id', authAdmin, async (req, res, next) => {
  try {
    const { name, description, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE owner_groups SET name=COALESCE($1,name),description=COALESCE($2,description),is_active=COALESCE($3,is_active) WHERE id=$4 RETURNING *`,
      [name, description, is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Owners ──────────────────────────────────────────
router.get('/owners', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.*, 
        array_agg(DISTINCT og.name) FILTER (WHERE og.name IS NOT NULL) AS groups,
        COUNT(DISTINCT su.station_id)::int AS station_count
      FROM users u
      LEFT JOIN owner_group_members ogm ON ogm.user_id = u.id
      LEFT JOIN owner_groups og ON og.id = ogm.group_id
      LEFT JOIN station_users su ON su.user_id = u.id
      WHERE u.role = 'owner'
      GROUP BY u.id ORDER BY u.name`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/owners', authAdmin, async (req, res, next) => {
  try {
    const { name, phone, email, password, group_id } = req.body;
    const hash = await bcrypt.hash(password || 'Welcome@123', 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users(name,phone,email,password_hash,role) VALUES($1,$2,$3,$4,'owner') RETURNING *`,
        [name, phone, email, hash]
      );
      if (group_id) {
        await client.query(
          'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [group_id, rows[0].id, 'admin']
        );
      }
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Phone or email already exists' });
    next(err);
  }
});

// ── Stations ────────────────────────────────────────
router.get('/stations', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
        ss.gstn, ss.owner_whatsapp,
        array_agg(DISTINCT u.name) FILTER (WHERE u.role='owner') AS owners
      FROM stations s
      LEFT JOIN station_settings ss ON ss.station_id = s.id
      LEFT JOIN station_users su ON su.station_id = s.id
      LEFT JOIN users u ON u.id = su.user_id AND u.role = 'owner'
      GROUP BY s.id, ss.gstn, ss.owner_whatsapp
      ORDER BY s.name`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/stations', authAdmin, async (req, res, next) => {
  try {
    const { name, address, gst_number, oil_company, city, state, owner_id, station_group_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO stations(name,address,gst_number,oil_company,city,state) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [name, address, gst_number, oil_company, city, state]
      );
      if (owner_id) {
        await client.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, owner_id]);
      }
      if (station_group_id) {
        await client.query('INSERT INTO station_group_members(station_group_id,station_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [station_group_id, rows[0].id]);
      }
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ── Add owner to group ──────────────────────────────
router.post('/groups/:id/members', authAdmin, async (req, res, next) => {
  try {
    const { user_id, role = 'member' } = req.body;
    await pool.query(
      'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, user_id, role]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Subscription management ─────────────────────────
router.patch('/subscriptions/:group_id', authAdmin, async (req, res, next) => {
  try {
    const { plan, status, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE subscriptions SET plan=COALESCE($1,plan),status=COALESCE($2,status),notes=COALESCE($3,notes)
       WHERE owner_group_id=$4 RETURNING *`,
      [plan, status, notes, req.params.group_id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Group dashboard data ────────────────────────────
router.get('/groups/:id/dashboard', authAdmin, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const { rows } = await pool.query(`
      SELECT 
        s.id, s.name, s.city, s.state,
        COALESCE(SUM(de.amount),0) AS today_sales,
        COALESCE(SUM(de.quantity_ltrs),0) AS today_litres,
        COUNT(DISTINCT de.id)::int AS txn_count,
        COUNT(DISTINCT sh.id) FILTER (WHERE sh.status='open')::int AS open_shifts
      FROM stations s
      JOIN station_group_members sgm ON sgm.station_id = s.id
      JOIN station_groups stg ON stg.id = sgm.station_group_id
      LEFT JOIN dispense_events de ON de.station_id = s.id AND de.occurred_at::date = $2
      LEFT JOIN shifts sh ON sh.station_id = s.id AND sh.date = $2
      WHERE stg.owner_group_id = $1
      GROUP BY s.id ORDER BY s.name`,
      [req.params.id, today]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = { router, authAdmin };
