-- ─────────────────────────────────────────────────────────────
--  DELIVERY INVOICE FILES — the scanned DC / photo / PDF, kept as an
--  audit record of what the manager confirmed against.
--
--  Stored in its OWN table (not on fuel_deliveries) so the deliveries list
--  query — SELECT fd.* — stays lean and never drags base64 blobs. One file
--  can back several fuel_deliveries rows (a multi-compartment invoice).
--
--  Idempotent. Versioned: v1 2026-06-22.
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS delivery_invoices (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id   UUID REFERENCES stations(id),
  file_base64  TEXT NOT NULL,
  media_type   VARCHAR(40) NOT NULL,           -- image/jpeg, application/pdf, ...
  uploaded_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fuel_deliveries ADD COLUMN IF NOT EXISTS invoice_id
  UUID REFERENCES delivery_invoices(id);

-- ─────────────────────────────────────────────────────────────
--  RLS — station-scoped, same rule as the other direct-station_id tables.
--  Baked in so the table is never created unprotected. Guarded: only wires up
--  the policy if the RLS helpers exist (a non-RLS DB just gets a plain table).
--  Canonical copy also added to rls/02_policies_direct.sql.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'my_stations') THEN
    EXECUTE 'ALTER TABLE delivery_invoices ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS delivery_invoices_station_isolation ON delivery_invoices';
    EXECUTE 'CREATE POLICY delivery_invoices_station_isolation ON delivery_invoices '
         || 'USING (station_id IN (SELECT my_stations())) '
         || 'WITH CHECK (station_id IN (SELECT my_stations()))';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_invoices TO app_authenticated';
  END IF;
END $$;
