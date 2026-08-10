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

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// Which ledger account a cash/bank choice maps to.
const acctFor = (x) => (x === 'bank' ? 'bank' : 'cash_in_hand');
const paidFromFor = (mode) => (mode === 'upi' ? 'upi_clearing' : 'bank');

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

// ── Owner Money (Slice 5) ──────────────────────────────────────────────────
// Manager-recorded, in/out. IN = owner funds (capital or repayable loan) or other income
// (scrap); OUT = owner drawings. Posts straight through the engine — the journal is the
// record, no separate table. accounts.expense-gated.

// POST /api/accounts/owner-money { station_id, direction:'in'|'out', kind, amount, account:'cash'|'bank', date, description }
router.post('/owner-money', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    const b = req.body;
    if (!(await accountsEnabled(b.station_id))) return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });
    const amount = Number(b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount' });
    const date = b.date || todayIST();
    const acct = acctFor(b.account);

    let type, accounts = {}, narration;
    if (b.direction === 'out') {
      type = 'owner_drawings'; accounts.paid_from = acct;
      narration = 'Owner drawings' + (b.description ? ' — ' + b.description : '');
    } else {
      if (b.kind === 'loan')        { type = 'owner_funding_loan';    narration = 'Owner loan'; }
      else if (b.kind === 'income') { type = 'other_income';          narration = 'Other income' + (b.description ? ' — ' + b.description : ''); }
      else                          { type = 'owner_funding_capital'; narration = 'Owner capital'; }
      accounts.received_in = acct;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { journal } = await engine.postEvent(client, {
        station_id: b.station_id, type, date, amount, accounts,
        source: 'owner_money', narration, created_by: req.user.id,
      });
      await client.query('COMMIT');
      res.status(201).json({ ok: true, journal });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      res.status(400).json({ error: e.message || 'Could not save' });
    } finally { client.release(); }
  });

// GET /api/accounts/owner-money?station_id=
router.get('/owner-money', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    try {
      const { station_id } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, entries: [] });
      const { rows } = await pool.query(
        `SELECT * FROM accounting_journal
          WHERE station_id=$1 AND event_type IN
            ('owner_drawings','owner_funding_capital','owner_funding_loan','other_income')
          ORDER BY entry_date DESC, created_at DESC LIMIT 50`, [station_id]);
      res.json({ enabled: true, entries: rows });
    } catch (err) { next(err); }
  });

// ── Payables (Slice 6) ─────────────────────────────────────────────────────
// Outstanding balances + the list of unpaid bills; pay an itemised bill, or record a
// payment against a payable account (trade creditors / CNG-to-IOCL).

async function payableBalance(stationId, code) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS bal
       FROM accounting_journal_lines WHERE station_id=$1 AND account_code=$2`, [stationId, code]);
  return Number(rows[0].bal);
}

// GET /api/accounts/payables?station_id=
router.get('/payables', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    try {
      const { station_id } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false });
      const [trade, cng, unpaid] = await Promise.all([
        payableBalance(station_id, 'creditors'),
        payableBalance(station_id, 'cng_payable'),
        pool.query(
          `SELECT e.*, v.name AS vendor_name, a.name AS category_name
             FROM expenses e
             LEFT JOIN accounting_vendors v ON v.id = e.vendor_id
             LEFT JOIN accounting_accounts a ON a.code = e.category
            WHERE e.station_id=$1 AND e.payment_status='unpaid'
            ORDER BY e.expense_date LIMIT 100`, [station_id]).then(r => r.rows),
      ]);
      res.json({ enabled: true, trade_payables: trade, cng_payable: cng, unpaid_expenses: unpaid });
    } catch (err) { next(err); }
  });

// POST /api/accounts/expenses/:id/pay { station_id, payment_mode, date }
router.post('/expenses/:id/pay', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    const { station_id, payment_mode } = req.body;
    if (!(await accountsEnabled(station_id))) return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });
    const { rows: ex } = await pool.query(`SELECT * FROM expenses WHERE id=$1 AND station_id=$2`, [req.params.id, station_id]);
    if (!ex.length) return res.status(404).json({ error: 'Bill not found' });
    const e = ex[0];
    if (e.payment_status === 'paid') return res.json({ ok: true, already: true });
    const mode = ['bank', 'upi', 'cheque'].includes(payment_mode) ? payment_mode : 'bank';
    const paidFrom = paidFromFor(mode);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await engine.postEvent(client, {
        station_id, type: 'supplier_payment', date: req.body.date || todayIST(), amount: Number(e.amount),
        accounts: { paid_from: paidFrom }, source: 'bill_payment', source_ref: 'pay_' + e.id,
        narration: 'Paid bill', created_by: req.user.id, party: { type: 'supplier', id: e.vendor_id },
      });
      await client.query(`UPDATE expenses SET payment_status='paid', payment_mode=$2, paid_from=$3 WHERE id=$1`,
        [e.id, mode, paidFrom]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err2) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      res.status(400).json({ error: err2.message || 'Could not record payment' });
    } finally { client.release(); }
  });

// POST /api/accounts/pay-supplier { station_id, target:'creditors'|'cng_payable', amount, payment_mode, date, description }
router.post('/pay-supplier', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    const b = req.body;
    if (!(await accountsEnabled(b.station_id))) return res.status(400).json({ error: 'Accounts is not enabled for this outlet' });
    const amount = Number(b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount' });
    const mode = ['bank', 'upi', 'cheque'].includes(b.payment_mode) ? b.payment_mode : 'bank';
    const type = b.target === 'cng_payable' ? 'cng_payment' : 'supplier_payment';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await engine.postEvent(client, {
        station_id: b.station_id, type, date: b.date || todayIST(), amount,
        accounts: { paid_from: paidFromFor(mode) }, source: 'supplier_payment',
        narration: (b.target === 'cng_payable' ? 'Paid IOCL (CNG)' : 'Paid supplier') + (b.description ? ' — ' + b.description : ''),
        created_by: req.user.id,
      });
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      res.status(400).json({ error: e.message || 'Could not record payment' });
    } finally { client.release(); }
  });

// GET /api/accounts/fuel-purchases?station_id= — the HSD/MS delivery invoices behind the
// Trade Payables balance, each with its prepaid/credit status (column-tolerant on `paid`).
router.get('/fuel-purchases', authenticate, requireStationAccess({ required: true }),
  requirePerm('accounts.expense'), async (req, res, next) => {
    try {
      const { station_id } = req.query;
      if (!(await accountsEnabled(station_id))) return res.json({ enabled: false, purchases: [] });
      let hasPaid = false;
      try {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='fuel_deliveries' AND column_name='paid' LIMIT 1`);
        hasPaid = rows.length > 0;
      } catch { hasPaid = false; }
      // One line per INVOICE, not per compartment: a single tanker invoice carries
      // petrol + diesel as separate rows sharing invoice_id (or the DC number). Group
      // them so the manager sees — and toggles — one payment status for the document.
      const paidCounts = hasPaid
        ? `count(*) FILTER (WHERE fd.paid IS TRUE)  AS n_paid,
           count(*) FILTER (WHERE fd.paid IS FALSE) AS n_credit`
        : `0 AS n_paid, 0 AS n_credit`;
      const { rows } = await pool.query(
        `SELECT COALESCE(fd.invoice_id::text, NULLIF(fd.dc_number,''), fd.id::text) AS invoice_key,
                MIN(COALESCE(fd.dc_date, fd.received_at::date)) AS date,
                MAX(fd.oil_company) AS oil_company,
                MAX(fd.dc_number)   AS dc_number,
                string_agg(DISTINCT fd.fuel_type, ', ' ORDER BY fd.fuel_type) AS fuels,
                SUM(fd.gross_volume_ltrs) AS ltrs,
                SUM(COALESCE(fd.total_value, fd.rate_per_ltr*fd.gross_volume_ltrs, 0) + COALESCE(fd.freight, 0)) AS value,
                array_agg(fd.id) AS ids,
                count(*) AS n, ${paidCounts}
           FROM fuel_deliveries fd
          WHERE fd.station_id = $1
          GROUP BY invoice_key
          ORDER BY MIN(COALESCE(fd.dc_date, fd.received_at::date)) DESC
          LIMIT 40`, [station_id]);
      const purchases = rows.map(r => ({
        ...r,
        status: Number(r.n_paid) === Number(r.n) ? 'prepaid'
              : Number(r.n_credit) === Number(r.n) ? 'credit'
              : (Number(r.n_paid) === 0 && Number(r.n_credit) === 0) ? 'unknown' : 'mixed',
      }));
      res.json({ enabled: true, purchases });
    } catch (err) { next(err); }
  });

module.exports = router;
