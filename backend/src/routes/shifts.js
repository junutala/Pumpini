// src/routes/shifts.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const { sendAlert } = require('../services/alertService');
const artifacts  = require('../services/artifactService');
const attendance = require('../services/attendanceService');

const openings   = require('../services/openingService');

// GET /api/shifts
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, date, status } = req.query;
    let q = `
      SELECT s.*, u.name AS manager_name,
        COUNT(DISTINCT sa.attendant_id)::int AS attendant_count,
        COALESCE(SUM(de.amount),0) AS total_sales,
        -- Entry mode: manager-driven closes synthesize source='manager' rows,
        -- POS-in-bay shifts only have live per-fill rows.
        COUNT(DISTINCT de.id) FILTER (WHERE de.source='manager')::int AS manager_events,
        COUNT(DISTINCT de.id) FILTER (WHERE de.source IS DISTINCT FROM 'manager')::int AS pos_events
      FROM shifts s
      LEFT JOIN users u ON u.id = s.manager_id
      LEFT JOIN shift_attendants sa ON sa.shift_id = s.id
      LEFT JOIN dispense_events de ON de.shift_id = s.id AND NOT COALESCE(de.is_voided,FALSE)
      WHERE 1=1
    `;
    const p = [];
    if (station_id) { p.push(station_id); q += ` AND s.station_id=$${p.length}`; }
    if (date)       { p.push(date);       q += ` AND s.date=$${p.length}`; }
    if (status)     { p.push(status);     q += ` AND s.status=$${p.length}`; }
    q += ' GROUP BY s.id, u.name ORDER BY s.date DESC, s.shift_number';
    const { rows } = await pool.query(q, p);
    // Blind drop: non-owners don't see sales for an OPEN shift
    const isOwner = req.user.role === 'owner';
    const out = rows.map(r => (!isOwner && r.status === 'open')
      ? { ...r, total_sales: null, sales_hidden: true } : r);
    res.json(out);
  } catch (err) { next(err); }
});

// GET /api/shifts/active?station_id= — the open shift the LOGGED-IN user is
// assigned to (via shift_attendants). The POS uses this instead of "the first
// open shift", so when more than one shift is open at once the operator's
// reconciliation attaches to the correct shift. Returns null if not assigned to
// any open shift (e.g. an owner who hasn't taken a nozzle).
// NOTE: must be declared before '/:id' so it isn't captured as an id.
router.get('/active', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(`
      SELECT s.* FROM shifts s
      JOIN shift_attendants sa ON sa.shift_id = s.id
      WHERE s.station_id = $1 AND s.status = 'open' AND sa.attendant_id = $2
      ORDER BY s.start_time DESC LIMIT 1`,
      [station_id, req.user.id]);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

// GET /api/shifts/:id
router.get('/:id', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, u.name AS manager_name FROM shifts s
      LEFT JOIN users u ON u.id = s.manager_id
      WHERE s.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Shift not found' });

    const { rows: attendants } = await pool.query(`
      SELECT sa.*, u.name AS attendant_name, r.tag_uid,
        n.nozzle_number, n.fuel_type,
        COALESCE(SUM(de.amount),0) AS total_sales,
        COALESCE(SUM(de.quantity_ltrs),0) AS total_ltrs
      FROM shift_attendants sa
      JOIN users u ON u.id = sa.attendant_id
      LEFT JOIN rfid_tags r ON r.id = sa.rfid_tag_id
      LEFT JOIN nozzles n ON n.id = sa.nozzle_id
      LEFT JOIN dispense_events de ON de.shift_id = sa.shift_id
        AND de.attendant_id = sa.attendant_id AND NOT COALESCE(de.is_voided,FALSE)
      WHERE sa.shift_id = $1
      GROUP BY sa.id, u.name, r.tag_uid, n.nozzle_number, n.fuel_type`,
      [req.params.id]);

    // Attach each operator's nozzles (one operator → many nozzles).
    const { rows: sanRows } = await pool.query(`
      SELECT san.attendant_id, san.nozzle_id, san.opening_reading, san.closing_reading,
             n.nozzle_number, n.fuel_type
      FROM shift_attendant_nozzles san
      JOIN nozzles n ON n.id = san.nozzle_id
      WHERE san.shift_id = $1
      ORDER BY n.nozzle_number`, [req.params.id]);
    const nozBy = {};
    for (const r of sanRows) (nozBy[r.attendant_id] ||= []).push(r);
    attendants.forEach(a => { a.nozzles = nozBy[a.attendant_id] || []; });

    // Each operator's start/close photographs and his shift clock. Both are
    // guarded on the migration having run — this is the screen that starts and
    // ends shifts, so a missing table must leave it working without the photos
    // rather than 500 the whole page.
    if (attendants.length && await artifacts.hasTable()) {
      const saIds = attendants.map(a => a.id);
      const { rows: photos } = await pool.query(
        `SELECT id, entity_id, kind, meta, captured_at FROM station_artifacts
          WHERE entity_type='shift_attendant' AND kind='attendant_photo'
            AND entity_id = ANY($1::uuid[])
          ORDER BY captured_at`, [saIds]);
      const byAssignment = {};
      for (const p of photos) {
        const slot = (byAssignment[p.entity_id] ||= { start: null, close: null });
        slot[p.meta?.phase === 'close' ? 'close' : 'start'] = p.id;
      }
      attendants.forEach(a => {
        a.photo_start_artifact_id = byAssignment[a.id]?.start || null;
        a.photo_close_artifact_id = byAssignment[a.id]?.close || null;
      });
    }
    // The shift clock now lives in its own table (shift_attendance), keyed on the
    // shift rather than on (user, date, slot) — so these read started_at/ended_at
    // off the attendant, not check_in/check_out off an HR register row.
    const clocks = await attendance.forShift(req.params.id);
    const clockBy = {};
    for (const c of clocks) clockBy[c.attendant_id] = c;
    attendants.forEach(a => {
      a.started_at   = clockBy[a.attendant_id]?.started_at || null;
      a.ended_at     = clockBy[a.attendant_id]?.ended_at   || null;
      a.hours_worked = clockBy[a.attendant_id]?.hours      || null;
    });

    // Blind drop: hide per-attendant sales while the shift is open (non-owners)
    const isOwner = req.user.role === 'owner';
    const hide = !isOwner && rows[0].status === 'open';
    const att = hide
      ? attendants.map(a => ({ ...a, total_sales: null, total_ltrs: null, sales_hidden: true }))
      : attendants;
    res.json({ ...rows[0], attendants: att });
  } catch (err) { next(err); }
});

// POST /api/shifts  — open a new shift
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('shifts.manage'), async (req, res, next) => {
  try {
    const { station_id, shift_number, date } = req.body;
    const { rows: existing } = await pool.query(
      `SELECT id FROM shifts WHERE station_id=$1 AND date=$2 
       AND shift_number=$3 AND status='open'`,
      [station_id, date, shift_number]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'A shift is already open for this slot' });
    }
    const { rows } = await pool.query(
      `INSERT INTO shifts(station_id,shift_number,date,start_time,manager_id,status)
       VALUES($1,$2,$3,NOW(),$4,'open') RETURNING *`,
      [station_id, shift_number, date, req.user.id]
    );

    // The previous close IS this shift's open. Seed the opening dips from each
    // tank's last closing dip before anyone can type one, so no litre can go
    // missing in a gap between two shifts. Best-effort: a tank with no prior close
    // is left for the shift-start screen to ask about, and a failure here never
    // stops a shift opening. See services/openingService.
    const seeded = await openings.seedOpeningDips(rows[0].id, req.user.id);

    req.io.to(`station:${station_id}`).emit('shift:opened', rows[0]);
    res.status(201).json({ ...rows[0], opening_dips_carried: seeded.length });
  } catch (err) { next(err); }
});

// DELETE /api/shifts/:id — remove an ORPHAN shift opened by mistake.
// Owner-approved guard: only when this shift has NO operators assigned AND another
// shift on the SAME station+date DOES have operators — so you can delete an empty
// stray, never the real working shift. Also refuses if any real activity exists
// (sales, reconciliation, invoices, deliveries, suspense). Cleans up the orphan's
// opening dips (dipstick_readings doesn't cascade); the rest cascade on delete.
router.delete('/:id', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'id'),
  requirePerm('shifts.manage'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { rows: sh } = await client.query('SELECT station_id, date FROM shifts WHERE id=$1', [id]);
      if (!sh.length) { client.release(); return res.status(404).json({ error: 'Shift not found' }); }
      const { station_id, date } = sh[0];

      // 1) Must have no operators of its own.
      const { rows: own } = await client.query('SELECT COUNT(*)::int n FROM shift_attendants WHERE shift_id=$1', [id]);
      if (own[0].n > 0) { client.release(); return res.status(409).json({ error: 'Cannot delete: this shift has operators assigned.' }); }

      // 2) Must carry no real activity (belt-and-braces — an orphan shouldn't have any).
      const { rows: act } = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM dispense_events       WHERE shift_id=$1) +
          (SELECT COUNT(*) FROM shift_reconciliation  WHERE shift_id=$1) +
          (SELECT COUNT(*) FROM product_invoices      WHERE shift_id=$1) +
          (SELECT COUNT(*) FROM fuel_deliveries       WHERE shift_id=$1) +
          (SELECT COUNT(*) FROM credit_suspense_entries WHERE shift_id=$1) AS n`, [id]);
      if (Number(act[0].n) > 0) { client.release(); return res.status(409).json({ error: 'Cannot delete: this shift has recorded activity (sales / settlement / invoices / deliveries).' }); }

      // 3) Another shift on the same date must have operators (the real one exists).
      const { rows: sib } = await client.query(`
        SELECT COUNT(*)::int n FROM shifts s2
        JOIN shift_attendants sa ON sa.shift_id = s2.id
        WHERE s2.station_id=$1 AND s2.date=$2 AND s2.id<>$3`, [station_id, date, id]);
      if (sib[0].n === 0) { client.release(); return res.status(409).json({ error: 'Cannot delete: no other shift with operators on this date — refusing to remove the only shift.' }); }

      // Safe to remove. Clear the orphan's opening dips (no cascade), then delete
      // (shift_nozzle_readings / cash_denominations / meter_photos etc. cascade).
      await client.query('BEGIN');
      await client.query('DELETE FROM dipstick_readings WHERE shift_id=$1', [id]);
      await client.query('DELETE FROM shifts WHERE id=$1', [id]);
      await client.query('COMMIT');
      req.io?.to(`station:${station_id}`).emit('shift:deleted', { id });
      res.json({ deleted: true });
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
    finally { client.release(); }
  });

// POST /api/shifts/:id/assign  — add attendant to shift
router.post('/:id/assign', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'id'), requirePerm('shifts.manage'), async (req, res, next) => {
  try {
    const {
      attendant_id, rfid_tag_id, nozzle_id,
      bank_account, upi_vpa, opening_reading, opening_cash,
      nozzles,   // NEW: [{ nozzle_id, opening_reading }] — one operator, many nozzles
      // The photograph taken of the operator as he starts. Optional — a broken
      // camera must never stop a shift starting — and stored as an artifact
      // against his assignment. Today it is evidence; the intended end state is
      // that the picture IDENTIFIES him and the picker becomes the fallback, so
      // it is captured against the assignment now rather than bolted on later.
      photo_base64, photo_media_type, face_match,
    } = req.body;

    if (!attendant_id) return res.status(400).json({ error: 'Attendant is required' });

    // Normalise to a nozzle list (back-compat with the single nozzle_id form).
    const nozzleList = (Array.isArray(nozzles) && nozzles.length
      ? nozzles
      : (nozzle_id ? [{ nozzle_id, opening_reading }] : []))
      .filter(n => n && n.nozzle_id);
    // nozzle_id is optional in the manager-driven flow (no nozzle-level detail).
    // Opening float must be stated explicitly (₹0 is fine) — a forgotten float
    // silently becomes 0 and shows up that evening as a phantom OVERAGE of the
    // float amount, undermining the blind-drop variance.
    if (opening_cash === undefined || opening_cash === null || opening_cash === '') {
      return res.status(400).json({ error: 'Opening cash (float) is required — enter 0 if no float is given.' });
    }
    const floatNum = Number(opening_cash);
    if (!Number.isFinite(floatNum) || floatNum < 0 || floatNum > 1000000) {
      return res.status(400).json({ error: 'Invalid opening cash amount.' });
    }

    // Each nozzle is manned by exactly one operator per shift — reject any nozzle
    // already taken by a DIFFERENT operator (the child table is the source of truth).
    for (const nz of nozzleList) {
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM shift_attendant_nozzles
         WHERE shift_id=$1 AND nozzle_id=$2 AND attendant_id<>$3`,
        [req.params.id, nz.nozzle_id, attendant_id]);
      if (dup.length) {
        return res.status(409).json({ error: 'A selected nozzle is already assigned to another operator in this shift.' });
      }
    }

    // Check UPI VPA not already assigned in this shift
    if (upi_vpa) {
      const { rows: vpaCheck } = await pool.query(
        `SELECT id FROM shift_attendants WHERE shift_id=$1 AND upi_vpa=$2`,
        [req.params.id, upi_vpa]
      );
      if (vpaCheck.length) {
        return res.status(409).json({ error: 'This UPI VPA is already assigned to another attendant in this shift' });
      }
    }

    // One attendant can't be live on two shifts at once. Reject if they're still
    // assigned to a DIFFERENT open shift that hasn't been reconciled yet. Works
    // for both modes: POS submit and manager-mode close both write a
    // shift_reconciliation row, which "releases" the attendant for the next shift.
    // (Overlapping shifts during changeover are fine — only the same attendant
    // being un-reconciled on two open shifts is blocked.)
    const { rows: busy } = await pool.query(`
      SELECT 1
      FROM shift_attendants sa
      JOIN shifts s ON s.id = sa.shift_id
      WHERE sa.attendant_id = $1
        AND sa.shift_id <> $2
        AND s.status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM shift_reconciliation r
          WHERE r.shift_id = sa.shift_id AND r.attendant_id = sa.attendant_id
        )
      LIMIT 1`,
      [attendant_id, req.params.id]);
    if (busy.length) {
      return res.status(409).json({ error: 'This attendant is still on an open shift (not yet reconciled). Reconcile/close their current shift before assigning them to another.' });
    }

    // Activate RFID tag if provided
    if (rfid_tag_id) {
      await pool.query('UPDATE rfid_tags SET is_active=TRUE WHERE id=$1', [rfid_tag_id]);
    }

    // THE OPENING METER IS THE LAST CLOSING METER — decided here, on the server,
    // not pre-filled in the browser. A control the client can type over is not a
    // control: allowing a shift to open a nozzle at a different figure from where
    // the last one closed it leaves the litres in between on nobody's settlement.
    // Where a prior close exists the client's number is IGNORED and only recorded
    // as `requested`, so a manager reading something different off the slip shows
    // up as a discrepancy to investigate rather than silently becoming the opening.
    const openingMap = await openings.nozzleOpenings(req.params.id);
    const resolved = nozzleList.map(nz => ({
      nozzle_id: nz.nozzle_id,
      ...openings.resolveNozzleOpening(openingMap[nz.nozzle_id], nz.opening_reading),
    }));
    const carryConflicts = resolved.filter(r => r.overridden).map(r => ({
      nozzle_id: r.nozzle_id,
      nozzle_number: openingMap[r.nozzle_id]?.nozzle_number,
      carried: r.opening,
      entered: r.requested,
    }));
    const openingFor = {};
    for (const r of resolved) openingFor[r.nozzle_id] = r.opening;

    // The operator row is now about the OPERATOR — who he is, his cash float, his
    // bank details. It no longer carries a meter reading. It used to mirror the
    // FIRST nozzle's opening onto sa.opening_reading for the single-nozzle
    // settlement path; that path is retired, and the mirror was a lie whenever a
    // man worked more than one nozzle. Meters live in shift_attendant_nozzles,
    // one row per nozzle, and nowhere else.
    const first = nozzleList[0] || {};
    const { rows } = await pool.query(
      `INSERT INTO shift_attendants(
         shift_id, attendant_id, rfid_tag_id, nozzle_id,
         bank_account, upi_vpa, opening_cash
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(shift_id, attendant_id) DO UPDATE SET
         rfid_tag_id=$3, nozzle_id=$4, bank_account=$5,
         upi_vpa=$6, opening_cash=$7
       RETURNING *`,
      [req.params.id, attendant_id, rfid_tag_id||null, first.nozzle_id||null,
       bank_account||null, upi_vpa||null, opening_cash||0]
    );

    // Replace this operator's nozzle set (clean re-assign on edit).
    await pool.query('DELETE FROM shift_attendant_nozzles WHERE shift_id=$1 AND attendant_id=$2',
      [req.params.id, attendant_id]);
    for (const nz of nozzleList) {
      await pool.query(
        `INSERT INTO shift_attendant_nozzles(shift_id, attendant_id, nozzle_id, opening_reading)
         VALUES($1,$2,$3,$4)`,
        [req.params.id, attendant_id, nz.nozzle_id, openingFor[nz.nozzle_id] ?? 0]);
    }

    // Store the operator's photograph against this assignment, then stamp his
    // shift clock. Both are best-effort by design (see attendanceService): the
    // assignment above is what lets fuel be sold, and neither a failed upload nor
    // a missing attendance row may undo it. `meta.match` is left for the facial
    // verdict once matching lands — the record shape does not change then.
    // requireStationVia resolved the shift's station and put it here.
    const photo = await artifacts.save({
      station_id: req.stationId,
      entity_type: 'shift_attendant',
      entity_id: rows[0].id,
      kind: 'attendant_photo',
      file_base64: photo_base64 || null,
      media_type: photo_media_type || null,
      // The facial verdict, recorded as what the CAMERA thought — never as what
      // happened. attendant_id above is the manager's decision and is the truth;
      // this sits beside it so a later audit can ask how often the two agreed, and
      // so a disagreement (the camera said one man, the manager chose another) is
      // visible rather than lost. Sanitised, because it arrives from a phone.
      meta: { phase: 'start', attendant_id, shift_id: req.params.id,
              ...(artifacts.cleanMatch(face_match) ? { match: artifacts.cleanMatch(face_match) } : {}) },
      uploaded_by: req.user.id,
    });
    const clock = await attendance.clockIn({
      shift_id: req.params.id,
      attendant_id,
      artifact_id: photo ? photo.id : null,
      recorded_by: req.user.id,
    });

    res.json({
      ...rows[0],
      nozzles: resolved.map(r => ({ nozzle_id: r.nozzle_id, opening_reading: r.opening, source: r.source })),
      // Non-empty when what the manager entered differed from the carried close.
      // The assignment still succeeded on the carried figure — this is for the
      // screen to surface, and for the owner to look into.
      carry_conflicts: carryConflicts,
      photo_artifact_id: photo ? photo.id : null,
      started_at: clock ? clock.check_in : null,
    });
  } catch (err) { next(err); }
});

// GET /api/shifts/:id/nozzle-openings — the opening per nozzle. NOT a suggestion:
// where a prior close exists this is the figure the assignment will use, whatever
// the screen sends (see services/openingService and POST /:id/assign). The screen
// reads it to show the manager the number and where it came from.
//
// `suggested_opening` is kept in the payload under its old name because other
// callers read it; `source` is what tells the screen whether the box is fixed
// ('carried') or genuinely needs a figure:
//   'entered' — no prior leg at all: a newly commissioned nozzle or the first shift.
//   'pending' — the shift before this one has the nozzle and has not been settled, so
//               its closing does not exist yet. `pending_on` names that shift so the
//               screen can say WHICH one, rather than calling a working nozzle new.
router.get('/:id/nozzle-openings', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'id'),
  async (req, res, next) => {
  try {
    const map = await openings.nozzleOpenings(req.params.id);
    res.json(Object.values(map).map(o => ({
      nozzle_id: o.nozzle_id,
      nozzle_number: o.nozzle_number,
      fuel_type: o.fuel_type,
      suggested_opening: o.carried_opening,
      source: o.source,
      pending_on: o.pending_on,
    })));
  } catch (err) { next(err); }
});

// Keep old route for backwards compatibility
router.post('/:id/assign-rfid', authenticate, async (req, res, next) => {
  req.url = `/${req.params.id}/assign`;
  next('route');
});

// PATCH /api/shifts/:id/close
router.patch('/:id/close', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'id'), requirePerm('shifts.manage'), async (req, res, next) => {
  try {
    // 🔴 EVERY DIPPABLE TANK MUST BE READ BEFORE THE SHIFT CLOSES. (owner-set
    // 16-Aug-2026.) The mirror of the rule the settlement has always enforced on
    // meters: computeLegs refuses to settle an operator with a nozzle unaccounted
    // for. Tanks had no equivalent — the close never looked at dips at all, and the
    // wet-stock reconciliation below is explicitly best-effort — so a closing dip
    // was in practice optional. That is how Highway and Adhoc Highway ran three
    // days with opening dips and no closing ones.
    //
    // A closing dip is also the NEXT shift's opening, so a missing one does not
    // just lose today's stock figure; it puts the following shift on an invented
    // one. Hence server-side and absolute: there is deliberately NO force flag
    // here, unlike the POS check below. The owner asked for no override.
    //
    // GASES ARE EXCLUDED, and this is not a softening of "every tank" — it is a
    // physical fact. CNG is sold and stocked in KILOGRAMS; no dipstick measures a
    // mass, and there is no calibration chart to convert one. The data says the
    // same thing unprompted: across the whole estate every CNG tank has zero
    // charts and zero closing dips ever recorded, while the liquid tanks have 510
    // between them. Kamala's tank 4 is CNG, so counting it would have made that
    // outlet's shifts permanently unclosable — the rule meant to protect the
    // stock record would have taken down the close path at the biggest real
    // outlet instead.
    //
    // Kept as a SET rather than `<> 'cng'` because the exception belongs to gases,
    // not to one product name: LPG would arrive with exactly the same problem and
    // should be a one-word change here, not a rediscovery of this whole argument.
    // This mirrors the dip screen's own filter, so the screen and the server
    // cannot drift apart on what "every tank" means.
    const NON_DIPPABLE_FUELS = ['cng'];
    const { rows: unread } = await pool.query(
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
      [req.params.id, NON_DIPPABLE_FUELS]
    );
    if (unread.length) {
      const names = unread.map(t => `Tank ${t.tank_number}`).join(', ');
      return res.status(409).json({
        error: 'missing_closing_dip',
        tanks: unread,
        message: `Closing dip missing for ${names}. Every tank must be read before this shift can close.`,
      });
    }

    // Count attendants who have NOT yet submitted reconciliation for this shift
    const { rows: pending } = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM shift_attendants sa
       WHERE sa.shift_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM shift_reconciliation r
           WHERE r.shift_id = sa.shift_id AND r.attendant_id = sa.attendant_id
         )`,
      [req.params.id]
    );
    const pendingCount = parseInt(pending[0]?.cnt || 0);

    // Require explicit confirm=true if attendants still active
    if (pendingCount > 0 && req.body.confirm !== true) {
      return res.status(409).json({
        error: 'active_pos',
        pending_count: pendingCount,
        message: `${pendingCount} attendant${pendingCount > 1 ? 's have' : ' has'} not yet closed their POS session. Force close anyway?`,
      });
    }

    const { rows } = await pool.query(
      `UPDATE shifts SET status='closed', end_time=NOW()
       WHERE id=$1 AND status='open' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Shift not found or already closed' });
    }
    req.io.to(`station:${rows[0].station_id}`).emit('shift:closed', rows[0]);
    // Best-effort: run wet-stock (tank dip) reconciliation for tanks that have a
    // closing dip, and alert the owner on any variance beyond tolerance. Never
    // blocks the close.
    try { await require('./tankReco').finalizeShiftReco(req.params.id, req.user.id, req.io); } catch (e) { /* non-blocking */ }
    // Aging check: if sales cash has been sitting undeposited too long, alert owner.
    try { await require('./cashDeposits').checkDepositAging(rows[0].station_id, req.io); } catch (e) { /* non-blocking */ }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/shifts/:id/events
router.get('/:id/events', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT de.*, u.name AS attendant_name, n.nozzle_number, r.tag_uid,
             sh.status AS shift_status
      FROM dispense_events de
      LEFT JOIN users u ON u.id = de.attendant_id
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      LEFT JOIN rfid_tags r ON r.id = de.rfid_tag_id
      LEFT JOIN shifts sh ON sh.id = de.shift_id
      WHERE de.shift_id = $1
      ORDER BY de.event_seq`, [req.params.id]);
    // Blind drop: non-owners don't see sale amounts while the shift is open
    const isOwner = req.user.role === 'owner';
    const out = rows.map(r => (!isOwner && r.shift_status === 'open')
      ? { ...r, amount: null, quantity_ltrs: null, sales_hidden: true } : r);
    res.json(out);
  } catch (err) { next(err); }
});

// GET /api/shifts/definitions/:station_id
router.get('/definitions/:station_id', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shift_definitions WHERE station_id=$1 ORDER BY shift_number`,
      [req.params.station_id]
    );
    // Return defaults if none set
    if (!rows.length) {
      return res.json([
        { shift_number:1, name:'Morning',   start_time:'06:00', end_time:'14:00' },
        { shift_number:2, name:'Afternoon', start_time:'14:00', end_time:'22:00' },
        { shift_number:3, name:'Night',     start_time:'22:00', end_time:'06:00' },
      ]);
    }
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/shifts/definitions — save shift definitions
router.post('/definitions', authenticate, requireStationAccess({ required: true }), requirePerm('shifts.manage'), async (req, res, next) => {
  try {
    const { station_id, shifts } = req.body;
    for (const s of shifts) {
      await pool.query(
        `INSERT INTO shift_definitions(station_id,shift_number,name,start_time,end_time)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(station_id,shift_number) DO UPDATE SET
           name=$3, start_time=$4, end_time=$5`,
        [station_id, s.shift_number, s.name, s.start_time, s.end_time]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
