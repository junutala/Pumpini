-- ============================================================================
-- HIGHWAY DATA RECTIFICATION — run on STAGING first (it now has prod-shaped data).
-- These are DIAGNOSTICS ONLY (SELECTs). They surface exactly what's wrong so we
-- can agree the fixes before touching anything. No data is changed here.
-- ============================================================================

-- ── D1. Impossible / demo METER readings (the "250 -> 1.46M" and negative-throughput
--    rows). closing < opening = physically impossible; huge throughput = demo/typo.
--    Checked in BOTH places readings are stored.
SELECT 'shift_attendants' AS src, st.name AS station, s.date AS shift_date, s.shift_number,
       u.name AS operator, n.nozzle_number, n.fuel_type,
       sa.opening_reading, sa.closing_reading,
       (sa.closing_reading - sa.opening_reading) AS throughput_ltrs
FROM shift_attendants sa
JOIN shifts s    ON s.id = sa.shift_id
JOIN stations st ON st.id = s.station_id
LEFT JOIN users u   ON u.id = sa.attendant_id
LEFT JOIN nozzles n ON n.id = sa.nozzle_id
WHERE st.name ILIKE '%highway%'
  AND sa.closing_reading IS NOT NULL
  AND (sa.closing_reading < sa.opening_reading
       OR (sa.closing_reading - sa.opening_reading) > 100000)
UNION ALL
SELECT 'shift_nozzle_readings', st.name, s.date, s.shift_number,
       NULL, n.nozzle_number, n.fuel_type,
       snr.opening_reading, snr.closing_reading,
       (snr.closing_reading - snr.opening_reading)
FROM shift_nozzle_readings snr
JOIN shifts s    ON s.id = snr.shift_id
JOIN stations st ON st.id = s.station_id
LEFT JOIN nozzles n ON n.id = snr.nozzle_id
WHERE st.name ILIKE '%highway%'
  AND snr.closing_reading IS NOT NULL
  AND (snr.closing_reading < snr.opening_reading
       OR (snr.closing_reading - snr.opening_reading) > 100000)
ORDER BY shift_date, shift_number, nozzle_number;

-- ── D2. Every Highway shift, with what it actually holds — so we can spot the
--    go-live demo shift(s) vs real trading, and decide keep / correct / void.
SELECT st.name AS station, s.id AS shift_id, s.date AS shift_date, s.shift_number, s.status,
       (s.start_time AT TIME ZONE 'Asia/Kolkata') AS start_ist,
       (s.end_time   AT TIME ZONE 'Asia/Kolkata') AS end_ist,
       COUNT(DISTINCT sa.attendant_id)                               AS operators,
       COALESCE(SUM(de.quantity_ltrs) FILTER (WHERE NOT COALESCE(de.is_voided,FALSE)),0) AS sale_ltrs,
       COALESCE(SUM(de.amount)        FILTER (WHERE NOT COALESCE(de.is_voided,FALSE)),0) AS sale_amount
FROM shifts s
JOIN stations st ON st.id = s.station_id
LEFT JOIN shift_attendants sa ON sa.shift_id = s.id
LEFT JOIN dispense_events de  ON de.shift_id = s.id
WHERE st.name ILIKE '%highway%'
GROUP BY st.name, s.id, s.date, s.shift_number, s.status, s.start_time, s.end_time
ORDER BY st.name, s.date, s.shift_number;

-- ── D3. The mis-dating footprint at Highway (manager sales filed on the wrong day).
--    This is the one we FIX with backfill-occurred-at.sql (already prepared).
SELECT st.name AS station,
       COUNT(*)                                                                          AS manager_fills,
       COUNT(*) FILTER (WHERE (de.occurred_at AT TIME ZONE 'Asia/Kolkata')::date <> s.date) AS misdated_fills
FROM dispense_events de
JOIN shifts s    ON s.id = de.shift_id
JOIN stations st ON st.id = de.station_id
WHERE st.name ILIKE '%highway%' AND de.source = 'manager'
GROUP BY st.name;
