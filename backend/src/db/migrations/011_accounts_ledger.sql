-- 011_accounts_ledger.sql
-- Slice 2 of the optional Accounts module: the Pumpini-owned posting engine's data —
-- the chart of accounts, the rulebook, and the per-outlet journal.
--
-- Two GLOBAL reference tables (chart + rulebook) owned by Pumpini and shared by every
-- outlet, and two PER-STATION journal tables (RLS-isolated). Nothing existing is
-- touched; nothing here posts anything on its own. Idempotent — safe to re-run.
--
-- 🔴 RLS: new tables get RLS auto-enabled on this Supabase project, and RLS-on-with-no-
-- policy denies everything (SELECT silently returns zero rows). So every table below
-- ships its policy in THIS block. Global reference tables get a permissive read policy
-- (all authenticated users may read the shared chart/rules; writes happen only on the
-- BYPASSRLS owner role, i.e. this migration / superadmin). Per-station tables copy the
-- credit_suspense_entries shape exactly: station isolation via my_stations().

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- 1. CHART OF ACCOUNTS (global, Pumpini-owned)
--    Reuses the Tally touchpoint spine + the heads the module needs. `normal_side`
--    and `statement` let reports classify a balance into P&L vs Balance Sheet and sum
--    it on the correct side without per-report hardcoding.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_accounts (
  code         VARCHAR(40) PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  acct_type    VARCHAR(12)  NOT NULL CHECK (acct_type IN ('asset','liability','equity','income','expense')),
  normal_side  VARCHAR(6)   NOT NULL CHECK (normal_side IN ('debit','credit')),
  statement    VARCHAR(4)   NOT NULL CHECK (statement IN ('pnl','bs')),
  sort_order   INT          DEFAULT 100,
  active       BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_accounts_read ON accounting_accounts;
CREATE POLICY accounting_accounts_read ON accounting_accounts FOR SELECT USING (true);
GRANT SELECT ON accounting_accounts TO app_authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. POSTING RULEBOOK (global, Pumpini-owned, "trainable")
--    One transaction type → one or more legs. A leg's account is either a FIXED
--    account_code, or pulled from the event by account_key (e.g. the chosen expense
--    head, or which bank the money left). A leg's amount is pulled from the event by
--    amount_key ('amount' = the event's headline amount). Adding a new transaction
--    type = adding rows here — no per-outlet code.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posting_rules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type   VARCHAR(40) NOT NULL,
  leg_no       INT         NOT NULL DEFAULT 1,
  side         VARCHAR(6)  NOT NULL CHECK (side IN ('debit','credit')),
  account_code VARCHAR(40) REFERENCES accounting_accounts(code),
  account_key  VARCHAR(40),
  amount_key   VARCHAR(40) NOT NULL DEFAULT 'amount',
  description  TEXT,
  active       BOOLEAN     DEFAULT TRUE,
  CONSTRAINT posting_rules_account_present CHECK (account_code IS NOT NULL OR account_key IS NOT NULL),
  UNIQUE (event_type, leg_no)
);

ALTER TABLE posting_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posting_rules_read ON posting_rules;
CREATE POLICY posting_rules_read ON posting_rules FOR SELECT USING (true);
GRANT SELECT ON posting_rules TO app_authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. JOURNAL (per-station, RLS-isolated) — the balanced double-entry the engine writes.
--    UNIQUE(station_id, event_type, source_ref) is the idempotency key: the same source
--    event (e.g. a shift's COGS) posts exactly once, so a re-pull is a no-op. Manual
--    entries carry a NULL source_ref (Postgres treats NULLs as distinct → always allowed).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_journal (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id   UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  event_type   VARCHAR(40) NOT NULL,
  source       VARCHAR(40),
  source_ref   VARCHAR(120),
  narration    TEXT,
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,   -- Σ debits, cached for quick reads
  reversed_by  UUID REFERENCES accounting_journal(id),
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (station_id, event_type, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_acct_journal_station_date
  ON accounting_journal(station_id, entry_date DESC);

ALTER TABLE accounting_journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_journal_station_isolation ON accounting_journal;
CREATE POLICY accounting_journal_station_isolation ON accounting_journal
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_journal TO app_authenticated;

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_id   UUID NOT NULL REFERENCES accounting_journal(id) ON DELETE CASCADE,
  station_id   UUID NOT NULL,   -- denormalized so RLS is a direct-station check
  account_code VARCHAR(40) NOT NULL REFERENCES accounting_accounts(code),
  debit        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  party_type   VARCHAR(20),
  party_id     UUID,
  memo         TEXT
);

CREATE INDEX IF NOT EXISTS idx_acct_jlines_journal
  ON accounting_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_acct_jlines_station_acct
  ON accounting_journal_lines(station_id, account_code);

ALTER TABLE accounting_journal_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_journal_lines_station_isolation ON accounting_journal_lines;
CREATE POLICY accounting_journal_lines_station_isolation ON accounting_journal_lines
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_journal_lines TO app_authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. SEED — chart of accounts (canonical, Pumpini-owned). DO UPDATE keeps the
--    definitional fields in step on re-run.
-- ─────────────────────────────────────────────────────────────
INSERT INTO accounting_accounts(code, name, acct_type, normal_side, statement, sort_order) VALUES
  -- Income (P&L, credit)
  ('petrol_sales',        'Petrol Sales',              'income',   'credit', 'pnl', 10),
  ('diesel_sales',        'Diesel Sales',              'income',   'credit', 'pnl', 11),
  ('premium_sales',       'Premium Petrol Sales',      'income',   'credit', 'pnl', 12),
  ('cng_sales',           'CNG Sales',                 'income',   'credit', 'pnl', 13),
  ('lube_sales',          'Lubes & Product Sales',     'income',   'credit', 'pnl', 14),
  ('other_income',        'Other Income',              'income',   'credit', 'pnl', 19),
  -- Expenses (P&L, debit)
  ('cogs_fuel',           'Cost of Fuel Sold',         'expense',  'debit',  'pnl', 30),
  ('cogs_lube',           'Cost of Lubes Sold',        'expense',  'debit',  'pnl', 31),
  ('petty_cash_expense',  'Petty Cash Expenses',       'expense',  'debit',  'pnl', 40),
  ('electricity',         'Electricity',               'expense',  'debit',  'pnl', 41),
  ('salaries',            'Salaries & Wages',          'expense',  'debit',  'pnl', 42),
  ('rent_expense',        'Rent',                      'expense',  'debit',  'pnl', 43),
  ('repairs_maintenance', 'Repairs & Maintenance',     'expense',  'debit',  'pnl', 44),
  ('bank_charges',        'Bank Charges',              'expense',  'debit',  'pnl', 45),
  ('office_stationery',   'Office & Stationery',       'expense',  'debit',  'pnl', 46),
  ('cleaning',            'Cleaning',                  'expense',  'debit',  'pnl', 47),
  ('transport',           'Transport',                 'expense',  'debit',  'pnl', 48),
  ('staff_welfare',       'Staff Welfare',             'expense',  'debit',  'pnl', 49),
  ('finance_interest',    'Interest & Penalty',        'expense',  'debit',  'pnl', 50),
  ('depreciation',        'Depreciation',              'expense',  'debit',  'pnl', 51),
  ('wetstock_loss',       'Wet-stock / Evaporation Loss','expense', 'debit', 'pnl', 52),
  ('other_expense',       'Other Expenses',            'expense',  'debit',  'pnl', 59),
  -- Assets (BS, debit)
  ('cash_in_hand',        'Cash in Hand',              'asset',    'debit',  'bs',  60),
  ('bank',                'Bank',                      'asset',    'debit',  'bs',  61),
  ('upi_clearing',        'UPI / Card Clearing',       'asset',    'debit',  'bs',  62),
  ('debtors',             'Trade Receivables',         'asset',    'debit',  'bs',  63),
  ('closing_stock_fuel',  'Closing Stock — Fuel',      'asset',    'debit',  'bs',  64),
  ('closing_stock_lube',  'Closing Stock — Lubes',     'asset',    'debit',  'bs',  65),
  ('fixed_assets',        'Fixed Assets',              'asset',    'debit',  'bs',  66),
  ('input_gst',           'Input GST',                 'asset',    'debit',  'bs',  67),
  ('accum_depreciation',  'Accumulated Depreciation',  'asset',    'credit', 'bs',  68),
  -- Liabilities (BS, credit)
  ('creditors',           'Trade Payables',            'liability','credit', 'bs',  70),
  ('owner_loan',          'Owner Loan',                'liability','credit', 'bs',  71),
  ('output_gst',          'Output GST',                'liability','credit', 'bs',  72),
  -- Equity (BS)
  ('capital',             'Owner Capital',             'equity',   'credit', 'bs',  80),
  ('drawings',            'Owner Drawings',            'equity',   'debit',  'bs',  81),
  ('retained_earnings',   'Retained Earnings',         'equity',   'credit', 'bs',  82)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, acct_type=EXCLUDED.acct_type, normal_side=EXCLUDED.normal_side,
  statement=EXCLUDED.statement, sort_order=EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────
-- 5. SEED — starter rulebook. Clean 2-leg mappings for the stable transaction types.
--    Fuel-sale posting (split by fuel type × payment mode) is finalised when the shift
--    event source is wired (Slice 3), where the split dimensions are data. Re-runnable:
--    delete+insert per event_type keeps the seed authoritative without duplicating legs.
-- ─────────────────────────────────────────────────────────────
DELETE FROM posting_rules WHERE event_type IN
  ('cogs_fuel','petty_cash','expense_paid','expense_unpaid','asset_purchase_paid',
   'asset_purchase_unpaid','supplier_payment','owner_drawings_cash','owner_funding_capital',
   'owner_funding_loan','other_income','omc_interest');

INSERT INTO posting_rules(event_type, leg_no, side, account_code, account_key, amount_key, description) VALUES
  -- COGS for a shift: cost of fuel sold reduces stock
  ('cogs_fuel',            1, 'debit',  'cogs_fuel',          NULL,           'amount', 'Cost of fuel sold'),
  ('cogs_fuel',            2, 'credit', 'closing_stock_fuel', NULL,           'amount', 'Reduce fuel stock'),
  -- Petty cash aggregated per shift: one expense head, cash out of the drawer
  ('petty_cash',           1, 'debit',  'petty_cash_expense', NULL,           'amount', 'Petty cash expenses (shift)'),
  ('petty_cash',           2, 'credit', 'cash_in_hand',       NULL,           'amount', 'Cash out of drawer'),
  -- Expense paid now (non-cash): debit the chosen head, credit where it was paid from
  ('expense_paid',         1, 'debit',  NULL,                 'expense_account','amount','Expense (paid)'),
  ('expense_paid',         2, 'credit', NULL,                 'paid_from',      'amount','Paid from bank/UPI'),
  -- Expense on credit: bill stands as a payable
  ('expense_unpaid',       1, 'debit',  NULL,                 'expense_account','amount','Expense (on credit)'),
  ('expense_unpaid',       2, 'credit', 'creditors',          NULL,           'amount', 'Payable to vendor'),
  -- Asset purchase (capitalised, not an expense)
  ('asset_purchase_paid',  1, 'debit',  'fixed_assets',       NULL,           'amount', 'Asset bought (paid)'),
  ('asset_purchase_paid',  2, 'credit', NULL,                 'paid_from',      'amount','Paid from bank/UPI'),
  ('asset_purchase_unpaid',1, 'debit',  'fixed_assets',       NULL,           'amount', 'Asset bought (on credit)'),
  ('asset_purchase_unpaid',2, 'credit', 'creditors',          NULL,           'amount', 'Payable to vendor'),
  -- Supplier payment: settle a payable (no expense — the purchase was booked earlier)
  ('supplier_payment',     1, 'debit',  'creditors',          NULL,           'amount', 'Settle payable'),
  ('supplier_payment',     2, 'credit', NULL,                 'paid_from',      'amount','Paid from bank/UPI'),
  -- Owner drawings in cash
  ('owner_drawings_cash',  1, 'debit',  'drawings',           NULL,           'amount', 'Owner drawings'),
  ('owner_drawings_cash',  2, 'credit', 'cash_in_hand',       NULL,           'amount', 'Cash to owner'),
  -- Owner funding — capital vs repayable loan
  ('owner_funding_capital',1, 'debit',  NULL,                 'received_in',    'amount','Money received'),
  ('owner_funding_capital',2, 'credit', 'capital',            NULL,           'amount', 'Owner capital'),
  ('owner_funding_loan',   1, 'debit',  NULL,                 'received_in',    'amount','Money received'),
  ('owner_funding_loan',   2, 'credit', 'owner_loan',         NULL,           'amount', 'Owner loan'),
  -- Other income (scrap, etc.)
  ('other_income',         1, 'debit',  NULL,                 'received_in',    'amount','Money received'),
  ('other_income',         2, 'credit', 'other_income',       NULL,           'amount', 'Other income'),
  -- OMC interest / penalty on late fuel payment
  ('omc_interest',         1, 'debit',  'finance_interest',   NULL,           'amount', 'Interest / penalty'),
  ('omc_interest',         2, 'credit', 'creditors',          NULL,           'amount', 'Added to OMC payable');
