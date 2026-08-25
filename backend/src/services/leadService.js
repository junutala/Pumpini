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

// Contacts arrive in their own migration; code lands first, so probe.
const hasContactsTable = schemaProbe(
  'lead_contacts',
  `SELECT to_regclass('public.lead_contacts') IS NOT NULL AS ok`,
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

  // EVERY contact rides along, not just the first. Standing outside an outlet you
  // want whichever number answers — the manager who lets you in, or the owner who
  // signs — and choosing between them is a decision for the doorstep, not for a
  // query (owner, 23-Aug-2026: "the diary should show both contacts. with the
  // option to call either of them"). Aggregated in the same round trip rather
  // than a fetch per row.
  const contacts = await hasContactsTable()
    ? `(SELECT coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'phone', c.phone)
                                 ORDER BY c.created_at, c.id), '[]'::json)
          FROM lead_contacts c WHERE c.lead_id = l.id)`
    : `'[]'::json`;

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
              ${contacts} AS contacts,
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

// ── Contacts ─────────────────────────────────────────────────────────────────
//
// A lead is an OUTLET, and an outlet has people: the manager who lets you in,
// the owner who signs. One name/phone pair forces you to lose one to record the
// other — which is exactly what happened on Arcot Road, where the field brought
// back managers and the owners were still to come.
//
// THE ONE WRITER. The public capture route files the contact the field brought;
// the authAdmin route adds the ones the owner gathers later. Same table, same
// validation, different guard.

/** File a contact against a lead. Silently does nothing when there is neither a
 *  name nor a number — a blank contact is not a record of anything. */
async function addContact({ leadId, name, phone, client }) {
  if (!(await hasContactsTable())) return null;
  const nm = text(name, 120);
  const ph = text(phone, 20);
  if (!nm && !ph) return null;

  const db = client || pool;
  const { rows } = await db.query(
    `INSERT INTO lead_contacts(lead_id, name, phone) VALUES($1,$2,$3)
     RETURNING id, lead_id, name, phone, created_at`,
    [leadId, nm, ph]
  );
  return rows[0];
}

/** Oldest first: the contact the field brought leads, the ones gathered since
 *  follow in the order they were learned. That ordering IS the story of the
 *  outlet, so it is not sorted by anything cleverer. */
async function listContacts(leadId) {
  if (!(await hasContactsTable())) return [];
  const { rows } = await pool.query(
    `SELECT id, name, phone, created_at FROM lead_contacts
      WHERE lead_id = $1 ORDER BY created_at, id`,
    [leadId]
  );
  return rows;
}

async function deleteContact(id) {
  if (!(await hasContactsTable())) return false;
  const { rowCount } = await pool.query('DELETE FROM lead_contacts WHERE id=$1', [id]);
  return rowCount > 0;
}

/**
 * EVERY interaction, newest first, with the outlet it belongs to.
 *
 * The rail files an interaction under its lead and shows one lead at a time,
 * which is right when you are working a single outlet — and useless at 9am when
 * the question is "what happened yesterday". The owner's ten notes from one
 * afternoon sat across SEVEN leads, so nine of them were twelve swipes away and
 * looked lost (25-Aug-2026).
 *
 * The lead's identity is joined in so the feed can name each entry without a
 * request per row.
 */
async function listAllInteractions(limit = 200) {
  if (!(await hasInteractionTable())) return [];
  const appt = await hasAppointmentColumn();
  const { rows } = await pool.query(
    `SELECT i.id, i.lead_id, i.note, i.captured_by, i.lat, i.lng, i.created_at,
            ${appt ? 'i.appointment_at' : 'NULL::timestamptz AS appointment_at'},
            l.name, l.station_name, l.phone, l.status
       FROM lead_interactions i
       JOIN leads l ON l.id = i.lead_id
      ORDER BY i.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  addInteraction, listInteractions, listAppointments, listAllInteractions,
  addContact, listContacts, deleteContact,
  hasInteractionTable, hasAppointmentColumn, hasContactsTable, num, text, when,
};
