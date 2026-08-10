-- 015_accounts_owner_payables.sql
-- Slices 5 (Owner Money) & 6 (Payables) rulebook additions. Additive + idempotent.
-- Run after 014.
--
-- owner_drawings: generalised over cash OR bank (the old cash-only owner_drawings_cash is
-- retired). cng_payment: settle the IOCL CNG payable. Owner funding (capital/loan), other
-- income, and supplier_payment (paying trade creditors) were already seeded in 011.

DELETE FROM posting_rules WHERE event_type IN ('owner_drawings','owner_drawings_cash','cng_payment');

INSERT INTO posting_rules(event_type, leg_no, side, account_code, account_key, amount_key, description) VALUES
  -- Owner takes money out (drawings) — from the cash drawer or the bank.
  ('owner_drawings', 1, 'debit',  'drawings',    NULL,        'amount', 'Owner drawings'),
  ('owner_drawings', 2, 'credit', NULL,          'paid_from', 'amount', 'From cash / bank'),
  -- Pay IOCL the CNG collections held on their behalf.
  ('cng_payment',    1, 'debit',  'cng_payable', NULL,        'amount', 'Pay IOCL for CNG collected'),
  ('cng_payment',    2, 'credit', NULL,          'paid_from', 'amount', 'From bank');
