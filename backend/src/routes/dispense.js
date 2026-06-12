// src/routes/dispense.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, 'uploads/'),
    filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// POST /api/dispense  
router.post('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const {
      station_id, shift_id, rfid_tag_uid, nozzle_id,
      quantity_ltrs, payment_mode, upi_ref,
      vehicle_number, latitude, longitude, corporate_id,
    } = req.body;

    // Sanity bounds — a fat-fingered 999999 litres would pollute every report,
    // reconciliation and Tally export downstream. Largest tanker compartment
    // delivery is ~20,000 L; a single vehicle fill is far below that.
    const qty = Number(quantity_ltrs);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 20000) {
      return res.status(400).json({ error: 'Invalid quantity. Enter litres between 0 and 20,000.' });
    }

    // Get current fuel price for this nozzle
    const { rows: priceRows } = await pool.query(
      `SELECT fp.price, n.fuel_type FROM nozzles n
       JOIN fuel_prices fp ON fp.station_id = $1 AND fp.fuel_type = n.fuel_type
       WHERE n.id = $2
       ORDER BY fp.effective_from DESC LIMIT 1`,
      [station_id, nozzle_id]
    );
    if (!priceRows.length) {
      return res.status(400).json({ error: 'Fuel price not configured for this nozzle. Please set price in Settings first.' });
    }

    const { price, fuel_type } = priceRows[0];

    // ── Credit limit enforcement ───────────────────────────────────
    // For credit sales, ensure the new amount does not push the corporate's
    // station-wise outstanding past its credit limit. Outstanding is the sum
    // of uninvoiced credit dispense events for this corporate at this station.
    if (payment_mode === 'credit') {
      if (!corporate_id) {
        return res.status(400).json({ error: 'Credit sale requires a credit customer.' });
      }
      const saleAmount = Number(quantity_ltrs) * Number(price);

      const { rows: limitRows } = await pool.query(
        `SELECT credit_limit FROM corporate_station_links
         WHERE corporate_id = $1 AND station_id = $2 AND is_active = TRUE
         LIMIT 1`,
        [corporate_id, station_id]
      );
      if (!limitRows.length) {
        return res.status(400).json({ error: 'This credit customer is not linked to this station.' });
      }
      const creditLimit = Number(limitRows[0].credit_limit) || 0;

      const { rows: outRows } = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS outstanding
         FROM dispense_events
         WHERE corporate_id = $1 AND station_id = $2
           AND payment_mode = 'credit'
           AND (is_invoiced IS NULL OR is_invoiced = FALSE)
           AND NOT COALESCE(is_voided,FALSE)`,
        [corporate_id, station_id]
      );
      const outstanding = Number(outRows[0].outstanding) || 0;
      const available   = creditLimit - outstanding;

      if (saleAmount > available) {
        return res.status(400).json({
          error: `Credit limit exceeded. Available credit is ₹${available.toFixed(2)} but this sale is ₹${saleAmount.toFixed(2)}.`,
          credit_limit: creditLimit,
          outstanding,
          available,
          sale_amount: saleAmount,
        });
      }
    }

    // Resolve attendant from shift assignment (by nozzle — no RFID needed for manual POS)
    let attendant_id = req.user.id; // default to logged-in user
    let rfid_id      = null;

    if (rfid_tag_uid && rfid_tag_uid !== 'MANUAL') {
      // RFID mode — resolve tag
      const { rows: tagRows } = await pool.query(
        `SELECT rt.id AS rfid_id, sa.attendant_id
         FROM rfid_tags rt
         LEFT JOIN shift_attendants sa ON sa.rfid_tag_id = rt.id 
           AND sa.shift_id = $2
         WHERE rt.tag_uid = $1`,
        [rfid_tag_uid, shift_id]
      );
      if (tagRows.length) {
        rfid_id      = tagRows[0].rfid_id;
        if (tagRows[0].attendant_id) attendant_id = tagRows[0].attendant_id;
      }
    } else if (shift_id) {
      // Manual POS — resolve attendant from nozzle assignment in shift
      const { rows: saRows } = await pool.query(
        `SELECT sa.attendant_id, sa.rfid_tag_id
         FROM shift_attendants sa
         WHERE sa.shift_id = $1 AND sa.nozzle_id = $2
         LIMIT 1`,
        [shift_id, nozzle_id]
      );
      if (saRows.length) {
        attendant_id = saRows[0].attendant_id;
        rfid_id      = saRows[0].rfid_tag_id;
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO dispense_events(
         station_id, shift_id, rfid_tag_id, nozzle_id, attendant_id,
         fuel_type, quantity_ltrs, rate_per_ltr, payment_mode, upi_ref,
         vehicle_number, latitude, longitude, corporate_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        station_id, shift_id || null, rfid_id, nozzle_id, attendant_id,
        fuel_type, quantity_ltrs, price,
        payment_mode || 'cash', upi_ref || null,
        vehicle_number || null, latitude || null, longitude || null,
        (payment_mode === 'credit' && corporate_id) ? corporate_id : null,
      ]
    );

    const event = rows[0];
    // Blind drop: the shift is open when a sale streams out, so staff rooms get
    // amount/quantity masked (they could otherwise just sum the live feed).
    // Owners join the `:owner` rooms (see index.js) and get the full event.
    const masked = { ...event, amount: null, quantity_ltrs: null, sales_masked: true };
    req.io.to(`station:${station_id}`).except(`station:${station_id}:owner`).emit('dispense:new', masked);
    req.io.to(`station:${station_id}:owner`).emit('dispense:new', event);
    if (shift_id) {
      req.io.to(`shift:${shift_id}`).except(`shift:${shift_id}:owner`).emit('dispense:new', masked);
      req.io.to(`shift:${shift_id}:owner`).emit('dispense:new', event);
    }

    res.status(201).json(event);
  } catch (err) { next(err); }
});

// POST /api/dispense/:id/void — OWNER ONLY.
// Deliberately not manager: blind drop exists to break the attendant–manager
// nexus, and a manager-side void would hand it straight back (record a cash
// sale, void it, split the cash). The owner is the only neutral party.
// Voids are soft (row kept, struck through in lists), need a reason, are only
// allowed while the shift is open, and raise an alert so they're on record.
router.post('/:id/void', authenticate, authorize('owner'),
  requireStationVia('SELECT station_id FROM dispense_events WHERE id=$1', 'id'),
  async (req, res, next) => {
  try {
    const reason = (req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to void a sale.' });

    const { rows: evt } = await pool.query(
      `SELECT de.*, s.status AS shift_status
       FROM dispense_events de LEFT JOIN shifts s ON s.id = de.shift_id
       WHERE de.id=$1`, [req.params.id]);
    if (!evt.length) return res.status(404).json({ error: 'Entry not found' });
    const e = evt[0];
    if (e.is_voided) return res.status(409).json({ error: 'This entry is already voided.' });
    if (e.shift_status && e.shift_status !== 'open') {
      return res.status(400).json({ error: 'The shift is closed — its books are final. Use an adjustment entry instead.' });
    }
    if (e.is_invoiced) {
      return res.status(400).json({ error: 'This sale is already on a GST invoice. Issue a credit note instead.' });
    }

    const { rows } = await pool.query(
      `UPDATE dispense_events
       SET is_voided=TRUE, voided_by=$2, voided_at=NOW(), void_reason=$3
       WHERE id=$1 RETURNING *`,
      [req.params.id, req.user.id, reason]);

    // On the record: every void is an alert the owner group can see later.
    try {
      await require('../services/alertService').sendAlert({
        station_id: e.station_id,
        alert_type: 'sale_voided',
        severity: 'warning',
        message: `Sale entry voided by owner: ${Number(e.quantity_ltrs)}L ${e.fuel_type} (${e.payment_mode}). Reason: ${reason}`,
        channels: [],
        io: req.io,
      });
    } catch (err) { /* alert failure must not block the void */ }

    req.io?.to(`station:${e.station_id}`).emit('dispense:voided', { id: e.id, shift_id: e.shift_id });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/dispense/:id/photo
router.post('/:id/photo', authenticate, requireStationVia('SELECT station_id FROM dispense_events WHERE id=$1', 'id'), upload.single('photo'), async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    const photo_url = `/uploads/${req.file.filename}`;
    const { rows } = await pool.query(
      `UPDATE dispense_events SET photo_url=$1, latitude=$2, longitude=$3
       WHERE id=$4 RETURNING id, photo_url`,
      [photo_url, latitude, longitude, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/dispense
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const isOwner = req.user.role === 'owner';
    const { shift_id, attendant_id, date_from, date_to, station_id, limit = 200 } = req.query;
    let q = `
      SELECT de.*, u.name AS attendant_name, n.nozzle_number, n.fuel_type AS nozzle_fuel,
             sh.status AS shift_status
      FROM dispense_events de
      LEFT JOIN users u ON u.id = de.attendant_id
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      LEFT JOIN shifts sh ON sh.id = de.shift_id
      WHERE 1=1
    `;
    const p = [];
    if (station_id)   { p.push(station_id);  q += ` AND de.station_id=$${p.length}`; }
    if (shift_id)     { p.push(shift_id);    q += ` AND de.shift_id=$${p.length}`; }
    if (attendant_id) { p.push(attendant_id);q += ` AND de.attendant_id=$${p.length}`; }
    if (date_from)    { p.push(date_from);   q += ` AND de.occurred_at>=$${p.length}`; }
    if (date_to)      { p.push(date_to);     q += ` AND de.occurred_at<=$${p.length}`; }
    if (req.query.uninvoiced === 'true') { q += ` AND (de.is_invoiced = FALSE OR de.is_invoiced IS NULL)`; }
    p.push(parseInt(limit));
    q += ` ORDER BY de.event_seq DESC LIMIT $${p.length}`;
    const { rows } = await pool.query(q, p);
    // Blind drop: non-owners don't see sale amounts for OPEN shifts
    const out = rows.map(r => (!isOwner && r.shift_status === 'open')
      ? { ...r, amount: null, quantity_ltrs: null, sales_hidden: true } : r);
    res.json(out);
  } catch (err) { next(err); }
});

module.exports = router;
