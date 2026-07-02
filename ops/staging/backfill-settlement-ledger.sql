-- backfill-settlement-ledger.sql — one-time (re-runnable) populate of the reco
-- ledger from source tables. Run AFTER settlement-ledger.sql. Idempotent (upserts).
-- Only writes to the 4 ledger tables; never mutates source data. Run in order.
-- Mirrors backend/src/services/settlementLedger.js exactly (6 AM trade-date rate).

-- 1) Layer 1 detail — per operator × fuel: litres from dispense_events, valued at
--    the price effective at 06:00 IST of the trade day.
INSERT INTO settlement_ledger_fuel
  (station_id, trade_date, shift_id, attendant_id, fuel_type, litres, rate, book_sales)
SELECT s.station_id, s.date, de.shift_id, de.attendant_id, de.fuel_type,
       SUM(de.quantity_ltrs) AS litres,
       fp.price AS rate,
       ROUND(SUM(de.quantity_ltrs) * COALESCE(fp.price, 0), 2) AS book_sales
FROM dispense_events de
JOIN shifts s ON s.id = de.shift_id
JOIN shift_reconciliation r
  ON r.shift_id = de.shift_id AND r.attendant_id = de.attendant_id AND r.manager_confirmed = TRUE
LEFT JOIN LATERAL (
  SELECT price FROM fuel_prices fp
  WHERE fp.station_id = s.station_id AND fp.fuel_type = de.fuel_type
    AND fp.effective_from <= ((s.date + TIME '06:00') AT TIME ZONE 'Asia/Kolkata')
  ORDER BY fp.effective_from DESC LIMIT 1
) fp ON TRUE
WHERE de.attendant_id IS NOT NULL AND NOT COALESCE(de.is_voided, FALSE)
GROUP BY s.station_id, s.date, de.shift_id, de.attendant_id, de.fuel_type, fp.price
ON CONFLICT (shift_id, attendant_id, fuel_type) DO UPDATE SET
  station_id=EXCLUDED.station_id, trade_date=EXCLUDED.trade_date,
  litres=EXCLUDED.litres, rate=EXCLUDED.rate, book_sales=EXCLUDED.book_sales;

-- 2) Layer 1 header — per operator: book = Σ detail (fallback total_sales for
--    mgr_cash mode with no meter rows); collections = (cash−float)+card+upi+credit+petty.
INSERT INTO settlement_ledger
  (station_id, trade_date, shift_id, attendant_id, book_sales, opening_cash,
   cash_actual, card_total, upi_total, credit_total, petty_cash, collections, variance,
   mode, reconciled_at, computed_at)
SELECT s.station_id, s.date, r.shift_id, r.attendant_id,
  COALESCE(f.book, r.total_sales, 0) AS book_sales,
  COALESCE(sa.opening_cash, 0) AS opening_cash,
  COALESCE(r.cash_actual, 0), COALESCE(r.card_total, 0), COALESCE(r.upi_total, 0),
  COALESCE(r.credit_total, 0), COALESCE(r.petty_cash, 0),
  ROUND((COALESCE(r.cash_actual,0) - COALESCE(sa.opening_cash,0))
        + COALESCE(r.card_total,0) + COALESCE(r.upi_total,0)
        + COALESCE(r.credit_total,0) + COALESCE(r.petty_cash,0), 2) AS collections,
  ROUND(((COALESCE(r.cash_actual,0) - COALESCE(sa.opening_cash,0))
        + COALESCE(r.card_total,0) + COALESCE(r.upi_total,0)
        + COALESCE(r.credit_total,0) + COALESCE(r.petty_cash,0))
        - COALESCE(f.book, r.total_sales, 0), 2) AS variance,
  r.mode, r.reconciled_at, now()
FROM shift_reconciliation r
JOIN shifts s ON s.id = r.shift_id
LEFT JOIN shift_attendants sa
  ON sa.shift_id = r.shift_id AND sa.attendant_id = r.attendant_id
LEFT JOIN (
  SELECT shift_id, attendant_id, SUM(book_sales) AS book
  FROM settlement_ledger_fuel GROUP BY shift_id, attendant_id
) f ON f.shift_id = r.shift_id AND f.attendant_id = r.attendant_id
WHERE r.manager_confirmed = TRUE
ON CONFLICT (shift_id, attendant_id) DO UPDATE SET
  station_id=EXCLUDED.station_id, trade_date=EXCLUDED.trade_date, book_sales=EXCLUDED.book_sales,
  opening_cash=EXCLUDED.opening_cash, cash_actual=EXCLUDED.cash_actual, card_total=EXCLUDED.card_total,
  upi_total=EXCLUDED.upi_total, credit_total=EXCLUDED.credit_total, petty_cash=EXCLUDED.petty_cash,
  collections=EXCLUDED.collections, variance=EXCLUDED.variance, mode=EXCLUDED.mode,
  reconciled_at=EXCLUDED.reconciled_at, computed_at=now();

-- 3) Layer 2 detail — per outlet × fuel: dips aggregated across the day's shifts.
WITH day_tanks AS (
  SELECT s.station_id, s.trade_date, t.id AS tank_id, t.fuel_type,
    (SELECT dr.volume_ltrs FROM dipstick_readings dr
       JOIN shifts s2 ON s2.id = dr.shift_id
      WHERE dr.tank_id=t.id AND s2.station_id=s.station_id AND s2.date=s.trade_date
        AND dr.reading_type='opening'
      ORDER BY dr.recorded_at ASC LIMIT 1) AS opening_ltrs,
    (SELECT dr.volume_ltrs FROM dipstick_readings dr
       JOIN shifts s2 ON s2.id = dr.shift_id
      WHERE dr.tank_id=t.id AND s2.station_id=s.station_id AND s2.date=s.trade_date
        AND dr.reading_type='closing'
      ORDER BY dr.recorded_at DESC LIMIT 1) AS closing_ltrs,
    COALESCE((SELECT SUM(COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs))
              FROM fuel_deliveries fd
              WHERE fd.tank_id=t.id AND (
                fd.dc_date = s.trade_date
                OR (fd.dc_date IS NULL
                    AND fd.received_at >= ((s.trade_date + TIME '06:00') AT TIME ZONE 'Asia/Kolkata')
                    AND fd.received_at <  (((s.trade_date + 1) + TIME '06:00') AT TIME ZONE 'Asia/Kolkata'))
              )),0) AS deliveries_ltrs,
    COALESCE((SELECT SUM(de.quantity_ltrs) FROM dispense_events de
              JOIN nozzles n ON n.id=de.nozzle_id JOIN shifts s2 ON s2.id = de.shift_id
              WHERE n.tank_id=t.id AND s2.station_id=s.station_id AND s2.date=s.trade_date
                AND NOT COALESCE(de.is_voided,FALSE)),0) AS meter_ltrs
  FROM (SELECT DISTINCT station_id, date AS trade_date FROM shifts) s
  JOIN tanks t ON t.station_id = s.station_id
),
by_fuel AS (
  SELECT station_id, trade_date, fuel_type,
    SUM(opening_ltrs)  AS opening_dip,   -- NULL if no tank of this fuel was dipped
    SUM(closing_ltrs)  AS closing_dip,
    SUM(deliveries_ltrs) AS deliveries,
    SUM(meter_ltrs)      AS meter
  FROM day_tanks GROUP BY station_id, trade_date, fuel_type
)
INSERT INTO outlet_reco_fuel
  (station_id, trade_date, fuel_type, opening_dip_ltrs, deliveries_ltrs, closing_dip_ltrs,
   dip_sold_ltrs, meter_sold_ltrs, rate, book_sales)
SELECT b.station_id, b.trade_date, b.fuel_type,
  b.opening_dip, b.deliveries, b.closing_dip,
  CASE WHEN b.opening_dip IS NOT NULL AND b.closing_dip IS NOT NULL
       THEN ROUND((b.opening_dip + b.deliveries) - b.closing_dip, 3) END AS dip_sold,
  b.meter,
  fp.price AS rate,
  CASE WHEN b.opening_dip IS NOT NULL AND b.closing_dip IS NOT NULL AND fp.price IS NOT NULL
       THEN ROUND(((b.opening_dip + b.deliveries) - b.closing_dip) * fp.price, 2) ELSE 0 END AS book_sales
FROM by_fuel b
LEFT JOIN LATERAL (
  SELECT price FROM fuel_prices fp
  WHERE fp.station_id = b.station_id AND fp.fuel_type = b.fuel_type
    AND fp.effective_from <= ((b.trade_date + TIME '06:00') AT TIME ZONE 'Asia/Kolkata')
  ORDER BY fp.effective_from DESC LIMIT 1
) fp ON TRUE
ON CONFLICT (station_id, trade_date, fuel_type) DO UPDATE SET
  opening_dip_ltrs=EXCLUDED.opening_dip_ltrs, deliveries_ltrs=EXCLUDED.deliveries_ltrs,
  closing_dip_ltrs=EXCLUDED.closing_dip_ltrs, dip_sold_ltrs=EXCLUDED.dip_sold_ltrs,
  meter_sold_ltrs=EXCLUDED.meter_sold_ltrs, rate=EXCLUDED.rate, book_sales=EXCLUDED.book_sales;

-- 4) Layer 2 header — per outlet per day: money_variance = Σ collections − Σ book.
INSERT INTO outlet_reco
  (station_id, trade_date, dip_sold_ltrs, meter_sold_ltrs, book_sales,
   total_collections, money_variance, wetstock_variance_ltrs, computed_at)
SELECT d.station_id, d.trade_date,
  ROUND(COALESCE(f.dip_sold, 0), 3), ROUND(COALESCE(f.meter_sold, 0), 3), ROUND(COALESCE(f.book, 0), 2),
  COALESCE(c.collections, 0),
  ROUND(COALESCE(c.collections, 0) - COALESCE(f.book, 0), 2),
  ROUND(COALESCE(f.meter_sold, 0) - COALESCE(f.dip_sold, 0), 3),
  now()
FROM (SELECT DISTINCT station_id, date AS trade_date FROM shifts) d
LEFT JOIN (
  SELECT station_id, trade_date, SUM(dip_sold_ltrs) AS dip_sold,
         SUM(meter_sold_ltrs) AS meter_sold, SUM(book_sales) AS book
  FROM outlet_reco_fuel GROUP BY station_id, trade_date
) f ON f.station_id = d.station_id AND f.trade_date = d.trade_date
LEFT JOIN (
  SELECT station_id, trade_date, SUM(collections) AS collections
  FROM settlement_ledger GROUP BY station_id, trade_date
) c ON c.station_id = d.station_id AND c.trade_date = d.trade_date
ON CONFLICT (station_id, trade_date) DO UPDATE SET
  dip_sold_ltrs=EXCLUDED.dip_sold_ltrs, meter_sold_ltrs=EXCLUDED.meter_sold_ltrs,
  book_sales=EXCLUDED.book_sales, total_collections=EXCLUDED.total_collections,
  money_variance=EXCLUDED.money_variance, wetstock_variance_ltrs=EXCLUDED.wetstock_variance_ltrs,
  computed_at=now();
