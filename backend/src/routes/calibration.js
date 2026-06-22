// src/routes/calibration.js
// Global tank calibration library (formula-based: diameter x length).
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');

// GET /api/calibration/charts — the standard tank types for the setup dropdown
router.get('/charts', authenticate, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, diameter_cm, length_cm,
              ROUND(pi() * power(diameter_cm/2, 2) * length_cm / 1000) AS capacity_ltrs
       FROM tank_calibration_charts
       WHERE is_active
       ORDER BY diameter_cm, length_cm`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/calibration/tank/:tank_id  { station_id, chart_id }
// Assign (or clear, chart_id=null) a tank's calibration type. Station-scoped.
router.patch('/tank/:tank_id', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, chart_id } = req.body;
    const { rowCount } = await pool.query(
      `UPDATE tanks SET calibration_chart_id = $1 WHERE id = $2 AND station_id = $3`,
      [chart_id || null, req.params.tank_id, station_id]
    );
    if (!rowCount) return res.status(400).json({ error: 'Tank does not belong to this station.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
