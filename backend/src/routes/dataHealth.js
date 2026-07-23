// src/routes/dataHealth.js
//
// Read-only data-health tripwire endpoints. Additive + column-tolerant: nothing
// here writes, and the underlying service degrades to empty flags on any query
// error, so these can never 500 a dashboard. All flag logic lives in
// services/dataHealthService.js (one computation writer for the concept).
//
// Scoping mirrors the existing dashboard/groups endpoints exactly:
//   - GET /station     : authenticate + requireStationAccess (manager or owner,
//                        strictly their own station — IDOR-guarded).
//   - GET /group/:id   : owner-only + owner_group membership check, then the
//                        rollup spans exactly the stations in that group.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { computeDataHealth, THRESHOLDS } = require('../services/dataHealthService');

// GET /api/data-health/station?station_id=
// Per-outlet flags for the manager dashboard (and the owner's embedded cockpit).
router.get('/station', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const health = await computeDataHealth([station_id]);
    const entry = health[station_id] || { count: 0, flags: [] };
    res.json({ station_id, count: entry.count, flags: entry.flags, thresholds: THRESHOLDS });
  } catch (err) { next(err); }
});

// GET /api/data-health/group/:id
// Owner rollup across every station in the group — one aggregate pass, no N+1.
router.get('/group/:id', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    // Same membership gate as GET /api/groups/:id/dashboard.
    const { rows: member } = await pool.query(
      'SELECT 1 FROM owner_group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!member.length) return res.status(403).json({ error: 'Not a member of this group' });

    // Stations in the group (same join chain as groups.js).
    const { rows: stationRows } = await pool.query(
      `SELECT s.id, s.name
         FROM stations s
         JOIN station_group_members sgm ON sgm.station_id = s.id
         JOIN station_groups stg        ON stg.id = sgm.station_group_id
        WHERE stg.owner_group_id = $1
        ORDER BY s.name`,
      [req.params.id]
    );

    const ids = stationRows.map(s => s.id);
    const health = await computeDataHealth(ids);

    const stations = stationRows.map(s => {
      const entry = health[s.id] || { count: 0, flags: [] };
      return { station_id: s.id, name: s.name, count: entry.count, flags: entry.flags };
    });
    const total = stations.reduce((sum, s) => sum + s.count, 0);

    res.json({ total, stations, thresholds: THRESHOLDS });
  } catch (err) { next(err); }
});

module.exports = router;
