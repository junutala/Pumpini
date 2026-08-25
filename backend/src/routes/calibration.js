// src/routes/calibration.js
// Tank calibration — keyed on PHYSICAL DIMENSIONS (diameter x length, cm).
//
// The writer lives in services/calibrationService. Read the note at the top of that
// file before changing anything here: it records why the nominal-size dropdown
// (15KL / 16KL / 22KL) was removed on 25-Aug-2026 and what it cost.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const calibration = require('../services/calibrationService');

// GET /api/calibration/charts — sizes already on file.
//
// No longer a "pick your tank type" dropdown. It is a convenience list of
// dimensions seen before, so an outlet with several identical tanks does not retype
// them. `tanks_using` is what tells a reader that a row is SHARED, which is the
// fact that made editing one in place dangerous.
router.get('/charts', authenticate, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.diameter_cm, c.length_cm,
              ROUND((pi() * power(c.diameter_cm/2, 2) * c.length_cm / 1000)::numeric, 2) AS capacity_ltrs,
              (SELECT count(*) FROM tanks t WHERE t.calibration_chart_id = c.id)::int AS tanks_using
       FROM tank_calibration_charts c
       WHERE c.is_active
       ORDER BY c.diameter_cm, c.length_cm`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/calibration/tank/:tank_id
//   { station_id, diameter_cm, length_cm }   ← the normal path: dimensions
//   { station_id, chart_id }                 ← still accepted; the Dipstick screen
//                                              picks a size already on file
//
// Both funnel through the one writer. A tank from another outlet is not writable
// here even though station_id passed the guard — the UPDATE is scoped to both.
router.patch('/tank/:tank_id', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.body;
    // `chart_id` is this route's historical field name for the same thing.
    const body = Object.prototype.hasOwnProperty.call(req.body, 'chart_id')
      ? { ...req.body, calibration_chart_id: req.body.chart_id }
      : req.body;

    const { calibration_chart_id } = await calibration.resolveChartId(body);

    const { rowCount } = await pool.query(
      `UPDATE tanks SET calibration_chart_id = $1 WHERE id = $2 AND station_id = $3`,
      [calibration_chart_id, req.params.tank_id, station_id]
    );
    if (!rowCount) return res.status(400).json({ error: 'Tank does not belong to this station.' });
    res.json({ ok: true, calibration_chart_id });
  } catch (err) { next(err); }
});

module.exports = router;
