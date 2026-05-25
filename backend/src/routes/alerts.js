const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { station_id, unread } = req.query;
    let q = `SELECT * FROM alerts WHERE station_id=$1`;
    const p = [station_id];
    if (unread === 'true') q += ` AND acknowledged_at IS NULL`;
    q += ' ORDER BY sent_at DESC LIMIT 50';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

router.patch('/:id/acknowledge', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE alerts SET acknowledged_at=NOW() WHERE id=$1 RETURNING *', [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
