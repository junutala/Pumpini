// src/routes/leads.js
//
// The ONE public (unauthenticated) lead writer. Two front doors feed it and both
// land in the same table, read by the same /admin Leads screen:
//
//   • the marketing site's "Get in touch" form   → source 'website'
//   • the field tool at pumpini.in/lead          → source 'direct'
//
// They are not two flows. They are one INSERT with a different `source` value,
// which is the point of the cardinal rule: a second endpoint here would have
// meant a second set of validation, a second column list, and a second place to
// forget a field.
//
// WRITE-ONLY. Nothing here reads a lead back. Working leads into a funnel lives
// on /admin behind authAdmin, which is what lets the field tool get away with an
// any-mobile gate: the credential guards nothing but the ability to add.
const router = require('express').Router();
const multer = require('multer');
const pool   = require('../db/pool');
const logger = require('../utils/logger');
const { rateLimit } = require('../utils/rateLimit');
const { schemaProbe } = require('../utils/schemaProbe');
const { transcribe } = require('../services/transcribeService');
// One writer for an interaction, shared with the admin routes.
const { addInteraction, hasInteractionTable, num, text } = require('../services/leadService');

// Sources this endpoint will accept from the wire. A whitelist, not a passthrough
// — `source` drives the admin pipeline view, and an open text field would let a
// caller invent categories nobody filters on.
const PUBLIC_SOURCES = new Set(['website', 'direct']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },   // same ceiling as /api/voice
});

// These endpoints are open by design (owner's decision, 22-Aug-2026: the field
// tool takes any mobile number as its credential). The limiter is spam damping,
// NOT access control — it stops one machine flooding the admin screen or burning
// Sarvam credits, and it gates nobody using the form as intended.
const limitSubmit = rateLimit({
  windowMs: 60 * 60_000, max: 40, name: 'lead-submit',
  message: 'Too many submissions from this device. Please try again in a little while.',
});
const limitTranscribe = rateLimit({
  windowMs: 60 * 60_000, max: 60, name: 'lead-transcribe',
  message: 'Too many recordings from this device. Please try again in a little while.',
});

// Column tolerance for lat/lng/location_accuracy/captured_by. A missing column
// must not 500 the capture — a lead without a map pin beats a lead that was
// never taken. schemaProbe latches a YES and expires a NO, so coordinates start
// being stored on their own once the DDL runs.
const hasGeoColumns = schemaProbe(
  'leads.lat/lng/location_accuracy/captured_by',
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads'
      AND column_name IN ('lat','lng','location_accuracy','captured_by')`,
  row => row.n === 4
);

// ── POST /api/leads ──────────────────────────────────────────────────────────
// Creates a lead, or — for the field tool — adds another interaction to a lead
// this same temp already filed for this same mobile. One outlet canvassed twice
// is one lead with two visits, not two leads.
//
// The dedupe is scoped to (phone, captured_by): two DIFFERENT temps working the
// same highway each keep their own lead, because silently merging one temp's
// work into another's would make the second person's save vanish from under
// them. The owner sees both on /admin and can reconcile by hand.
router.post('/', limitSubmit, async (req, res, next) => {
  try {
    const {
      name, station_name, city, state, phone, email, message, company,
      source, lat, lng, location_accuracy, captured_by,
    } = req.body;

    // Honeypot — bots fill hidden "company" field; humans never see it.
    if (company) return res.status(201).json({ ok: true });

    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const src   = PUBLIC_SOURCES.has(source) ? source : 'website';
    const note  = text(message, 4000);
    // 60, matching leadService — the owner files leads from this tool too, and
    // his name or email is longer than a 10-digit mobile. A shorter cap here
    // would truncate the identifier the dedupe then matches on.
    const agent = text(captured_by, 60);

    // Both probes run BEFORE the transaction opens. A catalog lookup that failed
    // inside a BEGIN…COMMIT would abort the whole transaction and lose the lead
    // along with the note.
    const geoOk = await hasGeoColumns();
    const logOk = await hasInteractionTable();

    const coords = {
      lat: num(lat, -90, 90),
      lng: num(lng, -180, 180),
      acc: num(location_accuracy, 0, 1_000_000),
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let leadId = null;
      let reused = false;

      if (logOk && geoOk && src === 'direct' && agent) {
        const { rows } = await client.query(
          `SELECT id FROM leads
            WHERE phone=$1 AND captured_by=$2 AND source='direct'
            ORDER BY created_at LIMIT 1`,
          [text(phone, 20), agent]
        );
        if (rows.length) { leadId = rows[0].id; reused = true; }
      }

      if (!leadId) {
        const cols = ['name','station_name','city','state','phone','email','message','source'];
        const vals = [
          text(name, 120),
          text(station_name, 160),
          text(city, 80),
          text(state, 60),
          text(phone, 20),
          text(email, 160),
          // With the interaction log in place a direct lead's notes live there,
          // so `message` stays what it has always been: the website form's text.
          // Until the DDL is run, the note falls back here rather than being
          // thrown away — transitional, and the admin screen reads `message`
          // only for a lead that has no interaction rows at all.
          logOk && src === 'direct' ? null : note,
          src,
        ];

        if (geoOk) {
          cols.push('lat', 'lng', 'location_accuracy', 'captured_by');
          // Self-declared: whatever mobile number opened the tool, NOT a verified
          // identity. Named plainly so nothing downstream reads it as proof.
          vals.push(coords.lat, coords.lng, coords.acc, agent);
        }

        const params = vals.map((_, i) => `$${i + 1}`).join(',');
        const { rows } = await client.query(
          `INSERT INTO leads(${cols.join(',')}) VALUES(${params}) RETURNING id`,
          vals
        );
        leadId = rows[0].id;
      }

      if (logOk && note) {
        await addInteraction({
          leadId, note, capturedBy: agent,
          lat: coords.lat, lng: coords.lng, accuracy: coords.acc,
          client,                      // compose inside this transaction
        });
      }

      await client.query('COMMIT');
      logger.info(`lead ${reused ? 'appended' : 'captured'}: source=${src} id=${leadId}`);
      res.status(201).json({ ok: true, id: leadId, reused });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ── POST /api/leads/transcribe ───────────────────────────────────────────────
// The public trust boundary over the SAME transcription service the POS voice
// entry uses (services/transcribeService). Identical Sarvam endpoint, model and
// key; the only difference is mode 'translate', which is what renders a temp's
// Telugu or Hindi as the English the owner reads on the admin screen.
router.post('/transcribe', limitTranscribe, upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const { transcript } = await transcribe({
      buffer:   req.file.buffer,
      mimetype: req.file.mimetype,
      language: req.body.language || 'en',
      mode:     'translate',
    });

    res.json({ transcript });
  } catch (err) {
    if (err.isTranscribeError) {
      return res.status(err.status || 502).json({ error: err.message, details: err.details });
    }
    next(err);
  }
});

module.exports = router;
