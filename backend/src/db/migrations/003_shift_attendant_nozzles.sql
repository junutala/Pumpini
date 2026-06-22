-- ─────────────────────────────────────────────────────────────
--  ONE OPERATOR → MULTIPLE NOZZLES  (manpower-shortage reality)
--
--  shift_attendants stays one row per operator (cash float, identity, the whole
--  reconciliation/dashboard surface is untouched). The operator's nozzles — and
--  each nozzle's opening/closing meter — live here, one row per (operator,nozzle).
--  A nozzle is manned by exactly one operator in a shift: UNIQUE(shift_id,nozzle_id).
--
--  Additive: nothing reads this yet, so creating it changes no behaviour. The
--  assign + settlement code is migrated onto it in later steps.
--
--  Idempotent. Versioned: v1 2026-06-22.
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS shift_attendant_nozzles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id        UUID REFERENCES shifts(id) ON DELETE CASCADE,
  attendant_id    UUID REFERENCES users(id),
  nozzle_id       UUID REFERENCES nozzles(id),
  opening_reading NUMERIC(12,3) DEFAULT 0,
  closing_reading NUMERIC(12,3),
  assigned_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shift_id, nozzle_id)              -- a nozzle = one operator per shift
);

CREATE INDEX IF NOT EXISTS idx_san_shift_attendant
  ON shift_attendant_nozzles(shift_id, attendant_id);

-- ─────────────────────────────────────────────────────────────
--  RLS — indirect, scoped through the parent shift's station (same pattern as
--  shift_attendants in rls/04_policies_indirect.sql). Explicit/top-level so it
--  is unmistakable and Supabase's UI detects it (no "unprotected table" prompt).
--  Assumes the RLS layer (my_stations(), app_authenticated) is present.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE shift_attendant_nozzles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_attendant_nozzles_isolation ON shift_attendant_nozzles;
CREATE POLICY shift_attendant_nozzles_isolation ON shift_attendant_nozzles
  USING      (EXISTS (SELECT 1 FROM shifts s WHERE s.id = shift_attendant_nozzles.shift_id AND s.station_id IN (SELECT my_stations())))
  WITH CHECK (EXISTS (SELECT 1 FROM shifts s WHERE s.id = shift_attendant_nozzles.shift_id AND s.station_id IN (SELECT my_stations())));

GRANT SELECT, INSERT, UPDATE, DELETE ON shift_attendant_nozzles TO app_authenticated;
