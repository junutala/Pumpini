// src/utils/secretBox.js
//
// THE one place PSP credentials are encrypted at rest. AES-256-GCM with a key
// derived (scrypt) from the PSP_ENC_KEY env var. Plaintext secrets NEVER touch
// the database or the logs — only the base64(iv|tag|ciphertext) blob is stored,
// and it is useless without PSP_ENC_KEY, which lives in Railway env, not the DB.
// See docs/upi-verification-fsd.md §17 (Security posture).
//
// This is the FIRST encryption helper in the codebase — keep it the only one, so
// every PSP secret travels the same, audited path (the one-writer rule).
const crypto = require('crypto');

const RAW = process.env.PSP_ENC_KEY || '';

// Derive a 32-byte key from the env passphrase. The domain salt is fixed on
// purpose — the secrecy lives in PSP_ENC_KEY; the salt only separates this use
// from any other. STAGING must get a DISTINCT PSP_ENC_KEY from prod, like JWT_SECRET.
function _key() {
  if (!RAW) throw new Error('PSP_ENC_KEY is not set');
  return crypto.scryptSync(RAW, 'pumpini-psp-secretbox-v1', 32);
}

// Is encryption available? Callers should 503 (not throw/500) when this is false.
function configured() { return !!RAW; }

// object -> base64 string
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _key(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

// base64 string -> object  (throws on a tampered blob — GCM auth tag)
function decrypt(b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', _key(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

module.exports = { encrypt, decrypt, configured };
