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

-- ──────────────────────────────────────────────────────────────
-- RLS POLICIES for the coupon tables (2026-07-30) — REQUIRED, not optional
--
-- New tables get RLS ENABLED automatically on this Supabase project, and a table
-- with RLS on and NO policy denies everything. The failure is asymmetric and that
-- is what makes it easy to miss: SELECT silently returns ZERO ROWS (so a register
-- screen looks merely empty) while INSERT raises "new row violates row-level
-- security policy". The list looked fine and only issuing a book failed.
--
-- Every station-scoped table here carries exactly ONE policy in the same shape, so
-- these match it verbatim rather than inventing anything:
--   FOR ALL  USING (station_id IN (SELECT my_stations()))
--       WITH CHECK (station_id IN (SELECT my_stations()))
-- Superadmin routes run on the BYPASSRLS role, so they are unaffected.
--
-- ⇒ RULE FOR ANY NEW TABLE: ship its RLS policy in the SAME DDL block as the
--    CREATE TABLE. A table without one is not "open", it is silently broken.
-- ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='credit_slip_books'
                   AND policyname='credit_slip_books_station_isolation') THEN
    CREATE POLICY credit_slip_books_station_isolation ON public.credit_slip_books
      FOR ALL USING (station_id IN (SELECT my_stations()))
      WITH CHECK (station_id IN (SELECT my_stations()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='dispense_artifacts'
                   AND policyname='dispense_artifacts_station_isolation') THEN
    CREATE POLICY dispense_artifacts_station_isolation ON public.dispense_artifacts
      FOR ALL USING (station_id IN (SELECT my_stations()))
      WITH CHECK (station_id IN (SELECT my_stations()));
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- FY-AWARE INVOICE NUMBERING, PER OUTLET (2026-07-30)
-- docs/credit-slip-invoicing.md §6. The invoice number is a STATUTORY artifact, so
-- Pumpini owning it carries real obligations: consecutive, unique per FY, no reused
-- or unexplained gaps.
--
-- station_settings already has invoice_prefix + invoice_seq. What was missing is the
-- FINANCIAL YEAR, so a series can reset each year and read like the owner's Tally
-- output (e.g. BS/2026-2027/32). Format is PREFIX/FY/SEQ, and all three are per
-- OUTLET because each unit prints and numbers its own documents.
--
-- Idempotent, additive, and safe before the code deploys: numbering falls back to
-- the current behaviour while invoice_fy is absent.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.station_settings ADD COLUMN IF NOT EXISTS invoice_fy character varying(9);

-- ══════════════════════════════════════════════════════════════════════════════
-- ONE ARTIFACT REPOSITORY — public.station_artifacts (2026-08-01)
--
-- Pumpini reads four documents from a photo (delivery invoice, settlement meter,
-- credit coupon, ATG/Pinelabs gauge screen) but only KEPT two of them. The coupon
-- and the gauge screen were parsed and thrown away, so the claim "we store the
-- image as proof" was not true for either. This table closes that.
--
-- WHY ONE TABLE AND NOT A SECOND dispense_artifacts-SHAPED ONE. The obvious move
-- was `dipstick_artifacts` next to `dispense_artifacts`. That is exactly the drift
-- the one-writer rule exists to stop: two artifact tables today, four by the time
-- deposit slips, credit receipts and petty-cash bills arrive, each with its own
-- writer, its own RLS policy to forget, and its own idea of what a "kind" is.
--
-- Instead the parent is named rather than foreign-keyed: (entity_type, entity_id).
-- A coupon hangs off a dispense_event, a gauge screen off a shift, an attendant
-- photo off a shift_attendants row — one table, one writer, one policy.
--
-- The trade is real and worth stating: a soft parent reference gets NO referential
-- integrity, so a deleted parent leaves an orphan artifact. That is the right way
-- round here — an orphaned PROOF is harmless (it is evidence, and evidence
-- outliving its record is not a corruption), whereas a cascade that silently
-- destroys the photograph behind a money document is not.
--
-- dispense_artifacts is retired into this table below. It was created on 30-Jul
-- and never wired to anything, so it holds ZERO rows in both prod and staging
-- (verified 01-Aug before writing this). The copy is therefore a no-op today and
-- the drop is free — which it will never be again once coupons start storing.
--
-- entity_type / kind are deliberately plain varchars with a CHECK on kind only.
-- Every new document type is then a one-line change here plus a caller, and never
-- a new table.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.station_artifacts (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  station_id    uuid NOT NULL REFERENCES public.stations(id),
  -- Soft parent pointer. entity_id is NULLABLE on purpose: a gauge screen can be
  -- photographed for a plain dip-register entry that belongs to no shift.
  entity_type   character varying(40) NOT NULL,
  entity_id     uuid,
  kind          character varying(30) NOT NULL,
  -- storage_path is for the eventual move to Supabase Storage. Until then the
  -- bytes live in file_base64, exactly as meter_photos has done in prod since
  -- day one — same pattern, no new infrastructure needed to start storing.
  storage_path  text,
  file_base64   text,
  media_type    character varying(40),
  ocr           jsonb,
  -- meta carries whatever the document type needs and nothing else does:
  -- {"reading_type":"opening"} for a gauge screen, and — when facial matching
  -- lands — {"match":{"verdict":"...","score":0.0}} for an attendant photo.
  -- Reserved now so Phase 1 adds a verdict without a migration.
  meta          jsonb,
  captured_at   timestamp with time zone DEFAULT now(),
  uploaded_by   uuid REFERENCES public.users(id),
  CONSTRAINT station_artifacts_kind_chk CHECK (kind IN (
    'coupon', 'gauge_screen', 'attendant_photo', 'nozzle_meter', 'nozzle_slip'
  ))
);

CREATE INDEX IF NOT EXISTS idx_station_artifacts_parent
  ON public.station_artifacts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_station_artifacts_station
  ON public.station_artifacts(station_id, kind, captured_at DESC);

-- RLS IN THE SAME BLOCK AS THE CREATE — see CLAUDE.md. A new table on this
-- Supabase project gets RLS enabled automatically, and RLS-on-with-no-policy
-- denies everything: SELECT returns zero rows silently, INSERT raises.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='station_artifacts'
                   AND policyname='station_artifacts_station_isolation') THEN
    CREATE POLICY station_artifacts_station_isolation ON public.station_artifacts
      FOR ALL USING (station_id IN (SELECT my_stations()))
      WITH CHECK (station_id IN (SELECT my_stations()));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.station_artifacts TO app_authenticated;

-- Retire dispense_artifacts. Copy first, then drop — so this stays correct even
-- if it is ever run somewhere the table did acquire rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='dispense_artifacts') THEN
    INSERT INTO public.station_artifacts
      (id, station_id, entity_type, entity_id, kind, storage_path, file_base64,
       media_type, ocr, captured_at, uploaded_by)
    SELECT id, station_id, 'dispense_event', dispense_event_id, kind, storage_path,
           file_base64, media_type, ocr, captured_at, uploaded_by
      FROM public.dispense_artifacts
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE public.dispense_artifacts;
  END IF;
END $$;

-- A dip row records WHICH gauge photo produced it, so a figure on the stock
-- reconciliation can always be traced back to the screen it was read off.
ALTER TABLE public.dipstick_readings
  ADD COLUMN IF NOT EXISTS artifact_id uuid REFERENCES public.station_artifacts(id);

-- ══════════════════════════════════════════════════════════════════════════════
-- PER-ATTENDANT SHIFT CLOCK (2026-08-01)
--
-- Attendance already exists as a table and is already unique on
-- (user_id, date, shift_number) — so this is NOT a new attendance concept, it is
-- the existing one finally being written by the flow that actually knows the
-- times. Starting an attendant stamps check_in; settling him stamps check_out.
--
-- shift_id ties the row to the shift it came from, which is what makes the record
-- provable rather than merely typed: the same row now joins to his nozzle
-- assignment and therefore to meter movement.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL;
-- The photograph taken at start and at close. Nullable — an outlet with a broken
-- camera must still be able to start a shift.
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS check_in_artifact_id  uuid REFERENCES public.station_artifacts(id);
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS check_out_artifact_id uuid REFERENCES public.station_artifacts(id);

CREATE INDEX IF NOT EXISTS idx_attendance_shift ON public.attendance(shift_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- PUMP SERIAL ON THE NOZZLE (2026-08-01) — the last thing stopping a slip scan
--
-- A dispenser slip identifies itself by SERIAL NUMBER, not by a pump number:
--
--     PUMP SERIAL NUMBER : 15BC1412V
--     ---: ETOT-MAIN :---
--     NOZZLE : 1     NOZZLE : 2
--
-- So "NOZZLE : 1" alone is ambiguous the moment an outlet has more than one
-- dispenser — at Kamala it could be nozzle 1.1, 2.1, 3.1 or 4.1. Renumbering the
-- nozzles cannot fix that, because the ambiguity is on the SLIP's side: it never
-- says which machine printed it. Only the serial does, and the serial is stamped
-- on the unit and never changes.
--
-- Recording it against the nozzle turns the match into a lookup:
--     (pump_serial, nozzle number as printed) -> exactly one nozzle
-- with no inference, no numbering convention to agree on, and no dependence on
-- our nozzle names matching the machine's.
--
-- Nullable and additive: an outlet that has not filled it in keeps the existing
-- number-based matching, so nothing regresses before it is populated.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.nozzles ADD COLUMN IF NOT EXISTS pump_serial character varying(40);

-- The number the SLIP prints for this nozzle, which need not equal ours. Kept as
-- its own field rather than parsed out of nozzle_number: an outlet must be free
-- to call its nozzles whatever its staff call them, and a machine is free to
-- number its own the way its firmware does. Tying the two together is what forced
-- a rename in the first place.
ALTER TABLE public.nozzles ADD COLUMN IF NOT EXISTS slip_nozzle_no character varying(8);

-- One physical nozzle per (serial, printed number). A partial index so the many
-- rows with no serial yet do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nozzles_pump_serial_slip_no
  ON public.nozzles(station_id, pump_serial, slip_nozzle_no)
  WHERE pump_serial IS NOT NULL AND slip_nozzle_no IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- PUMPS — the machine the nozzles hang off (2026-08-01)
--
-- Deferred once already. PR #68 (24-Jun) asked the same question and answered it
-- with a naming convention: "Instead of building a pump-hierarchy table, label the
-- nozzles 5.1 / 5.2 / 5.3 / 5.4". Everything since has paid for that shortcut —
-- pump identity living in a display string that outlets number inconsistently,
-- nozzle_number carrying no unique constraint (one outlet had THREE nozzles called
-- "1"), and nowhere to record the serial a slip identifies itself by. Building it
-- properly now.
--
-- A PUMP HAS NO FUEL AND NO TANK (owner, 01-Aug). It is a machine: a number, a
-- serial, a model, and the slip it prints. One unit routinely dispenses several
-- grades from several tanks — 2 HSD + 1 MS + 1 Super off three tanks is ordinary.
-- Fuel and tank stay on the NOZZLE, where they already are. Attaching either here
-- would force an outlet to split one physical unit into four fictional ones.
--
-- serial is NULLABLE: a CNG dispenser prints no slip at all (gas is sold on
-- commission, the outlet never owns the stock), so it must still be definable.
--
-- END-DATED, NEVER DELETED. A defective pump is replaced by end-dating it and its
-- nozzles and defining new ones — deleting would orphan every meter reading ever
-- taken on it. is_active is a switch; end_date is the fact, and only a date can
-- answer "which pump was this reading taken on".
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pumps (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  station_id        uuid NOT NULL REFERENCES public.stations(id),
  -- What is painted on the unit. Outlets number pumps 1, 2, 3 and speak that
  -- language; the serial is what the machine calls itself and nobody remembers.
  pump_number       character varying(16) NOT NULL,
  serial            character varying(40),
  model             character varying(60),
  -- The sample slip this pump's identity was read off, kept as evidence and as the
  -- reference for its print format.
  slip_artifact_id  uuid REFERENCES public.station_artifacts(id),
  notes             text,
  is_active         boolean DEFAULT true,
  end_date          date,
  created_at        timestamp with time zone DEFAULT now()
);

-- Unique among LIVE pumps only, so an end-dated Pump 1 does not block its
-- replacement from also being called Pump 1 — which is exactly what happens when a
-- unit is swapped and the new one takes its place on the forecourt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pumps_station_number
  ON public.pumps(station_id, pump_number) WHERE end_date IS NULL;

-- Serial unique PER OUTLET, not globally. A serial does identify one machine in the
-- world, but enforcing that across tenants would (a) block an outlet from finishing
-- setup over a typo or a rebuilt board reusing a serial, with an error only we
-- could resolve, and (b) let one outlet learn about another's equipment from a
-- constraint violation. Duplicates across outlets are worth FLAGGING, never
-- worth BLOCKING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pumps_station_serial
  ON public.pumps(station_id, upper(serial)) WHERE serial IS NOT NULL AND end_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_pumps_station ON public.pumps(station_id) WHERE end_date IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='pumps'
                   AND policyname='pumps_station_isolation') THEN
    CREATE POLICY pumps_station_isolation ON public.pumps
      FOR ALL USING (station_id IN (SELECT my_stations()))
      WITH CHECK (station_id IN (SELECT my_stations()));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pumps TO app_authenticated;

-- Every nozzle hangs off exactly one pump. Nullable during migration only: existing
-- nozzles have none until the owner assigns them, and the Settings screen shows
-- those loudly at the top rather than hiding the gap.
ALTER TABLE public.nozzles ADD COLUMN IF NOT EXISTS pump_id  uuid REFERENCES public.pumps(id);
ALTER TABLE public.nozzles ADD COLUMN IF NOT EXISTS end_date date;
CREATE INDEX IF NOT EXISTS idx_nozzles_pump ON public.nozzles(pump_id) WHERE end_date IS NULL;

-- The serial now lives on the PUMP, which is the thing that has one. Carrying it on
-- every nozzle too would be the same denormalisation this table exists to undo, so
-- the column added on 01-Aug is folded in and dropped. It holds 0 rows in staging
-- and prod (verified before writing this) — it never got past being wired up.
-- slip_nozzle_no STAYS on the nozzle: that genuinely is per-nozzle, and keeping it
-- separate from nozzle_number is what lets an outlet name its nozzles freely while
-- the machine keeps its own numbering.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='nozzles' AND column_name='pump_serial') THEN
    ALTER TABLE public.nozzles DROP COLUMN pump_serial;
  END IF;
END $$;

-- The old (station, pump_serial, slip_nozzle_no) index goes with that column; the
-- replacement is scoped to the pump, which is now where the serial lives.
DROP INDEX IF EXISTS public.uq_nozzles_pump_serial_slip_no;
CREATE UNIQUE INDEX IF NOT EXISTS uq_nozzles_pump_slip_no
  ON public.nozzles(pump_id, slip_nozzle_no)
  WHERE pump_id IS NOT NULL AND slip_nozzle_no IS NOT NULL AND end_date IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- SHIFT ATTENDANCE — the attendant's own start and end, per shift (owner-set,
-- 01-Aug-2026: "get the attendance and log the start and end date & time for
-- each attendant", as a NEW table).
--
-- WHY NOT the existing `attendance` table. That one is an HR register: keyed on
-- (user_id, date, shift_number), covering every role, filled in by hand on the
-- Attendance screen, with a `status` a manager types. It has no link to a shift,
-- so "was he here?" can never be joined to "did his meter move?".
--
-- This table is the opposite kind of record. It is written ONLY by the shift flow
-- — starting an operator stamps started_at, settling him stamps ended_at — and it
-- is keyed on the SHIFT, so every row joins straight to his nozzle assignment and
-- therefore to the litres that passed through it. A photograph is attached at each
-- end, which is what makes it evidence rather than an assertion.
--
-- Keeping the two apart is deliberate, not drift: one table is what somebody says
-- happened, the other is what the system observed. They answer different questions
-- and must not be allowed to overwrite each other.
CREATE TABLE IF NOT EXISTS public.shift_attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id    uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  shift_id      uuid NOT NULL REFERENCES public.shifts(id)   ON DELETE CASCADE,
  attendant_id  uuid NOT NULL REFERENCES public.users(id),
  -- The shift's OWN date and slot, copied at write time. A night shift opened at
  -- 22:00 on the 1st and closed at 06:00 on the 2nd books both ends against the
  -- 1st; denormalised so a month's register needs no join to shifts.
  shift_date    date NOT NULL,
  shift_number  integer NOT NULL,
  started_at    timestamptz,
  ended_at      timestamptz,
  start_photo_id uuid REFERENCES public.station_artifacts(id),
  end_photo_id   uuid REFERENCES public.station_artifacts(id),
  notes         text,
  recorded_by   uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per man per shift. Re-assigning him to a second nozzle in the same shift
-- must refresh his row, never open a second stretch of attendance.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_attendance_shift_attendant
  ON public.shift_attendance(shift_id, attendant_id);

CREATE INDEX IF NOT EXISTS idx_shift_attendance_station_date
  ON public.shift_attendance(station_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_attendance_attendant
  ON public.shift_attendance(attendant_id, shift_date DESC);

-- 🔴 RLS ships in the SAME block as the table. New tables get RLS enabled
-- automatically on this project, and RLS-on-with-no-policy denies everything —
-- silently returning zero rows on SELECT while INSERT raises. Same shape as every
-- other station-scoped table here.
ALTER TABLE public.shift_attendance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='shift_attendance'
                   AND policyname='shift_attendance_station_isolation') THEN
    CREATE POLICY shift_attendance_station_isolation ON public.shift_attendance
      FOR ALL USING (station_id IN (SELECT my_stations()))
      WITH CHECK (station_id IN (SELECT my_stations()));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shift_attendance TO app_authenticated;

-- Carry across anything the shift flow already stamped on the OLD attendance table
-- during the 01-Aug staging run, so no test data is lost, then retire the three
-- columns that were added there for this purpose. They only ever existed on
-- staging (production never received that DDL — verified before writing this), and
-- leaving them would be a second home for the same fact. Idempotent both ways.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='attendance' AND column_name='shift_id') THEN

    INSERT INTO public.shift_attendance
      (station_id, shift_id, attendant_id, shift_date, shift_number,
       started_at, ended_at, start_photo_id, end_photo_id, notes)
    SELECT a.station_id, a.shift_id, a.user_id, a.date, a.shift_number,
           a.check_in, a.check_out,
           a.check_in_artifact_id, a.check_out_artifact_id, a.notes
      FROM public.attendance a
     WHERE a.shift_id IS NOT NULL
    ON CONFLICT (shift_id, attendant_id) DO NOTHING;

    ALTER TABLE public.attendance DROP COLUMN IF EXISTS shift_id;
    ALTER TABLE public.attendance DROP COLUMN IF EXISTS check_in_artifact_id;
    ALTER TABLE public.attendance DROP COLUMN IF EXISTS check_out_artifact_id;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RETIRE THE SPARE METER STORES (owner-set, 01-Aug-2026: "retire the spare tires,
-- they are heavy").
--
-- Pumpini grew THREE places to keep a nozzle's opening and closing meter:
--
--   shift_attendant_nozzles   one row per operator per nozzle. THE one. Every
--                             rupee the settlement has ever computed came from
--                             here, and it is clean: 876 rows, not one negative
--                             and not one impossible movement.
--   shift_attendants          .opening_reading / .closing_reading — a single pair
--                             on the OPERATOR row, mirroring "the first nozzle" on
--                             assign and "the last leg" on close. For a man on four
--                             nozzles that is not a summary, it is a wrong number.
--                             It held 70 negative and 150 impossible readings.
--   shift_nozzle_readings     a per-nozzle store holding manager-vs-POS captures so
--                             the two could be compared. 3 rows, all abandoned test
--                             data from one Dilsukhnagar shift on 20-Jun-2026.
--
-- The settlement never read the last two — it validates closing >= opening per
-- nozzle and refuses otherwise, so the bad figures could never become money. But
-- the CARRY-FORWARD read all three, COALESCE'd in order. A nozzle missing its good
-- row would have carried one of those figures straight into a live opening, and the
-- shift would have been measured against it. That is why they go.
--
-- Verified before dropping: every row that would have used a fallback belongs to
-- Dilsukhnagar or the unnamed test outlet — NONE at Kamala, Adhoc Highway or
-- Highway — and every one has closing_reading NULL, i.e. never settled.
--
-- ORDER MATTERS: the code that stopped reading and writing these ships FIRST
-- (Railway auto-deploys on merge); this DDL is run afterwards. Dropping before the
-- deploy would 500 the settle path.
DROP TABLE IF EXISTS public.shift_nozzle_readings;

ALTER TABLE public.shift_attendants DROP COLUMN IF EXISTS opening_reading;
ALTER TABLE public.shift_attendants DROP COLUMN IF EXISTS closing_reading;
