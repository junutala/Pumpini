-- 010_accounts_module.sql
-- Slice 1 of the OPTIONAL Accounts module: the per-outlet on/off switch and the two
-- access modules. Everything here is additive and idempotent — safe to re-run, and it
-- changes NO existing behaviour: the flag defaults OFF and nothing reads it until an
-- outlet turns it on. No new tables in this step, so there is no RLS policy to ship yet
-- (later slices that add tables MUST ship their RLS policy in the same block).

-- The switch. Mirrors products_enabled / self_settlement_enabled: one boolean on
-- station_settings, default FALSE so every existing outlet stays exactly as it is today.
ALTER TABLE public.station_settings
  ADD COLUMN IF NOT EXISTS accounts_enabled boolean DEFAULT false;

-- The two access modules used to gate the sidebar entry and the (future) route guards.
-- Owner already receives the whole catalogue via the 'ALL' sentinel; these let an
-- accountant/owner responsibility carry the module explicitly. Owner/accountant only —
-- the role-affinity guard in config/roles.js keeps them off forecourt roles.
INSERT INTO public.permission_modules(code, category, label) VALUES
  ('accounts.view',   'Accounts', 'View Accounts'),
  ('accounts.manage', 'Accounts', 'Manage Accounts')
ON CONFLICT (code) DO NOTHING;
