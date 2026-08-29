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
const pumps = require('./pumpService');

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
// 🔴 THE LEG IMMEDIATELY BEFORE, NOT "THE NEWEST CLOSING THAT EXISTS RIGHT NOW".
//
// This used to filter `closing_reading IS NOT NULL` and take the newest survivor —
// which means it would SKIP a shift that has the nozzle but has not been settled yet,
// and carry from the one before it. That is the same shape as the dip bug fixed in
// #248, and here it is worse, because the figure it lands on is where the SKIPPED
// shift STARTED. Every litre that shift sold would then be inside the next operator's
// opening as well: charged to a man who did not sell it, while the shift that did
// settles later against a meter that has moved on. It cannot happen where shifts are
// settled before the next opens — which is why it has never fired (verified in
// production: 972 legs across the three real outlets, not one instance) — but a night
// handover routinely opens tomorrow before closing today, and that is precisely the
// case the filter mishandles.
//
// So: the most recent PRIOR leg on this nozzle, whatever state it is in.
//   * it has a closing            → carry it ('carried')
//   * it exists but has none yet  → carry NOTHING ('pending'); the shift it is waiting
//                                   on is named, so the screen can say why the box is
//                                   open instead of pretending the nozzle is new
//   * there is no prior leg       → 'entered', a genuinely new nozzle or first shift
//
// Skipping shifts that never had the nozzle assigned stays correct and is the reason
// this looks at legs rather than at shifts: nobody manned it, so its meter did not
// move, and the older close is still the truth. Skipping a shift that DID have it is
// the bug.
//
// `$1` is the shift being opened, excluded from its own lookup so re-running this for
// a shift that has already been assigned cannot read its own figures back — and bounded
// by `start_time`, so a shift entered out of order cannot carry a LATER shift's meter
// backwards into an earlier one.
async function nozzleOpenings(shift_id, client = pool) {
  const nm = await pumps.nozzleNameSelect(client);
  const { rows } = await client.query(`
    SELECT n.id AS nozzle_id, n.nozzle_number, n.fuel_type${nm.col},
           prev.closing_reading                AS carried_opening,
           (prev.shift_id IS NOT NULL)         AS has_prior_leg,
           prev.shift_number                   AS prior_shift_number,
           prev.date::text                     AS prior_shift_date
      FROM (SELECT id, station_id, start_time FROM shifts WHERE id = $1) cur
      JOIN nozzles n ON n.station_id = cur.station_id AND n.is_active
      ${nm.join}
      LEFT JOIN LATERAL (
        SELECT san.closing_reading, san.shift_id, s2.shift_number, s2.date
          FROM shift_attendant_nozzles san
          JOIN shifts s2 ON s2.id = san.shift_id
         -- A HANDOVER INSIDE THIS SHIFT COUNTS TOO, and it counts first.
         --
         -- This clause used to be san.shift_id <> cur.id — the carry could only see
         -- closes from EARLIER shifts. That was safe while a nozzle could be worked by
         -- exactly one man per shift. It is not safe now: when a man leaves mid-shift
         -- his line is taken over by someone already on the forecourt (owner,
         -- 29-Aug-2026: "they cannot find a replacement. The show has to run"), and
         -- the incoming man's opening MUST be the outgoing man's closing.
         --
         -- Without this he would open at whatever the shift opened at, and be charged
         -- for every litre the first man sold. The litres do not vanish — they land on
         -- the wrong person, which is worse.
         WHERE san.nozzle_id = n.id
           AND ( (san.shift_id  = cur.id AND san.closing_reading IS NOT NULL)
              OR (san.shift_id <> cur.id AND s2.start_time < cur.start_time) )
         -- This shift's own closed leg wins; then the latest prior shift; then, within
         -- one shift, the LAST leg — several now share s2.start_time, which would
         -- otherwise leave the tie-break to the planner.
         ORDER BY (san.shift_id = cur.id) DESC,
                  s2.start_time DESC,
                  san.assigned_at DESC NULLS LAST
         LIMIT 1
      ) prev ON TRUE
     ORDER BY n.nozzle_number`, [shift_id]);

  const map = {};
  for (const r of rows) {
    map[r.nozzle_id] = {
      nozzle_id: r.nozzle_id,
      nozzle_number: r.nozzle_number,
      nozzle_name: r.nozzle_name,
      fuel_type: r.fuel_type,
      carried_opening: r.carried_opening,
      // 'carried'  — taken from the last close; the client cannot change it.
      // 'pending'  — the shift before this one worked the nozzle and has not been
      //              settled, so there is no close to carry YET. The client's figure
      //              is accepted (a shift must be able to start), and the two numbers
      //              are compared afterwards by the meter_handover_gap tripwire.
      // 'entered'  — no prior leg at all; the client's figure is accepted.
      source: r.carried_opening != null ? 'carried' : (r.has_prior_leg ? 'pending' : 'entered'),
      // Only set when 'pending' — which shift is holding the figure up.
      pending_on: r.carried_opening == null && r.has_prior_leg
        ? { shift_number: r.prior_shift_number, date: r.prior_shift_date }
        : null,
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
  // No close to carry. Either the nozzle has never run ('entered') or the shift
  // before this one has it open and unsettled ('pending'). Both accept the manager's
  // figure — refusing would stop the outlet selling because somebody has not finished
  // yesterday's paperwork — but they are NOT the same event and are not reported as
  // one. 'pending' is the case worth watching, and the gap it can leave is caught
  // afterwards by the meter_handover_gap tripwire.
  return {
    opening: asked != null ? asked : 0,
    source: entry && entry.source === 'pending' ? 'pending' : 'entered',
    requested: asked,
    overridden: false,
  };
}

// Seed this shift's OPENING dips from the IMMEDIATELY PRECEDING shift's closing.
//
// 🔴 THE PRECEDING SHIFT, NOT "THE NEWEST CLOSING THAT EXISTS RIGHT NOW".
//
// This used to `ORDER BY dr.recorded_at DESC LIMIT 1` — the most recent closing dip
// at the instant the shift was opened. That is only correct if shifts are always
// closed before the next is opened, and they are not: a night handover routinely
// opens tomorrow at 01:28 and closes today at 01:34, six minutes later.
//
// When that happens the newest closing in the table is the one from the day BEFORE,
// so the opening was seeded two days stale — and because this function is
// idempotent (NOT EXISTS below), the mistake was then frozen and never revisited.
// Kamala's 03-Aug reconciliation reported 4,254 L of phantom loss across three tanks
// entirely because of it; the tank that was measured cleanly reconciled to 9 L once
// the correct opening was used.
//
// So: find the shift that immediately precedes this one AT THIS STATION, and take
// ITS closing. If that shift has not been closed yet there is nothing to carry, and
// the tank is deliberately left EMPTY — the shift-start screen then asks for it,
// exactly as it does for a newly commissioned tank. An empty box the manager fills
// is honest; a figure carried from two days ago is not, and it becomes the number a
// day's stock variance is judged against.
//
// backfillOpeningFromClose() below closes the loop: when that earlier shift is
// finally closed, the later shift's opening is filled in from it.
//
// Best-effort by contract: a seeding failure must never stop a shift opening.
async function seedOpeningDips(shift_id, recorded_by, client = pool) {
  try {
    const { rows } = await client.query(`
      INSERT INTO dipstick_readings
        (station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c, recorded_by)
      SELECT s.station_id, t.id, s.id, 'opening', last.dip_cm, last.volume_ltrs,
             last.density, last.temperature_c, $2
        FROM shifts s
        JOIN tanks t ON t.station_id = s.station_id
        -- The shift immediately before this one at this outlet. Ordered by when the
        -- shift STARTED, which is a fact about the shift, not by when somebody
        -- happened to type its closing.
        JOIN LATERAL (
          SELECT ps.id
            FROM shifts ps
           WHERE ps.station_id = s.station_id
             AND ps.id <> s.id
             AND ps.start_time < s.start_time
           ORDER BY ps.start_time DESC
           LIMIT 1
        ) prev ON TRUE
        -- ...and ITS closing for this tank. No row here means that shift is not
        -- closed yet, so nothing is carried and the screen asks.
        JOIN LATERAL (
          SELECT dr.dip_cm, dr.volume_ltrs, dr.density, dr.temperature_c
            FROM dipstick_readings dr
           WHERE dr.tank_id = t.id
             AND dr.reading_type = 'closing'
             AND dr.shift_id = prev.id
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

// The other half of the rule: when a shift's CLOSING dip is recorded, fill in the
// opening of the shift that follows it, if that shift is already open and still has
// none for this tank.
//
// This is what makes "open tomorrow before closing today" safe. seedOpeningDips
// refuses to guess at open time; this fills the gap the moment the real figure
// exists, so the manager never has to re-key a number the system already knows.
//
// Only ever writes where there is NO opening yet — it cannot overwrite a reading a
// manager has entered, and it cannot revise a shift that has moved on.
async function backfillOpeningFromClose({ station_id, tank_id, shift_id }, client = pool) {
  try {
    const { rows } = await client.query(`
      INSERT INTO dipstick_readings
        (station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c, recorded_by)
      SELECT $1, $2, nxt.id, 'opening', c.dip_cm, c.volume_ltrs, c.density, c.temperature_c, NULL
        FROM shifts cur
        -- the next shift at this outlet, if one has already been opened
        JOIN LATERAL (
          SELECT ns.id
            FROM shifts ns
           WHERE ns.station_id = cur.station_id
             AND ns.id <> cur.id
             AND ns.start_time > cur.start_time
           ORDER BY ns.start_time ASC
           LIMIT 1
        ) nxt ON TRUE
        JOIN LATERAL (
          SELECT dr.dip_cm, dr.volume_ltrs, dr.density, dr.temperature_c
            FROM dipstick_readings dr
           WHERE dr.shift_id = cur.id AND dr.tank_id = $2 AND dr.reading_type = 'closing'
           ORDER BY dr.recorded_at DESC LIMIT 1
        ) c ON TRUE
       WHERE cur.id = $3
         AND NOT EXISTS (
           SELECT 1 FROM dipstick_readings x
            WHERE x.shift_id = nxt.id AND x.tank_id = $2 AND x.reading_type = 'opening'
         )
      RETURNING shift_id`, [station_id, tank_id, shift_id]);
    return rows.length > 0;
  } catch (e) {
    try { require('../utils/logger').error(`opening back-fill failed from shift ${shift_id}: ${e.message || e}`); } catch { /* noop */ }
    return false;
  }
}

module.exports = { nozzleOpenings, resolveNozzleOpening, seedOpeningDips, backfillOpeningFromClose };
