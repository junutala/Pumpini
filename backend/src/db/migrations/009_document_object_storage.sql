-- ─────────────────────────────────────────────────────────────
--  DOCUMENT BYTES → OBJECT STORAGE (2026-07-23)
--
--  Move raw image/PDF bytes OUT of Postgres into Supabase Storage (private
--  `pumpini-docs` bucket), keeping only a storage PATH in the DB — the same
--  pattern the app's other images already use. Two columns held base64 TEXT:
--    • delivery_invoices.file_base64  (scanned delivery-invoice DCs)
--    • meter_photos.image_base64      (meter/totalizer audit photos)
--
--  This migration is ADDITIVE ONLY and column-tolerant with the shipped code:
--    1. add nullable `storage_path` to each table;
--    2. drop the NOT NULL on delivery_invoices.file_base64 so URL-only rows can
--       insert (meter_photos.image_base64 is already nullable).
--  The base64 columns are RETAINED — un-migrated rows still read from them, and
--  new writes fall back to them if this DDL hasn't run yet. Dropping the base64
--  columns is a SEPARATE, later, owner-gated step after the backfill confirms
--  every row has a storage_path.
--
--  Idempotent. Run on the target DB (staging first).
-- ─────────────────────────────────────────────────────────────

-- Step 1 — delivery invoices: add the path column.
ALTER TABLE delivery_invoices ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Step 2 — delivery invoices: allow URL-only rows (file_base64 no longer required).
ALTER TABLE delivery_invoices ALTER COLUMN file_base64 DROP NOT NULL;

-- Step 3 — meter photos: add the path column (image_base64 is already nullable).
ALTER TABLE meter_photos ADD COLUMN IF NOT EXISTS storage_path TEXT;
