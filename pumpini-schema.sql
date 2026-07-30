-- ⚠️ PARTIAL / LEGACY FILE — this hand-maintained schema has drifted from prod.
--    It defines only ~23 of the 60 tables that actually exist in production.
--    For the COMPLETE, authoritative current schema (all tables, RLS, functions,
--    triggers, grants) see  →  pumpini-schema.snapshot.sql  (pg_dump from prod).
--    When checking "does this column/table exist in prod?", trust the snapshot.
--    New idempotent DDL may still be appended here, but verify against the snapshot.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
--  USERS & ROLES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(120) NOT NULL,
  phone         VARCHAR(15) UNIQUE NOT NULL,
  email         VARCHAR(120) UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('owner','manager','attendant','rsa','corporate')),
  language      VARCHAR(10) DEFAULT 'en',
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  PETROL STATION / OUTLET
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(120) NOT NULL,
  address       TEXT,
  gst_number    VARCHAR(20),
  oil_company   VARCHAR(50),  -- HPCL, BPCL, IOC etc.
  city          VARCHAR(80),
  state         VARCHAR(80),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS station_users (
  station_id    UUID REFERENCES stations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(station_id, user_id)
);

-- ─────────────────────────────────────────────
--  FUEL TANKS & NOZZLES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tanks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id    UUID REFERENCES stations(id) ON DELETE CASCADE,
  tank_number   SMALLINT NOT NULL,
  fuel_type     VARCHAR(20) NOT NULL CHECK (fuel_type IN ('petrol','diesel','cng','premium_petrol')),
  capacity_ltrs NUMERIC(10,2),
  current_stock NUMERIC(10,2) DEFAULT 0,
  density       NUMERIC(8,4),  -- kg/L at 15°C
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nozzles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id    UUID REFERENCES stations(id) ON DELETE CASCADE,
  tank_id       UUID REFERENCES tanks(id),
  nozzle_number SMALLINT NOT NULL,
  fuel_type     VARCHAR(20) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  RFID TAGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rfid_tags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag_uid       VARCHAR(64) UNIQUE NOT NULL,
  station_id    UUID REFERENCES stations(id),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  SHIFTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id      UUID REFERENCES stations(id),
  shift_number    SMALLINT NOT NULL CHECK (shift_number IN (1,2,3)),
  date            DATE NOT NULL,
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  status          VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','closed','reconciled')),
  manager_id      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Attendant assigned to shift + RFID
CREATE TABLE IF NOT EXISTS shift_attendants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id        UUID REFERENCES shifts(id) ON DELETE CASCADE,
  attendant_id    UUID REFERENCES users(id),
  rfid_tag_id     UUID REFERENCES rfid_tags(id),
  nozzle_id       UUID REFERENCES nozzles(id),
  bank_account    VARCHAR(30),
  upi_vpa         VARCHAR(100),  -- linked UPI VPA for this attendant
  opening_reading NUMERIC(12,3) DEFAULT 0,
  closing_reading NUMERIC(12,3),
  assigned_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  DISPENSE EVENTS (RFID/Nozzle)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispense_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id      UUID REFERENCES stations(id),
  shift_id        UUID REFERENCES shifts(id),
  event_seq       BIGSERIAL,           -- sequential event number
  rfid_tag_id     UUID REFERENCES rfid_tags(id),
  nozzle_id       UUID REFERENCES nozzles(id),
  attendant_id    UUID REFERENCES users(id),
  fuel_type       VARCHAR(20),
  quantity_ltrs   NUMERIC(10,3) NOT NULL,
  rate_per_ltr    NUMERIC(8,2) NOT NULL,
  amount          NUMERIC(12,2) GENERATED ALWAYS AS (quantity_ltrs * rate_per_ltr) STORED,
  payment_mode    VARCHAR(20) CHECK (payment_mode IN ('cash','upi','credit','card')),
  upi_ref         VARCHAR(80),
  vehicle_number  VARCHAR(20),
  photo_url       TEXT,              -- geo-tagged photo
  latitude        NUMERIC(10,7),
  longitude       NUMERIC(10,7),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispense_shift ON dispense_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_dispense_rfid  ON dispense_events(rfid_tag_id);
CREATE INDEX IF NOT EXISTS idx_dispense_date  ON dispense_events(occurred_at);

-- ─────────────────────────────────────────────
--  CASH RECONCILIATION
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_reconciliation (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id            UUID UNIQUE REFERENCES shifts(id),
  attendant_id        UUID REFERENCES users(id),
  total_sales         NUMERIC(12,2),
  cash_expected       NUMERIC(12,2),
  cash_actual         NUMERIC(12,2),   -- blind drop amount
  upi_total           NUMERIC(12,2),
  credit_total        NUMERIC(12,2),
  card_total          NUMERIC(12,2),
  variance            NUMERIC(12,2) GENERATED ALWAYS AS (cash_actual - cash_expected) STORED,
  alert_sent          BOOLEAN DEFAULT FALSE,
  remarks             TEXT,
  reconciled_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  CORPORATE ACCOUNTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_accounts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name        VARCHAR(120) NOT NULL,
  gst_number          VARCHAR(20),
  contact_person      VARCHAR(80),
  contact_phone       VARCHAR(15),
  contact_email       VARCHAR(120),
  credit_limit        NUMERIC(12,2) DEFAULT 0,
  current_outstanding NUMERIC(12,2) DEFAULT 0,
  billing_cycle       VARCHAR(10) DEFAULT 'monthly',
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Enrolled drivers (biometric reference)
CREATE TABLE IF NOT EXISTS corporate_drivers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  corporate_id        UUID REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  name                VARCHAR(120) NOT NULL,
  phone               VARCHAR(15),
  vehicle_number      VARCHAR(20),
  fasttag_id          VARCHAR(50),
  biometric_ref       TEXT,           -- reference ID from biometric device
  per_fill_limit      NUMERIC(10,2),
  is_active           BOOLEAN DEFAULT TRUE,
  enrolled_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Corporate dispense transactions
CREATE TABLE IF NOT EXISTS corporate_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispense_event_id   UUID REFERENCES dispense_events(id),
  corporate_id        UUID REFERENCES corporate_accounts(id),
  driver_id           UUID REFERENCES corporate_drivers(id),
  amount              NUMERIC(12,2),
  credit_before       NUMERIC(12,2),
  credit_after        NUMERIC(12,2),
  plate_photo_url     TEXT,
  fasttag_read        VARCHAR(50),
  verified_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  EMPLOYEE ATTENDANCE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id),
  station_id      UUID REFERENCES stations(id),
  date            DATE NOT NULL,
  check_in        TIMESTAMPTZ,
  check_out       TIMESTAMPTZ,
  shift_number    SMALLINT,
  status          VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present','absent','half_day','leave')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, shift_number)
);

-- ─────────────────────────────────────────────
--  DIPSTICK READINGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dipstick_readings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id      UUID REFERENCES stations(id),
  tank_id         UUID REFERENCES tanks(id),
  shift_id        UUID REFERENCES shifts(id),
  reading_type    VARCHAR(20) CHECK (reading_type IN ('opening','mid_shift','closing')),
  dip_cm          NUMERIC(8,2),        -- physical dip in cm
  volume_ltrs     NUMERIC(10,2),       -- converted volume
  density         NUMERIC(8,4),        -- observed density
  temperature_c   NUMERIC(5,2),
  recorded_by     UUID REFERENCES users(id),
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  STOCK / DELIVERY
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id      UUID REFERENCES stations(id),
  tank_id         UUID REFERENCES tanks(id),
  quantity_ltrs   NUMERIC(10,2) NOT NULL,
  density         NUMERIC(8,4),
  challan_number  VARCHAR(50),
  delivered_by    VARCHAR(80),
  received_by     UUID REFERENCES users(id),
  delivered_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  FUEL PRICE HISTORY
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_prices (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id  UUID REFERENCES stations(id),
  fuel_type   VARCHAR(20) NOT NULL,
  price       NUMERIC(8,2) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  set_by      UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  ALERTS LOG
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id      UUID REFERENCES stations(id),
  alert_type      VARCHAR(50) NOT NULL,  -- 'variance','low_stock','credit_limit' etc.
  severity        VARCHAR(10) DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  message         TEXT NOT NULL,
  recipient_ids   UUID[],
  channels        VARCHAR(20)[],         -- ['whatsapp','sms','email']
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
--  AUDIT LOG (immutable)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(80) NOT NULL,
  entity      VARCHAR(80),
  entity_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  FUNCTION: auto-update updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
-- ═════════════════════════════════════════════
--  WAVE 2 ADDITIONS (Jun 2026)
-- ═════════════════════════════════════════════

-- Petty cash / imprest ledger — manager's cash float. Credit-note CASH refunds
-- auto-debit this; manual top-ups/expenses are entered by owner/manager.
-- Balance = SUM(in) − SUM(out) per station.
CREATE TABLE IF NOT EXISTS petty_cash_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  direction      VARCHAR(3)  NOT NULL CHECK (direction IN ('in','out')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  entry_type     VARCHAR(20) NOT NULL DEFAULT 'expense', -- topup | expense | refund | adjustment
  description    TEXT,
  reference_type VARCHAR(40),   -- e.g. 'product_credit_note'
  reference_id   UUID,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_station ON petty_cash_entries(station_id, created_at DESC);

-- Bay-vs-shop lube stock split. current_stock stays the authoritative total;
-- bay_stock + shop_stock track location. Existing stock defaults to 'shop'.
ALTER TABLE products              ADD COLUMN IF NOT EXISTS bay_stock  NUMERIC(12,3) DEFAULT 0;
ALTER TABLE products              ADD COLUMN IF NOT EXISTS shop_stock NUMERIC(12,3) DEFAULT 0;
UPDATE products SET shop_stock = COALESCE(current_stock,0)
  WHERE COALESCE(bay_stock,0)=0 AND COALESCE(shop_stock,0)=0;
ALTER TABLE product_stock_receipts ADD COLUMN IF NOT EXISTS location VARCHAR(8) DEFAULT 'shop';
ALTER TABLE product_invoices       ADD COLUMN IF NOT EXISTS location VARCHAR(8) DEFAULT 'shop';

-- PAN on corporate accounts (used to consolidate a customer's profiles across
-- owners in the read-only customer portal). Code already writes pan; ensure it
-- exists and is indexed for the consolidation lookup.
ALTER TABLE corporate_accounts ADD COLUMN IF NOT EXISTS pan VARCHAR(10);

-- Attendant end-dating: the last working day. NULL = currently employed.
-- Set together with is_active=FALSE when an attendant leaves (reversible —
-- clearing it + is_active=TRUE brings them back into the shift picker).
ALTER TABLE users ADD COLUMN IF NOT EXISTS end_date DATE;

-- Superadmin go-live seeding writes opening-balance invoices with no creator
-- (a superadmin is not a users row), so created_by must accept NULL. No-op if
-- the column is already nullable.
ALTER TABLE gst_invoices ALTER COLUMN created_by DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_corporate_pan ON corporate_accounts(UPPER(TRIM(pan)));

-- ═════════════════════════════════════════════
--  WAVE 3 PHASE A — Manager-driven blind drop
-- ═════════════════════════════════════════════
-- Per-station switch. OFF = existing POS blind drop. ON = operator does nothing
-- in-system; manager derives sales from the meter delta at shift close.
ALTER TABLE station_settings     ADD COLUMN IF NOT EXISTS manager_blind_drop BOOLEAN DEFAULT FALSE;
ALTER TABLE shift_attendants     ADD COLUMN IF NOT EXISTS closing_reading NUMERIC(12,3);
-- Aggregate sales synthesized at close are tagged source='manager' so they can be
-- recomputed idempotently and told apart from real per-txn POS events.
ALTER TABLE dispense_events      ADD COLUMN IF NOT EXISTS source VARCHAR(12) DEFAULT 'pos';
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'pos';   -- 'pos' | 'manager'
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS resolution VARCHAR(20);            -- recovered | salary_deduction | overage_income
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS resolution_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS operator_ack BOOLEAN DEFAULT FALSE;
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS test_ltrs NUMERIC(12,3) DEFAULT 0;
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS price_per_ltr NUMERIC(10,2) DEFAULT 0;

-- ═════════════════════════════════════════════
--  WAVE 3 PHASE B — Wet-stock (tank dip) reconciliation
-- ═════════════════════════════════════════════
-- Per tank, per shift: book_closing = opening dip + deliveries − sales(L);
-- variance = actual closing dip − book_closing (neg=loss evap/pilferage, pos=gain).
CREATE TABLE IF NOT EXISTS tank_reconciliation (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id       UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id         UUID REFERENCES shifts(id) ON DELETE CASCADE,
  tank_id          UUID NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  opening_ltrs     NUMERIC(12,2) NOT NULL DEFAULT 0,
  deliveries_ltrs  NUMERIC(12,2) NOT NULL DEFAULT 0,
  sales_ltrs       NUMERIC(12,2) NOT NULL DEFAULT 0,
  book_closing     NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_closing   NUMERIC(12,2) NOT NULL DEFAULT 0,
  variance_ltrs    NUMERIC(12,2) NOT NULL DEFAULT 0,   -- actual − book; <0 = loss
  variance_pct     NUMERIC(8,3)  NOT NULL DEFAULT 0,
  tolerance_ltrs   NUMERIC(12,2) NOT NULL DEFAULT 0,
  beyond_tolerance BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by      UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shift_id, tank_id)
);
CREATE INDEX IF NOT EXISTS idx_tank_reco_station ON tank_reconciliation(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tank_reco_tank    ON tank_reconciliation(tank_id, created_at DESC);

-- Owner-configurable variance tolerance (petrol evaporates more than diesel) +
-- an absolute-litre floor so low-throughput shifts don't false-alarm.
ALTER TABLE station_settings ADD COLUMN IF NOT EXISTS stock_tol_pct_petrol NUMERIC(5,3) DEFAULT 0.75;
ALTER TABLE station_settings ADD COLUMN IF NOT EXISTS stock_tol_pct_diesel NUMERIC(5,3) DEFAULT 0.50;
ALTER TABLE station_settings ADD COLUMN IF NOT EXISTS stock_tol_floor_ltrs NUMERIC(8,2) DEFAULT 20;

-- ═════════════════════════════════════════════
--  WAVE 3 PHASE C — Cash custody → bank deposit → aging alert
-- ═════════════════════════════════════════════
-- Sales cash collected (Σ cash_actual − opening float, from confirmed recons)
-- accumulates as "awaiting deposit". A bank deposit draws it down; the owner
-- confirms it landed in the bank. Stale undeposited cash → owner alert.
CREATE TABLE IF NOT EXISTS cash_deposits (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id    UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  deposit_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  bank_account  VARCHAR(80),
  reference_no  VARCHAR(80),                 -- pay-in slip / UTR
  notes         TEXT,
  deposited_by  UUID REFERENCES users(id),
  confirmed     BOOLEAN DEFAULT FALSE,        -- owner verified it is in the bank
  confirmed_by  UUID REFERENCES users(id),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_station ON cash_deposits(station_id, deposit_date DESC);

ALTER TABLE station_settings ADD COLUMN IF NOT EXISTS deposit_alert_days   INT           DEFAULT 2;
ALTER TABLE station_settings ADD COLUMN IF NOT EXISTS deposit_alert_amount NUMERIC(12,2) DEFAULT 0;  -- 0 = amount check off

-- ═════════════════════════════════════════════
--  WAVE 3 PHASE E — Tally Prime XML export
-- ═════════════════════════════════════════════
-- Maps each Pumpini financial touchpoint to the owner's Tally ledger NAME (Tally
-- keys on ledger names, not codes). Per station / per GSTIN (≈ one Tally company
-- per bunk). Daily vouchers are generated from these mappings.
CREATE TABLE IF NOT EXISTS tally_ledger_map (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  touchpoint_key VARCHAR(40) NOT NULL,
  ledger_name    VARCHAR(120),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(station_id, touchpoint_key)
);
ALTER TABLE station_settings ADD COLUMN IF NOT EXISTS tally_company_name VARCHAR(150);

-- Admin refinements (Jun 2026): lead state (for State LOV in leads screen)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state VARCHAR(60);

-- ═════════════════════════════════════════════
--  ACCESS MODEL — Plan(outlet) ∩ Responsibility(user)
-- ═════════════════════════════════════════════
-- New feature modules so plans/responsibilities can include the newer functions.
INSERT INTO permission_modules(code, category, label) VALUES
  ('lubes.manage',     'Lubes',     'Lubes & Products'),
  ('pettycash.manage', 'Cash',      'Petty Cash'),
  ('deposits.manage',  'Cash',      'Bank Deposits'),
  ('cash.integrity',   'Cash',      'Cash Integrity'),
  ('stock.reconcile',  'Stock',     'Wet-stock Reconciliation'),
  ('tally.export',     'Accounts',  'Tally Export'),
  ('ai_chat.use',      'AI',        'AI Assistant'),
  ('group.view',       'Dashboard', 'Group Dashboard'),
  ('settings.manage',  'Admin',     'Station Settings'),
  ('attendant.add',    'Admin',     'Add Attendant')
ON CONFLICT (code) DO NOTHING;

-- Preserve access for users on custom responsibility templates: the split-out
-- feature modules inherit from the umbrella perm the template already had.
INSERT INTO template_permissions(template_id, module_code)
  SELECT tp.template_id, x.m FROM template_permissions tp
  CROSS JOIN (VALUES ('pettycash.manage'),('deposits.manage'),('stock.reconcile')) x(m)
  WHERE tp.module_code='reconcile.manage' ON CONFLICT DO NOTHING;
INSERT INTO template_permissions(template_id, module_code)
  SELECT template_id, 'lubes.manage' FROM template_permissions WHERE module_code='shifts.manage' ON CONFLICT DO NOTHING;
INSERT INTO template_permissions(template_id, module_code)
  SELECT template_id, 'tally.export' FROM template_permissions WHERE module_code='invoice.generate' ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- P0 go-live hardening (Jun 2026): hot-path indexes.
-- Dashboards poll every ~10s per logged-in user; these queries filter on
-- exactly these column combinations. Run on the live DB before go-live.
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shifts_station_status      ON shifts(station_id, status);
CREATE INDEX IF NOT EXISTS idx_dispense_station_date      ON dispense_events(station_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_dispense_shift_attendant   ON dispense_events(shift_id, attendant_id);
CREATE INDEX IF NOT EXISTS idx_dispense_corp_outstanding  ON dispense_events(corporate_id, station_id) WHERE payment_mode='credit';
CREATE INDEX IF NOT EXISTS idx_shift_recon_shift          ON shift_reconciliation(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_attendants_shift     ON shift_attendants(shift_id, attendant_id);
CREATE INDEX IF NOT EXISTS idx_product_invoices_shift     ON product_invoices(shift_id, attendant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_station_sent        ON alerts(station_id, sent_at DESC);

-- ──────────────────────────────────────────────────────────────
-- Owner-only sale void (Jun 2026). Soft void: row kept for the audit trail,
-- excluded from every aggregate. Run on the live DB BEFORE deploying the code.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE dispense_events ADD COLUMN IF NOT EXISTS is_voided   BOOLEAN DEFAULT FALSE;
ALTER TABLE dispense_events ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id);
ALTER TABLE dispense_events ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE dispense_events ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ──────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────
-- Split discharge (Jul 2026). One product can be discharged into >1 tank, so the
-- same DC+fuel now legitimately has several rows differing only by tank/volume.
-- Add tank_id to the dedup unique index so an even split (e.g. 5KL+5KL) doesn't
-- collide, while still blocking a true double-submit (same DC+fuel+volume+tank).
-- Idempotent. Run on the live DB before/with the split-discharge code.
-- ──────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS ux_fuel_deliveries_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fuel_deliveries_dedup
  ON public.fuel_deliveries (station_id, dc_number, fuel_type, gross_volume_ltrs, tank_id)
  WHERE (dc_number IS NOT NULL);

-- ──────────────────────────────────────────────────────────────
-- CCO — Central Cash Office (Jul 2026). A back-office responsibility with
-- operational access to EVERY outlet in an owner group (reconciliation, credit,
-- cash, deposits, reports) but NO forecourt work (shifts / POS / dipstick).
-- Superadmin creates CCO users and attaches them to an owner group. Access flows
-- through owner_group_members membership (same path as owners), while capability
-- comes from users.role = 'cco'.
--
-- Both role CHECK constraints must admit the new value BEFORE a CCO can be
-- created, else the INSERT fails (23514). Idempotent (drop-if-exists + re-add).
-- ⚠️ RUN THESE TWO STEPS on the target DB before creating any CCO user.
-- ──────────────────────────────────────────────────────────────

-- Step 1 — allow role='cco' on users.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK ((role)::text = ANY (ARRAY['owner','manager','attendant','rsa','corporate','cco']::text[]));

-- Step 2 — allow role='cco' on owner_group_members (membership marker).
ALTER TABLE public.owner_group_members DROP CONSTRAINT IF EXISTS owner_group_members_role_check;
ALTER TABLE public.owner_group_members ADD CONSTRAINT owner_group_members_role_check
  CHECK ((role)::text = ANY (ARRAY['admin','member','cco']::text[]));

-- ──────────────────────────────────────────────────────────────
-- DOCUMENT BYTES → OBJECT STORAGE (2026-07-23)
-- Move raw image/PDF bytes OUT of Postgres into Supabase Storage (private
-- `pumpini-docs` bucket), keeping only a storage PATH in the DB. Additive +
-- column-tolerant with the shipped code. base64 columns are RETAINED (fallback
-- + un-migrated rows); dropping them is a SEPARATE later owner-gated step after
-- the superadmin backfill confirms every row has a storage_path. Idempotent.
-- Canonical copy of backend/src/db/migrations/009_document_object_storage.sql.
-- ⚠️ RUN THESE STEPS on the target DB (staging first) before the code relies on them.
-- ──────────────────────────────────────────────────────────────

-- Step 1 — delivery invoices: add the path column.
ALTER TABLE public.delivery_invoices ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Step 2 — delivery invoices: allow URL-only rows (file_base64 no longer required).
ALTER TABLE public.delivery_invoices ALTER COLUMN file_base64 DROP NOT NULL;

-- Step 3 — meter photos: add the path column (image_base64 already nullable).
ALTER TABLE public.meter_photos ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- ──────────────────────────────────────────────────────────────
-- NET DELIVERY VOLUME = THE CHALLAN VOLUME (2026-07-29)
-- fuel_deliveries.net_volume_ltrs was GENERATED AS
--   round(gross_volume_ltrs * density * (1 - 0.0009*(temperature_c - 15)), 2)
-- whenever BOTH temperature_c and density were present, else gross.
--
-- That is wrong twice over:
--   1. litres x density (kg/L) = KILOGRAMS, not litres; and
--   2. the result is fed into tanks.current_stock by the increase_tank_stock()
--      trigger, so a 20,000 L load was booked as 14,730 L and the missing
--      5,270 L appeared as a stock LOSS. (Two such rows existed in prod --
--      both 28-May test rows, 6,135.74 L of phantom loss between them.)
--
-- The rule going forward: the invoice volume IS the volume. Density is a
-- QUALITY control (the density register proves the fuel is genuine); it never
-- restates the quantity. Thermal contraction is surfaced as a variance
-- EXPLANATION on the delivery form, never as a stock adjustment -- the dip is
-- what measures the litres actually in the ground.
--
-- The column is KEPT (not dropped) because tank_book_stock and four backend
-- modules read it; making it mirror gross is the minimal, reversible fix and
-- needs no code deploy to be correct. Requires PG >= 17 (SET EXPRESSION AS);
-- prod and staging are both 17.6. Rewrites the table -- trivial at this size.
-- Idempotent: re-running sets the same expression.
--
-- Rollback: ALTER TABLE public.fuel_deliveries ALTER COLUMN net_volume_ltrs
--   SET EXPRESSION AS (CASE WHEN temperature_c IS NOT NULL AND density IS NOT NULL
--     THEN round(gross_volume_ltrs * density * (1 - 0.00090*(temperature_c - 15)), 2)
--     ELSE gross_volume_ltrs END);
-- ──────────────────────────────────────────────────────────────

-- Step 1 — book the challan volume, nothing derived.
ALTER TABLE public.fuel_deliveries
  ALTER COLUMN net_volume_ltrs SET EXPRESSION AS (gross_volume_ltrs);

-- ──────────────────────────────────────────────────────────────
-- CREDIT SLIP BOOKS (2026-07-30)
-- The control record for requisition-coupon books issued to credit customers —
-- modelled on a CHEQUE BOOK: issue, range, leaf, presented, stopped, exhausted.
-- Design + reasoning: docs/credit-slip-invoicing.md.
--
-- Why: a credit customer's driver presents a numbered coupon to draw fuel. Today
-- nothing records which numbers were issued to whom, so a missing coupon is
-- indistinguishable from an unused one — i.e. fuel may leave the forecourt and
-- never be billed, with no way to detect it. This table makes that answerable.
--
-- Books are per OUTLET: the units print their own books, so the number sequence
-- is unique per outlet and Pumpini has no control over the printing. That is why
-- the no-overlap rule below is scoped to station_id ALONE and not to the customer:
-- within one outlet a coupon number identifies exactly one book, and therefore
-- exactly one customer. The name written on the coupon is a CHECK, not the key.
--
-- ⚠️ RUN THESE STEPS IN ORDER on the target DB (staging first). Idempotent.
-- ──────────────────────────────────────────────────────────────

-- Step 1 — btree_gist gives gist indexes equality operators for uuid, which the
-- exclusion constraint in Step 3 needs alongside the range overlap operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 2 — the register itself.
CREATE TABLE IF NOT EXISTS public.credit_slip_books (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  station_id    uuid NOT NULL REFERENCES public.stations(id),
  corporate_id  uuid NOT NULL REFERENCES public.corporate_accounts(id),
  book_label    character varying(40),      -- optional printed book id, free text
  series_start  bigint NOT NULL,
  series_end    bigint NOT NULL,
  -- Opening position. A book handed over part-used starts above series_start;
  -- leaves below this are not expected to be presented here.
  opening_leaf  bigint,
  issued_on     date NOT NULL DEFAULT CURRENT_DATE,
  status        character varying(12) NOT NULL DEFAULT 'active',
  notes         text,
  issued_by     uuid REFERENCES public.users(id),
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now(),
  CONSTRAINT credit_slip_books_range_chk  CHECK (series_end >= series_start),
  CONSTRAINT credit_slip_books_open_chk   CHECK (opening_leaf IS NULL
                                            OR (opening_leaf >= series_start AND opening_leaf <= series_end)),
  CONSTRAINT credit_slip_books_status_chk CHECK (status IN ('active','exhausted','cancelled','lost'))
);

-- Step 3 — no two books at one OUTLET may overlap, whatever their status or
-- customer. Deliberately unfiltered: once a range is printed it is consumed
-- forever. Reissuing a cancelled or lost book's numbers would make a recovered
-- coupon ambiguous, which is exactly the leak this table exists to close.
-- DB-enforced rather than app-checked so two concurrent issues cannot race.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_slip_books_no_overlap'
  ) THEN
    ALTER TABLE public.credit_slip_books
      ADD CONSTRAINT credit_slip_books_no_overlap
      EXCLUDE USING gist (
        station_id WITH =,
        int8range(series_start, series_end, '[]') WITH &&
      );
  END IF;
END $$;

-- Step 4 — supporting indexes for the register list and the customer rollup.
CREATE INDEX IF NOT EXISTS idx_credit_slip_books_station   ON public.credit_slip_books(station_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_slip_books_corporate ON public.credit_slip_books(corporate_id);

-- Step 5 — historic-rate lookup for backfilled coupons. Costs nothing today (the
-- table is tiny) but the pricing path is per (station, fuel, date) and the table
-- only grows. Prices ARE already striped by station, and they genuinely differ
-- between outlets (~₹1/L observed), so the station column is load-bearing.
CREATE INDEX IF NOT EXISTS idx_fuel_prices_lookup
  ON public.fuel_prices(station_id, fuel_type, effective_from DESC);

-- ──────────────────────────────────────────────────────────────
-- COUPON CAPTURE ON THE CREDIT SALE (2026-07-30)
-- Piece 2 of credit invoicing. docs/credit-slip-invoicing.md §3.
--
-- The coupon is NOT a second sale record — it is the paper authorisation for a
-- credit sale we ALREADY record in dispense_events. So we add the coupon to that
-- row rather than starting a parallel ledger, which keeps ONE credit ledger, ONE
-- invoiced marker (the existing is_invoiced/invoice_id) and ONE credit-suspense
-- drawdown. A second ledger would be exactly the drift CLAUDE.md forbids.
--
-- Run these together (staging). Additive and idempotent throughout.
-- ──────────────────────────────────────────────────────────────

-- Step 1 — the coupon on the sale.
ALTER TABLE public.dispense_events ADD COLUMN IF NOT EXISTS coupon_book_id uuid REFERENCES public.credit_slip_books(id);
ALTER TABLE public.dispense_events ADD COLUMN IF NOT EXISTS coupon_no      bigint;
-- The meter reading OCR'd from a nozzle photo. The nozzle-image capture is PAUSED
-- (attendant acceptance), so this stays null for now — the column exists so enabling
-- it later needs no migration. Deliberately NO comparison logic against
-- quantity_ltrs: the coupon is handwritten and the MANAGER is the check (owner call).
ALTER TABLE public.dispense_events ADD COLUMN IF NOT EXISTS meter_quantity_ltrs numeric(10,3);

-- Step 2 — a coupon leaf can be billed at most ONCE. This index IS the
-- no-double-invoicing guarantee, enforced by Postgres rather than by a flag someone
-- must remember to set, and it simultaneously kills the double-entry risk inherent
-- in a two-part (ORIGINAL + DUPLICATE) coupon. Partial, so the millions of non-coupon
-- POS sales carry no index cost and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispense_coupon
  ON public.dispense_events(coupon_book_id, coupon_no)
  WHERE coupon_book_id IS NOT NULL;

-- Step 3 — find a customer's coupons for an invoice period.
CREATE INDEX IF NOT EXISTS idx_dispense_coupon_lookup
  ON public.dispense_events(station_id, corporate_id, occurred_at)
  WHERE coupon_book_id IS NOT NULL;

-- Step 4 — document images against a sale, typed by kind so adding the nozzle-meter
-- photo later needs NO migration: just a new `kind`. dispense_events.photo_url is
-- already used by an existing upload endpoint, so it must not be overloaded.
CREATE TABLE IF NOT EXISTS public.dispense_artifacts (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  dispense_event_id  uuid NOT NULL REFERENCES public.dispense_events(id) ON DELETE CASCADE,
  station_id         uuid NOT NULL REFERENCES public.stations(id),
  kind               character varying(20) NOT NULL,
  storage_path       text,
  file_base64        text,
  media_type         character varying(40),
  ocr                jsonb,
  captured_at        timestamp with time zone DEFAULT now(),
  uploaded_by        uuid REFERENCES public.users(id),
  CONSTRAINT dispense_artifacts_kind_chk CHECK (kind IN ('coupon','nozzle_meter'))
);
CREATE INDEX IF NOT EXISTS idx_dispense_artifacts_event ON public.dispense_artifacts(dispense_event_id);
