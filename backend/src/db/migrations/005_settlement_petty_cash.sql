-- ─────────────────────────────────────────────────────────────
--  Record the petty-cash/skimming bucket on the per-operator settlement row,
--  alongside the existing card_total / upi_total / credit_total. The cash that
--  left the drawer for petty cash is already netted into cash_expected; this
--  column just preserves the amount for the audit trail and the variance display.
--
--  Idempotent. Versioned: v1 2026-06-22.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE shift_reconciliation ADD COLUMN IF NOT EXISTS petty_cash NUMERIC(12,2) DEFAULT 0;
