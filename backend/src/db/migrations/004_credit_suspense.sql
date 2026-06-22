-- ─────────────────────────────────────────────────────────────
--  CREDIT-CUSTOMER SUSPENSE  (control account)
--
--  At shift close the manager records, per operator, a lump "credit customer"
--  amount (fuel sold on credit, customer attributed LATER). It accrues here as a
--  running, station-wide balance across all operators and days:
--      balance = SUM(amount WHERE direction='in')  -- holds booked at close
--              − SUM(amount WHERE direction='out')  -- discharged by credit invoices
--  A credit invoice (the lightweight "raise invoice" action) writes a matching
--  'out' row and draws the balance down. When balance = 0, all credit is invoiced.
--
--  (Petty cash uses the existing petty_cash_entries fund — a 'topup' per close,
--  expenses draw it down — so no new table is needed there.)
--
--  Idempotent. Versioned: v1 2026-06-22.
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS credit_suspense_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  direction      VARCHAR(3) NOT NULL CHECK (direction IN ('in','out')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  shift_id       UUID REFERENCES shifts(id),
  attendant_id   UUID REFERENCES users(id),
  corporate_id   UUID,                      -- set on 'out' when invoiced to a customer
  description    TEXT,
  reference_type VARCHAR(40),               -- 'shift_close' | 'credit_invoice'
  reference_id   UUID,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_suspense_station
  ON credit_suspense_entries(station_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
--  RLS — station-scoped (direct station_id), same rule as petty_cash_entries.
--  Explicit/top-level so Supabase detects it (no "unprotected table" prompt).
--  Assumes the RLS layer (my_stations(), app_authenticated) is present.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE credit_suspense_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_suspense_entries_station_isolation ON credit_suspense_entries;
CREATE POLICY credit_suspense_entries_station_isolation ON credit_suspense_entries
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));

GRANT SELECT, INSERT, UPDATE, DELETE ON credit_suspense_entries TO app_authenticated;
