// src/db/migrate.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const schema = `
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
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(schema);
    console.log('✅  Migrations complete');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
