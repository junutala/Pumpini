// src/routes/deliveries.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');

// GET /api/deliveries/book-stock/:station_id  ← must be before /:id routes
router.get('/book-stock/:station_id', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Get open shift for today
    const { rows: shifts } = await pool.query(
      `SELECT id FROM shifts WHERE station_id=$1 AND date=$2 AND status='open' LIMIT 1`,
      [req.params.station_id, today]
    );

    // Single efficient query for all tanks
    const shiftId = shifts[0]?.id || null;

    const { rows } = await pool.query(`
      SELECT
        t.id          AS tank_id,
        t.tank_number,
        t.fuel_type,
        t.capacity_ltrs,
        t.current_stock,
        -- Opening dip
        COALESCE((
          SELECT dr.volume_ltrs FROM dipstick_readings dr
          WHERE dr.tank_id=t.id AND dr.shift_id=$2
            AND dr.reading_type='opening'
          ORDER BY dr.recorded_at LIMIT 1
        ), t.current_stock) AS opening_dip,
        -- Deliveries this shift
        COALESCE((
          SELECT SUM(fd.net_volume_ltrs) FROM fuel_deliveries fd
          WHERE fd.tank_id=t.id AND ($2::uuid IS NULL OR fd.shift_id=$2)
          AND fd.received_at::date=$3
        ), 0) AS deliveries,
        -- Sales this shift
        COALESCE((
          SELECT SUM(de.quantity_ltrs) FROM dispense_events de
          JOIN nozzles n ON n.id=de.nozzle_id
          WHERE n.tank_id=t.id AND ($2::uuid IS NULL OR de.shift_id=$2)
          AND de.occurred_at::date=$3
        ), 0) AS sales_ltrs,
        -- Closing dip
        (
          SELECT dr.volume_ltrs FROM dipstick_readings dr
          WHERE dr.tank_id=t.id AND dr.shift_id=$2
            AND dr.reading_type='closing'
          ORDER BY dr.recorded_at DESC LIMIT 1
        ) AS closing_dip
      FROM tanks t
      WHERE t.station_id=$1
      ORDER BY t.tank_number`,
      [req.params.station_id, shiftId, today]
    );

    // Calculate book_stock in app layer
    const result = rows.map(t => ({
      ...t,
      book_stock: parseFloat(t.opening_dip||0)
               + parseFloat(t.deliveries||0)
               - parseFloat(t.sales_ltrs||0),
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/deliveries
router.post('/', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const {
      station_id, tank_id, shift_id,
      dc_number, dc_date, received_at,
      fuel_type, oil_company, depot_name,
      tanker_number, compartment_no,
      gross_volume_ltrs, temperature_c, density,
      batch_number, seal_number,
      rate_per_ltr, freight, total_value, notes,
    } = req.body;

    // Calculate net volume
    let netVol = parseFloat(gross_volume_ltrs);
    if (temperature_c && density) {
      netVol = parseFloat(gross_volume_ltrs) * parseFloat(density)
             * (1 - 0.00090 * (parseFloat(temperature_c) - 15));
    }

    const { rows } = await pool.query(
      `INSERT INTO fuel_deliveries(
         station_id,tank_id,shift_id,dc_number,dc_date,received_at,
         fuel_type,oil_company,depot_name,tanker_number,compartment_no,
         gross_volume_ltrs,temperature_c,density,net_volume_ltrs,
         batch_number,seal_number,rate_per_ltr,freight,total_value,
         received_by,notes
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        station_id, tank_id, shift_id||null,
        dc_number||null, dc_date||new Date().toISOString().slice(0,10),
        received_at||new Date(),
        fuel_type, oil_company||null, depot_name||null,
        tanker_number||null, compartment_no||null,
        gross_volume_ltrs, temperature_c||null, density||null, netVol.toFixed(2),
        batch_number||null, seal_number||null,
        rate_per_ltr||null, freight||0, total_value||null,
        req.user.id, notes||null,
      ]
    );

    req.io.to(`station:${station_id}`).emit('delivery:new', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/deliveries
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, tank_id, date_from, date_to, limit=50 } = req.query;
    let q = `
      SELECT fd.*, t.tank_number, t.fuel_type AS tank_fuel,
        u.name AS received_by_name, v.name AS verified_by_name
      FROM fuel_deliveries fd
      LEFT JOIN tanks t ON t.id = fd.tank_id
      LEFT JOIN users u ON u.id = fd.received_by
      LEFT JOIN users v ON v.id = fd.verified_by
      WHERE 1=1`;
    const p = [];
    if (station_id){ p.push(station_id); q+=` AND fd.station_id=$${p.length}`; }
    if (tank_id)   { p.push(tank_id);    q+=` AND fd.tank_id=$${p.length}`; }
    if (date_from) { p.push(date_from);  q+=` AND fd.received_at>=$${p.length}`; }
    if (date_to)   { p.push(date_to);    q+=` AND fd.received_at<=$${p.length}`; }
    p.push(parseInt(limit));
    q += ` ORDER BY fd.received_at DESC LIMIT $${p.length}`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/deliveries/:id/verify
router.patch('/:id/verify', authenticate, authorize('owner','manager'), requireStationVia('SELECT station_id FROM fuel_deliveries WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE fuel_deliveries SET verified_by=$1, verified_at=NOW()
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
