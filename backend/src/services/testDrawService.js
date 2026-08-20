// src/services/testDrawService.js
//
// THE one writer for a calibration/testing draw.
//
// WHAT IT IS. The manager dispenses ~5 L from a nozzle into a measuring can, checks
// the quantity delivered matches the meter, and pours it back into a tank. The meter
// moved, but nothing was sold.
//
// WHY IT NEEDED A HOME. Two ends of one physical movement were previously either
// unrecorded or recorded in a place that could not express them:
//
//   * The ATTENDANT end existed as `shift_reconciliation.test_ltrs`, typed at close
//     from memory, hours later. It has been used EXACTLY ZERO times in production
//     across the system's whole life — a field filled after the fact does not get
//     filled. It also could not say WHICH nozzle was tested, being one figure per
//     operator per shift.
//   * The TANK end did not exist at all. Nothing recorded the fuel going back, so a
//     draw the manager pocketed and a draw he returned were indistinguishable.
//
// ONE ROW, BOTH ENDS. `from_tank_id` and `to_tank_id` live on the same record on
// purpose. Were the draw and the return two rows, the return could be forgotten —
// which is precisely the gap this closes. Recording the event IS recording both ends.
//
// THE DIESEL CASE is why `to_tank_id` is a real choice and not an assumption. Almost
// every outlet has more than one diesel tank, and the manager pours back into whichever
// is at hand — "this nozzle-tank link is always not on top of the memory" (owner,
// 04-Aug-2026). Petrol and premium usually have a single tank, so there the answer is
// forced and no decision is asked for.
//
// THE ARITHMETIC, and why it is smaller than it looks.
//
//   The meter moved M litres, of which T was test.
//     * the operator's sale is M − T, so he is not charged for it;
//     * physically M left the tank and T came back, so the net out is also M − T.
//
//   So when the fuel goes back into the SAME tank the books already balance with no
//   extra term — the −T and +T cancel. Only a CROSS-TANK draw needs correcting, and
//   then explicitly: −T on the source tank, +T on the destination. That is the diesel
//   case, and it is the one the reconciliation has never seen.
const pool = require('../db/pool');
const pumps = require('./pumpService');

class TestDrawError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Everything the write needs about the nozzle, re-scoped to the validated station so a
// nozzle_id from another outlet cannot be written here.
async function loadNozzle(client, { nozzle_id, station_id }) {
  const nm = await pumps.nozzleNameSelect(client);
  const { rows } = await client.query(`
    SELECT n.id, n.nozzle_number, n.fuel_type, n.tank_id, n.station_id${nm.col}
      FROM nozzles n
      ${nm.join}
     WHERE n.id = $1 AND n.station_id = $2 AND n.is_active`, [nozzle_id, station_id]);
  if (!rows.length) throw new TestDrawError(400, 'That nozzle does not belong to this outlet.');
  const nz = rows[0];
  if (!nz.tank_id) {
    throw new TestDrawError(400,
      `Nozzle ${nz.nozzle_name || nz.nozzle_number} is not linked to a tank. Set its tank in Settings first — ` +
      'without it there is no record of which tank the fuel came out of.');
  }
  return nz;
}

// The destination. Refused across fuels: petrol into a diesel tank is a contamination
// event, not a data-entry choice, and must not be expressible.
async function loadDestinationTank(client, { to_tank_id, station_id, fuel_type }) {
  const { rows } = await client.query(
    `SELECT id, tank_number, fuel_type FROM tanks WHERE id=$1 AND station_id=$2`,
    [to_tank_id, station_id]);
  if (!rows.length) throw new TestDrawError(400, 'That tank does not belong to this outlet.');
  const tk = rows[0];
  if (String(tk.fuel_type) !== String(fuel_type)) {
    throw new TestDrawError(400,
      `Cannot pour ${String(fuel_type).replace('_', ' ')} into tank ${tk.tank_number}, which holds ` +
      `${String(tk.fuel_type).replace('_', ' ')}. Choose a tank of the same fuel.`);
  }
  return tk;
}

// Whose meter moved. Derived rather than asked: the manager picks a nozzle, and the
// operator on it is a fact the shift already knows. Absent (no open shift, or nobody
// assigned) is not an error — a draw taken between shifts is still a real draw, and
// refusing it would only push the manager to record nothing at all.
async function currentOperator(client, { station_id, nozzle_id }) {
  const { rows } = await client.query(`
    SELECT s.id AS shift_id, san.attendant_id
      FROM shifts s
      LEFT JOIN shift_attendant_nozzles san
             ON san.shift_id = s.id AND san.nozzle_id = $2
     WHERE s.station_id = $1 AND s.status = 'open'
     ORDER BY s.start_time DESC
     LIMIT 1`, [station_id, nozzle_id]);
  return rows[0] || { shift_id: null, attendant_id: null };
}

// Record the draw. `to_tank_id` defaults to the nozzle's own tank, which is the
// physically correct case and the one an outlet with a single tank per fuel can never
// get wrong.
async function createTestDraw({
  station_id, nozzle_id, to_tank_id, litres, recorded_by,
  artifact_id = null, slip_reading = null, notes = null, drawn_at = null,
}, client = pool) {
  const qty = parseFloat(litres);
  if (!(qty > 0)) throw new TestDrawError(400, 'Enter the quantity drawn, in litres.');
  // A measuring can is 5 or 10 litres. A three-digit figure is a typo, and a typo here
  // silently reduces an operator's sale — so it is refused rather than warned about.
  if (qty > 100) throw new TestDrawError(400, 'That quantity looks wrong for a test draw — check the litres.');

  const nz   = await loadNozzle(client, { nozzle_id, station_id });
  const dest = await loadDestinationTank(client, {
    to_tank_id: to_tank_id || nz.tank_id, station_id, fuel_type: nz.fuel_type });
  const who  = await currentOperator(client, { station_id, nozzle_id });

  const { rows } = await client.query(`
    INSERT INTO fuel_test_draws
      (station_id, shift_id, nozzle_id, from_tank_id, to_tank_id, attendant_id,
       litres, drawn_at, recorded_by, artifact_id, slip_reading, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()),$9,$10,$11,$12)
    RETURNING *`,
    [station_id, who.shift_id, nozzle_id, nz.tank_id, dest.id, who.attendant_id,
     qty, drawn_at, recorded_by, artifact_id, slip_reading, notes]);

  return {
    ...rows[0],
    nozzle_number: nz.nozzle_number,
    nozzle_name: nz.nozzle_name,
    fuel_type: nz.fuel_type,
    to_tank_number: dest.tank_number,
    // True when the fuel went back somewhere other than where it came from. The books
    // need the explicit ±T only in this case; the screen surfaces it so the manager
    // can see he has moved stock between two tanks.
    cross_tank: dest.id !== nz.tank_id,
  };
}

// Test litres per NOZZLE for one operator on one shift. This is what the settlement
// subtracts, and it REPLACES the typed `test_ltrs` figure — the operator's relief now
// comes from events recorded when the draw happened, not from a number remembered at
// close. Returns { [nozzle_id]: litres }.
async function testLitresByNozzle({ shift_id, attendant_id }, client = pool) {
  const { rows } = await client.query(
    `SELECT nozzle_id, SUM(litres) AS ltrs
       FROM fuel_test_draws
      WHERE shift_id = $1 AND ($2::uuid IS NULL OR attendant_id = $2)
      GROUP BY nozzle_id`, [shift_id, attendant_id || null]);
  const map = {};
  for (const r of rows) map[r.nozzle_id] = parseFloat(r.ltrs) || 0;
  return map;
}

// The per-tank correction for the stock reconciliation, over a time window.
//
// A same-tank draw contributes NOTHING — its −T and +T cancel, because the sale the
// tank is measured against is already net of test. Only cross-tank draws appear:
// the source tank is down T (the fuel left and did not come back), the destination up T.
//
// Returns { [tank_id]: signed_litres }.
async function tankAdjustments({ station_id, from, to }, client = pool) {
  const { rows } = await client.query(`
    SELECT to_tank_id AS tank_id, SUM(litres) AS ltrs
      FROM fuel_test_draws
     WHERE station_id=$1 AND to_tank_id <> from_tank_id
       AND drawn_at > $2 AND drawn_at <= $3
     GROUP BY to_tank_id
    UNION ALL
    SELECT from_tank_id AS tank_id, -SUM(litres) AS ltrs
      FROM fuel_test_draws
     WHERE station_id=$1 AND to_tank_id <> from_tank_id
       AND drawn_at > $2 AND drawn_at <= $3
     GROUP BY from_tank_id`, [station_id, from, to]);
  const map = {};
  for (const r of rows) map[r.tank_id] = (map[r.tank_id] || 0) + (parseFloat(r.ltrs) || 0);
  return map;
}

module.exports = {
  TestDrawError,
  createTestDraw,
  testLitresByNozzle,
  tankAdjustments,
};
