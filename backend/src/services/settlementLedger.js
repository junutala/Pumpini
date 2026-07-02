// src/services/settlementLedger.js — materialized reconciliation ledger.
//
// WHY: reconciliation used to be re-derived from raw tables (dispense_events +
// shift_reconciliation + fuel_prices + dipstick_readings) on every dashboard
// read. That is slow for past dates and fragile — a single wrong join (e.g.
// valuing old litres at today's rate) silently corrupts a number. Instead we
// compute the reco ONCE at shift close, freeze it in these tables, and let every
// tile/graph/export read straight from here.
//
// RATE RULE (owner): OMCs push the new selling price at 06:00, and the opening
// dip is taken at 06:00 — so the whole trade day carries the price effective at
// 06:00 IST of shifts.date. We freeze THAT rate, never the latest one.
//
// Two levels, header + detail:
//   settlement_ledger / settlement_ledger_fuel — per operator (Layer 1)
//     book_sales  = Σ (closing−opening litres) × 6 AM rate      (from dispense_events)
//     collections = (cash−opening_float)+card+upi+credit+petty  (from shift_reconciliation)
//     variance    = collections − book_sales                    (0 = clean → operator cleared)
//   outlet_reco / outlet_reco_fuel — per outlet per day (Layer 2, the manager)
//     dip_sold    = opening dip + deliveries − closing dip       (wet-stock truth)
//     book_sales  = Σ dip_sold × 6 AM rate
//     money_var   = Σ collections − book_sales                   (0 = clean → day shining)
//
// The writer is idempotent (upsert keyed by shift/attendant/fuel and station/date)
// so re-closing, editing, or backfilling always converges. Source tables remain
// the truth; this ledger can always be rebuilt from them (see backfill script).
const pool = require('../db/pool');

// Price effective at 06:00 IST of the trade day.
async function rateFor(client, stationId, fuel, tradeDate) {
  const { rows } = await client.query(
    `SELECT price FROM fuel_prices
      WHERE station_id=$1 AND fuel_type=$2
        AND effective_from <= (($3::date + TIME '06:00') AT TIME ZONE 'Asia/Kolkata')
      ORDER BY effective_from DESC LIMIT 1`, [stationId, fuel, tradeDate]);
  return rows.length ? Number(rows[0].price) : null;
}

// Recompute + freeze the operator layer for one attendant on one shift.
async function recomputeAttendant(client, shift) {
  const { id: shift_id, station_id, trade_date } = shift;
  const { rows: recos } = await client.query(
    `SELECT r.attendant_id, r.total_sales, r.cash_actual, r.card_total, r.upi_total,
            r.credit_total, r.petty_cash, r.mode, r.reconciled_at,
            COALESCE(sa.opening_cash, 0) AS opening_cash
       FROM shift_reconciliation r
       LEFT JOIN shift_attendants sa
              ON sa.shift_id = r.shift_id AND sa.attendant_id = r.attendant_id
      WHERE r.shift_id = $1 AND r.manager_confirmed = TRUE`, [shift_id]);

  for (const r of recos) {
    // Per-fuel litres from (frozen) dispense_events; value at the 6 AM rate.
    const { rows: fuels } = await client.query(
      `SELECT de.fuel_type, SUM(de.quantity_ltrs) AS litres
         FROM dispense_events de
        WHERE de.shift_id = $1 AND de.attendant_id = $2
          AND NOT COALESCE(de.is_voided, FALSE)
        GROUP BY de.fuel_type`, [shift_id, r.attendant_id]);

    await client.query(
      `DELETE FROM settlement_ledger_fuel WHERE shift_id=$1 AND attendant_id=$2`,
      [shift_id, r.attendant_id]);

    let bookSales = 0;
    for (const f of fuels) {
      const litres = Number(f.litres || 0);
      const rate = await rateFor(client, station_id, f.fuel_type, trade_date);
      const book = rate != null ? +(litres * rate).toFixed(2) : 0;
      bookSales += book;
      await client.query(
        `INSERT INTO settlement_ledger_fuel
           (station_id, trade_date, shift_id, attendant_id, fuel_type, litres, rate, book_sales)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [station_id, trade_date, shift_id, r.attendant_id, f.fuel_type, litres, rate, book]);
    }
    // mgr_cash mode has no meter/dispense rows → fall back to the recorded total.
    if (!fuels.length) bookSales = Number(r.total_sales || 0);
    bookSales = +bookSales.toFixed(2);

    const cash = Number(r.cash_actual || 0), open = Number(r.opening_cash || 0);
    const card = Number(r.card_total || 0), upi = Number(r.upi_total || 0);
    const credit = Number(r.credit_total || 0), petty = Number(r.petty_cash || 0);
    const collections = +((cash - open) + card + upi + credit + petty).toFixed(2);
    const variance = +(collections - bookSales).toFixed(2);

    await client.query(
      `INSERT INTO settlement_ledger
         (station_id, trade_date, shift_id, attendant_id, book_sales, opening_cash,
          cash_actual, card_total, upi_total, credit_total, petty_cash,
          collections, variance, mode, reconciled_at, computed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
       ON CONFLICT(shift_id, attendant_id) DO UPDATE SET
         station_id=EXCLUDED.station_id, trade_date=EXCLUDED.trade_date,
         book_sales=EXCLUDED.book_sales, opening_cash=EXCLUDED.opening_cash,
         cash_actual=EXCLUDED.cash_actual, card_total=EXCLUDED.card_total,
         upi_total=EXCLUDED.upi_total, credit_total=EXCLUDED.credit_total,
         petty_cash=EXCLUDED.petty_cash, collections=EXCLUDED.collections,
         variance=EXCLUDED.variance, mode=EXCLUDED.mode,
         reconciled_at=EXCLUDED.reconciled_at, computed_at=now()`,
      [station_id, trade_date, shift_id, r.attendant_id, bookSales, open,
       cash, card, upi, credit, petty, collections, variance, r.mode, r.reconciled_at]);
  }
}

// Recompute + freeze the outlet (manager) layer for a whole trade day.
async function recomputeOutlet(client, stationId, tradeDate) {
  const { rows: dayShifts } = await client.query(
    `SELECT id FROM shifts WHERE station_id=$1 AND date=$2`, [stationId, tradeDate]);
  const ids = dayShifts.map(s => s.id);

  await client.query(
    `DELETE FROM outlet_reco_fuel WHERE station_id=$1 AND trade_date=$2`, [stationId, tradeDate]);
  if (!ids.length) {
    await client.query(`DELETE FROM outlet_reco WHERE station_id=$1 AND trade_date=$2`, [stationId, tradeDate]);
    return;
  }

  // Per tank across the day: opening dip (earliest), closing dip (latest),
  // meter-sold (all scoped to the day's shifts), and DELIVERIES scoped to the
  // TRADE DAY — deliveries are NOT reliably tagged to a shift, so we match on
  // dc_date (the challan's trade day), falling back to a 06:00→06:00 IST window
  // on received_at. Matching deliveries by shift_id silently dropped refills on
  // delivery days and drove dip_sold negative.
  const { rows: tanks } = await client.query(`
    SELECT t.id AS tank_id, t.fuel_type,
      (SELECT dr.volume_ltrs FROM dipstick_readings dr
        WHERE dr.tank_id=t.id AND dr.shift_id = ANY($2::uuid[]) AND dr.reading_type='opening'
        ORDER BY dr.recorded_at ASC LIMIT 1) AS opening_ltrs,
      (SELECT dr.volume_ltrs FROM dipstick_readings dr
        WHERE dr.tank_id=t.id AND dr.shift_id = ANY($2::uuid[]) AND dr.reading_type='closing'
        ORDER BY dr.recorded_at DESC LIMIT 1) AS closing_ltrs,
      COALESCE((SELECT SUM(COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs))
                FROM fuel_deliveries fd
                WHERE fd.tank_id=t.id AND (
                  fd.dc_date = $3::date
                  OR (fd.dc_date IS NULL
                      AND fd.received_at >= (($3::date + TIME '06:00') AT TIME ZONE 'Asia/Kolkata')
                      AND fd.received_at <  ((($3::date + 1) + TIME '06:00') AT TIME ZONE 'Asia/Kolkata'))
                )),0) AS deliveries_ltrs,
      COALESCE((SELECT SUM(de.quantity_ltrs) FROM dispense_events de
                JOIN nozzles n ON n.id=de.nozzle_id
                WHERE n.tank_id=t.id AND de.shift_id = ANY($2::uuid[])
                  AND NOT COALESCE(de.is_voided,FALSE)),0) AS meter_ltrs
    FROM tanks t WHERE t.station_id=$1`, [stationId, ids, tradeDate]);

  // Roll tanks up to fuel level (rate is per fuel).
  const byFuel = {};
  for (const t of tanks) {
    const o = byFuel[t.fuel_type] ||
      (byFuel[t.fuel_type] = { opening: 0, closing: 0, deliveries: 0, meter: 0, haveOpen: false, haveClose: false });
    if (t.opening_ltrs != null) { o.opening += Number(t.opening_ltrs); o.haveOpen = true; }
    if (t.closing_ltrs != null) { o.closing += Number(t.closing_ltrs); o.haveClose = true; }
    o.deliveries += Number(t.deliveries_ltrs || 0);
    o.meter += Number(t.meter_ltrs || 0);
  }

  let totBook = 0, totDip = 0, totMeter = 0;
  for (const [fuel, o] of Object.entries(byFuel)) {
    const rate = await rateFor(client, stationId, fuel, tradeDate);
    const dipSold = (o.haveOpen && o.haveClose) ? +((o.opening + o.deliveries) - o.closing).toFixed(3) : null;
    const book = (dipSold != null && rate != null) ? +(dipSold * rate).toFixed(2) : 0;
    totBook += book;
    totDip += dipSold != null ? dipSold : 0;
    totMeter += o.meter;
    await client.query(
      `INSERT INTO outlet_reco_fuel
         (station_id, trade_date, fuel_type, opening_dip_ltrs, deliveries_ltrs,
          closing_dip_ltrs, dip_sold_ltrs, meter_sold_ltrs, rate, book_sales)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [stationId, tradeDate, fuel, o.haveOpen ? o.opening : null, o.deliveries,
       o.haveClose ? o.closing : null, dipSold, o.meter, rate, book]);
  }

  // Total collections = Σ operators' accounted collections that day (just written).
  const { rows: col } = await client.query(
    `SELECT COALESCE(SUM(collections),0) AS c FROM settlement_ledger WHERE station_id=$1 AND trade_date=$2`,
    [stationId, tradeDate]);
  const totalCollections = Number(col[0].c || 0);
  const moneyVar = +(totalCollections - totBook).toFixed(2);
  const wetVar = +(totMeter - totDip).toFixed(3);

  await client.query(
    `INSERT INTO outlet_reco
       (station_id, trade_date, dip_sold_ltrs, meter_sold_ltrs, book_sales,
        total_collections, money_variance, wetstock_variance_ltrs, computed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT(station_id, trade_date) DO UPDATE SET
       dip_sold_ltrs=EXCLUDED.dip_sold_ltrs, meter_sold_ltrs=EXCLUDED.meter_sold_ltrs,
       book_sales=EXCLUDED.book_sales, total_collections=EXCLUDED.total_collections,
       money_variance=EXCLUDED.money_variance,
       wetstock_variance_ltrs=EXCLUDED.wetstock_variance_ltrs, computed_at=now()`,
    [stationId, tradeDate, +totDip.toFixed(3), +totMeter.toFixed(3), +totBook.toFixed(2),
     totalCollections, moneyVar, wetVar]);
}

// Recompute + freeze both layers for a shift's trade day. Idempotent. Best-effort:
// callers should not let a ledger failure roll back a valid close (source tables
// stay the truth and the ledger can be rebuilt). Runs in its own transaction.
async function recomputeShift(shift_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sh } = await client.query(
      `SELECT id, station_id, date AS trade_date FROM shifts WHERE id=$1`, [shift_id]);
    if (!sh.length) { await client.query('ROLLBACK'); return; }
    const shift = sh[0];
    await recomputeAttendant(client, shift);
    await recomputeOutlet(client, shift.station_id, shift.trade_date);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[settlementLedger] recomputeShift failed for', shift_id, '—', e.message);
  } finally {
    client.release();
  }
}

module.exports = { recomputeShift, recomputeAttendant, recomputeOutlet, rateFor };
