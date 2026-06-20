-- Pumpini RLS — PANIC BUTTON. Reverts every table to the pre-RLS (app-layer-only)
-- state by disabling RLS and dropping the isolation policies. Safe to run anytime.
-- The role + helper functions are harmless to leave; uncomment the tail to drop them too.

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' and rowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', t || '_station_isolation', t);
    execute format('alter table public.%I disable row level security', t);
  end loop;
end $$;

-- Full teardown (optional):
-- drop function if exists my_stations();
-- drop function if exists app_current_user_id();
-- drop function if exists app_is_superadmin();
-- do $$ begin execute format('revoke app_authenticated from %I', current_user); exception when others then null; end $$;
-- drop role if exists app_authenticated;
