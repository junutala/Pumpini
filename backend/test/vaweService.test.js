// backend/test/vaweService.test.js — run with: npm test  (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');

// Secret must be set before signBody reads it. Kept fixed so the signature
// below is a stable known-answer vector.
process.env.PUMPINI_WEBHOOK_SECRET = 'test-webhook-secret';

const pool = require('../src/db/pool');
const {
  signBody,
  buildOutletPayload,
  toBcp47,
} = require('../src/services/vaweService');

// Requiring the service opens a pg Pool (no connection is made). Close it so the
// test process exits cleanly.
test.after(async () => { await pool.end(); });

test('signBody: known body + secret → expected hex HMAC-SHA256', () => {
  // Exact string VAWE would receive; the signature is the hex HMAC over it.
  const body = JSON.stringify({
    pumpiniOutletId: '11111111-1111-1111-1111-111111111111',
    name: 'MG Road Petrol Bunk',
    city: 'Hyderabad',
    manager: { name: 'Ravi Kumar', phone: '+919876543210', language: 'te-IN' },
    owner: { name: 'Anil Reddy', phone: '+919812345678' },
  });
  const expected = '0a4a9cfd5a8348b6d88ec0d6b2b7b5603130454e68f038adc9613494a5de0b5d';
  assert.equal(signBody(body), expected);
});

test('signBody: signature covers the exact string (whitespace changes it)', () => {
  const a = signBody('{"a":1}');
  const b = signBody('{"a": 1}'); // one extra space → different signature
  assert.notEqual(a, b);
});

test('toBcp47: primary codes get the India region; regioned tags pass through', () => {
  assert.equal(toBcp47('te'), 'te-IN');
  assert.equal(toBcp47('en'), 'en-IN');
  assert.equal(toBcp47('te-IN'), 'te-IN');
  assert.equal(toBcp47('HI'), 'hi-IN');
  assert.equal(toBcp47(''), null);
  assert.equal(toBcp47(null), null);
  assert.equal(toBcp47('not a language'), null);
});

test('buildOutletPayload: maps DB row → VAWE body, normalizes phones to E.164', () => {
  const payload = buildOutletPayload({
    id: 'abc-123',
    name: 'City Fuel Point',
    city: 'Vijayawada',
    latitude: '16.5062',            // pg returns numeric as string
    longitude: '80.6480',
    manager_name: 'Sita Devi',
    manager_phone: '9876543210',    // bare 10-digit → +91…
    manager_language: 'te',
    owner_name: 'Rao',
    owner_phone: '919812345678',    // 12-digit 91-prefixed → +91…
  });

  assert.equal(payload.pumpiniOutletId, 'abc-123');
  assert.equal(payload.name, 'City Fuel Point');
  assert.equal(payload.city, 'Vijayawada');
  assert.equal(payload.latitude, 16.5062);
  assert.equal(payload.longitude, 80.648);
  assert.deepEqual(payload.manager, {
    name: 'Sita Devi',
    phone: '+919876543210',
    language: 'te-IN',
  });
  assert.deepEqual(payload.owner, { name: 'Rao', phone: '+919812345678' });
});

test('buildOutletPayload: omits optional lat/long/language when absent', () => {
  const payload = buildOutletPayload({
    id: 'abc-123',
    name: 'City Fuel Point',
    city: 'Vijayawada',
    latitude: null,
    longitude: null,
    manager_name: 'Sita Devi',
    manager_phone: '9876543210',
    manager_language: null,
    owner_name: 'Rao',
    owner_phone: '9812345678',
  });

  assert.ok(!('latitude' in payload));
  assert.ok(!('longitude' in payload));
  assert.ok(!('language' in payload.manager));
});

test('buildOutletPayload: throws VAWE_INCOMPLETE listing every missing required field', () => {
  assert.throws(
    () => buildOutletPayload({
      id: 'abc-123',
      name: '',            // missing
      city: 'Vijayawada',
      manager_name: 'Sita',
      manager_phone: '',   // missing
      owner_name: 'Rao',
      owner_phone: '9812345678',
    }),
    (err) => {
      assert.equal(err.code, 'VAWE_INCOMPLETE');
      assert.match(err.message, /name/);
      assert.match(err.message, /manager\.phone/);
      return true;
    }
  );
});
