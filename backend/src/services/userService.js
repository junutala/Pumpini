// src/services/userService.js
//
// THE single writer for `users` rows. Every path that creates a user — tenant
// staff (POST /users), attendant (POST /users/attendant), and the superadmin
// creators (owners / cco / station-users / attendant seed) — funnels the actual
// INSERT through here, so phone normalization, password hashing, role validation
// and duplicate handling can never drift between callers.
//
// Guiding principle (CLAUDE.md): ONE backend writer per concept; other flows
// COMPOSE it (pass a transaction `client`) rather than re-implementing the insert.
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { normalizePhone, validatePhone } = require('../utils/phone');
const { isValidRole } = require('../config/roles');

// Errors thrown as { status, message } so route handlers can surface them
// verbatim: `catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }`
function fail(status, message) { const e = new Error(message); e.status = status; return e; }

// Create a users row. Pass a pg `client` to enlist in an existing transaction
// (e.g. the RLS-bypass attendant insert); omit it to run on the pool.
async function createUser(
  { name, phone, email, password, role, language = 'en', mustChangePassword = false },
  client = pool
) {
  if (!name || !String(name).trim())          throw fail(400, 'Name is required');
  if (!phone || !validatePhone(phone))         throw fail(400, 'Enter a valid 10-digit Indian mobile number');
  if (!role || !isValidRole(role))             throw fail(400, 'A valid role is required');
  if (!password || String(password).length < 6) throw fail(400, 'Password must be at least 6 characters');

  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await client.query(
      `INSERT INTO users(name,phone,email,password_hash,role,language,must_change_password)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,name,phone,email,role,language,is_active,created_at`,
      [String(name).trim(), normalizePhone(phone), email || null, hash, role, language, !!mustChangePassword]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') throw fail(409, 'This mobile number is already registered.');
    throw e;
  }
}

// Link a user to a station (membership). Idempotent.
async function linkUserToStation(stationId, userId, client = pool) {
  await client.query(
    'INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [stationId, userId]
  );
}

module.exports = { createUser, linkUserToStation };
