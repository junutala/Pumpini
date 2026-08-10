-- 012_accounts_shift_rules.sql
-- Slice 3: rulebook additions for the auto-fed operational events. Additive and
-- idempotent. Adds the aggregate fuel-sales income head and the posting rules for the
-- per-shift fuel sale and the per-delivery fuel purchase. (cogs_fuel and petty_cash
-- rules were already seeded in 011.) Run after 011.

-- Aggregate "Fuel Sales" head — the per-shift sale posts one revenue line here (the
-- per-fuel-type split, from dispense_events, is a later reporting refinement).
INSERT INTO accounting_accounts(code, name, acct_type, normal_side, statement, sort_order) VALUES
  ('fuel_sales', 'Fuel Sales', 'income', 'credit', 'pnl', 9)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, acct_type=EXCLUDED.acct_type, normal_side=EXCLUDED.normal_side,
  statement=EXCLUDED.statement, sort_order=EXCLUDED.sort_order;

DELETE FROM posting_rules WHERE event_type IN ('fuel_sale','fuel_purchase');

INSERT INTO posting_rules(event_type, leg_no, side, account_code, account_key, amount_key, description) VALUES
  -- Per-shift fuel sale. Debits split by how the money came in (cash / UPI+card /
  -- credit); credit is the whole sale. Zero legs are skipped (e.g. an all-cash shift),
  -- and the debits still tie to the credit because cash = total − card − upi − credit.
  ('fuel_sale',    1, 'debit',  'cash_in_hand',       NULL, 'cash',     'Cash portion of sales'),
  ('fuel_sale',    2, 'debit',  'upi_clearing',       NULL, 'upi_card', 'UPI + card portion'),
  ('fuel_sale',    3, 'debit',  'debtors',            NULL, 'credit',   'Credit (customer) portion'),
  ('fuel_sale',    4, 'credit', 'fuel_sales',         NULL, 'amount',   'Fuel sales revenue'),
  -- Per-delivery fuel purchase: landed cost into stock, OMC payable up. Without this
  -- the COGS credit to stock would drive the stock account negative.
  ('fuel_purchase',1, 'debit',  'closing_stock_fuel', NULL, 'amount',   'Fuel into stock (landed cost)'),
  ('fuel_purchase',2, 'credit', 'creditors',          NULL, 'amount',   'Payable to oil company');
