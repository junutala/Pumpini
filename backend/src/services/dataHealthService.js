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
//   4b. meter_handover_gap  — the same question asked of a NOZZLE: the prior shift's
//                             closing meter vs the next shift's opening meter. Where
//                             the server carried the figure these are equal by
//                             construction, so a difference means the opening was
//                             typed — and the litres between the two are on nobody's
//                             settlement. Advisory only.
//   5. unverified_meter_entry — a nozzle whose closing meters are ALWAYS whole
//                             litres, i.e. typed rather than read off the pump
//                             slip (which prints 3 decimals). The guardrail behind
//                             the slip scanner: without it, a manager who scans
//                             and one who invents his figures look identical.
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
  // The METER handover (flag 4b) is held to a far tighter tolerance than the tank
  // dip above, and deliberately. A dip is a physical measurement with a real error
  // bar, and a delivery can land between two shifts; a totalizer is a counter that
  // only ever goes up, so where the server carried the close forward the two figures
  // are IDENTICAL. Half a litre is slack for a manual entry's rounding, not for a
  // genuine discrepancy.
  meter_handover_tolerance_ltrs: posNum(process.env.DATA_HEALTH_METER_HANDOVER_TOLERANCE_LTRS, 0.5),
  // Unverified meter entry (flag 5). A totalizer prints 3 decimals, so a genuine
  // reading is whole about 1 time in 1000. 80% sits in the empty gap measured on
  // production: honest outlets peaked at 17% (39% on two slow premium nozzles),
  // the outlet entering by hand was at 100%. Min readings keeps a nozzle that has
  // only run a handful of shifts out of it.
  entry_whole_pct:          posNum(process.env.DATA_HEALTH_ENTRY_WHOLE_PCT, 80),
  entry_min_readings:       posInt(process.env.DATA_HEALTH_ENTRY_MIN_READINGS, 10),
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

  // ── Flag 4b: closing→opening METER gap at handover (advisory) ─────────────
  //
  // The nozzle twin of flag 4, and the reason it exists: the tank half of a handover
  // has been watched since the tripwire shipped, and the meter half — the one that
  // turns into an operator's money — has not.
  //
  // A totalizer only counts up, so where the server carried the last close forward
  // these two figures are the SAME NUMBER by construction. A difference therefore
  // says the opening was typed rather than carried, which happens in exactly the two
  // cases openingService declines to carry: a nozzle with no history, and a nozzle
  // whose previous shift had not been settled when this one opened. The first is
  // expected and rare. The second leaves the litres between the two figures on
  // NOBODY's settlement — the gap the whole carry rule exists to close — and it is
  // only visible once that earlier shift is finally settled, which is after the
  // screen could have said anything about it. Hence a tripwire rather than a
  // validation.
  //
  // Ordered by shift START TIME, not by date: at a three-shifts-a-day outlet the
  // trade date drifts inside a shift, so date ordering puts an 01:28 handover in the
  // wrong place — the same trap openingService.seedOpeningDips documents.
  //
  // Advisory only. A pump swap or a totalizer replacement is a real event that shows
  // up here, and it should — but it is not a reason to block anything.
  let meterGapRows = [];
  try {
    const { rows } = await pool.query(
      `WITH leg AS (
         SELECT s.station_id, n.id AS nozzle_id, n.nozzle_number, n.fuel_type,
                s.date, s.shift_number, s.start_time,
                san.opening_reading, san.closing_reading
           FROM shift_attendant_nozzles san
           JOIN shifts  s ON s.id = san.shift_id
           JOIN nozzles n ON n.id = san.nozzle_id
          WHERE s.station_id = ANY($1::uuid[])
            AND s.date >= ($2::date - $3::int)
       ),
       seq AS (
         SELECT leg.*,
                LAG(closing_reading) OVER w AS prev_closing,
                LAG(date)            OVER w AS prev_date,
                LAG(shift_number)    OVER w AS prev_shift_number
           FROM leg
         WINDOW w AS (PARTITION BY nozzle_id ORDER BY start_time, date, shift_number)
       )
       SELECT station_id, nozzle_number, fuel_type, date::text AS date, shift_number,
              prev_date::text AS prev_date, prev_shift_number,
              ROUND((opening_reading - prev_closing)::numeric, 3) AS diff_ltrs
         FROM seq
        WHERE opening_reading IS NOT NULL AND prev_closing IS NOT NULL
          AND ABS(opening_reading - prev_closing) > $4::numeric
        ORDER BY date DESC, shift_number DESC`,
      [ids, today, T.lookback_days, T.meter_handover_tolerance_ltrs]
    );
    meterGapRows = rows;
  } catch (e) { /* best-effort */ }

  for (const r of meterGapRows) {
    push(r.station_id, {
      type: 'meter_handover_gap',
      nozzle_number: r.nozzle_number,
      fuel_type: r.fuel_type,
      diff_ltrs: r.diff_ltrs == null ? null : Number(r.diff_ltrs),
      date: r.date,
      shift_number: r.shift_number,
      prev_date: r.prev_date,
      prev_shift_number: r.prev_shift_number,
    });
  }

  // ── Flag 5: unverified meter entry (readings typed, not read off the slip) ─
  //
  // THE GUARDRAIL BEHIND THE SCANNER. Pumpini can read a pump slip, but nothing
  // ever checked whether anyone USED it — so a manager who scans and a manager who
  // invents his numbers looked identical in the data. The scanner is a
  // convenience; this is the control.
  //
  // The tell is the DECIMAL. A dispenser totalizer prints three decimal places
  // (a real slip reads V:1654101.290), so a genuine reading lands exactly on a
  // whole litre about once in a thousand. A nozzle whose readings are ALWAYS whole
  // was not read off the printout — it was typed from memory or estimate.
  //
  // Verified against production before the threshold was chosen (01-Aug-2026):
  // one outlet's six petrol/diesel nozzles were 100% whole across 41 readings
  // EACH — 246 consecutive — while that same outlet's own CNG nozzles sat at 2%
  // and 5%. Same manager, same screen, so it is the entry path that differs, not
  // the habit. Every other outlet peaked at 17%, with two low-throughput premium
  // nozzles at 39%. The default 80% therefore sits in a wide empty gap rather
  // than being a guess.
  //
  // WHAT THIS IS NOT: it is not proof of dishonesty, and it must never be worded
  // as one. It says the number has no evidence behind it — which is exactly what
  // an owner needs to know, and exactly what he could not see before.
  //
  // Deliberately statistical: it needs NO new column and works on history already
  // in the database, so it reports what has ALREADY been happening instead of
  // waiting a month to collect provenance.
  let entryRows = [];
  try {
    const { rows } = await pool.query(
      `SELECT s.station_id, n.nozzle_number, n.fuel_type,
              COUNT(*)::int AS readings,
              COUNT(*) FILTER (WHERE san.closing_reading = TRUNC(san.closing_reading))::int AS whole_readings,
              ROUND(100.0 * COUNT(*) FILTER (WHERE san.closing_reading = TRUNC(san.closing_reading))
                    / NULLIF(COUNT(*), 0), 0) AS pct_whole,
              MAX(s.date)::text AS last_date
         FROM shift_attendant_nozzles san
         JOIN shifts s  ON s.id = san.shift_id
         JOIN nozzles n ON n.id = san.nozzle_id
        WHERE s.station_id = ANY($1::uuid[])
          AND san.closing_reading IS NOT NULL
          AND s.date >= ($2::date - $3::int)
        GROUP BY s.station_id, n.id, n.nozzle_number, n.fuel_type
       HAVING COUNT(*) >= $4::int
          AND 100.0 * COUNT(*) FILTER (WHERE san.closing_reading = TRUNC(san.closing_reading))
              / NULLIF(COUNT(*), 0) >= $5::numeric
        ORDER BY pct_whole DESC, n.nozzle_number`,
      [ids, today, T.lookback_days, T.entry_min_readings, T.entry_whole_pct]
    );
    entryRows = rows;
  } catch (e) { /* best-effort */ }

  for (const r of entryRows) {
    push(r.station_id, {
      type: 'unverified_meter_entry',
      nozzle_number: r.nozzle_number,
      fuel_type: r.fuel_type,
      readings: Number(r.readings),
      whole_readings: Number(r.whole_readings),
      pct_whole: r.pct_whole == null ? null : Number(r.pct_whole),
      last_date: r.last_date,
    });
  }

  return out;
}

module.exports = { computeDataHealth, THRESHOLDS };
