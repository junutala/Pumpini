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

module.exports = router;
