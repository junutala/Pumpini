-- =====================================================================
-- CLEAR ONE OUTLET'S TRANSACTION DATA  —  keep its master data
-- =====================================================================
-- Use when an outlet has been trialled and is about to start production,
-- or asks to start over: it removes shifts, readings, settlements, sales,
-- invoices, cash and the photographs of all of those, and leaves the outlet
-- itself set up — pumps, nozzles, tanks, prices, shift timings, staff,
-- permissions and credit customers all stay exactly as they are.
--
-- DELIVERIES ARE A CHOICE, made in the GUARD block: keep them (the outlet
-- will re-enter only its sales) or clear them with everything else.
--
-- History:
--   18-Sep-2026  first written after doing this by hand for SBR Energies.
--   24-Sep-2026  SBR asked to start over again, keeping its deliveries. The
--                18-Sep version could not keep them, would have deleted the
--                attendants' face-enrolment photographs (master data), and
--                zeroed tank stock by default although step 8 said OPTIONAL.
--                All three fixed here — traps 3 and 4, and step 8.
--
-- ---------------------------------------------------------------------
-- HOW TO RUN
-- ---------------------------------------------------------------------
--   1. Fill in the GUARD block below: the outlet's id, its exact name, and
--      the two choices (keep_deliveries, zero_tank_stock).
--   2. Run the whole file in the Supabase SQL editor.
--   3. Read the two reports it prints: BEFORE and AFTER.
--
-- 🔴 THE GUARD IS THE POINT. The script aborts unless the id and the name
-- name the SAME single outlet, and unless keep_deliveries has been set to
-- true or false. A pasted id from the wrong tab therefore deletes nothing,
-- which is the one mistake this file exists to prevent — a wrong WHERE
-- reaches a real outlet and there is no undo.
--
-- 🔴 EVERYTHING RUNS IN ONE TRANSACTION. Any error rolls the whole thing
-- back. There is no half-cleared state to unpick.
--
-- 🔴 RULE ZERO STILL APPLIES. This file does not authorise anybody to run
-- it. On production it runs only on the owner's clear word, for the outlet
-- he named, after he has seen the BEFORE counts.
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
--   station_artifacts that are NOT a transaction's photograph (trap 4)
--   — and, when keep_deliveries = true: fuel_deliveries, delivery_invoices
--     and the deliveries' own journals (accounting_journal source
--     'delivery_pull', with their lines).
--
-- credit_slip_books is KEPT deliberately: a coupon book is a physical thing
-- the outlet holds, not a transaction. If a trial burned leaves off a real
-- book, fix that book by hand — do not add it here.
--
-- ---------------------------------------------------------------------
-- FOUR TRAPS, all found the hard way
-- ---------------------------------------------------------------------
-- 1. `tank_book_stock` and `corporate_station_balance` are VIEWS, not
--    tables. DELETE on them fails with 55000 and aborts the transaction.
--    They are derived, so they empty themselves. Never list them here.
--
-- 2. MASTER ROWS POINT AT ARTIFACTS. `pumps.slip_artifact_id` and
--    `credit_slip_books.sample_artifact_id` are foreign keys INTO
--    station_artifacts. The 18-Sep version nulled those pointers and
--    deleted the photograph. It no longer does: a pump's commissioning slip
--    is evidence about the PUMP, which is kept, so its photograph is kept
--    too, and anything a kept row points at is never deleted (step 7).
--
-- 3. KEPT DELIVERIES POINT AT SHIFTS. `fuel_deliveries.shift_id` is a
--    NO ACTION foreign key into shifts, so deleting the shifts fails while
--    a kept delivery still names one. Step 5 releases that pointer first.
--    The delivery belongs to its tank, not to a shift (204 of 206 deliveries
--    carried shift_id NULL when counted on 22-Sep-2026), so nothing is lost.
--
-- 4. NOT EVERY PHOTOGRAPH IS A TRANSACTION. station_artifacts also holds
--    each attendant's face-enrolment photograph (kind 'attendant_photo',
--    entity 'user') and each pump's commissioning slip (entity 'pump').
--    Those are master data. So photographs are deleted by ALLOW-LIST —
--    only those that belong to a shift or a sale, or are a gauge-console
--    reading — never "everything for the station". A kind invented later
--    is therefore KEPT until somebody adds it here on purpose; the AFTER
--    report lists what stayed, so it cannot hide.
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
-- GUARD — fill in all four. The id and the name must agree.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _target ON COMMIT DROP AS
SELECT s.id, s.name,
       NULL::boolean AS keep_deliveries,   -- <<< true: keep deliveries, their invoices and journals
                                           --     false: clear them with everything else
       false         AS zero_tank_stock    -- <<< true only if the outlet dips its tanks the same day (step 8)
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
  IF (SELECT keep_deliveries FROM _target) IS NULL THEN
    RAISE EXCEPTION
      'GUARD FAILED: set keep_deliveries to true or false. Nothing has been changed.';
  END IF;
  RAISE NOTICE 'Target outlet: % (%) — keep deliveries: %, zero tank stock: %',
    (SELECT name FROM _target), (SELECT id FROM _target),
    (SELECT keep_deliveries FROM _target), (SELECT zero_tank_stock FROM _target);
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
-- 1. (Retired.) The 18-Sep version released pumps.slip_artifact_id and
--    credit_slip_books.sample_artifact_id here so it could delete those
--    photographs. They are kept now (trap 2), so there is nothing to release.
-- ---------------------------------------------------------------------

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

-- Journal lines go with their journal (step 4 decides which journals go).
DELETE FROM accounting_journal_lines
 WHERE journal_id IN (
   SELECT id FROM accounting_journal
    WHERE station_id=(SELECT id FROM _target)
      AND NOT ((SELECT keep_deliveries FROM _target) AND source IS NOT DISTINCT FROM 'delivery_pull'));

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
--    A delivery's own journal ('delivery_pull') stays when its delivery stays;
--    materialize() re-posts only deliveries that have none, so keeping it is
--    what stops a later run from posting the purchase twice.
-- ---------------------------------------------------------------------
DELETE FROM dispense_events        WHERE station_id=(SELECT id FROM _target);
DELETE FROM corporate_receipts     WHERE station_id=(SELECT id FROM _target);
DELETE FROM credit_suspense_entries WHERE station_id=(SELECT id FROM _target);
DELETE FROM cash_deposits          WHERE station_id=(SELECT id FROM _target);
DELETE FROM petty_cash_entries     WHERE station_id=(SELECT id FROM _target);
DELETE FROM expenses               WHERE station_id=(SELECT id FROM _target);
DELETE FROM accounting_journal
 WHERE station_id=(SELECT id FROM _target)
   AND NOT ((SELECT keep_deliveries FROM _target) AND source IS NOT DISTINCT FROM 'delivery_pull');
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

-- Kept deliveries: release their pointer to the shifts about to go (trap 3).
UPDATE fuel_deliveries SET shift_id = NULL
 WHERE station_id=(SELECT id FROM _target) AND shift_id IS NOT NULL
   AND (SELECT keep_deliveries FROM _target);

DELETE FROM fuel_deliveries
 WHERE station_id=(SELECT id FROM _target) AND NOT (SELECT keep_deliveries FROM _target);
DELETE FROM delivery_invoices
 WHERE station_id=(SELECT id FROM _target) AND NOT (SELECT keep_deliveries FROM _target);

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
-- 7. Attendance, alerts, and the photographs OF TRANSACTIONS (trap 4).
--    Allow-list: a shift's or a sale's photograph, or a gauge-console
--    reading. Never one a kept row still points at.
-- ---------------------------------------------------------------------
DELETE FROM attendance        WHERE station_id=(SELECT id FROM _target);
DELETE FROM alerts            WHERE station_id=(SELECT id FROM _target);
DELETE FROM station_artifacts a
 WHERE a.station_id=(SELECT id FROM _target)
   AND (a.entity_type IN ('shift', 'dispense_event') OR a.kind = 'gauge_screen')
   AND NOT EXISTS (SELECT 1 FROM pumps p             WHERE p.slip_artifact_id   = a.id)
   AND NOT EXISTS (SELECT 1 FROM credit_slip_books b WHERE b.sample_artifact_id = a.id);

-- ---------------------------------------------------------------------
-- 8. OPTIONAL — zero the tank stock so he enters fresh opening stock.
--    Set zero_tank_stock in the GUARD block; it is false by default.
--    This is a REAL NUMBER on a live outlet: only zero it when the outlet
--    is genuinely starting over and will dip its tanks the same day. Left
--    alone, the first opening dip overwrites it anyway (routes/dipstick.js).
-- ---------------------------------------------------------------------
UPDATE tanks SET current_stock = 0
 WHERE station_id=(SELECT id FROM _target) AND (SELECT zero_tank_stock FROM _target);

-- ---------------------------------------------------------------------
-- 9. OPTIONAL — restart invoice numbering. Leave commented unless the
--    outlet issued invoices during the trial that must not be replayed.
-- ---------------------------------------------------------------------
-- UPDATE station_settings SET invoice_seq = 1 WHERE station_id=(SELECT id FROM _target);
-- DELETE FROM product_invoice_seq WHERE station_id=(SELECT id FROM _target);
-- DELETE FROM product_cn_seq      WHERE station_id=(SELECT id FROM _target);

-- ---------------------------------------------------------------------
-- AFTER — the transaction columns must be 0. The rest proves the outlet
-- is still set up, and shows what was kept on purpose.
-- ---------------------------------------------------------------------
SELECT 'AFTER' AS report, t.* FROM (
  SELECT
    (SELECT count(*) FROM shifts            WHERE station_id=(SELECT id FROM _target)) AS shifts,
    (SELECT count(*) FROM dipstick_readings WHERE station_id=(SELECT id FROM _target)) AS dips,
    (SELECT count(*) FROM dispense_events   WHERE station_id=(SELECT id FROM _target)) AS dispense_events,
    (SELECT count(*) FROM gst_invoices      WHERE station_id=(SELECT id FROM _target)) AS gst_invoices,
    (SELECT count(*) FROM fuel_deliveries   WHERE station_id=(SELECT id FROM _target)) AS deliveries_kept,
    (SELECT count(*) FROM accounting_journal WHERE station_id=(SELECT id FROM _target)) AS delivery_journals_kept,
    (SELECT coalesce(string_agg(kind || ' ×' || n, ', '), 'none') FROM (
       SELECT kind, count(*) n FROM station_artifacts
        WHERE station_id=(SELECT id FROM _target) GROUP BY kind ORDER BY kind) k) AS photos_kept,
    (SELECT count(*) FROM pumps             WHERE station_id=(SELECT id FROM _target)) AS pumps_kept,
    (SELECT count(*) FROM nozzles           WHERE station_id=(SELECT id FROM _target)) AS nozzles_kept,
    (SELECT count(*) FROM tanks             WHERE station_id=(SELECT id FROM _target)) AS tanks_kept,
    (SELECT count(*) FROM fuel_prices       WHERE station_id=(SELECT id FROM _target)) AS prices_kept,
    (SELECT count(*) FROM station_users     WHERE station_id=(SELECT id FROM _target)) AS staff_kept,
    (SELECT string_agg(current_stock::text,' / ' ORDER BY tank_number) FROM tanks WHERE station_id=(SELECT id FROM _target)) AS tank_stock
) t;

COMMIT;
