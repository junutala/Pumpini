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
const { requireStationAccess, requireCorporateAccess, getAccessibleStationIds } = require('../middleware/stationAccess');

const AGE_BUCKETS = [30, 60, 90]; // 0-30 / 31-60 / 61-90 / 90+

// GET /api/credit-reports/ageing?station_id=
// One row per credit customer linked to the station. Payments are allocated
// FIFO against the oldest charges; whatever stays open is bucketed by age.
router.get('/ageing', authenticate, authorize('owner', 'manager'),
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
          SELECT de.corporate_id, de.occurred_at::date AS day, de.amount
          FROM dispense_events de
          WHERE de.station_id = $1 AND de.payment_mode = 'credit'
            AND de.corporate_id IS NOT NULL AND NOT COALESCE(de.is_voided, FALSE)
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

    const today = new Date();
    const rows = customers.rows.map(c => {
      let remaining = parseFloat(creditsByCorp[c.id]?.paid || 0);
      const buckets = [0, 0, 0, 0];
      let oldestDays = null;
      for (const ch of chargesByCorp[c.id] || []) {
        let open = parseFloat(ch.amount);
        if (remaining > 0) {
          const applied = Math.min(remaining, open);
          remaining -= applied;
          open -= applied;
        }
        if (open <= 0.005) continue;
        const days = Math.floor((today - new Date(ch.day)) / 86400e3);
        if (oldestDays == null) oldestDays = days; // charges arrive oldest-first
        const i = days <= AGE_BUCKETS[0] ? 0 : days <= AGE_BUCKETS[1] ? 1 : days <= AGE_BUCKETS[2] ? 2 : 3;
        buckets[i] += open;
      }
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
        unapplied_credit: remaining > 0.005 ? +remaining.toFixed(2) : 0, // advance / over-payment
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
// before the range, then every debit/credit in order.
router.get('/statement/:id', authenticate, authorize('owner', 'manager'),
  requireCorporateAccess(), requireStationAccess(), async (req, res, next) => {
  try {
    const corporateId = req.params.id;
    const { station_id } = req.query;
    const dateTo   = req.query.date_to   || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dateFrom = req.query.date_from ||
      new Date(new Date().setDate(1)).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // A shared customer can be linked to stations of DIFFERENT owners; without
    // a station scope, never reach past the caller's own stations.
    const stationIds = station_id ? [station_id] : await getAccessibleStationIds(req.user.id);
    if (!stationIds.length) return res.json({ corporate: null, lines: [], opening_balance: 0, closing_balance: 0, totals: { debits: 0, credits: 0 } });
    const stationCond = (alias) => ` AND ${alias}.station_id = ANY($2::uuid[])`;
    const p = [corporateId, stationIds];

    // All four ledger sources in one pass; the date split happens in JS so the
    // opening balance and the in-range lines always agree.
    const { rows: all } = await pool.query(`
      SELECT * FROM (
        SELECT de.occurred_at AS at, 'fuel' AS type,
               de.fuel_type || ' · ' || TO_CHAR(de.quantity_ltrs, 'FM999990.00') || ' L' ||
                 COALESCE(' · ' || NULLIF(de.vehicle_number, ''), '') AS description,
               NULL::varchar AS ref, de.amount AS debit, 0 AS credit
        FROM dispense_events de
        WHERE de.corporate_id = $1 AND de.payment_mode = 'credit'
          AND NOT COALESCE(de.is_voided, FALSE) ${stationCond('de')}
        UNION ALL
        SELECT pi.created_at, 'lube', 'Invoice', pi.invoice_number, pi.grand_total, 0
        FROM product_invoices pi
        WHERE pi.customer_type = 'credit' AND pi.customer_id = $1 ${stationCond('pi')}
        UNION ALL
        SELECT cr.receipt_date, 'payment', 'Payment (' || COALESCE(cr.payment_type, '—') || ')',
               cr.reference_no, 0, cr.amount
        FROM corporate_receipts cr
        WHERE cr.corporate_id = $1 ${stationCond('cr')}
        UNION ALL
        SELECT cn.created_at, 'credit_note', 'Credit note', cn.cn_number, 0, cn.grand_total
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
      lines.push({ date: r.at, type: r.type, description: r.description, ref: r.ref, debit, credit, balance });
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

module.exports = router;
