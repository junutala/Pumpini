// src/routes/auth.js
const router  = require('express').Router();
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { authenticate, bumpTokenVersion } = require('../middleware/auth');
const { sendWhatsApp } = require('../services/whatsappService');

// Normalize phone — accept 10 digits, with/without +91, with/without spaces
const normalizePhone = (raw) => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');            // strip everything non-digit
  if (digits.length === 10) return `+91${digits}`;  // plain 10-digit
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`; // 91XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`; // 0XXXXXXXXXX
  return `+91${digits.slice(-10)}`;                 // fallback — take last 10
};

const validatePhone = (raw) => {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 10 ? digits
    : digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0')  ? digits.slice(1)
    : digits.slice(-10);
  return /^[6-9]\d{9}$/.test(ten);
};

// ── Brute-force throttle ────────────────────────────────────
// In-memory sliding window keyed by IP + phone: 10 attempts / 15 min. A wrong
// password at a busy counter never hits this; a script hammering the public
// login does. (Single-instance deploy → in-memory is sufficient.)
const _attempts = new Map(); // key -> [timestamps]
const RL_WINDOW = 15 * 60 * 1000, RL_MAX = 10;
function rateLimitAuth(req, res, next) {
  const key = `${req.ip}|${(req.body?.phone || '').toString().slice(-10)}`;
  const now = Date.now();
  const hits = (_attempts.get(key) || []).filter(t => now - t < RL_WINDOW);
  if (hits.length >= RL_MAX) {
    return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  }
  hits.push(now);
  _attempts.set(key, hits);
  if (_attempts.size > 10000) { // bound memory
    for (const [k, v] of _attempts) if (!v.some(t => now - t < RL_WINDOW)) _attempts.delete(k);
  }
  next();
}

// POST /api/auth/login
router.post('/login', rateLimitAuth, async (req, res, next) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Mobile number and password are required' });
    }

    // Try normalized form first, then fallback variants
    const normalized = normalizePhone(phone);
    const { rows } = await pool.query(
      `SELECT * FROM users
       WHERE (phone = $1 OR phone = $2 OR phone = $3) AND is_active = TRUE
       LIMIT 1`,
      [normalized, phone, phone.replace(/\D/g,'').slice(-10)]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid mobile number or password' });

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid mobile number or password' });

    // Get stations
    const { rows: stations } = await pool.query(
      `SELECT s.id, s.name FROM stations s
       JOIN station_users su ON su.station_id = s.id
       WHERE su.user_id = $1`, [user.id]
    );

    const payload = {
      id: user.id, name: user.name, role: user.role,
      phone: user.phone, language: user.language,
      stations: stations.map(s => s.id),
      corporate_id: user.corporate_id || null,
      must_change_password: user.must_change_password || false,
      tv: user.token_version ?? 0, // session-revocation version
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    res.json({ token, user: { ...payload, stations } });
  } catch (err) { next(err); }
});

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, phone, email, password, role, language = 'en' } = req.body;

    if (!name)     return res.status(400).json({ error: 'Name is required' });
    if (!phone)    return res.status(400).json({ error: 'Mobile number is required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!role)     return res.status(400).json({ error: 'Role is required' });
    if (!validatePhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });

    const normalized = normalizePhone(phone);
    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users(name,phone,email,password_hash,role,language)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,name,phone,email,role,language,created_at`,
      [name, normalized, email||null, hash, role, language]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Mobile number already registered' });
    next(err);
  }
});

// POST /api/auth/logout — server-side session kill (invalidates all this
// user's existing tokens immediately).
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await bumpTokenVersion(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
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


// POST /api/auth/forgot-password — generate temp password, send via WhatsApp
router.post('/forgot-password', rateLimitAuth, async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Mobile number is required' });
    const normalized = normalizePhone(phone);
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE (phone=$1 OR phone=$2) AND is_active=TRUE LIMIT 1',
      [normalized, phone]
    );
    // Always return 200 — don't reveal whether number exists
    if (!rows.length) return res.json({ ok: true });
    const user = rows[0];

    // Generate 8-char alphanumeric temp password
    const tempPw = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. A3F8C2D1
    const hash   = await bcrypt.hash(tempPw, 12);

    await pool.query(
      'UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2',
      [hash, user.id]
    );
    // Invalidate any existing sessions when a reset is issued
    await bumpTokenVersion(user.id);

    const msg = `*Pumpini DMS*\nYour temporary password is: *${tempPw}*\n\nPlease login and change your password immediately.\n\nFor security, this password is valid for one login only.`;
    await sendWhatsApp(user.phone, msg).catch(e => {
      // Log but don't fail — user can still see it in dev demo mode
      require('../utils/logger').warn('WhatsApp send failed:', e.message);
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/change-password — for must_change_password flow
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    // If not a forced-change flow, verify current password
    if (!user.must_change_password) {
      if (!current_password) return res.status(400).json({ error: 'Current password required' });
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query(
      'UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2',
      [hash, req.user.id]
    );
    // Invalidate other existing sessions, then mint a fresh token for THIS
    // session so the user isn't bounced to login right after changing.
    await bumpTokenVersion(req.user.id);
    let tv = 0;
    try {
      const r = await pool.query('SELECT token_version FROM users WHERE id=$1', [req.user.id]);
      tv = r.rows[0]?.token_version ?? 0;
    } catch { /* column not migrated */ }
    const { iat, exp, ...rest } = req.user;
    const token = jwt.sign(
      { ...rest, must_change_password: false, tv },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    res.json({ ok: true, token });
  } catch (err) { next(err); }
});

module.exports = router;
