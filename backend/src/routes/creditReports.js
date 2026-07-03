// src/routes/creditReports.js
//
// Credit-book reports: receivables ageing and per-customer statements.
// Ledger primitives (same four sources as the customer's consolidated view):
//   debits  = credit fuel dispenses + credit lube/shop invoices
//   credits = payments received + product credit notes
// Outstanding is always recomputed from these — never read from the
// maintained counters — so the report stays honest even if a counter drifts.
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess, requireCorporateAccess, getAccessibleStationIds, canAccessCorporate } = require('../middleware/stationAccess');

const AGE_BUCKETS = [30, 60, 90]; // 0-30 / 31-60 / 61-90 / 90+

// FIFO ageing: payments eat the oldest charges first; what stays open is
// bucketed by age. charges = [{ day, amount }] oldest-first.
function fifoBuckets(charges, paid) {
  let remaining = paid;
  const buckets = [0, 0, 0, 0];
  let oldestDays = null;
  const today = new Date();
  for (const ch of charges) {
    let open = parseFloat(ch.amount);
    if (remaining > 0) {
      const applied = Math.min(remaining, open);
      remaining -= applied;
      open -= applied;
    }
    if (open <= 0.005) continue;
    const days = Math.floor((today - new Date(ch.day)) / 86400e3);
    if (oldestDays == null) oldestDays = days;
    const i = days <= AGE_BUCKETS[0] ? 0 : days <= AGE_BUCKETS[1] ? 1 : days <= AGE_BUCKETS[2] ? 2 : 3;
    buckets[i] += open;
  }
  return { buckets, oldestDays, unapplied: remaining > 0.005 ? +remaining.toFixed(2) : 0 };
}

// Staff (owner/manager) pass through; a credit customer may only reach their
// own account (req.params.id). requireCorporateAccess after this re-validates.
function selfOrStaff(req, res, next) {
  if (['owner', 'manager'].includes(req.user.role)) return next();
  if (req.user.role === 'corporate' && req.user.corporate_id &&
      req.user.corporate_id === req.params.id) return next();
  return res.status(403).json({ error: 'Not allowed.' });
}

// Stations a credit customer's account is linked to — their statement scope.
async function corporateStationIds(corporateId) {
  const { rows } = await pool.query(`
    SELECT station_id FROM corporate_station_links WHERE corporate_id = $1
    UNION
    SELECT created_by_station FROM corporate_accounts
    WHERE id = $1 AND created_by_station IS NOT NULL`, [corporateId]);
  return rows.map(r => r.station_id);
}

// Resolve which corporate a portal endpoint is about: customers get their own
// account; staff pass ?corporate_id= and must have station access to it.
async function resolvePortalCorporate(req, res) {
  if (req.user.role === 'corporate') {
    if (req.user.corporate_id) return req.user.corporate_id;
    res.status(403).json({ error: 'No credit account linked to your login.' });
    return null;
  }
  const corporateId = req.query.corporate_id;
  if (!corporateId || !['owner', 'manager'].includes(req.user.role) ||
      !(await canAccessCorporate(req.user.id, corporateId))) {
    res.status(403).json({ error: 'Not allowed.' });
    return null;
  }
  return corporateId;
}

// GET /api/credit-reports/ageing?station_id=
// One row per credit customer linked to the station. Payments are allocated
// FIFO against the oldest charges; whatever stays open is bucketed by age.
router.get('/ageing', authenticate, authorize('owner', 'manager', 'cco'),
  requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;

    const [customers, charges, credits] = await Promise.all([
      pool.query(`
        SELECT ca.id, ca.company_name, ca.contact_person, ca.contact_phone,
               csl.credit_limit, csl.payment_terms
        FROM corporate_accounts ca
        JOIN corporate_station_links csl ON csl.corporate_id = ca.id
        WHERE csl.station_id = $1 AND ca.merged_into_id IS NULL AND ca.is_active = TRUE
        ORDER BY ca.company_name`, [station_id]),

      // Day-level charge totals per customer, oldest first (FIFO order)
      pool.query(`
        SELECT corporate_id, day, SUM(amount) AS amount FROM (
          -- Fuel-credit charges = the credit invoices raised (credit isn't tagged
          -- to a customer at the pump in the control-total model).
          SELECT gi.corporate_id, gi.invoice_date AS day, gi.total_amount AS amount
          FROM gst_invoices gi
          WHERE gi.station_id = $1 AND gi.corporate_id IS NOT NULL
          UNION ALL
          SELECT pi.customer_id, pi.created_at::date, pi.grand_total
          FROM product_invoices pi
          WHERE pi.station_id = $1 AND pi.customer_type = 'credit' AND pi.customer_id IS NOT NULL
        ) x GROUP BY corporate_id, day ORDER BY day`, [station_id]),

      pool.query(`
        SELECT corporate_id, SUM(amount) AS paid, MAX(last_at) AS last_payment_at FROM (
          SELECT cr.corporate_id, cr.amount, cr.receipt_date AS last_at
          FROM corporate_receipts cr WHERE cr.station_id = $1
          UNION ALL
          SELECT cn.customer_id, cn.grand_total, NULL
          FROM product_credit_notes cn
          WHERE cn.station_id = $1 AND cn.customer_type = 'credit' AND cn.customer_id IS NOT NULL
        ) x GROUP BY corporate_id`, [station_id]),
    ]);

    const chargesByCorp = {};
    charges.rows.forEach(r => {
      (chargesByCorp[r.corporate_id] = chargesByCorp[r.corporate_id] || []).push(r);
    });
    const creditsByCorp = {};
    credits.rows.forEach(r => { creditsByCorp[r.corporate_id] = r; });

    const rows = customers.rows.map(c => {
      const { buckets, oldestDays, unapplied } =
        fifoBuckets(chargesByCorp[c.id] || [], parseFloat(creditsByCorp[c.id]?.paid || 0));
      const outstanding = +buckets.reduce((s, b) => s + b, 0).toFixed(2);
      const limit = parseFloat(c.credit_limit || 0);
      return {
        corporate_id:   c.id,
        company_name:   c.company_name,
        contact_person: c.contact_person,
        contact_phone:  c.contact_phone,
        credit_limit:   limit,
        payment_terms:  c.payment_terms,
        outstanding,
        b0_30:    +buckets[0].toFixed(2),
        b31_60:   +buckets[1].toFixed(2),
        b61_90:   +buckets[2].toFixed(2),
        b90_plus: +buckets[3].toFixed(2),
        oldest_days: oldestDays,
        over_limit:  limit > 0 && outstanding > limit,
        unapplied_credit: unapplied, // advance / over-payment
        last_payment_at: creditsByCorp[c.id]?.last_payment_at || null,
      };
    });

    const withDues = rows.filter(r => r.outstanding > 0);
    res.json({
      rows,
      totals: {
        outstanding: +withDues.reduce((s, r) => s + r.outstanding, 0).toFixed(2),
        b0_30:    +withDues.reduce((s, r) => s + r.b0_30, 0).toFixed(2),
        b31_60:   +withDues.reduce((s, r) => s + r.b31_60, 0).toFixed(2),
        b61_90:   +withDues.reduce((s, r) => s + r.b61_90, 0).toFixed(2),
        b90_plus: +withDues.reduce((s, r) => s + r.b90_plus, 0).toFixed(2),
        customers_with_dues: withDues.length,
        over_limit_count: rows.filter(r => r.over_limit).length,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/credit-reports/statement/:id?station_id=&date_from=&date_to=
// Full running-balance ledger for one customer: opening balance carried from
// before the range, then every debit/credit in order. Staff see customers of
// their stations; a credit customer sees their OWN statement (self-service).
router.get('/statement/:id', authenticate, selfOrStaff,
  requireCorporateAccess(), requireStationAccess(), async (req, res, next) => {
  try {
    const corporateId = req.params.id;
    const { station_id } = req.query;
    const dateTo   = req.query.date_to   || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dateFrom = req.query.date_from ||
      new Date(new Date().setDate(1)).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // A shared customer can be linked to stations of DIFFERENT owners; without
    // a station scope, staff never reach past their own stations. The customer
    // themselves sees every station their account is linked to.
    const stationIds = station_id ? [station_id]
      : req.user.role === 'corporate' ? await corporateStationIds(corporateId)
      : await getAccessibleStationIds(req.user.id);
    if (!stationIds.length) return res.json({ corporate: null, lines: [], opening_balance: 0, closing_balance: 0, totals: { debits: 0, credits: 0 } });
    const stationCond = (alias) => ` AND ${alias}.station_id = ANY($2::uuid[])`;
    const p = [corporateId, stationIds];

    // All four ledger sources in one pass; the date split happens in JS so the
    // opening balance and the in-range lines always agree.
    const { rows: all } = await pool.query(`
      SELECT * FROM (
        SELECT gi.invoice_date::timestamptz AS at, 'invoice' AS type,
               'Credit invoice' AS description,
               gi.invoice_number AS ref, gi.total_amount AS debit, 0 AS credit,
               (SELECT name FROM stations WHERE id = gi.station_id) AS station_name
        FROM gst_invoices gi
        WHERE gi.corporate_id = $1 ${stationCond('gi')}
        UNION ALL
        SELECT pi.created_at, 'lube', 'Invoice', pi.invoice_number, pi.grand_total, 0,
               (SELECT name FROM stations WHERE id = pi.station_id)
        FROM product_invoices pi
        WHERE pi.customer_type = 'credit' AND pi.customer_id = $1 ${stationCond('pi')}
        UNION ALL
        SELECT cr.receipt_date, 'payment', 'Payment (' || COALESCE(cr.payment_type, '—') || ')',
               cr.reference_no, 0, cr.amount,
               (SELECT name FROM stations WHERE id = cr.station_id)
        FROM corporate_receipts cr
        WHERE cr.corporate_id = $1 ${stationCond('cr')}
        UNION ALL
        SELECT cn.created_at, 'credit_note', 'Credit note', cn.cn_number, 0, cn.grand_total,
               (SELECT name FROM stations WHERE id = cn.station_id)
        FROM product_credit_notes cn
        WHERE cn.customer_type = 'credit' AND cn.customer_id = $1 ${stationCond('cn')}
      ) x ORDER BY at`, p);

    const from = new Date(dateFrom + 'T00:00:00+05:30');
    const to   = new Date(dateTo   + 'T23:59:59+05:30');

    let opening = 0;
    const lines = [];
    let balance = 0;
    for (const r of all) {
      const at = new Date(r.at);
      const debit = parseFloat(r.debit || 0), credit = parseFloat(r.credit || 0);
      if (at < from) { opening += debit - credit; continue; }
      if (at > to) break;
      if (lines.length === 0) balance = opening;
      balance = +(balance + debit - credit).toFixed(2);
      lines.push({ date: r.at, type: r.type, description: r.description, ref: r.ref,
                   station_name: r.station_name, debit, credit, balance });
    }
    opening = +opening.toFixed(2);
    const closing = lines.length ? lines[lines.length - 1].balance : opening;

    const { rows: corp } = await pool.query(
      `SELECT id, company_name, contact_person, contact_phone, email, gst_number, gstn, address
       FROM corporate_accounts WHERE id = $1`, [corporateId]);

    res.json({
      corporate: corp[0] || null,
      date_from: dateFrom,
      date_to:   dateTo,
      opening_balance: opening,
      closing_balance: closing,
      totals: {
        debits:  +lines.reduce((s, l) => s + l.debit, 0).toFixed(2),
        credits: +lines.reduce((s, l) => s + l.credit, 0).toFixed(2),
      },
      lines,
    });
  } catch (err) { next(err); }
});

// GET /api/credit-reports/my-ageing[?corporate_id=]
// The customer's own dues by age, one row per linked station. Customers reach
// their own account; staff may pass corporate_id (owner "view as" in portal).
router.get('/my-ageing', authenticate, async (req, res, next) => {
  try {
    const corporateId = await resolvePortalCorporate(req, res);
    if (!corporateId) return;
    const stationIds = await corporateStationIds(corporateId);
    if (!stationIds.length) return res.json({ rows: [], totals: { outstanding: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 } });

    const [charges, credits, stations] = await Promise.all([
      pool.query(`
        SELECT station_id, day, SUM(amount) AS amount FROM (
          SELECT gi.station_id, gi.invoice_date AS day, gi.total_amount AS amount
          FROM gst_invoices gi
          WHERE gi.corporate_id = $1 AND gi.station_id = ANY($2::uuid[])
          UNION ALL
          SELECT pi.station_id, pi.created_at::date, pi.grand_total
          FROM product_invoices pi
          WHERE pi.customer_type = 'credit' AND pi.customer_id = $1 AND pi.station_id = ANY($2::uuid[])
        ) x GROUP BY station_id, day ORDER BY day`, [corporateId, stationIds]),
      pool.query(`
        SELECT station_id, SUM(amount) AS paid FROM (
          SELECT cr.station_id, cr.amount FROM corporate_receipts cr
          WHERE cr.corporate_id = $1 AND cr.station_id = ANY($2::uuid[])
          UNION ALL
          SELECT cn.station_id, cn.grand_total FROM product_credit_notes cn
          WHERE cn.customer_type = 'credit' AND cn.customer_id = $1 AND cn.station_id = ANY($2::uuid[])
        ) x GROUP BY station_id`, [corporateId, stationIds]),
      pool.query('SELECT id, name FROM stations WHERE id = ANY($1::uuid[])', [stationIds]),
    ]);

    const chargesByStation = {};
    charges.rows.forEach(r => {
      (chargesByStation[r.station_id] = chargesByStation[r.station_id] || []).push(r);
    });
    const paidByStation = {};
    credits.rows.forEach(r => { paidByStation[r.station_id] = parseFloat(r.paid || 0); });

    const rows = stations.rows.map(s => {
      const { buckets, oldestDays, unapplied } =
        fifoBuckets(chargesByStation[s.id] || [], paidByStation[s.id] || 0);
      return {
        station_id: s.id,
        station_name: s.name,
        outstanding: +buckets.reduce((a, b) => a + b, 0).toFixed(2),
        b0_30: +buckets[0].toFixed(2),
        b31_60: +buckets[1].toFixed(2),
        b61_90: +buckets[2].toFixed(2),
        b90_plus: +buckets[3].toFixed(2),
        oldest_days: oldestDays,
        unapplied_credit: unapplied,
      };
    }).filter(r => r.outstanding > 0 || r.unapplied_credit > 0 || (chargesByStation[r.station_id] || []).length);

    res.json({
      rows,
      totals: {
        outstanding: +rows.reduce((s, r) => s + r.outstanding, 0).toFixed(2),
        b0_30:    +rows.reduce((s, r) => s + r.b0_30, 0).toFixed(2),
        b31_60:   +rows.reduce((s, r) => s + r.b31_60, 0).toFixed(2),
        b61_90:   +rows.reduce((s, r) => s + r.b61_90, 0).toFixed(2),
        b90_plus: +rows.reduce((s, r) => s + r.b90_plus, 0).toFixed(2),
      },
    });
  } catch (err) { next(err); }
});

// GET /api/credit-reports/my-invoices[?corporate_id=]
// Invoice copies for the portal: periodic fuel GST invoices (line items are
// stored on the invoice) and lube/shop invoices with their items.
router.get('/my-invoices', authenticate, async (req, res, next) => {
  try {
    const corporateId = await resolvePortalCorporate(req, res);
    if (!corporateId) return;

    const [fuel, lube] = await Promise.all([
      pool.query(`
        SELECT gi.*, s.name AS station_name
        FROM gst_invoices gi
        LEFT JOIN stations s ON s.id = gi.station_id
        WHERE gi.corporate_id = $1
        ORDER BY gi.created_at DESC LIMIT 100`, [corporateId]),
      pool.query(`
        SELECT pi.*, s.name AS station_name,
          COALESCE(json_agg(json_build_object(
            'name', pii.product_name, 'qty', pii.quantity, 'unit', pii.unit,
            'unit_price', pii.unit_price, 'gst_rate', pii.gst_rate,
            'total', pii.total_amount
          ) ORDER BY pii.id) FILTER (WHERE pii.id IS NOT NULL), '[]') AS items
        FROM product_invoices pi
        LEFT JOIN product_invoice_items pii ON pii.invoice_id = pi.id
        LEFT JOIN stations s ON s.id = pi.station_id
        WHERE pi.customer_type = 'credit' AND pi.customer_id = $1
        GROUP BY pi.id, s.name
        ORDER BY pi.created_at DESC LIMIT 100`, [corporateId]),
    ]);

    res.json({ fuel: fuel.rows, lube: lube.rows });
  } catch (err) { next(err); }
});

module.exports = router;
