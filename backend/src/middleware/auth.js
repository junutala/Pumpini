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

// Server-side lockdown: an OPERATOR (role='attendant') token may reach ONLY the
// settlement flow + auth. Every other endpoint is 403 — so a leaked/jailbroken
// operator credential (another browser, a crafted request, a competitor probing
// the API) cannot read outlet data or write anything but their own settlement.
// This is enforced here, at the single auth choke point, independent of the UI.
const ATTENDANT_ALLOW = [
  { m: /.*/,     re: /^\/api\/auth(\/|$)/ },                 // me · logout · change-password · passkey enrol
  { m: /^GET$/,  re: /^\/api\/shifts\/[^/]+$/ },             // their active shift + its detail (to load nozzles)
  { m: /^GET$/,  re: /^\/api\/prices\/[^/]+\/current$/ },    // board rates for amount-due
  { m: /^GET$/,  re: /^\/api\/corporate$/ },                 // credit-customer LOV
  { m: /^GET$/,  re: /^\/api\/stations\/[^/]+\/settings$/ }, // geofence + outlet name
  { m: /^GET$/,  re: /^\/api\/templates\/user-permissions$/ }, // app-shell perms (returns empty for operators)
  { m: /^POST$/, re: /^\/api\/reconcile\/(self-settle|pos-meter)$/ }, // settle own line · scan meter
];
const attendantAllowed = (method, path) =>
  ATTENDANT_ALLOW.some(a => a.m.test(method) && a.re.test(path));

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
    // Operators are hard-locked to the settlement flow at the server, whatever
    // the client. (Managers/owners/others are unaffected.)
    // Normalise a trailing slash — a router's root route (e.g. GET /corporate)
    // resolves to '/api/corporate/', which must still match the allowlist.
    const reqPath = ((req.baseUrl || '') + req.path).replace(/\/+$/, '') || '/';
    if (decoded.role === 'attendant' && !attendantAllowed(req.method, reqPath)) {
      return res.status(403).json({ error: 'Operators can only use the settlement screen.' });
    }
    // Open the RLS identity context (runs the rest of the request on the
    // non-bypass role as this user). Note: everything ABOVE here — JWT verify +
    // getAuthState — deliberately ran on the bypass role, before any identity
    // exists, which is why login/auth keep working.
    return pool.identityMiddleware(req, res, next);
  } catch (err) { next(err); }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, authorize, bumpTokenVersion, clearAuthState };
