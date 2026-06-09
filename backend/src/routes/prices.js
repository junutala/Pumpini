const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
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

router.post('/', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), async (req, res, next) => {
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
