const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { station_id, role } = req.query;
    let q = `SELECT u.id,u.name,u.phone,u.email,u.role,u.language,u.is_active,u.created_at
             FROM users u`;
    const p = [];
    if (station_id) {
      p.push(station_id);
      q += ` JOIN station_users su ON su.user_id=u.id WHERE su.station_id=$${p.length}`;
      if (role) { p.push(role); q += ` AND u.role=$${p.length}`; }
    } else if (role) {
      p.push(role); q += ` WHERE u.role=$${p.length}`;
    }
    q += ' ORDER BY u.name';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { name, email, language, is_active, password } = req.body;
    const sets = []; const p = [];
    if (name !== undefined)      { p.push(name);      sets.push(`name=$${p.length}`); }
    if (email !== undefined)     { p.push(email);     sets.push(`email=$${p.length}`); }
    if (language !== undefined)  { p.push(language);  sets.push(`language=$${p.length}`); }
    if (is_active !== undefined) { p.push(is_active); sets.push(`is_active=$${p.length}`); }
    if (password)                { p.push(await bcrypt.hash(password,12)); sets.push(`password_hash=$${p.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    p.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${p.length} RETURNING id,name,phone,email,role,language,is_active`,
      p
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
