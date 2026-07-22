// src/services/stationService.js
//
// THE single writer for `stations` rows. The superadmin "Add outlet" flow and
// the VAWE Lite provisioning webhook both funnel their INSERT through here, so
// which columns get written (and how) can never drift between the two paths.
//
// Guiding principle (CLAUDE.md): ONE backend writer per concept; other flows
// COMPOSE it (pass a transaction `client`) rather than re-implementing the insert.
const pool = require('../db/pool');

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

// Create a stations row. Pass a pg `client` to enlist in an existing transaction
// (the VAWE provisioning path composes one); omit it to run on the pool.
//
//   id           – optional explicit uuid. VAWE Lite passes the uuid embedded in
//                  a DIRECT outlet's "direct:<uuid>" ref so the Pumpini station id
//                  is deterministic (idempotent re-provision). Omit → DB generates.
//   entitlement  – 'pumpini' (default, uncapped) | 'lite' (SO-tile-only ceiling).
async function createStation(
  { id, name, address = null, gst_number = null, oil_company = null, city = null, state = null, entitlement } = {},
  client = pool
) {
  if (!name || !String(name).trim()) throw fail(400, 'Outlet name is required');

  // Explicit-id vs generated-id INSERT. Only include `id` / `entitlement` in the
  // column list when provided so the DB defaults (uuid_generate_v4 / 'pumpini')
  // apply otherwise.
  const cols = ['name', 'address', 'gst_number', 'oil_company', 'city', 'state'];
  const vals = [String(name).trim(), address, gst_number, oil_company, city, state];
  if (id)                     { cols.unshift('id'); vals.unshift(id); }
  if (entitlement != null)    { cols.push('entitlement'); vals.push(entitlement); }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await client.query(
    `INSERT INTO stations(${cols.join(',')}) VALUES(${placeholders}) RETURNING *`,
    vals
  );
  return rows[0];
}

module.exports = { createStation };
