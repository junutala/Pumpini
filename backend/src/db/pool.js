// src/db/pool.js
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
require('dotenv').config();

// Supabase / hosted Postgres: use DATABASE_URL if set, else individual vars
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },  // required for Supabase
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'petrol_dms',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      // Enable SSL for remote hosts (Supabase, RDS, etc.)
      ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    };

const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // TCP keep-alive so the Supabase pooler / NAT doesn't silently drop a
  // connection that's been idle (e.g. while a user sits on a screen). Without
  // this, the first request after an idle spell can grab a dead socket and fail,
  // with a retry "magically" working — the classic stale-connection symptom.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Hard ceilings so one slow/hung query can't pin a connection while every
  // outlet's dashboard polls pile up behind it.
  statement_timeout: 15000,             // 15s per statement
  query_timeout: 20000,                 // client-side guard above that
  application_name: 'pumpini-backend',
});

pool.on('error', (err) => {
  // Logged via logger (not console) so it reaches persisted Railway logs.
  try { require('../utils/logger').error('Unexpected DB pool error', err); }
  catch { console.error('Unexpected DB pool error', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// RLS identity layer.
//
// The connection role (Supabase owner) has BYPASSRLS, so RLS is inert by default.
// To make the database enforce per-outlet isolation, an authenticated request
// runs its queries on a dedicated client that has switched to the non-bypass role
// `app_authenticated` and published its identity via `app.user_id` (read by the
// my_stations()/my_corporates() policy helpers).
//
// We stash that client in AsyncLocalStorage and make pool.query / pool.connect
// transparently use it, so the ~30 route files that `require('./db/pool')` need
// no changes. Queries on the request client are SERIALIZED (a single pg client
// can't run two queries at once) so existing Promise.all(pool.query, …) still work.
//
// Unauthenticated paths (login, token refresh, passkey verify, public lead form,
// webhooks) and the superadmin console carry no identity → they run on the raw
// pool as the bypass owner role, which is exactly what login and cross-tenant
// admin work require.
// ─────────────────────────────────────────────────────────────────────────────
const als = new AsyncLocalStorage();
const realQuery   = pool.query.bind(pool);
const realConnect = pool.connect.bind(pool);

// Serialize a query onto the request client via the store's promise chain.
function chainedQuery(store, args) {
  const run = () => store.client.query(...args);
  const p = store.chain.then(run, run);
  store.chain = p.then(() => {}, () => {});   // keep the chain alive past failures
  return p;
}

// A dead/stale connection (idle-dropped by the pooler or NAT) throws one of
// these. Such an error means the statement never ran, so retrying on a FRESH
// connection is safe. We never retry real query errors (syntax, constraint,
// statement_timeout) — only connection-layer failures.
function isRetryableConnError(e) {
  if (!e) return false;
  const code = String(e.code || '');
  if (['57P01','08006','08003','08000','08001','08004','ECONNRESET','EPIPE','ETIMEDOUT'].includes(code)) return true;
  const m = String(e.message || '').toLowerCase();
  return m.includes('connection terminated')
      || m.includes('server closed the connection')
      || m.includes('connection reset')
      || m.includes('terminating connection')
      || m.includes('not queryable');
}

// realQuery acquires + releases its own connection per call, so retrying it
// transparently picks a fresh connection — exactly what we want after an idle
// drop. (The identity-client path can't do this: its connection is fixed for the
// request, so a dead one surfaces and the user retries the whole action — keepAlive
// makes that rare.)
async function realQueryRetry(args) {
  try { return await realQuery(...args); }
  catch (e) {
    if (isRetryableConnError(e)) return await realQuery(...args);
    throw e;
  }
}

pool.query = (...args) => {
  const store = als.getStore();
  return store ? chainedQuery(store, args) : realQueryRetry(args);
};

// Inside a request, pool.connect() shares the one request client. release() is a
// no-op (the request lifecycle owns the client); BEGIN/COMMIT run as normal
// statements — the role/identity are session-level, so they persist across them.
pool.connect = (cb) => {
  if (typeof cb === 'function') return realConnect(cb);   // legacy callback form
  const store = als.getStore();
  if (!store) return realConnect();
  const proxy = new Proxy(store.client, {
    get(target, prop) {
      if (prop === 'release') return () => {};
      if (prop === 'query')   return (...a) => chainedQuery(store, a);
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return Promise.resolve(proxy);
};

// Reset ONLY what the identity layer sets (role + our GUCs), so the pool's
// connection-level settings (statement_timeout, application_name, …) survive.
async function clearIdentity(client) {
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('app.user_id', '', false)");
  await client.query("SELECT set_config('app.corporate_id', '', false)");
}

async function acquireIdentityClient(userId, corporateId) {
  const client = await realConnect();
  try {
    // Clear any residue before assuming an identity (defence-in-depth vs a
    // connection that wasn't reset cleanly by a prior request).
    await clearIdentity(client);
    await client.query('SET ROLE app_authenticated');
    await client.query("SELECT set_config('app.user_id', $1, false)", [String(userId)]);
    if (corporateId) {
      await client.query("SELECT set_config('app.corporate_id', $1, false)", [String(corporateId)]);
    }
    return client;
  } catch (err) {
    try { client.release(true); } catch { /* destroy on failure */ }
    throw err;
  }
}

async function resetAndRelease(client) {
  try {
    await clearIdentity(client);
    client.release();
  } catch {
    // If we can't prove the connection is clean, destroy it rather than risk
    // returning a connection still carrying app_authenticated + an identity.
    try { client.release(true); } catch { /* already gone */ }
  }
}

// Express middleware: open an RLS identity context for an authenticated request.
// Superadmin (separate admin token) and unauthenticated requests pass through on
// the bypass role.
async function identityMiddleware(req, res, next) {
  if (!req.user || !req.user.id || req.user.is_superadmin) return next();
  let client;
  try {
    client = await acquireIdentityClient(req.user.id, req.user.corporate_id);
  } catch (err) {
    return next(err);
  }
  const store = { client, chain: Promise.resolve() };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    resetAndRelease(client);
  };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  als.run(store, () => next());
}

// Run a function with the RLS identity of a given user (for crons/scripts/tests
// that must act as a specific user instead of the bypass role).
async function runAs(identity, fn) {
  const client = await acquireIdentityClient(identity.userId, identity.corporateId);
  const store = { client, chain: Promise.resolve() };
  try {
    return await als.run(store, fn);
  } finally {
    await resetAndRelease(client);
  }
}

pool.als                = als;
pool.identityMiddleware = identityMiddleware;
pool.runAs              = runAs;
pool.isRetryableConnError = isRetryableConnError;

module.exports = pool;
