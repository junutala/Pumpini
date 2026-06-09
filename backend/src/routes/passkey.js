// src/routes/passkey.js  — WebAuthn / biometric login (SimpleWebAuthn v13)
const router = require('express').Router();
const pool   = require('../db/pool');
const jwt    = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

const RP_NAME = 'Pumpini';
const RP_ID   = process.env.WEBAUTHN_RP_ID  || 'localhost';
const _origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
// Accept both www and non-www so either redirect target works
const ORIGINS = Array.from(new Set([
  _origin,
  _origin.startsWith('https://www.') ? _origin.replace('https://www.', 'https://')
                                     : _origin.replace('https://', 'https://www.'),
]));

// In-memory challenge store — 5 min TTL, cleaned every minute
const _store = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _store) if (v.exp < now) _store.delete(k);
}, 60_000);
const storeChallenge = (key, challenge) =>
  _store.set(key, { challenge, exp: Date.now() + 5 * 60 * 1000 });
const popChallenge = (key) => {
  const entry = _store.get(key);
  if (!entry || entry.exp < Date.now()) return null;
  _store.delete(key);
  return entry.challenge;
};

// ── Registration (user must be logged in) ───────────────────

// POST /api/auth/passkey/register-begin
router.post('/register-begin', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, phone FROM users WHERE id=$1', [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    const { rows: existing } = await pool.query(
      'SELECT credential_id FROM user_passkeys WHERE user_id=$1', [req.user.id]
    );

    const options = await generateRegistrationOptions({
      rpName:          RP_NAME,
      rpID:            RP_ID,
      userID:          Buffer.from(user.id), // UUID bytes as user identifier
      userName:        user.phone,
      userDisplayName: user.name,
      excludeCredentials: existing.map(c => ({
        id: isoBase64URL.toBuffer(c.credential_id),
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey:      'preferred',
        userVerification: 'required',
      },
    });

    storeChallenge(`reg_${req.user.id}`, options.challenge);
    res.json(options);
  } catch (err) { next(err); }
});

// POST /api/auth/passkey/register-finish
router.post('/register-finish', authenticate, async (req, res, next) => {
  try {
    const expectedChallenge = popChallenge(`reg_${req.user.id}`);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired — please try again.' });
    }

    const verification = await verifyRegistrationResponse({
      response:                req.body,
      expectedChallenge,
      expectedOrigin:          ORIGINS,
      expectedRPID:            RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Biometric verification failed.' });
    }

    const { credential } = verification.registrationInfo;
    // credential.id and credential.publicKey are Uint8Array in v13
    const credentialId = isoBase64URL.fromBuffer(Buffer.from(credential.id));
    const publicKey    = isoBase64URL.fromBuffer(Buffer.from(credential.publicKey));

    await pool.query(
      `INSERT INTO user_passkeys(user_id, credential_id, public_key, counter, device_name)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(credential_id) DO UPDATE SET counter=$4, device_name=$5`,
      [req.user.id, credentialId, publicKey, credential.counter, req.body.deviceName || null]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Authentication (no login required) ─────────────────────

// POST /api/auth/passkey/auth-begin
router.post('/auth-begin', async (req, res, next) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID:             RP_ID,
      userVerification: 'required',
      allowCredentials: [], // discoverable — browser shows credential picker
    });

    const sessionKey = `auth_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    storeChallenge(sessionKey, options.challenge);

    res.json({ ...options, sessionKey });
  } catch (err) { next(err); }
});

// POST /api/auth/passkey/auth-finish
router.post('/auth-finish', async (req, res, next) => {
  try {
    const { sessionKey, ...assertion } = req.body;
    const expectedChallenge = popChallenge(sessionKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired — please try again.' });
    }

    // Find the credential
    console.log('[passkey] auth-finish received id:', assertion.id, 'len:', String(assertion.id||'').length);

    // Also fetch all stored credential IDs for comparison
    const { rows: allCreds } = await pool.query('SELECT credential_id FROM user_passkeys');
    console.log('[passkey] stored credential_ids:', allCreds.map(r => r.credential_id + '(len=' + r.credential_id.length + ')'));

    const { rows } = await pool.query(
      `SELECT pk.credential_id, pk.public_key, pk.counter,
              u.id AS user_id, u.name, u.phone, u.role, u.language,
              u.must_change_password
       FROM user_passkeys pk
       JOIN users u ON u.id = pk.user_id
       WHERE pk.credential_id = $1`,
      [assertion.id]
    );
    if (!rows.length) {
      console.log('[passkey] NO MATCH. received:', assertion.id, '| stored:', allCreds.map(r=>r.credential_id).join(', '));
      return res.status(401).json({ error: 'Credential not recognised. Please login with password.' });
    }
    const cred = rows[0];

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response:                assertion,
        expectedChallenge,
        expectedOrigin:          ORIGINS,
        expectedRPID:            RP_ID,
        requireUserVerification: true,
        credential: {
          id:        isoBase64URL.toBuffer(cred.credential_id),
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter:   Number(cred.counter),
        },
      });
    } catch (verifyErr) {
      console.error('[passkey auth] verifyAuthenticationResponse threw:', verifyErr.message);
      return res.status(401).json({ error: 'Biometric authentication failed.', detail: verifyErr.message });
    }

    if (!verification.verified) {
      console.error('[passkey auth] verified=false, authInfo:', verification.authenticationInfo);
      return res.status(401).json({ error: 'Biometric authentication failed.' });
    }

    // Update counter (replay-attack prevention)
    await pool.query(
      'UPDATE user_passkeys SET counter=$1 WHERE credential_id=$2',
      [verification.authenticationInfo.newCounter, cred.credential_id]
    );

    const token = jwt.sign(
      { id: cred.user_id, role: cred.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: {
        id:                   cred.user_id,
        name:                 cred.name,
        phone:                cred.phone,
        role:                 cred.role,
        language:             cred.language,
        must_change_password: cred.must_change_password,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/auth/passkey/status — is a passkey registered for this user?
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, device_name, created_at FROM user_passkeys WHERE user_id=$1',
      [req.user.id]
    );
    res.json({ registered: rows.length > 0, passkeys: rows });
  } catch (err) { next(err); }
});

// DELETE /api/auth/passkey/:id — remove a passkey
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM user_passkeys WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
