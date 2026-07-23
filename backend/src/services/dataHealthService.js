// src/services/dataHealthService.js
//
// Data-health tripwire — an ADDITIVE, READ-ONLY monitoring layer that flags
// out-of-sync data entry per outlet (and, via the caller, across an owner's
// outlets). It NEVER writes, never touches money/masking, and adds NO schema:
// everything is computed from existing `shifts`, `dipstick_readings`, `tanks`.
//
// One computation writer for the concept (anti-drift rule): both the per-station
// and the owner-group endpoints funnel through `computeDataHealth()` so the flag
// logic lives in exactly one place.
//
// Flags surfaced:
//   1. missing_dip          — no dip reading for a tank for >= N days (default 2).
//   2. overdue_physical_dip — no PHYSICAL dip (dipstick_readings.dip_cm NOT NULL)
//                             in > 7 days, when a recent system/ATG reading exists.
//   3. stale_open_shift     — a shift left `open` past its trade day (shifts.date).
//   3b. late_close          — a shift closed/reconciled far later (in IST calendar
//                             days) than its trade day (batch/late data entry).
//   4. handover_mismatch    — a tank's prior-shift CLOSING dip vs the next-shift
//                             OPENING dip differ beyond a small litre tolerance
//                             (a wet-stock red flag). Advisory only.
//
// House model verified against pumpini-schema.snapshot.sql + routes/dipstick.js:
//   - dipstick_readings.reading_type ∈ ('opening','mid_shift','closing'), tied to
//     shift_id  → distinguishes opening vs closing dips.
//   - dip_cm NOT NULL = a PHYSICAL dip; dip_cm NULL with volume_ltrs set = a
//     system/ATG reading (see routes/dipstick.js).
//   - CNG is sold by weight and is never dipped, so CNG tanks are excluded from
//     the dip-staleness flags (mirrors the dashboard's "gas · no dip" handling).
const pool = require('../db/pool');

// Thresholds — named constants, overridable by env, with safe defaults.
const posInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const posNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

const THRESHOLDS = {
  dip_stale_days:           posInt(process.env.DATA_HEALTH_DIP_STALE_DAYS, 2),
  physical_dip_days:        posInt(process.env.DATA_HEALTH_PHYSICAL_DIP_DAYS, 7),
  open_shift_days:          posInt(process.env.DATA_HEALTH_OPEN_SHIFT_DAYS, 1),
  late_close_days:          posInt(process.env.DATA_HEALTH_LATE_CLOSE_DAYS, 2),
  handover_tolerance_ltrs:  posNum(process.env.DATA_HEALTH_HANDOVER_TOLERANCE_LTRS, 50),
  // Shifts/handovers older than this window are ignored — the tripwire is about
  // recent, actionable data-entry drift, and this keeps the queries bounded.
  lookback_days:            posInt(process.env.DATA_HEALTH_LOOKBACK_DAYS, 30),
};

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Compute data-health flags for a set of stations in ONE pass (no N+1 across
// outlets — every query is aggregate over `station_id = ANY($ids)`). Returns a
// map { [stationId]: { count, flags } }. Every query is best-effort: a failure
// degrades to "no flags of that kind" rather than throwing, so a data-health
// read can never 500 a dashboard.
async function computeDataHealth(stationIds, today = istToday()) {
  const ids = Array.from(new Set((stationIds || []).filter(Boolean)));
  const out = {};
  ids.forEach(id => { out[id] = { count: 0, flags: [] }; });
  if (!ids.length) return out;

  const push = (sid, flag) => { if (out[sid]) { out[sid].flags.push(flag); out[sid].count++; } };

  const T = THRESHOLDS;

  // ── Flags 1 & 2: dip staleness per tank (CNG excluded) ────────────────────
  // Day-diffs are computed in IST calendar days in SQL to avoid tz drift.
  let dipRows = [];
  try {
    const { rows } = await pool.query(
      `SELECT t.station_id, t.tank_number, t.fuel_type,
              ($2::date - (MAX(dr.recorded_at) AT TIME ZONE 'Asia/Kolkata')::date) AS days_since_dip,
              ($2::date - (MAX(dr.recorded_at) FILTER (WHERE dr.dip_cm IS NOT NULL)
                           AT TIME ZONE 'Asia/Kolkata')::date)                     AS days_since_physical
         FROM tanks t
         LEFT JOIN dipstick_readings dr ON dr.tank_id = t.id
        WHERE t.station_id = ANY($1::uuid[])
          AND LOWER(COALESCE(t.fuel_type, '')) <> 'cng'
        GROUP BY t.station_id, t.id, t.tank_number, t.fuel_type
        ORDER BY t.station_id, t.tank_number`,
      [ids, today]
    );
    dipRows = rows;
  } catch (e) { /* best-effort */ }

  for (const r of dipRows) {
    const dipDays = r.days_since_dip == null ? null : Number(r.days_since_dip);
    const physDays = r.days_since_physical == null ? null : Number(r.days_since_physical);
    const missing = dipDays == null || dipDays >= T.dip_stale_days;
    if (missing) {
      push(r.station_id, {
        type: 'missing_dip',
        tank_number: r.tank_number,
        fuel_type: r.fuel_type,
        days: dipDays,                 // null = never dipped
      });
    } else {
      // A recent reading exists, but is it a PHYSICAL one within the weekly window?
      const physOverdue = physDays == null || physDays > T.physical_dip_days;
      if (physOverdue) {
        push(r.station_id, {
          type: 'overdue_physical_dip',
          tank_number: r.tank_number,
          fuel_type: r.fuel_type,
          days: physDays,             // null = no physical dip on record
        });
      }
    }
  }

  // ── Flag 3 / 3b: stale-open shifts + late closes per station ──────────────
  let shiftRows = [];
  try {
    const { rows } = await pool.query(
      `SELECT s.station_id,
              COUNT(*) FILTER (
                WHERE s.status = 'open' AND s.date < ($2::date - $3::int)
              )::int AS stale_open,
              MIN(s.date) FILTER (
                WHERE s.status = 'open' AND s.date < ($2::date - $3::int)
              )::text AS oldest_open_date,
              COUNT(*) FILTER (
                WHERE s.status IN ('closed', 'reconciled') AND s.end_time IS NOT NULL
                  AND (s.end_time AT TIME ZONE 'Asia/Kolkata')::date > (s.date + $4::int)
              )::int AS late_close
         FROM shifts s
        WHERE s.station_id = ANY($1::uuid[])
          AND s.date >= ($2::date - $5::int)
        GROUP BY s.station_id`,
      [ids, today, T.open_shift_days, T.late_close_days, T.lookback_days]
    );
    shiftRows = rows;
  } catch (e) { /* best-effort */ }

  for (const r of shiftRows) {
    if (r.stale_open > 0) {
      push(r.station_id, {
        type: 'stale_open_shift',
        count: r.stale_open,
        oldest_date: r.oldest_open_date,
      });
    }
    if (r.late_close > 0) {
      push(r.station_id, { type: 'late_close', count: r.late_close });
    }
  }

  // ── Flag 4: closing→opening dip mismatch at handover (advisory) ───────────
  // Per tank, chronologically adjacent shifts: prior CLOSING dip vs next OPENING
  // dip. DISTINCT ON collapses duplicate readings of the same type in a shift to
  // the latest. A genuine inter-shift delivery could explain a jump, so this is
  // advisory only (does not gate anything).
  let mismatchRows = [];
  try {
    const { rows } = await pool.query(
      `WITH d AS (
         SELECT DISTINCT ON (dr.tank_id, dr.shift_id, dr.reading_type)
                dr.tank_id, dr.shift_id, dr.reading_type, dr.volume_ltrs
           FROM dipstick_readings dr
          WHERE dr.station_id = ANY($1::uuid[])
            AND dr.reading_type IN ('opening', 'closing')
            AND dr.volume_ltrs IS NOT NULL
          ORDER BY dr.tank_id, dr.shift_id, dr.reading_type, dr.recorded_at DESC
       ),
       sd AS (
         SELECT t.station_id, t.id AS tank_id, t.tank_number, t.fuel_type,
                s.date, s.shift_number, s.start_time,
                MAX(d.volume_ltrs) FILTER (WHERE d.reading_type = 'opening') AS opening,
                MAX(d.volume_ltrs) FILTER (WHERE d.reading_type = 'closing') AS closing
           FROM tanks t
           JOIN shifts s ON s.station_id = t.station_id
           JOIN d       ON d.tank_id = t.id AND d.shift_id = s.id
          WHERE t.station_id = ANY($1::uuid[])
            AND s.date >= ($2::date - $3::int)
          GROUP BY t.station_id, t.id, t.tank_number, t.fuel_type,
                   s.id, s.date, s.shift_number, s.start_time
       ),
       seq AS (
         SELECT sd.*,
                LAG(closing)      OVER w AS prev_closing,
                LAG(date)         OVER w AS prev_date,
                LAG(shift_number) OVER w AS prev_shift_number
           FROM sd
         WINDOW w AS (PARTITION BY tank_id ORDER BY date, shift_number, start_time NULLS LAST)
       )
       SELECT station_id, tank_number, fuel_type, date::text AS date, shift_number,
              prev_date::text AS prev_date, prev_shift_number,
              ROUND((opening - prev_closing)::numeric, 2) AS diff_ltrs
         FROM seq
        WHERE opening IS NOT NULL AND prev_closing IS NOT NULL
          AND ABS(opening - prev_closing) > $4::numeric
        ORDER BY date DESC, shift_number DESC`,
      [ids, today, T.lookback_days, T.handover_tolerance_ltrs]
    );
    mismatchRows = rows;
  } catch (e) { /* best-effort */ }

  for (const r of mismatchRows) {
    push(r.station_id, {
      type: 'handover_mismatch',
      tank_number: r.tank_number,
      fuel_type: r.fuel_type,
      diff_ltrs: r.diff_ltrs == null ? null : Number(r.diff_ltrs),
      date: r.date,
      shift_number: r.shift_number,
      prev_date: r.prev_date,
      prev_shift_number: r.prev_shift_number,
    });
  }

  return out;
}

module.exports = { computeDataHealth, THRESHOLDS };
