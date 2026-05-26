const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res, next) => {
  try {
    let q = `SELECT s.*, COUNT(su.user_id)::int AS user_count
             FROM stations s LEFT JOIN station_users su ON su.station_id=s.id`;
    const p = [];
    if (!['owner'].includes(req.user.role)) {
      p.push(req.user.id);
      q += ` WHERE s.id IN (SELECT station_id FROM station_users WHERE user_id=$1)`;
    }
    q += ' GROUP BY s.id ORDER BY s.name';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { name, address, gst_number, oil_company, city, state } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO stations(name,address,gst_number,oil_company,city,state) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, address, gst_number, oil_company, city, state]
    );
    await pool.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2)', [rows[0].id, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/users', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { user_id } = req.body;
    await pool.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, user_id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/nozzles', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, t.tank_number, t.fuel_type AS tank_fuel FROM nozzles n
       LEFT JOIN tanks t ON t.id=n.tank_id WHERE n.station_id=$1 ORDER BY n.nozzle_number`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;

// GET /api/stations/:id/settings
router.get('/:id/settings', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM station_settings WHERE station_id=$1', [req.params.id]);
    res.json(rows[0] || {});
  } catch(err) { next(err); }
});

// POST /api/stations/:id/settings
router.post('/:id/settings', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { gstn, pan, tan, address, city, state, pincode, owner_whatsapp, owner_email, variance_threshold, invoice_prefix } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO station_settings(station_id,gstn,pan,tan,address,city,state,pincode,owner_whatsapp,owner_email,variance_threshold,invoice_prefix)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(station_id) DO UPDATE SET
         gstn=$2,pan=$3,tan=$4,address=$5,city=$6,state=$7,pincode=$8,
         owner_whatsapp=$9,owner_email=$10,variance_threshold=$11,invoice_prefix=$12,updated_at=NOW()
       RETURNING *`,
      [req.params.id,gstn,pan,tan,address,city,state,pincode,owner_whatsapp,owner_email,variance_threshold||50,invoice_prefix||'INV']
    );
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// POST /api/stations/:id/nozzles
router.post('/:id/nozzles', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { nozzle_number, fuel_type, tank_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO nozzles(station_id,nozzle_number,fuel_type,tank_id) VALUES($1,$2,$3,$4) RETURNING *`,
      [req.params.id, nozzle_number, fuel_type, tank_id||null]
    );
    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});
