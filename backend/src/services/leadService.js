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

// The appointment column arrives in its own migration, and CLAUDE.md deploy
// ordering means the code lands first. Probed rather than assumed, so an
// interaction still saves — minus its appointment — in that window. A note that
// records the conversation beats one that was refused over a missing column.
const hasAppointmentColumn = schemaProbe(
  'lead_interactions.appointment_at',
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lead_interactions'
      AND column_name='appointment_at'`,
  row => row.n === 1
);

/**
 * An appointment instant, or null. Rejects anything unparseable rather than
 * letting `new Date('next tuesday')` become an Invalid Date that Postgres would
 * then refuse mid-transaction. Also refuses absurd years, which is what a
 * mistyped picker produces (0025, 20250) — a diary entry in the year 25 is not a
 * date, it is a typo, and it would sort to the top of the list forever.
 */
const when = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d.toISOString() : null;
};

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
 * @param {string} [args.appointmentAt]   when the owner agreed to be seen next
 * @param {object} [args.client]          pass a pg client to compose inside an
 *                                        existing transaction; omit to use the pool
 * @returns {Promise<object>} the inserted row
 */
async function addInteraction({ leadId, note, capturedBy, lat, lng, accuracy, appointmentAt, client }) {
  const db   = client || pool;
  const body = text(note, 4000);
  if (!body) throw Object.assign(new Error('An interaction cannot be empty.'), { status: 400 });

  const cols = ['lead_id', 'note', 'captured_by', 'lat', 'lng', 'location_accuracy'];
  const vals = [
    leadId, body, text(capturedBy, 60),
    num(lat, -90, 90), num(lng, -180, 180), num(accuracy, 0, 1_000_000),
  ];

  // Probed BEFORE any transaction the caller may have open — a catalog lookup
  // that failed inside one would abort it and take the interaction down too.
  if (await hasAppointmentColumn()) {
    cols.push('appointment_at');
    vals.push(when(appointmentAt));
  }

  const params = vals.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await db.query(
    `INSERT INTO lead_interactions(${cols.join(',')}) VALUES(${params})
     RETURNING id, lead_id, note, captured_by, lat, lng, location_accuracy, created_at`,
    vals
  );

  // The lead's own updated_at is what the admin list sorts by, so a lead worked
  // on today rises to the front even though its `created_at` is months old.
  await db.query('UPDATE leads SET updated_at=now() WHERE id=$1', [leadId]);

  return rows[0];
}

/** Newest first. Returns [] rather than throwing when the table isn't there yet. */
async function listInteractions(leadId, limit = 200) {
  if (!(await hasInteractionTable())) return [];
  const appt = await hasAppointmentColumn();
  const { rows } = await pool.query(
    `SELECT id, note, captured_by, lat, lng, location_accuracy, created_at,
            ${appt ? 'appointment_at' : 'NULL::timestamptz AS appointment_at'}
       FROM lead_interactions
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [leadId, limit]
  );
  return rows;
}

/**
 * Upcoming appointments, one row per LEAD — the latest one agreed, never a
 * backlog of superseded ones. Rescheduling is just a newer interaction carrying
 * a newer date, so DISTINCT ON the lead by interaction time is what makes the
 * old entry disappear without anybody deleting anything.
 *
 * Past appointments are excluded: the tab answers "where must I be next", and a
 * meeting that has happened is history, still readable in the lead's own log.
 *
 * A lead filed by a refusal CTA has NO owner name and NO mobile — those are
 * exactly the outlets worth an appointment — so `who` falls back to the outlet
 * name off the board, and the phone is simply absent.
 */
async function listAppointments(limit = 500) {
  if (!(await hasInteractionTable()) || !(await hasAppointmentColumn())) return [];
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (l.id)
              l.id            AS lead_id,
              -- Same column NAMES the /leads endpoint returns. They were aliased
              -- to owner_name/outlet_name, which meant one lead arrived in two
              -- shapes depending on which endpoint fetched it — and a screen
              -- written against one shape silently rendered nothing under the
              -- other. One shape, one set of helpers, no guessing.
              l.name,
              l.station_name,
              l.phone,
              l.status,
              l.lat, l.lng,
              i.appointment_at,
              i.note,
              i.captured_by
         FROM lead_interactions i
         JOIN leads l ON l.id = i.lead_id
        WHERE i.appointment_at IS NOT NULL
        ORDER BY l.id, i.created_at DESC
     ) latest
      WHERE appointment_at > now()
      ORDER BY appointment_at
      LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  addInteraction, listInteractions, listAppointments,
  hasInteractionTable, hasAppointmentColumn, num, text, when,
};
