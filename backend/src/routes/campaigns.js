// src/routes/campaigns.js
//
// Gift campaigns — thin guarded entry points over services/campaignService.
// Every rule lives in the service (or, where it must not be forgettable, in a
// database constraint); nothing here decides anything.
//
// THREE RESPONSIBILITIES, not one. gift.manage defines campaigns, gift.issue
// runs them at the pump, gift.view reads the results. They are separate because
// an outlet may keep setup with the owner and roll issuing down to the manager
// or the attendant — the same mechanism that already separates settlement.enter
// from reconcile.manage, so it needs no switch and no station setting.
//
// Reading a campaign is deliberately NOT gated on gift.manage: the issue screen
// has to know what the tiers are, and its user holds gift.issue only.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const svc = require('../services/campaignService');
const run = require('../services/giftIssueService');
const rep = require('../services/giftReportService');

const VIA_CAMPAIGN = 'SELECT station_id FROM gift_campaigns WHERE id=$1';
const VIA_TIER     = 'SELECT station_id FROM gift_campaign_tiers WHERE id=$1';

// ── READ ──────────────────────────────────────────────────────────────────────

// GET /api/campaigns?station_id=
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    res.json(await svc.listCampaigns({ station_id: req.query.station_id }));
  } catch (err) { next(err); }
});

// GET /api/campaigns/:id
router.get('/:id', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), async (req, res, next) => {
  try {
    res.json(await svc.getCampaign({ id: req.params.id, station_id: req.stationId }));
  } catch (err) { next(err); }
});

// GET /api/campaigns/:id/eligible?fuel_type=&litres=
// What this fill earns: the HIGHEST tier it clears, or nothing. Whether this
// vehicle has already had that tier is settled by the unique index at the moment
// of the write, not here — an answer given now would be stale by the time it is
// used.
router.get('/:id/eligible', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    const litres = Number(req.query.litres);
    if (!Number.isFinite(litres) || litres <= 0) {
      return res.status(400).json({ error: 'Enter the litres dispensed.' });
    }
    res.json(await svc.eligibleTier({
      campaign_id: req.params.id, fuel_type: req.query.fuel_type, litres,
    }));
  } catch (err) { next(err); }
});

// ── WRITE — all on gift.manage ────────────────────────────────────────────────

// POST /api/campaigns
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('gift.manage'), async (req, res, next) => {
  try {
    const { station_id, name, start_date, end_date, hours_from, hours_to } = req.body;
    const row = await svc.createCampaign({
      station_id, name, start_date, end_date, hours_from, hours_to, user_id: req.user.id,
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PATCH /api/campaigns/:id — draft only; the service refuses a running campaign.
router.patch('/:id', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.manage'), async (req, res, next) => {
  try {
    const { name, start_date, end_date, hours_from, hours_to } = req.body;
    res.json(await svc.updateCampaign({
      id: req.params.id, station_id: req.stationId,
      name, start_date, end_date, hours_from, hours_to,
    }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/:id/tiers
router.post('/:id/tiers', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.manage'), async (req, res, next) => {
  try {
    const { fuel_type, min_litres, product_id, quantity } = req.body;
    const row = await svc.addTier({
      campaign_id: req.params.id, station_id: req.stationId,
      fuel_type, min_litres, product_id, quantity,
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// DELETE /api/campaigns/tiers/:tier_id
router.delete('/tiers/:tier_id', authenticate, requireStationVia(VIA_TIER, 'tier_id'), requirePerm('gift.manage'), async (req, res, next) => {
  try {
    res.json(await svc.removeTier({ tier_id: req.params.tier_id, station_id: req.stationId }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/:id/start — the moment the rules freeze.
router.post('/:id/start', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.manage'), async (req, res, next) => {
  try {
    res.json(await svc.startCampaign({ id: req.params.id, station_id: req.stationId }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/:id/stop
router.post('/:id/stop', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.manage'), async (req, res, next) => {
  try {
    res.json(await svc.stopCampaign({ id: req.params.id, station_id: req.stationId }));
  } catch (err) { next(err); }
});

// ── RUNNING A CAMPAIGN AT THE PUMP ───────────────────────────────────────────
//
// All on gift.issue, which an outlet may hold at the manager or roll down to the
// attendant. Every rule lives in the service or in a database constraint; these
// are entry points and nothing more.

const VIA_ISSUE = 'SELECT station_id FROM gift_issues WHERE id=$1';

// GET /api/campaigns/live/running?station_id=
// What is running here today, and whether this outlet must scan the slip.
router.get('/live/running', authenticate, requireStationAccess({ required: true }), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    const station_id = req.query.station_id;
    const c = await run.runningCampaign({ station_id });
    res.json({
      campaign: c,
      within_hours: c ? run.withinHours(c) : false,
      slip_ocr_required: await run.slipOcrRequired(station_id),
      session_minutes: run.SESSION_MINUTES,
      max_plate_tries: run.MAX_PLATE_TRIES,
    });
  } catch (err) { next(err); }
});

// POST /api/campaigns/issues — open a session (a draft row with a server-held
// deadline; a limit counted in the browser is counted by the attendant's clock).
router.post('/issues', authenticate, requireStationAccess({ required: true }), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    res.status(201).json(await run.openSession({ station_id: req.body.station_id, user_id: req.user.id }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/issues/plate-read — read a plate. Writes NOTHING, so a
// failed read cannot half-fill the row; the screen retakes and asks again.
router.post('/issues/plate-read', authenticate, requireStationAccess({ required: true }), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    res.json(await run.readPlate({ file_base64: req.body.file_base64, media_type: req.body.media_type }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/issues/:id/fill
router.post('/issues/:id/fill', authenticate, requireStationVia(VIA_ISSUE, 'id'), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    res.json(await run.setFill({ id: req.params.id, station_id: req.stationId, user_id: req.user.id, ...req.body }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/issues/:id/plate
router.post('/issues/:id/plate', authenticate, requireStationVia(VIA_ISSUE, 'id'), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    res.json(await run.setPlate({ id: req.params.id, station_id: req.stationId, user_id: req.user.id, ...req.body }));
  } catch (err) { next(err); }
});

// GET /api/campaigns/issues/:id/preview — the tier this fill earns, and whether
// this vehicle has had it. The second half is ADVISORY: the unique index decides,
// at the write, which is the only moment that cannot be raced.
router.get('/issues/:id/preview', authenticate, requireStationVia(VIA_ISSUE, 'id'), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    res.json(await run.preview({ id: req.params.id, station_id: req.stationId }));
  } catch (err) { next(err); }
});

// POST /api/campaigns/issues/:id/settle — issued, or not issued with a reason.
// Both keep the evidence: a refusal nobody can check is worth nothing.
router.post('/issues/:id/settle', authenticate, requireStationVia(VIA_ISSUE, 'id'), requirePerm('gift.issue'), async (req, res, next) => {
  try {
    res.json(await run.settle({ id: req.params.id, station_id: req.stationId, user_id: req.user.id, ...req.body }));
  } catch (err) { next(err); }
});

// ── THE REPORT — gift.view ───────────────────────────────────────────────────
//
// A third responsibility, and deliberately not folded into gift.issue: the
// report carries daily sales volumes and the per-attendant breakdown, and a man
// who can read how closely he is being counted can tune himself to just below
// interesting. He should know it exists; he should not see the numbers.

// GET /api/campaigns/:id/report
router.get('/:id/report', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.view'), async (req, res, next) => {
  try {
    res.json(await rep.report({ campaign_id: req.params.id, station_id: req.stationId }));
  } catch (err) { next(err); }
});

// GET /api/campaigns/:id/issues — the working behind every number in the report.
// A total nobody can open is a total nobody checks.
router.get('/:id/issues', authenticate, requireStationVia(VIA_CAMPAIGN, 'id'), requirePerm('gift.view'), async (req, res, next) => {
  try {
    res.json(await rep.issues({ campaign_id: req.params.id, station_id: req.stationId, limit: req.query.limit }));
  } catch (err) { next(err); }
});

module.exports = router;
