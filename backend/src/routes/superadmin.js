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
    const [groups, stations, users, owners, todaySales, mtdSales] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM owner_groups WHERE is_active=TRUE'),
      pool.query('SELECT COUNT(*)::int AS count FROM stations'),
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active=TRUE'),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role='owner' AND is_active=TRUE"),
      pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM dispense_events WHERE occurred_at::date=CURRENT_DATE AND NOT COALESCE(is_voided,FALSE)'),
      pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM dispense_events WHERE DATE_TRUNC('month',occurred_at)=DATE_TRUNC('month',CURRENT_DATE) AND NOT COALESCE(is_voided,FALSE)"),
    ]);
    res.json({
      total_groups:   groups.rows[0].count,
      total_stations: stations.rows[0].count,
      total_users:    users.rows[0].count,
      total_owners:   owners.rows[0].count,
      today_sales:    todaySales.rows[0].total,
      mtd_sales:      mtdSales.rows[0].total,
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
        array_agg(DISTINCT u.id)   FILTER (WHERE u.role='owner') AS owner_ids,
        (SELECT sg.owner_group_id FROM station_group_members sgm
           JOIN station_groups sg ON sg.id = sgm.station_group_id
          WHERE sgm.station_id = s.id LIMIT 1) AS owner_group_id,
        sub.plan, sub.status AS sub_status, sub.start_date, sub.end_date
      FROM stations s
      LEFT JOIN station_settings ss ON ss.station_id = s.id
      LEFT JOIN station_users su ON su.station_id = s.id
      LEFT JOIN users u ON u.id = su.user_id AND u.role='owner'
      LEFT JOIN LATERAL (
        SELECT plan, status, start_date, end_date
        FROM station_subscriptions
        WHERE station_id = s.id
        ORDER BY (end_date IS NULL) DESC, start_date DESC NULLS LAST
        LIMIT 1
      ) sub ON TRUE
      GROUP BY s.id, ss.gstn, ss.owner_whatsapp, sub.plan, sub.status, sub.start_date, sub.end_date
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
  const { name, address, gst_number, oil_company, city, state, owner_id, owner_group_id } = req.body;
  const sid = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE stations SET
         name=COALESCE($1,name), address=COALESCE($2,address),
         gst_number=COALESCE($3,gst_number), oil_company=COALESCE($4,oil_company),
         city=COALESCE($5,city), state=COALESCE($6,state)
       WHERE id=$7 RETURNING *`,
      [name, address, gst_number, oil_company, city, state, sid]
    );
    // Owner change: swap the OWNER only (leave managers/attendants untouched).
    if (owner_id !== undefined) {
      await client.query(
        `DELETE FROM station_users WHERE station_id=$1
           AND user_id IN (SELECT id FROM users WHERE role='owner')`, [sid]);
      if (owner_id) {
        await client.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [sid, owner_id]);
      }
    }
    // Owner group change: move the bunk to the chosen group (or detach if blank).
    if (owner_group_id !== undefined) {
      await client.query('DELETE FROM station_group_members WHERE station_id=$1', [sid]);
      if (owner_group_id) {
        let { rows: sg } = await client.query('SELECT id FROM station_groups WHERE owner_group_id=$1 LIMIT 1', [owner_group_id]);
        if (!sg.length) {
          const { rows: newSg } = await client.query('INSERT INTO station_groups(owner_group_id,name) VALUES($1,$2) RETURNING id', [owner_group_id, 'Default Group']);
          sg = newSg;
        }
        await client.query('INSERT INTO station_group_members(station_group_id,station_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [sg[0].id, sid]);
      }
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// ── Group ⇄ station links (add/remove bunks to/from an owner group) ──
router.post('/groups/:id/stations', authAdmin, async (req, res, next) => {
  const { station_id } = req.body;
  if (!station_id) return res.status(400).json({ error: 'station_id is required' });
  const gid = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One owner group per bunk — clear any existing link first.
    await client.query('DELETE FROM station_group_members WHERE station_id=$1', [station_id]);
    let { rows: sg } = await client.query('SELECT id FROM station_groups WHERE owner_group_id=$1 LIMIT 1', [gid]);
    if (!sg.length) {
      const { rows: newSg } = await client.query('INSERT INTO station_groups(owner_group_id,name) VALUES($1,$2) RETURNING id', [gid, 'Default Group']);
      sg = newSg;
    }
    await client.query('INSERT INTO station_group_members(station_group_id,station_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [sg[0].id, station_id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

router.delete('/groups/:id/stations/:station_id', authAdmin, async (req, res, next) => {
  try {
    await pool.query(
      `DELETE FROM station_group_members sgm USING station_groups sg
        WHERE sgm.station_group_id = sg.id AND sg.owner_group_id = $1 AND sgm.station_id = $2`,
      [req.params.id, req.params.station_id]);
    res.json({ ok: true });
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
        AND NOT COALESCE(de.is_voided,FALSE)
      LEFT JOIN shifts sh ON sh.station_id=s.id AND sh.date=$2
      WHERE stg.owner_group_id=$1
      GROUP BY s.id ORDER BY s.name`,
      [req.params.id, today]
    );
    res.json(rows);
  } catch (err) { next(err); }
});


// ── Station Subscriptions ─────────────────────────────────
router.get('/station-subscriptions/:station_id', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM station_subscriptions WHERE station_id=$1 ORDER BY start_date DESC`,
      [req.params.station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/station-subscriptions', authAdmin, async (req, res, next) => {
  try {
    const { station_id, plan, status='active', start_date, end_date } = req.body;
    // Close any existing open subscription first
    if (!end_date) {
      await pool.query(
        `UPDATE station_subscriptions SET end_date=CURRENT_DATE-1
         WHERE station_id=$1 AND end_date IS NULL`,
        [station_id]
      );
    }
    const { rows } = await pool.query(
      `INSERT INTO station_subscriptions(station_id,plan,status,start_date,end_date)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [station_id, plan, status, start_date || new Date().toISOString().slice(0,10), end_date||null]
    );
    try { require('../middleware/permissions').clearStationPermCache(station_id); } catch {}
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/station-subscriptions/:id', authAdmin, async (req, res, next) => {
  try {
    const { plan, status, end_date } = req.body;
    const sets=[]; const p=[];
    if (plan!==undefined)     { p.push(plan);     sets.push(`plan=$${p.length}`); }
    if (status!==undefined)   { p.push(status);   sets.push(`status=$${p.length}`); }
    if (end_date!==undefined) { p.push(end_date); sets.push(`end_date=$${p.length}`); }
    if (!sets.length) return res.json({ ok:true });
    p.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE station_subscriptions SET ${sets.join(',')} WHERE id=$${p.length} RETURNING *`, p
    );
    // If end_date was set, auto-create next subscription line
    if (end_date && rows[0]) {
      const nextStart = new Date(end_date);
      nextStart.setDate(nextStart.getDate()+1);
      await pool.query(
        `INSERT INTO station_subscriptions(station_id,plan,status,start_date)
         VALUES($1,$2,'active',$3) ON CONFLICT DO NOTHING`,
        [rows[0].station_id, rows[0].plan, nextStart.toISOString().slice(0,10)]
      );
    }
    if (rows[0]) { try { require('../middleware/permissions').clearStationPermCache(rows[0].station_id); } catch {} }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Group Stations ────────────────────────────────────────
router.get('/groups/:id/stations', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.city, s.state, s.oil_company,
        ss2.plan, ss2.status AS sub_status, ss2.start_date, ss2.end_date
      FROM stations s
      JOIN station_group_members sgm ON sgm.station_id = s.id
      JOIN station_groups stg ON stg.id = sgm.station_group_id
      LEFT JOIN station_subscriptions ss2 ON ss2.station_id=s.id AND ss2.end_date IS NULL
      WHERE stg.owner_group_id=$1
      ORDER BY s.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});


// ── Plans ─────────────────────────────────────────────────
router.get('/plans', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM plans ORDER BY name');
    res.json(rows);
  } catch (err) { next(err); }
});

// Function catalog — the modules a plan can include (and responsibilities grant).
router.get('/modules', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT code, category, label FROM permission_modules ORDER BY category, label');
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Responsibilities (role templates) — admin console ─────
// Mirrors the user-side editor but with admin auth. Writes role_templates +
// template_permissions and user_role_assignments.template_id — exactly what the
// permission resolver (middleware/permissions.js) reads.
router.get('/templates', authAdmin, async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(`
      SELECT rt.id, rt.station_id, rt.name, rt.description, rt.is_system,
        array_agg(tp.module_code ORDER BY tp.module_code) FILTER (WHERE tp.module_code IS NOT NULL) AS permissions,
        COUNT(DISTINCT ura.user_id)::int AS user_count
      FROM role_templates rt
      LEFT JOIN template_permissions tp ON tp.template_id = rt.id
      LEFT JOIN user_role_assignments ura ON ura.template_id = rt.id
      WHERE rt.station_id = $1 OR rt.station_id IS NULL   -- include global system responsibilities
      GROUP BY rt.id ORDER BY rt.is_system DESC, rt.name`, [station_id]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/templates', authAdmin, async (req, res, next) => {
  const { station_id, name, description, permissions = [] } = req.body;
  if (!station_id || !name) return res.status(400).json({ error: 'station_id and name are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO role_templates(station_id,name,description) VALUES($1,$2,$3) RETURNING *`,
      [station_id, name, description || null]);
    for (const perm of permissions) {
      await client.query('INSERT INTO template_permissions(template_id,module_code) VALUES($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, perm]);
    }
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], permissions });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

router.patch('/templates/:id', authAdmin, async (req, res, next) => {
  const { name, description, permissions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE role_templates SET name=COALESCE($1,name), description=COALESCE($2,description)
         WHERE id=$3 AND is_system=FALSE RETURNING *`,
      [name ?? null, description ?? null, req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot edit a system responsibility' }); }
    if (Array.isArray(permissions)) {
      await client.query('DELETE FROM template_permissions WHERE template_id=$1', [req.params.id]);
      for (const perm of permissions) {
        await client.query('INSERT INTO template_permissions(template_id,module_code) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.params.id, perm]);
      }
    }
    await client.query('COMMIT');
    res.json({ ...rows[0], permissions: permissions || [] });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

router.delete('/templates/:id', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM role_templates WHERE id=$1 AND is_system=FALSE RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(403).json({ error: 'Cannot delete a system responsibility' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Assign a responsibility to a user (empty template_id clears it → role default).
router.post('/templates/assign', authAdmin, async (req, res, next) => {
  try {
    const { user_id, template_id, station_id } = req.body;
    if (!user_id || !station_id) return res.status(400).json({ error: 'user_id and station_id are required' });
    if (template_id) {
      await pool.query(
        `INSERT INTO user_role_assignments(user_id,template_id,station_id)
         VALUES($1,$2,$3)
         ON CONFLICT(user_id,station_id) DO UPDATE SET template_id=$2, assigned_at=NOW()`,
        [user_id, template_id, station_id]);
    } else {
      await pool.query('DELETE FROM user_role_assignments WHERE user_id=$1 AND station_id=$2', [user_id, station_id]);
    }
    try { require('../middleware/permissions').clearPermCache(user_id, station_id); } catch {}
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/plans', authAdmin, async (req, res, next) => {
  try {
    const { name, price_per_month, features } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO plans(name, price_per_month, features)
       VALUES($1,$2,$3) ON CONFLICT(name)
       DO UPDATE SET price_per_month=EXCLUDED.price_per_month, features=EXCLUDED.features
       RETURNING *`,
      [name, price_per_month, JSON.stringify(features||[])]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/plans/:id', authAdmin, async (req, res, next) => {
  try {
    const { price_per_month, features } = req.body;
    const { rows } = await pool.query(
      `UPDATE plans SET
         price_per_month=COALESCE($1,price_per_month),
         features=COALESCE($2,features)
       WHERE id=$3 RETURNING *`,
      [price_per_month, features ? JSON.stringify(features) : null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Alert Definitions ─────────────────────────────────────
router.get('/alert-definitions', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alert_definitions ORDER BY created_at');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/alert-definitions', authAdmin, async (req, res, next) => {
  try {
    const { name, description, alert_type, severity='warning', whatsapp_enabled=false, is_active=true } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO alert_definitions(name, description, alert_type, severity, whatsapp_enabled, is_active)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description, alert_type, severity, whatsapp_enabled, is_active]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/alert-definitions/:id', authAdmin, async (req, res, next) => {
  try {
    const { name, description, severity, whatsapp_enabled, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE alert_definitions SET
         name=COALESCE($1,name),
         description=COALESCE($2,description),
         severity=COALESCE($3,severity),
         whatsapp_enabled=COALESCE($4,whatsapp_enabled),
         is_active=COALESCE($5,is_active)
       WHERE id=$6 RETURNING *`,
      [name, description, severity, whatsapp_enabled, is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/alert-definitions/:id', authAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM alert_definitions WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Station Users (for admin panel user management) ───────
router.get('/station-users/:station_id', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.phone, u.email, u.role, u.is_active,
             ura.template_id, rt.name AS template_name
      FROM users u
      JOIN station_users su ON su.user_id = u.id
      LEFT JOIN user_role_assignments ura ON ura.user_id = u.id AND ura.station_id = $1
      LEFT JOIN role_templates rt ON rt.id = ura.template_id
      WHERE su.station_id = $1
      ORDER BY u.role='owner' DESC, u.name`,
      [req.params.station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/station-users', authAdmin, async (req, res, next) => {
  try {
    const { station_id, name, phone, email, role='attendant', password } = req.body;
    const bcrypt = require('bcryptjs');
    const cleanPhone = phone.replace(/\D/g,'');
    const storedPhone = cleanPhone.startsWith('91') ? `+${cleanPhone}` : `+91${cleanPhone}`;
    const hash = await bcrypt.hash(password || 'Welcome@123', 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users(name,phone,email,password_hash,role)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [name, storedPhone, email||null, hash, role]
      );
      await client.query(
        'INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [station_id, rows[0].id]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch(e){ await client.query('ROLLBACK'); throw e; }
    finally{ client.release(); }
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'Phone number already registered' });
    next(err);
  }
});

router.patch('/station-users/:id', authAdmin, async (req, res, next) => {
  try {
    const { name, email, is_active, role, password } = req.body;
    const bcrypt = require('bcryptjs');
    const sets=[]; const p=[];
    if (name!==undefined)      { p.push(name);      sets.push(`name=$${p.length}`); }
    if (email!==undefined)     { p.push(email);     sets.push(`email=$${p.length}`); }
    if (role!==undefined)      { p.push(role);      sets.push(`role=$${p.length}`); }
    if (is_active!==undefined) { p.push(is_active); sets.push(`is_active=$${p.length}`); }
    if (password)              { p.push(await bcrypt.hash(password,12)); sets.push(`password_hash=$${p.length}`); }
    if (!sets.length) return res.json({ok:true});
    p.push(req.params.id);
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${p.length} RETURNING *`, p);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/station-users/:id', authAdmin, async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Leads / Enquiries ─────────────────────────────────────
const LEAD_FIELDS = ['name','station_name','city','state','phone','email','message','source','status','notes'];

router.get('/leads', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { next(err); }
});

// Manual add (owner logging a WhatsApp/personal enquiry)
router.post('/leads', authAdmin, async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'Name and phone are required.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO leads(name, station_name, city, state, phone, email, message, source, status, notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.body.name.trim(), req.body.station_name || null, req.body.city || null, req.body.state || null,
        req.body.phone.trim(), req.body.email || null, req.body.message || null,
        req.body.source || 'website', req.body.status || 'new', req.body.notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/leads/:id', authAdmin, async (req, res, next) => {
  try {
    const sets = [], p = [];
    for (const k of LEAD_FIELDS) {
      if (k in req.body) { p.push(req.body[k]); sets.push(`${k}=$${p.length}`); }
    }
    if (!sets.length) return res.json({ ok: true });
    sets.push('updated_at=NOW()');
    p.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE leads SET ${sets.join(',')} WHERE id=$${p.length} RETURNING *`, p
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/leads/:id', authAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM leads WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, authAdmin };
