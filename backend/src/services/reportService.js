// src/services/reportService.js
const pool   = require('../db/pool');
const logger = require('../utils/logger');
const { sendEmail } = require('./alertService');

async function sendDailySummaries() {
  logger.info('Sending daily corporate summaries...');
  const today = new Date().toISOString().slice(0,10);

  const { rows: corps } = await pool.query(
    'SELECT * FROM corporate_accounts WHERE is_active=TRUE AND contact_email IS NOT NULL'
  );

  for (const corp of corps) {
    const { rows: txns } = await pool.query(`
      SELECT ct.amount, cd.name AS driver, cd.vehicle_number,
             de.fuel_type, de.quantity_ltrs, de.occurred_at
      FROM corporate_transactions ct
      JOIN corporate_drivers cd ON cd.id = ct.driver_id
      JOIN dispense_events de ON de.id = ct.dispense_event_id
      WHERE ct.corporate_id=$1 AND de.occurred_at::date=$2
        AND NOT COALESCE(de.is_voided,FALSE)
      ORDER BY de.occurred_at`, [corp.id, today]);

    if (!txns.length) continue;

    const total = txns.reduce((s,r) => s + parseFloat(r.amount), 0);
    const lines = txns.map(t =>
      `${new Date(t.occurred_at).toLocaleTimeString('en-IN')} | ${t.driver} | ${t.vehicle_number} | ${t.fuel_type} | ${t.quantity_ltrs}L | ₹${parseFloat(t.amount).toFixed(2)}`
    ).join('\n');

    const body = `Daily Fuel Summary for ${corp.company_name}\nDate: ${today}\n\n${lines}\n\nTotal: ₹${total.toFixed(2)}\nOutstanding: ₹${parseFloat(corp.current_outstanding).toFixed(2)}`;

    await sendEmail(corp.contact_email, `Fuel Summary – ${today} – ${corp.company_name}`, body)
      .catch(e => logger.warn(`Summary email failed for ${corp.company_name}:`, e.message));
  }
}

async function sendMonthlySummaries() {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth()).padStart(2,'0')}`;
  logger.info('Sending monthly summaries for', month);
  // Similar to daily but aggregated by driver over the month
  // TODO: expand as needed
}

module.exports = { sendDailySummaries, sendMonthlySummaries };
