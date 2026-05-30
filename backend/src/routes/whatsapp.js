// src/routes/whatsapp.js
//
// WhatsApp wrapper endpoints.
//   GET  /api/whatsapp/webhook   – provider verification handshake (Cloud API)
//   POST /api/whatsapp/webhook   – inbound message handler (the "bot")
//   POST /api/whatsapp/send      – authenticated manual send (owner/manager)
//
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const {
  verifyWebhook,
  parseInbound,
  handleInbound,
  sendWhatsApp,
} = require('../services/whatsappService');

// ── Webhook verification (GET) ───────────────────────────────────────
// Providers like the WhatsApp Cloud API call this once to confirm the URL.
router.get('/webhook', (req, res) => {
  const challenge = verifyWebhook(req.query);
  if (challenge) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ── Inbound messages (POST) ──────────────────────────────────────────
// Always reply 200 quickly so the provider doesn't retry; do work, then
// send the reply back out-of-band via the provider's send API.
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const inbound = parseInbound(req.body);
    if (!inbound || !inbound.from) {
      logger.info('WhatsApp inbound: unrecognized payload');
      return;
    }
    logger.info(`WhatsApp inbound from ${inbound.from}: ${inbound.text}`);
    const reply = await handleInbound(inbound.from, inbound.text);
    if (reply) {
      await sendWhatsApp(inbound.from, reply).catch(e =>
        logger.warn('WhatsApp reply failed:', e.message)
      );
      // Notify connected dashboards that a bot reply went out
      if (req.io) req.io.emit('whatsapp:reply', { to: inbound.from, text: reply });
    }
  } catch (err) {
    logger.error('WhatsApp inbound error:', err.message);
  }
});

// ── Manual send (authenticated) ──────────────────────────────────────
router.post('/send', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }
    const result = await sendWhatsApp(phone, message);
    res.json({ ok: true, result });
  } catch (err) { next(err); }
});

// ── Simulate an inbound message (dev/test helper) ────────────────────
// Lets you test the bot logic without a live provider. Returns the reply
// text directly instead of sending it.
router.post('/simulate', authenticate, async (req, res, next) => {
  try {
    const { from, text } = req.body;
    if (!from || !text) {
      return res.status(400).json({ error: 'from and text are required' });
    }
    const reply = await handleInbound(from, text);
    res.json({ from, text, reply });
  } catch (err) { next(err); }
});

module.exports = router;
