-- 017_accounts_opening_balance_sheet.sql
-- Slice 7: the balance-sheet anchor. Opening balances (as of a books-start date) and fixed
-- assets. Both per-station, RLS-isolated. Additive + idempotent. Run after 016.
--
-- The opening balances are posted as ONE balanced journal entry (event_type
-- 'opening_balance'), so the balance sheet is just "sum the journal" — opening + every
-- movement since. Capital is the balancing figure (net worth = assets − liabilities), so
-- the opening entry balances by construction.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- One row per outlet: the position at books-start + the two config facts (land ownership
-- drives whether OMC rent is income or a pass-through). Capital is stored computed.
CREATE TABLE IF NOT EXISTS accounting_opening_balances (
  station_id       UUID PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  books_start_date DATE NOT NULL,
  cash             NUMERIC(14,2) DEFAULT 0,
  bank             NUMERIC(14,2) DEFAULT 0,
  stock_fuel       NUMERIC(14,2) DEFAULT 0,
  stock_lube       NUMERIC(14,2) DEFAULT 0,
  receivables      NUMERIC(14,2) DEFAULT 0,
  creditors        NUMERIC(14,2) DEFAULT 0,
  cng_payable      NUMERIC(14,2) DEFAULT 0,
  loans            NUMERIC(14,2) DEFAULT 0,
  fixed_assets     NUMERIC(14,2) DEFAULT 0,   -- net book value at start (owned-by-outlet only)
  capital          NUMERIC(14,2) DEFAULT 0,   -- computed plug = Σ assets − Σ liabilities
  land_ownership   VARCHAR(10) DEFAULT 'owned' CHECK (land_ownership IN ('owned','leased')),
  updated_by       UUID REFERENCES users(id),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE accounting_opening_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_opening_balances_station_isolation ON accounting_opening_balances;
CREATE POLICY accounting_opening_balances_station_isolation ON accounting_opening_balances
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_opening_balances TO app_authenticated;

-- Fixed assets. owned_by decides what's on the balance sheet: the pumps/tanks may be the
-- OMC's, not the outlet's — only 'outlet' assets are the outlet's, and only they appear.
CREATE TABLE IF NOT EXISTS fixed_assets (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id         UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name               VARCHAR(120) NOT NULL,
  owned_by           VARCHAR(10) DEFAULT 'outlet' CHECK (owned_by IN ('outlet','omc')),
  cost               NUMERIC(14,2) DEFAULT 0,
  accum_depreciation NUMERIC(14,2) DEFAULT 0,
  depreciation_rate  NUMERIC(5,2) DEFAULT 0,     -- % per year, straight-line (optional)
  purchase_date      DATE,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_station ON fixed_assets(station_id);

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixed_assets_station_isolation ON fixed_assets;
CREATE POLICY fixed_assets_station_isolation ON fixed_assets
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
GRANT SELECT, INSERT, UPDATE, DELETE ON fixed_assets TO app_authenticated;
