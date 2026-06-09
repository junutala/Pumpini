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

// POST /api/stations/:id/settings
router.post('/:id/settings', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { gstn, pan, tan, address, city, state, pincode, owner_whatsapp, owner_email,
            variance_threshold, invoice_prefix,
            latitude, longitude, geo_fence_radius, geo_fence_enabled } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO station_settings(station_id,gstn,pan,tan,address,city,state,pincode,
         owner_whatsapp,owner_email,variance_threshold,invoice_prefix,
         latitude,longitude,geo_fence_radius,geo_fence_enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(station_id) DO UPDATE SET
         gstn=$2,pan=$3,tan=$4,address=$5,city=$6,state=$7,pincode=$8,
         owner_whatsapp=$9,owner_email=$10,variance_threshold=$11,invoice_prefix=$12,
         latitude=$13,longitude=$14,geo_fence_radius=$15,geo_fence_enabled=$16,
         updated_at=NOW()
       RETURNING *`,
      [req.params.id,gstn,pan,tan,address,city,state,pincode,owner_whatsapp,owner_email,
       variance_threshold||50,invoice_prefix||'INV',
       latitude||null,longitude||null,geo_fence_radius||500,geo_fence_enabled||false]
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

// PATCH /api/stations/:id/nozzles/:nozzle_id
router.patch('/:id/nozzles/:nozzle_id', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { nozzle_number, fuel_type, tank_id, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE nozzles SET
         nozzle_number=COALESCE($1,nozzle_number),
         fuel_type=COALESCE($2,fuel_type),
         tank_id=COALESCE($3,tank_id),
         is_active=COALESCE($4,is_active)
       WHERE id=$5 AND station_id=$6 RETURNING *`,
      [nozzle_number, fuel_type, tank_id||null, is_active, req.params.nozzle_id, req.params.id]
    );
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// DELETE /api/stations/:id/nozzles/:nozzle_id
router.delete('/:id/nozzles/:nozzle_id', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM nozzles WHERE id=$1 AND station_id=$2',
      [req.params.nozzle_id, req.params.id]);
    res.json({ ok:true });
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/settings
router.patch('/:id/settings', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { name, address, state, city, pincode, oil_company, gstn, pan,
            owner_whatsapp, invoice_prefix } = req.body;
    // Update stations table
    await pool.query(
      `UPDATE stations SET
         name=COALESCE($1,name), address=COALESCE($2,address),
         state=COALESCE($3,state), city=COALESCE($4,city),
         gst_number=COALESCE($5,gst_number), oil_company=COALESCE($6,oil_company)
       WHERE id=$7`,
      [name, address, state, city, gstn, oil_company, req.params.id]
    );
    // Upsert station_settings
    await pool.query(
      `INSERT INTO station_settings(station_id,gstn,pan,owner_whatsapp,invoice_prefix)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(station_id) DO UPDATE SET
         gstn=COALESCE($2,station_settings.gstn),
         pan=COALESCE($3,station_settings.pan),
         owner_whatsapp=COALESCE($4,station_settings.owner_whatsapp),
         invoice_prefix=COALESCE($5,station_settings.invoice_prefix)`,
      [req.params.id, gstn, pan, owner_whatsapp, invoice_prefix||'INV']
    );
    res.json({ ok:true });
  } catch(err) { next(err); }
});

// GET /api/stations/:id/settings
router.get('/:id/settings', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, ss.gstn, ss.pan, ss.owner_whatsapp, ss.invoice_prefix, ss.invoice_seq,
              ss.latitude, ss.longitude, ss.geo_fence_radius, ss.geo_fence_enabled
       FROM stations s
       LEFT JOIN station_settings ss ON ss.station_id=s.id
       WHERE s.id=$1`, [req.params.id]
    );
    res.json(rows[0]||{});
  } catch(err) { next(err); }
});

// GET /api/stations/:id/tanks

router.get('/:id/tanks', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
        ROUND(t.current_stock/NULLIF(t.capacity_ltrs,0)*100,1) AS fill_pct
       FROM tanks t WHERE t.station_id=$1 ORDER BY t.tank_number`,
      [req.params.id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// POST /api/stations/:id/tanks
router.post('/:id/tanks', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { tank_number, fuel_type, capacity_ltrs, current_stock, density } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tanks(station_id,tank_number,fuel_type,capacity_ltrs,current_stock,density)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, tank_number, fuel_type, capacity_ltrs, current_stock||0, density||null]
    );
    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/tanks/:tank_id
router.patch('/:id/tanks/:tank_id', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { tank_number, fuel_type, capacity_ltrs, current_stock, density } = req.body;
    const { rows } = await pool.query(
      `UPDATE tanks SET
         tank_number=COALESCE($1,tank_number),
         fuel_type=COALESCE($2,fuel_type),
         capacity_ltrs=COALESCE($3,capacity_ltrs),
         current_stock=COALESCE($4,current_stock),
         density=COALESCE($5,density)
       WHERE id=$6 AND station_id=$7 RETURNING *`,
      [tank_number, fuel_type, capacity_ltrs, current_stock, density, req.params.tank_id, req.params.id]
    );
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// DELETE /api/stations/:id/tanks/:tank_id
router.delete('/:id/tanks/:tank_id', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tanks WHERE id=$1 AND station_id=$2',
      [req.params.tank_id, req.params.id]);
    res.json({ ok: true });
  } catch(err) { next(err); }
});
