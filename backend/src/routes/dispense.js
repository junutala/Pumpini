// src/routes/dispense.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/auth');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, 'uploads/'),
    filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// POST /api/dispense  (called by RFID agent or manual entry)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      station_id, shift_id, rfid_tag_uid, nozzle_id,
      quantity_ltrs, payment_mode, upi_ref,
      vehicle_number, latitude, longitude,
    } = req.body;

    // Resolve RFID tag → attendant
    const { rows: tagRows } = await pool.query(
      `SELECT rt.id AS rfid_id, sa.attendant_id, sa.shift_id AS sa_shift_id
       FROM rfid_tags rt
       LEFT JOIN shift_attendants sa ON sa.rfid_tag_id = rt.id AND sa.shift_id = $2
       WHERE rt.tag_uid = $1 AND rt.is_active = TRUE`, [rfid_tag_uid, shift_id]
    );
    if (!tagRows.length) return res.status(400).json({ error: 'Unknown or inactive RFID tag' });

    // Get current fuel price
    const { rows: priceRows } = await pool.query(
      `SELECT fp.price, n.fuel_type FROM nozzles n
       JOIN fuel_prices fp ON fp.station_id = $1 AND fp.fuel_type = n.fuel_type
       WHERE n.id = $2
       ORDER BY fp.effective_from DESC LIMIT 1`, [station_id, nozzle_id]
    );
    if (!priceRows.length) return res.status(400).json({ error: 'Fuel price not configured' });

    const { price, fuel_type } = priceRows[0];
    const { rfid_id, attendant_id } = tagRows[0];

    const { rows } = await pool.query(
      `INSERT INTO dispense_events(
         station_id, shift_id, rfid_tag_id, nozzle_id, attendant_id,
         fuel_type, quantity_ltrs, rate_per_ltr, payment_mode, upi_ref,
         vehicle_number, latitude, longitude
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [station_id, shift_id, rfid_id, nozzle_id, attendant_id,
       fuel_type, quantity_ltrs, price, payment_mode || 'cash', upi_ref || null,
       vehicle_number || null, latitude || null, longitude || null]
    );

    const event = rows[0];

    // Emit real-time update
    req.io.to(`station:${station_id}`).emit('dispense:new', event);
    req.io.to(`shift:${shift_id}`).emit('dispense:new', event);

    res.status(201).json(event);
  } catch (err) { next(err); }
});

// POST /api/dispense/:id/photo  (geo-tagged photo upload)
router.post('/:id/photo', authenticate, upload.single('photo'), async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    const photo_url = `/uploads/${req.file.filename}`;
    const { rows } = await pool.query(
      `UPDATE dispense_events SET photo_url=$1, latitude=$2, longitude=$3
       WHERE id=$4 RETURNING id, photo_url`,
      [photo_url, latitude, longitude, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/dispense?shift_id=&attendant_id=&date_from=&date_to=
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { shift_id, attendant_id, date_from, date_to, station_id, limit = 100 } = req.query;
    let q = `
      SELECT de.*, u.name AS attendant_name, n.nozzle_number, r.tag_uid
      FROM dispense_events de
      LEFT JOIN users u ON u.id = de.attendant_id
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      LEFT JOIN rfid_tags r ON r.id = de.rfid_tag_id
      WHERE 1=1
    `;
    const p = [];
    if (station_id)   { p.push(station_id);  q += ` AND de.station_id=$${p.length}`; }
    if (shift_id)     { p.push(shift_id);    q += ` AND de.shift_id=$${p.length}`; }
    if (attendant_id) { p.push(attendant_id);q += ` AND de.attendant_id=$${p.length}`; }
    if (date_from)    { p.push(date_from);   q += ` AND de.occurred_at>=$${p.length}`; }
    if (date_to)      { p.push(date_to);     q += ` AND de.occurred_at<=$${p.length}`; }
    p.push(parseInt(limit));
    q += ` ORDER BY de.event_seq DESC LIMIT $${p.length}`;

    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
