// src/routes/tankReco.js — wet-stock (tank dip) reconciliation.
// Per tank, per shift: book_closing = opening dip + deliveries − sales(L).
// variance = actual closing dip − book_closing  (negative = loss: evaporation /
// pilferage; positive = gain: gauging error / over-receipt). Beyond a per-fuel
// tolerance (+ litre floor) → owner alert. Works in BOTH POS and manager modes
// (sales come from dispense_events, which manager mode synthesizes from the meter).
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
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
          AND fd.received_at >  COALESCE(win.from_at, op.recorded_at, $2)
          AND fd.received_at <= COALESCE(cl.recorded_at, $3)
      ), 0) AS deliveries_ltrs,
      COALESCE(win.from_at, op.recorded_at) AS delivery_window_from,
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
      SELECT dr.volume_ltrs, dr.recorded_at,
             (dr.shift_id = $1 AND dr.reading_type = 'opening') AS is_own_opening
      FROM dipstick_readings dr
      WHERE dr.tank_id = t.id
        AND ( (dr.shift_id = $1 AND dr.reading_type = 'opening')
              OR dr.recorded_at < COALESCE(cl.recorded_at, $3) )
      ORDER BY (CASE WHEN dr.shift_id = $1 AND dr.reading_type = 'opening' THEN 0 ELSE 1 END),
               dr.recorded_at DESC
      LIMIT 1
    ) op ON TRUE
    LEFT JOIN LATERAL (
      -- The reading this shift's OPENING dip chains from — the previous shift's
      -- closing dip. Needed only to decide the delivery window (see win, below).
      SELECT dr.volume_ltrs, dr.recorded_at
      FROM dipstick_readings dr
      WHERE dr.tank_id = t.id
        AND dr.reading_type = 'closing'
        AND (dr.shift_id IS NULL OR dr.shift_id <> $1)
        AND dr.recorded_at < op.recorded_at
      ORDER BY dr.recorded_at DESC LIMIT 1
    ) pc ON TRUE
    LEFT JOIN LATERAL (
      -- Where this reconciliation starts counting DELIVERIES.
      --
      -- Normally that is the opening baseline itself. But managers dip at shift
      -- CLOSE and then re-key the same figure as the next shift's OPENING, hours
      -- later — so consecutive reconciliations did NOT tile the timeline: a tanker
      -- decanted between one shift's closing dip and the next shift's opening dip
      -- fell in the hole and was counted by NO reconciliation. Book stayed at the
      -- pre-delivery level while the dip showed the full tank, surfacing a phantom
      -- full-tanker "gain" (Kamala T1, 18-Jul-2026: +10,386 L on a 10,000 L decant)
      -- that then flattered the 30-day drift KPI to green while the tank was
      -- actually losing stock every day.
      --
      -- The test is PHYSICAL, not a timestamp comparison — received_at is typed
      -- by hand off the challan and is routinely an hour or two out (Kamala,
      -- 24-Jul-2026: recorded 04:00, but the 04:45 opening dip proves the tanker
      -- had not yet decanted). Stock in a tank only RISES on a delivery. So if the
      -- opening dip is no higher than the prior closing dip, no delivery can be
      -- baked into it, and anything recorded in the gap belongs to THIS
      -- reconciliation — start the window at the prior closing dip and the hole
      -- closes. If the opening dip is higher, the tank demonstrably gained stock
      -- before it was read: that dip already absorbed the delivery, so the window
      -- stays put and we do not double-count.
      --
      -- (+1 L of slack absorbs dip-chart rounding on an otherwise flat re-key.)
      SELECT CASE
        WHEN op.is_own_opening AND pc.recorded_at IS NOT NULL
             AND op.volume_ltrs <= pc.volume_ltrs + 1
        THEN pc.recorded_at ELSE op.recorded_at END AS from_at
    ) win ON TRUE
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
      delivery_window_from: r.delivery_window_from || null,
      variance_ltrs: variance, variance_pct: variancePct,
      tolerance_ltrs: tolerance, beyond_tolerance: beyond,
    };
  });
  return { station_id, tanks };
}

// Reconcile a DATE RANGE as ONE interval: the opening dip at the start of the
// period, the closing dip at the end, and every delivery and sale in between.
//
// Deliberately NOT a sum of the per-shift variances. Summing accumulates per-shift
// noise instead of cancelling it — a sale keyed to the wrong shift lands twice,
// once each way, and neither cancels because both are squared away into separate
// rows. The interval only cares about the period's totals, so that noise drops out
// the way it physically should. Kamala petrol for July: +0.88% as an interval,
// against +30,243 L when the same shifts were summed.
//
// A single day is just a short period, so the day view and the month view are the
// same computation with different bounds.
async function computePeriodReco(station_id, dateFrom, dateTo) {
  if (!station_id || !dateFrom || !dateTo) return { station_id, tanks: [], totals: [] };

  const { rows: setRows } = await pool.query(
    `SELECT stock_tol_pct_petrol, stock_tol_pct_diesel, stock_tol_floor_ltrs
     FROM station_settings WHERE station_id=$1`, [station_id]);
  const settings = setRows[0] || {};
  const floor = parseFloat(settings.stock_tol_floor_ltrs ?? 20);

  const { rows } = await pool.query(`
    WITH dips AS (
      -- Bucket by TRADE date, not wall-clock. A shift dated the 27th closes around
      -- 06:30 IST on the 28th, so filtering on the raw timestamp would slice that
      -- shift's closing dip off the 27th and leave the day unreconcilable.
      SELECT dr.tank_id, dr.shift_id, dr.reading_type, dr.volume_ltrs, dr.recorded_at,
             COALESCE(sh.date, (dr.recorded_at AT TIME ZONE 'Asia/Kolkata')::date) AS trade_date
      FROM dipstick_readings dr
      LEFT JOIN shifts sh ON sh.id = dr.shift_id
      WHERE dr.station_id = $1
    ),
    dedup AS (
      -- A re-keyed dip supersedes the earlier one for the same shift + type. A typo
      -- correction leaves BOTH rows behind and only the last is true (Kamala T2,
      -- 01-Jul: 62.00 cm then 77.30 cm, eight seconds apart).
      SELECT DISTINCT ON (tank_id, shift_id, reading_type)
             tank_id, volume_ltrs, recorded_at
      FROM dips
      WHERE trade_date >= $2::date AND trade_date <= $3::date
      ORDER BY tank_id, shift_id, reading_type, recorded_at DESC
    )
    SELECT t.id AS tank_id, t.tank_number, t.fuel_type,
      op.volume_ltrs AS opening_ltrs, op.recorded_at AS opening_at,
      cl.volume_ltrs AS actual_closing, cl.recorded_at AS closing_at,
      COALESCE((
        SELECT SUM(COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs))
        FROM fuel_deliveries fd
        WHERE fd.tank_id = t.id
          AND fd.received_at >  op.recorded_at
          AND fd.received_at <= cl.recorded_at
      ), 0) AS deliveries_ltrs,
      COALESCE((
        -- Sales attach by SHIFT, never by timestamp. In manager mode dispense_events
        -- are synthesized from meter readings and every event in a shift is stamped
        -- with the same constant (Kamala 27-Jul: all 21 events at 06:30:00Z, hours
        -- before that shift's own opening dip at 13:09Z). Windowing on occurred_at
        -- therefore drops the entire shift and reports zero sales. The shifts dated
        -- inside the period are exactly the ones the opening and closing dips bound,
        -- and this also picks up shifts that were never dipped at all — whose sales
        -- still physically left the tank and must be accounted for.
        SELECT SUM(de.quantity_ltrs) FROM dispense_events de
        JOIN nozzles n  ON n.id  = de.nozzle_id
        JOIN shifts  sh2 ON sh2.id = de.shift_id
        WHERE n.tank_id = t.id
          AND sh2.station_id = $1
          AND sh2.date >= $2::date AND sh2.date <= $3::date
          AND NOT COALESCE(de.is_voided, FALSE)
      ), 0) AS sales_ltrs
    FROM tanks t
    LEFT JOIN LATERAL (
      SELECT d.volume_ltrs, d.recorded_at FROM dedup d
      WHERE d.tank_id = t.id ORDER BY d.recorded_at DESC LIMIT 1
    ) cl ON TRUE
    LEFT JOIN LATERAL (
      -- First dip inside the period, provided it isn't the closing one itself.
      SELECT d.volume_ltrs, d.recorded_at FROM dedup d
      WHERE d.tank_id = t.id AND d.recorded_at < cl.recorded_at
      ORDER BY d.recorded_at ASC LIMIT 1
    ) fo ON TRUE
    LEFT JOIN LATERAL (
      -- Fallback when the period holds only ONE dip: chain back to the last dip
      -- before it. Otherwise a day where the manager dipped only at close could
      -- never reconcile, which is most of them.
      SELECT dp.volume_ltrs, dp.recorded_at FROM dips dp
      WHERE dp.tank_id = t.id AND dp.trade_date < $2::date
      ORDER BY dp.recorded_at DESC LIMIT 1
    ) pb ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(fo.volume_ltrs, pb.volume_ltrs) AS volume_ltrs,
             COALESCE(fo.recorded_at, pb.recorded_at) AS recorded_at
    ) op ON TRUE
    WHERE t.station_id = $4
    ORDER BY t.tank_number`,
    [station_id, dateFrom, dateTo, station_id]);

  const shape = (r, opening, deliveries, sales, actual, fuel) => {
    const reconcilable = opening != null && actual != null;
    const book      = reconcilable ? +(opening + deliveries - sales).toFixed(2) : null;
    const variance  = reconcilable ? +(actual - book).toFixed(2) : null;
    const base      = reconcilable ? opening + deliveries : 0;
    const tolerance = +Math.max(floor, base * tolPctForFuel(settings, fuel) / 100).toFixed(2);
    const pct       = (reconcilable && base > 0) ? +(variance / base * 100).toFixed(2) : null;
    return { book_closing: book, variance_ltrs: variance, variance_pct: pct,
             tolerance_ltrs: tolerance,
             beyond_tolerance: reconcilable ? Math.abs(variance) > tolerance : false };
  };

  const tanks = rows.map(r => {
    const opening    = r.opening_ltrs   != null ? parseFloat(r.opening_ltrs)   : null;
    const actual     = r.actual_closing != null ? parseFloat(r.actual_closing) : null;
    const deliveries = parseFloat(r.deliveries_ltrs || 0);
    const sales      = parseFloat(r.sales_ltrs || 0);
    return {
      tank_id: r.tank_id, tank_number: r.tank_number, fuel_type: r.fuel_type,
      opening_ltrs: opening, deliveries_ltrs: deliveries, sales_ltrs: sales,
      actual_closing: actual,
      has_baseline: opening != null, has_closing: actual != null,
      opening_at: r.opening_at || null, closing_at: r.closing_at || null,
      ...shape(r, opening, deliveries, sales, actual, r.fuel_type),
    };
  });

  // Where a station runs SEVERAL tanks of one fuel, the per-tank split is only as
  // good as the nozzle-to-tank mapping, and the pumps may draw from either tank.
  // Kamala's two diesel tanks read -6,861 L and +7,496 L for July and net to
  // +635 L (0.56% of throughput) — the fuel is all present, it is just booked
  // against the wrong tank. So the fuel TOTAL is the honest verdict, and judging a
  // single tank alone would raise an alarm about nothing. Only emitted when the
  // fuel actually has more than one tank, since otherwise it just repeats the row.
  const totals = [];
  const byFuel = tanks.filter(t => t.has_baseline && t.has_closing)
    .reduce((m, t) => { (m[t.fuel_type] = m[t.fuel_type] || []).push(t); return m; }, {});
  for (const [fuel, list] of Object.entries(byFuel)) {
    if (list.length < 2) continue;
    const sum = k => +list.reduce((a, t) => a + (t[k] || 0), 0).toFixed(2);
    const opening = sum('opening_ltrs'), deliveries = sum('deliveries_ltrs');
    const sales = sum('sales_ltrs'), actual = sum('actual_closing');
    totals.push({
      fuel_type: fuel, tank_count: list.length,
      tank_numbers: list.map(t => t.tank_number),
      opening_ltrs: opening, deliveries_ltrs: deliveries, sales_ltrs: sales,
      actual_closing: actual, has_baseline: true, has_closing: true,
      ...shape(null, opening, deliveries, sales, actual, fuel),
    });
  }

  return { station_id, date_from: dateFrom, date_to: dateTo, tanks, totals };
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

// GET /api/tank-reco/period?station_id=&date_from=&date_to= — reconcile a date
// range as one interval. Powers BOTH the day tile and the month tile.
router.get('/period', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, date_from, date_to } = req.query;
    if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to are required.' });
    res.json(await computePeriodReco(station_id, date_from, date_to));
  } catch (e) { next(e); }
});

// GET /api/tank-reco/last-day?station_id= — the most recent trade day that has any
// dip at all, so the day tile can open on real data instead of an empty today.
router.get('/last-day', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT MAX(COALESCE(sh.date, (dr.recorded_at AT TIME ZONE 'Asia/Kolkata')::date))::text AS last_day
      FROM dipstick_readings dr LEFT JOIN shifts sh ON sh.id = dr.shift_id
      WHERE dr.station_id = $1`, [req.query.station_id]);
    res.json({ last_day: rows[0]?.last_day || null });
  } catch (e) { next(e); }
});

// GET /api/tank-reco/shift/:shift_id — live preview (no write)
router.get('/shift/:shift_id', authenticate,
  requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'),
  async (req, res, next) => {
    try { res.json(await computeShiftReco(req.params.shift_id)); } catch (e) { next(e); }
  });

// POST /api/tank-reco/shift/:shift_id — compute + store + alert
router.post('/shift/:shift_id', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), requirePerm('stock.reconcile'),
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
module.exports.computePeriodReco = computePeriodReco;
module.exports.computeLiveTankStatus = computeLiveTankStatus;
module.exports.computeShiftReco = computeShiftReco;
