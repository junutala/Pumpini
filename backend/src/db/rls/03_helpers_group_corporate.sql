-- Pumpini RLS — Phase B (helpers): group + corporate membership boundaries.
-- SECURITY DEFINER so policies can resolve membership without recursing into the
-- target tables' own RLS. Mirrors stationAccess.js (owner groups + canAccessCorporate).

create or replace function my_owner_groups() returns setof uuid
language sql stable security definer set search_path = public as $$
  select group_id from owner_group_members where user_id = app_current_user_id()
$$;

-- Portal credit customers (role=corporate) carry app.corporate_id instead of stations.
create or replace function app_current_corporate_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.corporate_id', true), '')::uuid
$$;

-- Corporate accounts the current user may access: owned by one of their stations,
-- linked to one of their stations, or (portal) the user's own corporate account.
create or replace function my_corporates() returns setof uuid
language sql stable security definer set search_path = public as $$
  select ca.id from corporate_accounts ca
   where ca.created_by_station in (select my_stations())
      or exists (select 1 from corporate_station_links csl
                  where csl.corporate_id = ca.id
                    and csl.station_id in (select my_stations()))
  union
  select app_current_corporate_id() where app_current_corporate_id() is not null
$$;

grant execute on function my_owner_groups(), app_current_corporate_id(), my_corporates() to app_authenticated;
