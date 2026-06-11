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
  ('settings.manage',  'Admin',     'Station Settings')
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
