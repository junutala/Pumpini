-- ─────────────────────────────────────────────────────────────
--  GLOBAL TANK CALIBRATION LIBRARY
--  Calibration is a property of the physical tank type (geometry),
--  NOT of the outlet and NOT of the fuel (HSD vs Petrol is irrelevant).
--  There are ~11 standard tank types (mostly differing by volume), so
--  this is a small shared library that every outlet's tank points to.
--
--  Idempotent — safe to run against the shared production DB via psql.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- One row per standard tank type (the ~11)
CREATE TABLE IF NOT EXISTS tank_calibration_charts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                VARCHAR(80) NOT NULL UNIQUE,   -- e.g. '15 KL', '20 KL'
  nominal_capacity_kl NUMERIC(6,2) NOT NULL,
  manufacturer        VARCHAR(120),
  max_dip_cm          NUMERIC(5,1),
  max_volume_ltrs     NUMERIC(10,2),
  source              VARCHAR(160),                  -- provenance, e.g. 'IOCL Warangal sheet'
  notes               TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- The per-cm dip -> volume points for each chart.
-- DIFF (litres per 1 cm at this level) IS stored: it is the manufacturer's
-- accepted tolerance at that fill level (a dip reading is only good to ~1 cm,
-- so a reconciliation variance smaller than DIFF litres is within reading
-- error). It also doubles as a monotonic/smoothness check at ingest time.
CREATE TABLE IF NOT EXISTS tank_calibration_points (
  chart_id      UUID NOT NULL REFERENCES tank_calibration_charts(id) ON DELETE CASCADE,
  dip_cm        NUMERIC(5,1) NOT NULL,               -- allows sub-cm charts
  volume_ltrs   NUMERIC(10,2) NOT NULL,
  diff_ltrs     NUMERIC(8,2),                        -- litres per cm at this level = tolerance basis
  PRIMARY KEY (chart_id, dip_cm)
);

-- Link each outlet's tank to a shared chart (chosen at tank setup).
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS calibration_chart_id
  UUID REFERENCES tank_calibration_charts(id);

-- ─────────────────────────────────────────────────────────────
--  Dip -> litres lookup with linear interpolation between the two
--  bounding integer-cm points (real dip readings come to 0.1 cm).
--  Usage:  SELECT calib_volume(t.calibration_chart_id, 154.9);
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calib_volume(p_chart UUID, p_dip NUMERIC)
RETURNS NUMERIC AS $$
  WITH lo AS (
    SELECT dip_cm, volume_ltrs FROM tank_calibration_points
    WHERE chart_id = p_chart AND dip_cm <= p_dip
    ORDER BY dip_cm DESC LIMIT 1),
  hi AS (
    SELECT dip_cm, volume_ltrs FROM tank_calibration_points
    WHERE chart_id = p_chart AND dip_cm >= p_dip
    ORDER BY dip_cm ASC LIMIT 1)
  SELECT CASE
    WHEN (SELECT dip_cm FROM lo) IS NULL OR (SELECT dip_cm FROM hi) IS NULL
      THEN NULL                                       -- dip outside charted range
    WHEN (SELECT dip_cm FROM lo) = (SELECT dip_cm FROM hi)
      THEN (SELECT volume_ltrs FROM lo)               -- exact hit
    ELSE
      (SELECT volume_ltrs FROM lo)
      + ((SELECT volume_ltrs FROM hi) - (SELECT volume_ltrs FROM lo))
        * (p_dip - (SELECT dip_cm FROM lo))
        / ((SELECT dip_cm FROM hi) - (SELECT dip_cm FROM lo))
  END;
$$ LANGUAGE sql STABLE;

-- ─────────────────────────────────────────────────────────────
--  Accepted per-level tolerance = manufacturer DIFF (litres in the
--  1 cm bracket containing the dip). Use this to size the stock-reco
--  variance band at the current fill level instead of a flat %.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calib_tolerance(p_chart UUID, p_dip NUMERIC)
RETURNS NUMERIC AS $$
  SELECT diff_ltrs FROM tank_calibration_points
  WHERE chart_id = p_chart AND dip_cm >= p_dip AND diff_ltrs IS NOT NULL
  ORDER BY dip_cm ASC LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ─────────────────────────────────────────────────────────────
--  NOTE — dip ENTRY convention (handled in the dipstick form, not here):
--  The stick has 4 minor marks per cm (0.2 cm each). The manager enters
--  the mark ordinal as a decimal, e.g. "64.2" = 64 + 2nd mark. The TRUE
--  dip is therefore  whole + (decimal_digit * 0.2)  =>  64.2 entered = 64.4
--  cm actual. Convert to true cm BEFORE calling calib_volume(). Entered
--  decimals are only valid in .0–.4.
-- ─────────────────────────────────────────────────────────────
