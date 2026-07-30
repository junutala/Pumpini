// src/routes/coupons.js
// Capture a filled-in requisition coupon as a credit sale. Thin guarded entry points
// over services/couponService; the sale itself is written by services/dispenseService,
// the same writer the POS uses. docs/credit-slip-invoicing.md.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
const { requireStationAccess } = require('../middleware/stationAccess');
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const svc = require('../services/couponService');

// This deploys BEFORE the owner-run DDL. A missing coupon column (42703) or the books
// table (42P01) must read as "not set up yet", never as a 500 — and crucially the POS
// path is untouched either way (the shared writer only names the coupon columns when a
// coupon is actually supplied).
const NOT_MIGRATED = 'Coupon capture is not set up on this database yet.';
const notMigrated = e => e.code === '42703' || e.code === '42P01';

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const COUPON_PROMPT = `You read a HANDWRITTEN Indian petrol-pump credit requisition coupon (a "slip"). A credit customer's driver hands it over to draw fuel. The printed form is in English; the handwriting may be untidy, at an angle, or overlap the printed rules.

Return ONLY a JSON object (no prose, no markdown) of this exact shape:
{
 "coupon_no": number or null,
 "coupon_date": "YYYY-MM-DD or null",
 "customer_name": "the name written after 'Sri' — as written, or null",
 "vehicle_number": "vehicle registration as written, or null",
 "petrol_ltrs": number or null,
 "diesel_ltrs": number or null,
 "engine_oil": "as written or null",
 "others": "as written or null",
 "has_signature": true|false,
 "has_seal": true|false,
 "confidence": "high|medium|low",
 "notes": "anything unreadable or ambiguous"
}

Rules:
- THE DATE IS DD/MM/YY OR DD/MM/YYYY. ALWAYS. India never writes MM/DD. "12/07/26" is 12 July 2026 -> "2026-07-12". Reading it as December would put the debt in the wrong month, so if the first number is 13 or more it is unambiguously the DAY and the second is the month.
- The coupon number is usually pre-printed, often in RED, near the top. Report it as a plain number.
- Quantity lines are labelled Petrol / Diesel / Engine Oil / Others. Put litres against the RIGHT product; a dash, blank or "—" means null, NOT zero. Most coupons fill in exactly one product.
- Quantities are LITRES as written ("25 ltrs" -> 25). A bulk figure such as 2000 is legitimate — do not "correct" it.
- Vehicle numbers look like TS05FQ0975 / TS 05 FQ 0975. Keep the characters as written; do not invent missing ones.
- has_signature / has_seal: whether a handwritten signature and a round rubber stamp are visibly present. They are the coupon's authentication.
- This is HANDWRITING. If a digit is genuinely ambiguous use null and say which field in notes. NEVER guess a digit — a wrong quantity or coupon number is worse than a blank one, because a human will check a blank and may not check a plausible mistake.`;

// POST /api/coupons/parse — OCR only. Saves NOTHING; the result pre-fills the form and
// the manager confirms every figure (owner call: the coupon is handwritten, so the
// manager is the check, not the machine).
router.post('/parse', authenticate, requireStationAccess({ required: true }), requirePerm('dispense.entry'), async (req, res, next) => {
  try {
    const { file_base64, media_type } = req.body;
    if (!file_base64 || !media_type) return res.status(400).json({ error: 'file_base64 and media_type are required' });
    if (!OK_TYPES.includes(media_type)) return res.status(400).json({ error: 'Upload a photo (JPG/PNG) of the coupon.' });

    let msg;
    try {
      msg = await ai.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 1500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type, data: file_base64 } },
          { type: 'text', text: COUPON_PROMPT },
        ] }],
      });
    } catch (e) {
      try { require('../utils/logger').error('coupon parse API error: ' + (e.message || e)); } catch { /* noop */ }
      return res.status(503).json({ error: 'Coupon scanning is unavailable right now — enter the details manually.' });
    }

    const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    if (!parsed) {
      try { require('../utils/logger').warn(`coupon parse unparsed: ${txt.slice(0, 300)}`); } catch { /* noop */ }
      return res.status(422).json({ error: 'Could not read the coupon — enter the details manually.' });
    }
    res.json(parsed);
  } catch (err) { next(err); }
});

// POST /api/coupons/validate — check a coupon against the register WITHOUT writing.
// Lets the capture screen show which customer the number resolves to, the rate that
// will be applied, and any warnings, before the manager commits.
router.post('/validate', authenticate, requireStationAccess({ required: true }), requirePerm('dispense.entry'), async (req, res, next) => {
  try {
    const out = await svc.validateCoupon(req.body);
    res.json({
      book: {
        id: out.book.id, series_start: out.book.series_start, series_end: out.book.series_end,
        status: out.book.status, company_name: out.book.company_name,
        corporate_id: out.book.corporate_id,
      },
      rate: out.rate,
      already_recorded: !!out.duplicate,
      already_invoiced: !!(out.duplicate && out.duplicate.is_invoiced),
      warnings: out.warnings,
    });
  } catch (err) {
    if (notMigrated(err)) return res.status(503).json({ error: NOT_MIGRATED });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/coupons — capture the coupon as a credit sale.
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('dispense.entry'), async (req, res, next) => {
  try {
    const event = await svc.captureCoupon({ ...req.body, attendant_id: req.body.attendant_id || req.user.id });
    res.status(201).json(event);
  } catch (err) {
    if (notMigrated(err)) return res.status(503).json({ error: NOT_MIGRATED });
    if (err.status === 400) {
      const body = { error: err.message };
      for (const k of ['credit_limit', 'outstanding', 'available', 'sale_amount']) {
        if (err[k] !== undefined) body[k] = err[k];
      }
      return res.status(400).json(body);
    }
    next(err);
  }
});

// GET /api/coupons?station_id=&corporate_id=&from=&to=&uninvoiced=
// Captured coupons, newest first — the pool a credit invoice draws from.
router.get('/', authenticate, requireStationAccess({ required: true }), requirePerm('corporate.view'), async (req, res, next) => {
  try {
    const pool = require('../db/pool');
    const { station_id, corporate_id, from, to, uninvoiced } = req.query;
    const p = [station_id];
    let q = `
      SELECT de.id, de.coupon_no, de.occurred_at, de.fuel_type, de.quantity_ltrs,
             de.rate_per_ltr, de.amount, de.vehicle_number, de.is_invoiced, de.invoice_id,
             ca.company_name, b.series_start, b.series_end
      FROM dispense_events de
      JOIN credit_slip_books b ON b.id = de.coupon_book_id
      LEFT JOIN corporate_accounts ca ON ca.id = de.corporate_id
      WHERE de.station_id = $1 AND de.coupon_book_id IS NOT NULL
        AND NOT COALESCE(de.is_voided,FALSE)`;
    if (corporate_id) { p.push(corporate_id); q += ` AND de.corporate_id = $${p.length}`; }
    if (from) { p.push(from); q += ` AND de.occurred_at >= $${p.length}::date`; }
    if (to)   { p.push(to);   q += ` AND de.occurred_at < $${p.length}::date + INTERVAL '1 day'`; }
    if (String(uninvoiced) === 'true') q += ' AND (de.is_invoiced IS NULL OR de.is_invoiced = FALSE)';
    q += ' ORDER BY de.occurred_at DESC, de.coupon_no DESC LIMIT 300';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) {
    if (notMigrated(err)) return res.json([]);
    next(err);
  }
});

module.exports = router;
