-- =====================================================================
-- Demo outlet seeding — clone real outlets onto the three demo outlets
-- =====================================================================
-- Run: 15-Aug-2026, against PRODUCTION (Supabase `Pumpini Project`).
--
-- WHY
--   Demos were being given on the three REAL outlets. This copies each real
--   outlet's structure and operating history onto a demo outlet so prospects
--   see a fully-populated system without ever seeing a real client's outlet,
--   staff or credit customers.
--
-- MAPPING
--   Kamala Filling Station        -> Dilsukhnagar Bunk
--   Highway Filling Station       -> Hayat Nagar Petrol Bunk
--   Adhoc Highway Filling Station -> Nagole Petrol Bunk
--
-- DECISIONS (owner, 15-Aug-2026)
--   * Staff and credit customers are ANONYMISED — demo-only rows with fake
--     names and reserved phone ranges. No real person is reachable from a
--     demo outlet. The sole exception is the owner: the real owner user
--     (Anjayya) maps to Pavan Kishore, who presents the demo.
--   * Original dates are PRESERVED. The sources are live, so the demo data
--     runs right up to today with no shifting required.
--   * The demo outlets are WIPED first, so the result is self-consistent.
--
-- SAFETY
--   * Every write is scoped to the three demo station ids. The wipe aborts if
--     a real outlet id ever appears in its target list.
--   * Rollback = `SELECT demo_clone.wipe_demo();` — it removes only demo rows.
--   * Real outlets were verified byte-for-byte unchanged afterwards against
--     the `demo_clone.baseline` snapshot taken before the run.
--
-- NOTE — this is DATA only. It creates no schema in `public` and needs no
-- migration. The helper `demo_clone` schema is kept so the run is repeatable.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS demo_clone;

-- ---------------------------------------------------------------------
-- 1. Id mapping + generic FK-remapping cloner
-- ---------------------------------------------------------------------
-- One map per (pair, source id). Because the SOURCE STATION ITSELF is put in
-- the map, `station_id` remaps for free like any other foreign key — there is
-- no special case for it anywhere below.
CREATE TABLE IF NOT EXISTS demo_clone.id_map (
  pair      text NOT NULL,
  src_id    uuid NOT NULL,
  dst_id    uuid NOT NULL,
  src_table text NOT NULL,
  PRIMARY KEY (pair, src_id)
);
CREATE INDEX IF NOT EXISTS id_map_src_table_idx ON demo_clone.id_map (src_table);

CREATE TABLE IF NOT EXISTS demo_clone.created_users      (user_id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS demo_clone.created_corporates (corp_id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS demo_clone.user_src (pair text NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (pair, user_id));
CREATE TABLE IF NOT EXISTS demo_clone.report   (pair text, seq int, tbl text, rows_copied int);

CREATE OR REPLACE FUNCTION demo_clone.mapped(p_pair text, p_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT dst_id FROM demo_clone.id_map WHERE pair = p_pair AND src_id = p_id
$$;

CREATE OR REPLACE FUNCTION demo_clone.mapped_or_self(p_pair text, p_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT dst_id FROM demo_clone.id_map WHERE pair = p_pair AND src_id = p_id), p_id)
$$;

-- Clone every row of p_table matching p_filter: allocate a fresh uuid for `id`
-- and rewrite EVERY uuid column through the pair's id_map.
--
-- The `mapped_or_self` fallback is deliberate: a uuid that is not in the map is
-- left as-is, so references to genuinely GLOBAL rows (accounting_accounts,
-- tank_calibration_charts) survive intact while everything outlet-specific is
-- redirected. Ids are allocated in a separate pass first, so SELF-referencing
-- columns (accounting_journal.reversed_by) resolve correctly.
--
-- Generated columns are never written — they recompute from the copied inputs.
CREATE OR REPLACE FUNCTION demo_clone.clone_table(
  p_pair text, p_table text, p_filter text, p_conflict text DEFAULT ''
) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  v_has_id boolean; v_cols text; v_sel text; v_n integer;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name=p_table AND column_name='id')
    INTO v_has_id;

  IF v_has_id THEN
    EXECUTE format(
      'INSERT INTO demo_clone.id_map(pair, src_id, dst_id, src_table)
       SELECT %L, t.id, gen_random_uuid(), %L FROM public.%I t WHERE %s
       ON CONFLICT (pair, src_id) DO NOTHING',
      p_pair, p_table, p_table, p_filter);
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         string_agg(
           CASE WHEN column_name = 'id'
                  THEN format('demo_clone.mapped(%L, t.id)', p_pair)
                WHEN data_type = 'uuid'
                  THEN format('demo_clone.mapped_or_self(%L, t.%I)', p_pair, column_name)
                ELSE 't.' || quote_ident(column_name)
           END, ', ' ORDER BY ordinal_position)
    INTO v_cols, v_sel
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=p_table
    AND is_generated <> 'ALWAYS'
    AND identity_generation IS NULL;

  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM public.%I t WHERE %s %s',
                 p_table, v_cols, v_sel, p_table, p_filter, p_conflict);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- ---------------------------------------------------------------------
-- 2. Wipe — the ONLY destructive step, and it is fenced
-- ---------------------------------------------------------------------
-- Deletes in reverse-FK order. Deliberately PRESERVES station_group_members
-- and station_subscriptions (the demo outlets' own group membership is what
-- separates them from the real ones — it must not be copied over).
CREATE OR REPLACE FUNCTION demo_clone.wipe_demo() RETURNS text
LANGUAGE plpgsql AS $wipe$
DECLARE
  demo uuid[] := ARRAY['d5429a43-999d-40cb-9be9-27694572bc1f',   -- Dilsukhnagar
                       '2d339e99-85e1-4b42-a2c0-f460ae10a960',   -- Hayat Nagar
                       'dce3a039-e314-4078-b621-a894242a1d3c']::uuid[]; -- Nagole
  real_ uuid[] := ARRAY['93ddaa38-8adc-40b9-8a9a-a69f92f657ee',  -- Kamala
                        '3b9d35cc-195a-458a-a0c3-51af6be9e73d',  -- Highway
                        'deb43fce-c294-4f9c-b634-e575383740a8']::uuid[]; -- Adhoc
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(demo) d WHERE d = ANY(real_)) THEN
    RAISE EXCEPTION 'ABORT: a real outlet id is present in the demo wipe list';
  END IF;
  IF (SELECT count(*) FROM stations WHERE id = ANY(demo)) <> 3 THEN
    RAISE EXCEPTION 'ABORT: expected exactly 3 demo stations';
  END IF;

  -- Demo-only staff: linked ONLY to demo outlets, not an owner, not in any
  -- owner group. The last two conditions protect Pavan and Madhavi.
  INSERT INTO demo_clone.created_users(user_id)
  SELECT u.id FROM users u
  WHERE u.role <> 'owner'
    AND EXISTS (SELECT 1 FROM station_users su WHERE su.user_id=u.id AND su.station_id = ANY(demo))
    AND NOT EXISTS (SELECT 1 FROM station_users su2 WHERE su2.user_id=u.id AND su2.station_id <> ALL(demo))
    AND NOT EXISTS (SELECT 1 FROM owner_group_members ogm WHERE ogm.user_id=u.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO demo_clone.created_corporates(corp_id)
  SELECT ca.id FROM corporate_accounts ca
  WHERE ca.created_by_station = ANY(demo)
    AND NOT EXISTS (SELECT 1 FROM corporate_station_links l WHERE l.corporate_id=ca.id AND l.station_id <> ALL(demo))
  ON CONFLICT DO NOTHING;

  DELETE FROM corporate_transactions WHERE dispense_event_id IN (SELECT id FROM dispense_events WHERE station_id = ANY(demo));
  DELETE FROM product_credit_note_items WHERE credit_note_id IN (SELECT id FROM product_credit_notes WHERE station_id = ANY(demo));
  DELETE FROM product_credit_notes    WHERE station_id = ANY(demo);
  DELETE FROM product_invoice_items   WHERE invoice_id IN (SELECT id FROM product_invoices WHERE station_id = ANY(demo));
  DELETE FROM product_invoices        WHERE station_id = ANY(demo);
  DELETE FROM product_stock_receipts  WHERE station_id = ANY(demo);
  DELETE FROM products                WHERE station_id = ANY(demo);
  DELETE FROM meter_photos            WHERE shift_id IN (SELECT id FROM shifts WHERE station_id = ANY(demo));
  DELETE FROM expenses                WHERE station_id = ANY(demo);
  DELETE FROM accounting_journal_lines WHERE station_id = ANY(demo);
  DELETE FROM accounting_journal      WHERE station_id = ANY(demo);
  DELETE FROM accounting_vendors      WHERE station_id = ANY(demo);
  DELETE FROM accounting_opening_balances WHERE station_id = ANY(demo);
  DELETE FROM petty_cash_entries      WHERE station_id = ANY(demo);
  DELETE FROM cash_deposits           WHERE station_id = ANY(demo);
  DELETE FROM credit_suspense_entries WHERE station_id = ANY(demo);
  DELETE FROM corporate_receipts      WHERE station_id = ANY(demo);
  DELETE FROM dispense_events         WHERE station_id = ANY(demo);
  DELETE FROM gst_invoices            WHERE station_id = ANY(demo);
  DELETE FROM fuel_test_draws         WHERE station_id = ANY(demo);
  DELETE FROM fuel_deliveries         WHERE station_id = ANY(demo);
  DELETE FROM delivery_invoices       WHERE station_id = ANY(demo);
  DELETE FROM tank_reconciliation     WHERE station_id = ANY(demo);
  DELETE FROM dipstick_readings       WHERE station_id = ANY(demo);
  DELETE FROM tank_cycles             WHERE station_id = ANY(demo);
  DELETE FROM nozzle_cycles           WHERE station_id = ANY(demo);
  DELETE FROM shift_reconciliation    WHERE shift_id IN (SELECT id FROM shifts WHERE station_id = ANY(demo));
  DELETE FROM cash_denominations      WHERE shift_id IN (SELECT id FROM shifts WHERE station_id = ANY(demo));
  DELETE FROM shift_attendant_nozzles WHERE shift_id IN (SELECT id FROM shifts WHERE station_id = ANY(demo));
  DELETE FROM shift_attendants        WHERE shift_id IN (SELECT id FROM shifts WHERE station_id = ANY(demo));
  DELETE FROM shift_attendance        WHERE station_id = ANY(demo);
  DELETE FROM shifts                  WHERE station_id = ANY(demo);
  DELETE FROM credit_slip_books       WHERE station_id = ANY(demo);
  DELETE FROM corporate_station_links WHERE station_id = ANY(demo);
  DELETE FROM rfid_tags               WHERE station_id = ANY(demo);
  DELETE FROM alerts                  WHERE station_id = ANY(demo);
  DELETE FROM attendance              WHERE station_id = ANY(demo);
  DELETE FROM fixed_assets            WHERE station_id = ANY(demo);
  DELETE FROM tally_ledger_map        WHERE station_id = ANY(demo);
  DELETE FROM nozzles                 WHERE station_id = ANY(demo);
  DELETE FROM pumps                   WHERE station_id = ANY(demo);
  DELETE FROM tanks                   WHERE station_id = ANY(demo);
  DELETE FROM fuel_prices             WHERE station_id = ANY(demo);
  DELETE FROM station_artifacts       WHERE station_id = ANY(demo);
  DELETE FROM user_role_assignments   WHERE station_id = ANY(demo);
  DELETE FROM role_templates          WHERE station_id = ANY(demo);
  DELETE FROM shift_definitions       WHERE station_id = ANY(demo);
  DELETE FROM product_invoice_seq     WHERE station_id = ANY(demo);
  DELETE FROM product_cn_seq          WHERE station_id = ANY(demo);
  DELETE FROM station_users           WHERE station_id = ANY(demo);
  DELETE FROM station_settings        WHERE station_id = ANY(demo);

  DELETE FROM audit_log  WHERE user_id IN (SELECT user_id FROM demo_clone.created_users);
  DELETE FROM attendance WHERE user_id IN (SELECT user_id FROM demo_clone.created_users);
  DELETE FROM users      WHERE id      IN (SELECT user_id FROM demo_clone.created_users);
  DELETE FROM demo_clone.created_users;

  DELETE FROM corporate_drivers WHERE corporate_id IN (SELECT corp_id FROM demo_clone.created_corporates);
  DELETE FROM corporate_duplicate_flags WHERE corp1_id IN (SELECT corp_id FROM demo_clone.created_corporates)
                                           OR corp2_id IN (SELECT corp_id FROM demo_clone.created_corporates);
  DELETE FROM corporate_accounts WHERE id IN (SELECT corp_id FROM demo_clone.created_corporates);
  DELETE FROM demo_clone.created_corporates;

  RETURN 'demo outlets wiped';
END
$wipe$;

-- ---------------------------------------------------------------------
-- 3. Collect every user a source outlet references
-- ---------------------------------------------------------------------
-- Station-scoped tables are discovered DYNAMICALLY from FK metadata, so no
-- reference column can be forgotten as the schema grows. Shift-scoped children
-- have no station_id of their own and are added explicitly.
CREATE OR REPLACE FUNCTION demo_clone.collect_user_refs(p_pair text, p_src uuid)
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE r record; v_n integer;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f'
      AND c.confrelid = 'public.users'::regclass
      AND EXISTS (SELECT 1 FROM information_schema.columns ic
                   WHERE ic.table_schema='public' AND ic.table_name = c.conrelid::regclass::text
                     AND ic.column_name = 'station_id')
  LOOP
    EXECUTE format(
      'INSERT INTO demo_clone.user_src(pair, user_id)
       SELECT DISTINCT %L, t.%I FROM public.%I t
        WHERE t.station_id = %L AND t.%I IS NOT NULL
       ON CONFLICT DO NOTHING', p_pair, r.col, r.tbl, p_src, r.col);
  END LOOP;

  INSERT INTO demo_clone.user_src(pair, user_id)
  SELECT DISTINCT p_pair, x FROM (
    SELECT sa.attendant_id AS x FROM shift_attendants sa JOIN shifts s ON s.id=sa.shift_id WHERE s.station_id=p_src
    UNION SELECT sa.shift_ended_by FROM shift_attendants sa JOIN shifts s ON s.id=sa.shift_id WHERE s.station_id=p_src
    UNION SELECT san.attendant_id FROM shift_attendant_nozzles san JOIN shifts s ON s.id=san.shift_id WHERE s.station_id=p_src
    UNION SELECT cd.attendant_id FROM cash_denominations cd JOIN shifts s ON s.id=cd.shift_id WHERE s.station_id=p_src
    UNION SELECT sr.attendant_id FROM shift_reconciliation sr JOIN shifts s ON s.id=sr.shift_id WHERE s.station_id=p_src
    UNION SELECT sr.manager_id  FROM shift_reconciliation sr JOIN shifts s ON s.id=sr.shift_id WHERE s.station_id=p_src
    UNION SELECT mp.recorded_by FROM meter_photos mp JOIN shifts s ON s.id=mp.shift_id WHERE s.station_id=p_src
  ) q WHERE x IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO demo_clone.user_src(pair, user_id)
  SELECT p_pair, su.user_id FROM station_users su WHERE su.station_id = p_src
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_n FROM demo_clone.user_src WHERE pair = p_pair;
  RETURN v_n;
END
$fn$;

-- ---------------------------------------------------------------------
-- 4. Anonymised identities
-- ---------------------------------------------------------------------
-- Demo staff get reserved phones +9199000xxxxx, demo corporates +9198000xxxxx.
-- Password for every demo staff login: Demo@1234
CREATE OR REPLACE FUNCTION demo_clone.seed_identities() RETURNS text
LANGUAGE plpgsql AS $seed$
DECLARE
  pairs text[][] := ARRAY[
    ARRAY['p1','93ddaa38-8adc-40b9-8a9a-a69f92f657ee','d5429a43-999d-40cb-9be9-27694572bc1f'],
    ARRAY['p2','3b9d35cc-195a-458a-a0c3-51af6be9e73d','2d339e99-85e1-4b42-a2c0-f460ae10a960'],
    ARRAY['p3','deb43fce-c294-4f9c-b634-e575383740a8','dce3a039-e314-4078-b621-a894242a1d3c']];
  names text[] := ARRAY[
    'Ravi Kumar','Srinivas Reddy','Mahesh Goud','Naveen Kumar','Praveen Rao',
    'Anil Kumar','Suresh Goud','Kiran Kumar','Venkatesh Naidu','Rajesh Yadav',
    'Santosh Kumar','Ramesh Naik','Prakash Rao','Sai Teja','Manohar Reddy',
    'Bhaskar Rao','Krishna Murthy','Rajender Prasad','Narsimha Rao','Lingaiah G',
    'Yadagiri M','Balaraju K','Shiva Kumar','Mallesh Goud','Raju Naik',
    'Ganesh Reddy','Vinod Kumar','Sudhakar Rao','Chandra Sekhar','Ashok Kumar',
    'Nagaraju P','Srikanth B','Vamshi Krishna','Karthik Reddy','Dinesh Kumar',
    'Sampath Rao','Upender Goud','Rakesh Naik','Jagan Mohan','Harish Kumar'];
  corps text[] := ARRAY[
    'Sri Sai Logistics','Deccan Transports','Krishna Travels','Balaji Roadways',
    'Telangana Cargo Movers','Orbit Couriers','Sunrise Fleet Services','Metro Cabs',
    'Green Valley Agro','Pioneer Constructions','Nova Cargo Lines','Sapphire Tours',
    'Godavari Carriers','Charminar Transports','Kakatiya Roadlines','Vijaya Enterprises',
    'Anantha Logistics','Bhagyanagar Movers','Rainbow Travels','Sri Lakshmi Traders',
    'Eagle Express','Prime Haulers','Sagar Transports','Nandi Carriers','Vaishnavi Cabs',
    'Mahalaxmi Freight','Sri Venkateswara Tours','Aditya Roadways','Konark Carriers','Surya Logistics'];
  demo_owner uuid := '9652d696-9375-45a5-9945-fa9084bb78f1';  -- Pavan Kishore
  pw text; useq int := 0; cseq int := 0; p text[]; r record; new_id uuid; nm text;
BEGIN
  pw := crypt('Demo@1234', gen_salt('bf', 12));

  FOREACH p SLICE 1 IN ARRAY pairs LOOP
    -- the station itself: this is what makes station_id remap for free
    INSERT INTO demo_clone.id_map(pair, src_id, dst_id, src_table)
    VALUES (p[1], p[2]::uuid, p[3]::uuid, 'stations') ON CONFLICT (pair, src_id) DO NOTHING;

    FOR r IN SELECT u.* FROM demo_clone.user_src us JOIN users u ON u.id = us.user_id
             WHERE us.pair = p[1] ORDER BY u.role, u.name
    LOOP
      IF r.role = 'owner' THEN
        -- the demo outlets are presented by their real owner; no fake owner
        INSERT INTO demo_clone.id_map(pair, src_id, dst_id, src_table)
        VALUES (p[1], r.id, demo_owner, 'users') ON CONFLICT (pair, src_id) DO NOTHING;
      ELSE
        useq := useq + 1;
        nm := names[((useq - 1) % array_length(names,1)) + 1]
              || CASE WHEN useq > array_length(names,1)
                      THEN ' ' || ((useq - 1) / array_length(names,1) + 1)::text ELSE '' END;
        new_id := gen_random_uuid();
        INSERT INTO users(id, name, phone, email, password_hash, role, language,
                          is_active, created_at, updated_at, corporate_id,
                          must_change_password, token_version, end_date)
        VALUES (new_id, nm, '+9199' || lpad(useq::text, 8, '0'), NULL, pw, r.role,
                r.language, r.is_active, r.created_at, r.updated_at, NULL, FALSE, 0, r.end_date);
        INSERT INTO demo_clone.created_users(user_id) VALUES (new_id) ON CONFLICT DO NOTHING;
        INSERT INTO demo_clone.id_map(pair, src_id, dst_id, src_table)
        VALUES (p[1], r.id, new_id, 'users') ON CONFLICT (pair, src_id) DO NOTHING;
      END IF;
    END LOOP;

    FOR r IN SELECT ca.* FROM corporate_accounts ca WHERE ca.id IN (
        SELECT corporate_id FROM corporate_station_links WHERE station_id = p[2]::uuid
        UNION SELECT corporate_id FROM dispense_events    WHERE station_id = p[2]::uuid AND corporate_id IS NOT NULL
        UNION SELECT corporate_id FROM gst_invoices       WHERE station_id = p[2]::uuid AND corporate_id IS NOT NULL
        UNION SELECT corporate_id FROM corporate_receipts WHERE station_id = p[2]::uuid AND corporate_id IS NOT NULL
        UNION SELECT corporate_id FROM credit_slip_books  WHERE station_id = p[2]::uuid AND corporate_id IS NOT NULL
        UNION SELECT customer_id  FROM product_invoices   WHERE station_id = p[2]::uuid AND customer_id  IS NOT NULL
      ) ORDER BY ca.company_name
    LOOP
      cseq := cseq + 1;
      nm := corps[((cseq - 1) % array_length(corps,1)) + 1]
            || CASE WHEN cseq > array_length(corps,1)
                    THEN ' ' || ((cseq - 1) / array_length(corps,1) + 1)::text ELSE '' END;
      new_id := gen_random_uuid();
      INSERT INTO corporate_accounts(id, company_name, gst_number, contact_person,
             contact_phone, contact_email, credit_limit, current_outstanding,
             billing_cycle, is_active, created_at, merged_into_id, gstn, pan,
             address, email, created_by_station)
      VALUES (new_id, nm, NULL, names[((cseq - 1) % array_length(names,1)) + 1],
              '+9198' || lpad(cseq::text, 8, '0'), NULL,
              r.credit_limit, r.current_outstanding, r.billing_cycle, r.is_active,
              r.created_at, NULL, NULL, NULL, 'Hyderabad', NULL, p[3]::uuid);
      INSERT INTO demo_clone.created_corporates(corp_id) VALUES (new_id) ON CONFLICT DO NOTHING;
      INSERT INTO demo_clone.id_map(pair, src_id, dst_id, src_table)
      VALUES (p[1], r.id, new_id, 'corporate_accounts') ON CONFLICT (pair, src_id) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN format('%s demo staff, %s demo corporates', useq, cseq);
END
$seed$;

-- ---------------------------------------------------------------------
-- 5. The copy — ~50 tables in dependency order
-- ---------------------------------------------------------------------
-- Order is load-bearing. Notable constraints encoded below:
--   pumps before nozzles; tanks before nozzles
--   station_artifacts early (pumps/dipsticks/shift photos reference it)
--   shift_reconciliation AFTER cash_denominations (denomination_id)
--   nozzle_cycles AFTER shift_reconciliation (settlement_id)
--   gst_invoices + credit_slip_books BEFORE dispense_events
--   accounting_journal BEFORE accounting_journal_lines and expenses
CREATE OR REPLACE FUNCTION demo_clone.run_pair(p_pair text, p_src uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  spec text[][] := ARRAY[
    ARRAY['role_templates','station','ON CONFLICT DO NOTHING'],
    ARRAY['shift_definitions','station',''],
    ARRAY['fuel_prices','station',''],
    ARRAY['station_artifacts','station',''],
    ARRAY['tanks','station',''],
    ARRAY['pumps','station',''],
    ARRAY['nozzles','station',''],
    ARRAY['products','station',''],
    ARRAY['accounting_vendors','station',''],
    ARRAY['accounting_opening_balances','station',''],
    ARRAY['fixed_assets','station',''],
    ARRAY['rfid_tags','station',''],
    ARRAY['tally_ledger_map','station',''],
    ARRAY['alerts','station',''],
    ARRAY['attendance','station',''],
    ARRAY['product_invoice_seq','station',''],
    ARRAY['product_cn_seq','station',''],
    ARRAY['station_users','station','ON CONFLICT DO NOTHING'],
    ARRAY['user_role_assignments','station','ON CONFLICT DO NOTHING'],
    ARRAY['corporate_station_links','station','ON CONFLICT DO NOTHING'],
    ARRAY['corporate_drivers','corp',''],
    ARRAY['credit_slip_books','station',''],
    ARRAY['station_settings','station',''],
    ARRAY['shifts','station',''],
    ARRAY['shift_attendance','station',''],
    ARRAY['shift_attendants','shift',''],
    ARRAY['shift_attendant_nozzles','shift',''],
    ARRAY['cash_denominations','shift',''],
    ARRAY['shift_reconciliation','shift',''],
    ARRAY['nozzle_cycles','station',''],
    ARRAY['tank_cycles','station',''],
    ARRAY['dipstick_readings','station',''],
    ARRAY['tank_reconciliation','station',''],
    ARRAY['delivery_invoices','station',''],
    ARRAY['fuel_deliveries','station',''],
    ARRAY['fuel_test_draws','station',''],
    ARRAY['gst_invoices','station',''],
    ARRAY['dispense_events','station',''],
    ARRAY['corporate_receipts','station',''],
    ARRAY['corporate_transactions','dispense',''],
    ARRAY['credit_suspense_entries','station',''],
    ARRAY['cash_deposits','station',''],
    ARRAY['petty_cash_entries','station',''],
    ARRAY['accounting_journal','station',''],
    ARRAY['accounting_journal_lines','station',''],
    ARRAY['expenses','station',''],
    ARRAY['meter_photos','shift',''],
    ARRAY['product_invoices','station',''],
    ARRAY['product_invoice_items','invoice',''],
    ARRAY['product_credit_notes','station',''],
    ARRAY['product_credit_note_items','cnote',''],
    ARRAY['product_stock_receipts','station','']
  ];
  s text[]; f text; n int; i int := 0;
BEGIN
  FOREACH s SLICE 1 IN ARRAY spec LOOP
    i := i + 1;
    f := CASE s[2]
      WHEN 'station'  THEN format('t.station_id = %L', p_src)
      WHEN 'shift'    THEN format('t.shift_id IN (SELECT src_id FROM demo_clone.id_map WHERE pair=%L AND src_table=''shifts'')', p_pair)
      WHEN 'corp'     THEN format('t.corporate_id IN (SELECT src_id FROM demo_clone.id_map WHERE pair=%L AND src_table=''corporate_accounts'')', p_pair)
      WHEN 'dispense' THEN format('t.dispense_event_id IN (SELECT src_id FROM demo_clone.id_map WHERE pair=%L AND src_table=''dispense_events'')', p_pair)
      WHEN 'invoice'  THEN format('t.invoice_id IN (SELECT src_id FROM demo_clone.id_map WHERE pair=%L AND src_table=''product_invoices'')', p_pair)
      WHEN 'cnote'    THEN format('t.credit_note_id IN (SELECT src_id FROM demo_clone.id_map WHERE pair=%L AND src_table=''product_credit_notes'')', p_pair)
    END;
    n := demo_clone.clone_table(p_pair, s[1], f, s[3]);
    INSERT INTO demo_clone.report VALUES (p_pair, i, s[1], n);
  END LOOP;
END
$fn$;

-- ---------------------------------------------------------------------
-- 6. Drive it
-- ---------------------------------------------------------------------
SELECT demo_clone.wipe_demo();

TRUNCATE demo_clone.id_map;
TRUNCATE demo_clone.user_src;
TRUNCATE demo_clone.report;

SELECT demo_clone.collect_user_refs('p1','93ddaa38-8adc-40b9-8a9a-a69f92f657ee');
SELECT demo_clone.collect_user_refs('p2','3b9d35cc-195a-458a-a0c3-51af6be9e73d');
SELECT demo_clone.collect_user_refs('p3','deb43fce-c294-4f9c-b634-e575383740a8');
SELECT demo_clone.seed_identities();

SELECT demo_clone.run_pair('p1','93ddaa38-8adc-40b9-8a9a-a69f92f657ee');
SELECT demo_clone.run_pair('p2','3b9d35cc-195a-458a-a0c3-51af6be9e73d');
SELECT demo_clone.run_pair('p3','deb43fce-c294-4f9c-b634-e575383740a8');

-- ---------------------------------------------------------------------
-- 7. Post-fix
-- ---------------------------------------------------------------------
DO $post$
DECLARE
  demo uuid[] := ARRAY['d5429a43-999d-40cb-9be9-27694572bc1f',
                       '2d339e99-85e1-4b42-a2c0-f460ae10a960',
                       'dce3a039-e314-4078-b621-a894242a1d3c']::uuid[];
  demo_group uuid := '69953132-ca7c-400e-892a-e343e95c502d';  -- Pavan Group
BEGIN
  -- All three demo outlets in the DEMO station group (the real three live in
  -- Anjayya's group). Dilsukhnagar was in no group at all before this.
  INSERT INTO station_group_members(station_group_id, station_id)
  SELECT demo_group, d FROM unnest(demo) d ON CONFLICT DO NOTHING;

  -- Keep the copied OPERATIONAL settings, but strip the source outlet's
  -- identity and geo-location: a Nalgonda geo-fence on a Hyderabad demo
  -- outlet would be wrong, and the GSTN/PAN are not ours to display.
  UPDATE station_settings
     SET gstn=NULL, pan=NULL, tan=NULL, address=NULL, city=NULL, state=NULL,
         pincode=NULL, owner_whatsapp=NULL, owner_email=NULL,
         latitude=NULL, longitude=NULL, geo_fence_enabled=FALSE,
         tally_company_name=NULL
   WHERE station_id = ANY(demo);

  INSERT INTO station_users(station_id, user_id)
  SELECT d, u FROM unnest(demo) d,
    unnest(ARRAY['9652d696-9375-45a5-9945-fa9084bb78f1',
                 '57910b96-a65b-4669-b02b-5e46d56b45a2']::uuid[]) u
  ON CONFLICT DO NOTHING;
END
$post$;

-- ---------------------------------------------------------------------
-- 8. Repoint polymorphic references
-- ---------------------------------------------------------------------
-- station_artifacts.(entity_type, entity_id) is a POLYMORPHIC reference with no
-- FK constraint. The generic cloner remaps a uuid only if it is already in the
-- id_map, and station_artifacts is copied at position 4 — before pumps (6) and
-- long before shift_attendants (26) — so entity_id had nothing to resolve
-- against and silently kept the SOURCE outlet's id.
--
-- Caught on 16-Aug: all 9 demo slip artifacts still pointed at real outlets'
-- pumps. The FK-driven leak scan in the verify script could not see it, because
-- there is no constraint to walk. Any future polymorphic column needs the same
-- treatment — run this AFTER every table is cloned, when the map is complete.
DO $poly$
DECLARE
  pairs text[][] := ARRAY[
    ARRAY['p1','d5429a43-999d-40cb-9be9-27694572bc1f'],
    ARRAY['p2','2d339e99-85e1-4b42-a2c0-f460ae10a960'],
    ARRAY['p3','dce3a039-e314-4078-b621-a894242a1d3c']];
  p text[];
BEGIN
  FOREACH p SLICE 1 IN ARRAY pairs LOOP
    UPDATE station_artifacts a
       SET entity_id = m.dst_id
      FROM demo_clone.id_map m
     WHERE a.station_id = p[2]::uuid
       AND m.pair = p[1]
       AND m.src_id = a.entity_id;
  END LOOP;
END
$poly$;
