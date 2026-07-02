-- Run on STAGING ONLY. Empties every public table so prod data can be loaded
-- without primary-key clashes. CASCADE handles foreign-key order.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename);
  END LOOP;
END $$;
