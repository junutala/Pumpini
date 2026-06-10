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
        `SELECT tank_number, fuel_type, current_stock, capacity_ltrs,
                ROUND(current_stock/NULLIF(capacity_ltrs,0)*100,1) AS fill_pct
         FROM tanks WHERE station_id=$1 ORDER BY tank_number`, [station_id]),

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

    res.json({
      date,
      sales: sales.rows,
      shifts: shifts.rows,
      stock: stock.rows,
      alerts: alerts.rows,
      attendance: attendance.rows,
      variances,
      sales_masked: !isOwner && shifts.rows.some(s => s.status === 'open'),
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/manager?station_id=&shift_id=
router.get('/manager', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
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
        ORDER BY de.occurred_at DESC`, [id, today]),
      pool.query(`
        SELECT SUM(ct.amount) AS month_total, COUNT(*)::int AS txn_count
        FROM corporate_transactions ct
        JOIN dispense_events de ON de.id = ct.dispense_event_id
        WHERE ct.corporate_id=$1 AND de.occurred_at::date >= $2`, [id, monthStart]),
      pool.query(`
        SELECT cd.*, SUM(ct.amount) AS month_spend
        FROM corporate_drivers cd
        LEFT JOIN corporate_transactions ct ON ct.driver_id = cd.id
        LEFT JOIN dispense_events de ON de.id = ct.dispense_event_id AND de.occurred_at::date >= $2
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
      SELECT u.id AS attendant_id, u.name AS attendant_name,
        COUNT(*)::int                                                          AS total_recons,
        COUNT(*) FILTER (WHERE r.cash_actual < r.cash_expected)::int           AS undercash_count,
        COUNT(*) FILTER (WHERE r.cash_actual > r.cash_expected)::int           AS overcash_count,
        COALESCE(SUM(CASE WHEN r.cash_actual < r.cash_expected
                          THEN r.cash_expected - r.cash_actual ELSE 0 END),0)  AS total_short,
        MAX(CASE WHEN r.cash_actual < r.cash_expected THEN r.reconciled_at END) AS last_short_at
      FROM shift_reconciliation r
      JOIN shifts s ON s.id = r.shift_id
      JOIN users  u ON u.id = r.attendant_id
      WHERE s.station_id = $1
        AND r.manager_confirmed = TRUE
        AND r.reconciled_at >= NOW() - make_interval(days => $2)
      GROUP BY u.id, u.name
      HAVING COUNT(*) > 0
      ORDER BY undercash_count DESC, total_short DESC`,
      [station_id, days]);
    res.json(rows);
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
