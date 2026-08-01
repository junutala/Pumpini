// src/routes/artifacts.js
//
// Reading back the stored proof. Writes never come through here — every artifact
// is written by the flow that produced it, through services/artifactService, in
// the same transaction as its parent (see that file for why).
//
// Two endpoints and no more:
//   GET /api/artifacts?entity_type=&entity_id=   — what proof exists for this record
//   GET /api/artifacts/:id/image                 — the picture itself
//
// The image is served as real bytes with a content type rather than base64 in a
// JSON envelope, so a screen can point an <img src> at it and the browser caches
// it. Sending a 900 KB photo as a JSON string costs a third more on the wire and
// re-downloads on every render.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const artifacts = require('../services/artifactService');

// Station scoping is done HERE, against the artifact's own station_id, and not
// from a station_id the caller supplies. RLS is the second line; this is the
// first, and it is the one that gives a clear 403 instead of an empty result.
const { canAccessStation } = require('../middleware/stationAccess');

// GET /api/artifacts?entity_type=dispense_event&entity_id=<uuid>
// Metadata only — never the bytes. Returns [] (not 404) when the table has not
// been migrated yet or the parent simply has no proof attached, so a screen that
// asks for a coupon image renders "no image" instead of erroring.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type and entity_id are required' });
    }
    const rows = await artifacts.listFor({ entity_type, entity_id });
    const allowed = [];
    for (const r of rows) {
      if (await canAccessStation(req.user.id, r.station_id)) allowed.push(r);
    }
    res.json(allowed);
  } catch (err) { next(err); }
});

// GET /api/artifacts/latest?entity_type=user&entity_ids=<uuid>,<uuid>&kind=attendant_photo
// The newest artifact per parent, as { entity_id: {id, …} }. For a list screen
// that shows a face beside every name: one request instead of one per row.
//
// Declared BEFORE /:id/image or Express would read "latest" as an artifact id.
// Station-scoped per row like the list above, so an id guessed from elsewhere
// returns nothing rather than a photograph. Never 404s — an outlet with no
// photographs yet gets {} and the screen renders placeholders.
router.get('/latest', authenticate, async (req, res, next) => {
  try {
    const { entity_type, entity_ids, kind } = req.query;
    if (!entity_type || !entity_ids) {
      return res.status(400).json({ error: 'entity_type and entity_ids are required' });
    }
    const ids = String(entity_ids).split(',').map(s => s.trim()).filter(Boolean);
    // A page cannot ask about the whole table in one go.
    if (ids.length > 200) return res.status(400).json({ error: 'Too many ids in one request (max 200).' });
    const map = await artifacts.latestForMany({ entity_type, entity_ids: ids, kind: kind || null });
    const out = {};
    for (const [entityId, row] of Object.entries(map)) {
      if (await canAccessStation(req.user.id, row.station_id)) out[entityId] = row;
    }
    res.json(out);
  } catch (err) { next(err); }
});

// GET /api/artifacts/:id/image
router.get('/:id/image', authenticate, async (req, res, next) => {
  try {
    const a = await artifacts.getImage(req.params.id);
    if (!a) return res.status(404).json({ error: 'Artifact not found' });
    if (!(await canAccessStation(req.user.id, a.station_id))) {
      return res.status(403).json({ error: 'You do not have access to this station.' });
    }
    if (!a.file_base64) {
      return res.status(404).json({ error: 'This artifact has no stored image.' });
    }
    const buf = Buffer.from(a.file_base64, 'base64');
    res.set('Content-Type', a.media_type || 'image/jpeg');
    // An artifact is immutable once written, so it can be cached hard. Private:
    // it is a customer's coupon or a member of staff's photograph, and must not
    // sit in a shared proxy cache.
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
