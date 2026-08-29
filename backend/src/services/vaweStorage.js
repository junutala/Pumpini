// src/services/vaweStorage.js
//
// The ONE travel path from Pumpini to Supabase Storage. Two concepts ride it:
//
//   1. VAWE "SO Instructions" proof artifacts → a PUBLIC bucket, returns a public
//      URL handed to VAWE/the SO (viewable without a Pumpini login). Unchanged.
//   2. In-app DOCUMENTS (delivery-invoice scans, meter photos) → a PRIVATE bucket,
//      returns a storage path; reads mint a short-lived SIGNED URL. This replaces
//      storing raw base64 bytes in Postgres (delivery_invoices.file_base64,
//      meter_photos.image_base64) — the DB keeps only the path.
//
// Everything funnels through putObject()/signedUrl() so there is exactly one
// uploader (the one-writer-per-concept rule): no second Supabase client anywhere.
//
//   SUPABASE_URL          – https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY  – service-role key
//                           (server-only; never shipped). We accept the common
//                           aliases so it works with whatever the project set.
//   VAWE_ARTIFACT_BUCKET  – public bucket for VAWE proof (default 'vawe-artifacts')
//   PUMPINI_DOC_BUCKET    – PRIVATE bucket for in-app documents (default 'pumpini-docs')
//   SIGNED_URL_TTL_SECONDS – signed-URL lifetime for private reads (default 600 = 10 min)
//
const axios = require('axios');

const DEFAULT_BUCKET = 'vawe-artifacts';
const DEFAULT_DOC_BUCKET = 'pumpini-docs';

// Accept the common env-var names for the service-role key — different Supabase
// setups use SUPABASE_SERVICE_KEY vs SUPABASE_SERVICE_ROLE_KEY vs SUPABASE_KEY.
function serviceKey() {
  return (
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    ''
  );
}

function storageConfigured() {
  return Boolean(process.env.SUPABASE_URL && serviceKey());
}

function docBucket() {
  return process.env.PUMPINI_DOC_BUCKET || DEFAULT_DOC_BUCKET;
}

function signedUrlTtl() {
  const n = parseInt(process.env.SIGNED_URL_TTL_SECONDS, 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

function apiBase() {
  return process.env.SUPABASE_URL.replace(/\/+$/, '');
}

// Sanitize a client-supplied filename for use in an object key: keep only safe
// characters, strip any path, and bound the length.
function safeName(name) {
  const base = String(name || 'proof').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(-80) || 'proof';
}

// ── Core primitive: PUT bytes to a bucket/path. The single point every upload
// goes through. Throws on a non-2xx (caller decides how to surface it).
async function putObject({ bucket, path, bytes, contentType, upsert = true }) {
  if (!storageConfigured()) {
    throw new Error('Object storage not configured (SUPABASE_* env missing)');
  }
  const res = await axios.post(`${apiBase()}/storage/v1/object/${bucket}/${path}`, bytes, {
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': upsert ? 'true' : 'false',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000,
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    const detail =
      typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    throw new Error(`Supabase upload failed: HTTP ${res.status} ${String(detail).slice(0, 300)}`);
  }
  return path;
}

// ── DELETE objects from a bucket. The counterpart to putObject, and the ONLY way
// bucket objects can be removed: Supabase installs a storage.protect_delete()
// trigger, so a DELETE against storage.objects in SQL is refused outright —
//
//     ERROR: Direct deletion from storage tables is not allowed.
//     HINT:  This prevents accidental data loss from orphaned objects.
//
// which is the right design and is why this has to run where the service key lives.
// Takes up to 1000 paths per call (the API's limit) and returns what it removed.
async function deleteObjects({ bucket, paths }) {
  if (!storageConfigured()) {
    throw new Error('Object storage not configured (SUPABASE_* env missing)');
  }
  const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
  if (!list.length) return [];
  const res = await axios.delete(`${apiBase()}/storage/v1/object/${bucket}`, {
    headers: { Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' },
    data: { prefixes: list },
    timeout: 60000,
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    const detail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    throw new Error(`Supabase delete failed: HTTP ${res.status} ${String(detail).slice(0, 300)}`);
  }
  return Array.isArray(res.data) ? res.data.map(o => o.name || o) : list;
}

// Mint a short-lived signed URL for a private-bucket object. Returns an absolute
// URL. Throws on a non-2xx.
async function signedUrl({ bucket, path, expiresIn }) {
  if (!storageConfigured()) {
    throw new Error('Object storage not configured (SUPABASE_* env missing)');
  }
  const ttl = expiresIn || signedUrlTtl();
  const res = await axios.post(
    `${apiBase()}/storage/v1/object/sign/${bucket}/${path}`,
    { expiresIn: ttl },
    {
      headers: { Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: () => true,
    }
  );
  if (res.status < 200 || res.status >= 300 || !res.data || !res.data.signedURL) {
    const detail =
      typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    throw new Error(`Supabase sign failed: HTTP ${res.status} ${String(detail).slice(0, 300)}`);
  }
  // Supabase returns signedURL relative to the STORAGE API, e.g.
  // "/object/sign/<bucket>/<path>?token=..." — WITHOUT the /storage/v1 prefix (older
  // versions included it). Prepending only the project URL drops /storage/v1, so the
  // object resolves to <project>/object/sign/... which Storage rejects with
  // {"error":"requested path is invalid"} and the document won't load. Normalise so the
  // absolute URL always carries /storage/v1, whichever shape Supabase returns.
  let rel = res.data.signedURL;
  if (/^https?:\/\//i.test(rel)) return rel;          // already absolute
  if (!rel.startsWith('/')) rel = '/' + rel;
  if (!rel.startsWith('/storage/v1')) rel = '/storage/v1' + rel;
  return `${apiBase()}${rel}`;
}

// Upload a VAWE proof artifact to the PUBLIC bucket and return its public URL.
// The key is `<stationId>/<interactionId>-<timestamp>-<filename>` so artifacts
// sort and filter by outlet.
async function uploadArtifact({ stationId, interactionId, bytes, contentType, filename }) {
  const bucket = process.env.VAWE_ARTIFACT_BUCKET || DEFAULT_BUCKET;
  const path = `${stationId}/${interactionId}-${Date.now()}-${safeName(filename)}`;
  await putObject({ bucket, path, bytes, contentType });
  return `${apiBase()}/storage/v1/object/public/${bucket}/${path}`;
}

// THE OUTLET SLUG for a station id, for use in a storage path. Cached — an outlet
// name changes about never, and this sits in the upload path of every photograph.
//
// A slug can only ever be a LABEL. The database row is the identity; if a station is
// renamed, objects already in the bucket keep the old folder and still resolve,
// because every row stores its own storage_path and getImage() reads whatever is
// there. Nothing looks an object up by recomputing its path.
const _slugCache = new Map();
async function stationSlug(station_id) {
  if (!station_id) return null;
  if (_slugCache.has(station_id)) return _slugCache.get(station_id);
  let slug = null;
  try {
    const { rows } = await require('../db/pool').query('SELECT name FROM stations WHERE id=$1', [station_id]);
    const name = String(rows[0]?.name || '').trim();
    if (name) {
      slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')     // spaces, dots, & -> a single dash
        .replace(/^-+|-+$/g, '')          // no leading/trailing dash
        .slice(0, 40) || null;
    }
  } catch { slug = null; }               // never let naming block an upload
  if (slug) _slugCache.set(station_id, slug);
  return slug;
}

// THE THREE FOLDERS. Owner, 29-Aug-2026: "all we need is ATG, Nozzle and
// Deliveries." Every writer in the app maps into one of them, so the bucket has
// three folders instead of three prefixes and forty UUIDs.
const FOLDER = {
  gauge_screen:     'atg',
  atg:              'atg',
  nozzle_slip:      'nozzle',
  meter_photo:      'nozzle',      // a per-nozzle slip photo — same physical thing
  delivery_invoice: 'deliveries',
};

// Upload an in-app DOCUMENT (ATG screen, nozzle slip, delivery invoice) to the
// PRIVATE doc bucket from a base64 string. Returns the storage PATH to persist in
// the DB — never a signed URL, those expire; we mint them on read.
//
// THE PATH IS FOR A HUMAN WITH A BROWSER, because that is who has to find things:
//
//     nozzle/sri-balaji-15BC1412V.1-300826-061204.jpg   (single nozzle: named)
//     nozzle/sri-balaji-300826-061204.jpg               (composite: many nozzles)
//     <folder>/<outlet>[-<nozzle>]-<DDMMYY>-<HHMMSS>.<ext>
//
// It replaces `<prefix>/<uuid>/<epoch-ms>-<rand>-doc.jpg`, which the owner called
// "really a maze" after opening the bucket and finding three prefixes, nine UUID
// folders and filenames like 1787447447914-m5q4r7-meter.jpg. It failed three ways:
//
//   the scope was a UUID        — you could not tell the outlet, and where the scope
//                                 was a SHIFT id, deleting that shift left the object
//                                 unfindable. That happened: clearing Sri Balaji
//                                 orphaned 26 objects whose owner could only be
//                                 recovered by remembering the deleted shift ids.
//   the timestamp was epoch ms  — sortable by a machine, meaningless to a person
//   three prefixes, three rules — artifacts/<kind>/<shift>, meter-photos/<shift>,
//                                 delivery-invoices/<station>
//
// Now the name alone says outlet, date and time, so a file is identifiable even
// pulled out of its folder — and sorting by name groups by outlet, then by date.
//
// SECONDS, not just HHMM as asked, and this is the one deliberate deviation: two
// photographs inside one minute is ordinary (twelve nozzles get scanned in a run),
// and two objects with the same path means the second SILENTLY REPLACES the first.
// Six characters to make losing a photograph impossible is worth it.
//
// FORWARD ONLY — nothing is migrated. Every row stores its own storage_path and
// getImage() resolves whatever is stored, so objects already in the bucket keep
// working untouched. Only new uploads use this.
//
// FALLS BACK, NEVER THROWS. Without a resolvable outlet the old shape is used
// rather than failing: a photograph in an ugly folder beats one that does not exist.
async function uploadDocumentBase64({
  prefix, scope, base64, contentType, filename,
  station_id = null, kind = null, at = null, label = null,
}) {
  const bytes = Buffer.from(base64, 'base64');
  const ext   = safeName(filename || (contentType === 'application/pdf' ? 'doc.pdf' : 'doc.jpg'));
  const rand  = Math.random().toString(36).slice(2, 6);

  const slug = await stationSlug(station_id);
  let path;
  if (slug) {
    // IST. Every user of this system is in India, and a file stamped 300826 must
    // mean the day they worked — not a UTC day that rolls over at 05:30 their time.
    const d   = at instanceof Date ? at : new Date();
    const ist = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString();
    const ddmmyy = ist.slice(8, 10) + ist.slice(5, 7) + ist.slice(2, 4);
    const hhmmss = ist.slice(11, 19).replace(/:/g, '');
    const k      = String(kind || String(prefix || '').split('/').pop() || '');
    const folder = FOLDER[k] || safeName(k) || 'other';
    // `label` is the nozzle name where one applies — 15BC1412V.1, exactly as the
    // slip prints it and exactly as every screen shows it. Owner, 29-Aug: "what if
    // we append the nozzle name. This is unique universally." It is, and it tells
    // you WHICH nozzle without opening the file.
    //
    // It does NOT replace the seconds, and Kamala's own history is why: on 23-Jun
    // nozzle 15BC1412V.2 was photographed at 09:42:26, 09:42:58 and 09:43:25 — three
    // retries of ONE nozzle inside a minute. Under HHMM two of those three would
    // have silently overwritten each other.
    //
    // A composite scan is one photograph of MANY nozzles and an ATG screen has no
    // nozzle at all, so most images carry no label. Absent, the name simply omits it.
    const tag = label ? `-${safeName(String(label))}` : '';
    path = `${folder}/${slug}${tag}-${ddmmyy}-${hhmmss}.${ext.split('.').pop()}`;
  } else {
    path = `${prefix}/${scope || 'na'}/${Date.now()}-${rand}-${ext}`;
  }

  await putObject({ bucket: docBucket(), path, bytes, contentType });
  return path;
}

// Mint a signed URL for a stored document path (private doc bucket).
async function signedDocUrl(path, expiresIn) {
  return signedUrl({ bucket: docBucket(), path, expiresIn });
}

// Fetch a private document's BYTES server-side. Used where the caller must return the
// image itself rather than a URL — /artifacts/:id/image authenticates on the
// Authorization header and hands back raw bytes, and the browser cannot be redirected
// to a signed URL for an <img> it never sends that header on. Signing then fetching
// here keeps the endpoint's contract byte-identical to when the image lived inline,
// so no screen has to change.
async function downloadDocument(path) {
  const url = await signedDocUrl(path);
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Supabase download failed: HTTP ${res.status}`);
  }
  return Buffer.from(res.data);
}

module.exports = {
  storageConfigured,
  safeName,
  putObject,
  deleteObjects,
  signedUrl,
  uploadArtifact,
  uploadDocumentBase64,
  stationSlug,
  signedDocUrl,
  downloadDocument,
  docBucket,
  DEFAULT_BUCKET,
  DEFAULT_DOC_BUCKET,
};
