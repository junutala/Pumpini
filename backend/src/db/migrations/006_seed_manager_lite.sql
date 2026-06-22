-- ─────────────────────────────────────────────────────────────
--  Seed a system 'Manager_lite' responsibility for every existing bunk so it is
--  ready to assign in /admin. is_system => a manager can't edit or delete it.
--
--  Manager_lite = the operational set (NO user-management for now — the platform
--  admin creates all users). Modules:
--    shifts.view (Start/End Shift), deliveries.view, stock.reconcile,
--    invoice.generate (Credit Invoices/Receipts/Notes), pettycash.manage,
--    deposits.manage, reports.view (Reports/Credit Reports), corporate.view
--    (Credit Customers). Bunk View shows regardless (no perm gate).
--
--  Idempotent: skips any bunk that already has a 'Manager_lite'.
--  Versioned: v1 2026-06-22.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE st RECORD; tid UUID;
BEGIN
  FOR st IN SELECT id FROM stations LOOP
    SELECT id INTO tid FROM role_templates WHERE station_id = st.id AND name = 'Manager_lite' LIMIT 1;
    IF tid IS NULL THEN
      INSERT INTO role_templates(station_id, name, description, is_system)
        VALUES(st.id, 'Manager_lite',
               'Operational manager — shifts, deliveries, stock reco, credit invoices, petty cash, deposits, reports, credit customers',
               TRUE)
        RETURNING id INTO tid;
      INSERT INTO template_permissions(template_id, module_code)
        SELECT tid, code FROM (VALUES
          ('shifts.view'),('deliveries.view'),('stock.reconcile'),('invoice.generate'),
          ('pettycash.manage'),('deposits.manage'),('reports.view'),('corporate.view')
        ) AS m(code)
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
