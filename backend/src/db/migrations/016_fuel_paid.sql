-- 016_fuel_paid.sql
-- Fuel purchase payment status. Lets a delivery be PREPAID (paid at lift — the OMC
-- deposit/auto-debit case) or ON CREDIT. Prepaid fuel credits bank (no payable); credit
-- fuel credits creditors (a real payable). Fixes the inflated Trade Payables where every
-- delivery was wrongly booked as credit.
--
-- 🔴 This ADDS A COLUMN TO AN EXISTING TABLE (fuel_deliveries) — the owner's explicit
-- approved exception to the "don't touch existing flows" rule (10-Aug-2026), so the
-- Deliveries screen can carry a "Paid" checkbox. Additive + idempotent. Run after 015.

-- Nullable on purpose: existing rows read as "unknown" (the posting treats unknown as
-- credit until the owner classifies them). NEW deliveries set it from the checkbox.
ALTER TABLE public.fuel_deliveries ADD COLUMN IF NOT EXISTS paid boolean;

-- fuel_purchase now credits bank (prepaid) or creditors (credit), chosen per delivery via
-- the event's credit_to key.
DELETE FROM posting_rules WHERE event_type = 'fuel_purchase';
INSERT INTO posting_rules(event_type, leg_no, side, account_code, account_key, amount_key, description) VALUES
  ('fuel_purchase', 1, 'debit',  'closing_stock_fuel', NULL,        'amount', 'Fuel into stock (landed cost)'),
  ('fuel_purchase', 2, 'credit', NULL,                 'credit_to', 'amount', 'Prepaid → bank, or on credit → creditors');
