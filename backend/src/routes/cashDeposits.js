// src/routes/cashDeposits.js — cash custody → bank deposit, with aging alert.
// Sales cash collected = Σ(cash_actual − opening float) over CONFIRMED shift
// reconciliations (the confirm is the operator→manager custody handover). A bank
// deposit draws the "awaiting deposit" balance down; the owner confirms it hit
// the bank. Cash sitting undeposited too long (the overnight/T+1 gap) → owner alert.
// This is the SALES-cash pool, separate from the petty-cash float.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const { sendAlert } = require('../services/alertService');

// Compute the live deposit status for a station.
async function computeDepositStatus(station_id) {
  const [coll, dep, setRows] = await Promise.all([
    pool.query(`
      SELECT COALESCE(SUM(r.cash_actual - COALESCE(sa.opening_cash,0)),0) AS collected
      FROM shift_reconciliation r
      JOIN shifts s ON s.id = r.shift_id
      LEFT JOIN shift_attendants sa ON sa.shift_id = r.shift_id AND sa.attendant_id = r.attendant_id
      WHERE s.station_id = $1 AND r.manager_confirmed = TRUE`, [station_id]),
    pool.query(`SELECT COALESCE(SUM(amount),0) AS deposited, MAX(deposit_date) AS last_deposit
                FROM cash_deposits WHERE station_id = $1`, [station_id]),
    pool.query(`SELECT deposit_alert_days, deposit_alert_amount FROM station_settings WHERE station_id = $1`, [station_id]),
  ]);

  const collected   = parseFloat(coll.rows[0].collected || 0);
  const deposited   = parseFloat(dep.rows[0].deposited || 0);
  const awaiting     = +(collected - deposited).toFixed(2);
  const lastDeposit  = dep.rows[0].last_deposit; // DATE or null
  const settings     = setRows.rows[0] || {};
  const alertDays    = parseInt(settings.deposit_alert_days ?? 2);
  const alertAmount  = parseFloat(settings.deposit_alert_amount ?? 0);

  // Oldest still-undeposited collection (proxy): earliest confirmed recon since
  // the last deposit. Its age is how long cash has been sitting.
  let oldestAt = null, ageDays = 0;
  if (awaiting > 0.5) {
    const { rows } = await pool.query(`
      SELECT MIN(r.confirmed_at) AS oldest
      FROM shift_reconciliation r
      JOIN shifts s ON s.id = r.shift_id
      WHERE s.station_id = $1 AND r.manager_confirmed = TRUE
        AND ($2::date IS NULL OR r.confirmed_at::date > $2::date)`,
      [station_id, lastDeposit]);
    oldestAt = rows[0].oldest;
    if (oldestAt) ageDays = Math.floor((Date.now() - new Date(oldestAt).getTime()) / 86400000);
  }

  const stale = awaiting > 0.5 && ageDays >= alertDays;
  const overAmount = alertAmount > 0 && awaiting > alertAmount;
  return { collected, deposited, awaiting, last_deposit: lastDeposit,
    oldest_undeposited_at: oldestAt, age_days: ageDays,
    alert_days: alertDays, alert_amount: alertAmount, stale, over_amount: overAmount };
}

// Fire an owner alert if undeposited cash is stale. Called from the shift-close
// hook. Low-noise: only alerts when cash has genuinely been sitting >= threshold.
async function checkDepositAging(station_id, io) {
  try {
    const st = await computeDepositStatus(station_id);
    if (st.stale) {
      await sendAlert({
        station_id,
        alert_type: 'cash_deposit_aging',
        severity: st.age_days >= st.alert_days * 2 ? 'critical' : 'warning',
        message: `₹${st.awaiting.toLocaleString('en-IN')} cash awaiting bank deposit for ${st.age_days} day(s). Deposit and confirm it in the bank.`,
        channels: ['whatsapp'],
        io,
      });
    }
    return st;
  } catch { return null; }
}

// GET /?station_id= — status + recent deposits
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const [status, deposits] = await Promise.all([
      computeDepositStatus(station_id),
      pool.query(`
        SELECT d.*, u.name AS deposited_by_name, c.name AS confirmed_by_name
        FROM cash_deposits d
        LEFT JOIN users u ON u.id = d.deposited_by
        LEFT JOIN users c ON c.id = d.confirmed_by
        WHERE d.station_id = $1 ORDER BY d.deposit_date DESC, d.created_at DESC LIMIT 100`, [station_id]),
    ]);
    res.json({ status, deposits: deposits.rows });
  } catch (err) { next(err); }
});

// POST / — record a bank deposit (owner/manager)
router.post('/', authenticate, authorize('owner', 'manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, amount, deposit_date, bank_account, reference_no, notes } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Deposit amount must be greater than 0' });
    const { rows } = await pool.query(
      `INSERT INTO cash_deposits(station_id, amount, deposit_date, bank_account, reference_no, notes, deposited_by)
       VALUES($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,
      [station_id, amt, deposit_date || null, bank_account || null, reference_no || null, notes || null, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /:id/confirm — owner confirms the deposit reflects in the bank
router.patch('/:id/confirm', authenticate, authorize('owner'),
  requireStationVia('SELECT station_id FROM cash_deposits WHERE id=$1', 'id'),
  async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cash_deposits SET confirmed=TRUE, confirmed_by=$2, confirmed_at=NOW()
       WHERE id=$1 RETURNING *`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Deposit not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.computeDepositStatus = computeDepositStatus;
module.exports.checkDepositAging = checkDepositAging;
