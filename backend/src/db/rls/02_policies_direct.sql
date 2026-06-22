-- Pumpini RLS — Phase A (2/2): isolation policies on the 30 direct-station_id tables.
-- ENABLE (not FORCE) — inert to the bypassrls app role until cutover.
-- Policy: a row is visible/writable only if its station_id is one of my_stations().
-- Idempotent (drops+recreates its own policy). Reversible via 99_rollback.sql.

do $$
declare
  t text;
  direct_tables text[] := array[
    'alerts','attendance','cash_deposits','corporate_receipts','corporate_station_links',
    'credit_suspense_entries','delivery_invoices','dipstick_readings','dispense_events','fuel_deliveries','fuel_prices','gst_invoices',
    'nozzles','petty_cash_entries','product_cn_seq','product_credit_notes','product_invoice_seq',
    'product_invoices','product_stock_receipts','products','rfid_tags','role_templates',
    'shift_definitions','shifts','station_group_members','station_settings','station_subscriptions',
    'station_users','tally_ledger_map','tank_reconciliation','tanks','user_role_assignments'
  ];
begin
  foreach t in array direct_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_station_isolation', t);
    execute format(
      'create policy %I on public.%I '
      || 'using (station_id in (select my_stations())) '
      || 'with check (station_id in (select my_stations()))',
      t || '_station_isolation', t
    );
  end loop;
end $$;
