const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationId } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const pumpService = require('../services/pumpService');
const slipParser  = require('../services/slipParser');

// Do the slip-mapping columns exist on nozzles yet? Owner-run DDL means this code
// deploys first, so pump_id / slip_nozzle_no are named only once present. A catalog
// probe, never a failing INSERT — inside a transaction that would abort the caller.
// Cached only once TRUE, so the first save after the migration picks them up with
// no restart.
let _hasSlipMapping = false;
async function hasSlipMapping() {
  if (_hasSlipMapping) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='nozzles'
          AND column_name='pump_id' LIMIT 1`);
    _hasSlipMapping = rows.length > 0;
  } catch { _hasSlipMapping = false; }
  return _hasSlipMapping;
}
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

// POST /api/stations — REMOVED. Was an orphan (no UI) that created a station
// without seeding template/owner/group. Station creation is superadmin-only
// (POST /api/superadmin/stations). See docs/drift-audit.md.

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
router.post('/:id/settings', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { gstn, pan, tan, address, city, state, pincode, owner_whatsapp, owner_email,
            variance_threshold, invoice_prefix,
            latitude, longitude, geo_fence_radius, geo_fence_enabled } = req.body;
    // PARTIAL upsert: only overwrite a column when the caller actually sent it.
    // (This endpoint is shared by the geofence tab, which posts ONLY the 4 geo
    // fields — a plain overwrite nulled GSTN/PAN/address and reset the prefix. The
    // INSERT path keeps first-time defaults; DO UPDATE COALESCEs against the
    // existing row so unsent fields are preserved.) See docs/drift-audit.md A2.
    const { rows } = await pool.query(
      `INSERT INTO station_settings(station_id,gstn,pan,tan,address,city,state,pincode,
         owner_whatsapp,owner_email,variance_threshold,invoice_prefix,
         latitude,longitude,geo_fence_radius,geo_fence_enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,50),COALESCE($12,'INV'),
         $13,$14,COALESCE($15,500),COALESCE($16,FALSE))
       ON CONFLICT(station_id) DO UPDATE SET
         gstn=COALESCE($2,station_settings.gstn),
         pan=COALESCE($3,station_settings.pan),
         tan=COALESCE($4,station_settings.tan),
         address=COALESCE($5,station_settings.address),
         city=COALESCE($6,station_settings.city),
         state=COALESCE($7,station_settings.state),
         pincode=COALESCE($8,station_settings.pincode),
         owner_whatsapp=COALESCE($9,station_settings.owner_whatsapp),
         owner_email=COALESCE($10,station_settings.owner_email),
         variance_threshold=COALESCE($11,station_settings.variance_threshold),
         invoice_prefix=COALESCE($12,station_settings.invoice_prefix),
         latitude=COALESCE($13,station_settings.latitude),
         longitude=COALESCE($14,station_settings.longitude),
         geo_fence_radius=COALESCE($15,station_settings.geo_fence_radius),
         geo_fence_enabled=COALESCE($16,station_settings.geo_fence_enabled),
         updated_at=NOW()
       RETURNING *`,
      [req.params.id,gstn??null,pan??null,tan??null,address??null,city??null,state??null,pincode??null,
       owner_whatsapp??null,owner_email??null,variance_threshold??null,invoice_prefix??null,
       latitude??null,longitude??null,geo_fence_radius??null,geo_fence_enabled??null]
    );
    // Credit-invoice numbering (prefix is handled above). Applied as a SEPARATE
    // guarded update rather than folded into the upsert: invoice_fy is additive and
    // this code deploys BEFORE the DDL, so naming it in the main statement would
    // 42703 the whole settings save — including the geofence tab. A missing column
    // here just means numbering keeps its previous behaviour.
    const { invoice_fy, invoice_seq } = req.body;
    if (invoice_fy !== undefined || invoice_seq !== undefined) {
      try {
        const { rows: upd } = await pool.query(
          `UPDATE station_settings
              SET invoice_fy  = COALESCE($2, invoice_fy),
                  invoice_seq = COALESCE($3, invoice_seq),
                  updated_at  = NOW()
            WHERE station_id = $1 RETURNING *`,
          [req.params.id,
           invoice_fy || null,
           (invoice_seq === '' || invoice_seq === null || invoice_seq === undefined)
             ? null : parseInt(invoice_seq, 10) || null]
        );
        if (upd.length) rows[0] = upd[0];
      } catch (e) {
        if (e.code !== '42703') throw e;
        try { require('../utils/logger').warn('invoice_fy not migrated yet — numbering fields skipped'); } catch { /* noop */ }
      }
    }

    queueOutletSync(req.params.id);
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// POST /api/stations/:id/nozzles
router.post('/:id/nozzles', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { nozzle_number, fuel_type, tank_id, pump_id, slip_nozzle_no } = req.body;
    // pump_id + slip_nozzle_no map this nozzle to the line its dispenser prints on
    // a totalizer slip, so a scan resolves without inference. The SERIAL lives on
    // the pump, which is the thing that has one. Named only once the DDL has run
    // (owner-run, so code deploys first).
    const cols = ['station_id','nozzle_number','fuel_type','tank_id'];
    const vals = [req.params.id, nozzle_number, fuel_type, tank_id||null];
    if (await hasSlipMapping()) {
      cols.push('pump_id','slip_nozzle_no');
      vals.push(pump_id || null, slip_nozzle_no || null);
    }
    const { rows } = await pool.query(
      `INSERT INTO nozzles(${cols.join(',')}) VALUES(${cols.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,
      vals
    );
    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});

// ── Pumps ────────────────────────────────────────────────────────────────
// A pump is the MACHINE the nozzles hang off. Thin guarded entry points over
// services/pumpService, which is the single writer. See that file for why a pump
// carries no fuel and no tank.

// GET /api/stations/:id/pumps — pumps with their nozzles nested, plus any nozzles
// no pump owns yet. The screen shows the unassigned ones loudly at the top, so
// they are returned in the same payload rather than needing a second call.
router.get('/:id/pumps', authenticate, requireStationId('id'), async (req, res, next) => {
  try {
    const [pumps, unassigned] = await Promise.all([
      pumpService.listPumps(req.params.id),
      pumpService.unassignedNozzles(req.params.id),
    ]);
    res.json({ pumps, unassigned });
  } catch (err) { next(err); }
});

// POST /api/stations/:id/parse-pump-slip — read a sample slip during SETUP.
// Same parser as the shift-time scan (services/slipParser), different guard: this
// one has no shift, because a pump is being identified before it has ever run one.
// Returns identity only; the form prefills it and the owner confirms, because a
// mis-read serial would silently break every future scan on that machine.
router.post('/:id/parse-pump-slip', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { file_base64, media_type } = req.body;
    if (!file_base64) return res.status(400).json({ error: 'Photograph the slip first.' });
    const parsed = await slipParser.parseSlip({ file_base64, media_type });
    if (!parsed) {
      return res.status(422).json({ error: 'Could not read that slip — type the serial and model from it instead.' });
    }
    res.json({
      pump_serial: parsed.pump_serial,
      model: parsed.model,
      pump_id: parsed.pump_id,          // FP. ID / FIP No. when the layout prints one
      slip_type: parsed.slip_type,
      nozzle_numbers: parsed.nozzles.map(n => n.nozzle_no).filter(Boolean),
      legible: parsed.legible,
      notes: parsed.notes,
    });
  } catch (err) { next(err); }
});

router.post('/:id/pumps', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    res.status(201).json(await pumpService.createPump(
      { ...req.body, station_id: req.params.id, uploaded_by: req.user.id }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id/pumps/:pump_id', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    res.json(await pumpService.updatePump(
      req.params.pump_id, req.params.id, { ...req.body, uploaded_by: req.user.id }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id/pumps/:pump_id', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    res.json(await pumpService.retirePump(req.params.pump_id, req.params.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/stations/:id/nozzles/:nozzle_id
router.patch('/:id/nozzles/:nozzle_id', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const { nozzle_number, fuel_type, tank_id, is_active, pump_id, slip_nozzle_no } = req.body;
    const sets = [
      'nozzle_number=COALESCE($1,nozzle_number)',
      'fuel_type=COALESCE($2,fuel_type)',
      'tank_id=COALESCE($3,tank_id)',
      'is_active=COALESCE($4,is_active)',
    ];
    const vals = [nozzle_number, fuel_type, tank_id||null, is_active];
    // Blank CLEARS the mapping here rather than being ignored — an owner who
    // mistyped a serial must be able to remove it, and COALESCE would silently
    // keep the wrong one.
    if (await hasSlipMapping()) {
      vals.push(pump_id === undefined ? null : (pump_id || null));
      sets.push(`pump_id=$${vals.length}`);
      vals.push(slip_nozzle_no === undefined ? null : (slip_nozzle_no || null));
      sets.push(`slip_nozzle_no=$${vals.length}`);
    }
    vals.push(req.params.nozzle_id, req.params.id);
    const { rows } = await pool.query(
      `UPDATE nozzles SET ${sets.join(', ')}
       WHERE id=$${vals.length-1} AND station_id=$${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// DELETE /api/stations/:id/nozzles/:nozzle_id
router.delete('/:id/nozzles/:nozzle_id', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM nozzles WHERE id=$1 AND station_id=$2',
      [req.params.nozzle_id, req.params.id]);
    res.json({ ok:true });
  } catch(err) { next(err); }
});

// PATCH /api/stations/:id/settings
router.patch('/:id/settings', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
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
router.post('/:id/tanks', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
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
router.patch('/:id/tanks/:tank_id', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
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
