const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const { rows } = await pool.query(
      `SELECT rt.*, sa.attendant_id, u.name AS attendant_name
       FROM rfid_tags rt
       LEFT JOIN shift_attendants sa ON sa.rfid_tag_id=rt.id
       LEFT JOIN users u ON u.id=sa.attendant_id
       WHERE rt.station_id=$1 ORDER BY rt.tag_uid`, [station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { tag_uid, station_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO rfid_tags(tag_uid,station_id) VALUES($1,$2) RETURNING *`,
      [tag_uid, station_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tag UID already registered' });
    next(err);
  }
});

router.patch('/:id/reset', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE rfid_tags SET is_active=TRUE WHERE id=$1 RETURNING *`, [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
