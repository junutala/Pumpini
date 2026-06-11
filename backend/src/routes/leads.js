// src/routes/leads.js
// Public lead-capture endpoint for the marketing site's "Get in touch" form.
// No auth — anyone can submit. Lead is always persisted; owner notification
// via WhatsApp is best-effort (logs in demo mode when no provider configured).
const router = require('express').Router();
const pool   = require('../db/pool');
const logger = require('../utils/logger');
const { sendWhatsApp } = require('../services/whatsappService');

// POST /api/leads
router.post('/', async (req, res, next) => {
  try {
    const { name, station_name, city, state, phone, email, message, company } = req.body;

    // Honeypot — bots fill hidden "company" field; humans never see it.
    if (company) return res.status(201).json({ ok: true });

    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO leads(name, station_name, city, state, phone, email, message, source)
       VALUES($1,$2,$3,$4,$5,$6,$7,'website') RETURNING id`,
      [
        String(name).trim().slice(0, 120),
        station_name ? String(station_name).trim().slice(0, 160) : null,
        city ? String(city).trim().slice(0, 80) : null,
        state ? String(state).trim().slice(0, 60) : null,
        String(phone).trim().slice(0, 20),
        email ? String(email).trim().slice(0, 160) : null,
        message ? String(message).trim().slice(0, 1000) : null,
      ]
    );

    // Lead is captured in the admin Leads screen (WhatsApp notify dropped).
    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (err) { next(err); }
});

module.exports = router;
