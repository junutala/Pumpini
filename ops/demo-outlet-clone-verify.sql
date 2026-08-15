-- =====================================================================
-- Verification for ops/demo-outlet-clone.sql
-- =====================================================================
-- Run after the clone. Every query below must return ZERO rows.
-- All three returned zero on the 15-Aug-2026 production run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) Identity leak + cross-outlet contamination scan
-- ---------------------------------------------------------------------
-- Walks FK metadata rather than a hand-written list, so a column added later
-- is covered automatically.
--   identity-leak            a demo row points at a REAL person or customer
--   identity-leak-shiftchild same, via shift-scoped children
--   cross-station            a demo row's FK still points back at the source
DROP TABLE IF EXISTS demo_clone.findings;
CREATE TABLE demo_clone.findings (check_kind text, child text, col text, parent text, bad_rows bigint);

DO $verify$
DECLARE
  demo text := '''d5429a43-999d-40cb-9be9-27694572bc1f'',''2d339e99-85e1-4b42-a2c0-f460ae10a960'',''dce3a039-e314-4078-b621-a894242a1d3c''';
  -- the two owner logins we deliberately reused (Pavan, Madhavi)
  owners text := '''9652d696-9375-45a5-9945-fa9084bb78f1'',''57910b96-a65b-4669-b02b-5e46d56b45a2''';
  r record; n bigint;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.connamespace='public'::regnamespace AND c.contype='f'
      AND c.confrelid IN ('public.users'::regclass,'public.corporate_accounts'::regclass)
      AND EXISTS (SELECT 1 FROM information_schema.columns ic
                   WHERE ic.table_schema='public' AND ic.table_name=c.conrelid::regclass::text
                     AND ic.column_name='station_id')
  LOOP
    IF r.parent = 'users' THEN
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.station_id IN (%s) AND t.%I IS NOT NULL
                        AND t.%I NOT IN (SELECT user_id FROM demo_clone.created_users)
                        AND t.%I NOT IN (%s)', r.tbl, demo, r.col, r.col, r.col, owners) INTO n;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.station_id IN (%s) AND t.%I IS NOT NULL
                        AND t.%I NOT IN (SELECT corp_id FROM demo_clone.created_corporates)',
                     r.tbl, demo, r.col, r.col) INTO n;
    END IF;
    IF n > 0 THEN INSERT INTO demo_clone.findings VALUES ('identity-leak', r.tbl, r.col, r.parent, n); END IF;
  END LOOP;

  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.connamespace='public'::regnamespace AND c.contype='f'
      AND c.confrelid IN ('public.users'::regclass,'public.corporate_accounts'::regclass)
      AND EXISTS (SELECT 1 FROM information_schema.columns ic
                   WHERE ic.table_schema='public' AND ic.table_name=c.conrelid::regclass::text
                     AND ic.column_name='shift_id')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I t JOIN shifts s ON s.id=t.shift_id
                     WHERE s.station_id IN (%s) AND t.%I IS NOT NULL
                       AND t.%I NOT IN (SELECT user_id FROM demo_clone.created_users)
                       AND t.%I NOT IN (%s)', r.tbl, demo, r.col, r.col, r.col, owners) INTO n;
    IF n > 0 THEN INSERT INTO demo_clone.findings VALUES ('identity-leak-shiftchild', r.tbl, r.col, r.parent, n); END IF;
  END LOOP;

  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.connamespace='public'::regnamespace AND c.contype='f' AND c.confrelid <> c.conrelid
      AND EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema='public'
                   AND ic.table_name=c.conrelid::regclass::text AND ic.column_name='station_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns ip WHERE ip.table_schema='public'
                   AND ip.table_name=c.confrelid::regclass::text AND ip.column_name='station_id')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I t JOIN public.%I p ON p.id = t.%I
                     WHERE t.station_id IN (%s) AND p.station_id <> t.station_id',
                   r.tbl, r.parent, r.col, demo) INTO n;
    IF n > 0 THEN INSERT INTO demo_clone.findings VALUES ('cross-station', r.tbl, r.col, r.parent, n); END IF;
  END LOOP;

  EXECUTE format('SELECT count(*) FROM shift_attendant_nozzles san
                    JOIN shifts s ON s.id=san.shift_id JOIN nozzles nz ON nz.id=san.nozzle_id
                   WHERE s.station_id IN (%s) AND nz.station_id <> s.station_id', demo) INTO n;
  IF n > 0 THEN INSERT INTO demo_clone.findings VALUES ('cross-station','shift_attendant_nozzles','nozzle_id','nozzles',n); END IF;

  EXECUTE format('SELECT count(*) FROM shift_attendants sa
                    JOIN shifts s ON s.id=sa.shift_id JOIN nozzles nz ON nz.id=sa.nozzle_id
                   WHERE s.station_id IN (%s) AND nz.station_id <> s.station_id', demo) INTO n;
  IF n > 0 THEN INSERT INTO demo_clone.findings VALUES ('cross-station','shift_attendants','nozzle_id','nozzles',n); END IF;
END
$verify$;

SELECT * FROM demo_clone.findings ORDER BY check_kind, child, col;   -- must be empty


-- ---------------------------------------------------------------------
-- (2) Meter integrity on the one meter store that counts
-- ---------------------------------------------------------------------
-- shift_attendant_nozzles is the single meter store (CLAUDE.md, 01-Aug-2026).
-- No negative and no impossible movement may exist in the demo copy.
SELECT s.name, count(*) AS bad_legs
FROM shift_attendant_nozzles san
JOIN shifts sh ON sh.id = san.shift_id
JOIN stations s ON s.id = sh.station_id
WHERE sh.station_id IN ('d5429a43-999d-40cb-9be9-27694572bc1f',
                        '2d339e99-85e1-4b42-a2c0-f460ae10a960',
                        'dce3a039-e314-4078-b621-a894242a1d3c')
  AND (san.closing_reading < san.opening_reading
       OR san.closing_reading - san.opening_reading > 100000)
GROUP BY 1;                                                          -- must be empty


-- ---------------------------------------------------------------------
-- (3) Real outlets untouched
-- ---------------------------------------------------------------------
-- Compares against demo_clone.baseline, captured BEFORE the run.
WITH now_counts AS (
  SELECT 'shifts' AS tbl, station_id, count(*) n FROM public.shifts GROUP BY 2
  UNION ALL SELECT 'dispense_events', station_id, count(*) FROM public.dispense_events GROUP BY 2
  UNION ALL SELECT 'nozzles', station_id, count(*) FROM public.nozzles GROUP BY 2
  UNION ALL SELECT 'tanks', station_id, count(*) FROM public.tanks GROUP BY 2
  UNION ALL SELECT 'station_users', station_id, count(*) FROM public.station_users GROUP BY 2
  UNION ALL SELECT 'gst_invoices', station_id, count(*) FROM public.gst_invoices GROUP BY 2
  UNION ALL SELECT 'accounting_journal', station_id, count(*) FROM public.accounting_journal GROUP BY 2
)
SELECT s.name, b.tbl, b.n AS before_n, COALESCE(c.n,0) AS after_n
FROM demo_clone.baseline b
JOIN stations s ON s.id = b.station_id
LEFT JOIN now_counts c ON c.tbl = b.tbl AND c.station_id = b.station_id
WHERE b.station_id IN ('93ddaa38-8adc-40b9-8a9a-a69f92f657ee',
                       '3b9d35cc-195a-458a-a0c3-51af6be9e73d',
                       'deb43fce-c294-4f9c-b634-e575383740a8')
  AND b.tbl IN (SELECT DISTINCT tbl FROM now_counts)
  AND b.n IS DISTINCT FROM COALESCE(c.n,0);                          -- must be empty
