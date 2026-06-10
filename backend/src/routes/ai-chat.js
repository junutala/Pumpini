// src/routes/ai-chat.js
const router    = require('express').Router();
const pool      = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/ai-chat
router.post('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { message, station_id, language = 'en' } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
    if (!station_id)      return res.status(400).json({ error: 'Station ID is required' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const isOwner = req.user.role === 'owner'; // blind drop: non-owners don't get open-shift sales

    // Fetch live station context
    const [salesRes, shiftsRes, stockRes, alertsRes, pricesRes, cashIntRes] = await Promise.all([
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
        WHERE s.station_id = $1 AND s.date = $2 AND (s.status='closed' OR $3)`,
        [station_id, today, isOwner]
      ),
      pool.query(`
        SELECT shift_number, status, start_time
        FROM shifts WHERE station_id = $1 AND date = $2 ORDER BY shift_number`,
        [station_id, today]
      ),
      pool.query(`
        SELECT tank_number, fuel_type, capacity_ltrs, current_stock
        FROM tanks WHERE station_id = $1
        ORDER BY tank_number`,
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
      // Cash integrity (owner only): per-operator undercash over the last 30 days.
      // A clean operator is over/exact, never under — repeated undercash = suspect.
      isOwner ? pool.query(`
        SELECT u.name AS operator,
          COUNT(*)::int                                              AS recons,
          COUNT(*) FILTER (WHERE r.cash_actual < r.cash_expected)::int AS undercash,
          COALESCE(SUM(CASE WHEN r.cash_actual < r.cash_expected
                            THEN r.cash_expected - r.cash_actual ELSE 0 END),0) AS total_short
        FROM shift_reconciliation r
        JOIN shifts s ON s.id = r.shift_id
        JOIN users  u ON u.id = r.attendant_id
        WHERE s.station_id = $1 AND r.manager_confirmed = TRUE
          AND r.reconciled_at >= NOW() - make_interval(days => 30)
        GROUP BY u.name HAVING COUNT(*) > 0
        ORDER BY undercash DESC, total_short DESC LIMIT 10`,
        [station_id]) : Promise.resolve({ rows: [] }),
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
            `${t.fuel_type} (Tank ${t.tank_number}): ${parseFloat(t.current_stock).toFixed(0)}L / ${parseFloat(t.capacity_ltrs).toFixed(0)}L`
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
      ...(isOwner ? [
        '',
        '--- Cash Integrity (last 30 days, OWNER ONLY) ---',
        'A clean operator is over or exact at shift end, never under. Repeated undercash (declaring less than the meter expected) is a red flag for skimming, even if the shortfall was made good on the spot.',
        cashIntRes.rows.length
          ? cashIntRes.rows.map(c => `${c.operator}: ${c.undercash}/${c.recons} shifts undercash, total short ₹${parseFloat(c.total_short).toLocaleString('en-IN')}`).join('\n')
          : 'No confirmed reconciliations in the last 30 days.',
      ] : []),
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
    // Surface the real Anthropic error (status + message) so it's diagnosable
    // from the chat UI / network tab instead of a generic "could not reach AI".
    const detail = err?.error?.error?.message || err?.message || 'Unknown error';
    console.error('[ai-chat] error:', err?.status, detail, err?.error);
    res.status(502).json({ error: 'ai_unreachable', status: err?.status || null, detail });
  }
});

module.exports = router;
