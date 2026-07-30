const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
const { requireStationAccess } = require('../middleware/stationAccess');

router.get('/:station_id/current', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (fuel_type) * FROM fuel_prices
       WHERE station_id=$1 ORDER BY fuel_type, effective_from DESC`,
      [req.params.station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/prices/:station_id/as-at?date=YYYY-MM-DD
// The rate in force per fuel AT THAT OUTLET on that date — used to default a manual
// credit-invoice line, which may be dated in the past.
//
// fuel_prices is a CHANGE-LOG, not a daily snapshot: a row means "this rate holds until
// superseded". Indian pump prices are stable for long stretches, so a rate set weeks
// earlier is legitimately the rate in force — an old effective_from is NOT stale.
//
// Compared in Asia/Kolkata: effective_from is timestamptz and the caller passes a
// calendar date, so a rate set late in the evening would land on the wrong side of a
// date boundary in UTC. We take the rate in force at the END of that date.
router.get('/:station_id/as-at', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (fuel_type) fuel_type, price, effective_from
       FROM fuel_prices
       WHERE station_id=$1
         AND effective_from < (($2::date + 1) AT TIME ZONE 'Asia/Kolkata')
       ORDER BY fuel_type, effective_from DESC`,
      [req.params.station_id, date]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('prices.manage'), async (req, res, next) => {
  try {
    const { station_id, fuel_type, price, effective_from } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO fuel_prices(station_id,fuel_type,price,effective_from,set_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [station_id, fuel_type, price, effective_from || new Date(), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
