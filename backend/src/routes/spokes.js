// SPOKE 2 (the nozzle chain) and SPOKE 3 (the attendant).
//
// WHICH ROUTES THESE CLOSE: none yet, and that is the point of a migration. The shift
// flow's own settlement routes stay exactly as they are until the last outlet has
// moved; a route you plan to close is a migration, a route nobody closes is drift. The
// date for closing them is when Kamala, Highway and Adhoc are on this flow.
//
// All the arithmetic lives in services/spokeService — the outstanding is DERIVED there
// and no route may accept one as an input.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const spokes = require('../services/spokeService');

const NOT_MIGRATED = {
  error: 'not_migrated',
  message: 'Nozzle Events and Attendant Dues are not switched on for this database yet.',
};

// GET /api/spokes/chain?station_id=&nozzle_id=
// The chain, newest first. Read-only.
router.get('/chain', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    if (!(await spokes.hasSpokeTables())) return res.json({ enabled: false, events: [] });
    res.json({
      enabled: true,
      events: await spokes.chain(req.query.station_id, {
        nozzle_id: req.query.nozzle_id || null, limit: req.query.limit,
      }),
    });
  } catch (err) { next(err); }
});

// GET /api/spokes/nozzles?station_id=
// WHERE EVERY NOZZLE STANDS — last reading, when, and the man it is open against. The
// handover screen shows this before it asks for anything, so the manager confirms
// rather than remembers.
router.get('/nozzles', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    res.json({
      enabled: await spokes.hasSpokeTables(),
      nozzles: await spokes.nozzleState(req.query.station_id),
    });
  } catch (err) { next(err); }
});

// POST /api/spokes/event
// A HANDOVER. One reading closes one man's account and opens the next's.
//
// THE PUMP IS NEVER BLOCKED and there is no override to build: if a man walks off
// without printing, the next man's scan IS the closing event and the outstanding
// stands against the man who left. What CAN be refused is a figure the physics says
// cannot be true — and only until he types a reason in his own words.
router.post('/event', authenticate, requireStationAccess({ required: true }),
  requirePerm('reconcile.manage'), async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) return res.status(503).json(NOT_MIGRATED);
      const { station_id, nozzle_id, reading } = req.body;
      if (!nozzle_id || reading == null || reading === '') {
        return res.status(400).json({ error: 'bad_request', message: 'A nozzle and a reading are required.' });
      }
      // NAMED, NOT SPREAD. The body is a manager's input; who a reading CLOSES is
      // derived from the chain inside spokeService and must not be reachable from here.
      const out = await spokes.recordEvent({
        station_id, nozzle_id, reading,
        opens_attendant_id: req.body.opens_attendant_id || null,
        source: req.body.source, drift_reason: req.body.drift_reason,
        read_pump_serial: req.body.read_pump_serial, read_nozzle_no: req.body.read_nozzle_no,
        recorded_by: req.user.id,
      });
      if (out?.refused) {
        const v = out.refused;
        return res.status(409).json({
          error: v.code,
          // The two certainties, in words a manager can act on. Everything else is
          // trade and is recorded as drift without a murmur.
          message: v.code === 'reading_decreased'
            ? `That reading is ${Math.abs(v.delta).toLocaleString('en-IN')} L BELOW the last one. A totaliser only counts up, so this is a reset, a replacement or a misread — say which, in your own words.`
            : `That is ${Math.round(v.delta).toLocaleString('en-IN')} L in ${v.seconds} seconds, and the pump cannot deliver more than about ${Math.round(v.ceiling).toLocaleString('en-IN')} L in that time. Check the figure, or say what happened.`,
          detail: v,
        });
      }
      res.status(201).json(out);
    } catch (err) { next(err); }
  });

// GET /api/spokes/outstanding?station_id=
// WHAT EACH MAN OWES — calculated, never stored, never typed.
router.get('/outstanding', authenticate, requireStationAccess({ required: true }),
  async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) return res.json({ enabled: false, attendants: [] });
      res.json({ enabled: true, attendants: await spokes.outstanding(req.query.station_id) });
    } catch (err) { next(err); }
  });

// POST /api/spokes/settle
// WHAT HE BROUGHT. The only manual entry in Spoke 3, and there is deliberately no
// field for the outstanding: a manager cannot make a liability vanish by leaving one
// blank, because there is none to leave blank.
// GET /api/spokes/outstanding/:attendant_id/detail?station_id=…
//
// The working behind one man's figure — every leg, both readings, the price, the
// multiplication. Owner, 29-Aug-2026: "wherever money is involved, we should show as
// much info as possible so that the manager also knows that we are supporting him in
// his work rather than extending his work."
//
// Read-only, and on the same permission as the settlement it explains: a man allowed
// to take the money is allowed to see how the figure was reached. Anything less and
// he is being asked to trust it.
router.get('/outstanding/:attendant_id/detail', authenticate, requireStationAccess({ required: true }),
  requirePerm('settlement.enter'), async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) return res.status(503).json(NOT_MIGRATED);
      const station_id = req.query.station_id || req.stationId;
      res.json(await spokes.outstandingDetail(station_id, req.params.attendant_id));
    } catch (err) { next(err); }
  });

router.post('/settle', authenticate, requireStationAccess({ required: true }),
  requirePerm('settlement.enter'), async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) return res.status(503).json(NOT_MIGRATED);
      const out = await spokes.settle({ ...req.body, recorded_by: req.user.id });
      if (out?.refused === 'nothing_brought') {
        // IT MAY NOT COMPLETE SILENTLY AT ZERO. That is precisely how Rs 1,25,275 left
        // three settlements on 25-Aug with cash_actual = 0 and nobody the wiser.
        return res.status(400).json({
          error: 'nothing_brought',
          message: 'Record what he actually handed over. A settlement of nothing is not a settlement.',
        });
      }
      res.status(201).json(out);
    } catch (err) { next(err); }
  });

module.exports = router;
