// src/routes/accounts.js — read surface for the optional Accounts module.
//
// Slice 2 exposes the journal and the trial balance (the engine's correctness proof).
// Writes come from the event sources in later slices, funnelled through
// services/accountingEngine. Every endpoint is gated by accounts.view AND no-ops when
// the outlet's Accounts switch is off, so the module stays fully bolt-on.
const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
const engine = require('../services/accountingEngine');
const shiftPosting = require('../services/accountsShiftPosting');
const expenseService = require('../services/expenseService');
const billScan = require('../services/billScan');
const { storageConfigured, uploadDocumentBase64 } = require('../services/vaweStorage');

// Is Accounts on for this outlet? Column-tolerant — a missing column (pre-Slice-1 DDL)
// or a false value both read as disabled, never a 500.
async function accountsEnabled(stationId) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(accounts_enabled, false) AS on
         FROM station_settings WHERE station_id = $1`, [stationId]);
    return rows.length ? rows[0].on === true : false;
  } catch { return false; }
}

// GET /api/accounts/journal?station_id=&from=&to=&limit=
router.get('/journal', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.view'), async (req, res, next) => {
    try {
      const { station_id, from, to, limit } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, entries: [] });
      const entries = await engine.listJournal(pool, station_id, { from, to, limit });
      res.json({ enabled: true, entries });
    } catch (err) { next(err); }
  });

// GET /api/accounts/trial-balance?station_id=&from=&to=
router.get('/trial-balance', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.view'), async (req, res, next) => {
    try {
      const { station_id, from, to } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, rows: [] });
      const tb = await engine.trialBalance(pool, station_id, { from, to });
      res.json({ enabled: true, ...tb });
    } catch (err) { next(err); }
  });

// POST /api/accounts/materialize { station_id, upto? }
// Pulls settled-but-unposted shifts + deliveries into the journal. On-demand, idempotent,
// touches no existing flow. accounts.manage gated; no-op refusal when the switch is off.
router.post('/materialize', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.manage'), async (req, res, next) => {
    try {
      const station_id = req.body.station_id || req.query.station_id;
      if (!(await accountsEnabled(station_id))) {
        return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });
      }
      const summary = await shiftPosting.materialize(pool, station_id, {
        upto: req.body.upto || undefined, created_by: req.user.id,
        reset: req.body.reset === true || req.body.reset === 'true',
      });
      res.json({ ok: true, ...summary });
    } catch (err) { next(err); }
  });

// ── Bill & Payment (expense capture) ───────────────────────────────────────
// Manager-reachable (accounts.expense). The reports/journal above stay owner/accountant.

// The expense heads for the form's dropdown (P&L expenses, minus COGS which is auto-fed).
async function expenseCategories() {
  const { rows } = await pool.query(
    `SELECT code, name FROM accounting_accounts
      WHERE acct_type='expense' AND statement='pnl' AND active AND code NOT LIKE 'cogs%'
      ORDER BY sort_order`);
  return rows;
}

// GET /api/accounts/expense-categories?station_id=
router.get('/expense-categories', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    try {
      if (!(await accountsEnabled(req.query.station_id))) return res.json({ enabled: false, categories: [] });
      res.json({ enabled: true, categories: await expenseCategories() });
    } catch (err) { next(err); }
  });

// POST /api/accounts/scan-bill { station_id, file_base64, media_type }
router.post('/scan-bill', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    try {
      const { station_id, file_base64, media_type } = req.body;
      if (!(await accountsEnabled(station_id))) return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });
      const [categories, vendors] = await Promise.all([
        expenseCategories(),
        pool.query(`SELECT name, default_category FROM accounting_vendors WHERE station_id=$1 ORDER BY created_at DESC LIMIT 80`, [station_id]).then(r => r.rows),
      ]);
      const parsed = await billScan.scanBill({ file_base64, media_type, categories, vendors });
      // If the scanned vendor is already known, prefer its learned head.
      const known = vendors.find(v => v.name && parsed.vendor && v.name.toLowerCase() === String(parsed.vendor).toLowerCase());
      if (known?.default_category) parsed.suggested_category = known.default_category;
      res.json(parsed);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });

// POST /api/accounts/expenses — save a captured bill (scan or manual)
router.post('/expenses', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    const b = req.body;
    if (!(await accountsEnabled(b.station_id))) return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });

    // Stash the bill image in the private doc bucket (best-effort; a missing bucket
    // must not block recording the expense).
    let document_path = null;
    if (b.file_base64 && b.media_type && storageConfigured()) {
      try {
        document_path = await uploadDocumentBase64({
          prefix: 'expense-bills', scope: b.station_id, base64: b.file_base64,
          contentType: b.media_type, filename: b.media_type === 'application/pdf' ? 'bill.pdf' : 'bill.jpg',
        });
      } catch { /* keep going without the image */ }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const expense = await expenseService.createExpense(client, {
        station_id: b.station_id, vendor_name: b.vendor_name, vendor_type: b.vendor_type, gstn: b.gstn,
        category: b.category, amount: b.amount, gst_amount: b.gst_amount, expense_date: b.expense_date,
        invoice_number: b.invoice_number, description: b.description,
        is_asset: b.is_asset === true || b.is_asset === 'true',
        asset_life_years: b.asset_life_years, paid: b.paid === true || b.paid === 'true',
        payment_mode: b.payment_mode, document_path,
        ai_suggested_category: b.ai_suggested_category, ai_confidence: b.ai_confidence,
        created_by: req.user.id,
      });
      await client.query('COMMIT');
      res.status(201).json(expense);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      res.status(400).json({ error: e.message || 'Could not save the bill' });
    } finally { client.release(); }
  });

// GET /api/accounts/expenses?station_id=&limit=
router.get('/expenses', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    try {
      const { station_id } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, expenses: [] });
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows } = await pool.query(
        `SELECT e.*, v.name AS vendor_name, a.name AS category_name
           FROM expenses e
           LEFT JOIN accounting_vendors v ON v.id = e.vendor_id
           LEFT JOIN accounting_accounts a ON a.code = e.category
          WHERE e.station_id = $1
          ORDER BY e.expense_date DESC, e.created_at DESC
          LIMIT $2`, [station_id, limit]);
      res.json({ enabled: true, expenses: rows });
    } catch (err) { next(err); }
  });

module.exports = router;
