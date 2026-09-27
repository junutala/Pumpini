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
// Why a handover could not be recorded at all — decided in spokeService.recordEvent.
const EVENT_INVALID = {
  no_reading: 'A nozzle and a reading are required.',
  bad_reading: 'Type the reading as the slip prints it: digits and one decimal point, no commas.',
  nozzle_not_at_outlet: 'That nozzle is not at this outlet.',
  not_an_attendant_here: 'That person is not an attendant at this outlet, so the nozzle cannot be given to him.',
};

// Why the physics refused a reading.
//
// 🔴 THE DECREASE TEXT USED TO SEND HIM TO Settings → Commissioning, which refuses any
// nozzle that already has a chain (commissionService: no second genesis). So a manager
// with a mistyped last reading was sent to a screen that could not help him, and the
// nozzle could never be handed over again (MBR rehearsal, 27-Sep-2026). Until there is
// a correction path, the true sentence is that he cannot fix it here and the owner must
// be told.
const L = n => Math.abs(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const REFUSAL_TEXT = {
  reading_decreased: v =>
    `That reading is ${L(v.delta)} L BELOW the last one. A meter only counts up — check the figure against the slip. If the last reading on this nozzle was itself wrong, or the meter was reset or replaced, tell the owner: this nozzle's readings need correcting, and that cannot be done from this screen.`,
  more_than_the_tank: v =>
    `That is ${L(v.delta)} L since the last reading, and this nozzle's tank could have given at most ${L(v.tank_limit)} L, deliveries included. Check the figure against the slip — a decimal point in the wrong place does this. If a tanker came in, enter the delivery first.`,
  faster_than_the_pump: v =>
    `That is ${Math.round(v.delta).toLocaleString('en-IN')} L in ${v.seconds} seconds, and the pump cannot deliver more than about ${Math.round(v.ceiling).toLocaleString('en-IN')} L in that time. Check the figure, or say what happened.`,
};

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
      if (out?.invalid) {
        return res.status(400).json({
          error: out.invalid,
          message: EVENT_INVALID[out.invalid] || EVENT_INVALID.bad_reading,
        });
      }
      if (out?.refused) {
        const v = out.refused;
        return res.status(409).json({
          error: v.code,
          // The certainties, in words a manager can act on. Everything else is trade and
          // is recorded as drift without a murmur. A FINAL refusal asks for no reason,
          // because none is accepted (spokeService.mayRecord).
          final: !!v.final,
          message: REFUSAL_TEXT[v.code] ? REFUSAL_TEXT[v.code](v) : REFUSAL_TEXT.faster_than_the_pump(v),
          detail: v,
        });
      }
      res.status(201).json(out);
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
