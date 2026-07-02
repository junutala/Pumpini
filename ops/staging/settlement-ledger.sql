-- settlement-ledger.sql — gated DDL for the reconciliation ledger.
-- Run on Supabase (staging first). Idempotent; safe to re-run. No data change.

-- Materialized reconciliation ledger (Jul 2026). Reco is computed ONCE at shift
-- close and frozen here; tiles/reports read from these tables instead of
-- re-deriving from raw tables on every request. Rate frozen = price effective at
-- 06:00 IST of the trade day (OMCs push at 6 AM; opening dip is at 6 AM). Writer:
-- backend/src/services/settlementLedger.js. Backfill: src/db/backfill-settlement-ledger.js.
-- Idempotent — safe to re-run. Run on the live DB BEFORE the code that reads them.
-- ──────────────────────────────────────────────────────────────
-- Layer 1 — per operator, per trade day (header).
CREATE TABLE IF NOT EXISTS settlement_ledger (
  id            uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  station_id    uuid NOT NULL,
  trade_date    date NOT NULL,
  shift_id      uuid NOT NULL,
  attendant_id  uuid NOT NULL,
  book_sales    numeric(12,2) NOT NULL DEFAULT 0,   -- Σ (litres × 6 AM rate)
  opening_cash  numeric(12,2) NOT NULL DEFAULT 0,   -- drawer float at open
  cash_actual   numeric(12,2) NOT NULL DEFAULT 0,
  card_total    numeric(12,2) NOT NULL DEFAULT 0,
  upi_total     numeric(12,2) NOT NULL DEFAULT 0,
  credit_total  numeric(12,2) NOT NULL DEFAULT 0,
  petty_cash    numeric(12,2) NOT NULL DEFAULT 0,
  collections   numeric(12,2) NOT NULL DEFAULT 0,   -- (cash−float)+card+upi+credit+petty
  variance      numeric(12,2) NOT NULL DEFAULT 0,   -- collections − book_sales
  mode          varchar(10),
  reconciled_at timestamptz,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_ledger_uq UNIQUE (shift_id, attendant_id)
);
CREATE INDEX IF NOT EXISTS idx_settlement_ledger_station_date ON settlement_ledger(station_id, trade_date);

-- Layer 1 detail — per operator × fuel.
CREATE TABLE IF NOT EXISTS settlement_ledger_fuel (
  id            uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  station_id    uuid NOT NULL,
  trade_date    date NOT NULL,
  shift_id      uuid NOT NULL,
  attendant_id  uuid NOT NULL,
  fuel_type     varchar(20) NOT NULL,
  litres        numeric(12,3) NOT NULL DEFAULT 0,   -- closing − opening (− test)
  rate          numeric(8,2),                       -- price effective at 06:00 IST of trade_date
  book_sales    numeric(12,2) NOT NULL DEFAULT 0,   -- litres × rate
  CONSTRAINT settlement_ledger_fuel_uq UNIQUE (shift_id, attendant_id, fuel_type)
);
CREATE INDEX IF NOT EXISTS idx_settlement_ledger_fuel_station_date ON settlement_ledger_fuel(station_id, trade_date);

-- Layer 2 — per outlet, per trade day (the manager's day; header).
CREATE TABLE IF NOT EXISTS outlet_reco (
  id                     uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  station_id             uuid NOT NULL,
  trade_date             date NOT NULL,
  dip_sold_ltrs          numeric(12,3) NOT NULL DEFAULT 0,  -- Σ (opening dip + deliveries − closing dip)
  meter_sold_ltrs        numeric(12,3) NOT NULL DEFAULT 0,  -- Σ meter delta (dispense_events)
  book_sales             numeric(12,2) NOT NULL DEFAULT 0,  -- Σ dip_sold × 6 AM rate
  total_collections      numeric(12,2) NOT NULL DEFAULT 0,  -- Σ operators' collections
  money_variance         numeric(12,2) NOT NULL DEFAULT 0,  -- collections − book_sales
  wetstock_variance_ltrs numeric(12,3) NOT NULL DEFAULT 0,  -- meter_sold − dip_sold
  computed_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outlet_reco_uq UNIQUE (station_id, trade_date)
);

-- Layer 2 detail — per outlet × fuel, per trade day.
CREATE TABLE IF NOT EXISTS outlet_reco_fuel (
  id               uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  station_id       uuid NOT NULL,
  trade_date       date NOT NULL,
  fuel_type        varchar(20) NOT NULL,
  opening_dip_ltrs numeric(12,3),
  deliveries_ltrs  numeric(12,3) NOT NULL DEFAULT 0,
  closing_dip_ltrs numeric(12,3),
  dip_sold_ltrs    numeric(12,3),                    -- opening + deliveries − closing
  meter_sold_ltrs  numeric(12,3) NOT NULL DEFAULT 0,
  rate             numeric(8,2),
  book_sales       numeric(12,2) NOT NULL DEFAULT 0, -- dip_sold × rate
  CONSTRAINT outlet_reco_fuel_uq UNIQUE (station_id, trade_date, fuel_type)
);
