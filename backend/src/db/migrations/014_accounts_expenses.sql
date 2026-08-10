-- 014_accounts_expenses.sql
-- Slice 4: Bill & Payment capture — the vendor and expense tables. Per-station, RLS-
-- isolated (copying the credit_suspense_entries shape). Adds the accounts.expense
-- permission module so the MANAGER (not just owner/accountant) can capture bills. The
-- posting rules these use (expense_paid / expense_unpaid / asset_purchase_*) were seeded
-- in 011. Additive + idempotent. Run after 013.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Vendors — born from a scan the first time a payee is seen, then remembered so the next
-- bill is pre-classified. One party table for expenses now and payables later (one
-- concept, not two). default_category is the learned expense head (vendor→head learning).
CREATE TABLE IF NOT EXISTS accounting_vendors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id       UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name             VARCHAR(160) NOT NULL,
  vendor_type      VARCHAR(20) DEFAULT 'other',    -- utility | supplier | omc | other
  default_category VARCHAR(40) REFERENCES accounting_accounts(code),
  gstn             VARCHAR(20),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_vendor_station_name
  ON accounting_vendors(station_id, lower(name));

ALTER TABLE accounting_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_vendors_station_isolation ON accounting_vendors;
CREATE POLICY accounting_vendors_station_isolation ON accounting_vendors
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_vendors TO app_authenticated;

-- Expenses / asset purchases captured from a bill (or manual). Each row links to the
-- journal entry the engine posted (journal_id), so nothing is a floating record.
CREATE TABLE IF NOT EXISTS expenses (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id            UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  vendor_id             UUID REFERENCES accounting_vendors(id),
  category              VARCHAR(40) REFERENCES accounting_accounts(code),  -- the expense head
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  gst_amount            NUMERIC(14,2) DEFAULT 0,
  expense_date          DATE NOT NULL,
  invoice_number        VARCHAR(80),
  description           TEXT,
  is_asset              BOOLEAN DEFAULT FALSE,
  asset_life_years      NUMERIC(5,1),
  payment_status        VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid')),
  payment_mode          VARCHAR(10) CHECK (payment_mode IN ('bank','upi','cheque')),
  paid_from             VARCHAR(40) REFERENCES accounting_accounts(code),
  document_path         TEXT,
  ai_suggested_category VARCHAR(40),
  ai_confidence         VARCHAR(10),
  journal_id            UUID REFERENCES accounting_journal(id),
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_station_date ON expenses(station_id, expense_date DESC);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_station_isolation ON expenses;
CREATE POLICY expenses_station_isolation ON expenses
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO app_authenticated;

-- The manager captures bills, so this is a manager-reachable capability (distinct from
-- accounts.view/manage which gate the owner/accountant reports).
INSERT INTO permission_modules(code, category, label) VALUES
  ('accounts.expense', 'Accounts', 'Record Expenses & Bills')
ON CONFLICT (code) DO NOTHING;
