-- Pumpini RLS — Phase A (1/2): non-bypass role + identity helpers.
-- INERT to the live app: the app connects as the bypassrls owner role, so nothing
-- here changes app behaviour until the per-request cutover (SET LOCAL ROLE).
-- Idempotent. Reversible via 99_rollback.sql.

-- 1) The non-bypass role the app will SET LOCAL ROLE into, per request.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_authenticated') then
    create role app_authenticated nologin nobypassrls;
  end if;
end $$;

-- Let the app's connection role (e.g. postgres) switch into app_authenticated.
do $$
begin
  execute format('grant app_authenticated to %I', current_user);
end $$;

grant usage on schema public to app_authenticated;
grant select, insert, update, delete on all tables in schema public to app_authenticated;
grant usage, select on all sequences in schema public to app_authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to app_authenticated;
alter default privileges in schema public grant usage, select on sequences to app_authenticated;

-- 2) Identity, set per request via:  SET LOCAL app.user_id = '<uuid>';
--                                    SET LOCAL app.is_superadmin = 'true';  (admin only)
create or replace function app_current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_is_superadmin() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.is_superadmin', true) = 'true', false)
$$;

-- 3) The membership boundary — stations the current app user may access.
--    Mirrors backend/src/middleware/stationAccess.js getAccessibleStationIds().
--    SECURITY DEFINER (owned by the bypassrls owner) so it reads the membership
--    tables regardless of their own RLS — prevents recursion / self-lockout.
create or replace function my_stations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select station_id from station_users where user_id = app_current_user_id()
  union
  select sgm.station_id
    from owner_group_members ogm
    join station_groups        stg on stg.owner_group_id   = ogm.group_id
    join station_group_members sgm on sgm.station_group_id = stg.id
   where ogm.user_id = app_current_user_id()
$$;

grant execute on function app_current_user_id(), app_is_superadmin(), my_stations() to app_authenticated;
