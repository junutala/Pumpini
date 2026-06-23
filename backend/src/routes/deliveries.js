// src/routes/deliveries.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /api/deliveries/book-stock/:station_id  ← must be before /:id routes
router.get('/book-stock/:station_id', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Get open shift for today
    const { rows: shifts } = await pool.query(
      `SELECT id FROM shifts WHERE station_id=$1 AND date=$2 AND status='open' LIMIT 1`,
      [req.params.station_id, today]
    );

    // Single efficient query for all tanks
    const shiftId = shifts[0]?.id || null;

    const { rows } = await pool.query(`
      SELECT
        t.id          AS tank_id,
        t.tank_number,
        t.fuel_type,
        t.capacity_ltrs,
        t.current_stock,
        -- Opening dip (NULL when none taken yet — book_stock falls back to current_stock below)
        (
          SELECT dr.volume_ltrs FROM dipstick_readings dr
          WHERE dr.tank_id=t.id AND dr.shift_id=$2
            AND dr.reading_type='opening'
          ORDER BY dr.recorded_at LIMIT 1
        ) AS opening_dip,
        -- Deliveries this shift
        COALESCE((
          SELECT SUM(fd.net_volume_ltrs) FROM fuel_deliveries fd
          WHERE fd.tank_id=t.id AND ($2::uuid IS NULL OR fd.shift_id=$2)
          AND fd.received_at::date=$3
        ), 0) AS deliveries,
        -- Sales this shift
        COALESCE((
          SELECT SUM(de.quantity_ltrs) FROM dispense_events de
          JOIN nozzles n ON n.id=de.nozzle_id
          WHERE n.tank_id=t.id AND ($2::uuid IS NULL OR de.shift_id=$2)
          AND de.occurred_at::date=$3 AND NOT COALESCE(de.is_voided,FALSE)
        ), 0) AS sales_ltrs,
        -- Closing dip
        (
          SELECT dr.volume_ltrs FROM dipstick_readings dr
          WHERE dr.tank_id=t.id AND dr.shift_id=$2
            AND dr.reading_type='closing'
          ORDER BY dr.recorded_at DESC LIMIT 1
        ) AS closing_dip
      FROM tanks t
      WHERE t.station_id=$1
      ORDER BY t.tank_number`,
      [req.params.station_id, shiftId, today]
    );

    // Calculate book_stock in app layer. Opening base = the opening dip if taken,
    // else the tank's current stock (so book stays sensible before the first dip).
    const result = rows.map(t => {
      const openingBase = t.opening_dip != null ? parseFloat(t.opening_dip) : parseFloat(t.current_stock||0);
      return {
        ...t,
        book_stock: openingBase + parseFloat(t.deliveries||0) - parseFloat(t.sales_ltrs||0),
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/deliveries
router.post('/', authenticate, authorize('owner','manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const {
      station_id, tank_id, shift_id,
      dc_number, dc_date, received_at,
      fuel_type, oil_company, depot_name,
      tanker_number, compartment_no,
      gross_volume_ltrs, temperature_c, density,
      batch_number, seal_number,
      rate_per_ltr, freight, total_value, notes,
      invoice_id, invoice_base64, invoice_media_type,
    } = req.body;

    // net_volume_ltrs is a GENERATED ALWAYS column in the DB (same VCF formula:
    // round(gross*density*(1-0.0009*(temp-15)),2), else gross) — we must NOT
    // insert it, Postgres rejects a value for a generated column.

    // Re-scope tank to the validated station — reject a tank_id from another outlet.
    if (tank_id) {
      const { rows: tk } = await pool.query('SELECT 1 FROM tanks WHERE id=$1 AND station_id=$2', [tank_id, station_id]);
      if (!tk.length) return res.status(400).json({ error: 'Tank does not belong to this station.' });
    }

    // Attach the scanned invoice. The first compartment of a multi-product invoice
    // stores the file; later compartments pass back the returned invoice_id so they
    // share the one record (no duplicate blobs).
    let invoiceId = invoice_id || null;
    if (!invoiceId && invoice_base64 && invoice_media_type && INVOICE_OK_TYPES.includes(invoice_media_type)) {
      const { rows: ir } = await pool.query(
        `INSERT INTO delivery_invoices(station_id, file_base64, media_type, uploaded_by)
         VALUES($1,$2,$3,$4) RETURNING id`,
        [station_id, invoice_base64, invoice_media_type, req.user.id]
      );
      invoiceId = ir[0].id;
    } else if (invoiceId) {
      // Re-scope a passed invoice_id to this station — never link another outlet's file.
      const { rows: iv } = await pool.query('SELECT 1 FROM delivery_invoices WHERE id=$1 AND station_id=$2', [invoiceId, station_id]);
      if (!iv.length) invoiceId = null;
    }

    const { rows } = await pool.query(
      `INSERT INTO fuel_deliveries(
         station_id,tank_id,shift_id,dc_number,dc_date,received_at,
         fuel_type,oil_company,depot_name,tanker_number,compartment_no,
         gross_volume_ltrs,temperature_c,density,
         batch_number,seal_number,rate_per_ltr,freight,total_value,
         received_by,notes,invoice_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        station_id, tank_id, shift_id||null,
        dc_number||null, dc_date||new Date().toISOString().slice(0,10),
        received_at||new Date(),
        fuel_type, oil_company||null, depot_name||null,
        tanker_number||null, compartment_no||null,
        gross_volume_ltrs, temperature_c||null, density||null,
        batch_number||null, seal_number||null,
        rate_per_ltr||null, freight||0, total_value||null,
        req.user.id, notes||null, invoiceId,
      ]
    );

    req.io.to(`station:${station_id}`).emit('delivery:new', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/deliveries
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, tank_id, date_from, date_to, limit=50 } = req.query;
    let q = `
      SELECT fd.*, t.tank_number, t.fuel_type AS tank_fuel,
        u.name AS received_by_name, v.name AS verified_by_name
      FROM fuel_deliveries fd
      LEFT JOIN tanks t ON t.id = fd.tank_id
      LEFT JOIN users u ON u.id = fd.received_by
      LEFT JOIN users v ON v.id = fd.verified_by
      WHERE 1=1`;
    const p = [];
    if (station_id){ p.push(station_id); q+=` AND fd.station_id=$${p.length}`; }
    if (tank_id)   { p.push(tank_id);    q+=` AND fd.tank_id=$${p.length}`; }
    if (date_from) { p.push(date_from);  q+=` AND fd.received_at>=$${p.length}`; }
    if (date_to)   { p.push(date_to);    q+=` AND fd.received_at<=$${p.length}`; }
    p.push(parseInt(limit));
    q += ` ORDER BY fd.received_at DESC LIMIT $${p.length}`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/deliveries/:id/verify
router.patch('/:id/verify', authenticate, authorize('owner','manager'), requireStationVia('SELECT station_id FROM fuel_deliveries WHERE id=$1', 'id'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE fuel_deliveries SET verified_by=$1, verified_at=NOW()
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/deliveries/:id/invoice — the stored scan attached to a delivery,
// returned as { media_type, file_base64 } for viewing/download. Station-scoped.
router.get('/:id/invoice', authenticate,
  requireStationVia('SELECT station_id FROM fuel_deliveries WHERE id=$1', 'id'),
  async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT di.media_type, di.file_base64
       FROM fuel_deliveries fd JOIN delivery_invoices di ON di.id = fd.invoice_id
       WHERE fd.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No invoice attached to this delivery.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/deliveries/parse-invoice — read an oil-company TT invoice/DC (photo
// OR pdf, straight from mobile) and return structured line-items to PRE-FILL the
// delivery form. Nothing is saved here; the manager verifies + confirms on the
// form. Mirrors the meter-photo OCR pattern in reconcile.js.
const INVOICE_OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const INVOICE_PROMPT = `You extract structured data from an Indian oil-company fuel tank-truck delivery invoice / DC challan (IOCL/Indian Oil, HPCL, BPCL, etc.). Input may be a clean PDF or a phone photo, and ONE invoice usually carries MULTIPLE products (one per tanker compartment).

Return ONLY a JSON object (no prose, no markdown) of this exact shape:
{
 "oil_company": "IOC|HPCL|BPCL|Essar|Shell|Reliance|Nayara|null",
 "dc_number": "delivery/invoice number string or null",
 "dc_date": "YYYY-MM-DD or null",
 "received_at": "YYYY-MM-DDTHH:MM (from the invoice date + time) or null",
 "depot_name": "terminal/depot name or null",
 "tanker_number": "vehicle / TT number or null",
 "consignee_name": "buyer / consignee station name or null",
 "consignee_code": "buyer code or null",
 "seal_number": "seal/lock number(s) or null",
 "invoice_total_value": number or null,
 "items": [{
   "fuel_type": "petrol|diesel|premium_petrol|cng",
   "product_name": "as printed (HSD-BSV, MS/EBMS, XtraPremium, ...)",
   "compartment_no": "string or null",
   "tank_code": "truck tank code (e.g. T003) or null",
   "quantity_kl": number or null,
   "gross_volume_ltrs": number (LITRES = KL*1000),
   "density": number (kg/L @15C, e.g. 0.7522),
   "rate_per_ltr": number or null,
   "total_value": number — the "Total for material" for THIS product: its all-inclusive grand total (basic value PLUS every duty & tax), NOT the basic/assessable/taxable value before tax; or null,
   "sample_no": "string or null",
   "hsn": "string or null"
 }],
 "confidence": "high|medium|low",
 "notes": "anything unclear/unreadable"
}

Rules:
- fuel_type: MS / EBMS / Motor Spirit / Petrol -> "petrol"; HSD / Diesel -> "diesel"; XtraPremium / Speed / Power / branded premium -> "premium_petrol"; CNG -> "cng".
- gross_volume_ltrs is LITRES: convert KL x 1000.
- density is kg/L @15C. If printed as kg/m3 (e.g. 752.200 / 837.900) divide by 1000 -> 0.7522 / 0.8379.
- total_value: ALWAYS read the per-product "Total for material" line — the all-inclusive amount (basic value PLUS every duty and tax). NEVER use the basic price / assessable value / taxable value (the pre-tax figure); on oil-company invoices these differ a lot (e.g. basic 331453.56 vs "Total for material" 448125.21 -> pick 448125.21). Apply the same to every product (petrol, diesel, etc.). If no all-inclusive line is labelled, sum that product's basic value + its taxes.
- invoice_total_value is the whole invoice's grand total (sum of all materials' "Total for material" + any common charges).
- rate_per_ltr is the ex-depot price PER LITRE in ₹ — normally ₹70-120. If the invoice quotes the rate per KL (a 5-6 digit figure like 82863.39), divide by 1000 -> 82.86. NEVER return a per-litre rate above ~200; if you computed one, you read a per-KL number.
- One item per product/compartment. If a value is missing or not legible, use null and say so in notes. NEVER guess.`;

router.post('/parse-invoice', authenticate, authorize('owner', 'manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { file_base64, media_type } = req.body;
    if (!file_base64 || !media_type) return res.status(400).json({ error: 'file_base64 and media_type are required' });
    if (!INVOICE_OK_TYPES.includes(media_type)) return res.status(400).json({ error: 'Upload a photo (JPG/PNG) or a PDF.' });

    const fileBlock = media_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type, data: file_base64 } }
      : { type: 'image',    source: { type: 'base64', media_type, data: file_base64 } };

    let msg;
    try {
      msg = await ai.messages.create({
        // 4000 so a multi-product invoice's JSON isn't truncated mid-object.
        model: 'claude-sonnet-4-6', max_tokens: 4000,
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: INVOICE_PROMPT }] }],
      });
    } catch (e) {
      try { require('../utils/logger').error('parse-invoice API error: ' + (e.message || e)); } catch { /* noop */ }
      return res.status(503).json({ error: 'Invoice scanning is unavailable right now — enter the details manually.' });
    }

    const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
    // Grab the JSON object from the reply (tolerates ```json fences / stray prose).
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    if (!parsed) {
      try { require('../utils/logger').warn(`parse-invoice unparsed (stop=${msg.stop_reason}): ${txt.slice(0, 400)}`); } catch { /* noop */ }
      return res.status(422).json({ error: 'Could not read the invoice — enter the details manually.' });
    }
    if (!Array.isArray(parsed.items)) parsed.items = [];
    res.json(parsed);
  } catch (err) { next(err); }
});

module.exports = router;
