// src/routes/accounts.js — read surface for the optional Accounts module.
//
// Slice 2 exposes the journal and the trial balance (the engine's correctness proof).
// Writes come from the event sources in later slices, funnelled through
// services/accountingEngine. Every endpoint is gated by accounts.view AND no-ops when
// the outlet's Accounts switch is off, so the module stays fully bolt-on.
const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const engine = require('../services/accountingEngine');
const shiftPosting = require('../services/accountsShiftPosting');

// Is Accounts on for this outlet? Column-tolerant — a missing column (pre-Slice-1 DDL)
// or a false value both read as disabled, never a 500.
async function accountsEnabled(stationId) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(accounts_enabled, false) AS on
         FROM station_settings WHERE station_id = $1`, [stationId]);
    return rows.length ? rows[0].on === true : false;
  } catch { return false; }
}

// GET /api/accounts/journal?station_id=&from=&to=&limit=
router.get('/journal', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.view'), async (req, res, next) => {
    try {
      const { station_id, from, to, limit } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, entries: [] });
      const entries = await engine.listJournal(pool, station_id, { from, to, limit });
      res.json({ enabled: true, entries });
    } catch (err) { next(err); }
  });

// GET /api/accounts/trial-balance?station_id=&from=&to=
router.get('/trial-balance', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.view'), async (req, res, next) => {
    try {
      const { station_id, from, to } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, rows: [] });
      const tb = await engine.trialBalance(pool, station_id, { from, to });
      res.json({ enabled: true, ...tb });
    } catch (err) { next(err); }
  });

// POST /api/accounts/materialize { station_id, upto? }
// Pulls settled-but-unposted shifts + deliveries into the journal. On-demand, idempotent,
// touches no existing flow. accounts.manage gated; no-op refusal when the switch is off.
router.post('/materialize', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.manage'), async (req, res, next) => {
    try {
      const station_id = req.body.station_id || req.query.station_id;
      if (!(await accountsEnabled(station_id))) {
        return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });
      }
      const summary = await shiftPosting.materialize(pool, station_id, {
        upto: req.body.upto || undefined, created_by: req.user.id,
      });
      res.json({ ok: true, ...summary });
    } catch (err) { next(err); }
  });

module.exports = router;
