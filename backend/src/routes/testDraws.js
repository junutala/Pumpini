// src/routes/testDraws.js
//
// Calibration/testing draws — the manager's 5-litre check into the measuring can and
// back into a tank. A thin guarded entry point over `services/testDrawService`, which
// owns every write; see that file for why one row carries both ends of the movement.
//
// WHICH ROUTE THIS CLOSES (cardinal rule, 04-Aug-2026). It retires the typed
// `shift_reconciliation.test_ltrs` figure: the operator's relief for test fuel now
// comes from events recorded WHEN THE DRAW HAPPENED, not from a number remembered at
// close. That field has been filled zero times in production, ever — so this is one
// capture point replacing one that never worked, and it adds the tank end that never
// existed at all.
//
// Permissions ride the existing dipstick modules rather than inventing a new one: a
// test draw is a stock movement, and whoever may record a dip may record this.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const draws = require('../services/testDrawService');

// POST /api/test-draws
// { station_id, nozzle_id, to_tank_id?, litres, artifact_id?, slip_reading?, notes? }
//
// `to_tank_id` is optional and defaults to the nozzle's own tank — the physically
// correct answer, and the one an outlet with a single tank per fuel can never get
// wrong. Where a fuel has several tanks (diesel, almost everywhere) the screen asks.
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('dipstick.entry'),
  async (req, res, next) => {
    try {
      const row = await draws.createTestDraw({
        station_id:   req.body.station_id,
        nozzle_id:    req.body.nozzle_id,
        to_tank_id:   req.body.to_tank_id || null,
        litres:       req.body.litres,
        artifact_id:  req.body.artifact_id || null,
        slip_reading: req.body.slip_reading || null,
        notes:        req.body.notes || null,
        recorded_by:  req.user.id,
      });
      res.status(201).json(row);
    } catch (err) {
      if (err instanceof draws.TestDrawError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });

// GET /api/test-draws?station_id=&shift_id=&date_from=&date_to=
// The register: what was drawn, from which nozzle, into which tank, by whom.
router.get('/', authenticate, requireStationAccess({ required: true }), requirePerm('dipstick.view'),
  async (req, res, next) => {
    try {
      const { station_id, shift_id } = req.query;
      const pool = require('../db/pool');
      const pumps = require('../services/pumpService');
      const nm = await pumps.nozzleNameSelect(pool);
      const p = [station_id];
      let q = `
        SELECT d.*, n.nozzle_number, n.fuel_type${nm.col},
               ft.tank_number AS from_tank_number, tt.tank_number AS to_tank_number,
               u.name AS recorded_by_name, a.name AS attendant_name,
               (d.from_tank_id <> d.to_tank_id) AS cross_tank
          FROM fuel_test_draws d
          JOIN nozzles n ON n.id = d.nozzle_id
          ${nm.join}
          JOIN tanks ft  ON ft.id = d.from_tank_id
          JOIN tanks tt  ON tt.id = d.to_tank_id
          LEFT JOIN users u ON u.id = d.recorded_by
          LEFT JOIN users a ON a.id = d.attendant_id
         WHERE d.station_id = $1`;
      if (shift_id) { p.push(shift_id); q += ` AND d.shift_id = $${p.length}`; }
      if (req.query.date_from) { p.push(req.query.date_from); q += ` AND d.drawn_at >= $${p.length}::date`; }
      if (req.query.date_to)   { p.push(req.query.date_to);   q += ` AND d.drawn_at <  $${p.length}::date + INTERVAL '1 day'`; }
      q += ' ORDER BY d.drawn_at DESC LIMIT 200';
      const { rows } = await pool.query(q, p);
      res.json(rows);
    } catch (err) { next(err); }
  });

module.exports = router;
