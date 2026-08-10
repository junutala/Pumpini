-- 013_accounts_cng.sql
-- Slice 3.1: correct CNG accounting. CNG is a COMMISSION business — the outlet never
-- buys CNG or holds stock; it sells IOCL's CNG by the kg and earns a fixed commission
-- per kg (marginService.CNG_COMMISSION_PER_KG). So CNG's gross sale is NOT the outlet's
-- revenue: only the commission is, and the rest is cash collected on IOCL's behalf — a
-- pass-through payable. Additive + idempotent. Run after 012.

-- The liability that holds CNG cash owed to IOCL (gross collected − commission earned).
INSERT INTO accounting_accounts(code, name, acct_type, normal_side, statement, sort_order) VALUES
  ('cng_payable', 'CNG Collections Payable (IOCL)', 'liability', 'credit', 'bs', 73)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, acct_type=EXCLUDED.acct_type, normal_side=EXCLUDED.normal_side,
  statement=EXCLUDED.statement, sort_order=EXCLUDED.sort_order;

-- Reclassification rule: the per-shift fuel_sale posts gross (from shift_reconciliation,
-- which includes CNG). This entry moves the CNG non-commission portion OUT of revenue and
-- into the IOCL payable, leaving fuel_sales = liquid-fuel gross + CNG commission.
DELETE FROM posting_rules WHERE event_type = 'cng_passthrough';
INSERT INTO posting_rules(event_type, leg_no, side, account_code, account_key, amount_key, description) VALUES
  ('cng_passthrough', 1, 'debit',  'fuel_sales',  NULL, 'amount', 'Remove CNG pass-through from revenue'),
  ('cng_passthrough', 2, 'credit', 'cng_payable', NULL, 'amount', 'CNG cash collected, owed to IOCL');
