// src/routes/dipstick.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// POST /api/dipstick
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO dipstick_readings(station_id,tank_id,shift_id,reading_type,dip_cm,volume_ltrs,density,temperature_c,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c, req.user.id]
    );

    // Update tank current stock
    await pool.query('UPDATE tanks SET current_stock=$1, density=$2 WHERE id=$3', [volume_ltrs, density, tank_id]);

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/dipstick?tank_id=&date_from=&date_to=
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { tank_id, shift_id, station_id } = req.query;
    let q = `
      SELECT dr.*, t.tank_number, t.fuel_type, u.name AS recorded_by_name
      FROM dipstick_readings dr
      JOIN tanks t ON t.id = dr.tank_id
      JOIN users u ON u.id = dr.recorded_by
      WHERE 1=1
    `;
    const p = [];
    if (station_id) { p.push(station_id); q += ` AND dr.station_id=$${p.length}`; }
    if (tank_id)    { p.push(tank_id);    q += ` AND dr.tank_id=$${p.length}`; }
    if (shift_id)   { p.push(shift_id);   q += ` AND dr.shift_id=$${p.length}`; }
    q += ' ORDER BY dr.recorded_at DESC';

    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/dipstick/tanks/:station_id  - current stock per tank
router.get('/tanks/:station_id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, 
        (SELECT dr.volume_ltrs FROM dipstick_readings dr WHERE dr.tank_id=t.id ORDER BY dr.recorded_at DESC LIMIT 1) AS last_reading,
        (SELECT dr.recorded_at FROM dipstick_readings dr WHERE dr.tank_id=t.id ORDER BY dr.recorded_at DESC LIMIT 1) AS last_reading_at
       FROM tanks t WHERE t.station_id=$1 ORDER BY t.tank_number`, [req.params.station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
