// src/services/shiftCloseService.js
//
// ONE writer for "close this shift". The canonical close is PATCH /api/shifts/:id/close;
// the attendant-led auto-close paths in routes/reconcile.js (last-accept and the
// autoclose-check endpoint) must apply exactly the SAME rules, so the core lives here
// and both callers funnel through it (CLAUDE.md: one writer per concept).
//
// The rules, in order — identical to the close route they were extracted from:
//   1. Every DIPPABLE (non-gas) tank must have a closing dip. HARD, never forced —
//      the owner set no override (16-Aug-2026). A closing dip is also the next shift's
//      opening, so a missing one puts the following shift on an invented figure.
//   2. Every operator on the shift must have a reconciliation row, UNLESS force is set
//      (the manual close's confirm=true; and the auto-close, where "all operators
//      confirmed" already IS the all-reconciled condition). The dip gate above is
//      NEVER skipped by force.
//   3. Flip the shift to closed, emit shift:closed (if an io is available), and run the
//      best-effort wet-stock reconciliation + deposit-aging check — the SAME helpers the
//      route calls, imported, not reimplemented. Best-effort: neither blocks the close.
const pool = require('../db/pool');

// Gases are excluded from the mandatory-dip rule — they are stocked in kilograms and
// no dipstick measures a mass. Kept as a SET so LPG is a one-word change, not a
// rediscovery. Mirrors the close route's own filter so the two cannot drift.
const NON_DIPPABLE_FUELS = ['cng'];

// closeShiftIfReady(db, shift_id, { force, io, user_id })
//   -> { closed:false, reason:'missing_dip', tanks }   any dippable tank lacks a closing dip
//   -> { closed:false, reason:'active_pos', pending_count }   operators unreconciled and !force
//   -> { closed:false, reason:'not_open' }              shift was not open (already closed / gone)
//   -> { closed:true,  shift }                          closed; shift:closed emitted, recon run
async function closeShiftIfReady(db = pool, shift_id, { force = false, io = null, user_id = null } = {}) {
  // 0. A SHIFT THAT RECORDED NOTHING HAS NOTHING TO MEASURE.
  //
  //    "Nothing to reconcile" is not "no operator was assigned" — it is "no operator
  //    ever recorded anything". An assignment on its own is an intention, not an
  //    event: no closing meter was read, no settlement was taken, so Pumpini holds
  //    not one figure this shift could be reconciled against.
  //
  //    A closing dip cannot rescue that. Entered today against a shift that has been
  //    open eight days, it measures TODAY'S stock — everything the outlet did in
  //    those eight days, on this shift's account. That is not a control; it is a
  //    fiction with a timestamp, and CLAUDE.md already records where back-solved
  //    readings lead.
  //
  //    THE FIRST CUT OF THIS RULE WAS TOO NARROW. It keyed on operators === 0, which
  //    cleared Dilsukhnagar's 25-Aug shift and left the 19-Aug one — two operators
  //    ASSIGNED, zero closing meters, zero settlements, open 7d 22h — still demanding
  //    both operators be settled and three tanks dipped, every number invented.
  //    Owner: "this is absolute chaos and users are confused on the intent and
  //    content."
  //
  //    STILL NARROW, and this is the line that keeps it safe: ONE closing meter or
  //    ONE settlement anywhere on the shift means real trade was recorded, and the
  //    dip is mandatory again exactly as before. The exemption cannot be reached by
  //    a shift that did any business, only by one that did none.
  const { rows: [act] } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM shift_attendants          a WHERE a.shift_id = $1)                              AS operators,
       (SELECT COUNT(*) FROM shift_attendant_nozzles   n WHERE n.shift_id = $1 AND n.closing_reading IS NOT NULL) AS closes,
       (SELECT COUNT(*) FROM shift_reconciliation      r WHERE r.shift_id = $1)                              AS settlements`,
    [shift_id]);
  const recordedNothing = Number(act.closes) === 0 && Number(act.settlements) === 0;

  // 1. Mandatory closing dip — never forced, but never asked of a shift that
  //    recorded nothing.
  const { rows: unread } = await db.query(
    `SELECT t.tank_number, t.fuel_type
       FROM tanks t
       JOIN shifts s ON s.id = $1
      WHERE t.station_id = s.station_id
        AND LOWER(COALESCE(t.fuel_type,'')) <> ALL($2::text[])
        AND NOT EXISTS (
          SELECT 1 FROM dipstick_readings d
           WHERE d.tank_id = t.id
             AND d.shift_id = $1
             AND d.reading_type = 'closing'
        )
      ORDER BY t.tank_number`,
    [shift_id, NON_DIPPABLE_FUELS]
  );
  if (unread.length && !recordedNothing) return { closed: false, reason: 'missing_dip', tanks: unread };

  // 2. Operators without a reconciliation row — skipped only when force is set.
  const { rows: pending } = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM shift_attendants sa
      WHERE sa.shift_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM shift_reconciliation r
           WHERE r.shift_id = sa.shift_id AND r.attendant_id = sa.attendant_id
        )`,
    [shift_id]
  );
  const pending_count = parseInt(pending[0]?.cnt || 0);
  if (pending_count > 0 && !force) return { closed: false, reason: 'active_pos', pending_count };

  // 3. Flip to closed (guarded on status='open' so a re-run / already-closed shift is a no-op).
  const { rows } = await db.query(
    `UPDATE shifts SET status='closed', end_time=NOW()
      WHERE id=$1 AND status='open' RETURNING *`,
    [shift_id]
  );
  if (!rows.length) return { closed: false, reason: 'not_open' };
  const shift = rows[0];

  if (io) io.to(`station:${shift.station_id}`).emit('shift:closed', shift);
  // Best-effort wet-stock (tank dip) reconciliation — the SAME helper the route calls.
  try { await require('../routes/tankReco').finalizeShiftReco(shift_id, user_id, io); } catch (e) { /* non-blocking */ }
  // Aging check: alert the owner if sales cash has been sitting undeposited too long.
  try { await require('../routes/cashDeposits').checkDepositAging(shift.station_id, io); } catch (e) { /* non-blocking */ }

  return { closed: true, shift };
}

module.exports = { closeShiftIfReady, NON_DIPPABLE_FUELS };
