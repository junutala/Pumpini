// src/services/leadService.js
//
// ONE writer for a lead interaction (CLAUDE.md "one writer per concept").
//
// Two trust boundaries reach an interaction and they must not grow two copies of
// the insert:
//   • routes/leads.js       — public, unauthenticated. A field temp filing a cold
//                             lead at pumpini.in/lead; writes the FIRST interaction
//                             inside the same transaction as the lead itself.
//   • routes/superadmin.js  — authAdmin. The owner working a lead into the funnel,
//                             adding a visit at a time from the /admin Leads screen.
// Same table, same columns, same validation. Only the guard differs.
const pool = require('../db/pool');
const { schemaProbe } = require('../utils/schemaProbe');

// ── Table tolerance ──────────────────────────────────────────────────────────
// CLAUDE.md deploy ordering: code reaches Railway before the owner runs the DDL,
// so a "no" here is often just "not yet". schemaProbe latches a YES and expires a
// NO, so the log lights up on its own once the DDL runs — no redeploy needed.
const hasInteractionTable = schemaProbe(
  'lead_interactions',
  `SELECT to_regclass('public.lead_interactions') IS NOT NULL AS ok`,
  row => row.ok === true
);

/** Finite number inside [min,max], else null. Rejects NaN, '', Infinity, junk. */
const num = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const text = (v, len) => (v ? String(v).trim().slice(0, len) : null);

/**
 * Log one interaction against a lead. THE insert — every caller comes here.
 *
 * @param {object} args
 * @param {string} args.leadId
 * @param {string} args.note              required; trimmed and capped
 * @param {string} [args.capturedBy]      the mobile (field tool) or admin name
 * @param {number} [args.lat] [args.lng] [args.accuracy]
 * @param {object} [args.client]          pass a pg client to compose inside an
 *                                        existing transaction; omit to use the pool
 * @returns {Promise<object>} the inserted row
 */
async function addInteraction({ leadId, note, capturedBy, lat, lng, accuracy, client }) {
  const db   = client || pool;
  const body = text(note, 4000);
  if (!body) throw Object.assign(new Error('An interaction cannot be empty.'), { status: 400 });

  const { rows } = await db.query(
    `INSERT INTO lead_interactions(lead_id, note, captured_by, lat, lng, location_accuracy)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING id, lead_id, note, captured_by, lat, lng, location_accuracy, created_at`,
    [
      leadId, body, text(capturedBy, 60),
      num(lat, -90, 90), num(lng, -180, 180), num(accuracy, 0, 1_000_000),
    ]
  );

  // The lead's own updated_at is what the admin list sorts by, so a lead worked
  // on today rises to the front even though its `created_at` is months old.
  await db.query('UPDATE leads SET updated_at=now() WHERE id=$1', [leadId]);

  return rows[0];
}

/** Newest first. Returns [] rather than throwing when the table isn't there yet. */
async function listInteractions(leadId, limit = 200) {
  if (!(await hasInteractionTable())) return [];
  const { rows } = await pool.query(
    `SELECT id, note, captured_by, lat, lng, location_accuracy, created_at
       FROM lead_interactions
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [leadId, limit]
  );
  return rows;
}

module.exports = { addInteraction, listInteractions, hasInteractionTable, num, text };
