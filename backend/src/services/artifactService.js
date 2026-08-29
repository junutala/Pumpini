// src/services/artifactService.js
//
// THE one writer for stored document images. Every photograph Pumpini keeps as
// proof — credit coupon, ATG/Pinelabs gauge screen, attendant photo at shift
// start/close — lands here, in public.station_artifacts, under a named parent.
//
// WHY A SERVICE AND NOT AN INSERT AT EACH CALL SITE
//
//  1. ONE WRITER (CLAUDE.md anti-drift rule). The first cut of coupon capture
//     parsed the image and discarded it; the gauge scan still does. Fixing that
//     with an INSERT in coupons.js and another in dipstick.js is how you end up
//     with two ideas of what a "kind" is and one of them missing its RLS check.
//
//  2. AN ARTIFACT MUST NEVER BREAK THE THING IT IS EVIDENCE OF. Storing the
//     photograph is strictly secondary to recording the sale, the dip or the
//     shift start. So every write here is best-effort: it returns null rather
//     than throwing, and — when composed into a caller's transaction — it runs
//     inside a SAVEPOINT so a failure cannot abort the money write it rode in on.
//     A coupon that saves without its picture is a small loss; a coupon that
//     fails to save because its picture wouldn't store is a real one.
//
//  3. THE TABLE DEPLOYS AFTER THE CODE. DDL is run manually by the owner, so
//     this file lives both before and after the migration and must be harmless
//     in between. It probes information_schema — a catalog SELECT that succeeds
//     either way and therefore cannot poison a transaction. It does NOT try the
//     insert and catch 42P01/42703; inside a BEGIN…COMMIT that would abort the
//     whole transaction and take the sale down with it. (See CLAUDE.md — that
//     exact mistake broke every credit invoice in prod on 30-Jul.)
const pool = require('../db/pool');
const { storageConfigured, uploadDocumentBase64, downloadDocument } = require('./vaweStorage');

// Recognised parents. Kept as a list so an unknown entity_type is caught here
// rather than becoming an un-queryable orphan row nobody can find again.
// 'station' is the parent for a capture that belongs to the outlet rather than to
// any one record — a gauge screen photographed for the dip register outside a
// shift, for instance. Those carry entity_id NULL and are found by station+kind.
const ENTITY_TYPES = ['dispense_event', 'shift', 'shift_attendant', 'dipstick_reading', 'station', 'user', 'pump', 'credit_slip_book'];

// Must stay in step with the CHECK constraint in pumpini-schema.sql.
const KINDS = ['coupon', 'gauge_screen', 'attendant_photo', 'nozzle_meter', 'nozzle_slip'];

// Base64 of a phone photo downscaled by the client runs well under 1 MB. This is
// a backstop against an un-resized 12-megapixel original, not a policy: past it
// we keep the RECORD (so the trail shows a photo was taken) and drop the bytes,
// which is far better than failing the capture.
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

let _hasTable = false;
async function hasTable(client = pool) {
  if (_hasTable) return true;                 // cached only once TRUE — see below
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='station_artifacts' LIMIT 1`
    );
    _hasTable = rows.length > 0;
  } catch {
    _hasTable = false;
  }
  // A false result is deliberately NOT cached, so the first capture after the
  // owner runs the DDL starts storing without needing an app restart.
  return _hasTable;
}

// Save one artifact. Returns the row, or null when nothing was stored (table not
// migrated yet, no image supplied, or the insert failed). NEVER throws.
//
// Pass the caller's transaction `client` to tie the artifact to the same commit
// as its parent — the coupon image and the credit sale it evidences should
// either both exist or neither.
async function save(input, client = pool) {
  const {
    station_id, entity_type, entity_id = null, kind,
    file_base64 = null, media_type = null, storage_path = null,
    ocr = null, meta = null, uploaded_by = null,
  } = input || {};

  if (!station_id || !kind) return null;
  if (!file_base64 && !storage_path) return null;         // nothing to keep
  if (!KINDS.includes(kind)) {
    log('warn', `artifact: refusing unknown kind "${kind}"`);
    return null;
  }
  if (entity_type && !ENTITY_TYPES.includes(entity_type)) {
    log('warn', `artifact: refusing unknown entity_type "${entity_type}"`);
    return null;
  }
  if (!(await hasTable(client))) return null;

  let bytes = file_base64;
  if (bytes && Buffer.byteLength(bytes, 'utf8') > MAX_BASE64_BYTES) {
    log('warn', `artifact: ${kind} image over ${MAX_BASE64_BYTES} bytes — storing the record without the image`);
    bytes = null;
    if (!storage_path) return null;
  }

  // ── THE BYTES GO TO THE BUCKET, NOT INTO POSTGRES ──────────────────────────
  //
  // This function has always ACCEPTED a storage_path from its caller but never
  // produced one, and no caller ever uploaded first — so every artifact ever
  // written, 31 of them, sat inline as base64 in the table while
  // delivery_invoices (78/78) and meter_photos (39/39) were correctly in the
  // bucket. Not a regression: the upload was simply never wired on this path.
  // Base64 is ~33% larger than the JPEG it encodes, so 31 photographs had grown
  // the table to 39 MB, and every read of the row dragged the whole image with it.
  //
  // Uploading HERE rather than in each caller is deliberate: artifactService is
  // the one writer for an artifact, so slips, gauge screens, coupons and staff
  // photographs all reach the bucket by construction instead of four callers
  // each remembering to.
  //
  // FALLS BACK TO INLINE, ALWAYS. If the bucket is unconfigured or the upload
  // fails we keep the base64 exactly as before. Evidence is never dropped for
  // want of a bucket — a photograph that exists in a slow place beats one that
  // does not exist.
  // ONLY ON AUTOCOMMIT. An upload is a network round-trip with a 30s ceiling, and
  // save() is called INSIDE the settlement transaction for the operator's close
  // photograph. Awaiting a bucket there would hold a money transaction — and its
  // locks — open for the length of someone's mobile upload. storeMeterPhoto carries
  // the same rule in its header for the same reason. Inside a caller's transaction
  // the bytes stay inline exactly as before; the shift-wide scans (slips, gauge
  // screens, coupons) all run on `pool` and do go to the bucket.
  const onAutocommit = client === pool;
  let objectPath = storage_path;
  if (bytes && !objectPath && onAutocommit && storageConfigured()) {
    try {
      objectPath = await uploadDocumentBase64({
        // station_id + kind give the readable path (<outlet>/<kind>/<date>/…).
        // prefix/scope stay as the fallback for a station that will not resolve.
        station_id, kind,
        prefix: `artifacts/${kind}`,
        scope: entity_id || station_id,
        base64: bytes,
        contentType: media_type || 'image/jpeg',
        filename: media_type === 'application/pdf' ? 'doc.pdf' : 'image.jpg',
      });
      bytes = null;                       // the bucket holds it now
    } catch (e) {
      objectPath = null;
      log('warn', `artifact: ${kind} upload failed, keeping base64 — ${e.message || e}`);
    }
  }

  // Inside somebody else's transaction, isolate the insert. If it fails we roll
  // back only this statement and the caller's work survives untouched.
  const inTxn = client !== pool;
  const sp = 'artifact_sp';
  try {
    if (inTxn) await client.query(`SAVEPOINT ${sp}`);
    const { rows } = await client.query(
      `INSERT INTO station_artifacts
         (station_id, entity_type, entity_id, kind, storage_path, file_base64,
          media_type, ocr, meta, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, station_id, entity_type, entity_id, kind, media_type,
                 ocr, meta, captured_at, uploaded_by`,
      [station_id, entity_type || null, entity_id, kind, objectPath, bytes,
       media_type, ocr ? JSON.stringify(ocr) : null, meta ? JSON.stringify(meta) : null,
       uploaded_by]
    );
    if (inTxn) await client.query(`RELEASE SAVEPOINT ${sp}`);
    return rows[0];
  } catch (e) {
    if (inTxn) { try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* noop */ } }
    log('error', `artifact: could not store ${kind} — ${e.message || e}`);
    return null;
  }
}

// Artifacts for one parent, newest first. Metadata only — the bytes are big and
// a list screen never needs them; fetch one with getImage().
async function listFor({ entity_type, entity_id }, client = pool) {
  if (!entity_id || !(await hasTable(client))) return [];
  try {
    const { rows } = await client.query(
      `SELECT id, station_id, entity_type, entity_id, kind, media_type, ocr, meta,
              captured_at, uploaded_by,
              (file_base64 IS NOT NULL OR storage_path IS NOT NULL) AS has_image
         FROM station_artifacts
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY captured_at DESC`,
      [entity_type, entity_id]
    );
    return rows;
  } catch (e) {
    log('error', `artifact: list failed — ${e.message || e}`);
    return [];
  }
}

// Metadata + bytes for a single artifact, station-scoped by the caller.
async function getImage(id, client = pool) {
  if (!id || !(await hasTable(client))) return null;
  try {
    const { rows } = await client.query(
      `SELECT id, station_id, entity_type, entity_id, kind, media_type,
              file_base64, storage_path, ocr, meta, captured_at, uploaded_by
         FROM station_artifacts WHERE id = $1`, [id]
    );
    const row = rows[0] || null;
    if (!row) return null;

    // ONE CONTRACT FOR THE CALLER: it asked for an image and it gets the bytes,
    // wherever they live. Older artifacts carry base64; new ones carry a path into
    // the private bucket. Resolving that here means /artifacts/:id/image — and the
    // ArtifactImage component behind it — did not have to learn about storage.
    if (!row.file_base64 && row.storage_path) {
      try {
        row.file_base64 = (await downloadDocument(row.storage_path)).toString('base64');
      } catch (e) {
        log('error', `artifact: download failed for ${row.storage_path} — ${e.message || e}`);
      }
    }
    return row;
  } catch (e) {
    log('error', `artifact: fetch failed — ${e.message || e}`);
    return null;
  }
}

// The NEWEST artifact of one kind for each of many parents, as { entity_id: row }.
// A list screen showing a face against fifty names must not fire fifty requests,
// and listFor() answers for exactly one parent. DISTINCT ON is the cheap way to
// say "latest per entity" in one round trip.
async function latestForMany({ entity_type, entity_ids, kind = null }, client = pool) {
  const ids = (Array.isArray(entity_ids) ? entity_ids : []).filter(Boolean);
  if (!ids.length || !(await hasTable(client))) return {};
  try {
    const params = [entity_type, ids];
    let kindSql = '';
    if (kind) { params.push(kind); kindSql = ` AND kind = $${params.length}`; }
    const { rows } = await client.query(
      `SELECT DISTINCT ON (entity_id)
              id, station_id, entity_type, entity_id, kind, media_type, meta, captured_at
         FROM station_artifacts
        WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])${kindSql}
          AND (file_base64 IS NOT NULL OR storage_path IS NOT NULL)
        ORDER BY entity_id, captured_at DESC`,
      params
    );
    const out = {};
    for (const r of rows) out[r.entity_id] = r;
    return out;
  } catch (e) {
    log('error', `artifact: latest lookup failed — ${e.message || e}`);
    return {};
  }
}

// THE one writer for a member of staff's REFERENCE photograph — the picture his
// shift-start captures are checked against, and the one the matcher will use when
// it eventually replaces the operator picker altogether. Enrolment at Add
// Attendant and a later re-shoot are the SAME concept, so they go through the
// same function rather than two hand-copied artifacts.save() blocks that can
// drift on kind, entity_type or meta.
//
// A re-shoot is an INSERT, not an update: the old photograph is left in place and
// the newest simply wins. Faces change, and a record of what someone looked like
// when a given shift was worked is worth more than the disk it costs.
async function saveAttendantPhoto(
  { station_id, user_id, name = null, phase = 'enrolment', file_base64, media_type,
    descriptor = null, uploaded_by },
  client = pool
) {
  return save({
    station_id,
    entity_type: 'user',
    entity_id: user_id,
    kind: 'attendant_photo',
    file_base64: file_base64 || null,
    media_type: media_type || null,
    meta: { phase, name, ...(cleanDescriptor(descriptor) ? { descriptor: cleanDescriptor(descriptor) } : {}) },
    uploaded_by,
  }, client);
}

// The 128 numbers the browser read off the enrolment photograph — the reference
// every shift-start face is measured against. Stored on the artifact's meta rather
// than in a column of its own so this needed no DDL, and so a re-shoot carries its
// own descriptor with it instead of the two drifting apart.
//
// VALIDATED, NEVER TRUSTED. It arrives from a phone, so anything that is not
// exactly 128 finite numbers is dropped and the photograph is still stored — the
// enrolment succeeds, it just cannot be matched against until it is re-taken.
// Rounded to 6 places: the model's precision is nowhere near that, and it keeps a
// row a few kB rather than tens.
// The facial verdict, sanitised. Lives HERE and not in the two routes that record
// it, because shift START and shift CLOSE both write it and a copy in each is
// exactly the drift the one-writer rule exists to stop. Returns null for anything
// unrecognised — the photograph is still stored, just without a verdict.
function cleanMatch(m) {
  if (!m || typeof m !== 'object') return null;
  const verdict = ['strong', 'likely', 'unsure'].includes(m.verdict) ? m.verdict : null;
  if (!verdict) return null;
  const dist = Number(m.distance);
  return {
    verdict,
    matched_user_id: typeof m.user_id === 'string' ? m.user_id.slice(0, 64) : null,
    distance: Number.isFinite(dist) ? Math.round(dist * 1e4) / 1e4 : null,
    // Naming the engine means a later change of model does not silently invalidate
    // comparisons against rows written by this one.
    engine: 'face-api/128d',
  };
}

function cleanDescriptor(d) {
  if (!Array.isArray(d) || d.length !== 128) return null;
  const out = new Array(128);
  for (let i = 0; i < 128; i++) {
    const n = Number(d[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = Math.round(n * 1e6) / 1e6;
  }
  return out;
}

function log(level, msg) {
  try { require('../utils/logger')[level](msg); } catch { /* logger optional */ }
}

module.exports = {
  save, listFor, latestForMany, getImage, hasTable, cleanDescriptor, cleanMatch,
  saveAttendantPhoto, KINDS, ENTITY_TYPES,
};
