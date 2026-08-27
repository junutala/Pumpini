const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationId } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const pumpService = require('../services/pumpService');
const slipParser  = require('../services/slipParser');
const calibrationService = require('../services/calibrationService');

// Does the self-settlement switch exist yet? This route is a HOT READ — POS, Shifts
// and Settings all call it — so naming a not-yet-migrated column here would 42703 all
// three at once. Probed, never try-and-caught. Cached only once TRUE, so the first
// read after the owner runs the DDL picks it up with no restart.
let _hasSelfSettleFlag = false;
async function hasSelfSettleFlag() {
  if (_hasSelfSettleFlag) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='self_settlement_enabled' LIMIT 1`);
    _hasSelfSettleFlag = rows.length > 0;
  } catch { _hasSelfSettleFlag = false; }
  return _hasSelfSettleFlag;
}

// Does the Accounts on/off switch exist yet? Same hot-read guard as the self-settle
// flag above — GET /settings is called by POS, Shifts and Settings, so naming a
// not-yet-migrated column here would 42703 all three at once. Probed, never
// try-and-caught. Cached only once TRUE, so the first read after the owner runs the
// DDL picks it up with no restart.
let _hasAccountsFlag = false;
async function hasAccountsFlag() {
  if (_hasAccountsFlag) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='accounts_enabled' LIMIT 1`);
    _hasAccountsFlag = rows.length > 0;
  } catch { _hasAccountsFlag = false; }
  return _hasAccountsFlag;
}

// Does the attendant-led auto-close switch exist yet? Same hot-read guard as the two
// flags above — GET /settings is called by POS, Shifts, Settings and now the shift-close
// screen, so naming a not-yet-migrated column here would 42703 all of them at once.
// Probed, never try-and-caught. Cached only once TRUE, so the first read after the owner
// runs the DDL picks it up with no restart.
let _hasAttendantLedFlag = false;
async function hasAttendantLedFlag() {
  if (_hasAttendantLedFlag) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='attendant_led_autoclose' LIMIT 1`);
    _hasAttendantLedFlag = rows.length > 0;
  } catch { _hasAttendantLedFlag = false; }
  return _hasAttendantLedFlag;
}

// Does the hub-and-spokes MIGRATION FLAG exist yet? Same hot-read guard as the three
// flags above — GET /settings is called by POS, Shifts and Settings, so naming a
// not-yet-migrated column here would 42703 all of them at once. Probed, never
// try-and-caught. Cached only once TRUE, so the first read after the owner runs the
// DDL picks it up with no restart.
let _hasHubSpokesFlag = false;
async function hasHubSpokesFlag() {
  if (_hasHubSpokesFlag) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='hub_spokes_migration_enabled' LIMIT 1`);
    _hasHubSpokesFlag = rows.length > 0;
  } catch { _hasHubSpokesFlag = false; }
  return _hasHubSpokesFlag;
}

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
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/nozzles', authenticate, requireStationId('id'), async (req, res, next) => {
  try {
    const nm = await pumpService.nozzleNameSelect(pool);
    const { rows } = await pool.query(
      `SELECT n.*, t.tank_number, t.fuel_type AS tank_fuel${nm.col} FROM nozzles n
       LEFT JOIN tanks t ON t.id=n.tank_id
       ${nm.join}
       WHERE n.station_id=$1 ORDER BY n.nozzle_number`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/stations/:id/settings
router.post('/:id/settings', authenticate, requireStationId('id'), requirePerm('settings.manage'), async (req, res, next) => {
  try {
    // ── The hub-and-spokes MIGRATION FLAG — a temporary switch, not a feature ──
    // Written through the SAME settings endpoint (cardinal rule, no route of its own),
    // and checked HERE, before the upsert below, so a refused flip writes nothing at
    // all — not even updated_at.
    //
    // TWO REFUSALS, both enforced in the backend rather than the screen. A guard that
    // lives only in the frontend is not a guard:
    //   1. OWNER ONLY. This changes the outlet's whole operating model; holding
    //      settings.manage is not enough to decide it.
    //   2. NOT WHILE A SHIFT IS OPEN, in EITHER direction. Half a shift under one model
    //      and half under the other leaves an opening reading nobody can defend.
    if (req.body.hub_spokes_migration_enabled !== undefined) {
      if (req.user.role !== 'owner') {
        return res.status(403).json({
          error: 'owner_only',
          message: 'Only the outlet owner can change the outlet flow.',
        });
      }
      const { rows: openShifts } = await pool.query(
        `SELECT sh.shift_number, to_char(sh.date, 'DD Mon YYYY') AS on_date
           FROM shifts sh
          WHERE sh.station_id=$1 AND sh.status='open'
          ORDER BY sh.date, sh.shift_number`, [req.params.id]);
      if (openShifts.length) {
        const which = openShifts.map(o => `shift ${o.shift_number} of ${o.on_date}`).join(', ');
        return res.status(409).json({
          error: 'shift_open',
          open_shifts: openShifts.length,
          message: openShifts.length === 1
            ? `The outlet flow cannot change while a shift is open — ${which} is still running. Close it first.`
            : `The outlet flow cannot change while shifts are open — ${which} are still running. Close them first.`,
        });
      }
    }

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

    // The outlet's settlement policy, written through the SAME settings endpoint
    // rather than a route of its own — the cardinal rule. Guarded separately for the
    // same reason invoice_fy is: this code deploys before the owner runs the DDL, and
    // naming a missing column in the main upsert would 42703 the whole settings save,
    // geofence tab included. Absent column → the outlet keeps today's behaviour.
    if (req.body.self_settlement_enabled !== undefined) {
      const on = req.body.self_settlement_enabled === true || req.body.self_settlement_enabled === 'true';
      if (await hasSelfSettleFlag()) {
        const { rows: upd } = await pool.query(
          `UPDATE station_settings SET self_settlement_enabled=$2, updated_at=NOW()
            WHERE station_id=$1 RETURNING *`, [req.params.id, on]);
        if (upd.length) rows[0] = upd[0];
      }
    }

    // The Accounts module on/off switch — same EXISTING settings endpoint (cardinal
    // rule, no route of its own) and the same separate-guard reason: this code deploys
    // before the owner runs the DDL, so an absent column just leaves the module OFF (its
    // default) instead of 42703-ing the whole settings save, geofence tab included.
    if (req.body.accounts_enabled !== undefined) {
      const on = req.body.accounts_enabled === true || req.body.accounts_enabled === 'true';
      if (await hasAccountsFlag()) {
        const { rows: upd } = await pool.query(
          `UPDATE station_settings SET accounts_enabled=$2, updated_at=NOW()
            WHERE station_id=$1 RETURNING *`, [req.params.id, on]);
        if (upd.length) rows[0] = upd[0];
      }
    }

    // The migration flag itself. Guarded like the two above so this code is harmless
    // before the owner runs the DDL — an absent column leaves the outlet on the old
    // flow. The owner-only and open-shift refusals already ran at the top of this
    // handler, so reaching here means the flip is allowed.
    if (req.body.hub_spokes_migration_enabled !== undefined) {
      const on = req.body.hub_spokes_migration_enabled === true || req.body.hub_spokes_migration_enabled === 'true';
      if (await hasHubSpokesFlag()) {
        const { rows: upd } = await pool.query(
          `UPDATE station_settings SET hub_spokes_migration_enabled=$2, updated_at=NOW()
            WHERE station_id=$1 RETURNING *`, [req.params.id, on]);
        if (upd.length) rows[0] = upd[0];
      }
    }

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
      // Derived from the nozzle's own name when not given — see pumpService.
      vals.push(pump_id || null,
                slip_nozzle_no || (pump_id ? pumpService.defaultSlipNo(nozzle_number) : null));
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
      // undefined = caller said nothing, so derive; '' = caller cleared it on purpose.
      vals.push(slip_nozzle_no === undefined
        ? pumpService.defaultSlipNo(nozzle_number)
        : (slip_nozzle_no || null));
      sets.push(`slip_nozzle_no=COALESCE($${vals.length}, slip_nozzle_no)`);
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
    res.json({ ok:true });
  } catch(err) { next(err); }
});

// GET /api/stations/:id/settings
router.get('/:id/settings', authenticate, requireStationId('id'), async (req, res, next) => {
  try {
    // TRUE when the column is absent: an outlet that predates the switch settles
    // exactly as it does today, which is what makes shipping this code before the
    // DDL harmless.
    const selfSettleCol = (await hasSelfSettleFlag())
      ? ', COALESCE(ss.self_settlement_enabled, TRUE) AS self_settlement_enabled'
      : ', TRUE AS self_settlement_enabled';
    // FALSE when the column is absent: an outlet that predates the switch reads as
    // Accounts-off, which is what makes shipping this code before the DDL harmless.
    const accountsCol = (await hasAccountsFlag())
      ? ', COALESCE(ss.accounts_enabled, FALSE) AS accounts_enabled'
      : ', FALSE AS accounts_enabled';
    // FALSE when the column is absent: an outlet that predates the switch reads as
    // manager-led (today's behaviour), which is what makes shipping this before the DDL
    // harmless.
    const attendantLedCol = (await hasAttendantLedFlag())
      ? ', COALESCE(ss.attendant_led_autoclose, FALSE) AS attendant_led_autoclose'
      : ', FALSE AS attendant_led_autoclose';
    // FALSE when the column is absent: an outlet that predates the migration flag reads
    // as the old flow, which is what makes shipping this before the DDL harmless.
    const hubSpokesCol = (await hasHubSpokesFlag())
      ? ', COALESCE(ss.hub_spokes_migration_enabled, FALSE) AS hub_spokes_migration_enabled'
      : ', FALSE AS hub_spokes_migration_enabled';
    const { rows } = await pool.query(
      `SELECT s.*, ss.gstn, ss.pan, ss.owner_whatsapp, ss.invoice_prefix, ss.invoice_seq,
              ss.latitude, ss.longitude, ss.geo_fence_radius, ss.geo_fence_enabled,
              COALESCE(ss.manager_blind_drop, FALSE) AS manager_blind_drop,
              COALESCE(ss.stock_tol_pct_petrol, 0.75) AS stock_tol_pct_petrol,
              COALESCE(ss.stock_tol_pct_diesel, 0.50) AS stock_tol_pct_diesel,
              COALESCE(ss.stock_tol_floor_ltrs, 20)   AS stock_tol_floor_ltrs,
              COALESCE(ss.deposit_alert_days, 2)       AS deposit_alert_days,
              COALESCE(ss.deposit_alert_amount, 0)     AS deposit_alert_amount
              ${selfSettleCol}
              ${accountsCol}
              ${attendantLedCol}
              ${hubSpokesCol}
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
    // Dimensions in, chart out — one writer, shared with the Dipstick screen.
    const { calibration_chart_id } = await calibrationService.resolveChartId(req.body);
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
    // Only touch calibration when it is actually sent — an edit that renames a tank
    // must not silently clear its chart. `provided` carries that distinction out of
    // the one writer, which also resolves dimensions to a chart row.
    const { provided: calProvided, calibration_chart_id } =
      await calibrationService.resolveChartId(req.body);
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

module.exports = router;
