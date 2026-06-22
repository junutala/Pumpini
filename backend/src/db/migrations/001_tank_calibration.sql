-- ─────────────────────────────────────────────────────────────
--  GLOBAL TANK CALIBRATION — FORMULA-BASED
--
--  An underground tank is a horizontal cylinder, so dip -> volume is a
--  deterministic function of just two numbers: diameter (D) and length (L),
--  in cm. We therefore DO NOT store per-cm chart data; we store (D, L) per
--  standard tank type (~11 of them) and compute volume + tolerance on the fly.
--
--  Verified against the IOCL Warangal sheets:
--    15KL  D=194 L=525  -> reproduces the chart to ~0.1%
--    20KL  D=210 L=625  -> reproduces the chart to ~0.3% (max 0.35%)
--  Both well inside the per-level DIFF tolerance, so the formula is as good
--  as the printed chart for reconciliation — and it self-corrects OCR slips.
--
--  Idempotent — safe to run against the shared production DB via psql.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- One row per standard tank type (the ~11). Geometry only — fuel-agnostic.
CREATE TABLE IF NOT EXISTS tank_calibration_charts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                VARCHAR(80) NOT NULL UNIQUE,   -- e.g. '15KL', '20KL'
  diameter_cm         NUMERIC(6,1) NOT NULL,         -- D  (max dip = D)
  length_cm           NUMERIC(7,1) NOT NULL,         -- L
  manufacturer        VARCHAR(120),
  source              VARCHAR(160),                  -- provenance / verification note
  notes               TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Link each outlet's tank to a shared type (chosen from a dropdown at setup).
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS calibration_chart_id
  UUID REFERENCES tank_calibration_charts(id);

-- ─────────────────────────────────────────────────────────────
--  dip (cm, true) -> litres, via the circular-segment volume of a
--  horizontal cylinder:  V = [ r²·acos((r-h)/r) - (r-h)·√(2rh-h²) ] · L / 1000
--  NOTE: feed the TRUE dip. The dipstick form converts the mark-ordinal
--  entry first (4 marks/cm @0.2cm: entered 64.2 = true 64.4 cm).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calib_volume(p_chart UUID, p_dip NUMERIC)
RETURNS NUMERIC AS $$
  SELECT CASE
    WHEN p_dip <= 0 THEN 0
    WHEN p_dip >= c.diameter_cm
      THEN ROUND(pi() * power(c.diameter_cm/2, 2) * c.length_cm / 1000, 2)
    ELSE ROUND((
        power(c.diameter_cm/2, 2) * acos((c.diameter_cm/2 - p_dip) / (c.diameter_cm/2))
        - (c.diameter_cm/2 - p_dip) * sqrt(2*(c.diameter_cm/2)*p_dip - p_dip*p_dip)
      ) * c.length_cm / 1000, 2)
  END
  FROM tank_calibration_charts c WHERE c.id = p_chart;
$$ LANGUAGE sql STABLE;

-- ─────────────────────────────────────────────────────────────
--  Accepted ± tolerance at this dip = litres in 1 mm of dip = the liquid
--  surface area · 0.1 cm.  (= the sheet's DIFF column.)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calib_tolerance(p_chart UUID, p_dip NUMERIC)
RETURNS NUMERIC AS $$
  SELECT ROUND(
    2 * sqrt(GREATEST(0, 2*(c.diameter_cm/2)*p_dip - p_dip*p_dip))
    * c.length_cm / 1000 / 10, 2)
  FROM tank_calibration_charts c WHERE c.id = p_chart;
$$ LANGUAGE sql STABLE;

-- ─────────────────────────────────────────────────────────────
--  Seed the two verified types. Add the remaining ~9 by simply recording
--  each tank's diameter × length (from the nameplate or the chart header
--  e.g. "194-525") — no chart scanning needed.
-- ─────────────────────────────────────────────────────────────
INSERT INTO tank_calibration_charts (name, diameter_cm, length_cm, manufacturer, source, notes)
VALUES
  ('15KL', 194, 525, 'IOCL', 'IOCL Warangal sheet', 'formula verified vs sheet ~0.1%'),
  ('20KL', 210, 625, 'IOCL', 'IOCL Warangal sheet', 'formula verified vs sheet ~0.3%')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
--  RLS — keep the invariant: every table has RLS ON.
--  This is shared reference data, so the rule is "anyone authenticated may
--  READ, nobody writes via the app role" — same pattern as plans /
--  permission_modules / alert_definitions. Writes happen here (the seed above)
--  and via the superadmin console, both on the bypass owner role.
--  Baked into the migration so the table is NEVER created without RLS.
--  (Mirrors backend/src/db/rls/05_policies_hard_global.sql.)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE tank_calibration_charts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tank_calibration_charts_read ON tank_calibration_charts;
CREATE POLICY tank_calibration_charts_read ON tank_calibration_charts FOR SELECT USING (true);

-- Table-level grant for the per-request role (guarded: the role only exists
-- once the RLS phase scripts have run).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    GRANT SELECT ON tank_calibration_charts TO app_authenticated;
  END IF;
END $$;
