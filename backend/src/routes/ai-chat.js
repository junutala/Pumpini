// src/routes/ai-chat.js
const router    = require('express').Router();
const pool      = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/ai-chat
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { message, station_id, language = 'en' } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
    if (!station_id)      return res.status(400).json({ error: 'Station ID is required' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Fetch live station context
    const [salesRes, shiftsRes, stockRes, alertsRes, pricesRes] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(de.amount), 0)                                                     AS total_sales,
          COALESCE(SUM(CASE WHEN de.payment_mode='cash'   THEN de.amount ELSE 0 END), 0) AS cash_sales,
          COALESCE(SUM(CASE WHEN de.payment_mode='upi'    THEN de.amount ELSE 0 END), 0) AS upi_sales,
          COALESCE(SUM(CASE WHEN de.payment_mode='credit' THEN de.amount ELSE 0 END), 0) AS credit_sales,
          COALESCE(SUM(CASE WHEN de.payment_mode='card'   THEN de.amount ELSE 0 END), 0) AS card_sales,
          COALESCE(SUM(de.quantity_ltrs), 0)                                              AS total_litres,
          COUNT(*)                                                                        AS txn_count
        FROM dispense_events de
        JOIN shifts s ON s.id = de.shift_id
        WHERE s.station_id = $1 AND s.date = $2`,
        [station_id, today]
      ),
      pool.query(`
        SELECT shift_number, status, start_time
        FROM shifts WHERE station_id = $1 AND date = $2 ORDER BY shift_number`,
        [station_id, today]
      ),
      pool.query(`
        SELECT t.tank_name, t.fuel_type, t.capacity_ltrs,
          COALESCE(
            (SELECT d.volume_ltrs FROM dipstick_readings d
             WHERE d.tank_id = t.id ORDER BY d.recorded_at DESC LIMIT 1),
            0
          ) AS current_stock
        FROM tanks t WHERE t.station_id = $1 AND t.is_active = TRUE`,
        [station_id]
      ),
      pool.query(`
        SELECT alert_type, message, severity, sent_at
        FROM alerts WHERE station_id = $1 AND acknowledged_at IS NULL
        ORDER BY sent_at DESC LIMIT 5`,
        [station_id]
      ),
      pool.query(`
        SELECT fuel_type, price, effective_from
        FROM fuel_prices WHERE station_id = $1
        ORDER BY fuel_type, effective_from DESC`,
        [station_id]
      ),
    ]);

    // Latest price per fuel type
    const priceMap = {};
    pricesRes.rows.forEach(r => { if (!priceMap[r.fuel_type]) priceMap[r.fuel_type] = r.price; });

    const s = salesRes.rows[0];
    const contextLines = [
      `Date: ${today}`,
      `Logged in as: ${req.user.name} (${req.user.role})`,
      '',
      '--- Today\'s Sales ---',
      `Total: ₹${parseFloat(s.total_sales).toLocaleString('en-IN')} (${s.txn_count} transactions)`,
      `Cash: ₹${parseFloat(s.cash_sales).toLocaleString('en-IN')} | UPI: ₹${parseFloat(s.upi_sales).toLocaleString('en-IN')} | Credit: ₹${parseFloat(s.credit_sales).toLocaleString('en-IN')} | Card: ₹${parseFloat(s.card_sales).toLocaleString('en-IN')}`,
      `Fuel dispensed: ${parseFloat(s.total_litres).toFixed(2)} L`,
      '',
      '--- Shifts Today ---',
      shiftsRes.rows.length
        ? shiftsRes.rows.map(x => `Shift ${x.shift_number}: ${x.status}`).join(' | ')
        : 'No shifts found',
      '',
      '--- Tank Stock ---',
      stockRes.rows.length
        ? stockRes.rows.map(t =>
            `${t.fuel_type} (${t.tank_name}): ${parseFloat(t.current_stock).toFixed(0)}L / ${parseFloat(t.capacity_ltrs).toFixed(0)}L`
          ).join('\n')
        : 'No tank data',
      '',
      '--- Current Fuel Prices ---',
      Object.keys(priceMap).length
        ? Object.entries(priceMap).map(([ft, p]) => `${ft}: ₹${p}/L`).join(' | ')
        : 'No price data',
      '',
      '--- Unacknowledged Alerts ---',
      alertsRes.rows.length
        ? alertsRes.rows.map(a => `[${a.severity}] ${a.message}`).join('\n')
        : 'None',
    ].join('\n');

    const langNote = {
      hi: 'Respond in Hindi (हिन्दी). Keep numbers and currency in English/numerals.',
      ta: 'Respond in Tamil (தமிழ்). Keep numbers and currency in English/numerals.',
      te: 'Respond in Telugu (తెలుగు). Keep numbers and currency in English/numerals.',
      kn: 'Respond in Kannada (ಕನ್ನಡ). Keep numbers and currency in English/numerals.',
      mr: 'Respond in Marathi (मराठी). Keep numbers and currency in English/numerals.',
    }[language] || 'Respond in English.';

    const systemPrompt = `You are a helpful assistant for Pumpini, a petrol station management system. You answer questions about the station's operations, sales, stock, shifts, and alerts using the live data below. Be concise, friendly, and use Indian number formatting where appropriate.

${langNote}

Current station data:
${contextLines}`;

    const response = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: message.trim() }],
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('[ai-chat] error:', err?.status, err?.message, err?.error);
    next(err);
  }
});

module.exports = router;
