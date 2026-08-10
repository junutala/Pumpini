// src/services/accountsReports.js
//
// The balance-sheet anchor and the derived statements. Opening balances are posted as ONE
// balanced journal entry (capital is the plug), so both statements are pure "sum the
// journal": nothing is stored twice. Reads/writes only the module's own tables.
const engine = require('./accountingEngine');
const { round2 } = engine;

// Save opening balances + (re)post the single 'opening_balance' journal entry. Fixed
// assets come from the fixed_assets table (owned-by-outlet net book value) — one source of
// truth — so the caller's fixed_assets value is ignored. Capital = Σ assets − Σ liabilities.
async function saveOpeningBalances(db, o) {
  const { station_id, books_start_date, land_ownership, updated_by } = o;
  const n = (k) => round2(Number(o[k]) || 0);
  const cash = n('cash'), bank = n('bank'), stock_fuel = n('stock_fuel'), stock_lube = n('stock_lube'),
        receivables = n('receivables'), creditors = n('creditors'), cng_payable = n('cng_payable'),
        loans = n('loans');

  const { rows: fa } = await db.query(
    `SELECT COALESCE(SUM(cost - COALESCE(accum_depreciation,0)),0) AS net
       FROM fixed_assets WHERE station_id=$1 AND owned_by='outlet'`, [station_id]);
  const fixed_assets = round2(Number(fa[0].net));

  const assets = round2(cash + bank + stock_fuel + stock_lube + receivables + fixed_assets);
  const liabilities = round2(creditors + cng_payable + loans);
  const capital = round2(assets - liabilities);

  await db.query(
    `INSERT INTO accounting_opening_balances
       (station_id, books_start_date, cash, bank, stock_fuel, stock_lube, receivables,
        creditors, cng_payable, loans, fixed_assets, capital, land_ownership, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (station_id) DO UPDATE SET
       books_start_date=$2, cash=$3, bank=$4, stock_fuel=$5, stock_lube=$6, receivables=$7,
       creditors=$8, cng_payable=$9, loans=$10, fixed_assets=$11, capital=$12,
       land_ownership=$13, updated_by=$14, updated_at=NOW()`,
    [station_id, books_start_date, cash, bank, stock_fuel, stock_lube, receivables,
     creditors, cng_payable, loans, fixed_assets, capital, land_ownership || 'owned', updated_by || null]);

  // Re-post the opening entry (idempotent by replacement).
  await db.query(`DELETE FROM accounting_journal WHERE station_id=$1 AND event_type='opening_balance'`, [station_id]);
  const lines = [];
  const dr = (acc, amt) => { if (amt > 0) lines.push({ account_code: acc, debit: amt, credit: 0 }); };
  const cr = (acc, amt) => { if (amt > 0) lines.push({ account_code: acc, debit: 0, credit: amt }); };
  dr('cash_in_hand', cash); dr('bank', bank); dr('closing_stock_fuel', stock_fuel);
  dr('closing_stock_lube', stock_lube); dr('debtors', receivables); dr('fixed_assets', fixed_assets);
  cr('creditors', creditors); cr('cng_payable', cng_payable); cr('owner_loan', loans);
  if (capital >= 0) cr('capital', capital); else dr('capital', round2(-capital));

  if (lines.length) {
    await engine.postJournal(db, {
      station_id, entry_date: books_start_date, event_type: 'opening_balance',
      source: 'opening', source_ref: 'opening', narration: 'Opening balances',
      lines, created_by: updated_by,
    });
  }
  return { assets, liabilities, capital, fixed_assets };
}

// Balance sheet: sum every journal line, group by account type. Assets = Σ(dr−cr) over
// asset accounts (contra-assets like accumulated depreciation reduce it naturally). Equity
// = capital − drawings + retained earnings (b/f) + profit for the period, where profit =
// income − expenses from the P&L accounts. Tallies because every entry is balanced.
async function balanceSheet(db, stationId) {
  const { rows } = await db.query(
    `SELECT a.code, a.name, a.acct_type,
            COALESCE(SUM(l.debit),0) AS dr, COALESCE(SUM(l.credit),0) AS cr
       FROM accounting_accounts a
       LEFT JOIN accounting_journal_lines l ON l.account_code=a.code AND l.station_id=$1
      GROUP BY a.code, a.name, a.acct_type, a.sort_order
      ORDER BY a.sort_order`, [stationId]);

  const assets = [], liabilities = [];
  let netProfit = 0, capital = 0, drawings = 0, retained = 0;
  for (const r of rows) {
    const d = Number(r.dr), c = Number(r.cr);
    if (r.acct_type === 'asset') { const b = round2(d - c); if (b !== 0) assets.push({ name: r.name, amount: b }); }
    else if (r.acct_type === 'liability') { const b = round2(c - d); if (b !== 0) liabilities.push({ name: r.name, amount: b }); }
    else if (r.acct_type === 'income') netProfit += (c - d);
    else if (r.acct_type === 'expense') netProfit -= (d - c);
    else if (r.acct_type === 'equity') {
      if (r.code === 'capital') capital = round2(c - d);
      else if (r.code === 'drawings') drawings = round2(d - c);
      else if (r.code === 'retained_earnings') retained = round2(c - d);
    }
  }
  netProfit = round2(netProfit);
  const assetsTotal = round2(assets.reduce((s, x) => s + x.amount, 0));
  const liabTotal = round2(liabilities.reduce((s, x) => s + x.amount, 0));

  const equity = [];
  if (capital !== 0) equity.push({ name: 'Owner Capital', amount: capital });
  if (retained !== 0) equity.push({ name: 'Retained Earnings (b/f)', amount: retained });
  equity.push({ name: 'Profit for the period', amount: netProfit });
  if (drawings !== 0) equity.push({ name: 'Less: Drawings', amount: round2(-drawings) });
  const equityTotal = round2(capital + retained + netProfit - drawings);

  return {
    assets, assetsTotal, liabilities, liabTotal, equity, equityTotal,
    liabPlusEquity: round2(liabTotal + equityTotal), netProfit,
    balanced: Math.abs(assetsTotal - (liabTotal + equityTotal)) < 0.01,
  };
}

// P&L for a period (defaults to all-time). Income and expenses from the P&L accounts.
async function pnl(db, stationId, { from, to } = {}) {
  const params = [stationId];
  let f = '';
  if (from) { params.push(from); f += ` AND j.entry_date >= $${params.length}`; }
  if (to)   { params.push(to);   f += ` AND j.entry_date <= $${params.length}`; }
  const { rows } = await db.query(
    `SELECT a.name, a.acct_type,
            COALESCE(SUM(l.debit),0) AS dr, COALESCE(SUM(l.credit),0) AS cr
       FROM accounting_journal_lines l
       JOIN accounting_journal j ON j.id = l.journal_id
       JOIN accounting_accounts a ON a.code = l.account_code
      WHERE l.station_id=$1 AND a.statement='pnl' ${f}
      GROUP BY a.name, a.acct_type, a.sort_order
      ORDER BY a.sort_order`, params);
  const income = [], expenses = [];
  let inc = 0, exp = 0;
  for (const r of rows) {
    const d = Number(r.dr), c = Number(r.cr);
    if (r.acct_type === 'income') { const v = round2(c - d); if (v !== 0) income.push({ name: r.name, amount: v }); inc += v; }
    else { const v = round2(d - c); if (v !== 0) expenses.push({ name: r.name, amount: v }); exp += v; }
  }
  return { income, expenses, incomeTotal: round2(inc), expenseTotal: round2(exp), netProfit: round2(inc - exp) };
}

module.exports = { saveOpeningBalances, balanceSheet, pnl };
