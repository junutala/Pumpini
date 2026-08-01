// src/services/attendanceService.js
//
// THE one writer for an attendant's shift clock.
//
// Attendance used to be a table nobody wrote to from the flow that actually knows
// the times: the manager assigned an operator to a nozzle in one place and, if
// anyone remembered, marked him present in another. So "was he here?" and "did his
// meter move?" lived in two records that never met.
//
// Starting an operator now stamps check_in and settling him stamps check_out, both
// against the SAME shift. That is what makes the record provable rather than merely
// typed — the attendance row joins to his nozzle assignment, and therefore to
// meter movement. A photograph taken at each end is attached as an artifact.
//
// Nothing here may break a shift. Every function is best-effort: it returns null on
// failure and never throws, because refusing to start a shift because an attendance
// row wouldn't write would stop an outlet selling fuel. The clock is a record OF the
// work, not a gate ON it.
const pool = require('../db/pool');

// The shift-clock columns arrive with the owner-run DDL, so this code runs both
// before and after. Probed against the catalog, never discovered by a failing
// INSERT — inside a caller's transaction that would abort the shift write itself.
let _cols = null;
async function shiftClockCols(client = pool) {
  if (_cols) return _cols;
  try {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='attendance'
          AND column_name IN ('shift_id','check_in_artifact_id','check_out_artifact_id')`
    );
    const have = new Set(rows.map(r => r.column_name));
    const found = {
      shift_id: have.has('shift_id'),
      check_in_artifact_id: have.has('check_in_artifact_id'),
      check_out_artifact_id: have.has('check_out_artifact_id'),
    };
    if (found.shift_id) _cols = found;      // cache only once migrated
    return found;
  } catch {
    return { shift_id: false, check_in_artifact_id: false, check_out_artifact_id: false };
  }
}

// The shift's own calendar date and slot — NOT today's date. A night shift opened
// at 22:00 on the 1st and closed at 06:00 on the 2nd must book both ends against
// the 1st, or the operator appears twice and the shift's attendance splits across
// two days.
async function shiftContext(shift_id, client = pool) {
  if (!shift_id) return null;
  const { rows } = await client.query(
    'SELECT id, station_id, date, shift_number FROM shifts WHERE id=$1', [shift_id]);
  return rows[0] || null;
}

// Stamp the start of an attendant's shift. Idempotent on (user_id, date,
// shift_number): re-assigning the same operator refreshes the row rather than
// creating a second one, and — deliberately — does NOT move an existing check_in.
// The first time he was put on shift is the time he started; a manager correcting
// a nozzle an hour later must not rewrite his start time.
async function clockIn({ shift_id, attendant_id, artifact_id = null, at = null, notes = null }, client = pool) {
  try {
    const sh = await shiftContext(shift_id, client);
    if (!sh || !attendant_id) return null;
    const cols = await shiftClockCols(client);

    const names = ['user_id', 'station_id', 'date', 'shift_number', 'check_in', 'status'];
    const vals  = [attendant_id, sh.station_id, sh.date, sh.shift_number, at || new Date(), 'present'];
    if (notes) { names.push('notes'); vals.push(notes); }
    if (cols.shift_id) { names.push('shift_id'); vals.push(shift_id); }
    if (cols.check_in_artifact_id && artifact_id) { names.push('check_in_artifact_id'); vals.push(artifact_id); }

    // On conflict, keep the earliest check_in and fill in anything that was blank.
    const updates = ['status=EXCLUDED.status', 'check_in=COALESCE(attendance.check_in, EXCLUDED.check_in)'];
    if (cols.shift_id) updates.push('shift_id=EXCLUDED.shift_id');
    if (cols.check_in_artifact_id && artifact_id) updates.push('check_in_artifact_id=EXCLUDED.check_in_artifact_id');
    if (notes) updates.push('notes=EXCLUDED.notes');

    const { rows } = await client.query(
      `INSERT INTO attendance(${names.join(',')})
       VALUES(${names.map((_, i) => `$${i + 1}`).join(',')})
       ON CONFLICT(user_id, date, shift_number) DO UPDATE SET ${updates.join(', ')}
       RETURNING *`,
      vals
    );
    return rows[0];
  } catch (e) {
    log(`attendance clock-in failed for ${attendant_id} on shift ${shift_id}: ${e.message || e}`);
    return null;
  }
}

// Stamp the end. Unlike check_in this DOES overwrite: settling an operator a second
// time (a correction) should move his finish time to when he was actually released.
// Only ever touches a row that already exists — an operator who was never clocked in
// is not invented here, because that would fabricate a presence nobody recorded.
async function clockOut({ shift_id, attendant_id, artifact_id = null, at = null }, client = pool) {
  try {
    const sh = await shiftContext(shift_id, client);
    if (!sh || !attendant_id) return null;
    const cols = await shiftClockCols(client);

    const sets = ['check_out = $1'];
    const vals = [at || new Date()];
    if (cols.check_out_artifact_id && artifact_id) {
      vals.push(artifact_id); sets.push(`check_out_artifact_id = $${vals.length}`);
    }
    vals.push(attendant_id, sh.date, sh.shift_number);
    const { rows } = await client.query(
      `UPDATE attendance SET ${sets.join(', ')}
        WHERE user_id=$${vals.length - 2} AND date=$${vals.length - 1} AND shift_number=$${vals.length}
        RETURNING *`,
      vals
    );
    return rows[0] || null;
  } catch (e) {
    log(`attendance clock-out failed for ${attendant_id} on shift ${shift_id}: ${e.message || e}`);
    return null;
  }
}

// Who is clocked in for a shift, with their photographs. Used by the shift screens
// to show at a glance which operators have actually started.
async function forShift(shift_id, client = pool) {
  try {
    const cols = await shiftClockCols(client);
    if (!cols.shift_id) return [];
    const { rows } = await client.query(
      `SELECT a.*, u.name AS attendant_name
         FROM attendance a JOIN users u ON u.id = a.user_id
        WHERE a.shift_id = $1 ORDER BY a.check_in`, [shift_id]);
    return rows;
  } catch { return []; }
}

function log(msg) {
  try { require('../utils/logger').warn(msg); } catch { /* logger optional */ }
}

module.exports = { clockIn, clockOut, forShift };
