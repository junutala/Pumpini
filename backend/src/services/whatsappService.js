// src/services/whatsappService.js
//
// WhatsApp wrapper for Pumpini.
// Provider-agnostic: works with MSG91 WhatsApp, Twilio, Interakt, or the
// WhatsApp Cloud API by configuring env vars. Falls back to a "demo" log mode
// when no credentials are present (same pattern as alertService SMS/email).
//
//   WHATSAPP_API_KEY        – provider auth key/token
//   WHATSAPP_ENDPOINT       – provider send-message URL
//   WHATSAPP_VERIFY_TOKEN   – token used to verify inbound webhook (Cloud API)
//
const pool   = require('../db/pool');
const logger = require('../utils/logger');
const axios  = require('axios');

// ── Phone normalization (matches auth.js convention) ─────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('+')) return digits;
  return `+${digits}`;
}

const inr = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Outbound: send a WhatsApp message ────────────────────────────────
async function sendWhatsApp(phone, message) {
  const to = normalizePhone(phone);
  if (!process.env.WHATSAPP_API_KEY || !process.env.WHATSAPP_ENDPOINT) {
    logger.info(`WhatsApp (demo) -> ${to}: ${message}`);
    return { demo: true, to, message };
  }
  const { data } = await axios.post(
    process.env.WHATSAPP_ENDPOINT,
    { phone: to.replace('+', ''), message },
    { headers: { apikey: process.env.WHATSAPP_API_KEY }, timeout: 15000 }
  );
  return data;
}

// ── Webhook verification (WhatsApp Cloud API GET handshake) ──────────
function verifyWebhook(query) {
  const mode      = query['hub.mode'];
  const token     = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

// ── Parse inbound payload into a normalized {from, text} ─────────────
// Tolerant of multiple provider shapes (Cloud API, MSG91, Twilio, generic).
function parseInbound(body) {
  try {
    // WhatsApp Cloud API
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg) {
      return { from: msg.from, text: msg.text?.body?.trim() || '' };
    }
    // Twilio form-encoded
    if (body?.From && body?.Body !== undefined) {
      return { from: String(body.From).replace('whatsapp:', ''), text: String(body.Body).trim() };
    }
    // MSG91 / generic
    if (body?.mobile || body?.phone || body?.from) {
      return {
        from: body.mobile || body.phone || body.from,
        text: String(body.message || body.text || '').trim(),
      };
    }
  } catch (e) {
    logger.warn('parseInbound failed:', e.message);
  }
  return null;
}

// ── Identify the sender: which user + which stations they can see ────
async function identifySender(fromPhone) {
  const phone = normalizePhone(fromPhone);
  const { rows } = await pool.query(
    `SELECT id, name, role, language, phone FROM users
     WHERE phone = $1 AND is_active = TRUE`, [phone]
  );
  if (!rows.length) return null;
  const user = rows[0];

  let stations;
  if (user.role === 'owner') {
    // Owners see all stations they're linked to
    const r = await pool.query(
      `SELECT s.id, s.name FROM stations s
       JOIN station_users su ON su.station_id = s.id
       WHERE su.user_id = $1 ORDER BY s.name`, [user.id]
    );
    stations = r.rows;
  } else {
    const r = await pool.query(
      `SELECT s.id, s.name FROM stations s
       JOIN station_users su ON su.station_id = s.id
       WHERE su.user_id = $1 ORDER BY s.name`, [user.id]
    );
    stations = r.rows;
  }
  return { user, stations };
}

// ── Command handlers ─────────────────────────────────────────────────
async function cmdSales(stationIds) {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT fuel_type,
            SUM(quantity_ltrs) AS ltrs,
            SUM(amount)        AS amount
     FROM dispense_events
     WHERE station_id = ANY($1) AND occurred_at::date = $2
     GROUP BY fuel_type ORDER BY fuel_type`,
    [stationIds, today]
  );
  if (!rows.length) return `No sales recorded yet today (${today}).`;
  const lines = rows.map(r => `• ${r.fuel_type}: ${Number(r.ltrs).toFixed(1)}L — ${inr(r.amount)}`);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return `*Today's Sales* (${today})\n${lines.join('\n')}\n\n*Total: ${inr(total)}*`;
}

async function cmdStock(stationIds) {
  const { rows } = await pool.query(
    `SELECT tank_number, fuel_type, current_stock, capacity_ltrs
     FROM tanks WHERE station_id = ANY($1)
     ORDER BY tank_number`, [stationIds]
  );
  if (!rows.length) return 'No tanks configured.';
  const lines = rows.map(r => {
    const pct = r.capacity_ltrs ? Math.round((r.current_stock / r.capacity_ltrs) * 100) : 0;
    return `• T${r.tank_number} ${r.fuel_type}: ${Number(r.current_stock).toFixed(0)}L (${pct}%)`;
  });
  return `*Tank Stock*\n${lines.join('\n')}`;
}

async function cmdOutstanding(stationIds) {
  const { rows } = await pool.query(
    `SELECT company_name, current_outstanding, credit_limit
     FROM corporate_accounts
     WHERE is_active = TRUE AND current_outstanding > 0
     ORDER BY current_outstanding DESC LIMIT 10`
  );
  if (!rows.length) return 'No outstanding credit balances. 🎉';
  const lines = rows.map(r => `• ${r.company_name}: ${inr(r.current_outstanding)}`);
  const total = rows.reduce((s, r) => s + Number(r.current_outstanding), 0);
  return `*Credit Outstanding* (top ${rows.length})\n${lines.join('\n')}\n\n*Total: ${inr(total)}*`;
}

function cmdHelp(name) {
  return `Hi ${name || 'there'} 👋\nPumpini WhatsApp commands:\n\n` +
    `*SALES* — today's sales summary\n` +
    `*STOCK* — current tank levels\n` +
    `*CREDIT* — outstanding credit balances\n` +
    `*HELP* — show this menu`;
}

// ── Main router: take inbound text, return reply text ────────────────
async function handleInbound(fromPhone, text) {
  const ctx = await identifySender(fromPhone);
  if (!ctx) {
    return 'This number is not registered with Pumpini. Please contact your station owner.';
  }
  const { user, stations } = ctx;
  const stationIds = stations.map(s => s.id);
  if (!stationIds.length) {
    return `Hi ${user.name}, you are not linked to any station yet.`;
  }

  const cmd = (text || '').trim().toUpperCase().split(/\s+/)[0];
  switch (cmd) {
    case 'SALES':  return cmdSales(stationIds);
    case 'STOCK':  return cmdStock(stationIds);
    case 'CREDIT':
    case 'OUTSTANDING': return cmdOutstanding(stationIds);
    case 'HELP':
    case 'HI':
    case 'HELLO':
    case 'MENU':   return cmdHelp(user.name);
    default:       return `Unknown command "${text}".\n\n` + cmdHelp(user.name);
  }
}

module.exports = {
  normalizePhone,
  sendWhatsApp,
  verifyWebhook,
  parseInbound,
  identifySender,
  handleInbound,
};
