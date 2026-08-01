// src/services/pumpService.js
//
// THE one writer for pumps. docs/artifact-repository.md and the DDL block in
// pumpini-schema.sql carry the reasoning; this is the enforcement.
//
// A PUMP IS A MACHINE, NOT A FUEL. It has a number (what is painted on the unit),
// a serial (what the machine calls itself, printed on every slip it emits), a
// model, and the sample slip it was identified from. It has NO fuel and NO tank —
// one unit routinely dispenses several grades from several tanks, so both belong
// to the NOZZLE. Putting either here would force an outlet to split one physical
// unit into four fictional ones.
//
// END-DATED, NEVER DELETED. A replaced pump is retired by setting end_date on it
// and its nozzles; a new pump is then defined. Deleting would orphan every meter
// reading ever taken on it — and those readings are the outlet's sales history.
const pool = require('../db/pool');

const badRequest = (msg, extra = {}) => Object.assign(new Error(msg), { status: 400, ...extra });
const conflict   = (msg, extra = {}) => Object.assign(new Error(msg), { status: 409, ...extra });

// The pumps table arrives with owner-run DDL, so this code lives both before and
// after. Catalog probe — never discovered by a failing statement, which inside a
// transaction would abort the caller's work (CLAUDE.md).
let _hasPumps = false;
async function hasPumps(client = pool) {
  if (_hasPumps) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='pumps' LIMIT 1`);
    _hasPumps = rows.length > 0;
  } catch { _hasPumps = false; }
  return _hasPumps;   // a false is re-probed, so no restart is needed after the DDL
}

// Every live pump at an outlet with its nozzles nested. This is what the Settings
// screen renders, so it must never throw: before the migration it answers with an
// empty list and the screen shows its empty state rather than an error.
async function listPumps(station_id, client = pool) {
  if (!station_id || !(await hasPumps(client))) return [];
  const { rows } = await client.query(
    `SELECT p.id, p.pump_number, p.serial, p.model, p.slip_artifact_id, p.notes,
            p.is_active, p.end_date, p.created_at,
            COALESCE(json_agg(
              json_build_object(
                'id', n.id, 'nozzle_number', n.nozzle_number, 'fuel_type', n.fuel_type,
                'tank_id', n.tank_id, 'slip_nozzle_no', n.slip_nozzle_no,
                'is_active', n.is_active
              ) ORDER BY n.nozzle_number
            ) FILTER (WHERE n.id IS NOT NULL), '[]') AS nozzles
       FROM pumps p
       LEFT JOIN nozzles n ON n.pump_id = p.id AND n.end_date IS NULL
      WHERE p.station_id = $1 AND p.end_date IS NULL
      GROUP BY p.id
      ORDER BY p.pump_number`,
    [station_id]
  );
  return rows;
}

// Nozzles at this outlet that no pump owns yet. Surfaced at the TOP of the screen
// rather than hidden: existing outlets have a backlog of these until the owner
// assigns them, and a visible countdown is what makes the migration finish.
async function unassignedNozzles(station_id, client = pool) {
  if (!station_id || !(await hasPumps(client))) return [];
  const { rows } = await client.query(
    `SELECT n.id, n.nozzle_number, n.fuel_type, n.tank_id
       FROM nozzles n
      WHERE n.station_id = $1 AND n.pump_id IS NULL
        AND n.end_date IS NULL AND COALESCE(n.is_active, TRUE)
      ORDER BY n.nozzle_number`,
    [station_id]
  );
  return rows;
}

function cleanSerial(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return s || null;
}

async function createPump(input, client = pool) {
  const { station_id, pump_number, serial, model, slip_artifact_id, notes } = input || {};
  if (!station_id) throw badRequest('station_id is required.');
  if (!String(pump_number ?? '').trim()) {
    throw badRequest('Give the pump a number — whatever is painted on the unit.');
  }
  if (!(await hasPumps(client))) throw conflict('Pumps are not set up on this database yet.');

  try {
    const { rows } = await client.query(
      `INSERT INTO pumps(station_id, pump_number, serial, model, slip_artifact_id, notes)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [station_id, String(pump_number).trim(), cleanSerial(serial),
       model ? String(model).trim() : null, slip_artifact_id || null, notes || null]
    );
    return { ...rows[0], nozzles: [] };
  } catch (e) {
    // Translate the two partial unique indexes into something the owner can act on.
    if (e.code === '23505') {
      if (String(e.constraint || '').includes('serial')) {
        throw conflict(
          `Serial ${cleanSerial(serial)} is already on another pump at this outlet. `
          + 'Check the slip, or retire the old pump first.'
        );
      }
      throw conflict(`Pump ${pump_number} already exists at this outlet.`);
    }
    throw e;
  }
}

async function updatePump(pump_id, station_id, patch, client = pool) {
  if (!(await hasPumps(client))) throw conflict('Pumps are not set up on this database yet.');
  const { pump_number, serial, model, slip_artifact_id, notes, is_active, end_date } = patch || {};

  const sets = [];
  const vals = [];
  const put = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };

  if (pump_number !== undefined) put('pump_number', String(pump_number).trim());
  // Blank CLEARS rather than being COALESCEd away — a mistyped serial has to be
  // removable, and silently keeping the wrong one is how a mismatch becomes permanent.
  if (serial !== undefined) put('serial', cleanSerial(serial));
  if (model !== undefined) put('model', model ? String(model).trim() : null);
  if (slip_artifact_id !== undefined) put('slip_artifact_id', slip_artifact_id || null);
  if (notes !== undefined) put('notes', notes || null);
  if (is_active !== undefined) put('is_active', is_active);
  if (end_date !== undefined) put('end_date', end_date || null);
  if (!sets.length) throw badRequest('Nothing to update.');

  vals.push(pump_id, station_id);
  try {
    const { rows } = await client.query(
      `UPDATE pumps SET ${sets.join(', ')}
        WHERE id=$${vals.length - 1} AND station_id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) throw badRequest('Pump not found at this outlet.');
    return rows[0];
  } catch (e) {
    if (e.code === '23505') {
      throw conflict(String(e.constraint || '').includes('serial')
        ? 'That serial is already on another pump at this outlet.'
        : 'A pump with that number already exists at this outlet.');
    }
    throw e;
  }
}

// Retire, don't destroy. A pump that has ever been used is refused outright —
// its nozzles carry the meter readings behind real sales, and removing the parent
// of that history is never what someone means by "delete".
async function retirePump(pump_id, station_id, client = pool) {
  if (!(await hasPumps(client))) throw conflict('Pumps are not set up on this database yet.');
  const { rows: live } = await client.query(
    `SELECT COUNT(*)::int AS n FROM nozzles
      WHERE pump_id=$1 AND end_date IS NULL`, [pump_id]);
  if (live[0].n > 0) {
    throw conflict(
      `This pump still has ${live[0].n} nozzle(s). Move or retire them first — `
      + 'deleting the pump would leave their meter history without a machine.'
    );
  }
  const { rows } = await client.query(
    `DELETE FROM pumps WHERE id=$1 AND station_id=$2
       AND NOT EXISTS (SELECT 1 FROM nozzles WHERE pump_id=$1)
     RETURNING id`, [pump_id, station_id]);
  if (rows.length) return { deleted: true };

  // It has retired nozzles hanging off it, so it has history. End-date instead.
  const { rows: ended } = await client.query(
    `UPDATE pumps SET end_date = CURRENT_DATE, is_active = FALSE
      WHERE id=$1 AND station_id=$2 AND end_date IS NULL RETURNING *`, [pump_id, station_id]);
  if (!ended.length) throw badRequest('Pump not found at this outlet.');
  return { retired: true, pump: ended[0] };
}

module.exports = {
  hasPumps, listPumps, unassignedNozzles, createPump, updatePump, retirePump,
  badRequest, conflict,
};
