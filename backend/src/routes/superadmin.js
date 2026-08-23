// src/routes/superadmin.js
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { MANAGER_LITE_MODULES, MANAGER_LITE_DESCRIPTION } = require('../config/responsibilities');
// Role-affinity guardrails (docs/access-model-cleanup.md §10.2): even the admin
// console cannot assign a role-locked module to the wrong role (e.g. POS to a
// manager, Group Dashboard to a non-owner). Enforced at ASSIGN time, where the
// target user's role is known.
const { moduleAllowedForRole, MODULE_ROLE_AFFINITY } = require('../config/roles');
// THE Indian-mobile normalizer (utils/phone) — so signing in by mobile accepts
// the same shapes every other phone field in Pumpini does.
const { normalizePhone, validatePhone } = require('../utils/phone');
// Single user-writer (one insert path for every creator — tenant + admin).
const { createUser, linkUserToStation } = require('../services/userService');
// One writer for a lead interaction — shared with the public field tool
// (routes/leads.js). Same table and validation; only the guard differs.
const { addInteraction, listInteractions, listAppointments, hasInteractionTable } = require('../services/leadService');
// Shared Supabase Storage uploader (one-writer rule) — used by the base64→bucket
// backfill below. Degrades safely: the backfill 400s if storage isn't configured.
const { storageConfigured, uploadDocumentBase64, downloadDocument } = require('../services/vaweStorage');
// Retired multi-tier plans map to the binary access ceiling: only 'lite' caps to
// the SO tile; everything else is uncapped 'pumpini'. Keeps the admin Plan toggle
// as the thing that actually drives `stations.entitlement` (the real gate).
const planToEntitlement = (plan) => (String(plan || '').toLowerCase().includes('lite') ? 'lite' : 'pumpini');

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
//
// Accepts EITHER the email or the mobile number as the identifier, against the
// one `superadmins` store. The mobile path exists so the owner can sign in on
// pumpini.in/lead one-handed in the field without a second user type, a second
// credential store, or a second login writer — the thing that would have been
// "leadadmin" is this OR.
//
// The password is still a real password. A browse-everything screen cannot be
// guarded by a phone number, which is not a secret.
//
// `email` stays the field name for backwards compatibility (the /admin login
// screen posts it); `identifier` is the honest name and wins when both appear.
router.post('/login', async (req, res, next) => {
  try {
    const { password } = req.body;
    const identifier = String(req.body.identifier || req.body.email || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required.' });
    }

    // Only offer a phone to the query when the input actually IS one. Otherwise
    // normalizePhone('contact@sixera.in') reduces to the literal '+91' and would
    // be compared against every row — NULL simply never matches.
    const asPhone = validatePhone(identifier) ? normalizePhone(identifier) : null;

    const { rows } = await pool.query(
      `SELECT * FROM superadmins
        WHERE is_active=TRUE AND (lower(email)=lower($1) OR phone=$2)
        LIMIT 1`,
      [identifier, asPhone]
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

// Resolve the Day Sale day + its platform-wide sales. Default = the most recent
// day with sales on/before yesterday (T-1), so the tile is never a lonely ₹0.
// ?date=YYYY-MM-DD overrides (validated, bound param).
async function resolveDaySale(reqDateRaw) {
  // Resolve the day AND its sales in a single query. Passing the day back as a
  // separate bound param and comparing `occurred_at::date = $1` throws
  // "operator does not exist: date = text" (a text param vs a date). Here the
  // picked day stays a DATE the whole time (explicit ::date cast on the input),
  // so the comparison is date = date and always works.
  const { rows } = await pool.query(`
    WITH picked AS (
      SELECT CASE
               WHEN $1 ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN $1::date
               ELSE COALESCE(
                 (SELECT MAX(occurred_at::date) FROM dispense_events
                  WHERE occurred_at::date <= CURRENT_DATE - 1 AND NOT COALESCE(is_voided,FALSE)),
                 CURRENT_DATE - 1)
             END AS d
    )
    SELECT (SELECT d FROM picked)::text AS day_date,
           COALESCE((SELECT SUM(amount) FROM dispense_events
                     WHERE occurred_at::date = (SELECT d FROM picked)
                       AND NOT COALESCE(is_voided,FALSE)), 0) AS day_sales
  `, [reqDateRaw || null]);
  return { day_date: rows[0].day_date, day_sales: rows[0].day_sales };
}

// GET /api/superadmin/platform-stats  — counts + MTD + the Day Sale figure. The
// day query is isolated in its own try/catch, so a day/picker issue can NEVER
// blank the counts. Accepts ?date to drive the Day Sale tile.
router.get('/platform-stats', authAdmin, async (req, res, next) => {
  try {
    const [groups, stations, users, owners, mtdSales] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM owner_groups WHERE is_active=TRUE'),
      pool.query('SELECT COUNT(*)::int AS count FROM stations'),
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active=TRUE'),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role='owner' AND is_active=TRUE"),
      pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM dispense_events WHERE DATE_TRUNC('month',occurred_at)=DATE_TRUNC('month',CURRENT_DATE) AND NOT COALESCE(is_voided,FALSE)"),
    ]);
    let day = { day_date: null, day_sales: 0 };
    try { day = await resolveDaySale(req.query.date); } catch (e) { /* keep counts even if the day query fails */ }
    res.json({
      total_groups:   groups.rows[0].count,
      total_stations: stations.rows[0].count,
      total_users:    users.rows[0].count,
      total_owners:   owners.rows[0].count,
      day_date:       day.day_date,
      day_sales:      day.day_sales,
      today_sales:    day.day_sales, // alias for older clients
      mtd_sales:      mtdSales.rows[0].total,
    });
  } catch (err) { next(err); }
});

// GET /api/superadmin/day-sales?date=YYYY-MM-DD — the Day Sale figure alone.
router.get('/day-sales', authAdmin, async (req, res, next) => {
  try { res.json(await resolveDaySale(req.query.date)); }
  catch (err) { next(err); }
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
  const { name, phone, email, password, group_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await createUser(
      { name, phone, email, password: password || 'Welcome@123', role: 'owner', mustChangePassword: true },
      client
    );
    if (group_id) {
      await client.query(
        'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [group_id, user.id, 'admin']
      );
    }
    await client.query('COMMIT');
    res.status(201).json(user);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* dead conn */ }
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === '23505') return res.status(409).json({ error: 'Phone number already registered' });
    next(e);
  } finally { client.release(); }
});

// Create a CCO (Central Cash Office) user and attach them to an owner group, so
// they get back-office access to every outlet in that group (via owner_group_members
// → my_stations()). Mirrors /owners but role='cco'. Several can share a group.
router.post('/cco', authAdmin, async (req, res, next) => {
  try {
    const { name, phone, email, password, group_id } = req.body;
    if (!group_id) return res.status(400).json({ error: 'group_id is required.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await createUser(
        { name, phone, email, password: password || 'Welcome@123', role: 'cco', mustChangePassword: true },
        client
      );
      await client.query(
        'INSERT INTO owner_group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [group_id, user.id, 'cco']
      );
      await client.query('COMMIT');
      res.status(201).json(user);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* dead conn */ }
      throw e;
    } finally { client.release(); }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Phone number already registered' });
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

      // Seed the standard 'Manager_lite' responsibility for this bunk so it's
      // ready to assign in /admin (is_system => not editable by a manager).
      const { rows: mlEx } = await client.query(
        `SELECT id FROM role_templates WHERE station_id=$1 AND name='Manager_lite' LIMIT 1`, [sid]);
      if (!mlEx.length) {
        const { rows: ml } = await client.query(
          `INSERT INTO role_templates(station_id,name,description,is_system)
           VALUES($1,'Manager_lite',$2,TRUE)
           RETURNING id`, [sid, MANAGER_LITE_DESCRIPTION]);
        for (const c of MANAGER_LITE_MODULES) {
          await client.query('INSERT INTO template_permissions(template_id,module_code) VALUES($1,$2) ON CONFLICT DO NOTHING', [ml[0].id, c]);
        }
      }

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
    // A3: the plan toggle now DRIVES the real access ceiling. permissions.js gates on
    // stations.entitlement (not station_subscriptions.plan), so keep them in lockstep.
    await pool.query('UPDATE stations SET entitlement=$1 WHERE id=$2', [planToEntitlement(plan), station_id]);
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
    if (rows[0]) {
      // Keep the entitlement ceiling in lockstep with the (possibly changed) plan.
      await pool.query('UPDATE stations SET entitlement=$1 WHERE id=$2', [planToEntitlement(rows[0].plan), rows[0].station_id]);
      try { require('../middleware/permissions').clearStationPermCache(rows[0].station_id); } catch {}
    }
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
      // Role-affinity guardrail: a role-locked module can never be assigned to a
      // user whose role isn't allowed to hold it — even from the admin console.
      const { rows: urows } = await pool.query('SELECT role FROM users WHERE id=$1', [user_id]);
      const role = urows[0]?.role;
      if (role) {
        const { rows: mrows } = await pool.query(
          'SELECT module_code FROM template_permissions WHERE template_id=$1', [template_id]);
        const blocked = mrows
          .map(r => r.module_code)
          .filter(code => MODULE_ROLE_AFFINITY[code] && !moduleAllowedForRole(code, role));
        if (blocked.length) {
          return res.status(422).json({
            error: `This responsibility includes ${blocked.join(', ')}, which cannot be held by a ${role}. ` +
                   `Allowed roles: ${blocked.map(c => `${c} → ${MODULE_ROLE_AFFINITY[c].join('/')}`).join('; ')}.`,
          });
        }
      }
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
  const { station_id, name, phone, email, role = 'attendant', password } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // must_change_password=TRUE: admin sets a starter password; the user is
    // forced to set their own on first login (same as after Reset PW).
    const user = await createUser(
      { name, phone, email, password: password || 'Welcome@123', role, mustChangePassword: true },
      client
    );
    await linkUserToStation(station_id, user.id, client);
    await client.query('COMMIT');
    res.status(201).json(user);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* dead conn */ }
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === '23505') return res.status(409).json({ error: 'Phone number already registered' });
    next(e);
  } finally { client.release(); }
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

// ── Go-live seeding: Credit customers + opening balances ──────────────────
// Superadmin-only fast lane for go-live. Runs on the BYPASSRLS owner role (no
// req.user identity), so RLS does not apply. The manager keeps his own
// credit-customer screen untouched — this is purely additive.
const obInvoiceNo = corpId => `OB-${String(corpId).slice(0, 8)}`;

router.get('/credit-customers/:station_id', authAdmin, async (req, res, next) => {
  try {
    const sid = req.params.station_id;
    const { rows } = await pool.query(`
      SELECT ca.id, ca.company_name, ca.contact_phone,
        COALESCE((SELECT SUM(gi.total_amount) FROM gst_invoices gi
                  WHERE gi.corporate_id=ca.id AND gi.station_id=$1),0)
      - COALESCE((SELECT SUM(cr.amount) FROM corporate_receipts cr
                  WHERE cr.corporate_id=ca.id AND cr.station_id=$1),0) AS outstanding
      FROM corporate_accounts ca
      JOIN corporate_station_links csl ON csl.corporate_id=ca.id AND csl.station_id=$1
      WHERE COALESCE(ca.is_active,TRUE)=TRUE
      ORDER BY ca.company_name`, [sid]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Bulk add credit customers (grid). body: { station_id, rows:[{company_name, contact_phone, opening_balance}] }
router.post('/credit-customers', authAdmin, async (req, res, next) => {
  const { station_id, rows: items = [] } = req.body;
  if (!station_id) return res.status(400).json({ error: 'station_id is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const it of items) {
      const name = (it.company_name || '').trim();
      if (!name) continue;
      const digits = (it.contact_phone || '').replace(/\D/g, '');
      const phone  = digits ? (digits.startsWith('91') ? `+${digits}` : `+91${digits}`) : null;
      const ob = Math.round(Number(it.opening_balance || 0) * 100) / 100;

      // Dedupe within the outlet on mobile (optional field — only when given).
      let corpId = null;
      if (phone) {
        const { rows: ex } = await client.query(
          `SELECT ca.id FROM corporate_accounts ca
           JOIN corporate_station_links csl ON csl.corporate_id=ca.id
           WHERE csl.station_id=$1 AND ca.contact_phone=$2 LIMIT 1`, [station_id, phone]);
        if (ex.length) corpId = ex[0].id;
      }
      if (!corpId) {
        // A5: the per-outlet credit limit lives on corporate_station_links (what the
        // reads use); the vestigial corporate_accounts.credit_limit (read nowhere) is
        // no longer written, so tenant + admin agree on ONE column. Manager raises the
        // link limit later, like GSTN.
        const { rows: c } = await client.query(
          `INSERT INTO corporate_accounts(company_name, contact_phone)
           VALUES($1,$2) RETURNING id`, [name, phone]);
        corpId = c[0].id;
      }
      // Link to the outlet (idempotent without relying on a constraint name).
      const { rows: lk } = await client.query(
        `SELECT 1 FROM corporate_station_links WHERE corporate_id=$1 AND station_id=$2 LIMIT 1`,
        [corpId, station_id]);
      if (!lk.length) {
        await client.query(
          `INSERT INTO corporate_station_links(corporate_id, station_id) VALUES($1,$2)`,
          [corpId, station_id]);
      }
      // Opening balance = a per-station opening receivable (gst_invoice, no GST,
      // NO credit-suspense drawdown). created_by is NULL — a superadmin id is not
      // a users row. Idempotent per (corp, station) via the OB-<corp8> number.
      if (ob > 0) {
        const invNo = obInvoiceNo(corpId);
        const { rows: exInv } = await client.query(
          `SELECT id FROM gst_invoices WHERE station_id=$1 AND corporate_id=$2 AND invoice_number=$3 LIMIT 1`,
          [station_id, corpId, invNo]);
        const li = JSON.stringify([{ description: 'Opening balance as on go-live', amount: ob }]);
        if (exInv.length) {
          await client.query(
            `UPDATE gst_invoices SET subtotal=$1, total_amount=$1, line_items=$2 WHERE id=$3`,
            [ob, li, exInv[0].id]);
        } else {
          await client.query(
            `INSERT INTO gst_invoices(station_id, corporate_id, invoice_number, invoice_date,
               period_from, period_to, subtotal, cgst_rate, sgst_rate, cgst_amount, sgst_amount,
               total_amount, line_items, created_by)
             VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE,CURRENT_DATE,$4,0,0,0,0,$4,$5,NULL)`,
            [station_id, corpId, invNo, ob, li]);
        }
      }
      created.push({ id: corpId, company_name: name });
    }
    await client.query('COMMIT');
    res.status(201).json({ created });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// Remove a seeded credit customer's outlet link + its opening balance (typo fix).
// Keeps the customer record if it has activity elsewhere; never deletes if real
// invoices/receipts exist beyond the OB row.
router.delete('/credit-customers/:corporate_id', authAdmin, async (req, res, next) => {
  const { station_id } = req.query;
  const corpId = req.params.corporate_id;
  if (!station_id) return res.status(400).json({ error: 'station_id is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM gst_invoices WHERE station_id=$1 AND corporate_id=$2 AND invoice_number=$3`,
      [station_id, corpId, obInvoiceNo(corpId)]);
    const { rows: other } = await client.query(
      `SELECT 1 FROM gst_invoices WHERE corporate_id=$1
       UNION ALL SELECT 1 FROM corporate_receipts WHERE corporate_id=$1 LIMIT 1`, [corpId]);
    await client.query(`DELETE FROM corporate_station_links WHERE corporate_id=$1 AND station_id=$2`,
      [corpId, station_id]);
    if (!other.length) {
      const { rows: links } = await client.query(
        `SELECT 1 FROM corporate_station_links WHERE corporate_id=$1 LIMIT 1`, [corpId]);
      if (!links.length) await client.query(`DELETE FROM corporate_accounts WHERE id=$1`, [corpId]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// ── Go-live seeding: Attendants (name + mobile grid) ──────────────────────
router.get('/attendants/:station_id', authAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.phone, u.is_active, u.end_date
      FROM users u
      JOIN station_users su ON su.user_id=u.id
      WHERE su.station_id=$1 AND u.role='attendant'
      ORDER BY COALESCE(u.is_active,TRUE) DESC, u.name`, [req.params.station_id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Bulk add attendants. body: { station_id, rows:[{name, phone}] }. Mobile is
// mandatory + the unique key — re-entering an existing number links, not dupes.
router.post('/attendants', authAdmin, async (req, res, next) => {
  const { station_id, rows: items = [] } = req.body;
  if (!station_id) return res.status(400).json({ error: 'station_id is required' });
  const bcrypt = require('bcryptjs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const it of items) {
      const name   = (it.name || '').trim();
      const digits = (it.phone || '').replace(/\D/g, '');
      if (!name || !digits) continue;   // both required for attendants
      const phone = digits.startsWith('91') ? `+${digits}` : `+91${digits}`;
      let { rows: ex } = await client.query('SELECT id FROM users WHERE phone=$1 LIMIT 1', [phone]);
      let uid;
      if (ex.length) {
        uid = ex[0].id;
        await client.query(`UPDATE users SET is_active=TRUE, end_date=NULL WHERE id=$1`, [uid]);
      } else {
        const u = await createUser(
          { name, phone, password: 'Welcome@123', role: 'attendant', mustChangePassword: true },
          client
        );
        uid = u.id;
      }
      await linkUserToStation(station_id, uid, client);
      created.push({ id: uid, name, phone });
    }
    await client.query('COMMIT');
    res.status(201).json({ created });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

// End-date / reactivate an attendant. body: { end_date } (date → leaves, drops
// from the shift picker) or { end_date:null } (reactivate).
router.patch('/attendants/:id', authAdmin, async (req, res, next) => {
  try {
    const ending = req.body.end_date != null && req.body.end_date !== '';
    const { rows } = await pool.query(
      `UPDATE users SET end_date=$1, is_active=$2 WHERE id=$3 AND role='attendant'
       RETURNING id,name,phone,is_active,end_date`,
      [ending ? req.body.end_date : null, !ending, req.params.id]);
    res.json(rows[0] || { ok: true });
  } catch (err) { next(err); }
});

// ── Leads / Enquiries ─────────────────────────────────────
const LEAD_FIELDS = ['name','station_name','city','state','phone','email','message','source','status','notes'];

router.get('/leads', authAdmin, async (req, res, next) => {
  try {
    // The interaction count rides along so the Leads screen can show it without
    // a request per row. Guarded by the same probe the writer uses: until the
    // lead_interactions DDL is run this endpoint must keep working (a JOIN on a
    // missing table would 500 the whole Leads tab, not degrade it).
    const logOk = await hasInteractionTable();
    const { rows } = await pool.query(
      logOk
        ? `SELECT l.*,
                  COALESCE(i.n, 0)::int AS interaction_count,
                  i.last_at             AS last_interaction_at
             FROM leads l
             LEFT JOIN (
               SELECT lead_id, count(*) AS n, max(created_at) AS last_at
                 FROM lead_interactions GROUP BY lead_id
             ) i ON i.lead_id = l.id
            ORDER BY l.created_at DESC`
        : `SELECT *, 0 AS interaction_count, NULL AS last_interaction_at
             FROM leads ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Appointments ──────────────────────────────────────────
// Everything the owner has agreed to attend, soonest first, past ones dropped.
// Derived from the interaction log rather than stored twice: the appointment is
// a fact about the conversation that set it, so the newest one simply wins.
router.get('/appointments', authAdmin, async (req, res, next) => {
  try {
    res.json({ appointments: await listAppointments() });
  } catch (err) { next(err); }
});

// ── Lead interactions ─────────────────────────────────────
// The owner's side of the field tool: /lead writes the first interaction, this
// is where a lead gets worked into the funnel one visit at a time. Both go
// through leadService.addInteraction — same table, same validation, different
// guard (authAdmin here, open there).
router.get('/leads/:id/interactions', authAdmin, async (req, res, next) => {
  try {
    res.json({ interactions: await listInteractions(req.params.id) });
  } catch (err) { next(err); }
});

router.post('/leads/:id/interactions', authAdmin, async (req, res, next) => {
  try {
    if (!(await hasInteractionTable())) {
      return res.status(503).json({
        error: 'The interaction log table is not created yet. Run the lead_interactions DDL first — nothing was saved.',
      });
    }
    const { rows } = await pool.query('SELECT id FROM leads WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found.' });

    const interaction = await addInteraction({
      leadId:     req.params.id,
      note:       req.body.note,
      // Who logged it, for a log that will later hold both the owner's visits
      // and a temp's cold calls. Falls back to the admin's own name.
      capturedBy: req.body.captured_by || req.admin?.name || 'admin',
      lat:        req.body.lat,
      lng:        req.body.lng,
      accuracy:   req.body.location_accuracy,
      appointmentAt: req.body.appointment_at,
    });
    res.status(201).json({ ok: true, interaction });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Base64 → object-storage BACKFILL (superadmin-only, gated, batched, resumable).
//
// Walks rows that still hold a base64 blob but no storage_path, uploads the bytes
// to the private doc bucket, and writes the path. Idempotent (only touches rows
// with storage_path IS NULL) and resumable (call repeatedly with ?limit=N until
// remaining hits 0). It does NOT clear the base64 column — dropping that is a
// separate, later, owner-gated step once every row is confirmed migrated.
//
// Table/column names are server constants (never request input) — no injection.
// ─────────────────────────────────────────────────────────────────────────────
async function runBackfill({ table, blobCol, scopeCol, prefix, limit, res, orderCol = 'created_at' }) {
  if (!storageConfigured()) {
    return res.status(400).json({ error: 'Object storage not configured (SUPABASE_* env missing).' });
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, ${scopeCol} AS scope, ${blobCol} AS blob, media_type
         FROM ${table}
        WHERE storage_path IS NULL AND ${blobCol} IS NOT NULL
        ORDER BY ${orderCol} ASC
        LIMIT $1`, [lim]));
  } catch (e) {
    if (e.code === '42703') {
      return res.status(400).json({ error: `Add the storage_path column to ${table} first (run the DDL).` });
    }
    throw e;
  }
  let processed = 0;
  const errors = [];
  for (const r of rows) {
    try {
      const mt = r.media_type || 'application/octet-stream';
      const path = await uploadDocumentBase64({
        prefix, scope: r.scope, base64: r.blob, contentType: mt,
        filename: mt === 'application/pdf' ? 'doc.pdf' : 'doc.jpg',
      });
      await pool.query(`UPDATE ${table} SET storage_path=$1 WHERE id=$2 AND storage_path IS NULL`, [path, r.id]);
      processed++;
    } catch (e) {
      errors.push({ id: r.id, error: String(e.message || e).slice(0, 200) });
    }
  }
  const { rows: rem } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE storage_path IS NULL AND ${blobCol} IS NOT NULL`);
  res.json({ table, processed, errored: errors.length, remaining: rem[0].n, errors });
}

// POST /api/superadmin/backfill/delivery-invoices?limit=25
// ─────────────────────────────────────────────────────────────────────────────
// PRUNE — drop the inline copy, but only after proving the bucket copy is good.
//
// runBackfill deliberately leaves file_base64 in place: it uploads and records the
// path, so for a while a row has TWO copies. That is the safe half. This is the
// other half, and it is the only irreversible step in the whole exercise — once the
// base64 is gone the object in the bucket is the sole copy of that photograph.
//
// So it is never taken on trust. For every row: download what was actually stored,
// compare it byte for byte against the base64 we are about to delete, and clear the
// column ONLY on an exact match. A row that fails to download, or comes back
// different, is reported and LEFT COMPLETELY ALONE. The worst outcome is that some
// rows keep both copies — never that a photograph stops existing.
//
// Table/column names are server constants (never request input) — no injection.
// ─────────────────────────────────────────────────────────────────────────────
async function runPrune({ table, blobCol, limit, res }) {
  if (!storageConfigured()) {
    return res.status(400).json({ error: 'Object storage not configured (SUPABASE_* env missing).' });
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const { rows } = await pool.query(
    `SELECT id, storage_path FROM ${table}
      WHERE storage_path IS NOT NULL AND ${blobCol} IS NOT NULL
      LIMIT $1`, [lim]);

  let pruned = 0, freed = 0;
  const errors = [];
  for (const r of rows) {
    try {
      // One row's bytes at a time — a 100-row batch must never hold 100 images.
      const { rows: [full] } = await pool.query(
        `SELECT ${blobCol} AS blob FROM ${table} WHERE id = $1`, [r.id]);
      if (!full || !full.blob) continue;

      const stored = (await downloadDocument(r.storage_path)).toString('base64');
      if (stored !== full.blob) {
        errors.push({ id: r.id, error: 'bucket copy differs from the inline bytes — left untouched' });
        continue;
      }
      await pool.query(`UPDATE ${table} SET ${blobCol} = NULL WHERE id = $1`, [r.id]);
      pruned++; freed += full.blob.length;
    } catch (e) {
      errors.push({ id: r.id, error: String(e.message || e).slice(0, 200) });
    }
  }
  const { rows: rem } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE storage_path IS NOT NULL AND ${blobCol} IS NOT NULL`);
  res.json({ table, pruned, errored: errors.length, remaining: rem[0].n,
             freed_mb: +(freed / 1024 / 1024).toFixed(2), errors });
}

router.post('/prune-inline/station-artifacts', authAdmin, async (req, res, next) => {
  try { await runPrune({ table: 'station_artifacts', blobCol: 'file_base64', limit: req.query.limit, res }); }
  catch (err) { next(err); }
});

router.post('/prune-inline/delivery-invoices', authAdmin, async (req, res, next) => {
  try { await runPrune({ table: 'delivery_invoices', blobCol: 'file_base64', limit: req.query.limit, res }); }
  catch (err) { next(err); }
});

router.post('/prune-inline/meter-photos', authAdmin, async (req, res, next) => {
  try { await runPrune({ table: 'meter_photos', blobCol: 'image_base64', limit: req.query.limit, res }); }
  catch (err) { next(err); }
});

router.post('/backfill/delivery-invoices', authAdmin, async (req, res, next) => {
  try {
    await runBackfill({ table: 'delivery_invoices', blobCol: 'file_base64', scopeCol: 'station_id', prefix: 'delivery-invoices', limit: req.query.limit, res });
  } catch (err) { next(err); }
});

// POST /api/superadmin/backfill/meter-photos?limit=25
// station_artifacts — the slips, gauge screens, coupons and staff photographs.
// The other two tables were backfilled through this same helper long ago;
// station_artifacts was simply never given a route, which is why it stood at 0 of 31
// in the bucket on 20-Aug-2026 while delivery_invoices was 78 of 78 and meter_photos
// 39 of 39. Ordered by captured_at — this table has no created_at, and naming a
// column it does not have would 42703 the whole run.
router.post('/backfill/station-artifacts', authAdmin, async (req, res, next) => {
  try {
    await runBackfill({ table: 'station_artifacts', blobCol: 'file_base64', scopeCol: 'station_id',
                        prefix: 'artifacts', limit: req.query.limit, res, orderCol: 'captured_at' });
  } catch (err) { next(err); }
});

router.post('/backfill/meter-photos', authAdmin, async (req, res, next) => {
  try {
    await runBackfill({ table: 'meter_photos', blobCol: 'image_base64', scopeCol: 'shift_id', prefix: 'meter-photos', limit: req.query.limit, res });
  } catch (err) { next(err); }
});

module.exports = { router, authAdmin };
