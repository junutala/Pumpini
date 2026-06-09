// src/routes/dashboard.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, requireStationVia, requireCorporateAccess } = require('../middleware/stationAccess');

// GET /api/dashboard/owner?station_id=&date=
router.get('/owner', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, date = new Date().toISOString().slice(0,10) } = req.query;

    const [sales, shifts, stock, alerts, attendance] = await Promise.all([
      // Today's sales by fuel type & payment mode
      pool.query(`
        SELECT fuel_type, payment_mode,
               COUNT(*)::int AS txn_count,
               SUM(quantity_ltrs) AS total_ltrs,
               SUM(amount) AS total_amount
        FROM dispense_events
        WHERE station_id=$1 AND occurred_at::date>=$2 AND occurred_at::date<=$3
        GROUP BY fuel_type, payment_mode`, [station_id, date, dateTo]),

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
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/manager?station_id=&shift_id=
router.get('/manager', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, shift_id } = req.query;

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
      live_events: liveEvents.rows,
      attendant_summary: attendantSummary.rows,
      reconciliation: recoStatus.rows,
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

// GET /api/dashboard/attendant?attendant_id=&shift_id=
router.get('/attendant', authenticate, requireStationVia('SELECT station_id FROM shifts WHERE id=$1', 'shift_id'), async (req, res, next) => {
  try {
    const { attendant_id, shift_id } = req.query;
    const { rows } = await pool.query(`
      SELECT de.*, n.nozzle_number, n.fuel_type
      FROM dispense_events de
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      WHERE de.attendant_id=$1 AND de.shift_id=$2
      ORDER BY de.event_seq`, [attendant_id, shift_id]);

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
