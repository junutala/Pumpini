// SPOKE 1 — TANK RECON.
//
// WHICH ROUTE THIS CLOSES: none, and that is deliberate rather than an oversight. The
// cardinal rule asks a new route to say what it replaces; a recon is a concept that
// has no writer today. /api/dipstick writes a dip, /api/reconcile settles an operator,
// /api/tank-reco COMPUTES over a shift or a date range and writes nothing of its own.
// None of them owns "the tank read and every nozzle read at one moment". All the
// arithmetic is borrowed rather than rewritten — lib/varianceMath — so this adds a
// record, not a second opinion.
//
// EVERY HANDLER TAKES station_id EXPLICITLY and checks the recon against it, rather
// than scoping through requireStationVia. That middleware would SELECT from
// tank_recons, which is owner-run DDL and may not exist yet: the guard itself would
// throw before the handler could answer honestly that the feature is not migrated.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const recon = require('../services/reconService');

// The one sentence for "the owner has not run the DDL yet". A 503 rather than a 404:
// the feature exists, this deployment simply cannot serve it, and the screen should
// say come back rather than that the page is wrong.
const NOT_MIGRATED = { error: 'not_migrated', message: 'Tank Recon is not switched on for this database yet.' };

// The recon must belong to the station the caller was cleared for. Without this an id
// from another outlet would be readable by anyone holding access to their own.
async function ownedBy(recon_id, station_id) {
  const { rows } = await pool.query(
    `SELECT id, station_id, status FROM tank_recons WHERE id=$1`, [recon_id]);
  const r = rows[0];
  return (r && String(r.station_id) === String(station_id)) ? r : null;
}

// GET /api/tank-recon?station_id=
// The landing: the LAST CONFIRMED recon, and his own unfinished draft if he has one.
// Never current stock — that figure would be the last dip plus assumptions, and a
// manager reads it as a measurement.
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    if (!(await recon.hasReconTables())) return res.json({ enabled: false, last: null, draft: null });
    const station_id = req.query.station_id;
    const [last, draft] = await Promise.all([
      recon.lastConfirmed(station_id),
      recon.openDraft(station_id),
    ]);
    res.json({ enabled: true, last, draft });
  } catch (err) { next(err); }
});

// POST /api/tank-recon/draft { station_id }
// Create-or-get. Never a second draft at one outlet: two men reconciling the same
// tanks over overlapping windows means the later confirm silently wins.
router.post('/draft', authenticate, requireStationAccess({ required: true }),
  requirePerm('stock.reconcile'), async (req, res, next) => {
    try {
      if (!(await recon.hasReconTables())) return res.status(503).json(NOT_MIGRATED);
      const draft = await recon.startDraft(req.body.station_id, req.user.id);
      res.status(201).json(draft);
    } catch (err) { next(err); }
  });

// POST /api/tank-recon/:id/figures { station_id, tanks[], nozzles[] }
// SAVED BEFORE HE DECIDES. Upserts, so the screen may send the whole set on every
// change without minding what moved, and a dropped connection costs nothing.
router.post('/:id/figures', authenticate, requireStationAccess({ required: true }),
  requirePerm('stock.reconcile'), async (req, res, next) => {
    try {
      if (!(await recon.hasReconTables())) return res.status(503).json(NOT_MIGRATED);
      const owned = await ownedBy(req.params.id, req.body.station_id);
      if (!owned) return res.status(404).json({ error: 'not_found', message: 'That recon is not at this outlet.' });
      const saved = await recon.saveFigures(req.params.id, req.body);
      if (saved?.locked) {
        return res.status(409).json({
          error: 'recon_confirmed',
          message: 'This recon is already confirmed, so its figures can no longer be changed.',
        });
      }
      res.json(saved);
    } catch (err) { next(err); }
  });

// GET /api/tank-recon/:id/variance?station_id=
// Computed and RETURNED, never written — he sees what he is about to confirm before
// anything is frozen.
router.get('/:id/variance', authenticate, requireStationAccess({ required: true }),
  async (req, res, next) => {
    try {
      if (!(await recon.hasReconTables())) return res.status(503).json(NOT_MIGRATED);
      const owned = await ownedBy(req.params.id, req.query.station_id);
      if (!owned) return res.status(404).json({ error: 'not_found', message: 'That recon is not at this outlet.' });
      res.json(await recon.computeVariance(req.params.id));
    } catch (err) { next(err); }
  });

// POST /api/tank-recon/:id/confirm { station_id }
// Freezes the arithmetic onto the row. From here it is the boundary the next window
// starts from, which is why it cannot be edited afterwards.
router.post('/:id/confirm', authenticate, requireStationAccess({ required: true }),
  requirePerm('stock.reconcile'), async (req, res, next) => {
    try {
      if (!(await recon.hasReconTables())) return res.status(503).json(NOT_MIGRATED);
      const owned = await ownedBy(req.params.id, req.body.station_id);
      if (!owned) return res.status(404).json({ error: 'not_found', message: 'That recon is not at this outlet.' });
      const out = await recon.confirm(req.params.id, req.user.id);
      if (out?.locked) {
        return res.status(409).json({
          error: 'recon_confirmed',
          message: 'This recon was already confirmed.',
        });
      }
      res.json(out);
    } catch (err) { next(err); }
  });

// POST /api/tank-recon/:id/abandon { station_id }
// START AGAIN KEEPS IT. Marked abandoned, never deleted — a recon that vanishes when a
// man changes his mind is a recon he will not start twice.
router.post('/:id/abandon', authenticate, requireStationAccess({ required: true }),
  requirePerm('stock.reconcile'), async (req, res, next) => {
    try {
      if (!(await recon.hasReconTables())) return res.status(503).json(NOT_MIGRATED);
      const owned = await ownedBy(req.params.id, req.body.station_id);
      if (!owned) return res.status(404).json({ error: 'not_found', message: 'That recon is not at this outlet.' });
      const out = await recon.abandon(req.params.id);
      if (!out) return res.status(409).json({ error: 'recon_confirmed', message: 'Only a draft can be started again.' });
      res.json(out);
    } catch (err) { next(err); }
  });

module.exports = router;
