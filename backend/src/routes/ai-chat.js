// src/routes/ai-chat.js
const router    = require('express').Router();
const pool      = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const { computeLiveTankStatus } = require('./tankReco');
const { computeDepositStatus } = require('./cashDeposits');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/ai-chat
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('ai_chat.use'), async (req, res, next) => {
  try {
    const { message, station_id, language = 'en' } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
    if (!station_id)      return res.status(400).json({ error: 'Station ID is required' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const isOwner = req.user.role === 'owner'; // blind drop: non-owners don't get open-shift sales

    // Fetch live station context
    const [salesRes, shiftsRes, stockRes, alertsRes, pricesRes, cashIntRes, densityRes] = await Promise.all([
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
        WHERE s.station_id = $1 AND s.date = $2 AND (s.status='closed' OR $3)
          AND NOT COALESCE(de.is_voided,FALSE)`,
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
      // Density log (last 7 days): feeds quality/variance questions. Density
      // moving outside the fuel's normal band, or swinging day to day, is an
      // early adulteration / wrong-decant signal.
      pool.query(`
        SELECT t.tank_number, t.fuel_type, dr.density, dr.temperature_c,
               dr.reading_type, dr.recorded_at
        FROM dipstick_readings dr
        JOIN tanks t ON t.id = dr.tank_id
        WHERE dr.station_id = $1 AND dr.density IS NOT NULL
          AND dr.recorded_at >= NOW() - make_interval(days => 7)
        ORDER BY dr.recorded_at DESC LIMIT 20`,
        [station_id]),
    ]);

    // Latest price per fuel type
    const priceMap = {};
    pricesRes.rows.forEach(r => { if (!priceMap[r.fuel_type]) priceMap[r.fuel_type] = r.price; });

    // Live wet-stock variance (between the last two dips) — not blind-drop sensitive
    let tankStatus = [];
    try { tankStatus = await computeLiveTankStatus(station_id); } catch { /* ignore */ }
    // Cash awaiting bank deposit (owner only)
    let depositStatus = null;
    if (isOwner) { try { depositStatus = await computeDepositStatus(station_id); } catch { /* ignore */ } }

    // Held suspense balances (running, station-wide): petty-cash fund + un-invoiced
    // credit. Separate best-effort queries so a not-yet-migrated table can't break chat.
    let creditSuspense = null, pettyFund = null;
    try { const { rows } = await pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS bal FROM petty_cash_entries WHERE station_id=$1`, [station_id]); pettyFund = Number(rows[0].bal || 0); } catch { /* absent */ }
    try { const { rows } = await pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS bal FROM credit_suspense_entries WHERE station_id=$1`, [station_id]); creditSuspense = Number(rows[0].bal || 0); } catch { /* absent until migration 004 */ }

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
      '--- Live Tank Variance (vs book, since last dip) ---',
      'Negative variance beyond tolerance = possible evaporation/leakage/pilferage. Note the last-dip time; if it is old, the reading is stale.',
      tankStatus.length
        ? tankStatus.map(tk => {
            const v = tk.variance_ltrs;
            const dip = tk.last_reading_at ? new Date(tk.last_reading_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
            return `Tank ${tk.tank_number} (${tk.fuel_type}): ${tk.current_vol != null ? Math.round(tk.current_vol) + 'L' : 'no reading'}${tk.fill_pct != null ? ` (${tk.fill_pct}%)` : ''}` +
              (v != null ? `, variance ${v > 0 ? '+' : ''}${v.toFixed(1)}L — ${tk.beyond_tolerance ? (v < 0 ? 'OVER tolerance (LOSS)' : 'OVER tolerance (gain)') : 'within limit'}` : ', awaiting a second dip') +
              `, last dip ${dip}`;
          }).join('\n')
        : 'No tank data',
      '',
      '--- Density Log (last 7 days, latest first) ---',
      'Normal bands at 15°C: petrol ~0.720–0.775 kg/L, diesel ~0.820–0.860 kg/L. Density outside the band or swinging between readings can indicate adulteration or a decant into the wrong tank.',
      densityRes.rows.length
        ? densityRes.rows.map(d => {
            const at = new Date(d.recorded_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `Tank ${d.tank_number} (${d.fuel_type}) ${d.reading_type}: ${parseFloat(d.density).toFixed(4)} kg/L${d.temperature_c != null ? ` @ ${parseFloat(d.temperature_c).toFixed(1)}°C` : ''} — ${at}`;
          }).join('\n')
        : 'No density readings in the last 7 days — remind the team to record density with the daily dip.',
      '',
      '--- Current Fuel Prices ---',
      Object.keys(priceMap).length
        ? Object.entries(priceMap).map(([ft, p]) => `${ft}: ₹${p}/L`).join(' | ')
        : 'No price data',
      '',
      '--- Held Suspense (running balances, to be cleared) ---',
      (creditSuspense != null || pettyFund != null)
        ? `Credit to invoice: ₹${Number(creditSuspense||0).toLocaleString('en-IN')} (credit booked by operators at shift close, not yet invoiced to customers — drawn down as credit invoices are raised). Petty cash on hand: ₹${Number(pettyFund||0).toLocaleString('en-IN')} (fund balance — topped up at shift close, cleared as expense vouchers are filed).`
        : 'No suspense data.',
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
        '',
        '--- Cash Awaiting Bank Deposit (OWNER ONLY) ---',
        depositStatus
          ? `₹${depositStatus.awaiting.toLocaleString('en-IN')} awaiting deposit${depositStatus.awaiting > 0.5 ? `, oldest ${depositStatus.age_days} day(s)${depositStatus.stale ? ' (OVERDUE — deposit and confirm in bank)' : ''}` : ' (all deposited)'}. Last deposit: ${depositStatus.last_deposit || 'never'}.`
          : 'No deposit data.',
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
