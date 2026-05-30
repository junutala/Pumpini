// src/routes/shifts.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { sendAlert } = require('../services/alertService');

// GET /api/shifts
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { station_id, date, status } = req.query;
    let q = `
      SELECT s.*, u.name AS manager_name,
        COUNT(DISTINCT sa.attendant_id)::int AS attendant_count,
        COALESCE(SUM(de.amount),0) AS total_sales
      FROM shifts s
      LEFT JOIN users u ON u.id = s.manager_id
      LEFT JOIN shift_attendants sa ON sa.shift_id = s.id
      LEFT JOIN dispense_events de ON de.shift_id = s.id
      WHERE 1=1
    `;
    const p = [];
    if (station_id) { p.push(station_id); q += ` AND s.station_id=$${p.length}`; }
    if (date)       { p.push(date);       q += ` AND s.date=$${p.length}`; }
    if (status)     { p.push(status);     q += ` AND s.status=$${p.length}`; }
    q += ' GROUP BY s.id, u.name ORDER BY s.date DESC, s.shift_number';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/shifts/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, u.name AS manager_name FROM shifts s
      LEFT JOIN users u ON u.id = s.manager_id
      WHERE s.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Shift not found' });

    const { rows: attendants } = await pool.query(`
      SELECT sa.*, u.name AS attendant_name, r.tag_uid,
        n.nozzle_number, n.fuel_type,
        COALESCE(SUM(de.amount),0) AS total_sales,
        COALESCE(SUM(de.quantity_ltrs),0) AS total_ltrs
      FROM shift_attendants sa
      JOIN users u ON u.id = sa.attendant_id
      LEFT JOIN rfid_tags r ON r.id = sa.rfid_tag_id
      LEFT JOIN nozzles n ON n.id = sa.nozzle_id
      LEFT JOIN dispense_events de ON de.shift_id = sa.shift_id 
        AND de.attendant_id = sa.attendant_id
      WHERE sa.shift_id = $1
      GROUP BY sa.id, u.name, r.tag_uid, n.nozzle_number, n.fuel_type`,
      [req.params.id]);

    res.json({ ...rows[0], attendants });
  } catch (err) { next(err); }
});

// POST /api/shifts  — open a new shift
router.post('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { station_id, shift_number, date } = req.body;
    const { rows: existing } = await pool.query(
      `SELECT id FROM shifts WHERE station_id=$1 AND date=$2 
       AND shift_number=$3 AND status='open'`,
      [station_id, date, shift_number]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'A shift is already open for this slot' });
    }
    const { rows } = await pool.query(
      `INSERT INTO shifts(station_id,shift_number,date,start_time,manager_id,status)
       VALUES($1,$2,$3,NOW(),$4,'open') RETURNING *`,
      [station_id, shift_number, date, req.user.id]
    );
    req.io.to(`station:${station_id}`).emit('shift:opened', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/shifts/:id/assign  — add attendant to shift
router.post('/:id/assign', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const {
      attendant_id, rfid_tag_id, nozzle_id,
      bank_account, upi_vpa, opening_reading, opening_cash
    } = req.body;

    if (!attendant_id) return res.status(400).json({ error: 'Attendant is required' });
    if (!nozzle_id)    return res.status(400).json({ error: 'Nozzle is required' });

    // Check nozzle not already assigned in this shift
    const { rows: nozzleCheck } = await pool.query(
      `SELECT id FROM shift_attendants WHERE shift_id=$1 AND nozzle_id=$2`,
      [req.params.id, nozzle_id]
    );
    if (nozzleCheck.length) {
      return res.status(409).json({ error: 'This nozzle is already assigned to another attendant in this shift' });
    }

    // Check UPI VPA not already assigned in this shift
    if (upi_vpa) {
      const { rows: vpaCheck } = await pool.query(
        `SELECT id FROM shift_attendants WHERE shift_id=$1 AND upi_vpa=$2`,
        [req.params.id, upi_vpa]
      );
      if (vpaCheck.length) {
        return res.status(409).json({ error: 'This UPI VPA is already assigned to another attendant in this shift' });
      }
    }

    // Activate RFID tag if provided
    if (rfid_tag_id) {
      await pool.query('UPDATE rfid_tags SET is_active=TRUE WHERE id=$1', [rfid_tag_id]);
    }

    const { rows } = await pool.query(
      `INSERT INTO shift_attendants(
         shift_id, attendant_id, rfid_tag_id, nozzle_id,
         bank_account, upi_vpa, opening_reading, opening_cash
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(shift_id, attendant_id) DO UPDATE SET
         rfid_tag_id=$3, nozzle_id=$4, bank_account=$5,
         upi_vpa=$6, opening_reading=$7, opening_cash=$8
       RETURNING *`,
      [req.params.id, attendant_id, rfid_tag_id||null, nozzle_id,
       bank_account||null, upi_vpa||null,
       opening_reading||0, opening_cash||0]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Keep old route for backwards compatibility
router.post('/:id/assign-rfid', authenticate, authorize('owner','manager'), async (req, res, next) => {
  req.url = `/${req.params.id}/assign`;
  next('route');
});

// PATCH /api/shifts/:id/close
router.patch('/:id/close', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE shifts SET status='closed', end_time=NOW()
       WHERE id=$1 AND status='open' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Shift not found or already closed' });
    }
    req.io.to(`station:${rows[0].station_id}`).emit('shift:closed', rows[0]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/shifts/:id/events
router.get('/:id/events', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT de.*, u.name AS attendant_name, n.nozzle_number, r.tag_uid
      FROM dispense_events de
      LEFT JOIN users u ON u.id = de.attendant_id
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      LEFT JOIN rfid_tags r ON r.id = de.rfid_tag_id
      WHERE de.shift_id = $1
      ORDER BY de.event_seq`, [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/shifts/definitions/:station_id
router.get('/definitions/:station_id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shift_definitions WHERE station_id=$1 ORDER BY shift_number`,
      [req.params.station_id]
    );
    // Return defaults if none set
    if (!rows.length) {
      return res.json([
        { shift_number:1, name:'Morning',   start_time:'06:00', end_time:'14:00' },
        { shift_number:2, name:'Afternoon', start_time:'14:00', end_time:'22:00' },
        { shift_number:3, name:'Night',     start_time:'22:00', end_time:'06:00' },
      ]);
    }
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/shifts/definitions — save shift definitions
router.post('/definitions', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { station_id, shifts } = req.body;
    for (const s of shifts) {
      await pool.query(
        `INSERT INTO shift_definitions(station_id,shift_number,name,start_time,end_time)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(station_id,shift_number) DO UPDATE SET
           name=$3, start_time=$4, end_time=$5`,
        [station_id, s.shift_number, s.name, s.start_time, s.end_time]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
