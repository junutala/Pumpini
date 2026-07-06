// Unit tests for the VAWE artifact storage helper (pure parts — no network).
const test = require('node:test');
const assert = require('node:assert');
const { safeName, storageConfigured, uploadArtifact } = require('../src/services/vaweStorage');

test('safeName strips paths and unsafe characters', () => {
  assert.strictEqual(safeName('proof photo.jpg'), 'proof_photo.jpg');
  assert.strictEqual(safeName('/etc/../evil name!.png'), 'evil_name_.png');
  assert.strictEqual(safeName('C:\\Users\\x\\clip.mp4'), 'clip.mp4');
  assert.strictEqual(safeName(''), 'proof');
  assert.strictEqual(safeName(null), 'proof');
});

test('safeName bounds the length', () => {
  const long = 'a'.repeat(200) + '.pdf';
  assert.ok(safeName(long).length <= 80);
});

test('storageConfigured reflects the SUPABASE_* env', () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  assert.strictEqual(storageConfigured(), false);
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'k';
  assert.strictEqual(storageConfigured(), true);
  // restore
  if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = key;
});

test('uploadArtifact refuses when storage is not configured', async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  await assert.rejects(
    () => uploadArtifact({ stationId: 's', interactionId: 'i', bytes: Buffer.from('x'), contentType: 'image/png' }),
    /not configured/,
  );
  if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = key;
});
