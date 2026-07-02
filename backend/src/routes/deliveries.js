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
      tank_splits,   // optional: [{ tank_id, gross_volume_ltrs }] — one product discharged into >1 tank
    } = req.body;

    // net_volume_ltrs is a GENERATED ALWAYS column in the DB (same VCF formula:
    // round(gross*density*(1-0.0009*(temp-15)),2), else gross) — we must NOT
    // insert it, Postgres rejects a value for a generated column.

    // Split discharge: one product can be discharged into several tanks. Normalise
    // to a list of lines. Without splits it's the single (tank_id, gross) as before.
    let lines;
    if (Array.isArray(tank_splits) && tank_splits.length) {
      lines = tank_splits
        .map(s => ({ tank_id: s.tank_id, gross: Number(s.gross_volume_ltrs) }))
        .filter(l => l.tank_id && Number.isFinite(l.gross) && l.gross > 0);
      if (!lines.length) return res.status(400).json({ error: 'Each tank split needs a tank and a positive quantity.' });
    } else {
      lines = [{ tank_id, gross: Number(gross_volume_ltrs) }];
    }

    // Re-scope every line's tank to the validated station — reject any from another outlet.
    for (const l of lines) {
      if (!l.tank_id) continue;
      const { rows: tk } = await pool.query('SELECT 1 FROM tanks WHERE id=$1 AND station_id=$2', [l.tank_id, station_id]);
      if (!tk.length) return res.status(400).json({ error: 'A selected tank does not belong to this station.' });
    }

    // Apportion the product's money across the split lines by litre share, so the
    // invoice value = Σ per-tank (litres × rate). The LAST line absorbs the rounding
    // remainder so Σ(line totals) equals the product total to the paise.
    const totalGross = lines.reduce((a, l) => a + l.gross, 0);
    const prodTotal  = total_value != null ? Number(total_value) : null;
    const prodFreight = Number(freight || 0);
    let allocTotal = 0, allocFreight = 0;
    lines.forEach((l, i) => {
      const last = i === lines.length - 1;
      if (prodTotal != null) {
        l.total_value = last ? +(prodTotal - allocTotal).toFixed(2) : +(prodTotal * l.gross / totalGross).toFixed(2);
        allocTotal += l.total_value;
      } else if (rate_per_ltr != null) {
        l.total_value = +(l.gross * Number(rate_per_ltr)).toFixed(2);
      } else {
        l.total_value = null;
      }
      l.freight = last ? +(prodFreight - allocFreight).toFixed(2) : +(prodFreight * l.gross / totalGross).toFixed(2);
      allocFreight += l.freight;
    });

    // Duplicate guard: the same invoice/DC + product + volume + tank is the same
    // delivery line. One invoice carries several products (different fuel) — fine;
    // a split puts the same product into different tanks (different tank/volume) —
    // also fine. Re-submitting the SAME product+volume+tank (double-click, retry,
    // two browsers) is not. App-level check + DB unique index as the race backstop.
    if (dc_number) {
      for (const l of lines) {
        const { rows: dup } = await pool.query(
          `SELECT received_at FROM fuel_deliveries
           WHERE station_id=$1 AND dc_number=$2 AND fuel_type=$3 AND gross_volume_ltrs=$4
             AND tank_id IS NOT DISTINCT FROM $5 LIMIT 1`,
          [station_id, dc_number, fuel_type, l.gross, l.tank_id || null]
        );
        if (dup.length) {
          const when = new Date(dup[0].received_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
          return res.status(409).json({ error: `Already recorded — DC ${dc_number}, ${fuel_type}, ${l.gross}L (on ${when}). Not saved again.` });
        }
      }
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

    // Insert one row per tank (splits share the DC/invoice/fuel/rate). All-or-nothing
    // in a transaction so a partial split can't leave a lopsided stock picture.
    const created = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const l of lines) {
        const { rows: r } = await client.query(
          `INSERT INTO fuel_deliveries(
             station_id,tank_id,shift_id,dc_number,dc_date,received_at,
             fuel_type,oil_company,depot_name,tanker_number,compartment_no,
             gross_volume_ltrs,temperature_c,density,
             batch_number,seal_number,rate_per_ltr,freight,total_value,
             received_by,notes,invoice_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           RETURNING *`,
          [
            station_id, l.tank_id || null, shift_id||null,
            dc_number||null, dc_date||new Date().toISOString().slice(0,10),
            received_at||new Date(),
            fuel_type, oil_company||null, depot_name||null,
            tanker_number||null, compartment_no||null,
            l.gross, temperature_c||null, density||null,
            batch_number||null, seal_number||null,
            rate_per_ltr||null, l.freight, l.total_value,
            req.user.id, notes||null, invoiceId,
          ]
        );
        created.push(r[0]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // Race backstop: the DB unique index caught a duplicate the app pre-check missed.
      if (e.code === '23505') {
        return res.status(409).json({ error: `Already recorded — DC ${dc_number}, ${fuel_type}. Not saved again.` });
      }
      throw e;
    } finally {
      client.release();
    }

    created.forEach(row => req.io.to(`station:${station_id}`).emit('delivery:new', row));
    // Back-compat: a single line returns the object (as before); a split returns the array.
    res.status(201).json(created.length === 1 ? created[0] : created);
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
   "rate_per_ltr": number — the ALL-INCLUSIVE cost per litre = total_value / gross_volume_ltrs (NOT the ex-depot basic rate); or null,
   "total_value": number — the product's FULL all-inclusive total in ₹ (every component added together), NOT the pre-tax basic value; or null,
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
- total_value = the product's FULL taxes-included total. Two invoice styles:
  (a) IOCL prints a single per-product "Total for material" line — use it directly.
  (b) HPCL itemises components with NO combined line — under the product (e.g. MS / HSD) there are separate amount rows: basic value, A/R VAT %, LF Recovery, Idn SSLF Recovery (and any cess/duty). ADD all of that product's amount rows together = its total_value.
  NEVER use the basic / assessable / taxable value alone (pre-tax). We only need the per-product TOTAL — do not return the individual components.
- TAX/RECOVERY ROWS ARE ALWAYS ADDED, NEVER SUBTRACTED. A/R VAT, LF Recovery, SSLF/Idn SSLF Recovery, cess and duty are charges PAYABLE — add every one to the basic value. They are never deductions or credits. If OCR shows a stray minus sign next to one (e.g. "144,471.66-"), it is noise — use the POSITIVE value. So for HPCL, total_value = basic + |VAT| + |LF| + |SSLF| + |any other tax row|.
- CROSS-CHECK IS MANDATORY: the sum of every product's total_value MUST equal the invoice grand "Total Value" to the paise (e.g. MS 1005427.11 + HSD 506479.91 = 1511907.02). If they don't reconcile, you have MISREAD a component row — re-read the amount column and recompute until Σ(items) == grand total. NEVER output a per-product total_value that contradicts your own component arithmetic, and NEVER output items whose totals don't sum to the grand total. If after re-reading you genuinely cannot make them reconcile, set confidence "low" and explain exactly which figure is unreadable in notes.
- invoice_total_value = the invoice grand "Total Value" (the printed total incl. taxes). Read this carefully — it is the anchor the per-product totals must sum to.
- rate_per_ltr = total_value ÷ gross_volume_ltrs (the all-inclusive landed cost per litre, typically ₹95-125). Do NOT read the ex-depot basic per-KL rate.
- One item per product/compartment. If a value is missing or not legible, use null and say so in notes. NEVER guess.`;

// ── Google Vision OCR pre-pass (optional) ─────────────────────────────────
// HPCL has no invoice portal, so managers photograph smudged physical copies on
// a phone. A general vision model intermittently returns prose ("Could not read")
// on those; Google Vision DOCUMENT_TEXT_DETECTION reads the figures reliably
// (validated on a real failing HPCL invoice — every volume, rate, component
// amount and the grand total came through correct), and Claude then structures
// the clean *text* (a text call essentially never refuses/returns prose the way a
// vision call on a bad photo does). Active only when GOOGLE_VISION_API_KEY is set
// — otherwise the endpoint behaves exactly as before (Claude vision only), and
// any OCR miss falls through to that same path.
async function googleVisionOcr(base64) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) { try { require('../utils/logger').warn(`vision-ocr http ${r.status}`); } catch { /* noop */ } return null; }
    const j = await r.json();
    const resp = j?.responses?.[0];
    if (resp?.error) { try { require('../utils/logger').warn('vision-ocr error: ' + (resp.error.message || '')); } catch { /* noop */ } return null; }
    return resp?.fullTextAnnotation?.text || null;
  } catch (e) {
    try { require('../utils/logger').warn('vision-ocr failed: ' + (e.message || e)); } catch { /* noop */ }
    return null;
  } finally { clearTimeout(timer); }
}

// Structure OCR text into our JSON shape via a TEXT-only Claude call. Returns the
// parsed object, or null on any miss so the caller falls back to Claude vision.
async function structureInvoiceText(ocrText) {
  let msg;
  try {
    msg = await ai.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 4000,
      messages: [{ role: 'user', content: [{ type: 'text',
        text: `${INVOICE_PROMPT}\n\nBelow is OCR-extracted text from the invoice (layout may be imperfect — rely on the labels and the CROSS-CHECK that products sum to the grand Total Value):\n\n${ocrText}` }] }],
    });
  } catch (e) {
    try { require('../utils/logger').error('parse-invoice (ocr->text) Claude error: ' + (e.message || e)); } catch { /* noop */ }
    return null;
  }
  const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// Reconciliation guard: flag whether the per-product totals add up to the printed
// grand "Total Value". A mismatch means a money figure was misread — we surface
// `reconciled:false` so the form warns the manager to verify, instead of silently
// trusting wrong totals. Never blocks the scan; just annotates it.
function withReconciliation(parsed) {
  try {
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const sum   = items.reduce((s, it) => s + (Number(it.total_value) || 0), 0);
    const grand = Number(parsed.invoice_total_value) || 0;
    parsed.items_total = +sum.toFixed(2);
    // Tolerate sub-rupee rounding only; anything more is a genuine misread.
    parsed.reconciled  = grand > 0 && items.length > 0 && Math.abs(sum - grand) <= 1;
  } catch { /* noop */ }
  return parsed;
}

router.post('/parse-invoice', authenticate, authorize('owner', 'manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { file_base64, media_type } = req.body;
    if (!file_base64 || !media_type) return res.status(400).json({ error: 'file_base64 and media_type are required' });
    if (!INVOICE_OK_TYPES.includes(media_type)) return res.status(400).json({ error: 'Upload a photo (JPG/PNG) or a PDF.' });

    // Preferred path: Google Vision OCR → Claude text structuring (robust on
    // smudged HPCL phone photos). Any miss falls through to Claude vision below.
    try {
      const ocrText = await googleVisionOcr(file_base64);
      if (ocrText && ocrText.replace(/\s/g, '').length > 60) {
        const parsedOcr = await structureInvoiceText(ocrText);
        if (parsedOcr && Array.isArray(parsedOcr.items) && parsedOcr.items.length) {
          return res.json(withReconciliation(parsedOcr));
        }
      }
    } catch (e) {
      try { require('../utils/logger').warn('parse-invoice OCR pre-pass failed: ' + (e.message || e)); } catch { /* noop */ }
    }

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
    res.json(withReconciliation(parsed));
  } catch (err) { next(err); }
});

module.exports = router;
