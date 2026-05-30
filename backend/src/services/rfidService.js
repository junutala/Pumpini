// src/services/rfidService.js
const net    = require('net');
const logger = require('../utils/logger');
const pool   = require('../db/pool');

let reconnectTimer = null;

async function startRfidListener(io) {
  // Skip in development — no hardware connected
  if (process.env.NODE_ENV !== 'production') {
    logger.info('RFID/FMC listener disabled in development mode');
    return;
  }

  const host = process.env.FMC_HOST || '127.0.0.1';
  const port = parseInt(process.env.FMC_PORT) || 9100;
  logger.info(`Starting RFID/FMC TCP listener on ${host}:${port}`);

  const connect = () => {
    const client = new net.Socket();
    let buffer = '';

    client.connect(port, host, () => {
      logger.info(`Connected to FMC at ${host}:${port}`);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    client.on('data', async (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line.trim());
          await handleFmcEvent(event, io);
        } catch (err) {
          logger.warn('RFID parse error:', err.message);
        }
      }
    });

    client.on('error', (err) => {
      logger.warn(`FMC connection error: ${err.message}`);
    });

    client.on('close', () => {
      logger.warn('FMC connection closed. Reconnecting in 5s...');
      reconnectTimer = setTimeout(connect, 5000);
    });
  };

  connect();
}

async function handleFmcEvent(event, io) {
  logger.info('RFID event:', event);
  try {
    const today = new Date().toISOString().slice(0,10);
    const { rows: shifts } = await pool.query(
      `SELECT s.id FROM shifts s WHERE s.station_id=$1 AND s.date=$2 AND s.status='open' LIMIT 1`,
      [event.station_id, today]
    );
    if (!shifts.length) return;

    const { rows: nozzles } = await pool.query(
      `SELECT id FROM nozzles WHERE station_id=$1 AND nozzle_number=$2 LIMIT 1`,
      [event.station_id, event.nozzle_number]
    );
    if (!nozzles.length) return;

    const { rows: prices } = await pool.query(
      `SELECT fp.price, n.fuel_type FROM nozzles n
       JOIN fuel_prices fp ON fp.station_id=$1 AND fp.fuel_type=n.fuel_type
       WHERE n.id=$2 ORDER BY fp.effective_from DESC LIMIT 1`,
      [event.station_id, nozzles[0].id]
    );
    if (!prices.length) return;

    const { rows: tags } = await pool.query(
      `SELECT rt.id, sa.attendant_id FROM rfid_tags rt
       LEFT JOIN shift_attendants sa ON sa.rfid_tag_id=rt.id AND sa.shift_id=$2
       WHERE rt.tag_uid=$1`, [event.rfid, shifts[0].id]
    );
    if (!tags.length) return;

    const { rows: dispense } = await pool.query(
      `INSERT INTO dispense_events(
         station_id, shift_id, rfid_tag_id, nozzle_id, attendant_id,
         fuel_type, quantity_ltrs, rate_per_ltr, payment_mode, occurred_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [event.station_id, shifts[0].id, tags[0].id, nozzles[0].id, tags[0].attendant_id,
       prices[0].fuel_type, event.litres, prices[0].price,
       event.payment_mode || 'cash',
       event.timestamp ? new Date(event.timestamp) : new Date()]
    );

    io.to(`station:${event.station_id}`).emit('dispense:new', dispense[0]);
  } catch (err) {
    logger.error('handleFmcEvent error:', err);
  }
}

module.exports = { startRfidListener, handleFmcEvent };
