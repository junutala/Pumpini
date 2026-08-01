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

// Recognised parents. Kept as a list so an unknown entity_type is caught here
// rather than becoming an un-queryable orphan row nobody can find again.
// 'station' is the parent for a capture that belongs to the outlet rather than to
// any one record — a gauge screen photographed for the dip register outside a
// shift, for instance. Those carry entity_id NULL and are found by station+kind.
const ENTITY_TYPES = ['dispense_event', 'shift', 'shift_attendant', 'dipstick_reading', 'station', 'user', 'pump'];

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
      [station_id, entity_type || null, entity_id, kind, storage_path, bytes,
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
    return rows[0] || null;
  } catch (e) {
    log('error', `artifact: fetch failed — ${e.message || e}`);
    return null;
  }
}

function log(level, msg) {
  try { require('../utils/logger')[level](msg); } catch { /* logger optional */ }
}

module.exports = { save, listFor, getImage, hasTable, KINDS, ENTITY_TYPES };
