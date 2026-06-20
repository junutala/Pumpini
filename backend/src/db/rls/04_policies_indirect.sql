-- Pumpini RLS — Phase B (indirect): child tables scoped through their parent's station.
-- The parent tables already enforce RLS, so the EXISTS only matches rows in the
-- user's stations. Idempotent + reversible (99_rollback drops *_isolation policies).

-- ── via shifts.station_id ─────────────────────────────────────────────
alter table public.shift_attendants enable row level security;
drop policy if exists shift_attendants_isolation on public.shift_attendants;
create policy shift_attendants_isolation on public.shift_attendants
  using      (exists (select 1 from public.shifts s where s.id = shift_attendants.shift_id and s.station_id in (select my_stations())))
  with check (exists (select 1 from public.shifts s where s.id = shift_attendants.shift_id and s.station_id in (select my_stations())));

alter table public.shift_reconciliation enable row level security;
drop policy if exists shift_reconciliation_isolation on public.shift_reconciliation;
create policy shift_reconciliation_isolation on public.shift_reconciliation
  using      (exists (select 1 from public.shifts s where s.id = shift_reconciliation.shift_id and s.station_id in (select my_stations())))
  with check (exists (select 1 from public.shifts s where s.id = shift_reconciliation.shift_id and s.station_id in (select my_stations())));

alter table public.cash_denominations enable row level security;
drop policy if exists cash_denominations_isolation on public.cash_denominations;
create policy cash_denominations_isolation on public.cash_denominations
  using      (exists (select 1 from public.shifts s where s.id = cash_denominations.shift_id and s.station_id in (select my_stations())))
  with check (exists (select 1 from public.shifts s where s.id = cash_denominations.shift_id and s.station_id in (select my_stations())));

-- ── via product_invoices / product_credit_notes.station_id ────────────
alter table public.product_invoice_items enable row level security;
drop policy if exists product_invoice_items_isolation on public.product_invoice_items;
create policy product_invoice_items_isolation on public.product_invoice_items
  using      (exists (select 1 from public.product_invoices pi where pi.id = product_invoice_items.invoice_id and pi.station_id in (select my_stations())))
  with check (exists (select 1 from public.product_invoices pi where pi.id = product_invoice_items.invoice_id and pi.station_id in (select my_stations())));

alter table public.product_credit_note_items enable row level security;
drop policy if exists product_credit_note_items_isolation on public.product_credit_note_items;
create policy product_credit_note_items_isolation on public.product_credit_note_items
  using      (exists (select 1 from public.product_credit_notes cn where cn.id = product_credit_note_items.credit_note_id and cn.station_id in (select my_stations())))
  with check (exists (select 1 from public.product_credit_notes cn where cn.id = product_credit_note_items.credit_note_id and cn.station_id in (select my_stations())));

-- ── via role_templates.station_id ────────────────────────────────────
alter table public.template_permissions enable row level security;
drop policy if exists template_permissions_isolation on public.template_permissions;
create policy template_permissions_isolation on public.template_permissions
  using      (exists (select 1 from public.role_templates rt where rt.id = template_permissions.template_id and rt.station_id in (select my_stations())))
  with check (exists (select 1 from public.role_templates rt where rt.id = template_permissions.template_id and rt.station_id in (select my_stations())));
