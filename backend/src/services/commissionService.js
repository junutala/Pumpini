// COMMISSIONING BY SLIP — a verified act, and it GATES THE SWITCH.
//
// § 10 rule 1 of the build plan: *"Every serial + printed-nozzle-number pair captured
// by scanning a REAL slip at setup, human-confirmed, stored as printed.
// defaultSlipNo() guesses are abolished on flow-v2 outlets; the commissioning reading
// is the chain's genesis event."*
//
// WHY THE GUESS HAD TO GO. `pumpService.defaultSlipNo()` reads the printed nozzle
// number off OUR OWN index — "1.3" becomes "3" — which is a convention this repo
// invented and no slip has ever confirmed. It is a sensible default for the shift flow
// and it stays there. But the hub-and-spokes flow MATCHES MONEY on that pair: a
// composite scan finds a nozzle by `<serial>.<printed no>`, and if the printed number
// was guessed, one nozzle's meter lands on another nozzle's account and the two men's
// outstandings are both wrong. So on a flow-v2 outlet the pair must have been read off
// paper by a person who looked at it.
//
// HOW IT IS RECORDED, WITH NO NEW TABLE AND NO NEW COLUMN. The three facts already have
// homes, and a fourth column asserting "this was confirmed" would be a second source of
// truth for something the data already shows:
//
//   the machine's identity   ->  pumps.serial            (pumpService, the one writer)
//   the printed nozzle no    ->  nozzles.slip_nozzle_no  (the column the matcher reads)
//   that a slip was read     ->  the nozzle's GENESIS nozzle_events row, source='photo',
//                                carrying read_pump_serial / read_nozzle_no exactly as
//                                the paper printed them
//
// The genesis event is the evidence. A nozzle with no event was never commissioned; a
// nozzle whose first event carries the serial and number it was read from was.
//
// IDEMPOTENT AND RESUMABLE. Commissioning twelve nozzles is twelve small writes, not
// one transaction — a half-finished run leaves the outlet exactly as ready as the
// nozzles it got through, and re-running finishes the rest. Nothing here touches money,
// and the switch stays refused until every active nozzle is ready, so a partial run
// cannot leave the outlet in a state that pretends to be commissioned.
const pool = require('../db/pool');
const pumps = require('./pumpService');
const spokes = require('./spokeService');

// THE THREE FACTS A COMMISSIONED NOZZLE CARRIES, and what it is still short of.
//
// Pure, so it can be tested without a database — the gate that decides whether an
// outlet may change its whole operating model should not be reasoned about only by
// reading it.
function wantsFor(row = {}) {
  const wants = [];
  // A NOZZLE BELONGING TO NO PUMP HAS NOWHERE FOR A SERIAL TO GO, and saying "no serial
  // on file" would send the owner to type one into a screen that cannot store it. That
  // is a Settings act — define the pump, attach the nozzle — so it is named as its own
  // want rather than folded into the one it looks like.
  if (!row.pump_id)                             wants.push('pump');
  else if (!String(row.pump_serial || '').trim()) wants.push('serial');
  // "0" IS A REAL PRINTED NUMBER on some machines, so this asks whether the field is
  // BLANK, never whether it is falsy — the same class of slip as Number(null) reading
  // as a baseline of zero in varianceMath.
  if (!String(row.slip_nozzle_no ?? '').trim()) wants.push('printed_no');
  // A nozzle with no chain was never commissioned. The genesis event IS the evidence,
  // which is why no "confirmed" column exists to drift away from it.
  if (!Number(row.events || 0))                 wants.push('genesis');
  return wants;
}

// WHAT THE OUTLET STILL OWES BEFORE THE SWITCH MAY GO ON.
//
// One row per ACTIVE nozzle. A retired nozzle is deliberately out of scope: its chain
// is history and there is nothing left to commission.
async function readiness(station_id) {
  if (!station_id) return { ready: false, nozzles: [], missing: 0, spokes_ready: false };
  const spokesReady = await spokes.hasSpokeTables();
  const naming = await pumps.hasPumpNaming(pool);
  const nm = await pumps.nozzleNameSelect(pool);

  // The genesis check only exists once the spoke tables do. Before the DDL, the
  // readiness answer is honest about that rather than silently passing everything.
  const genesis = spokesReady
    ? `, (SELECT count(*)::int FROM nozzle_events e WHERE e.nozzle_id = n.id) AS events`
    : `, 0 AS events`;
  // The SAME join condition the name expression uses (a retired pump must not supply
  // a serial), so readiness and the name a screen shows cannot disagree about which
  // machine a nozzle belongs to.
  const serialCol = naming ? `p.serial` : `NULL::text`;
  const slipCol   = naming ? `n.slip_nozzle_no` : `NULL::text`;

  const { rows } = await pool.query(
    `SELECT n.id, n.nozzle_number, n.fuel_type,
            ${naming ? 'n.pump_id' : 'NULL::uuid AS pump_id'},
            ${serialCol} AS pump_serial, ${slipCol} AS slip_nozzle_no
            ${nm.col}${genesis}
       FROM nozzles n
       ${naming ? 'LEFT JOIN pumps p ON p.id = n.pump_id AND p.end_date IS NULL' : ''}
       ${nm.join}
      WHERE n.station_id = $1 AND COALESCE(n.is_active, TRUE)
      ORDER BY n.nozzle_number`, [station_id]);

  const nozzles = rows.map(r => {
    const wants = wantsFor(r);
    return { ...r, events: undefined, wants, ready: wants.length === 0 };
  });
  const missing = nozzles.filter(n => !n.ready).length;
  return {
    spokes_ready: spokesReady,
    // An outlet with no nozzles at all is NOT ready. Switching on a flow whose chain
    // has nowhere to live would look like success and do nothing.
    ready: spokesReady && nozzles.length > 0 && missing === 0,
    nozzles, missing, total: nozzles.length,
  };
}

// COMMISSION ONE OR MORE NOZZLES FROM WHAT A SLIP PRINTED.
//
// entries: [{ nozzle_id, pump_id, serial, slip_nozzle_no, reading, source }]
//
// Every field here comes off the paper and through a human's eye — the screen shows the
// scan and the person confirms it. Nothing in this file infers a printed number from a
// nozzle_number, which is the whole point of the file.
async function commission({ station_id, entries, recorded_by }) {
  const out = { committed: [], skipped: [] };
  if (!station_id || !Array.isArray(entries) || !entries.length) return out;

  for (const e of entries) {
    const nozzle_id = e?.nozzle_id;
    if (!nozzle_id) { out.skipped.push({ nozzle_id: null, why: 'no_nozzle' }); continue; }

    // The nozzle must belong to the outlet being commissioned. Checked here rather
    // than trusted from the body: this loop writes by id.
    const { rows: own } = await pool.query(
      `SELECT n.id, n.pump_id, n.slip_nozzle_no FROM nozzles n
        WHERE n.id=$1 AND n.station_id=$2`, [nozzle_id, station_id]);
    if (!own.length) { out.skipped.push({ nozzle_id, why: 'not_at_this_outlet' }); continue; }

    const serial = String(e.serial || '').trim().toUpperCase();
    const printed = String(e.slip_nozzle_no ?? '').trim();
    if (!printed) { out.skipped.push({ nozzle_id, why: 'no_printed_number' }); continue; }
    if (e.reading == null || e.reading === '' || !Number.isFinite(Number(e.reading))) {
      out.skipped.push({ nozzle_id, why: 'no_reading' }); continue;
    }

    // THE SERIAL GOES THROUGH THE ONE PUMP WRITER. A pump already carrying a serial is
    // left alone — re-serialising a machine is a Settings act under the owner's eye,
    // not something a commissioning scan does on its way past.
    const pump_id = e.pump_id || own[0].pump_id;
    if (serial && pump_id) {
      const { rows: cur } = await pool.query(
        `SELECT serial FROM pumps WHERE id=$1 AND station_id=$2`, [pump_id, station_id]);
      if (cur.length && !String(cur[0].serial || '').trim()) {
        await pumps.updatePump(pump_id, station_id, { serial }, pool);
      }
    }

    // THE PRINTED NUMBER, STORED AS PRINTED. Not COALESCEd: if the outlet is
    // re-commissioning because the first read was wrong, the correction must land.
    await pool.query(
      `UPDATE nozzles SET slip_nozzle_no=$1${e.pump_id ? ', pump_id=$4' : ''}
        WHERE id=$2 AND station_id=$3`,
      e.pump_id ? [printed, nozzle_id, station_id, e.pump_id] : [printed, nozzle_id, station_id]);

    // THE GENESIS EVENT — written through spokeService, the one writer for the chain.
    // A nozzle that already has a chain is NOT given a second genesis: that would be a
    // silent second starting point for a meter, which is the one thing a chain may not
    // have. Its serial and printed number are still corrected above.
    let genesis = null;
    if (await spokes.hasSpokeTables()) {
      const { rows: has } = await pool.query(
        `SELECT 1 FROM nozzle_events WHERE nozzle_id=$1 LIMIT 1`, [nozzle_id]);
      if (!has.length) {
        const r = await spokes.recordEvent({
          station_id, nozzle_id, reading: Number(e.reading),
          // A genesis closes nobody — there is no event before it, and recordEvent
          // derives the closing man from the chain, so this needs saying only here.
          opens_attendant_id: e.opens_attendant_id || null,
          source: e.source === 'typed' ? 'typed' : 'photo',
          recorded_by,
          read_pump_serial: serial || null, read_nozzle_no: printed,
        });
        genesis = r?.event?.id || null;
      }
    }
    out.committed.push({ nozzle_id, slip_nozzle_no: printed, serial: serial || null, genesis });
  }
  return out;
}

module.exports = { readiness, commission, wantsFor };
