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
--  Versioned: v2 2026-06-22 (registers attendant.add in the catalog first).
-- ─────────────────────────────────────────────────────────────

-- Register the new permission module first — template_permissions.module_code
-- has a FK to permission_modules(code).
INSERT INTO permission_modules(code, category, label) VALUES
  ('attendant.add', 'Admin', 'Add Attendant')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE st RECORD; tid UUID;
BEGIN
  FOR st IN SELECT id FROM stations LOOP
    SELECT id INTO tid FROM role_templates WHERE station_id = st.id AND name = 'Manager_lite' LIMIT 1;
    IF tid IS NULL THEN
      INSERT INTO role_templates(station_id, name, description, is_system)
        VALUES(st.id, 'Manager_lite',
               'Operational manager — shifts, deliveries, stock reco, credit invoices, petty cash, deposits, reports, credit customers, add attendant',
               TRUE)
        RETURNING id INTO tid;
    END IF;
    -- Ensure all codes present (idempotent — also tops up attendant.add on a
    -- Manager_lite that was seeded before this column existed).
    INSERT INTO template_permissions(template_id, module_code)
      SELECT tid, code FROM (VALUES
        ('shifts.view'),('deliveries.view'),('stock.reconcile'),('invoice.generate'),
        ('pettycash.manage'),('deposits.manage'),('reports.view'),('corporate.view'),
        ('attendant.add')
      ) AS m(code)
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
