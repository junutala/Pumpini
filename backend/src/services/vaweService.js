// src/services/vaweService.js
//
// Outbound integration: push Pumpini outlets (stations) to VAWE, the external
// operations-follow-up system. Whenever an outlet is created or updated we send
// it to VAWE via a signed webhook; VAWE upserts on `pumpiniOutletId`.
//
//   VAWE_API_URL             – base URL of the VAWE API (no trailing slash needed)
//   PUMPINI_WEBHOOK_SECRET   – shared secret; keys the HMAC-SHA256 body signature
//
// Design notes:
//  • The push is fault-isolated — a VAWE outage must never break an outlet save.
//    Routes call `queueOutletSync()` (fire-and-forget, detached from the request
//    connection); the blocking work lives in `syncOutlet()` used by the backfill.
//  • The signature is computed over the EXACT string we send. We serialize the
//    body once, sign that string, and hand that same string to axios — never the
//    object — so nothing can re-serialize it and break the signature (→ VAWE 401).
//
const crypto = require('crypto');
const axios  = require('axios');
const pool   = require('../db/pool');
const logger = require('../utils/logger');
// Phone normalization is centralized in whatsappService (matches auth.js) so the
// E.164 shape we send VAWE is identical to the rest of the system.
const { normalizePhone } = require('./whatsappService');

const VAWE_PATH     = '/integrations/pumpini/outlets';
const SIGNAL_PATH   = '/integrations/pumpini/webhook';   // reverse signals (interaction updates)
const MAX_ATTEMPTS  = 5;
const BASE_DELAY_MS = 500;   // backoff: 0.5s, 1s, 2s, 4s (+ jitter)
const HTTP_TIMEOUT  = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── BCP-47 language tag ──────────────────────────────────────────────
// We store a primary language code ('en','te','hi',…); VAWE wants a BCP-47 tag
// ('te-IN'). All our users are in India, so a bare 2-letter code maps to `-IN`.
// Anything already regioned passes through; anything unrecognized is omitted.
function toBcp47(lang) {
  if (!lang) return null;
  const s = String(lang).trim();
  if (!s) return null;
  if (/^[a-z]{2,3}-[a-z0-9]{2,}$/i.test(s)) return s;         // already BCP-47
  if (/^[a-z]{2,3}$/i.test(s)) return `${s.toLowerCase()}-IN`; // primary → India
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Map a resolved outlet row → the exact body VAWE expects ──────────
// Pure and side-effect-free so it can be unit-tested. Throws (code
// 'VAWE_INCOMPLETE') when a required, non-empty field is missing rather than
// sending a payload VAWE would just 400.
function buildOutletPayload(o) {
  const missing = [];
  const nonEmpty = (v, label) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (!s) missing.push(label);
    return s;
  };

  const pumpiniOutletId = nonEmpty(o.id, 'pumpiniOutletId');
  const name            = nonEmpty(o.name, 'name');
  const city            = nonEmpty(o.city, 'city');

  const managerName  = nonEmpty(o.manager_name, 'manager.name');
  const managerPhone = normalizePhone(o.manager_phone);
  if (!managerPhone) missing.push('manager.phone');

  const ownerName  = nonEmpty(o.owner_name, 'owner.name');
  const ownerPhone = normalizePhone(o.owner_phone);
  if (!ownerPhone) missing.push('owner.phone');

  if (missing.length) {
    const err = new Error(
      `Outlet ${o.id} is missing required VAWE fields: ${missing.join(', ')}`
    );
    err.code = 'VAWE_INCOMPLETE';
    throw err;
  }

  // Built in the documented key order; oilCompany + latitude/longitude are optional.
  const payload = { pumpiniOutletId, name, city };
  const oilCompany = o.oil_company == null ? '' : String(o.oil_company).trim();
  if (oilCompany) payload.oilCompany = oilCompany; // optional — half of the SO gate
  const lat = toNumber(o.latitude);
  const lng = toNumber(o.longitude);
  if (lat !== null) payload.latitude = lat;
  if (lng !== null) payload.longitude = lng;

  const manager = { name: managerName, phone: managerPhone };
  const language = toBcp47(o.manager_language);
  if (language) manager.language = language; // optional
  payload.manager = manager;

  payload.owner = { name: ownerName, phone: ownerPhone };
  return payload;
}

// ── Sign the raw request body ────────────────────────────────────────
// Hex HMAC-SHA256 over the exact string, keyed with PUMPINI_WEBHOOK_SECRET.
function signBody(rawBody) {
  const secret = process.env.PUMPINI_WEBHOOK_SECRET;
  if (!secret) throw new Error('PUMPINI_WEBHOOK_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function backoffMs(attempt) {
  const base = BASE_DELAY_MS * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250); // jitter to avoid thundering herd
}

function statusError(status, data, outletId) {
  const err = new Error(`VAWE returned ${status} for outlet ${outletId}`);
  err.status = status;
  err.responseData = data;
  return err;
}

// ── POST a payload to VAWE with a signed body and retry/backoff ──────
// Returns VAWE's JSON on 2xx. Retries transient failures (network, 5xx, 429);
// treats 400/401 as terminal (a retry can't fix a bad payload or a wrong secret)
// and logs them clearly. VAWE dedupes on pumpiniOutletId, so retries are safe.
async function postToVawe(payload) {
  const base = process.env.VAWE_API_URL;
  if (!base) throw new Error('VAWE_API_URL is not set');
  const url = `${base.replace(/\/+$/, '')}${VAWE_PATH}`;

  // Serialize ONCE, sign that exact string, and send that exact string.
  const raw = JSON.stringify(payload);
  const signature = signBody(raw);
  const headers = {
    'Content-Type': 'application/json',
    'X-Pumpini-Signature': signature,
  };

  const outletId = payload.pumpiniOutletId;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await axios.post(url, raw, {
        headers,
        timeout: HTTP_TIMEOUT,
        transformRequest: [(d) => d], // never let axios re-serialize our signed string
        validateStatus: () => true,   // we branch on status ourselves
      });
    } catch (netErr) {
      // Connection reset / timeout / DNS — transient, retry.
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `VAWE unreachable for outlet ${outletId} after ${attempt} attempts: ${netErr.message}`
        );
      }
      logger.warn(`VAWE network error for outlet ${outletId} (attempt ${attempt}/${MAX_ATTEMPTS}): ${netErr.message}`);
      await sleep(backoffMs(attempt));
      continue;
    }

    const { status, data } = res;

    if (status >= 200 && status < 300) {
      logger.info(
        `VAWE accepted outlet ${outletId} → status=${data?.status || status}, outletId=${data?.outletId || '?'}`
      );
      return data;
    }

    if (status === 401) {
      logger.error(
        `VAWE 401 for outlet ${outletId}: signature/secret mismatch — check PUMPINI_WEBHOOK_SECRET matches VAWE.`
      );
      throw statusError(status, data, outletId);
    }

    if (status === 400) {
      logger.error(
        `VAWE 400 for outlet ${outletId}: bad payload — ${JSON.stringify(data)}`
      );
      throw statusError(status, data, outletId);
    }

    // 5xx / 429 / anything else → transient, retry.
    if (attempt >= MAX_ATTEMPTS) {
      logger.error(`VAWE outlet ${outletId} failed after ${attempt} attempts (last status=${status}).`);
      throw statusError(status, data, outletId);
    }
    logger.warn(`VAWE outlet ${outletId} got status=${status}, retrying (attempt ${attempt}/${MAX_ATTEMPTS}).`);
    await sleep(backoffMs(attempt));
  }
}

// ── Load every field VAWE needs for one outlet, in one query ─────────
// The "primary" owner/manager is the earliest-created active user of that role
// linked to the station. Runs on the bypass role (cross-tenant) — same as other
// webhooks/scripts — so it works from the request tail and the backfill alike.
async function loadOutletForVawe(stationId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.city, s.oil_company,
            ss.latitude, ss.longitude,
            mgr.name     AS manager_name,
            mgr.phone    AS manager_phone,
            mgr.language AS manager_language,
            own.name     AS owner_name,
            own.phone    AS owner_phone
       FROM stations s
       LEFT JOIN station_settings ss ON ss.station_id = s.id
       LEFT JOIN LATERAL (
         SELECT u.name, u.phone, u.language
           FROM users u
           JOIN station_users su ON su.user_id = u.id
          WHERE su.station_id = s.id AND u.role = 'manager' AND u.is_active = TRUE
          ORDER BY u.created_at ASC
          LIMIT 1
       ) mgr ON TRUE
       LEFT JOIN LATERAL (
         SELECT u.name, u.phone
           FROM users u
           JOIN station_users su ON su.user_id = u.id
          WHERE su.station_id = s.id AND u.role = 'owner' AND u.is_active = TRUE
          ORDER BY u.created_at ASC
          LIMIT 1
       ) own ON TRUE
      WHERE s.id = $1`,
    [stationId]
  );
  return rows[0] || null;
}

// ── Blocking sync of one outlet: load → build → post ─────────────────
// Used by the backfill. Returns VAWE's response, or null if the outlet is gone.
async function syncOutlet(stationId) {
  const outlet = await loadOutletForVawe(stationId);
  if (!outlet) {
    logger.warn(`VAWE sync skipped: outlet ${stationId} not found.`);
    return null;
  }
  const payload = buildOutletPayload(outlet);
  return postToVawe(payload);
}

// ── Fire-and-forget trigger for request handlers ─────────────────────
// Never throws and never blocks the caller. Detached from the request's RLS
// identity + connection (which is released when the response finishes) so it runs
// on the bypass role and a slow/failing VAWE call can't hold or fail the request.
function queueOutletSync(stationId) {
  pool.als.exit(() => {
    setImmediate(() => {
      syncOutlet(stationId).catch((err) => {
        if (err.code === 'VAWE_INCOMPLETE') {
          logger.warn(`VAWE sync skipped for outlet ${stationId}: ${err.message}`);
        } else {
          logger.error(`VAWE sync failed for outlet ${stationId}: ${err.message}`);
        }
      });
    });
  });
}

// ── Reverse signal: interaction update (Pumpini → VAWE) ──────────────
// When the outlet manager acts on an "SO Instructions" item, tell VAWE so it can
// settle the interaction (FULFILMENT) or record the commit-by date (UPDATE).
// Signed + retried exactly like the outlet push; VAWE keys on data.interactionId
// and is idempotent, so retries are safe.
async function postSignal(signal) {
  const base = process.env.VAWE_API_URL;
  if (!base) throw new Error('VAWE_API_URL is not set');
  const url = `${base.replace(/\/+$/, '')}${SIGNAL_PATH}`;

  const raw = JSON.stringify(signal);            // serialize ONCE, sign that exact string
  const signature = signBody(raw);
  const headers = { 'Content-Type': 'application/json', 'X-Pumpini-Signature': signature };
  const label = `${signal.signalType} ${signal.data?.interactionId || signal.externalRef}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await axios.post(url, raw, {
        headers,
        timeout: HTTP_TIMEOUT,
        transformRequest: [(d) => d],
        validateStatus: () => true,
      });
    } catch (netErr) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`VAWE unreachable for signal ${label} after ${attempt} attempts: ${netErr.message}`);
      }
      logger.warn(`VAWE network error for signal ${label} (attempt ${attempt}/${MAX_ATTEMPTS}): ${netErr.message}`);
      await sleep(backoffMs(attempt));
      continue;
    }

    const { status, data } = res;
    if (status >= 200 && status < 300) {
      logger.info(`VAWE accepted signal ${label} → status=${data?.status || status}, applied=${data?.applied}`);
      return data;
    }
    if (status === 401 || status === 400) {
      logger.error(`VAWE ${status} for signal ${label}: ${JSON.stringify(data)}`);
      throw statusError(status, data, label);
    }
    if (attempt >= MAX_ATTEMPTS) {
      logger.error(`VAWE signal ${label} failed after ${attempt} attempts (last status=${status}).`);
      throw statusError(status, data, label);
    }
    logger.warn(`VAWE signal ${label} got status=${status}, retrying (attempt ${attempt}/${MAX_ATTEMPTS}).`);
    await sleep(backoffMs(attempt));
  }
}

// Fire-and-forget from a request handler — a VAWE outage must never fail the
// manager's action. Detached from the request's RLS identity/connection so it
// runs on the bypass role after the response is sent.
function queueInteractionSignal(signal) {
  pool.als.exit(() => {
    setImmediate(() => {
      postSignal(signal).catch((err) => {
        logger.error(`VAWE signal failed (${signal.signalType} ${signal.data?.interactionId}): ${err.message}`);
      });
    });
  });
}

module.exports = {
  toBcp47,
  buildOutletPayload,
  signBody,
  postToVawe,
  loadOutletForVawe,
  syncOutlet,
  queueOutletSync,
  postSignal,
  queueInteractionSignal,
};
