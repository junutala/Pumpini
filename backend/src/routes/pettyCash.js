// src/routes/pettyCash.js — manager's cash float / imprest ledger.
// Cash movements that are NOT part of the attendant blind-drop live here so the
// float is auditable: manual top-ups, petty expenses, and (auto) credit-note
// CASH refunds. Station-scoped; owner/manager write. Balance = Σin − Σout.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
const { requireStationAccess } = require('../middleware/stationAccess');

// Insert a ledger row. Exported so other routes (credit notes) can write inside
// their own transaction. direction: 'in' (float up) | 'out' (float down).
async function addEntry(client, { station_id, direction, amount, entry_type, description, reference_type, reference_id, created_by }) {
  const { rows } = await client.query(
    `INSERT INTO petty_cash_entries
       (station_id, direction, amount, entry_type, description, reference_type, reference_id, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [station_id, direction, Number(amount).toFixed(2), entry_type,
     description || null, reference_type || null, reference_id || null, created_by || null]
  );
  return rows[0];
}

// GET /?station_id= — ledger (latest 200) + current balance
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const [entries, bal] = await Promise.all([
      pool.query(`
        SELECT e.*, u.name AS created_by_name
        FROM petty_cash_entries e
        LEFT JOIN users u ON u.id = e.created_by
        WHERE e.station_id=$1 ORDER BY e.created_at DESC LIMIT 200`, [station_id]),
      pool.query(`
        SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS balance
        FROM petty_cash_entries WHERE station_id=$1`, [station_id]),
    ]);
    res.json({ balance: parseFloat(bal.rows[0].balance), entries: entries.rows });
  } catch (err) { next(err); }
});

// POST / — manual entry (top-up or expense). owner/manager only.
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('pettycash.manage'), async (req, res, next) => {
  const { station_id, direction, amount, entry_type, description } = req.body;
  const amt = parseFloat(amount);
  if (!['in', 'out'].includes(direction)) return res.status(400).json({ error: 'direction must be "in" or "out"' });
  if (!amt || amt <= 0)                    return res.status(400).json({ error: 'Amount must be greater than 0' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await addEntry(client, {
      station_id, direction, amount: amt,
      entry_type: entry_type || (direction === 'in' ? 'topup' : 'expense'),
      description, created_by: req.user.id,
    });
    await client.query('COMMIT');
    res.status(201).json(row);
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

module.exports = router;
module.exports.addEntry = addEntry;
