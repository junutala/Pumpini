// src/middleware/auth.js
const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

// Cache user auth-state (is_active + token_version) briefly so we don't hit the
// DB on every single request. Logout / password change clear it immediately.
const _cache = new Map(); // userId -> { exists, isActive, tv (number|null), ts }
const TTL = 30 * 1000;

async function getAuthState(userId) {
  const hit = _cache.get(userId);
  if (hit && Date.now() - hit.ts < TTL) return hit;

  let state;
  try {
    const { rows } = await pool.query(
      'SELECT is_active, token_version FROM users WHERE id=$1', [userId]
    );
    state = rows.length
      ? { exists: true, isActive: rows[0].is_active, tv: rows[0].token_version ?? 0 }
      : { exists: false, isActive: false, tv: null };
  } catch {
    // token_version column not migrated yet → fall back to is_active only and
    // SKIP the version check (tv:null) so we never lock everyone out.
    try {
      const { rows } = await pool.query('SELECT is_active FROM users WHERE id=$1', [userId]);
      state = rows.length
        ? { exists: true, isActive: rows[0].is_active, tv: null }
        : { exists: false, isActive: false, tv: null };
    } catch {
      // True DB outage — fail open on state (app is broken anyway); JWT still verified.
      state = { exists: true, isActive: true, tv: null };
    }
  }
  state.ts = Date.now();
  _cache.set(userId, state);
  return state;
}

function clearAuthState(userId) {
  if (userId) _cache.delete(userId);
  else _cache.clear();
}

// Invalidate every existing token for a user (real logout / password change /
// admin force-logout). No-op until the token_version column exists.
async function bumpTokenVersion(userId) {
  try {
    await pool.query(
      'UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=$1', [userId]
    );
  } catch { /* column not migrated yet */ }
  clearAuthState(userId);
}

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  let decoded;
  try {
    decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const state = await getAuthState(decoded.id);
    if (!state.exists || !state.isActive) {
      return res.status(401).json({ error: 'Session no longer valid. Please log in again.' });
    }
    if (state.tv !== null && (decoded.tv ?? 0) !== state.tv) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.user = decoded;
    next();
  } catch (err) { next(err); }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, authorize, bumpTokenVersion, clearAuthState };
