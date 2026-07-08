// src/routes/tankReco.js — wet-stock (tank dip) reconciliation.
// Per tank, per shift: book_closing = opening dip + deliveries − sales(L).
// variance = actual closing dip − book_closing  (negative = loss: evaporation /
// pilferage; positive = gain: gauging error / over-receipt). Beyond a per-fuel
// tolerance (+ litre floor) → owner alert. Works in BOTH POS and manager modes
// (sales come from dispense_events, which manager mode synthesizes from the meter).
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const { sendAlert } = require('../services/alertService');

// Petrol evaporates more than diesel; CNG handled like diesel for v1.
const tolPctForFuel = (settings, fuel) => {
  const petrol = parseFloat(settings?.stock_tol_pct_petrol ?? 0.75);
  const diesel = parseFloat(settings?.stock_tol_pct_diesel ?? 0.50);
  return (fuel === 'diesel' || fuel === 'cng') ? diesel : petrol;
};

// Compute (live, no write) the per-tank reconciliation for a shift.
async function computeShiftReco(shift_id) {
  const { rows: sh } = await pool.query(
    `SELECT station_id, start_time, COALESCE(end_time, NOW()) AS end_time FROM shifts WHERE id=$1`,
    [shift_id]);
  if (!sh.length) return { station_id: null, tanks: [] };
  const { station_id, start_time, end_time } = sh[0];

  const { rows: setRows } = await pool.query(
    `SELECT stock_tol_pct_petrol, stock_tol_pct_diesel, stock_tol_floor_ltrs
     FROM station_settings WHERE station_id=$1`, [station_id]);
  const settings = setRows[0] || {};
  const floor = parseFloat(settings.stock_tol_floor_ltrs ?? 20);

  // The reconciliation compares this shift's closing dip against its opening dip.
  // So deliveries and sales must be counted for the window BETWEEN those two dip
  // READINGS — not the shift's app start/end times, which are irregular and leave
  // gaps (a tanker that arrives before the shift is opened in the app falls in the
  // gap and gets dropped → the tank gains stock no reconciliation accounts for →
  // phantom full-tank "gain"). Windowing on the dip timestamps is contiguous
  // (each shift's opening = the prior shift's closing), so every delivery lands in
  // exactly one reconciliation.
  const { rows } = await pool.query(`
    SELECT t.id AS tank_id, t.tank_number, t.fuel_type,
      op.volume_ltrs AS opening_ltrs,
      cl.volume_ltrs AS actual_closing,
      COALESCE((
        SELECT SUM(COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs))
        FROM fuel_deliveries fd
        WHERE fd.tank_id = t.id
          AND fd.received_at >  COALESCE(op.recorded_at, $2)
          AND fd.received_at <= COALESCE(cl.recorded_at, $3)
      ), 0) AS deliveries_ltrs,
      COALESCE((
        SELECT SUM(de.quantity_ltrs) FROM dispense_events de
        JOIN nozzles n ON n.id = de.nozzle_id
        WHERE de.shift_id = $1 AND n.tank_id = t.id
          AND NOT COALESCE(de.is_voided, FALSE)
      ), 0) AS sales_ltrs
    FROM tanks t
    LEFT JOIN LATERAL (
      -- this shift's closing dip
      SELECT dr.volume_ltrs, dr.recorded_at
      FROM dipstick_readings dr
      WHERE dr.shift_id = $1 AND dr.tank_id = t.id AND dr.reading_type = 'closing'
      ORDER BY dr.recorded_at DESC LIMIT 1
    ) cl ON TRUE
    LEFT JOIN LATERAL (
      -- opening baseline: this shift's own opening dip, else the prior shift's
      -- closing dip carried forward (the reading just before this closing). NULL if
      -- neither exists — never a fabricated 0.
      SELECT dr.volume_ltrs, dr.recorded_at
      FROM dipstick_readings dr
      WHERE dr.tank_id = t.id
        AND ( (dr.shift_id = $1 AND dr.reading_type = 'opening')
              OR dr.recorded_at < COALESCE(cl.recorded_at, $3) )
      ORDER BY (CASE WHEN dr.shift_id = $1 AND dr.reading_type = 'opening' THEN 0 ELSE 1 END),
               dr.recorded_at DESC
      LIMIT 1
    ) op ON TRUE
    WHERE t.station_id = $4
    ORDER BY t.tank_number`,
    [shift_id, start_time, end_time, station_id]);

  const tanks = rows.map(r => {
    // No opening dip for the shift AND no prior dip to carry forward → no baseline.
    const hasBaseline = r.opening_ltrs != null;
    const opening    = hasBaseline ? parseFloat(r.opening_ltrs) : null;
    const deliveries = parseFloat(r.deliveries_ltrs || 0);
    const sales      = parseFloat(r.sales_ltrs || 0);
    const book       = hasBaseline ? +(opening + deliveries - sales).toFixed(2) : null;
    const hasClosing = r.actual_closing != null;
    const actual     = hasClosing ? parseFloat(r.actual_closing) : null;
    // A variance needs BOTH an opening baseline and a closing dip. Without the
    // baseline we cannot reconcile — report null, never a phantom full-tank loss.
    const reconcilable = hasBaseline && hasClosing;
    const variance   = reconcilable ? +(actual - book).toFixed(2) : null;
    const base       = hasBaseline ? opening + deliveries : 0;
    const tolerance  = +Math.max(floor, base * tolPctForFuel(settings, r.fuel_type) / 100).toFixed(2);
    const variancePct = (reconcilable && base > 0) ? +(Math.abs(variance) / base * 100).toFixed(3) : 0;
    const beyond     = reconcilable ? Math.abs(variance) > tolerance : false;
    return {
      tank_id: r.tank_id, tank_number: r.tank_number, fuel_type: r.fuel_type,
      opening_ltrs: opening, deliveries_ltrs: deliveries, sales_ltrs: sales,
      book_closing: book, actual_closing: actual,
      has_closing: hasClosing, has_baseline: hasBaseline,
      variance_ltrs: variance, variance_pct: variancePct,
      tolerance_ltrs: tolerance, beyond_tolerance: beyond,
    };
  });
  return { station_id, tanks };
}

// Compute + persist + alert. Called by the POST route and the shift-close hook.
async function finalizeShiftReco(shift_id, userId, io) {
  const { station_id, tanks } = await computeShiftReco(shift_id);
  if (!station_id) return { stored: 0, breaches: 0 };
  let stored = 0; const breaches = [];
  for (const t of tanks) {
    // Can't finalize without BOTH a closing dip and an opening baseline — storing a
    // baseline-less reco would persist a phantom full-tank variance and false alert.
    if (!t.has_closing || !t.has_baseline) continue;
    await pool.query(`
      INSERT INTO tank_reconciliation
        (station_id, shift_id, tank_id, opening_ltrs, deliveries_ltrs, sales_ltrs,
         book_closing, actual_closing, variance_ltrs, variance_pct, tolerance_ltrs, beyond_tolerance, recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(shift_id, tank_id) DO UPDATE SET
        opening_ltrs=$4, deliveries_ltrs=$5, sales_ltrs=$6, book_closing=$7, actual_closing=$8,
        variance_ltrs=$9, variance_pct=$10, tolerance_ltrs=$11, beyond_tolerance=$12,
        recorded_by=$13, created_at=NOW()`,
      [station_id, shift_id, t.tank_id, t.opening_ltrs, t.deliveries_ltrs, t.sales_ltrs,
       t.book_closing, t.actual_closing, t.variance_ltrs, t.variance_pct, t.tolerance_ltrs, t.beyond_tolerance, userId || null]);
    stored++;
    if (t.beyond_tolerance) breaches.push(t);
  }
  for (const t of breaches) {
    const loss = t.variance_ltrs < 0;
    await sendAlert({
      station_id,
      alert_type: 'stock_variance',
      severity:   Math.abs(t.variance_ltrs) > t.tolerance_ltrs * 2 ? 'critical' : 'warning',
      message:    `Tank ${t.tank_number} (${t.fuel_type}) ${loss ? 'LOSS' : 'gain'} ${Math.abs(t.variance_ltrs).toFixed(1)} L (${t.variance_pct}%) vs book — beyond tolerance ${t.tolerance_ltrs.toFixed(1)} L.${loss ? ' Possible evaporation / pilferage.' : ''}`,
      channels:   ['whatsapp'],
      io,
    });
  }
  return { stored, breaches: breaches.length };
}

// Live tank status: compare the latest TWO dip readings and surface the
// unexplained variance between them (physical change vs book change =
// deliveries − sales in that window). Works for ATG sensors polling every few
// minutes AND for manual dips — last_reading_at tells the owner how fresh it is.
async function computeLiveTankStatus(station_id) {
  if (!station_id) return [];
  const { rows: setRows } = await pool.query(
    `SELECT stock_tol_pct_petrol, stock_tol_pct_diesel, stock_tol_floor_ltrs
     FROM station_settings WHERE station_id=$1`, [station_id]);
  const settings = setRows[0] || {};
  const floor = parseFloat(settings.stock_tol_floor_ltrs ?? 20);

  const { rows } = await pool.query(`
    SELECT t.id AS tank_id, t.tank_number, t.fuel_type, t.capacity_ltrs,
      lr.volume_ltrs AS current_vol, lr.recorded_at AS current_at,
      pr.volume_ltrs AS prev_vol,    pr.recorded_at AS prev_at,
      COALESCE((SELECT SUM(de.quantity_ltrs) FROM dispense_events de
         JOIN nozzles n ON n.id=de.nozzle_id
         WHERE n.tank_id=t.id AND pr.recorded_at IS NOT NULL
           AND de.occurred_at > pr.recorded_at AND de.occurred_at <= lr.recorded_at
           AND NOT COALESCE(de.is_voided,FALSE)),0) AS sales,
      COALESCE((SELECT SUM(COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs)) FROM fuel_deliveries fd
         WHERE fd.tank_id=t.id AND pr.recorded_at IS NOT NULL
           AND fd.received_at > pr.recorded_at AND fd.received_at <= lr.recorded_at),0) AS deliveries
    FROM tanks t
    LEFT JOIN LATERAL (SELECT volume_ltrs, recorded_at FROM dipstick_readings
      WHERE tank_id=t.id ORDER BY recorded_at DESC LIMIT 1) lr ON TRUE
    LEFT JOIN LATERAL (SELECT volume_ltrs, recorded_at FROM dipstick_readings
      WHERE tank_id=t.id ORDER BY recorded_at DESC OFFSET 1 LIMIT 1) pr ON TRUE
    WHERE t.station_id=$1 ORDER BY t.tank_number`, [station_id]);

  return rows.map(r => {
    const hasCurrent = r.current_vol != null;
    const hasPrev    = r.prev_vol != null;
    const currentVol = hasCurrent ? parseFloat(r.current_vol) : null;
    const capacity   = r.capacity_ltrs ? parseFloat(r.capacity_ltrs) : null;
    const fillPct    = (hasCurrent && capacity) ? +(currentVol / capacity * 100).toFixed(1) : null;
    let variance = null, tolerance = null, beyond = false, status = 'no_data';
    if (hasCurrent && hasPrev) {
      const prevVol    = parseFloat(r.prev_vol);
      const sales      = parseFloat(r.sales || 0);
      const deliveries = parseFloat(r.deliveries || 0);
      const book       = prevVol + deliveries - sales;
      variance = +(currentVol - book).toFixed(2);
      const throughput = sales + deliveries;   // windowed → tolerate on throughput, not tank size
      const tolPct = tolPctForFuel(settings, r.fuel_type);
      tolerance = +Math.max(floor, throughput * tolPct / 100).toFixed(2);
      beyond = Math.abs(variance) > tolerance;
      status = beyond ? (variance < 0 ? 'loss' : 'gain') : 'ok';
    } else if (hasCurrent) {
      status = 'baseline'; // only one reading so far — nothing to compare against yet
    }
    return {
      tank_id: r.tank_id, tank_number: r.tank_number, fuel_type: r.fuel_type,
      capacity_ltrs: capacity, current_vol: currentVol, fill_pct: fillPct,
      last_reading_at: r.current_at || null,
      variance_ltrs: variance, tolerance_ltrs: tolerance, beyond_tolerance: beyond, status,
    };
  });
}

// GET /api/tank-reco/live?station_id= — real-time per-tank variance + freshness
router.get('/live', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try { res.json(await computeLiveTankStatus(req.query.station_id)); } catch (e) { next(e); }
});

// GET /api/tank-reco/shift/:shift_id — live preview (no write)
router.get('/shift/:shift_id', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
    try { res.json(await computeShiftReco(req.params.shift_id)); } catch (e) { next(e); }
  });

// POST /api/tank-reco/shift/:shift_id — compute + store + alert
router.post('/shift/:shift_id', authenticate, authorize('owner', 'manager'),
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
    try { res.json(await finalizeShiftReco(req.params.shift_id, req.user.id, req.io)); } catch (e) { next(e); }
  });

// GET /api/tank-reco?station_id=&days=30 — stored history + cumulative drift per tank
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days || 30)));
    const [recent, cumulative] = await Promise.all([
      pool.query(`
        SELECT tr.*, t.tank_number, t.fuel_type, s.shift_number, s.date
        FROM tank_reconciliation tr
        JOIN tanks t ON t.id = tr.tank_id
        LEFT JOIN shifts s ON s.id = tr.shift_id
        WHERE tr.station_id = $1 AND tr.created_at >= NOW() - make_interval(days => $2)
        ORDER BY tr.created_at DESC LIMIT 100`, [station_id, days]),
      pool.query(`
        SELECT t.tank_number, t.fuel_type, tr.tank_id,
          SUM(tr.variance_ltrs)                          AS cum_variance,
          COUNT(*) FILTER (WHERE tr.beyond_tolerance)::int AS breaches,
          COUNT(*)::int                                  AS recos
        FROM tank_reconciliation tr JOIN tanks t ON t.id = tr.tank_id
        WHERE tr.station_id = $1 AND tr.created_at >= NOW() - make_interval(days => $2)
        GROUP BY t.tank_number, t.fuel_type, tr.tank_id
        ORDER BY t.tank_number`, [station_id, days]),
    ]);
    res.json({ recent: recent.rows, cumulative: cumulative.rows });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.finalizeShiftReco = finalizeShiftReco;
module.exports.computeLiveTankStatus = computeLiveTankStatus;
module.exports.computeShiftReco = computeShiftReco;
