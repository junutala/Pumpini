// src/services/openingService.js
//
// THE one answer to "what is this shift's opening reading?" — for both the nozzle
// meters and the tank dips.
//
// OWNER RULE, 01-Aug-2026, and the reason this file exists:
//
//   "The opening shift readings are meaningless once the process starts. The
//    closing readings (for both nozzle and dip) will become opening for the next
//    shift — this is mandatory so that there is no drift between closing and
//    opening. Otherwise, this opens a huge gap for manipulation."
//
// The gap is worth spelling out, because it is the whole point. If a shift closes
// a nozzle at 105,400 L and the next shift is allowed to OPEN it at 105,600, then
// 200 litres have left the tank with nobody accountable for them — the loss falls
// in a gap between two shifts and appears on neither settlement. The same trick
// works on a tank dip. Carrying the close forward as the open makes that gap
// arithmetically impossible: every litre that leaves is inside somebody's shift.
//
// SO THE CARRY IS SERVER-SIDE AND AUTHORITATIVE. It is not a default the screen
// pre-fills and a manager may type over — a control the client can overrule is not
// a control. Where a prior closing exists, a client-supplied opening is IGNORED,
// and the caller is told it was overridden so the screen can say so.
//
// The one case where an opening is genuinely entered is when there is NO prior
// close: the first shift ever run on that nozzle or tank, or a newly commissioned
// one. That is a real event, it is rare, and it is visible as `source: 'entered'`.
const pool = require('../db/pool');

// The most recent closing meter per nozzle at this station, from THE meter store —
// `shift_attendant_nozzles`, and nothing else.
//
// 🔴 This used to COALESCE across three tables: this one, then `shift_nozzle_readings`,
// then the legacy `shift_attendants.closing_reading`. Both fallbacks are retired
// (01-Aug-2026) and this is the reason why. The settlement has only ever computed
// money from `shift_attendant_nozzles`, and that table is clean — 876 rows, not one
// negative or impossible movement. The other two were not: 70 negative and 150
// impossible readings sat in `shift_attendants`, unreachable by the settlement but
// perfectly reachable by THIS query. A nozzle whose good row was missing for any
// reason would have carried one of those figures straight into a live opening, and
// the shift would have been measured against it.
//
// A fallback that reads a table the money does not trust is not resilience. It is a
// quiet path from bad data into the one number a shift is judged by. If the good
// table has no closing for a nozzle, that means no prior close exists, and
// `source: 'entered'` is the honest answer.
//
// `$1` is the shift being opened, excluded from its own lookup so re-running this
// for a shift that has already been assigned cannot read its own figures back.
async function nozzleOpenings(shift_id, client = pool) {
  const { rows } = await client.query(`
    SELECT n.id AS nozzle_id, n.nozzle_number, n.fuel_type,
      (SELECT san.closing_reading FROM shift_attendant_nozzles san JOIN shifts s2 ON s2.id=san.shift_id
        WHERE san.nozzle_id=n.id AND san.shift_id<>$1 AND san.closing_reading IS NOT NULL
        ORDER BY s2.start_time DESC LIMIT 1) AS carried_opening
    FROM nozzles n
    WHERE n.station_id = (SELECT station_id FROM shifts WHERE id=$1) AND n.is_active
    ORDER BY n.nozzle_number`, [shift_id]);

  const map = {};
  for (const r of rows) {
    map[r.nozzle_id] = {
      nozzle_id: r.nozzle_id,
      nozzle_number: r.nozzle_number,
      fuel_type: r.fuel_type,
      carried_opening: r.carried_opening,
      // 'carried'  — taken from the last close; the client cannot change it.
      // 'entered'  — no prior close anywhere; the client's figure is accepted.
      source: r.carried_opening != null ? 'carried' : 'entered',
    };
  }
  return map;
}

// Decide the opening actually used for one nozzle. `requested` is whatever the
// client sent. Returns { opening, source, requested, overridden }.
function resolveNozzleOpening(entry, requested) {
  const asked = (requested === '' || requested == null) ? null : Number(requested);
  if (entry && entry.carried_opening != null) {
    const carried = Number(entry.carried_opening);
    return {
      opening: carried,
      source: 'carried',
      requested: asked,
      // Flagged, not rejected. A manager whose slip reads differently from the
      // last close is looking at a real discrepancy — but the fix for that is an
      // investigation, not a different opening figure, so we record what he saw
      // and carry the close regardless.
      overridden: asked != null && Math.abs(asked - carried) > 0.0005,
    };
  }
  return { opening: asked != null ? asked : 0, source: 'entered', requested: asked, overridden: false };
}

// Seed this shift's OPENING dips from each tank's last CLOSING dip.
//
// Runs when the shift is opened, so the opening stock is already in place before
// anyone can type one. Idempotent: a tank that already has an opening reading for
// this shift is skipped, so re-opening or a retried request cannot double-write.
//
// A tank with no prior closing anywhere is deliberately left EMPTY rather than
// seeded with a zero — the shift-start screen then asks for it, which is correct
// for a newly commissioned tank and honest about the fact that nobody knows.
//
// Best-effort by contract: a seeding failure must never stop a shift opening. The
// screen still lets the reading be entered by hand.
async function seedOpeningDips(shift_id, recorded_by, client = pool) {
  try {
    const { rows } = await client.query(`
      INSERT INTO dipstick_readings
        (station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c, recorded_by)
      SELECT s.station_id, t.id, s.id, 'opening', last.dip_cm, last.volume_ltrs,
             last.density, last.temperature_c, $2
        FROM shifts s
        JOIN tanks t ON t.station_id = s.station_id
        JOIN LATERAL (
          SELECT dr.dip_cm, dr.volume_ltrs, dr.density, dr.temperature_c
            FROM dipstick_readings dr
           WHERE dr.tank_id = t.id
             AND dr.reading_type = 'closing'
             AND dr.shift_id IS DISTINCT FROM s.id
           ORDER BY dr.recorded_at DESC
           LIMIT 1
        ) last ON TRUE
       WHERE s.id = $1
         AND lower(coalesce(t.fuel_type,'')) <> 'cng'   -- CNG is sold by mass, never dipped
         AND NOT EXISTS (
           SELECT 1 FROM dipstick_readings x
            WHERE x.shift_id = s.id AND x.tank_id = t.id AND x.reading_type = 'opening'
         )
      RETURNING tank_id`, [shift_id, recorded_by || null]);
    return rows.map(r => r.tank_id);
  } catch (e) {
    try { require('../utils/logger').error(`opening dip carry-forward failed for shift ${shift_id}: ${e.message || e}`); } catch { /* noop */ }
    return [];
  }
}

module.exports = { nozzleOpenings, resolveNozzleOpening, seedOpeningDips };
