// src/routes/groups.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

// The group rollup carries owner-only figures (margins, blended margin %,
// intelligence analysis). It is an OWNER surface — a CCO is a group member for
// access purposes but must NOT see this, so gate the read endpoints to owners.
// GET /api/groups/my — groups the logged-in user belongs to
router.get('/my', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT og.*,
        COUNT(DISTINCT sgm.station_id)::int AS station_count,
        s.plan, s.status AS sub_status
      FROM owner_groups og
      JOIN owner_group_members ogm ON ogm.group_id = og.id
      LEFT JOIN station_groups stg ON stg.owner_group_id = og.id
      LEFT JOIN station_group_members sgm ON sgm.station_group_id = stg.id
      LEFT JOIN subscriptions s ON s.owner_group_id = og.id
      WHERE ogm.user_id = $1 AND og.is_active = TRUE
      GROUP BY og.id, s.plan, s.status`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/groups/:id/dashboard — group-level dashboard
// Per-outlet cockpit metrics for the owner rollup. The owner sees through
// blind-drop, so this counts ALL of today's sales (open + closed). A handful of
// queries per outlet — fine for a group of a few bunks. Best-effort: a failure
// degrades to safe zeros rather than breaking the whole rollup.
async function outletMetrics(sid, date) {
  const monthStart = date.slice(0, 8) + '01';
  try {
    const [sf, yd, pr, by, rv, wt, lg, ud, ml, mf] = await Promise.all([
      // Sales are filed by the shift's TRADE DAY (shifts.date), never by
      // occurred_at. occurred_at is a data-entry timestamp — it is written when the
      // shift is settled, so a shift traded on 30-Jun that closed at 01:20 on 1-Jul
      // carries a July stamp and got counted in July's month-to-date. That put 6,702 L
      // of June trade into Kamala's July figure here while Stock Reco (which files by
      // shifts.date) excluded it, so the same metric read differently on two screens.
      // dashboard.js already files per-shift sales this way; this matches it.
      pool.query(`SELECT de.fuel_type, de.payment_mode, COALESCE(SUM(de.quantity_ltrs),0) AS ltrs, COALESCE(SUM(de.amount),0) AS amt
                  FROM dispense_events de JOIN shifts s ON s.id=de.shift_id
                  WHERE s.station_id=$1 AND s.date=$2 AND NOT COALESCE(de.is_voided,FALSE)
                  GROUP BY 1,2`, [sid, date]),
      pool.query(`SELECT COALESCE(SUM(de.amount),0) AS amt FROM dispense_events de
                  JOIN shifts s ON s.id=de.shift_id
                  WHERE s.station_id=$1 AND s.date=$2::date-1 AND NOT COALESCE(de.is_voided,FALSE)`, [sid, date]),
      pool.query(`SELECT DISTINCT ON (fuel_type) fuel_type, price FROM fuel_prices WHERE station_id=$1 ORDER BY fuel_type, effective_from DESC`, [sid]),
      pool.query(`SELECT DISTINCT ON (fuel_type) fuel_type, rate_per_ltr FROM fuel_deliveries WHERE station_id=$1 AND rate_per_ltr IS NOT NULL ORDER BY fuel_type, received_at DESC NULLS LAST`, [sid]),
      pool.query(`SELECT COALESCE((SELECT SUM(total_amount) FROM gst_invoices WHERE station_id=$1),0) AS invoiced,
                         COALESCE((SELECT SUM(amount) FROM corporate_receipts WHERE station_id=$1),0) AS received,
                         COALESCE((SELECT SUM(total_amount) FROM gst_invoices WHERE station_id=$1 AND invoice_date<=$2::date-90),0) AS invoiced_old`, [sid, date]),
      pool.query(`SELECT COALESCE(SUM(variance_ltrs),0) AS v, BOOL_OR(beyond_tolerance) AS b FROM tank_reconciliation WHERE station_id=$1 AND created_at>=$2 AND COALESCE(opening_ltrs,0) > 0`, [sid, monthStart]).catch(() => ({ rows: [{ v: 0, b: false }] })),
      pool.query(`SELECT AVG(GREATEST(0, EXTRACT(EPOCH FROM (cr.receipt_date::timestamp - gi.invoice_date::timestamp))/86400))::numeric AS lag
                  FROM corporate_receipts cr JOIN gst_invoices gi ON gi.id=cr.invoice_id WHERE cr.station_id=$1 AND cr.invoice_id IS NOT NULL`, [sid]),
      pool.query(`SELECT
                    COALESCE((SELECT SUM(r.cash_actual - COALESCE(sa.opening_cash,0)) FROM shift_reconciliation r
                              JOIN shifts s ON s.id=r.shift_id
                              LEFT JOIN shift_attendants sa ON sa.shift_id=r.shift_id AND sa.attendant_id=r.attendant_id
                              WHERE s.station_id=$1 AND r.manager_confirmed=TRUE),0)
                  + COALESCE((SELECT SUM(amount) FROM corporate_receipts WHERE station_id=$1 AND payment_type='cash'),0)
                  - COALESCE((SELECT SUM(amount) FROM cash_deposits WHERE station_id=$1),0) AS undeposited`, [sid]),
      pool.query(`SELECT COALESCE(SUM(de.quantity_ltrs),0) AS l FROM dispense_events de
                  JOIN shifts s ON s.id=de.shift_id
                  WHERE s.station_id=$1 AND s.date>=$2 AND NOT COALESCE(de.is_voided,FALSE)`, [sid, monthStart]),
      // Month-to-date sales per product (1st of the trade month → the settled day),
      // for the by-outlet-&-product tiles. Same voided/date rules as the day slice.
      pool.query(`SELECT de.fuel_type, COALESCE(SUM(de.quantity_ltrs),0) AS ltrs, COALESCE(SUM(de.amount),0) AS amt
                  FROM dispense_events de JOIN shifts s ON s.id=de.shift_id
                  WHERE s.station_id=$1 AND s.date BETWEEN $2 AND $3 AND NOT COALESCE(de.is_voided,FALSE)
                  GROUP BY 1`, [sid, monthStart, date]),
    ]);

    const sell = {}; pr.rows.forEach(r => { sell[r.fuel_type] = parseFloat(r.price); });
    const buy  = {}; by.rows.forEach(r => { buy[r.fuel_type] = parseFloat(r.rate_per_ltr); });
    let sales = 0, ltrs = 0, creditAmt = 0, marginAmt = 0;
    const ltrsByFuel = {}, amtByFuel = {};
    sf.rows.forEach(r => {
      const a = parseFloat(r.amt), l = parseFloat(r.ltrs);
      sales += a; ltrs += l;
      if (r.payment_mode === 'credit') creditAmt += a;
      ltrsByFuel[r.fuel_type] = (ltrsByFuel[r.fuel_type] || 0) + l;
      amtByFuel[r.fuel_type]  = (amtByFuel[r.fuel_type]  || 0) + a;
    });
    Object.keys(ltrsByFuel).forEach(ft => { if (sell[ft] != null && buy[ft] != null) marginAmt += ltrsByFuel[ft] * (sell[ft] - buy[ft]); });

    // Per-product breakdown for the group tiles. Prices (sell/buy) are the latest
    // on file; a null buy ⇒ margin can't be computed for that product (the UI
    // surfaces this so the owner enters the delivery rate).
    const fuelSet = new Set([...Object.keys(ltrsByFuel), ...mf.rows.map(r => r.fuel_type)]);
    const by_fuel = {
      day: Object.keys(ltrsByFuel).map(ft => ({ fuel_type: ft, litres: +ltrsByFuel[ft].toFixed(1), amount: +(amtByFuel[ft] || 0).toFixed(2) })),
      mtd: mf.rows.map(r => ({ fuel_type: r.fuel_type, litres: +parseFloat(r.ltrs).toFixed(1), amount: +parseFloat(r.amt).toFixed(2) })),
      price: [...fuelSet].map(ft => ({ fuel_type: ft, sell: sell[ft] ?? null, buy: buy[ft] ?? null })),
    };

    const r0 = rv.rows[0];
    const invoiced = parseFloat(r0.invoiced), received = parseFloat(r0.received), invoicedOld = parseFloat(r0.invoiced_old);
    const outstanding = Math.max(0, invoiced - received);
    const overdue90 = Math.max(0, Math.min(outstanding, invoicedOld - received));
    const mtdL = parseFloat(ml.rows[0].l) || 0;
    const wv = parseFloat(wt.rows[0].v) || 0;
    const yest = parseFloat(yd.rows[0].amt) || 0;
    const lag = lg.rows[0].lag != null ? Math.round(parseFloat(lg.rows[0].lag)) : null;
    const undeposited = Math.max(0, parseFloat(ud.rows[0].undeposited) || 0);

    return {
      sales: +sales.toFixed(2), litres: +ltrs.toFixed(1), yest_sales: +yest.toFixed(2),
      margin: +marginAmt.toFixed(2), gross_margin_pct: sales > 0 ? +(marginAmt / sales * 100).toFixed(2) : null,
      margin_frac: sales > 0 ? marginAmt / sales : null,
      credit_pct: sales > 0 ? +(creditAmt / sales * 100).toFixed(1) : 0,
      outstanding: +outstanding.toFixed(2), overdue_90: +overdue90.toFixed(2),
      overdue_pct: outstanding > 0 ? +(overdue90 / outstanding * 100).toFixed(1) : 0,
      wetstock_loss_ltrs: +wv.toFixed(2), wetstock_loss_pct: mtdL > 0 ? +(Math.abs(wv) / mtdL * 100).toFixed(2) : 0, wetstock_beyond: !!wt.rows[0].b,
      collection_lag_days: lag, cash_undeposited: +undeposited.toFixed(2),
      vs_yesterday_pct: yest > 0 ? +((sales - yest) / yest * 100).toFixed(1) : null,
      by_fuel,
    };
  } catch (e) {
    return { sales: 0, litres: 0, yest_sales: 0, margin: 0, gross_margin_pct: null, margin_frac: null, credit_pct: 0, outstanding: 0, overdue_90: 0, overdue_pct: 0, wetstock_loss_ltrs: 0, wetstock_loss_pct: 0, wetstock_beyond: false, collection_lag_days: null, cash_undeposited: 0, vs_yesterday_pct: null, by_fuel: { day: [], mtd: [], price: [] } };
  }
}

router.get('/:id/dashboard', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    // Verify user belongs to group
    const { rows: member } = await pool.query(
      'SELECT 1 FROM owner_group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!member.length) return res.status(403).json({ error: 'Not a member of this group' });

    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(`
      SELECT 
        s.id, s.name, s.city, s.state, s.oil_company,
        COALESCE(SUM(de.amount),0)        AS today_sales,
        COALESCE(SUM(de.quantity_ltrs),0) AS today_litres,
        COUNT(DISTINCT de.id)::int        AS txn_count,
        COUNT(DISTINCT sh.id) FILTER (WHERE sh.status='open')::int AS open_shifts,
        COUNT(DISTINCT al.id) FILTER (WHERE al.acknowledged_at IS NULL)::int AS unread_alerts
      FROM stations s
      JOIN station_group_members sgm ON sgm.station_id = s.id
      JOIN station_groups stg ON stg.id = sgm.station_group_id
      LEFT JOIN shifts sh ON sh.station_id = s.id AND sh.date = $2
      LEFT JOIN dispense_events de ON de.shift_id = sh.id
        AND NOT COALESCE(de.is_voided,FALSE)
      LEFT JOIN alerts al ON al.station_id = s.id
      WHERE stg.owner_group_id = $1
      GROUP BY s.id ORDER BY s.name`,
      [req.params.id, today]
    );

    // When as_of=settled, each outlet's day-metrics (sales/margin/litres/vs-yest)
    // are computed for ITS OWN last manager-confirmed settlement trade day (≤ today)
    // instead of the empty running "today" — the group-view analog of the bunk
    // cockpit's last-settled-day default. Intelligence keeps the default (today) so
    // its cross-outlet scorecard stays same-period. Best-effort: falls back to today.
    const asOfSettled = req.query.as_of === 'settled';
    const dateByStation = {};
    if (asOfSettled) {
      try {
        const { rows: lt } = await pool.query(`
          SELECT sh.station_id::text AS sid, MAX(sh.date)::text AS d
          FROM shift_reconciliation r
          JOIN shifts sh ON sh.id = r.shift_id
          JOIN station_group_members sgm ON sgm.station_id = sh.station_id
          JOIN station_groups stg ON stg.id = sgm.station_group_id
          WHERE stg.owner_group_id = $1 AND r.manager_confirmed = TRUE AND sh.date <= $2
          GROUP BY sh.station_id`, [req.params.id, today]);
        lt.forEach(x => { if (x.d) dateByStation[x.sid] = x.d; });
      } catch (e) { /* best-effort — fall back to today */ }
    }
    const dateFor = id => (asOfSettled ? (dateByStation[String(id)] || today) : today);

    // Enrich each outlet with cockpit metrics for the rollup + scorecard + simulator.
    const stations = await Promise.all(rows.map(async r => {
      const md = dateFor(r.id);
      return { ...r, metric_date: md, ...(await outletMetrics(r.id, md)) };
    }));

    const inr = x => '₹' + Math.round(x).toLocaleString('en-IN');
    const sum = k => stations.reduce((s, r) => s + (parseFloat(r[k]) || 0), 0);
    const totalSales = sum('sales'), totalYest = sum('yest_sales'), totalMargin = sum('margin');
    const totals = {
      total_sales:   +totalSales.toFixed(2),
      total_litres:  +sum('litres').toFixed(1),
      total_margin:  +totalMargin.toFixed(2),
      group_margin_pct: totalSales > 0 ? +(totalMargin / totalSales * 100).toFixed(2) : null,
      vs_yesterday_pct: totalYest > 0 ? +((totalSales - totalYest) / totalYest * 100).toFixed(1) : null,
      cash_undeposited: +sum('cash_undeposited').toFixed(2),
      receivables_outstanding: +sum('outstanding').toFixed(2),
      overdue_90: +sum('overdue_90').toFixed(2),
      total_txns:    rows.reduce((s, r) => s + r.txn_count, 0),
      open_shifts:   rows.reduce((s, r) => s + r.open_shifts, 0),
      unread_alerts: rows.reduce((s, r) => s + r.unread_alerts, 0),
    };

    // Cross-outlet exceptions (action list for the owner)
    const exceptions = [];
    stations.forEach(o => {
      if (o.cash_undeposited > 5000) exceptions.push({ outlet: o.name, type: 'cash', text: `${o.name} — ${inr(o.cash_undeposited)} cash undeposited` });
      if (o.wetstock_beyond)         exceptions.push({ outlet: o.name, type: 'wetstock', text: `${o.name} — wet-stock loss beyond tolerance this month` });
      if (o.overdue_90 > 0)          exceptions.push({ outlet: o.name, type: 'overdue', text: `${o.name} — ${inr(o.overdue_90)} credit overdue 90+ days` });
    });

    // As-of summary for the UI label: a single date when every outlet shares one,
    // else the latest (outlets can settle on different days).
    const metricDates = [...new Set(stations.map(s => s.metric_date))];
    const as_of_uniform = metricDates.length <= 1;
    const as_of_date = metricDates.length ? metricDates.slice().sort().slice(-1)[0] : today;

    res.json({ stations, totals, exceptions, date: today, as_of_date, as_of_uniform, as_of_settled: asOfSettled });
  } catch (err) { next(err); }
});

// GET /api/groups/:id/stations — stations in a group
router.get('/:id/stations', authenticate, async (req, res, next) => {
  try {
    // Verify user belongs to group (same gate as /:id/dashboard)
    const { rows: member } = await pool.query(
      'SELECT 1 FROM owner_group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!member.length) return res.status(403).json({ error: 'Not a member of this group' });

    const { rows } = await pool.query(`
      SELECT s.* FROM stations s
      JOIN station_group_members sgm ON sgm.station_id = s.id
      JOIN station_groups stg ON stg.id = sgm.station_group_id
      WHERE stg.owner_group_id = $1 ORDER BY s.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
