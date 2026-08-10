// scripts/accounts-engine-selftest.js
// Pure-logic self-test for the posting engine — no database required.
// Proves the rule → line expansion balances, honours event-supplied accounts, and
// fails loudly on missing accounts / unknown event types.  Run: node scripts/accounts-engine-selftest.js
const { buildLines, assertBalanced } = require('../src/services/accountingEngine');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '—', e.message); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(m || `${a} !== ${b}`); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// Mirror the seeded rulebook shapes.
const cogsRules = [
  { leg_no: 1, side: 'debit',  account_code: 'cogs_fuel',          amount_key: 'amount' },
  { leg_no: 2, side: 'credit', account_code: 'closing_stock_fuel', amount_key: 'amount' },
];
const expensePaidRules = [
  { leg_no: 1, side: 'debit',  account_code: null, account_key: 'expense_account', amount_key: 'amount' },
  { leg_no: 2, side: 'credit', account_code: null, account_key: 'paid_from',       amount_key: 'amount' },
];

check('COGS builds a balanced 2-leg entry', () => {
  const lines = buildLines(cogsRules, { type: 'cogs_fuel', amount: 1000 });
  eq(lines.length, 2);
  eq(lines[0].debit, 1000); eq(lines[0].credit, 0);
  eq(lines[1].credit, 1000); eq(lines[1].debit, 0);
  assertBalanced(lines);
});

check('expense_paid pulls both accounts from the event', () => {
  const lines = buildLines(expensePaidRules, {
    type: 'expense_paid', amount: 2450,
    accounts: { expense_account: 'repairs_maintenance', paid_from: 'bank' },
  });
  eq(lines[0].account_code, 'repairs_maintenance');
  eq(lines[1].account_code, 'bank');
  assertBalanced(lines);
});

check('missing event-supplied account throws', () =>
  eq(throws(() => buildLines(expensePaidRules, { type: 'expense_paid', amount: 10, accounts: {} })), true));

check('unknown event type (no rules) throws', () =>
  eq(throws(() => buildLines([], { type: 'nonesuch', amount: 1 })), true));

check('fractional amounts still balance to the paisa', () => {
  const lines = buildLines(cogsRules, { type: 'cogs_fuel', amount: 33.335 });
  assertBalanced(lines);
});

check('assertBalanced rejects a lopsided entry', () =>
  eq(throws(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }])), true));

// The per-shift fuel-sale rule: split debits by payment mode, one revenue credit.
const fuelSaleRules = [
  { leg_no: 1, side: 'debit',  account_code: 'cash_in_hand', amount_key: 'cash' },
  { leg_no: 2, side: 'debit',  account_code: 'upi_clearing', amount_key: 'upi_card' },
  { leg_no: 3, side: 'debit',  account_code: 'debtors',      amount_key: 'credit' },
  { leg_no: 4, side: 'credit', account_code: 'fuel_sales',   amount_key: 'amount' },
];

check('fuel_sale splits debits by mode and balances', () => {
  const lines = buildLines(fuelSaleRules, {
    type: 'fuel_sale', amount: 10000, amounts: { cash: 6000, upi_card: 3000, credit: 1000 },
  });
  eq(lines.length, 4);
  assertBalanced(lines);
});

check('fuel_sale skips zero legs (all-cash shift) and still balances', () => {
  const lines = buildLines(fuelSaleRules, {
    type: 'fuel_sale', amount: 5000, amounts: { cash: 5000, upi_card: 0, credit: 0 },
  });
  eq(lines.length, 2);                 // cash debit + revenue credit only
  eq(lines[0].account_code, 'cash_in_hand');
  eq(lines[1].account_code, 'fuel_sales');
  assertBalanced(lines);
});

console.log(`\n${fail ? '✗ FAILED' : '✓ PASSED'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
