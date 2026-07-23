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
  // signedURL is a root-relative path like /storage/v1/object/sign/<bucket>/<path>?token=...
  return `${apiBase()}${res.data.signedURL}`;
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

// Upload an in-app DOCUMENT (invoice scan, meter photo) to the PRIVATE doc bucket
// from a base64 string. Returns the storage PATH to persist in the DB (never a
// signed URL — those expire; we mint them on read). `prefix` groups objects by
// concept (e.g. 'delivery-invoices', 'meter-photos'); `scope` is an id (station /
// shift) that makes objects traceable.
async function uploadDocumentBase64({ prefix, scope, base64, contentType, filename }) {
  const bytes = Buffer.from(base64, 'base64');
  const ext = safeName(filename || (contentType === 'application/pdf' ? 'doc.pdf' : 'doc.jpg'));
  const path = `${prefix}/${scope || 'na'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${ext}`;
  await putObject({ bucket: docBucket(), path, bytes, contentType });
  return path;
}

// Mint a signed URL for a stored document path (private doc bucket).
async function signedDocUrl(path, expiresIn) {
  return signedUrl({ bucket: docBucket(), path, expiresIn });
}

module.exports = {
  storageConfigured,
  safeName,
  putObject,
  signedUrl,
  uploadArtifact,
  uploadDocumentBase64,
  signedDocUrl,
  docBucket,
  DEFAULT_BUCKET,
  DEFAULT_DOC_BUCKET,
};
