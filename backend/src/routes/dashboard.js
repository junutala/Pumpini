// src/routes/dashboard.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, requireStationVia, requireCorporateAccess } = require('../middleware/stationAccess');

// GET /api/dashboard/owner?station_id=&date=
router.get('/owner', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, date = new Date().toISOString().slice(0,10) } = req.query;
    const isOwner = req.user.role === 'owner';

    const [sales, shifts, stock, alerts, attendance] = await Promise.all([
      // Today's sales by fuel type & payment mode — blind drop: non-owners
      // only see CLOSED-shift sales.
      pool.query(`
        SELECT de.fuel_type, de.payment_mode,
               COUNT(*)::int AS txn_count,
               SUM(de.quantity_ltrs) AS total_ltrs,
               SUM(de.amount) AS total_amount
        FROM dispense_events de
        JOIN shifts s ON s.id = de.shift_id
        WHERE de.station_id=$1 AND de.occurred_at::date = $2
          AND (s.status='closed' OR $3=TRUE)
          AND NOT COALESCE(de.is_voided,FALSE)
        GROUP BY de.fuel_type, de.payment_mode`, [station_id, date, isOwner]),

      // Open shifts
      pool.query(`
        SELECT s.*, u.name AS manager_name,
               COUNT(sa.attendant_id)::int AS attendants
        FROM shifts s
        LEFT JOIN users u ON u.id = s.manager_id
        LEFT JOIN shift_attendants sa ON sa.shift_id = s.id
        WHERE s.station_id=$1 AND s.date=$2
        GROUP BY s.id, u.name`, [station_id, date]),

      // Tank stock
      pool.query(
        `SELECT t.tank_number, t.fuel_type, t.current_stock, t.capacity_ltrs,
                ROUND(t.current_stock/NULLIF(t.capacity_ltrs,0)*100,1) AS fill_pct,
                (SELECT MAX(dr.recorded_at) FROM dipstick_readings dr WHERE dr.tank_id=t.id) AS last_dip_at
         FROM tanks t WHERE t.station_id=$1 ORDER BY t.tank_number`, [station_id]),

      // Unacknowledged alerts
      pool.query(
        `SELECT * FROM alerts WHERE station_id=$1 AND acknowledged_at IS NULL
         ORDER BY sent_at DESC LIMIT 10`, [station_id]),

      // Attendance today
      pool.query(`
        SELECT a.status, COUNT(*)::int AS count
        FROM attendance a WHERE a.station_id=$1 AND a.date=$2
        GROUP BY a.status`, [station_id, date]),
    ]);

    // Reconciliation variances today
    const { rows: variances } = await pool.query(`
      SELECT r.*, u.name AS attendant_name
      FROM shift_reconciliation r
      JOIN shifts sh ON sh.id = r.shift_id
      JOIN users u ON u.id = r.attendant_id
      WHERE sh.station_id=$1 AND sh.date=$2 AND ABS(r.variance) > 50
      ORDER BY ABS(r.variance) DESC`, [station_id, date]);

    // Per-operator settlement, broken down by payment type — every attendant of
    // the LATEST closed shift. Keyed on the most-recent reconciliation's
    // (date, shift_number), NOT a single shift_id: one operating shift can be
    // split across multiple shift records (e.g. Mahesh on his own shift_id while
    // the other operators share another, both "Shift 1, Jun 22"), and we want ALL
    // of them. Deliberately not calendar-scoped (a shift can settle next morning).
    // Settlement is the blind-drop reveal point, so only manager-confirmed rows.
    const { rows: settlements } = await pool.query(`
      SELECT r.attendant_id, u.name AS attendant_name, sh.shift_number, sh.date AS shift_date,
             r.total_sales, r.cash_actual, r.cash_expected, r.variance,
             r.card_total, r.upi_total, r.credit_total, r.petty_cash,
             r.reconciled_at
      FROM shift_reconciliation r
      JOIN shifts sh ON sh.id = r.shift_id
      JOIN users u ON u.id = r.attendant_id
      WHERE sh.station_id = $1 AND r.manager_confirmed = TRUE
        AND (sh.date, sh.shift_number) = (
          SELECT sh2.date, sh2.shift_number
          FROM shift_reconciliation r2
          JOIN shifts sh2 ON sh2.id = r2.shift_id
          WHERE sh2.station_id = $1 AND r2.manager_confirmed = TRUE
          ORDER BY r2.reconciled_at DESC
          LIMIT 1
        )
      ORDER BY r.reconciled_at`, [station_id]);

    // Held suspense balances (running, station-wide): petty-cash fund and
    // un-invoiced credit. Best-effort + separate so a not-yet-migrated table
    // can't break the dashboard.
    let credit_suspense = 0, petty_cash = 0;
    try {
      const { rows } = await pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS bal FROM petty_cash_entries WHERE station_id=$1`, [station_id]);
      petty_cash = Number(rows[0].bal || 0);
    } catch { /* table absent */ }
    try {
      const { rows } = await pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS bal FROM credit_suspense_entries WHERE station_id=$1`, [station_id]);
      credit_suspense = Number(rows[0].bal || 0);
    } catch { /* table absent until migration 004 */ }

    // ── Cockpit metrics (best-effort — never break the dashboard) ──────
    // Margin cost basis = LAST delivery rate per fuel (owner-chosen). Litres come
    // from the sales rollup, so margin honours blind-drop (closed shifts only for
    // non-owners). Days-of-cover = current stock ÷ trailing 7-day avg daily litres.
    let margin = null, cover = [], last_settlement = null, wetstock_mtd = null;
    let receivables = { to_invoice: credit_suspense, outstanding: 0, overdue_90: 0 };
    let ai_briefing = [];
    try {
      const monthStart = date.slice(0, 8) + '01';
      const [prices, buyRates, trail, recv, lastSet, wet] = await Promise.all([
        pool.query(`SELECT DISTINCT ON (fuel_type) fuel_type, price FROM fuel_prices
                    WHERE station_id=$1 ORDER BY fuel_type, effective_from DESC`, [station_id]),
        pool.query(`SELECT DISTINCT ON (fuel_type) fuel_type, rate_per_ltr FROM fuel_deliveries
                    WHERE station_id=$1 AND rate_per_ltr IS NOT NULL
                    ORDER BY fuel_type, received_at DESC NULLS LAST`, [station_id]),
        pool.query(`SELECT n.fuel_type, COALESCE(SUM(de.quantity_ltrs),0)/7.0 AS avg_daily
                    FROM dispense_events de JOIN nozzles n ON n.id=de.nozzle_id
                    WHERE de.station_id=$1 AND de.occurred_at::date > $2::date - 7
                      AND NOT COALESCE(de.is_voided,FALSE)
                    GROUP BY n.fuel_type`, [station_id, date]),
        pool.query(`SELECT
                      COALESCE((SELECT SUM(total_amount) FROM gst_invoices WHERE station_id=$1),0) AS invoiced,
                      COALESCE((SELECT SUM(amount) FROM corporate_receipts WHERE station_id=$1),0) AS received,
                      COALESCE((SELECT SUM(total_amount) FROM gst_invoices WHERE station_id=$1 AND invoice_date <= $2::date - 90),0) AS invoiced_old`,
                    [station_id, date]),
        pool.query(`SELECT r.cash_actual, r.upi_total, r.card_total, r.credit_total, r.petty_cash,
                           r.total_sales, r.variance, r.reconciled_at, u.name AS attendant_name, sh.shift_number
                    FROM shift_reconciliation r JOIN shifts sh ON sh.id=r.shift_id JOIN users u ON u.id=r.attendant_id
                    WHERE sh.station_id=$1 AND r.manager_confirmed=TRUE
                    ORDER BY r.reconciled_at DESC LIMIT 1`, [station_id]),
        pool.query(`SELECT COALESCE(SUM(variance_ltrs),0) AS var_ltrs, BOOL_OR(beyond_tolerance) AS beyond
                    FROM tank_reconciliation WHERE station_id=$1 AND created_at >= $2`, [station_id, monthStart])
          .catch(() => ({ rows: [{ var_ltrs: 0, beyond: false }] })),
      ]);

      const sell = {}; prices.rows.forEach(r => { sell[r.fuel_type] = parseFloat(r.price); });
      const buy  = {}; buyRates.rows.forEach(r => { buy[r.fuel_type] = parseFloat(r.rate_per_ltr); });
      const ltrsByFuel = {};
      sales.rows.forEach(r => { ltrsByFuel[r.fuel_type] = (ltrsByFuel[r.fuel_type] || 0) + parseFloat(r.total_ltrs || 0); });
      let marginAmt = 0, salesAmt = 0;
      Object.keys(ltrsByFuel).forEach(ft => {
        const l = ltrsByFuel[ft];
        if (sell[ft] != null) salesAmt += l * sell[ft];
        if (sell[ft] != null && buy[ft] != null) marginAmt += l * (sell[ft] - buy[ft]);
      });
      margin = { amount: +marginAmt.toFixed(2), pct: salesAmt > 0 ? +(marginAmt / salesAmt * 100).toFixed(1) : null, basis: 'last_delivery' };

      const avgDaily = {}; trail.rows.forEach(r => { avgDaily[r.fuel_type] = parseFloat(r.avg_daily); });
      cover = stock.rows.map(t => {
        const ad = avgDaily[t.fuel_type] || 0;
        // CNG has no dipstick, so current_stock is never refreshed — a days-of-cover
        // figure off that stale value is meaningless (and triggered false "running low"
        // alerts). Suppress it; the UI already shows CNG as "by kg · no dip".
        const isGas = (t.fuel_type || '').toLowerCase() === 'cng';
        return { tank_number: t.tank_number, fuel_type: t.fuel_type, fill_pct: t.fill_pct,
                 litres: t.current_stock != null ? Math.round(parseFloat(t.current_stock)) : null,
                 as_of: t.last_dip_at || null,   // last dip timestamp (null for CNG / never dipped)
                 days: (!isGas && ad > 0) ? +(parseFloat(t.current_stock) / ad).toFixed(1) : null };
      });

      const rv = recv.rows[0];
      const outstanding = Math.max(0, parseFloat(rv.invoiced) - parseFloat(rv.received));
      const overdue90   = Math.max(0, Math.min(outstanding, parseFloat(rv.invoiced_old) - parseFloat(rv.received)));
      receivables = { to_invoice: credit_suspense, outstanding: +outstanding.toFixed(2), overdue_90: +overdue90.toFixed(2) };

      if (lastSet.rows.length) {
        const r = lastSet.rows[0];
        last_settlement = {
          attendant_name: r.attendant_name, shift_number: r.shift_number, at: r.reconciled_at,
          cash: Number(r.cash_actual || 0), upi: Number(r.upi_total || 0), card: Number(r.card_total || 0),
          credit: Number(r.credit_total || 0), petty: Number(r.petty_cash || 0),
          total: Number(r.total_sales || 0), variance: Number(r.variance || 0),
        };
      }
      wetstock_mtd = { variance_ltrs: Number(wet.rows[0].var_ltrs || 0), beyond_tolerance: !!wet.rows[0].beyond };

      // Rule-based briefing v1 (LLM version is a fast-follow)
      const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
      const low = cover.filter(c => c.days != null && c.days < 2).sort((a, b) => a.days - b.days)[0];
      if (low) ai_briefing.push(`${low.fuel_type} (tank ${low.tank_number}) ~${low.days} days of cover — plan a refill.`);
      if (wetstock_mtd.beyond_tolerance) ai_briefing.push('Wet-stock variance is beyond tolerance this month — worth a surprise dip.');
      if (receivables.overdue_90 > 0) ai_briefing.push(`${inr(receivables.overdue_90)} of credit is 90+ days overdue.`);
      if (credit_suspense > 0) ai_briefing.push(`${inr(credit_suspense)} credit is waiting to be invoiced.`);
    } catch (e) { /* cockpit metrics are additive — keep the core dashboard alive */ }

    // ── Per-shift sales — one tile per shift (owner UX), NOT a merged daily total.
    // Filed by the day the shift CLOSES (end_time), so a shift crossing midnight
    // lands on its close date. Blind-drop preserved: non-owners get closed shifts
    // only. Best-effort — never break the core dashboard.
    let sales_by_shift = [];
    try {
      const { rows } = await pool.query(`
        SELECT s.id AS shift_id, s.shift_number, s.date AS shift_date,
               s.start_time, s.end_time, s.status,
               de.fuel_type, de.payment_mode,
               COUNT(*)::int         AS txn_count,
               SUM(de.quantity_ltrs) AS total_ltrs,
               SUM(de.amount)        AS total_amount
        FROM shifts s
        JOIN dispense_events de ON de.shift_id = s.id AND NOT COALESCE(de.is_voided, FALSE)
        WHERE s.station_id = $1
          AND COALESCE((s.end_time   AT TIME ZONE 'Asia/Kolkata')::date,
                       (s.start_time AT TIME ZONE 'Asia/Kolkata')::date, s.date) = $2
          AND (s.status = 'closed' OR $3 = TRUE)
        GROUP BY s.id, s.shift_number, s.date, s.start_time, s.end_time, s.status,
                 de.fuel_type, de.payment_mode
        ORDER BY s.start_time NULLS LAST, s.shift_number`, [station_id, date, isOwner]);
      const byId = new Map();
      for (const r of rows) {
        let sh = byId.get(r.shift_id);
        if (!sh) {
          sh = { shift_id: r.shift_id, shift_number: r.shift_number, shift_date: r.shift_date,
                 start_time: r.start_time, end_time: r.end_time, status: r.status,
                 total_amount: 0, total_ltrs: 0, fuels: {}, payments: {} };
          byId.set(r.shift_id, sh);
        }
        const amt = parseFloat(r.total_amount || 0), ltr = parseFloat(r.total_ltrs || 0);
        sh.total_amount += amt; sh.total_ltrs += ltr;
        if (r.fuel_type)    sh.fuels[r.fuel_type]       = (sh.fuels[r.fuel_type] || 0) + ltr;
        if (r.payment_mode) sh.payments[r.payment_mode] = (sh.payments[r.payment_mode] || 0) + amt;
      }
      sales_by_shift = Array.from(byId.values());
    } catch (e) { /* additive — keep the core dashboard alive */ }

    res.json({
      date,
      sales: sales.rows,
      sales_by_shift,
      shifts: shifts.rows,
      stock: stock.rows,
      alerts: alerts.rows,
      attendance: attendance.rows,
      variances,
      settlements,
      suspense: { credit_suspense, petty_cash },
      // Margin (sell − buy) is owner-only — managers must not see it. Null it out
      // server-side rather than hiding client-side, same posture as blind-drop sales.
      margin: isOwner ? margin : null,
      cover, receivables, last_settlement, wetstock_mtd, ai_briefing,
      sales_masked: !isOwner && shifts.rows.some(s => s.status === 'open'),
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/manager?station_id=&shift_id=
// Everything below keys off shift_id, so guard the shift (not just station_id)
// — same as the /attendant sibling — or a foreign shift_id leaks another outlet.
router.get('/manager', authenticate, requireStationAccess({ required: true }), requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const { station_id, shift_id } = req.query;
    const isOwner = req.user.role === 'owner';
    const { rows: shiftRow } = await pool.query('SELECT status FROM shifts WHERE id=$1', [shift_id]);
    const hideSales = !isOwner && shiftRow[0]?.status === 'open';

    const [liveEvents, attendantSummary, recoStatus] = await Promise.all([
      pool.query(`
        SELECT de.*, u.name AS attendant_name, n.nozzle_number
        FROM dispense_events de
        LEFT JOIN users u ON u.id = de.attendant_id
        LEFT JOIN nozzles n ON n.id = de.nozzle_id
        WHERE de.shift_id=$1 ORDER BY de.event_seq DESC LIMIT 50`, [shift_id]),

      pool.query(`
        SELECT sa.attendant_id, u.name, r.tag_uid, n.nozzle_number, n.fuel_type,
               COALESCE(SUM(de.amount),0) AS sales, COALESCE(SUM(de.quantity_ltrs),0) AS litres,
               COUNT(de.id)::int AS txn_count
        FROM shift_attendants sa
        JOIN users u ON u.id = sa.attendant_id
        LEFT JOIN rfid_tags r ON r.id = sa.rfid_tag_id
        LEFT JOIN nozzles n ON n.id = sa.nozzle_id
        LEFT JOIN dispense_events de ON de.attendant_id = sa.attendant_id AND de.shift_id = sa.shift_id
          AND NOT COALESCE(de.is_voided,FALSE)
        WHERE sa.shift_id=$1
        GROUP BY sa.attendant_id, u.name, r.tag_uid, n.nozzle_number, n.fuel_type`, [shift_id]),

      pool.query(
        `SELECT r.*, u.name AS attendant_name FROM shift_reconciliation r
         JOIN users u ON u.id = r.attendant_id WHERE r.shift_id=$1`, [shift_id]),
    ]);

    res.json({
      live_events: hideSales
        ? liveEvents.rows.map(r => ({ ...r, amount: null, quantity_ltrs: null, sales_hidden: true }))
        : liveEvents.rows,
      attendant_summary: hideSales
        ? attendantSummary.rows.map(r => ({ ...r, sales: null, litres: null, sales_hidden: true }))
        : attendantSummary.rows,
      reconciliation: recoStatus.rows,
      sales_hidden: hideSales,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/corporate/:id
router.get('/corporate/:id', authenticate, requireCorporateAccess(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const today = new Date().toISOString().slice(0,10);
    const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0,10);

    const [account, todayTxns, monthTxns, drivers] = await Promise.all([
      pool.query(
        `SELECT *, (credit_limit-current_outstanding) AS available_credit
         FROM corporate_accounts WHERE id=$1`, [id]),
      pool.query(`
        SELECT ct.amount, cd.name AS driver, cd.vehicle_number, de.fuel_type, de.quantity_ltrs, de.occurred_at
        FROM corporate_transactions ct
        JOIN corporate_drivers cd ON cd.id = ct.driver_id
        JOIN dispense_events de ON de.id = ct.dispense_event_id
        WHERE ct.corporate_id=$1 AND de.occurred_at::date=$2
          AND NOT COALESCE(de.is_voided,FALSE)
        ORDER BY de.occurred_at DESC`, [id, today]),
      pool.query(`
        SELECT SUM(ct.amount) AS month_total, COUNT(*)::int AS txn_count
        FROM corporate_transactions ct
        JOIN dispense_events de ON de.id = ct.dispense_event_id
        WHERE ct.corporate_id=$1 AND de.occurred_at::date >= $2
          AND NOT COALESCE(de.is_voided,FALSE)`, [id, monthStart]),
      pool.query(`
        SELECT cd.*, SUM(ct.amount) AS month_spend
        FROM corporate_drivers cd
        LEFT JOIN corporate_transactions ct ON ct.driver_id = cd.id
        LEFT JOIN dispense_events de ON de.id = ct.dispense_event_id AND de.occurred_at::date >= $2
          AND NOT COALESCE(de.is_voided,FALSE)
        WHERE cd.corporate_id=$1 AND cd.is_active=TRUE
        GROUP BY cd.id ORDER BY cd.name`, [id, monthStart]),
    ]);

    res.json({
      account: account.rows[0],
      today: todayTxns.rows,
      month_summary: monthTxns.rows[0],
      drivers: drivers.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/my-consolidated
// Read-only consolidated ledger for a credit customer ACROSS every profile that
// shares their PAN — even when those profiles belong to DIFFERENT owners/bunks.
// Reachable ONLY by the customer themselves (role=corporate), scoped strictly to
// the PAN on their own corporate_id. No owner/station/manager login can hit this.
router.get('/my-consolidated', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'corporate' || !req.user.corporate_id) {
      return res.status(403).json({ error: 'Consolidated view is for credit-customer logins only.' });
    }
    // Resolve the caller's PAN from their OWN account only.
    const { rows: self } = await pool.query(
      'SELECT id, company_name, pan FROM corporate_accounts WHERE id=$1', [req.user.corporate_id]
    );
    if (!self.length) return res.status(404).json({ error: 'Account not found' });
    const pan = (self[0].pan || '').trim().toUpperCase();

    // Sibling profiles share the same PAN (across owners). No PAN → just self.
    const { rows: profiles } = pan
      ? await pool.query(
          `SELECT ca.id, ca.company_name, ca.created_by_station AS station_id,
                  s.name AS station_name, ca.credit_limit, ca.current_outstanding
           FROM corporate_accounts ca
           LEFT JOIN stations s ON s.id = ca.created_by_station
           WHERE UPPER(TRIM(ca.pan)) = $1 AND ca.is_active = TRUE
           ORDER BY ca.company_name`, [pan])
      : await pool.query(
          `SELECT ca.id, ca.company_name, ca.created_by_station AS station_id,
                  s.name AS station_name, ca.credit_limit, ca.current_outstanding
           FROM corporate_accounts ca
           LEFT JOIN stations s ON s.id = ca.created_by_station
           WHERE ca.id = $1`, [req.user.corporate_id]);

    const ids = profiles.map(p => p.id);
    if (!ids.length) {
      return res.json({ company_name: self[0].company_name, pan, profiles: [], ledger: [], totals: {} });
    }

    // Four ledger sources across ALL sibling profiles: fuel credit, lube credit,
    // payments received, and credit notes. Each tagged with its bunk name.
    const [fuel, lube, receipts, notes] = await Promise.all([
      pool.query(`
        SELECT de.occurred_at AS date, de.amount, de.quantity_ltrs, de.fuel_type,
               s.name AS station_name
        FROM dispense_events de
        LEFT JOIN stations s ON s.id = de.station_id
        WHERE de.corporate_id = ANY($1) AND de.payment_mode='credit'
          AND NOT COALESCE(de.is_voided,FALSE)
        ORDER BY de.occurred_at DESC LIMIT 500`, [ids]),
      pool.query(`
        SELECT pi.created_at AS date, pi.grand_total AS amount, pi.invoice_number,
               s.name AS station_name
        FROM product_invoices pi
        LEFT JOIN stations s ON s.id = pi.station_id
        WHERE pi.customer_type='credit' AND pi.customer_id = ANY($1)
        ORDER BY pi.created_at DESC LIMIT 500`, [ids]),
      pool.query(`
        SELECT cr.receipt_date AS date, cr.amount, cr.payment_type,
               s.name AS station_name
        FROM corporate_receipts cr
        LEFT JOIN stations s ON s.id = cr.station_id
        WHERE cr.corporate_id = ANY($1)
        ORDER BY cr.receipt_date DESC LIMIT 500`, [ids]),
      pool.query(`
        SELECT cn.created_at AS date, cn.grand_total AS amount, cn.cn_number,
               s.name AS station_name
        FROM product_credit_notes cn
        LEFT JOIN stations s ON s.id = cn.station_id
        WHERE cn.customer_type='credit' AND cn.customer_id = ANY($1)
        ORDER BY cn.created_at DESC LIMIT 500`, [ids]),
    ]);

    const ledger = [
      ...fuel.rows.map(r => ({ date: r.date, station_name: r.station_name, type: 'fuel',
        description: `${r.fuel_type || 'Fuel'}${r.quantity_ltrs ? ` · ${Number(r.quantity_ltrs).toFixed(2)} L` : ''}`,
        debit: parseFloat(r.amount || 0), credit: 0 })),
      ...lube.rows.map(r => ({ date: r.date, station_name: r.station_name, type: 'lube',
        description: `Lube invoice ${r.invoice_number || ''}`.trim(), debit: parseFloat(r.amount || 0), credit: 0 })),
      ...receipts.rows.map(r => ({ date: r.date, station_name: r.station_name, type: 'payment',
        description: `Payment received (${r.payment_type || '—'})`, debit: 0, credit: parseFloat(r.amount || 0) })),
      ...notes.rows.map(r => ({ date: r.date, station_name: r.station_name, type: 'credit_note',
        description: `Credit note ${r.cn_number || ''}`.trim(), debit: 0, credit: parseFloat(r.amount || 0) })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const totals = {
      total_outstanding:  profiles.reduce((s, p) => s + parseFloat(p.current_outstanding || 0), 0),
      total_credit_limit: profiles.reduce((s, p) => s + parseFloat(p.credit_limit || 0), 0),
      total_purchases:    ledger.reduce((s, r) => s + r.debit, 0),
      total_paid:         ledger.reduce((s, r) => s + r.credit, 0),
      profile_count:      profiles.length,
    };

    res.json({ company_name: self[0].company_name, pan, profiles, ledger, totals });
  } catch (err) { next(err); }
});

// GET /api/dashboard/cash-integrity?station_id=&days=90
// Per-operator cash honesty signal. A clean operator's drawer is over or exact,
// never under — so repeated UNDERCASH (even when made good on the spot) marks a
// suspect for the owner. Counts confirmed reconciliations only.
router.get('/cash-integrity', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days || 90)));
    const { rows } = await pool.query(`
      WITH confirmed AS (
        SELECT r.attendant_id, r.cash_actual, r.cash_expected, r.reconciled_at
        FROM shift_reconciliation r
        JOIN shifts s ON s.id = r.shift_id
        WHERE s.station_id = $1
          AND r.manager_confirmed = TRUE
          AND r.reconciled_at >= NOW() - make_interval(days => $2)
      ),
      agg AS (
        SELECT attendant_id,
          COUNT(*)::int                                                        AS total_recons,
          COUNT(*) FILTER (WHERE cash_actual < cash_expected)::int             AS undercash_count,
          COUNT(*) FILTER (WHERE cash_actual > cash_expected)::int             AS overcash_count,
          COALESCE(SUM(CASE WHEN cash_actual < cash_expected
                            THEN cash_expected - cash_actual ELSE 0 END),0)    AS total_short,
          MAX(CASE WHEN cash_actual < cash_expected THEN reconciled_at END)    AS last_short_at
        FROM confirmed GROUP BY attendant_id
      ),
      last AS (
        SELECT DISTINCT ON (attendant_id) attendant_id,
          reconciled_at                  AS last_recon_at,
          cash_actual                    AS last_cash_actual,
          cash_expected                  AS last_cash_expected,
          (cash_actual - cash_expected)  AS last_variance
        FROM confirmed ORDER BY attendant_id, reconciled_at DESC
      )
      SELECT u.id AS attendant_id, u.name AS attendant_name,
        a.total_recons, a.undercash_count, a.overcash_count, a.total_short, a.last_short_at,
        l.last_recon_at, l.last_cash_actual, l.last_cash_expected, l.last_variance
      FROM agg a
      JOIN users u ON u.id = a.attendant_id
      LEFT JOIN last l ON l.attendant_id = a.attendant_id
      ORDER BY a.undercash_count DESC, a.total_short DESC`,
      [station_id, days]);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/dashboard/margin?station_id=&date=
// Owner-only purchase economics: gross fuel margin for the day. Cost basis is
// the volume-weighted landed cost (rate × gross vol + freight, over NET litres
// that reached the tank) of the last 45 days of deliveries per fuel, falling
// back to the most recent costed delivery ever. Selling side is the day's
// dispense events. Managers/attendants never see purchase rates.
router.get('/margin', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Margin view is for owners only.' });
    }
    const { station_id, date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) } = req.query;

    // Dry-stock line cost: weighted average of costed stock receipts for the
    // product, falling back to the catalogue buying price (0 = not set).
    const DRY_COST_LATERAL = `
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT SUM(sr.quantity * sr.buying_price) / NULLIF(SUM(sr.quantity), 0)
             FROM product_stock_receipts sr
            WHERE sr.product_id = pii.product_id AND sr.buying_price > 0),
          NULLIF(p.buying_price, 0)
        ) AS unit_cost
        FROM products p WHERE p.id = pii.product_id
      ) pc ON TRUE`;
    const DRY_AGG = `
      COALESCE(SUM(pii.quantity * pii.unit_price), 0)                                            AS revenue,
      COALESCE(SUM(pii.quantity), 0)                                                             AS units,
      COALESCE(SUM(CASE WHEN pc.unit_cost IS NOT NULL THEN pii.quantity * pii.unit_price END), 0) AS costed_revenue,
      COALESCE(SUM(CASE WHEN pc.unit_cost IS NOT NULL THEN pii.quantity * pc.unit_cost END), 0)   AS cost,
      COUNT(*) FILTER (WHERE pc.unit_cost IS NULL)::int                                           AS uncosted_lines`;

    const [sales, recentCost, latestCost, drySales, dryReturns] = await Promise.all([
      pool.query(`
        SELECT de.fuel_type,
               COUNT(*)::int            AS txn_count,
               SUM(de.quantity_ltrs)    AS litres,
               SUM(de.amount)           AS revenue
        FROM dispense_events de
        WHERE de.station_id = $1 AND de.occurred_at::date = $2
          AND NOT COALESCE(de.is_voided, FALSE)
        GROUP BY de.fuel_type`, [station_id, date]),

      // Volume-weighted landed cost over recent deliveries
      pool.query(`
        SELECT fuel_type, SUM(cost) / NULLIF(SUM(vol), 0) AS wac, SUM(vol) AS vol
        FROM (
          SELECT COALESCE(t.fuel_type, fd.fuel_type) AS fuel_type,
                 COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs) AS vol,
                 COALESCE(fd.total_value,
                          fd.rate_per_ltr * fd.gross_volume_ltrs + COALESCE(fd.freight, 0)) AS cost
          FROM fuel_deliveries fd
          LEFT JOIN tanks t ON t.id = fd.tank_id
          WHERE fd.station_id = $1
            AND fd.received_at >= NOW() - INTERVAL '45 days'
        ) x
        WHERE cost IS NOT NULL AND vol > 0
        GROUP BY fuel_type`, [station_id]),

      // Fallback: most recent delivery that carried a cost, regardless of age
      pool.query(`
        SELECT DISTINCT ON (fuel_type) fuel_type, cost / vol AS unit_cost
        FROM (
          SELECT COALESCE(t.fuel_type, fd.fuel_type) AS fuel_type, fd.received_at,
                 COALESCE(fd.net_volume_ltrs, fd.gross_volume_ltrs) AS vol,
                 COALESCE(fd.total_value,
                          fd.rate_per_ltr * fd.gross_volume_ltrs + COALESCE(fd.freight, 0)) AS cost
          FROM fuel_deliveries fd
          LEFT JOIN tanks t ON t.id = fd.tank_id
          WHERE fd.station_id = $1
        ) x
        WHERE cost IS NOT NULL AND vol > 0
        ORDER BY fuel_type, received_at DESC`, [station_id]),

      // Dry stock (lubes/shop POS): taxable revenue vs product cost, today
      pool.query(`
        SELECT ${DRY_AGG}, COUNT(DISTINCT pi.id)::int AS invoice_count
        FROM product_invoice_items pii
        JOIN product_invoices pi ON pi.id = pii.invoice_id
        ${DRY_COST_LATERAL}
        WHERE pi.station_id = $1
          AND COALESCE(pi.invoice_date::date, pi.created_at::date) = $2`, [station_id, date]),

      // Returns issued today reverse both revenue and cost
      pool.query(`
        SELECT ${DRY_AGG}
        FROM product_credit_note_items pii
        JOIN product_credit_notes pi ON pi.id = pii.credit_note_id
        ${DRY_COST_LATERAL}
        WHERE pi.station_id = $1 AND pi.created_at::date = $2`, [station_id, date]),
    ]);

    const wacMap = {};
    latestCost.rows.forEach(r => { wacMap[r.fuel_type] = { wac: parseFloat(r.unit_cost), source: 'latest' }; });
    recentCost.rows.forEach(r => { wacMap[r.fuel_type] = { wac: parseFloat(r.wac), source: 'recent' }; });

    const fuels = sales.rows.map(r => {
      const litres  = parseFloat(r.litres || 0);
      const revenue = parseFloat(r.revenue || 0);
      const c = wacMap[r.fuel_type];
      const cost   = c ? +(litres * c.wac).toFixed(2) : null;
      const margin = c ? +(revenue - cost).toFixed(2) : null;
      return {
        fuel_type:     r.fuel_type,
        txn_count:     r.txn_count,
        litres,
        revenue,
        sell_rate_avg: litres > 0 ? +(revenue / litres).toFixed(2) : null,
        wac:           c ? +c.wac.toFixed(2) : null,
        wac_source:    c ? c.source : null,
        cost,
        margin,
        margin_per_ltr: c && litres > 0 ? +((revenue - cost) / litres).toFixed(2) : null,
      };
    });

    const costed = fuels.filter(f => f.margin != null);
    const fuelRevenue = fuels.reduce((s, f) => s + f.revenue, 0);
    const fuelMargin  = costed.reduce((s, f) => s + f.margin, 0);

    // Dry stock: sales minus returns, margin only over costed lines
    const ds = drySales.rows[0], dr = dryReturns.rows[0];
    const dry = {
      revenue:        +(parseFloat(ds.revenue) - parseFloat(dr.revenue)).toFixed(2),
      units:          +(parseFloat(ds.units) - parseFloat(dr.units)).toFixed(2),
      invoice_count:  ds.invoice_count,
      cost:           +(parseFloat(ds.cost) - parseFloat(dr.cost)).toFixed(2),
      margin:         +((parseFloat(ds.costed_revenue) - parseFloat(ds.cost))
                      - (parseFloat(dr.costed_revenue) - parseFloat(dr.cost))).toFixed(2),
      uncosted_lines: ds.uncosted_lines + dr.uncosted_lines,
    };

    res.json({
      date,
      fuels,
      dry,
      totals: {
        revenue:     +(fuelRevenue + dry.revenue).toFixed(2),
        margin:      +(fuelMargin + dry.margin).toFixed(2),
        fuel_margin: +fuelMargin.toFixed(2),
        dry_margin:  dry.margin,
        litres:      fuels.reduce((s, f) => s + f.litres, 0),
      },
      missing_cost: fuels.filter(f => f.wac == null).map(f => f.fuel_type),
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/attendant?attendant_id=&shift_id=
router.get('/attendant', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const { attendant_id, shift_id } = req.query;
    const isOwner = req.user.role === 'owner';
    const { rows: shiftRow } = await pool.query('SELECT status FROM shifts WHERE id=$1', [shift_id]);
    const hideSales = !isOwner && shiftRow[0]?.status === 'open';

    const { rows } = await pool.query(`
      SELECT de.*, n.nozzle_number, n.fuel_type
      FROM dispense_events de
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      WHERE de.attendant_id=$1 AND de.shift_id=$2
      ORDER BY de.event_seq`, [attendant_id, shift_id]);

    if (hideSales) {
      return res.json({
        events: rows.map(r => ({ ...r, amount: null, quantity_ltrs: null })),
        summary: null,
        sales_hidden: true,
      });
    }

    const summary = {
      total_sales: rows.reduce((s,r) => s + parseFloat(r.amount),0),
      total_ltrs:  rows.reduce((s,r) => s + parseFloat(r.quantity_ltrs),0),
      cash:        rows.filter(r => r.payment_mode==='cash').reduce((s,r) => s+parseFloat(r.amount),0),
      upi:         rows.filter(r => r.payment_mode==='upi').reduce((s,r)  => s+parseFloat(r.amount),0),
      credit:      rows.filter(r => r.payment_mode==='credit').reduce((s,r)=>s+parseFloat(r.amount),0),
      txn_count:   rows.length,
    };

    res.json({ events: rows, summary });
  } catch (err) { next(err); }
});

module.exports = router;
