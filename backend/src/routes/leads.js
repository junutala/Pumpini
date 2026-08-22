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

// How a visit ENDED. The field tool closes a visit one of three ways, and the
// two failures are NOT the same failure — which is the whole reason they are
// separate buttons rather than one "no luck" note:
//
//   captured  the manager gave the owner's name and number → a real lead
//   refused   the manager would not give them → do not spend a second visit
//   absent    nobody was there to ask → worth going back
//
// Deliberately NOT proof-of-effort machinery. The owner takes over from the
// second interaction, so a temp has nothing to gain by faking one (owner's call,
// 22-Aug-2026) — and a photograph was considered and REJECTED as unsafe: the one
// manager who refuses to share details is exactly the one who reacts badly to a
// camera, and that argument is not worth a lead that was worth nothing.
const OUTCOMES = {
  captured: { status: null,      label: null },
  refused:  { status: 'refused', label: 'Manager refused to share the owner\'s details.' },
  absent:   { status: 'revisit', label: 'Manager not available at the outlet.' },
};

// A refused or absent visit has NO owner name and NO mobile — nothing was
// learned except which outlet said no. Both columns are NOT NULL in a database
// that predates this, so the visit cannot be filed until they are relaxed:
//   ALTER TABLE public.leads ALTER COLUMN name  DROP NOT NULL;
//   ALTER TABLE public.leads ALTER COLUMN phone DROP NOT NULL;
// Probed rather than assumed, so the endpoint says plainly that the migration is
// pending instead of throwing a 23502 the temp cannot interpret. Filling them
// with '—' to dodge this was considered and rejected: a placeholder in a name
// column is read as a name by the next person to look.
const contactNullable = schemaProbe(
  'leads.name/phone nullable',
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads'
      AND column_name IN ('name','phone') AND is_nullable='YES'`,
  row => row.n === 2
);

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
      source, outcome, lat, lng, location_accuracy, captured_by,
    } = req.body;

    // Honeypot — bots fill hidden "company" field; humans never see it.
    if (company) return res.status(201).json({ ok: true });

    const src     = PUBLIC_SOURCES.has(source) ? source : 'website';
    const kind    = OUTCOMES[outcome] ? outcome : 'captured';
    const outlet  = text(station_name, 160);
    const spoken  = text(message, 4000);
    const agent   = text(captured_by, 60);

    // ── What a visit must carry ──────────────────────────────────────────────
    // The MARKETING form is unchanged: it is a stranger typing into a public
    // page, and a lead with no way to reach anybody is worthless there.
    if (src === 'website') {
      if (!name?.trim() || !phone?.trim()) {
        return res.status(400).json({ error: 'Name and phone number are required.' });
      }
    } else if (kind === 'captured' && !text(name, 120) && !text(phone, 20) && !outlet) {
      // The FIELD tool keeps every field optional (owner's call, 22-Aug-2026):
      // making any of them mandatory would collide with the refusal buttons,
      // which by their nature have no owner and no number. The one floor is that
      // SAVE must carry SOMETHING that names the visit — a mobile, an owner or
      // the outlet off the board. Without one of the three the row is a ghost:
      // it appears in the pipeline and can never be acted on or matched to
      // anything. The two CTAs are exempt, because pressing one is itself the
      // record and the coordinates say where it happened.
      return res.status(400).json({
        error: 'Add a mobile number, an owner name, or the outlet name before saving.',
      });
    }

    const geoOk = await hasGeoColumns();
    const logOk = await hasInteractionTable();

    // `leads.name` and `leads.phone` are NOT NULL in a database that predates a
    // visit which learns neither. Any save missing one needs them relaxed.
    if ((!text(name, 120) || !text(phone, 20)) && !(await contactNullable())) {
      return res.status(503).json({
        error: 'Saving a visit without the owner\'s name and number is not switched on yet. Nothing was saved — please tell the office.',
      });
    }

    const coords = {
      lat: num(lat, -90, 90),
      lng: num(lng, -180, 180),
      acc: num(location_accuracy, 0, 1_000_000),
    };

    // Pressing the button IS the assertion, so it is recorded as the note when
    // the temp said nothing aloud — a faithful record of what was claimed, not
    // an invented account of the visit. Anything spoken is kept alongside it.
    const note = kind === 'captured'
      ? spoken
      : [OUTCOMES[kind].label, spoken].filter(Boolean).join(' ');

    // Both probes run BEFORE the transaction opens. A catalog lookup that failed
    // inside a BEGIN…COMMIT would abort the whole transaction and lose the lead
    // along with the note.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let leadId = null;
      let reused = false;

      // One outlet canvassed twice is one record with two visits. A captured
      // lead is keyed by the mobile; a refused or absent one has none, so it is
      // keyed by the outlet name instead. Both are scoped to the temp who filed
      // it — merging one person's work into another's would make their save
      // vanish from under them.
      if (logOk && geoOk && src === 'direct' && agent) {
        const { rows } = kind === 'captured'
          ? await client.query(
              `SELECT id FROM leads
                WHERE phone=$1 AND captured_by=$2 AND source='direct'
                ORDER BY created_at LIMIT 1`,
              [text(phone, 20), agent])
          : await client.query(
              `SELECT id FROM leads
                WHERE lower(station_name)=lower($1) AND captured_by=$2 AND source='direct'
                ORDER BY created_at LIMIT 1`,
              [outlet, agent]);
        if (rows.length) { leadId = rows[0].id; reused = true; }
      }

      if (!leadId) {
        const cols = ['name','station_name','city','state','phone','email','message','source'];
        const vals = [
          text(name, 120),
          outlet,
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

        // 'refused' drops out of the working view; 'revisit' stays open and asks
        // to be gone back to. Left to the column default ('new') for a capture.
        if (OUTCOMES[kind].status) {
          cols.push('status');
          vals.push(OUTCOMES[kind].status);
        }

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
      } else if (OUTCOMES[kind].status) {
        // A revisit that ended the same way re-states the outcome; a revisit
        // that finally got the details is handled by the capture path above and
        // must NOT be dragged back to 'refused'.
        await client.query('UPDATE leads SET status=$2 WHERE id=$1', [leadId, OUTCOMES[kind].status]);
      }

      if (logOk && note) {
        await addInteraction({
          leadId, note, capturedBy: agent,
          lat: coords.lat, lng: coords.lng, accuracy: coords.acc,
          client,                      // compose inside this transaction
        });
      }

      await client.query('COMMIT');
      logger.info(`lead ${reused ? 'appended' : 'captured'}: source=${src} outcome=${kind} id=${leadId}`);
      res.status(201).json({ ok: true, id: leadId, reused, outcome: kind });
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
