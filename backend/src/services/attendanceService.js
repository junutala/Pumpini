// src/services/attendanceService.js
//
// THE one writer for an attendant's shift clock — his start and end date & time,
// per shift, in the `shift_attendance` table (owner-set, 01-Aug-2026).
//
// TWO TABLES, DELIBERATELY, AND THEY ARE NOT THE SAME THING:
//
//   `attendance`        an HR register. Keyed on (user_id, date, shift_number),
//                       covers every role, filled in by hand on the Attendance
//                       screen. It records what somebody SAYS happened. Untouched
//                       by this service.
//   `shift_attendance`  what the SYSTEM observed. Written only from the shift flow
//                       — starting an operator stamps started_at, settling him
//                       stamps ended_at — keyed on the SHIFT, with a photograph at
//                       each end. Every row joins straight to his nozzle assignment
//                       and therefore to the litres that went through it.
//
// That is the whole point of the split: one is an assertion, the other is evidence,
// and they must not be able to overwrite each other. This file writes the second.
//
// Nothing here may break a shift. Every function is best-effort: it returns null on
// failure and never throws, because refusing to start a shift because an attendance
// row would not write would stop an outlet selling fuel. The clock is a record OF
// the work, not a gate ON it.
const pool = require('../db/pool');

// The table arrives with the owner-run DDL, so this code runs both before and
// after it. Probed against the catalog, never discovered by a failing INSERT —
// inside a caller's transaction that would abort the shift write itself.
let _hasTable = null;
async function hasTable(client = pool) {
  if (_hasTable) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='shift_attendance' LIMIT 1`
    );
    if (rows.length) _hasTable = true;      // cache only once migrated
    return rows.length > 0;
  } catch { return false; }
}

// The shift's own calendar date and slot — NOT today's date. A night shift opened
// at 22:00 on the 1st and closed at 06:00 on the 2nd must book both ends against
// the 1st, or the operator appears twice and his attendance splits across two days.
async function shiftContext(shift_id, client = pool) {
  if (!shift_id) return null;
  const { rows } = await client.query(
    'SELECT id, station_id, date, shift_number FROM shifts WHERE id=$1', [shift_id]);
  return rows[0] || null;
}

// Stamp the START of an attendant's shift. Idempotent on (shift_id, attendant_id):
// re-assigning the same man to a second nozzle refreshes his row rather than
// opening a second stretch of attendance, and — deliberately — does NOT move an
// existing started_at. The first time he was put on shift is the time he started;
// a manager correcting a nozzle an hour later must not rewrite it.
async function clockIn({ shift_id, attendant_id, artifact_id = null, at = null, notes = null, recorded_by = null }, client = pool) {
  try {
    if (!(await hasTable(client))) return null;
    const sh = await shiftContext(shift_id, client);
    if (!sh || !attendant_id) return null;

    const { rows } = await client.query(
      `INSERT INTO shift_attendance
         (station_id, shift_id, attendant_id, shift_date, shift_number,
          started_at, start_photo_id, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (shift_id, attendant_id) DO UPDATE SET
         started_at     = COALESCE(shift_attendance.started_at, EXCLUDED.started_at),
         start_photo_id = COALESCE(EXCLUDED.start_photo_id, shift_attendance.start_photo_id),
         notes          = COALESCE(EXCLUDED.notes, shift_attendance.notes),
         updated_at     = now()
       RETURNING *`,
      [sh.station_id, shift_id, attendant_id, sh.date, sh.shift_number,
       at || new Date(), artifact_id, notes, recorded_by]
    );
    return rows[0];
  } catch (e) {
    log(`shift attendance clock-in failed for ${attendant_id} on shift ${shift_id}: ${e.message || e}`);
    return null;
  }
}

// Stamp the END. Unlike started_at this DOES overwrite: settling an operator a
// second time is a correction, and should move his finish time to when he was
// actually released. Only ever touches a row that already exists — a man who was
// never clocked in is not invented here, because that would fabricate a presence
// nobody recorded.
async function clockOut({ shift_id, attendant_id, artifact_id = null, at = null }, client = pool) {
  try {
    if (!(await hasTable(client))) return null;
    if (!shift_id || !attendant_id) return null;
    const { rows } = await client.query(
      `UPDATE shift_attendance
          SET ended_at     = $1,
              end_photo_id = COALESCE($2, end_photo_id),
              updated_at   = now()
        WHERE shift_id = $3 AND attendant_id = $4
        RETURNING *`,
      [at || new Date(), artifact_id, shift_id, attendant_id]
    );
    return rows[0] || null;
  } catch (e) {
    log(`shift attendance clock-out failed for ${attendant_id} on shift ${shift_id}: ${e.message || e}`);
    return null;
  }
}

// Hours worked, to two places. NULL while he is still on shift rather than counting
// up against a clock nobody has stopped — an open stretch is shown as open, not as
// a number that grows every time the page is refreshed.
const HOURS_SQL = `CASE WHEN sa.started_at IS NOT NULL AND sa.ended_at IS NOT NULL
                        THEN ROUND((EXTRACT(EPOCH FROM (sa.ended_at - sa.started_at)) / 3600.0)::numeric, 2)
                   END`;

function decorate(r) {
  return {
    ...r,
    // A stretch with a photograph on at least one end is the strong record. The
    // register shows the difference rather than presenting every time as equally
    // solid — same reason the meter screen flags a typed reading.
    photo_backed: !!(r.start_photo_id || r.end_photo_id),
    open: !!r.started_at && !r.ended_at,
  };
}

// Who is on this shift, with their photographs and hours so far. Used by the shift
// screens to show at a glance which operators have actually started.
async function forShift(shift_id, client = pool) {
  try {
    if (!(await hasTable(client))) return [];
    const { rows } = await client.query(
      `SELECT sa.*, u.name AS attendant_name, ${HOURS_SQL} AS hours
         FROM shift_attendance sa
         JOIN users u ON u.id = sa.attendant_id
        WHERE sa.shift_id = $1
        ORDER BY sa.started_at`, [shift_id]);
    return rows.map(decorate);
  } catch { return []; }
}

// The register: every attendant's start and end, per shift, over a date range.
// This is the screen the owner reads. Station-scoped by the caller.
async function register({ station_id, from = null, to = null, attendant_id = null }, client = pool) {
  try {
    if (!station_id || !(await hasTable(client))) return [];
    const p = [station_id];
    let where = 'sa.station_id = $1';
    if (from)         { p.push(from);         where += ` AND sa.shift_date >= $${p.length}`; }
    if (to)           { p.push(to);           where += ` AND sa.shift_date <= $${p.length}`; }
    if (attendant_id) { p.push(attendant_id); where += ` AND sa.attendant_id = $${p.length}`; }

    const { rows } = await client.query(
      `SELECT sa.*, u.name AS attendant_name, u.phone AS attendant_phone,
              ${HOURS_SQL} AS hours
         FROM shift_attendance sa
         JOIN users u ON u.id = sa.attendant_id
        WHERE ${where}
        ORDER BY sa.shift_date DESC, sa.shift_number, u.name`,
      p
    );
    return rows.map(decorate);
  } catch (e) {
    log(`shift attendance register failed for station ${station_id}: ${e.message || e}`);
    return [];
  }
}

function log(msg) {
  try { require('../utils/logger').warn(msg); } catch { /* logger optional */ }
}

module.exports = { clockIn, clockOut, forShift, register, hasTable };
