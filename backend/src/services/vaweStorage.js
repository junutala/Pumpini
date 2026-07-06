// src/services/vaweStorage.js
//
// Uploads VAWE "SO Instructions" proof artifacts to Supabase Storage (a PUBLIC
// bucket) and returns the public URL. That URL is handed to VAWE (and thus the
// SO), so the proof is viewable without a Pumpini login.
//
// Object keys embed the OUTLET (station) id — `<stationId>/<interactionId>-...`
// — so every artifact is traceable to its source outlet. That is the hook the
// future SO / oil-company / region stripping keys off (finite outlets per SO).
//
//   SUPABASE_URL          – https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY  – service-role key (server-only; never shipped)
//   VAWE_ARTIFACT_BUCKET  – public bucket name (default 'vawe-artifacts')
//
const axios = require('axios');

const DEFAULT_BUCKET = 'vawe-artifacts';

function storageConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

// Sanitize a client-supplied filename for use in an object key: keep only safe
// characters, strip any path, and bound the length.
function safeName(name) {
  const base = String(name || 'proof').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(-80) || 'proof';
}

// Upload bytes to the public bucket and return the public URL. The key is
// `<stationId>/<interactionId>-<timestamp>-<filename>` so artifacts sort and
// filter by outlet. Throws on a non-2xx (caller decides how to surface it).
async function uploadArtifact({ stationId, interactionId, bytes, contentType, filename }) {
  if (!storageConfigured()) {
    throw new Error('Artifact storage not configured (SUPABASE_* env missing)');
  }
  const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.VAWE_ARTIFACT_BUCKET || DEFAULT_BUCKET;
  const path = `${stationId}/${interactionId}-${Date.now()}-${safeName(filename)}`;
  const res = await axios.post(`${base}/storage/v1/object/${bucket}/${path}`, bytes, {
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
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
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

module.exports = { storageConfigured, safeName, uploadArtifact, DEFAULT_BUCKET };
