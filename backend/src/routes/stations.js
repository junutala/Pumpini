const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationId } = require('../middleware/stationAccess');
// Outbound integration: push the outlet to VAWE on create/update. Fire-and-forget
// so a VAWE outage can never break an outlet save.
const { queueOutletSync } = require('../services/vaweService');

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
    queueOutletSync(rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/users', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
  try {
    const { user_id } = req.body;
    await pool.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, user_id]);
    // Attaching an owner/manager can change the outlet's VAWE payload.
    queueOutletSync(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/nozzles', authenticate, requireStationId('id'), async (req, res, next) => {
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
router.post('/:id/settings', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
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
    queueOutletSync(req.params.id);
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// POST /api/stations/:id/nozzles
router.post('/:id/nozzles', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
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
router.patch('/:id/nozzles/:nozzle_id', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
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
router.delete('/:id/nozzles/:nozzle_id', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM nozzles WHERE id=$1 AND station_id=$2',
      [req.params.nozzle_id, req.params.id]);
    res.json({ ok:true });
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/settings
router.patch('/:id/settings', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
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
    queueOutletSync(req.params.id);
    res.json({ ok:true });
  } catch(err) { next(err); }
});

// GET /api/stations/:id/settings
router.get('/:id/settings', authenticate, requireStationId('id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, ss.gstn, ss.pan, ss.owner_whatsapp, ss.invoice_prefix, ss.invoice_seq,
              ss.latitude, ss.longitude, ss.geo_fence_radius, ss.geo_fence_enabled,
              COALESCE(ss.manager_blind_drop, FALSE) AS manager_blind_drop,
              COALESCE(ss.stock_tol_pct_petrol, 0.75) AS stock_tol_pct_petrol,
              COALESCE(ss.stock_tol_pct_diesel, 0.50) AS stock_tol_pct_diesel,
              COALESCE(ss.stock_tol_floor_ltrs, 20)   AS stock_tol_floor_ltrs,
              COALESCE(ss.deposit_alert_days, 2)       AS deposit_alert_days,
              COALESCE(ss.deposit_alert_amount, 0)     AS deposit_alert_amount
       FROM stations s
       LEFT JOIN station_settings ss ON ss.station_id=s.id
       WHERE s.id=$1`, [req.params.id]
    );
    res.json(rows[0]||{});
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/stock-tolerance — owner sets wet-stock variance limits
router.patch('/:id/stock-tolerance', authenticate, authorize('owner'), requireStationId('id'), async (req, res, next) => {
  try {
    const { stock_tol_pct_petrol, stock_tol_pct_diesel, stock_tol_floor_ltrs } = req.body;
    await pool.query(
      `INSERT INTO station_settings(station_id, stock_tol_pct_petrol, stock_tol_pct_diesel, stock_tol_floor_ltrs)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(station_id) DO UPDATE SET
         stock_tol_pct_petrol=COALESCE($2,station_settings.stock_tol_pct_petrol),
         stock_tol_pct_diesel=COALESCE($3,station_settings.stock_tol_pct_diesel),
         stock_tol_floor_ltrs=COALESCE($4,station_settings.stock_tol_floor_ltrs)`,
      [req.params.id, stock_tol_pct_petrol ?? null, stock_tol_pct_diesel ?? null, stock_tol_floor_ltrs ?? null]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/stations/:id/blind-drop-mode — owner toggles manager-driven blind drop.
// The reconciliation model can't change mid-shift, so reject if any shift is open.
router.patch('/:id/blind-drop-mode', authenticate, authorize('owner'), requireStationId('id'), async (req, res, next) => {
  try {
    const enabled = req.body.manager_blind_drop === true || req.body.manager_blind_drop === 'true';
    const { rows: open } = await pool.query(
      `SELECT 1 FROM shifts WHERE station_id=$1 AND status='open' LIMIT 1`, [req.params.id]
    );
    if (open.length) return res.status(409).json({ error: 'Close all open shifts before changing the blind-drop mode.' });
    await pool.query(
      `INSERT INTO station_settings(station_id, manager_blind_drop) VALUES($1,$2)
       ON CONFLICT(station_id) DO UPDATE SET manager_blind_drop=$2`,
      [req.params.id, enabled]
    );
    res.json({ ok: true, manager_blind_drop: enabled });
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/deposit-alert — owner sets undeposited-cash aging limits
router.patch('/:id/deposit-alert', authenticate, authorize('owner'), requireStationId('id'), async (req, res, next) => {
  try {
    const { deposit_alert_days, deposit_alert_amount } = req.body;
    await pool.query(
      `INSERT INTO station_settings(station_id, deposit_alert_days, deposit_alert_amount)
       VALUES($1,$2,$3)
       ON CONFLICT(station_id) DO UPDATE SET
         deposit_alert_days=COALESCE($2,station_settings.deposit_alert_days),
         deposit_alert_amount=COALESCE($3,station_settings.deposit_alert_amount)`,
      [req.params.id, deposit_alert_days ?? null, deposit_alert_amount ?? null]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/stations/:id/tanks

router.get('/:id/tanks', authenticate, requireStationId('id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
        ROUND(t.current_stock/NULLIF(t.capacity_ltrs,0)*100,1) AS fill_pct,
        c.name AS chart_name, c.diameter_cm, c.length_cm
       FROM tanks t
       LEFT JOIN tank_calibration_charts c ON c.id = t.calibration_chart_id
       WHERE t.station_id=$1 ORDER BY t.tank_number`,
      [req.params.id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// POST /api/stations/:id/tanks
router.post('/:id/tanks', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
  try {
    const { tank_number, fuel_type, capacity_ltrs, current_stock, density } = req.body;
    const calibration_chart_id = req.body.calibration_chart_id || null;
    const { rows } = await pool.query(
      `INSERT INTO tanks(station_id,tank_number,fuel_type,capacity_ltrs,current_stock,density,calibration_chart_id)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, tank_number, fuel_type, capacity_ltrs, current_stock||0, density||null, calibration_chart_id]
    );
    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/tanks/:tank_id
router.patch('/:id/tanks/:tank_id', authenticate, authorize('owner','manager'), requireStationId('id'), async (req, res, next) => {
  try {
    const { tank_number, fuel_type, capacity_ltrs, current_stock, density } = req.body;
    // Only touch calibration when the field is actually sent; null then means "clear to manual".
    const calProvided = Object.prototype.hasOwnProperty.call(req.body, 'calibration_chart_id');
    const calibration_chart_id = req.body.calibration_chart_id || null;
    const { rows } = await pool.query(
      `UPDATE tanks SET
         tank_number=COALESCE($1,tank_number),
         fuel_type=COALESCE($2,fuel_type),
         capacity_ltrs=COALESCE($3,capacity_ltrs),
         current_stock=COALESCE($4,current_stock),
         density=COALESCE($5,density),
         calibration_chart_id = CASE WHEN $6 THEN $7 ELSE calibration_chart_id END
       WHERE id=$8 AND station_id=$9 RETURNING *`,
      [tank_number, fuel_type, capacity_ltrs, current_stock, density, calProvided, calibration_chart_id, req.params.tank_id, req.params.id]
    );
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// DELETE /api/stations/:id/tanks/:tank_id
router.delete('/:id/tanks/:tank_id', authenticate, authorize('owner'), requireStationId('id'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tanks WHERE id=$1 AND station_id=$2',
      [req.params.tank_id, req.params.id]);
    res.json({ ok: true });
  } catch(err) { next(err); }
});
