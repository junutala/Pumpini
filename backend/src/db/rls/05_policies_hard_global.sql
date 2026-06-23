-- Pumpini RLS — Phase B (hard + global): corporate family, identity/group tables,
-- the stations root, and platform catalogs. Idempotent + reversible.
--
-- ⚠️ P2 CUTOVER NOTE: the auth path (login, token refresh, passkey verify) runs
-- BEFORE an identity exists, so it MUST run as the bypass owner role — NOT as
-- app_authenticated — or the users/user_passkeys policies below return 0 rows and
-- login breaks. The cutover middleware must exempt those endpoints.

-- ── stations root: a user sees only their own stations ───────────────
alter table public.stations enable row level security;
drop policy if exists stations_isolation on public.stations;
create policy stations_isolation on public.stations
  using      (id in (select my_stations()) or app_is_superadmin())
  with check (id in (select my_stations()) or app_is_superadmin());

-- ── corporate family (scoped via my_corporates) ──────────────────────
alter table public.corporate_accounts enable row level security;
drop policy if exists corporate_accounts_isolation on public.corporate_accounts;
-- WITH CHECK must test created_by_station DIRECTLY on the new row: on INSERT the
-- just-inserted id is not yet visible to my_corporates() (which re-selects this
-- table), and the station link is created only afterwards — so an id-based check
-- can never pass for a new account. created_by_station is set to the creator's
-- own station (app-layer canAccessStation already verifies it), so this both
-- unblocks creation and forbids stamping an account to a foreign station.
create policy corporate_accounts_isolation on public.corporate_accounts
  using      (id in (select my_corporates()) or app_is_superadmin())
  with check (created_by_station in (select my_stations())
              or id in (select my_corporates())
              or app_is_superadmin());

alter table public.corporate_drivers enable row level security;
drop policy if exists corporate_drivers_isolation on public.corporate_drivers;
create policy corporate_drivers_isolation on public.corporate_drivers
  using      (corporate_id in (select my_corporates()) or app_is_superadmin())
  with check (corporate_id in (select my_corporates()) or app_is_superadmin());

alter table public.corporate_transactions enable row level security;
drop policy if exists corporate_transactions_isolation on public.corporate_transactions;
create policy corporate_transactions_isolation on public.corporate_transactions
  using      (corporate_id in (select my_corporates()) or app_is_superadmin())
  with check (corporate_id in (select my_corporates()) or app_is_superadmin());

alter table public.corporate_duplicate_flags enable row level security;
drop policy if exists corporate_duplicate_flags_isolation on public.corporate_duplicate_flags;
create policy corporate_duplicate_flags_isolation on public.corporate_duplicate_flags
  using      (corp1_id in (select my_corporates()) or corp2_id in (select my_corporates()) or app_is_superadmin())
  with check (corp1_id in (select my_corporates()) or corp2_id in (select my_corporates()) or app_is_superadmin());

-- ── identity / group tables ──────────────────────────────────────────
-- users: readable to self, to staff sharing one of your stations, to the owning
-- corporate (portal), or superadmin. Writes left to the app-layer guards (canManageUser)
-- so user-creation flows that insert station_users AFTER the user row don't break.
alter table public.users enable row level security;
drop policy if exists users_isolation on public.users;
create policy users_isolation on public.users
  using (
        id = app_current_user_id()
     or app_is_superadmin()
     or exists (select 1 from public.station_users su where su.user_id = users.id and su.station_id in (select my_stations()))
     or (corporate_id is not null and corporate_id in (select my_corporates()))
  )
  with check (true);

alter table public.owner_group_members enable row level security;
drop policy if exists owner_group_members_isolation on public.owner_group_members;
create policy owner_group_members_isolation on public.owner_group_members
  using      (group_id in (select my_owner_groups()) or user_id = app_current_user_id() or app_is_superadmin())
  with check (true);

alter table public.owner_groups enable row level security;
drop policy if exists owner_groups_isolation on public.owner_groups;
create policy owner_groups_isolation on public.owner_groups
  using      (id in (select my_owner_groups()) or app_is_superadmin())
  with check (app_is_superadmin());

alter table public.station_groups enable row level security;
drop policy if exists station_groups_isolation on public.station_groups;
create policy station_groups_isolation on public.station_groups
  using      (owner_group_id in (select my_owner_groups()) or app_is_superadmin())
  with check (app_is_superadmin());

alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_isolation on public.subscriptions;
create policy subscriptions_isolation on public.subscriptions
  using      (owner_group_id in (select my_owner_groups()) or app_is_superadmin())
  with check (app_is_superadmin());

-- passkeys: personal to the user.
alter table public.user_passkeys enable row level security;
drop policy if exists user_passkeys_isolation on public.user_passkeys;
create policy user_passkeys_isolation on public.user_passkeys
  using      (user_id = app_current_user_id() or app_is_superadmin())
  with check (user_id = app_current_user_id());

-- audit_log: each user sees their own actions; superadmin sees all. Writes pass
-- (the app writes audit rows as the acting user).
alter table public.audit_log enable row level security;
drop policy if exists audit_log_isolation on public.audit_log;
create policy audit_log_isolation on public.audit_log
  using      (user_id = app_current_user_id() or app_is_superadmin())
  with check (true);

-- ── platform catalogs ────────────────────────────────────────────────
-- Read-all reference data (writes blocked for the app role; the superadmin console
-- writes via the bypass owner role). RLS on + a SELECT-only policy => no write policy
-- => INSERT/UPDATE/DELETE denied for app_authenticated.
alter table public.permission_modules enable row level security;
drop policy if exists permission_modules_read on public.permission_modules;
create policy permission_modules_read on public.permission_modules for select using (true);

alter table public.plans enable row level security;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true);

alter table public.alert_definitions enable row level security;
drop policy if exists alert_definitions_read on public.alert_definitions;
create policy alert_definitions_read on public.alert_definitions for select using (true);

-- tank_calibration_charts: standard tank types (diameter x length). Shared
-- reference data — readable by every authenticated user (the dipstick form's
-- type dropdown + calib_volume() reads). Writes go via the bypass owner role /
-- superadmin (RLS on + SELECT-only policy => no write policy => writes denied
-- for app_authenticated).
alter table public.tank_calibration_charts enable row level security;
drop policy if exists tank_calibration_charts_read on public.tank_calibration_charts;
create policy tank_calibration_charts_read on public.tank_calibration_charts for select using (true);

-- leads: public marketing form may INSERT; only superadmin may read/manage.
alter table public.leads enable row level security;
drop policy if exists leads_superadmin_read on public.leads;
create policy leads_superadmin_read on public.leads for select using (app_is_superadmin());
drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert on public.leads for insert with check (true);

-- platform-internal: superadmin only.
alter table public.platform_audit enable row level security;
drop policy if exists platform_audit_superadmin on public.platform_audit;
create policy platform_audit_superadmin on public.platform_audit
  using (app_is_superadmin()) with check (app_is_superadmin());

alter table public.superadmins enable row level security;
drop policy if exists superadmins_superadmin on public.superadmins;
create policy superadmins_superadmin on public.superadmins
  using (app_is_superadmin()) with check (app_is_superadmin());
