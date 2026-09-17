// FORGOT PASSWORD — THE SEND MUST HAPPEN BEFORE THE WRITE.
//
// On 16-Sep-2026 the owner of SBR Energies pressed "Forgot Password" and was
// locked out of his own outlet. Production has never had WHATSAPP_API_KEY or
// WHATSAPP_ENDPOINT set, so sendWhatsApp() wrote a line to the Railway log and
// RESOLVED — reporting success it had not achieved. The route had already
// overwritten his password_hash with a random 8-char string and bumped his
// token_version, and it returned {ok:true}, so the screen told him to go and
// check WhatsApp for a message that was never sent and a password nobody could
// ever read back.
//
// The bug was not the missing credential. It was the ORDER: an irreversible
// local change committed before the remote step it depends on, with the remote
// failure swallowed. These tests pin the order, because the credential will one
// day be configured and then this whole class of failure goes quiet again until
// the provider has an outage.
const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const http   = require('http');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');
const resolve = (p) => require.resolve(path.join(SRC, p));

// ── Test doubles, installed before the route is required ──────────────
const calls = { queries: [], sends: [], bumps: [] };
let configured = true;
let sendBehaviour = 'ok'; // 'ok' | 'throw' | 'demo'

const USER = { id: 'u-1', phone: '+919912499448', password_hash: 'OLD-HASH', is_active: true };

function installStubs() {
  require.cache[resolve('db/pool.js')] = { id: resolve('db/pool.js'), loaded: true, exports: {
    query: async (sql, params) => {
      calls.queries.push({ sql, params });
      if (/^\s*SELECT \* FROM users/i.test(sql)) return { rows: [USER] };
      return { rows: [] };
    },
  }};
  require.cache[resolve('services/whatsappService.js')] = {
    id: resolve('services/whatsappService.js'), loaded: true, exports: {
      isConfigured: () => configured,
      sendWhatsApp: async (to, message) => {
        calls.sends.push({ to, message });
        if (sendBehaviour === 'throw') throw new Error('provider 500');
        if (sendBehaviour === 'demo')  return { demo: true, to, message };
        return { ok: true };
      },
      normalizePhone: (r) => r,
    }};
  require.cache[resolve('middleware/auth.js')] = {
    id: resolve('middleware/auth.js'), loaded: true, exports: {
      authenticate: (req, _res, next) => { req.user = { id: 'u-1' }; next(); },
      bumpTokenVersion: async (id) => { calls.bumps.push(id); },
    }};
  const quiet = () => {};
  require.cache[resolve('utils/logger.js')] = {
    id: resolve('utils/logger.js'), loaded: true,
    exports: { info: quiet, warn: quiet, error: quiet, debug: quiet },
  };
}

installStubs();
const authRouter = require(resolve('routes/auth.js'));

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
const server = http.createServer(app);

function post(body) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json() }));
}

// A password write is any UPDATE that touches password_hash.
const passwordWrites = () =>
  calls.queries.filter(q => /UPDATE users SET password_hash/i.test(q.sql));

function reset({ conf = true, send = 'ok' } = {}) {
  calls.queries.length = 0; calls.sends.length = 0; calls.bumps.length = 0;
  configured = conf; sendBehaviour = send;
}

test.before(() => new Promise(res => server.listen(0, '127.0.0.1', res)));
test.after(() => new Promise(res => server.close(res)));

test('NO PROVIDER CONFIGURED: the password is not touched and the caller is told', async () => {
  reset({ conf: false });
  // Use a DIFFERENT number each time — the route is rate-limited per IP+phone.
  const res = await post({ phone: '9912499448' });

  assert.strictEqual(res.status, 503, 'must refuse, not pretend to succeed');
  assert.strictEqual(passwordWrites().length, 0, '🔴 THE LOCKOUT: password_hash was written with no way to deliver it');
  assert.strictEqual(calls.bumps.length, 0, 'sessions must not be killed either');
  assert.ok(/not available/i.test(res.body.error), `error must say so, got: ${res.body.error}`);
});

test('NO PROVIDER CONFIGURED: it never even looks the user up, so it leaks nothing', async () => {
  reset({ conf: false });
  await post({ phone: '9912499449' });
  // Same answer for a real number and an invented one, because neither is queried.
  assert.strictEqual(calls.queries.length, 0, 'an unconfigured deploy must answer identically to everyone');
});

test('SEND FAILS: the old password still works', async () => {
  reset({ send: 'throw' });
  const res = await post({ phone: '9912499450' });

  assert.strictEqual(res.status, 502);
  assert.strictEqual(calls.sends.length, 1, 'it must have attempted the send');
  assert.strictEqual(passwordWrites().length, 0, 'a failed send must leave the account untouched');
  assert.strictEqual(calls.bumps.length, 0);
  assert.ok(/still works/i.test(res.body.error), `must reassure the user, got: ${res.body.error}`);
});

test('DEMO RESULT IS NOT A SEND — a resolved promise is not delivery', async () => {
  // isConfigured() says yes but the service returns {demo:true}: the exact shape
  // that fooled the old code. A resolved promise must never be read as delivered.
  reset({ send: 'demo' });
  const res = await post({ phone: '9912499451' });

  assert.strictEqual(res.status, 502);
  assert.strictEqual(passwordWrites().length, 0, '🔴 {demo:true} was treated as a successful send');
});

test('SEND SUCCEEDS: only then is the password replaced and sessions killed', async () => {
  reset({ send: 'ok' });
  const res = await post({ phone: '9912499452' });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true });
  assert.strictEqual(calls.sends.length, 1);
  assert.strictEqual(passwordWrites().length, 1, 'the reset must actually take effect');
  assert.deepStrictEqual(calls.bumps, ['u-1'], 'existing sessions are revoked on a real reset');
});

test('ORDER: the message is handed to the provider BEFORE the account changes', async () => {
  // The route destructures sendWhatsApp at require time, so a late monkey-patch
  // of the export would never be seen. Read the order off what the base stubs
  // already record: at the instant of the password write, has a send happened?
  reset({ send: 'ok' });
  let writeSeenBeforeSend = null;
  const pool = require.cache[resolve('db/pool.js')].exports;
  const realQuery = pool.query;
  pool.query = async (sql, params) => {
    if (/UPDATE users SET password_hash/i.test(sql) && writeSeenBeforeSend === null) {
      writeSeenBeforeSend = calls.sends.length === 0;
    }
    return realQuery(sql, params);
  };

  await post({ phone: '9912499453' });
  pool.query = realQuery;

  assert.strictEqual(writeSeenBeforeSend, false,
    '🔴 the password was changed before the message went out — this is the lockout');
  assert.strictEqual(calls.sends.length, 1, 'the send must have happened');
});

test('the temp password is never promised as single-use — nothing enforces that', async () => {
  reset({ send: 'ok' });
  await post({ phone: '9912499454' });
  const msg = calls.sends[0].message;
  assert.ok(!/one login only/i.test(msg),
    'the message claimed single-use; no column or check enforces it, so it must not be claimed');
  assert.ok(/temporary password/i.test(msg));
});
