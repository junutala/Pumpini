const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess, requireStationVia, getAccessibleStationIds } = require('../middleware/stationAccess');

router.get('/', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const { station_id, unread } = req.query;
    const p = [];
    let q = `SELECT * FROM alerts WHERE `;
    if (station_id) {
      p.push(station_id);
      q += `station_id=$${p.length}`;
    } else {
      // No explicit station → scope to the user's accessible stations
      const ids = await getAccessibleStationIds(req.user.id);
      if (!ids.length) return res.json([]);
      p.push(ids);
      q += `station_id = ANY($${p.length}::uuid[])`;
    }
    if (unread === 'true') q += ` AND acknowledged_at IS NULL`;
    q += ' ORDER BY sent_at DESC LIMIT 50';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

router.patch('/:id/acknowledge', authenticate, requireStationVia('SELECT station_id FROM alerts WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE alerts SET acknowledged_at=NOW() WHERE id=$1 RETURNING *', [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
