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
const artifacts = require('./artifactService');

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
                'is_active', n.is_active,
                -- The name the slip prints. Built from THIS pump's serial, so the
                -- Settings card shows exactly what every other screen shows.
                'nozzle_name', ${nozzleNameExpr('n', 'p')}
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

// Nozzles at this outlet that no pump owns yet. INACTIVE ones are included: an
// inactive nozzle filtered out here would appear in neither the banner nor any pump
// card, so it would simply vanish from the screen and reappear unassigned the day
// someone reactivated it. Surfaced at the TOP of the screen
// rather than hidden: existing outlets have a backlog of these until the owner
// assigns them, and a visible countdown is what makes the migration finish.
async function unassignedNozzles(station_id, client = pool) {
  if (!station_id || !(await hasPumps(client))) return [];
  const { rows } = await client.query(
    // No pump owns these yet, so there is no serial and no printed name to show —
    // nozzle_name falls back to the stored number, which is precisely the signal that
    // this nozzle still needs assigning.
    `SELECT n.id, n.nozzle_number, n.fuel_type, n.tank_id, n.is_active,
            n.nozzle_number::text AS nozzle_name
       FROM nozzles n
      WHERE n.station_id = $1 AND n.pump_id IS NULL AND n.end_date IS NULL
      ORDER BY n.nozzle_number`,
    [station_id]
  );
  return rows;
}

// The number the SLIP prints for a nozzle, defaulted from our own name for it.
//
// Outlets name nozzles pump.nozzle — "1.1" is pump 1, nozzle 1 (the convention PR
// #68 introduced). So the suffix ALREADY IS the machine's nozzle number, and asking
// the owner to retype it was asking for something the name already carries. It is
// still a separate COLUMN, because a machine is free to number its own nozzles
// differently from the outlet's convention — but it is now a default he overrides
// on the rare unit that does, not a field he fills on every ordinary one.
function defaultSlipNo(nozzle_number) {
  const s = String(nozzle_number ?? '').trim();
  const m = s.match(/^\d+\.(\d+)$/);      // "1.1" -> "1"
  if (m) return m[1];
  return /^\d+$/.test(s) ? s : null;      // bare "1" -> "1"; anything else, no guess
}

function cleanSerial(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return s || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  THE NAME OF A NOZZLE — one writer, used by every screen, report and export.
// ═══════════════════════════════════════════════════════════════════════════════
//
// A nozzle has ONE name: the identity its own slip prints, `<pump serial>.<nozzle
// number>` — M1832105.1. An attendant, a manager and an auditor can hold the paper
// against the screen and agree without knowing anything about Pumpini.
//
// `nozzles.nozzle_number` ("1.1", "2.3") is OUR index. It is verifiable by nobody
// outside this codebase, so it is internal only and is never shown to a user. It
// stays as the join key and the ordering key; it stops being a label.
//
// The printed nozzle number is `slip_nozzle_no` where the outlet recorded it, else
// the suffix of our own number ("1.3" -> "3") — the SAME fallback defaultSlipNo()
// and the slip matcher in reconcile.js already apply, so the name a screen shows
// and the name the scanner matches on cannot drift apart.
//
// NO SERIAL ON FILE -> the stored nozzle_number, unchanged. A pump not yet recorded
// is a gap to fill in Settings; it is not a licence to invent a name for it.
//
// Kamala's CNG unit prints no slip at all (owner, 20-Aug-2026), so its serial is
// recorded as the literal "CNG" and its nozzles read CNG.1 / CNG.2. That is an
// invented name and we know it — there is no printed identity to use, and a name
// the forecourt actually says beats a number only this repo can explain.

// Columns arrive with owner-run DDL, so this code lives both before and after it.
// Catalog probe — never a failing SELECT, which inside a transaction would abort
// the caller's whole unit of work (CLAUDE.md). Cached only once TRUE, so the first
// call after the migration picks it up with no restart.
let _hasPumpNaming = false;
async function hasPumpNaming(client = pool) {
  if (_hasPumpNaming) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='nozzles'
          AND column_name='pump_id' LIMIT 1`);
    _hasPumpNaming = rows.length > 0;
  } catch { _hasPumpNaming = false; }
  return _hasPumpNaming;
}

// The SQL half of the name. `n` is the nozzles alias already in the caller's query;
// `p` is the pumps alias the matching join introduces.
function nozzleNameExpr(n = 'n', p = '_np') {
  return `CASE WHEN ${p}.serial IS NULL OR btrim(${p}.serial) = ''
               THEN ${n}.nozzle_number::text
               ELSE btrim(${p}.serial) || '.' || COALESCE(
                      NULLIF(btrim(${n}.slip_nozzle_no), ''),
                      NULLIF(split_part(${n}.nozzle_number::text, '.', 2), ''),
                      ${n}.nozzle_number::text)
          END`;
}

// LEFT JOIN, always: a nozzle no pump owns yet must still come back with a name,
// and a retired pump must not resurrect its nozzles into a live list.
function nozzleNameJoin(n = 'n', p = '_np') {
  return `LEFT JOIN pumps ${p} ON ${p}.id = ${n}.pump_id AND ${p}.end_date IS NULL`;
}

// What callers use. Hands back the SELECT fragment and the JOIN to splice in, both
// already comma/space-prefixed, and both EMPTY-SAFE before the migration: without
// the pump columns the name degrades to today's nozzle_number rather than 500-ing
// a read path. Shift Close is on the other end of several of these.
// `groupBy` is the trailing GROUP BY fragment an aggregating caller must add, so a
// query that groups does not have to repeat the CASE — it groups by the two source
// columns the name is built from.
async function nozzleNameSelect(client = pool, { n = 'n', p = '_np', as = 'nozzle_name' } = {}) {
  if (!(await hasPumpNaming(client))) {
    return { col: `, ${n}.nozzle_number::text AS ${as}`, join: '', groupBy: '' };
  }
  return {
    col: `, ${nozzleNameExpr(n, p)} AS ${as}`,
    join: ` ${nozzleNameJoin(n, p)} `,
    groupBy: `, ${p}.serial, ${n}.slip_nozzle_no`,
  };
}

// The JS half, for a name built from a row we already hold rather than in SQL.
// Same three rules, same order, so the two halves cannot disagree.
function nozzleName(row = {}) {
  const stored = String(row.nozzle_number ?? '').trim();
  const serial = String(row.pump_serial ?? row.serial ?? '').trim();
  if (!serial) return stored;
  const printed = String(row.slip_nozzle_no ?? '').trim()
    || (stored.includes('.') ? stored.split('.').pop() : '')
    || stored;
  return `${serial}.${printed}`;
}


// Store the sample slip and hand back its artifact id. The pump form photographs a
// slip to read the serial off it; keeping the picture is the whole point — the same
// gap that left coupons and gauge screens unevidenced for months. Best-effort, as
// everywhere: a pump must still be definable when the camera or the store fails,
// and a CNG unit has no slip to photograph at all.
async function storeSlip({ station_id, pump_id, image_base64, media_type, ocr, uploaded_by }, client = pool) {
  if (!image_base64) return null;
  const a = await artifacts.save({
    station_id,
    entity_type: 'pump',
    entity_id: pump_id,
    kind: 'nozzle_slip',
    file_base64: image_base64,
    media_type: media_type || 'image/jpeg',
    ocr: ocr || null,
    meta: { purpose: 'pump_identification' },
    uploaded_by: uploaded_by || null,
  }, client);
  return a ? a.id : null;
}

async function createPump(input, client = pool) {
  const { station_id, pump_number, serial, model, notes,
          image_base64, media_type, ocr, uploaded_by } = input || {};
  let { slip_artifact_id } = input || {};
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
    const pump = rows[0];

    // The artifact hangs off the pump, so it can only be written once the pump has
    // an id — hence store-then-link rather than link-on-insert.
    if (!slip_artifact_id && image_base64) {
      slip_artifact_id = await storeSlip(
        { station_id, pump_id: pump.id, image_base64, media_type, ocr, uploaded_by }, client);
    }
    if (slip_artifact_id) {
      const { rows: up } = await client.query(
        'UPDATE pumps SET slip_artifact_id=$2 WHERE id=$1 RETURNING *', [pump.id, slip_artifact_id]);
      if (up.length) return { ...up[0], nozzles: [] };
    }
    return { ...pump, nozzles: [] };
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
  const { pump_number, serial, model, notes, is_active, end_date,
          image_base64, media_type, ocr, uploaded_by } = patch || {};
  let { slip_artifact_id } = patch || {};

  // Re-photographing a slip (a replaced board, or a first photo that was unreadable)
  // stores the new one and repoints the pump. The old artifact is left in place —
  // it is evidence of what the machine printed at the time, and superseding is not
  // the same as never having happened.
  if (!slip_artifact_id && image_base64) {
    const { rows: own } = await client.query(
      'SELECT station_id FROM pumps WHERE id=$1 AND station_id=$2', [pump_id, station_id]);
    if (own.length) {
      slip_artifact_id = await storeSlip(
        { station_id, pump_id, image_base64, media_type, ocr, uploaded_by }, client);
    }
  }

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
  hasPumps, defaultSlipNo, listPumps, unassignedNozzles, createPump, updatePump, retirePump,
  hasPumpNaming, nozzleNameExpr, nozzleNameJoin, nozzleNameSelect, nozzleName,
  badRequest, conflict,
};
