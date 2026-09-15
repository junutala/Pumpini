-- 019_lfr_site_category.sql
-- The outlet's LFR site category, so an uploaded LFR invoice can be VALIDATED.
--
-- 🔴 THIS NEVER CREATES A CHARGE. Owner-set 15-Sep-2026: "we will NOT apply
-- automatically, but this will help us to validate the invoice IF THE USER DECIDES TO
-- UPLOAD LFR Invoice." LFR reaches the landed cost only when the outlet actually uploads
-- the OMC's LFR invoice and we split the amount IT states. This column never conjures an
-- LFR figure for a delivery that has no invoice, and no scheduled job may use it to.
--
-- 🔴 IT DOES NOT GATE ANYTHING. The LFR step shows on EVERY outlet's Deliveries screen,
-- set or not. Owner-set 15-Sep-2026: "we want to nudge them to upload the LFR invoice
-- also. Honestly, nobody told them about this till now. So when they see the button,
-- this may trigger LFR invoice upload." The button is the prompt — three outlets have
-- been paying LFR all along and nobody ever asked them for the invoice. Hiding it from
-- the outlets whose category is unset would hide it from exactly the people who need
-- reminding. (An earlier draft of this file gated on the column; that read the owner's
-- words backwards and was corrected the same afternoon.)
--
-- So this column has ONE job: validation. The moment an invoice is uploaded we can say
-- whether the OMC billed what this site should have been billed —
--
--   'A'  OMC owns or leases the land AND the equipment   MS 443.50/KL  HSD 369.58/KL  GST 18%
--   'B'  dealer owns land+building, OMC owns the kit     MS 184.34/KL  HSD 153.62/KL  GST 28%
--   'none'  dealer owns land AND equipment — no LFR is charged at all
--
-- The route can already infer the card by testing both against the invoice's own total
-- (config/lfrRates.js). This column is the belt to that braces: it catches the case where
-- the OMC revises its rates and NOTHING reconciles, because then we still know what the
-- outlet is and can say "your card no longer matches your bill" instead of shrugging.
-- Where the two disagree, both are shown — we never silently prefer one.
--
-- Nullable on purpose: unknown is the honest default, and unknown must read as
-- "cannot validate", never as 'none' (which would assert this outlet pays no LFR).

ALTER TABLE public.station_settings
  ADD COLUMN IF NOT EXISTS lfr_site_category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'station_settings_lfr_site_category_chk'
  ) THEN
    ALTER TABLE public.station_settings
      ADD CONSTRAINT station_settings_lfr_site_category_chk
      CHECK (lfr_site_category IS NULL OR lfr_site_category IN ('A','B','none'));
  END IF;
END $$;

COMMENT ON COLUMN public.station_settings.lfr_site_category IS
  'LFR site category: A (OMC owns land + equipment), B (dealer owns land/building, OMC '
  'owns equipment), none (dealer owns both — no LFR). Used ONLY to validate an uploaded '
  'LFR invoice; it never creates an LFR charge. NULL = unknown, which means cannot '
  'validate — it does NOT mean none.';
