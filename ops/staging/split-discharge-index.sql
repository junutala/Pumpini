-- split-discharge-index.sql — gated. Adds tank_id to the fuel-delivery dedup index
-- so one product split across multiple tanks (e.g. 6KL+4KL, or 5KL+5KL) can be
-- recorded as separate rows. Idempotent; no data change. Run on staging first.

DROP INDEX IF EXISTS ux_fuel_deliveries_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fuel_deliveries_dedup
  ON public.fuel_deliveries (station_id, dc_number, fuel_type, gross_volume_ltrs, tank_id)
  WHERE (dc_number IS NOT NULL);
