-- =====================================================================
-- CLEAR ONE OUTLET'S TRANSACTION DATA  —  keep its master data
-- =====================================================================
-- Use when an outlet has been trialled and is about to start production:
-- it removes shifts, readings, settlements, deliveries, invoices, cash and
-- photographs, and leaves the outlet itself set up — pumps, nozzles, tanks,
-- prices, shift timings, staff and permissions all stay exactly as they are.
--
-- First written 18-Sep-2026 after doing this by hand for SBR Energies, which
-- is also where the two traps at the bottom of this header were found.
--
-- ---------------------------------------------------------------------
-- HOW TO RUN
-- ---------------------------------------------------------------------
--   1. Fill in BOTH lines in the GUARD block below — the outlet's id AND
--      its exact name.
--   2. Run the whole file in the Supabase SQL editor.
--   3. Read the two reports it prints: BEFORE and AFTER.
--
-- 🔴 THE GUARD IS THE POINT. The script aborts unless the id and the name
-- name the SAME single outlet. A pasted id from the wrong tab therefore
-- deletes nothing, which is the one mistake this file exists to prevent —
-- a wrong WHERE reaches a real outlet and there is no undo.
--
-- 🔴 EVERYTHING RUNS IN ONE TRANSACTION. Any error rolls the whole thing
-- back. There is no half-cleared state to unpick.
--
-- ---------------------------------------------------------------------
-- WHAT IS KEPT — master and configuration
-- ---------------------------------------------------------------------
--   stations · station_settings · station_users · station_group_members
--   station_subscriptions · pumps · nozzles · tanks · fuel_prices
--   shift_definitions · role_templates · user_role_assignments
--   products · rfid_tags · psp_sources · tally_ledger_map
--   accounting_vendors · accounting_opening_balances · fixed_assets
--   corporate_station_links · credit_slip_books
--
-- credit_slip_books is KEPT deliberately: a coupon book is a physical thing
-- the outlet holds, not a transaction. If a trial burned leaves off a real
-- book, fix that book by hand — do not add it here.
--
-- ---------------------------------------------------------------------
-- TWO TRAPS, both found the hard way
-- ---------------------------------------------------------------------
-- 1. `tank_book_stock` and `corporate_station_balance` are VIEWS, not
--    tables. DELETE on them fails with 55000 and aborts the transaction.
--    They are derived, so they empty themselves. Never list them here.
--
-- 2. MASTER ROWS POINT AT ARTIFACTS. `pumps.slip_artifact_id` and
--    `credit_slip_books.sample_artifact_id` are foreign keys INTO
--    station_artifacts, so deleting artifacts fails while a pump holds a
--    sample slip photo. Step 1 clears those pointers first. The photograph
--    goes; the pump and the book stay.
--
-- ---------------------------------------------------------------------
-- ORDER
-- ---------------------------------------------------------------------
-- Children before parents throughout. Several of these have ON DELETE
-- CASCADE from shifts and would go anyway; they are listed explicitly so
-- the report shows what left, and so the file does not depend on a cascade
-- somebody may change later.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- GUARD — fill in both, they must agree
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _target ON COMMIT DROP AS
SELECT s.id, s.name
  FROM stations s
 WHERE s.id   = '00000000-0000-0000-0000-000000000000'::uuid   -- <<< OUTLET ID
   AND s.name = 'PUT THE EXACT OUTLET NAME HERE';              -- <<< OUTLET NAME

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _target;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'GUARD FAILED: the id and the name do not identify one outlet (matched %). Nothing has been changed.', n;
  END IF;
  RAISE NOTICE 'Target outlet: % (%)', (SELECT name FROM _target), (SELECT id FROM _target);
END $$;

-- ---------------------------------------------------------------------
-- BEFORE
-- ---------------------------------------------------------------------
SELECT 'BEFORE' AS report, t.* FROM (
  SELECT
    (SELECT count(*) FROM shifts              WHERE station_id=(SELECT id FROM _target)) AS shifts,
    (SELECT count(*) FROM dipstick_readings   WHERE station_id=(SELECT id FROM _target)) AS dips,
    (SELECT count(*) FROM fuel_deliveries     WHERE station_id=(SELECT id FROM _target)) AS deliveries,
    (SELECT count(*) FROM attendant_settlements WHERE station_id=(SELECT id FROM _target)) AS settlements,
    (SELECT count(*) FROM gst_invoices        WHERE station_id=(SELECT id FROM _target)) AS gst_invoices,
    (SELECT count(*) FROM dispense_events     WHERE station_id=(SELECT id FROM _target)) AS dispense_events,
    (SELECT count(*) FROM station_artifacts   WHERE station_id=(SELECT id FROM _target)) AS artifacts,
    (SELECT string_agg(current_stock::text,' / ' ORDER BY tank_number) FROM tanks WHERE station_id=(SELECT id FROM _target)) AS tank_stock
) t;

-- ---------------------------------------------------------------------
-- 1. Release master -> artifact pointers (trap 2). Rows are KEPT.
-- ---------------------------------------------------------------------
UPDATE pumps SET slip_artifact_id = NULL
 WHERE station_id=(SELECT id FROM _target) AND slip_artifact_id IS NOT NULL;

UPDATE credit_slip_books SET sample_artifact_id = NULL
 WHERE station_id=(SELECT id FROM _target) AND sample_artifact_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Deepest children first
-- ---------------------------------------------------------------------
DELETE FROM corporate_transactions
 WHERE dispense_event_id IN (SELECT id FROM dispense_events WHERE station_id=(SELECT id FROM _target));

DELETE FROM product_credit_note_items
 WHERE credit_note_id IN (SELECT id FROM product_credit_notes WHERE station_id=(SELECT id FROM _target));

DELETE FROM product_invoice_items
 WHERE invoice_id IN (SELECT id FROM product_invoices WHERE station_id=(SELECT id FROM _target));

DELETE FROM tank_recon_nozzles
 WHERE recon_id IN (SELECT id FROM tank_recons WHERE station_id=(SELECT id FROM _target));

DELETE FROM tank_recon_tanks
 WHERE recon_id IN (SELECT id FROM tank_recons WHERE station_id=(SELECT id FROM _target));

DELETE FROM accounting_journal_lines
 WHERE station_id=(SELECT id FROM _target);

DELETE FROM cash_denominations
 WHERE shift_id IN (SELECT id FROM shifts WHERE station_id=(SELECT id FROM _target));

-- ---------------------------------------------------------------------
-- 3. Cycles and settlements. nozzle_cycles points at shift_reconciliation,
--    so it must go before it.
-- ---------------------------------------------------------------------
DELETE FROM nozzle_cycles      WHERE station_id=(SELECT id FROM _target);
DELETE FROM shift_reconciliation
 WHERE shift_id IN (SELECT id FROM shifts WHERE station_id=(SELECT id FROM _target));
DELETE FROM tank_cycles        WHERE station_id=(SELECT id FROM _target);
DELETE FROM attendant_settlements WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- 4. Money. expenses -> accounting_journal, so expenses first.
--    dispense_events and corporate_receipts -> gst_invoices, so both first.
-- ---------------------------------------------------------------------
DELETE FROM dispense_events        WHERE station_id=(SELECT id FROM _target);
DELETE FROM corporate_receipts     WHERE station_id=(SELECT id FROM _target);
DELETE FROM credit_suspense_entries WHERE station_id=(SELECT id FROM _target);
DELETE FROM cash_deposits          WHERE station_id=(SELECT id FROM _target);
DELETE FROM petty_cash_entries     WHERE station_id=(SELECT id FROM _target);
DELETE FROM expenses               WHERE station_id=(SELECT id FROM _target);
DELETE FROM accounting_journal     WHERE station_id=(SELECT id FROM _target);
DELETE FROM gst_invoices           WHERE station_id=(SELECT id FROM _target);

-- Shop / lubes: credit notes point at invoices, so notes first.
DELETE FROM product_credit_notes   WHERE station_id=(SELECT id FROM _target);
DELETE FROM product_invoices       WHERE station_id=(SELECT id FROM _target);
DELETE FROM product_stock_receipts WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- 5. Wet stock. fuel_deliveries -> delivery_invoices (incl. the LFR
--    invoice), so the deliveries go before the documents.
-- ---------------------------------------------------------------------
DELETE FROM fuel_test_draws     WHERE station_id=(SELECT id FROM _target);
DELETE FROM fuel_deliveries     WHERE station_id=(SELECT id FROM _target);
DELETE FROM delivery_invoices   WHERE station_id=(SELECT id FROM _target);
DELETE FROM tank_reconciliation WHERE station_id=(SELECT id FROM _target);
DELETE FROM tank_recons         WHERE station_id=(SELECT id FROM _target);
DELETE FROM dipstick_readings   WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- 6. The shift and everything hanging off it
-- ---------------------------------------------------------------------
DELETE FROM shift_scan_meters WHERE station_id=(SELECT id FROM _target);
DELETE FROM nozzle_events     WHERE station_id=(SELECT id FROM _target);
DELETE FROM meter_photos
 WHERE shift_id IN (SELECT id FROM shifts WHERE station_id=(SELECT id FROM _target));
DELETE FROM shift_attendant_nozzles
 WHERE shift_id IN (SELECT id FROM shifts WHERE station_id=(SELECT id FROM _target));
DELETE FROM shift_attendants
 WHERE shift_id IN (SELECT id FROM shifts WHERE station_id=(SELECT id FROM _target));
DELETE FROM shift_attendance  WHERE station_id=(SELECT id FROM _target);
DELETE FROM shifts            WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- 7. Attendance, alerts, and finally the photographs
-- ---------------------------------------------------------------------
DELETE FROM attendance        WHERE station_id=(SELECT id FROM _target);
DELETE FROM alerts            WHERE station_id=(SELECT id FROM _target);
DELETE FROM station_artifacts WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- 8. OPTIONAL — zero the tank stock so he enters fresh opening stock.
--    Comment this out to keep the current figures.
--    This is a REAL NUMBER on a live outlet: only run it when the outlet
--    is genuinely starting over and will dip its tanks the same day.
-- ---------------------------------------------------------------------
UPDATE tanks SET current_stock = 0 WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- 9. OPTIONAL — restart invoice numbering. Leave commented unless the
--    outlet issued invoices during the trial that must not be replayed.
-- ---------------------------------------------------------------------
-- UPDATE station_settings SET invoice_seq = 1 WHERE station_id=(SELECT id FROM _target);
-- DELETE FROM product_invoice_seq WHERE station_id=(SELECT id FROM _target);
-- DELETE FROM product_cn_seq      WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- AFTER — every number on the left must be 0. The right-hand side proves
-- the outlet is still set up.
-- ---------------------------------------------------------------------
SELECT 'AFTER' AS report, t.* FROM (
  SELECT
    (SELECT count(*) FROM shifts            WHERE station_id=(SELECT id FROM _target)) AS shifts,
    (SELECT count(*) FROM dipstick_readings WHERE station_id=(SELECT id FROM _target)) AS dips,
    (SELECT count(*) FROM fuel_deliveries   WHERE station_id=(SELECT id FROM _target)) AS deliveries,
    (SELECT count(*) FROM gst_invoices      WHERE station_id=(SELECT id FROM _target)) AS gst_invoices,
    (SELECT count(*) FROM station_artifacts WHERE station_id=(SELECT id FROM _target)) AS artifacts,
    (SELECT count(*) FROM pumps             WHERE station_id=(SELECT id FROM _target)) AS pumps_kept,
    (SELECT count(*) FROM nozzles           WHERE station_id=(SELECT id FROM _target)) AS nozzles_kept,
    (SELECT count(*) FROM tanks             WHERE station_id=(SELECT id FROM _target)) AS tanks_kept,
    (SELECT count(*) FROM fuel_prices       WHERE station_id=(SELECT id FROM _target)) AS prices_kept,
    (SELECT count(*) FROM station_users     WHERE station_id=(SELECT id FROM _target)) AS staff_kept,
    (SELECT string_agg(current_stock::text,' / ' ORDER BY tank_number) FROM tanks WHERE station_id=(SELECT id FROM _target)) AS tank_stock
) t;

COMMIT;
