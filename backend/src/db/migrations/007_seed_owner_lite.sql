-- ─────────────────────────────────────────────────────────────
--  Seed a system 'Owner_lite' responsibility for every bunk — the "real owner"
--  (finance/oversight) view: NO operational screens. Assign this to an owner who
--  should only see the high-level picture; leave an owner on Default (role) to
--  get the whole catalog (the demo/testing owner).
--
--  Owner_lite modules:
--    group.view      (Group Dashboard — consolidated across the owner's bunks)
--    cash.integrity  (Cash Integrity)
--    ai_chat.use     (AI Assistant)
--  Bunk View (Dashboard) shows regardless — it has no perm gate.
--
--  NOTE: this only restricts an owner because of the matching middleware fix
--  (permissions.js): an OWNER with a responsibility assigned is now capped by it,
--  instead of fail-opening to the whole catalog. Owner with no responsibility is
--  unchanged (= ALL).
--
--  Idempotent: skips a bunk that already has 'Owner_lite'; tops up missing codes.
--  Versioned: v1 2026-06-22.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE st RECORD; tid UUID;
BEGIN
  FOR st IN SELECT id FROM stations LOOP
    SELECT id INTO tid FROM role_templates WHERE station_id = st.id AND name = 'Owner_lite' LIMIT 1;
    IF tid IS NULL THEN
      INSERT INTO role_templates(station_id, name, description, is_system)
        VALUES(st.id, 'Owner_lite',
               'Finance owner — group dashboard, bunk dashboard, cash integrity, AI chat (no operational screens)',
               TRUE)
        RETURNING id INTO tid;
    END IF;
    INSERT INTO template_permissions(template_id, module_code)
      SELECT tid, code FROM (VALUES
        ('group.view'),('cash.integrity'),('ai_chat.use')
      ) AS m(code)
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
