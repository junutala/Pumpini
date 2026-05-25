// src/routes/auth.js
const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', [
  body('phone').notEmpty(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { phone, password } = req.body;
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone = $1 AND is_active = TRUE', [phone]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Get stations for this user
    const { rows: stations } = await pool.query(
      `SELECT s.id, s.name FROM stations s
       JOIN station_users su ON su.station_id = s.id
       WHERE su.user_id = $1`, [user.id]
    );

    const payload = {
      id: user.id, name: user.name, role: user.role,
      phone: user.phone, language: user.language,
      stations: stations.map(s => s.id),
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    res.json({ token, user: { ...payload, stations } });
  } catch (err) { next(err); }
});

// POST /api/auth/register  (owner-only in production)
router.post('/register', [
  body('name').notEmpty(),
  body('phone').isMobilePhone(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['owner','manager','attendant','rsa','corporate']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, phone, email, password, role, language = 'en' } = req.body;
    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users(name,phone,email,password_hash,role,language)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,name,phone,email,role,language,created_at`,
      [name, phone, email || null, hash, role, language]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Phone or email already exists' });
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,phone,email,role,language,is_active,created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/auth/language
router.patch('/language', authenticate, async (req, res, next) => {
  try {
    const { language } = req.body;
    const supported = ['en','hi','ta','te','kn','mr'];
    if (!supported.includes(language)) return res.status(400).json({ error: 'Unsupported language' });
    await pool.query('UPDATE users SET language=$1 WHERE id=$2', [language, req.user.id]);
    res.json({ language });
  } catch (err) { next(err); }
});

module.exports = router;
