const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const shiftClock = require('../services/attendanceService');

// GET /api/attendance/shifts?station_id=&from=&to=&attendant_id=
// THE SHIFT REGISTER — each attendant's start and end date & time, per shift, off
// the shift_attendance table. Distinct from GET / below, which reads the by-hand
// HR register: this one is what the system observed, with a photograph at each end.
//
// Declared BEFORE the bare GET / so route order is explicit, and returns [] rather
// than erroring where the owner has not run the DDL yet — an empty register reads
// as "nothing logged", which is the truth on such a database.
router.get('/shifts', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, from, to, attendant_id } = req.query;
    if (!station_id) return res.status(400).json({ error: 'station_id is required' });
    const rows = await shiftClock.register({
      station_id, from: from || null, to: to || null, attendant_id: attendant_id || null,
    });
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, date, user_id } = req.query;
    let q = `SELECT a.*, u.name, u.role FROM attendance a JOIN users u ON u.id=a.user_id WHERE 1=1`;
    const p = [];
    if (station_id) { p.push(station_id); q += ` AND a.station_id=$${p.length}`; }
    if (date)       { p.push(date);       q += ` AND a.date=$${p.length}`; }
    if (user_id)    { p.push(user_id);    q += ` AND a.user_id=$${p.length}`; }
    q += ' ORDER BY a.date DESC, u.name';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { user_id, station_id, date, check_in, check_out, shift_number, status, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO attendance(user_id,station_id,date,check_in,check_out,shift_number,status,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(user_id,date,shift_number) DO UPDATE SET check_in=$4,check_out=$5,status=$7,notes=$8
       RETURNING *`,
      [user_id, station_id, date, check_in, check_out, shift_number, status || 'present', notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
