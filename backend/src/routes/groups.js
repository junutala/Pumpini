// src/routes/groups.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// GET /api/groups/my — groups the logged-in user belongs to
router.get('/my', authenticate, async (req, res, next) => {
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
router.get('/:id/dashboard', authenticate, async (req, res, next) => {
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
      LEFT JOIN dispense_events de ON de.station_id = s.id AND de.occurred_at::date = $2
      LEFT JOIN shifts sh ON sh.station_id = s.id AND sh.date = $2
      LEFT JOIN alerts al ON al.station_id = s.id
      WHERE stg.owner_group_id = $1
      GROUP BY s.id ORDER BY s.name`,
      [req.params.id, today]
    );

    const totals = {
      total_sales:   rows.reduce((s, r) => s + parseFloat(r.today_sales), 0),
      total_litres:  rows.reduce((s, r) => s + parseFloat(r.today_litres), 0),
      total_txns:    rows.reduce((s, r) => s + r.txn_count, 0),
      open_shifts:   rows.reduce((s, r) => s + r.open_shifts, 0),
      unread_alerts: rows.reduce((s, r) => s + r.unread_alerts, 0),
    };

    res.json({ stations: rows, totals, date: today });
  } catch (err) { next(err); }
});

// GET /api/groups/:id/stations — stations in a group
router.get('/:id/stations', authenticate, async (req, res, next) => {
  try {
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
