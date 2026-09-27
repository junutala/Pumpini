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
      // Why it could not be recorded, in the manager's words — one wording, shared with
      // the price screen's readings (spokeService.eventProblem).
      const problem = spokes.eventProblem(out);
      if (problem) return res.status(problem.status).json(problem.body);
      res.status(201).json(out);
    } catch (err) { next(err); }
  });

// POST /api/spokes/event/:id/void   { station_id, reason }
//
// THE OWNER TAKES THE LAST READING ON A NOZZLE OFF ITS CHAIN — the correction for a
// wrong figure that got through. All of it is decided in spokeService.voidLastEvent;
// this only guards who may ask.
//
// WHICH ROUTE THIS CLOSES: none, and it opens no parallel path. Nothing else removes a
// chain event — before this, the only way to correct one was a database edit.
const VOID_REFUSALS = {
  no_reason:    { status: 400, message: 'Say why this reading is being voided, in your own words.' },
  not_found:    { status: 404, message: 'That reading is not on this outlet\'s chain.' },
  not_the_last: { status: 409, message: 'Only the latest reading on a nozzle can be voided, and a newer one has been recorded since. Refresh and look again.' },
};

router.post('/event/:id/void', authenticate, requireStationAccess({ required: true }),
  async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) return res.status(503).json(NOT_MIGRATED);
      // OWNER ONLY. The manager records readings; taking one back is the owner's eye on
      // the chain, the same line the outlet-flow switch draws.
      if (req.user.role !== 'owner') {
        return res.status(403).json({
          error: 'owner_only',
          message: 'Only the outlet owner can void a reading.',
        });
      }
      const out = await spokes.voidLastEvent({
        station_id: req.body.station_id, event_id: req.params.id,
        reason: req.body.reason, voided_by: req.user.id,
      });
      if (out?.refused) {
        const r = VOID_REFUSALS[out.refused] || VOID_REFUSALS.not_found;
        return res.status(r.status).json({ error: out.refused, message: r.message });
      }
      res.json(out);
    } catch (err) { next(err); }
  });

// GET /api/spokes/handover-preview?station_id=&nozzle_id=&reading=
//
// WHAT THIS READING WOULD MEAN, before it is recorded. The manager sees the amount
// the outgoing man will owe AT THE MOMENT OF THE HANDOVER, with the working shown —
// two readings, the litres between them, the rate, the rupees — rather than meeting
// it later on a settlement screen he did not expect.
//
// READ-ONLY AND DERIVED. It writes nothing, and it accepts no outstanding as an
// input: the arithmetic is spokeService's and the caller may only ask.
//
// Same permission as the handover it precedes — a man allowed to record one is
// allowed to see what it costs before he does.
router.get('/handover-preview', authenticate, requireStationAccess({ required: true }),
  async (req, res, next) => {
    try {
      const { station_id, nozzle_id, reading } = req.query;
      if (!nozzle_id) return res.status(400).json({ error: 'nozzle_id is required' });
      res.json(await spokes.handoverPreview({
        station_id, nozzle_id, reading: reading === undefined ? null : Number(reading),
      }));
    } catch (err) { next(err); }
  });

// GET /api/spokes/outstanding?station_id=
// WHAT EACH MAN OWES — calculated, never stored, never typed.
router.get('/outstanding', authenticate, requireStationAccess({ required: true }),
  async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) {
        return res.json({ enabled: false, attendants: [], holdings: [] });
      }
      // BOTH HALVES IN ONE ANSWER. `attendants` is who owes (derived from closings);
      // `holdings` is who is ON a nozzle right now — a man with no closing yet owes
      // nothing and is still the man waiting to go home. Attendant Close starts from
      // the second list, which is why they travel together rather than as two calls.
      const [attendants, held] = await Promise.all([
        spokes.outstanding(req.query.station_id),
        spokes.holdings(req.query.station_id),
      ]);
      res.json({ enabled: true, attendants, holdings: held });
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

// Why a settlement was refused, in words the manager can act on. Every refusal is
// decided in spokeService.settle; this only says it.
const SETTLE_REFUSALS = {
  // IT MAY NOT COMPLETE SILENTLY AT ZERO. That is precisely how Rs 1,25,275 left
  // three settlements on 25-Aug with cash_actual = 0 and nobody the wiser.
  nothing_brought: { status: 400,
    message: 'Record what he actually handed over. A settlement of nothing is not a settlement.' },
  negative_amount: { status: 400,
    message: o => `The ${o.field || 'amount'} figure is below zero. Enter what he handed over — a settlement cannot take money back.` },
  bad_amount: { status: 400,
    message: o => `The ${o.field || 'amount'} figure is not a number. Type it as digits.` },
  not_an_attendant_here: { status: 400,
    message: 'That person is not an attendant at this outlet, so there is nothing to settle against.' },
  duplicate: { status: 409,
    message: 'This settlement was already recorded a moment ago with the same amounts. It has not been recorded twice.' },
};

router.post('/settle', authenticate, requireStationAccess({ required: true }),
  requirePerm('settlement.enter'), async (req, res, next) => {
    try {
      if (!(await spokes.hasSpokeTables())) return res.status(503).json(NOT_MIGRATED);
      const out = await spokes.settle({ ...req.body, recorded_by: req.user.id });
      if (out?.refused) {
        const r = SETTLE_REFUSALS[out.refused] || SETTLE_REFUSALS.bad_amount;
        return res.status(r.status).json({
          error: out.refused,
          message: typeof r.message === 'function' ? r.message(out) : r.message,
        });
      }
      res.status(201).json(out);
    } catch (err) { next(err); }
  });

module.exports = router;
