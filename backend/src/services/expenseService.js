// src/services/expenseService.js
//
// The ONE writer for a captured bill (expense or asset purchase). Every path — scan or
// manual — funnels through createExpense: it resolves/creates the vendor, remembers the
// chosen head (vendor→head learning), inserts the expense row, and posts the balanced
// accounting entry through the engine. It writes ONLY the module's own tables.
//
// Payment shapes (rules seeded in 011):
//   expense,  paid   → Dr <category>      Cr <bank|upi_clearing>
//   expense,  unpaid → Dr <category>      Cr creditors
//   asset,    paid   → Dr fixed_assets    Cr <bank|upi_clearing>
//   asset,    unpaid → Dr fixed_assets    Cr creditors
// Cash-paid expenses are NOT handled here — those stay on the existing petty-cash screen
// (owner's rule: the two expense worlds don't touch the cash drawer through this form).
const engine = require('./accountingEngine');

// Which ledger account the money left. Cheque clears the bank; UPI hits the clearing
// account (same as card/UPI sales receipts).
function paidFromAccount(mode) {
  if (mode === 'upi') return 'upi_clearing';
  return 'bank'; // bank | cheque
}

async function resolveVendor(db, { station_id, vendor_name, vendor_type, category, gstn, created_by }) {
  const name = (vendor_name || '').trim();
  if (!name) return null;
  const { rows: found } = await db.query(
    `SELECT * FROM accounting_vendors WHERE station_id=$1 AND lower(name)=lower($2) LIMIT 1`,
    [station_id, name]);
  if (found.length) {
    // Learn: keep the most recently confirmed head as this vendor's default.
    if (category && category !== found[0].default_category) {
      await db.query(`UPDATE accounting_vendors SET default_category=$2 WHERE id=$1`,
        [found[0].id, category]);
    }
    return found[0].id;
  }
  const { rows: ins } = await db.query(
    `INSERT INTO accounting_vendors(station_id, name, vendor_type, default_category, gstn, created_by)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [station_id, name, vendor_type || 'other', category || null, gstn || null, created_by || null]);
  return ins[0].id;
}

// Create + post one bill. `db` should be a transaction client (the route wraps it).
async function createExpense(db, o) {
  const {
    station_id, vendor_name, vendor_type, gstn,
    category, amount, gst_amount, expense_date, invoice_number, description,
    is_asset, asset_life_years, paid, payment_mode, document_path,
    ai_suggested_category, ai_confidence, created_by,
  } = o;

  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Amount must be greater than 0');
  if (!is_asset && !category) throw new Error('Pick an expense head');
  if (paid && !payment_mode) throw new Error('Choose how it was paid');

  const vendor_id = await resolveVendor(db, {
    station_id, vendor_name, vendor_type, category: is_asset ? null : category, gstn, created_by,
  });

  const paidFrom = paid ? paidFromAccount(payment_mode) : null;

  const { rows: exp } = await db.query(
    `INSERT INTO expenses
       (station_id, vendor_id, category, amount, gst_amount, expense_date, invoice_number,
        description, is_asset, asset_life_years, payment_status, payment_mode, paid_from,
        document_path, ai_suggested_category, ai_confidence, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [station_id, vendor_id, is_asset ? null : category, amt.toFixed(2), Number(gst_amount || 0).toFixed(2),
     expense_date, invoice_number || null, description || null, !!is_asset,
     asset_life_years || null, paid ? 'paid' : 'unpaid', paid ? payment_mode : null, paidFrom,
     document_path || null, ai_suggested_category || null, ai_confidence || null, created_by || null]);
  const expense = exp[0];

  const type = is_asset
    ? (paid ? 'asset_purchase_paid' : 'asset_purchase_unpaid')
    : (paid ? 'expense_paid' : 'expense_unpaid');
  const accounts = {};
  if (!is_asset) accounts.expense_account = category;
  if (paid)      accounts.paid_from = paidFrom;

  const narration = `${is_asset ? 'Asset' : 'Expense'}${vendor_name ? ' — ' + vendor_name : ''}`;
  const { journal } = await engine.postEvent(db, {
    station_id, type, date: expense_date, amount: amt,
    accounts, source: 'bill_payment', source_ref: expense.id,
    narration, created_by, party: { type: 'supplier', id: vendor_id },
  });

  if (journal) {
    await db.query(`UPDATE expenses SET journal_id=$2 WHERE id=$1`, [expense.id, journal.id]);
    expense.journal_id = journal.id;
  }
  return expense;
}

module.exports = { createExpense, resolveVendor, paidFromAccount };
