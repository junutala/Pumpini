// src/routes/dipstick.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { dipToVolume } = require('../lib/calibration');

// POST /api/dipstick
// dip_cm is the TRUE dip (the form converts the mark-ordinal entry first). When
// the tank has a calibration type, volume is computed authoritatively from the
// geometry and the client's volume_ltrs is ignored; otherwise it falls back to
// the manually entered volume (tanks not yet assigned a type).
router.post('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, tank_id, shift_id, reading_type, dip_cm, density, temperature_c } = req.body;
    let volume_ltrs = req.body.volume_ltrs;

    // Re-scope tank to the validated station — a tank_id from another outlet
    // must not be writable here even though station_id passed the guard. Also
    // pull its calibration type in the same hop.
    let chart = null;
    if (tank_id) {
      const { rows: tk } = await pool.query(
        `SELECT c.diameter_cm, c.length_cm
         FROM tanks t
         LEFT JOIN tank_calibration_charts c ON c.id = t.calibration_chart_id
         WHERE t.id=$1 AND t.station_id=$2`, [tank_id, station_id]);
      if (!tk.length) return res.status(400).json({ error: 'Tank does not belong to this station.' });
      chart = tk[0];
    }

    // Authoritative volume from the dip + tank geometry, when a type is set.
    if (chart && chart.diameter_cm && chart.length_cm && dip_cm != null) {
      const v = dipToVolume(chart.diameter_cm, chart.length_cm, dip_cm);
      if (v != null) volume_ltrs = v;
    }

    const { rows } = await pool.query(
      `INSERT INTO dipstick_readings(station_id,tank_id,shift_id,reading_type,dip_cm,volume_ltrs,density,temperature_c,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c, req.user.id]
    );

    // Update tank current stock (station-scoped as a belt-and-suspenders guard)
    await pool.query('UPDATE tanks SET current_stock=$1, density=$2 WHERE id=$3 AND station_id=$4', [volume_ltrs, density, tank_id, station_id]);

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/dipstick?tank_id=&date_from=&date_to=
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
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

// ── Density register ──────────────────────────────────────────────
// The OMC compliance ritual: every density observation (shift-dip checks +
// tanker decants) in one dated register, corrected to 15°C and checked against
// the normal band for the fuel and the last delivery's invoice density.
const DENSITY_BANDS = {            // kg/L at 15°C — keep in sync with ai-chat.js
  petrol:         [0.720, 0.775],
  premium_petrol: [0.720, 0.775],
  diesel:         [0.820, 0.860],
};
const HYDROMETER_CORRECTION = 0.00065; // kg/L per °C (Indian RO field practice)
const INVOICE_TOLERANCE     = 0.0030;  // ±3.0 kg/m³ vs delivery invoice density

// GET /api/dipstick/density-register?station_id=&date_from=&date_to=
router.get('/density-register', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const dateTo   = req.query.date_to   || new Date().toISOString().slice(0, 10);
    const dateFrom = req.query.date_from ||
      new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);

    const [dips, decants] = await Promise.all([
      pool.query(
        `SELECT dr.id, dr.recorded_at AS observed_at, 'dip' AS source, dr.reading_type,
                t.tank_number, t.fuel_type, dr.density, dr.temperature_c,
                u.name AS recorded_by_name,
                ld.density AS reference_density, ld.dc_number AS reference_challan
         FROM dipstick_readings dr
         JOIN tanks t ON t.id = dr.tank_id
         LEFT JOIN users u ON u.id = dr.recorded_by
         LEFT JOIN LATERAL (
           SELECT fd.density, fd.dc_number
           FROM fuel_deliveries fd
           WHERE fd.tank_id = dr.tank_id AND fd.density IS NOT NULL
             AND fd.received_at <= dr.recorded_at
           ORDER BY fd.received_at DESC LIMIT 1
         ) ld ON TRUE
         WHERE dr.station_id = $1 AND dr.density IS NOT NULL
           AND dr.recorded_at >= $2::date
           AND dr.recorded_at <  $3::date + INTERVAL '1 day'`,
        [station_id, dateFrom, dateTo]
      ),
      pool.query(
        `SELECT fd.id, fd.received_at AS observed_at, 'delivery' AS source,
                NULL AS reading_type, t.tank_number, t.fuel_type, fd.density,
                NULL::numeric AS temperature_c, u.name AS recorded_by_name,
                fd.dc_number AS challan_number
         FROM fuel_deliveries fd
         JOIN tanks t ON t.id = fd.tank_id
         LEFT JOIN users u ON u.id = fd.received_by
         WHERE fd.station_id = $1 AND fd.density IS NOT NULL
           AND fd.received_at >= $2::date
           AND fd.received_at <  $3::date + INTERVAL '1 day'`,
        [station_id, dateFrom, dateTo]
      ),
    ]);

    const rows = [...dips.rows, ...decants.rows]
      .sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at))
      .map(r => {
        const obs  = parseFloat(r.density);
        const temp = r.temperature_c != null ? parseFloat(r.temperature_c) : null;
        // Hydrometer reads lighter when warm; challan densities are already @15°C
        const at15 = r.source === 'dip' && temp != null
          ? +(obs + HYDROMETER_CORRECTION * (temp - 15)).toFixed(4)
          : obs;
        const band = DENSITY_BANDS[r.fuel_type] || null;
        const ref  = r.reference_density != null ? parseFloat(r.reference_density) : null;
        const variation = ref != null ? +(at15 - ref).toFixed(4) : null;

        let status = 'ok';
        if (!band) status = 'no_band';                                   // e.g. CNG
        else if (at15 < band[0] || at15 > band[1]) status = 'out_of_band';
        else if (variation != null && Math.abs(variation) > INVOICE_TOLERANCE) status = 'drift';

        return { ...r, density_at_15: at15, variation, status, band };
      });

    res.json({
      rows,
      tolerance: INVOICE_TOLERANCE,
      bands: DENSITY_BANDS,
      summary: {
        total:       rows.length,
        out_of_band: rows.filter(r => r.status === 'out_of_band').length,
        drift:       rows.filter(r => r.status === 'drift').length,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/dipstick/tanks/:station_id  - current stock per tank
router.get('/tanks/:station_id', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
        c.name AS chart_name, c.diameter_cm, c.length_cm,
        lr.volume_ltrs  AS last_reading,
        lr.recorded_at  AS last_reading_at,
        lr.dip_cm       AS last_dip_cm,
        lr.reading_type AS last_reading_type
       FROM tanks t
       LEFT JOIN tank_calibration_charts c ON c.id = t.calibration_chart_id
       LEFT JOIN LATERAL (
         SELECT dr.volume_ltrs, dr.recorded_at, dr.dip_cm, dr.reading_type
         FROM dipstick_readings dr WHERE dr.tank_id = t.id
         ORDER BY dr.recorded_at DESC LIMIT 1
       ) lr ON true
       WHERE t.station_id=$1 ORDER BY t.tank_number`, [req.params.station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
