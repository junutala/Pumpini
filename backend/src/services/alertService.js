// src/services/alertService.js
const pool   = require('../db/pool');
const logger = require('../utils/logger');
const axios  = require('axios');
const nodemailer = require('nodemailer');
// Outbound WhatsApp is centralized in whatsappService (single source of truth).
const { sendWhatsApp } = require('./whatsappService');

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// sendAlert({ station_id, alert_type, severity, message, channels, io })
async function sendAlert({ station_id, alert_type, severity = 'warning', message, channels = ['sms'], io }) {
  // Find owners & managers for this station
  const { rows: recipients } = await pool.query(`
    SELECT u.id, u.name, u.phone, u.email
    FROM users u
    JOIN station_users su ON su.user_id = u.id
    WHERE su.station_id=$1 AND u.role IN ('owner','manager') AND u.is_active=TRUE`,
    [station_id]
  );

  const recipientIds = recipients.map(r => r.id);

  // Save to DB
  await pool.query(
    `INSERT INTO alerts(station_id, alert_type, severity, message, recipient_ids, channels)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [station_id, alert_type, severity, message, recipientIds, channels]
  );

  // Emit real-time
  if (io) {
    io.to(`station:${station_id}`).emit('alert:new', { alert_type, severity, message });
  }

  // Send notifications
  for (const r of recipients) {
    if (channels.includes('sms') && r.phone) {
      await sendSms(r.phone, message).catch(e => logger.warn('SMS failed:', e.message));
    }
    if (channels.includes('email') && r.email) {
      await sendEmail(r.email, `[Petrol DMS Alert] ${alert_type}`, message).catch(e => logger.warn('Email failed:', e.message));
    }
    if (channels.includes('whatsapp') && r.phone) {
      await sendWhatsApp(r.phone, message).catch(e => logger.warn('WhatsApp failed:', e.message));
    }
  }
}

async function sendSms(phone, message) {
  if (!process.env.MSG91_AUTH_KEY) return logger.info('SMS (demo):', phone, message);
  await axios.post('https://api.msg91.com/api/v5/flow/', {
    flow_id: process.env.MSG91_FLOW_ID,
    sender: process.env.MSG91_SENDER_ID || 'PETROL',
    mobiles: phone.replace('+',''),
    VAR1: message,
  }, { headers: { authkey: process.env.MSG91_AUTH_KEY } });
}

async function sendEmail(to, subject, text) {
  if (!process.env.SMTP_HOST) return logger.info('Email (demo):', to, subject);
  await mailer.sendMail({ from: process.env.SMTP_USER, to, subject, text });
}

module.exports = { sendAlert, sendSms, sendEmail, sendWhatsApp };
