// src/routes/tally.js — Tally Prime XML export.
// Maps each Pumpini financial touchpoint to the owner's Tally LEDGER NAME, then
// generates a day's balanced double-entry vouchers (Sales / Receipt / Contra)
// in Tally Prime's import XML. Per station / per GSTIN (≈ one Tally company per
// bunk). REMOTEID makes re-import idempotent (updates, never duplicates).
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');

// Every financial touchpoint, in plain English. `group` drives the UI sections;
// `inExport` marks which currently feed the generated vouchers.
const TOUCHPOINTS = [
  // Sales (credited in the daily Sales voucher)
  { key: 'petrol_sales',  label: 'Petrol Sales',                 group: 'Sales (income)',     desc: 'Total petrol sold (all payment modes).',           inExport: true },
  { key: 'diesel_sales',  label: 'Diesel Sales',                 group: 'Sales (income)',     desc: 'Total diesel sold (all payment modes).',           inExport: true },
  { key: 'premium_sales', label: 'Premium Petrol Sales',         group: 'Sales (income)',     desc: 'Premium/branded petrol sold.',                     inExport: true },
  { key: 'cng_sales',     label: 'CNG Sales',                    group: 'Sales (income)',     desc: 'CNG sold.',                                        inExport: true },
  { key: 'lube_sales',    label: 'Lubricant / Product Sales',    group: 'Sales (income)',     desc: 'Taxable value of lube/shop products (excl. GST).', inExport: true },
  // Output tax
  { key: 'output_cgst',   label: 'Output CGST',                  group: 'GST',                desc: 'CGST collected on lube/product sales.',            inExport: true },
  { key: 'output_sgst',   label: 'Output SGST',                  group: 'GST',                desc: 'SGST collected on lube/product sales.',            inExport: true },
  // Collections / assets (debited)
  { key: 'cash_in_hand',  label: 'Cash in Hand',                 group: 'Collections',        desc: 'Cash collected (fuel + lube).',                    inExport: true },
  { key: 'upi_bank',      label: 'UPI Collections (Bank)',       group: 'Collections',        desc: 'UPI collected, settled to bank.',                  inExport: true },
  { key: 'card_bank',     label: 'Card Collections (Bank)',      group: 'Collections',        desc: 'Card collected, settled to bank.',                 inExport: true },
  { key: 'debtors',       label: 'Sundry Debtors (credit cust.)',group: 'Collections',        desc: 'Credit sales — receivable from credit customers.', inExport: true },
  { key: 'bank',          label: 'Bank Account',                 group: 'Collections',        desc: 'Bank ledger (receipts via RTGS/cheque, deposits).',inExport: true },
  // Other (mapped now, fed into export in a later pass)
  { key: 'other_income',  label: 'Other Income (cash overage)',  group: 'Other',              desc: 'Cash overage at shift end (booked as income).',    inExport: false },
  { key: 'petty_cash',    label: 'Petty Cash',                   group: 'Other',              desc: 'Manager imprest / petty cash float.',              inExport: false },
  { key: 'staff_recovery',label: 'Staff Advances / Recovery',    group: 'Other',              desc: 'Cash shortages recovered from staff salary.',      inExport: false },
];

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ymd = d => String(d).replace(/-/g, '').slice(0, 8);

// Per-touchpoint rupee figures for a date (for the UI + the export).
async function dailyFigures(station_id, date) {
  const [fuel, lube, receipts, deposits, overage] = await Promise.all([
    pool.query(`
      SELECT de.fuel_type, de.payment_mode, COALESCE(SUM(de.amount),0) AS amt
      FROM dispense_events de JOIN shifts s ON s.id = de.shift_id
      WHERE s.station_id=$1 AND de.occurred_at::date=$2
      GROUP BY de.fuel_type, de.payment_mode`, [station_id, date]),
    pool.query(`
      SELECT payment_mode,
        COALESCE(SUM(grand_total),0) AS grand,
        COALESCE(SUM(subtotal),0)    AS taxable,
        COALESCE(SUM(total_cgst),0)  AS cgst,
        COALESCE(SUM(total_sgst),0)  AS sgst
      FROM product_invoices WHERE station_id=$1 AND created_at::date=$2
      GROUP BY payment_mode`, [station_id, date]),
    pool.query(`SELECT payment_type, COALESCE(SUM(amount),0) AS amt FROM corporate_receipts
                WHERE station_id=$1 AND receipt_date=$2 GROUP BY payment_type`, [station_id, date]),
    pool.query(`SELECT COALESCE(SUM(amount),0) AS amt FROM cash_deposits WHERE station_id=$1 AND deposit_date=$2`, [station_id, date]),
    pool.query(`
      SELECT COALESCE(SUM(GREATEST(r.cash_actual - r.cash_expected, 0)),0) AS amt
      FROM shift_reconciliation r JOIN shifts s ON s.id=r.shift_id
      WHERE s.station_id=$1 AND r.manager_confirmed=TRUE AND r.reconciled_at::date=$2`, [station_id, date]),
  ]);

  const f = { petrol: 0, diesel: 0, premium_petrol: 0, cng: 0 };
  const fuelMode = { cash: 0, upi: 0, card: 0, credit: 0 };
  fuel.rows.forEach(r => {
    const a = parseFloat(r.amt);
    if (f[r.fuel_type] != null) f[r.fuel_type] += a;
    if (fuelMode[r.payment_mode] != null) fuelMode[r.payment_mode] += a;
  });
  let lubeTaxable = 0, lubeCgst = 0, lubeSgst = 0;
  const lubeMode = { cash: 0, upi: 0, card: 0, credit: 0 };
  lube.rows.forEach(r => {
    lubeTaxable += parseFloat(r.taxable); lubeCgst += parseFloat(r.cgst); lubeSgst += parseFloat(r.sgst);
    if (lubeMode[r.payment_mode] != null) lubeMode[r.payment_mode] += parseFloat(r.grand);
  });
  const rcpt = { cash: 0, upi: 0, bank: 0 };
  receipts.rows.forEach(r => {
    const a = parseFloat(r.amt);
    if (r.payment_type === 'cash') rcpt.cash += a;
    else if (r.payment_type === 'upi') rcpt.upi += a;
    else rcpt.bank += a; // cheque / rtgs
  });

  const v = {
    petrol_sales:  +f.petrol.toFixed(2),
    diesel_sales:  +f.diesel.toFixed(2),
    premium_sales: +f.premium_petrol.toFixed(2),
    cng_sales:     +f.cng.toFixed(2),
    lube_sales:    +lubeTaxable.toFixed(2),
    output_cgst:   +lubeCgst.toFixed(2),
    output_sgst:   +lubeSgst.toFixed(2),
    cash_in_hand:  +(fuelMode.cash + lubeMode.cash).toFixed(2),
    upi_bank:      +(fuelMode.upi + lubeMode.upi).toFixed(2),
    card_bank:     +(fuelMode.card + lubeMode.card).toFixed(2),
    debtors:       +(fuelMode.credit + lubeMode.credit).toFixed(2),
    bank:          +(parseFloat(deposits.rows[0].amt) || 0).toFixed(2),
    other_income:  +(parseFloat(overage.rows[0].amt) || 0).toFixed(2),
    petty_cash:    0,
    staff_recovery:0,
    // raw pieces the voucher builder needs:
    _receipts: rcpt,
    _deposits: +(parseFloat(deposits.rows[0].amt) || 0).toFixed(2),
  };
  return v;
}

function ledgerEntry(name, amount, isDebit) {
  // Tally convention: debit → ISDEEMEDPOSITIVE Yes + negative amount; credit → No + positive.
  const amt = (isDebit ? -1 : 1) * Math.abs(amount);
  return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amt.toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
}
function voucher(vchtype, date, number, remoteid, narration, entries) {
  return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${esc(vchtype)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${date}</DATE>
        <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>${esc(vchtype)}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER>
        <REMOTEID>${esc(remoteid)}</REMOTEID>
        <NARRATION>${esc(narration)}</NARRATION>
${entries.join('\n')}
      </VOUCHER>
      </TALLYMESSAGE>`;
}

// Build the full Tally XML. Throws { unmapped: [...] } if a needed ledger is missing.
function buildTallyXml({ station_id, date, figures, map, company }) {
  const L = key => map[key];                       // ledger name for a touchpoint
  const d = ymd(date);
  const need = new Set();
  const useDr = (key, amt) => { if (amt > 0.005) { if (!L(key)) need.add(key); return ledgerEntry(L(key), amt, true); } return null; };
  const useCr = (key, amt) => { if (amt > 0.005) { if (!L(key)) need.add(key); return ledgerEntry(L(key), amt, false); } return null; };

  const messages = [];

  // 1) Daily Sales voucher: Dr collections, Cr sales + GST
  const salesEntries = [
    useDr('cash_in_hand', figures.cash_in_hand), useDr('upi_bank', figures.upi_bank),
    useDr('card_bank', figures.card_bank),       useDr('debtors', figures.debtors),
    useCr('petrol_sales', figures.petrol_sales), useCr('diesel_sales', figures.diesel_sales),
    useCr('premium_sales', figures.premium_sales), useCr('cng_sales', figures.cng_sales),
    useCr('lube_sales', figures.lube_sales),     useCr('output_cgst', figures.output_cgst),
    useCr('output_sgst', figures.output_sgst),
  ].filter(Boolean);
  if (salesEntries.length) {
    messages.push(voucher('Sales', d, `PMP-S-${d}`, `PUMPINI/${station_id}/${d}/SALES`,
      'Daily fuel & lube sales (Pumpini)', salesEntries));
  }

  // 2) Receipts from credit customers: Dr cash/upi/bank, Cr debtors
  const r = figures._receipts;
  const rcptEntries = [
    useDr('cash_in_hand', r.cash), useDr('upi_bank', r.upi), useDr('bank', r.bank),
    useCr('debtors', r.cash + r.upi + r.bank),
  ].filter(Boolean);
  if (rcptEntries.length > 1) {
    messages.push(voucher('Receipt', d, `PMP-R-${d}`, `PUMPINI/${station_id}/${d}/RECEIPT`,
      'Credit customer collections (Pumpini)', rcptEntries));
  }

  // 3) Bank deposit (Contra): Dr Bank, Cr Cash in Hand
  if (figures._deposits > 0.005) {
    const contraEntries = [useDr('bank', figures._deposits), useCr('cash_in_hand', figures._deposits)].filter(Boolean);
    messages.push(voucher('Contra', d, `PMP-C-${d}`, `PUMPINI/${station_id}/${d}/CONTRA`,
      'Cash deposited to bank (Pumpini)', contraEntries));
  }

  if (need.size) return { error: 'unmapped', unmapped: [...need] };

  const xml = `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages.join('\n')}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
  return { xml, voucherCount: messages.length };
}

async function loadMap(station_id) {
  const { rows } = await pool.query('SELECT touchpoint_key, ledger_name FROM tally_ledger_map WHERE station_id=$1', [station_id]);
  const map = {}; rows.forEach(r => { if (r.ledger_name) map[r.touchpoint_key] = r.ledger_name; });
  return map;
}

// GET /api/tally/touchpoints?station_id=&date= — touchpoint list + today's values + saved ledgers
router.get('/touchpoints', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [figures, map, st] = await Promise.all([
      dailyFigures(station_id, date),
      loadMap(station_id),
      pool.query('SELECT tally_company_name FROM station_settings WHERE station_id=$1', [station_id]),
    ]);
    res.json({
      date,
      company_name: st.rows[0]?.tally_company_name || '',
      touchpoints: TOUCHPOINTS.map(t => ({ ...t, value: figures[t.key] ?? 0, ledger_name: map[t.key] || '' })),
    });
  } catch (err) { next(err); }
});

// POST /api/tally/map — save ledger mappings + company name (owner/manager)
router.post('/map', authenticate, authorize('owner', 'manager'), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, mappings = [], company_name } = req.body;
    for (const m of mappings) {
      if (!m.touchpoint_key) continue;
      await pool.query(
        `INSERT INTO tally_ledger_map(station_id, touchpoint_key, ledger_name)
         VALUES($1,$2,$3)
         ON CONFLICT(station_id, touchpoint_key) DO UPDATE SET ledger_name=$3, updated_at=NOW()`,
        [station_id, m.touchpoint_key, m.ledger_name || null]);
    }
    if (company_name !== undefined) {
      await pool.query(
        `INSERT INTO station_settings(station_id, tally_company_name) VALUES($1,$2)
         ON CONFLICT(station_id) DO UPDATE SET tally_company_name=$2`, [station_id, company_name || null]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/tally/export?station_id=&date= — download Tally Prime XML
router.get('/export', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [figures, map, st] = await Promise.all([
      dailyFigures(station_id, date),
      loadMap(station_id),
      pool.query('SELECT tally_company_name FROM station_settings WHERE station_id=$1', [station_id]),
    ]);
    const company = st.rows[0]?.tally_company_name || '';
    if (!company) return res.status(400).json({ error: 'Set the Tally company name first.' });
    const built = buildTallyXml({ station_id, date, figures, map, company });
    if (built.error === 'unmapped') {
      const labels = built.unmapped.map(k => TOUCHPOINTS.find(t => t.key === k)?.label || k);
      return res.status(400).json({ error: 'unmapped_ledgers', detail: `Map a Tally ledger for: ${labels.join(', ')}` });
    }
    if (!built.voucherCount) return res.status(400).json({ error: 'No financial activity to export for this date.' });
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="tally-${ymd(date)}.xml"`);
    res.send(built.xml);
  } catch (err) { next(err); }
});

module.exports = router;
