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
    const { rows } = await pool.query(
      'SELECT * FROM superadmins WHERE email=$1 AND is_active=TRUE', [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id:rows[0].id, name:rows[0].name, email:rows[0].email, isSuperAdmin:true },
      process.env.JWT_SECRET + '_admin',
      { expiresIn:'12h' }
    );
    res.json({ token, admin:{ id:rows[0].id, name:rows[0].name, email:rows[0].email } });
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

// ── Owner Groups ──────────────────────────────────────────
router.get('/groups', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT og.*,
        COUNT(DISTINCT ogm.user_id)::int   AS owner_count,
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
    const { name, description, billing_email, plan='trial' } = req.body;
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
    } catch(e){ await client.query('ROLLBACK'); throw e; }
    finally{ client.release(); }
  } catch (err) { next(err); }
});

router.patch('/groups/:id', authAdmin, async (req, res, next) => {
  try {
    const { name, description, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE owner_groups SET
         name=COALESCE($1,name),
         description=COALESCE($2,description),
         is_active=COALESCE($3,is_active)
       WHERE id=$4 RETURNING *`,
      [name, description, is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/groups/:id', authAdmin, async (req, res, next) => {
  try {
    // Soft delete — set end date
    await pool.query('UPDATE owner_groups SET is_active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch (err) { next(err); }
});

// ── Owners ────────────────────────────────────────────────
router.get('/owners', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.*,
        array_agg(DISTINCT og.name) FILTER (WHERE og.name IS NOT NULL) AS groups,
        array_agg(DISTINCT og.id)   FILTER (WHERE og.id   IS NOT NULL) AS group_ids,
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
    // Format phone: accept 10 digits, store as +91XXXXXXXXXX
    const cleanPhone = phone.replace(/\D/g,'');
    const storedPhone = cleanPhone.startsWith('91') ? `+${cleanPhone}` : `+91${cleanPhone}`;
    const hash = await bcrypt.hash(password || 'Welcome@123', 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users(name,phone,email,password_hash,role)
         VALUES($1,$2,$3,$4,'owner') RETURNING *`,
        [name, storedPhone, email||null, hash]
      );
      if (group_id) {
        await client.query(
          'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [group_id, rows[0].id, 'admin']
        );
      }
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch(e){ await client.query('ROLLBACK'); throw e; }
    finally{ client.release(); }
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'Phone number already registered' });
    next(err);
  }
});

router.patch('/owners/:id', authAdmin, async (req, res, next) => {
  try {
    const { name, email, is_active, group_id, password } = req.body;
    const sets=[]; const p=[];
    if (name!==undefined)      { p.push(name);      sets.push(`name=$${p.length}`); }
    if (email!==undefined)     { p.push(email);     sets.push(`email=$${p.length}`); }
    if (is_active!==undefined) { p.push(is_active); sets.push(`is_active=$${p.length}`); }
    if (password)              { p.push(await bcrypt.hash(password,12)); sets.push(`password_hash=$${p.length}`); }
    if (sets.length) {
      p.push(req.params.id);
      await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${p.length}`, p);
    }
    if (group_id) {
      await pool.query(
        'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [group_id, req.params.id, 'member']
      );
    }
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Stations ──────────────────────────────────────────────
router.get('/stations', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
        ss.gstn, ss.owner_whatsapp,
        array_agg(DISTINCT u.name) FILTER (WHERE u.role='owner') AS owners,
        array_agg(DISTINCT u.id)   FILTER (WHERE u.role='owner') AS owner_ids
      FROM stations s
      LEFT JOIN station_settings ss ON ss.station_id = s.id
      LEFT JOIN station_users su ON su.station_id = s.id
      LEFT JOIN users u ON u.id = su.user_id AND u.role='owner'
      GROUP BY s.id, ss.gstn, ss.owner_whatsapp
      ORDER BY s.name`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/stations', authAdmin, async (req, res, next) => {
  try {
    const { name, address, gst_number, oil_company, city, state, owner_id, owner_group_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO stations(name,address,gst_number,oil_company,city,state)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [name, address, gst_number, oil_company, city, state]
      );
      const sid = rows[0].id;
      // Assign owner
      if (owner_id) {
        await client.query(
          'INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [sid, owner_id]
        );
      }
      // Assign to owner group via station_group
      if (owner_group_id) {
        // Create a station group if none exists for this owner group
        let { rows: sg } = await client.query(
          'SELECT id FROM station_groups WHERE owner_group_id=$1 LIMIT 1',
          [owner_group_id]
        );
        if (!sg.length) {
          const { rows: newSg } = await client.query(
            'INSERT INTO station_groups(owner_group_id,name) VALUES($1,$2) RETURNING id',
            [owner_group_id, 'Default Group']
          );
          sg = newSg;
        }
        await client.query(
          'INSERT INTO station_group_members(station_group_id,station_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [sg[0].id, sid]
        );
      }
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch(e){ await client.query('ROLLBACK'); throw e; }
    finally{ client.release(); }
  } catch (err) { next(err); }
});

router.patch('/stations/:id', authAdmin, async (req, res, next) => {
  try {
    const { name, address, gst_number, oil_company, city, state } = req.body;
    const { rows } = await pool.query(
      `UPDATE stations SET
         name=COALESCE($1,name), address=COALESCE($2,address),
         gst_number=COALESCE($3,gst_number), oil_company=COALESCE($4,oil_company),
         city=COALESCE($5,city), state=COALESCE($6,state)
       WHERE id=$7 RETURNING *`,
      [name, address, gst_number, oil_company, city, state, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Group members ─────────────────────────────────────────
router.post('/groups/:id/members', authAdmin, async (req, res, next) => {
  try {
    const { user_id, role='member' } = req.body;
    await pool.query(
      'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, user_id, role]
    );
    res.json({ ok:true });
  } catch (err) { next(err); }
});

// GET /api/superadmin/groups/:id/members-list
router.get('/groups/:id/members-list', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT ogm.user_id, ogm.role, u.name AS owner_name, u.phone, u.email
      FROM owner_group_members ogm
      JOIN users u ON u.id = ogm.user_id
      WHERE ogm.group_id = $1 ORDER BY u.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

router.delete('/groups/:id/members/:user_id', authAdmin, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM owner_group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.id, req.params.user_id]
    );
    res.json({ ok:true });
  } catch (err) { next(err); }
});

// ── Subscriptions ─────────────────────────────────────────
router.patch('/subscriptions/:group_id', authAdmin, async (req, res, next) => {
  try {
    const { plan, status, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE subscriptions SET
         plan=COALESCE($1,plan),
         status=COALESCE($2,status),
         notes=COALESCE($3,notes)
       WHERE owner_group_id=$4 RETURNING *`,
      [plan, status, notes, req.params.group_id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Group dashboard ───────────────────────────────────────
router.get('/groups/:id/dashboard', authAdmin, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.city, s.state,
        COALESCE(SUM(de.amount),0)        AS today_sales,
        COALESCE(SUM(de.quantity_ltrs),0) AS today_litres,
        COUNT(DISTINCT de.id)::int        AS txn_count,
        COUNT(DISTINCT sh.id) FILTER (WHERE sh.status='open')::int AS open_shifts
      FROM stations s
      JOIN station_group_members sgm ON sgm.station_id = s.id
      JOIN station_groups stg ON stg.id = sgm.station_group_id
      LEFT JOIN dispense_events de ON de.station_id=s.id AND de.occurred_at::date=$2
      LEFT JOIN shifts sh ON sh.station_id=s.id AND sh.date=$2
      WHERE stg.owner_group_id=$1
      GROUP BY s.id ORDER BY s.name`,
      [req.params.id, today]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = { router, authAdmin };
