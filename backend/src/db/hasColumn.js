// src/db/hasColumn.js
//
// ONE cached "does this column exist in prod yet?" probe.
//
// WHY THIS EXISTS. Code deploys before the owner runs the DDL (CLAUDE.md, deploy
// ordering), so a query naming a not-yet-migrated column 42703s. The house rule is
// PROBE, never try-and-catch: inside a transaction a failed statement aborts the whole
// thing, so the fallback dies too. A catalog SELECT succeeds either way and cannot
// poison a transaction.
//
// Nine files had grown their own private copy of this probe (deliveries.js,
// reconcile.js, accounts.js, pumpService.js, couponService.js, invoiceNumberService.js,
// leadService.js, creditSlipBookService.js, accountsShiftPosting.js). This is the one
// writer for the concept; new callers use it, and the existing copies are listed in
// docs/opentasks.md to fold in later — not rewritten here, because touching nine live
// files to prove a point is how a Friday goes wrong.
//
// Caching: only a TRUE is cached. A FALSE is re-probed, so the first call after the
// owner runs the migration picks it up with no restart.
const pool = require('./pool');

const present = new Set();

async function hasColumn(table, column, db = pool) {
  const key = `${table}.${column}`;
  if (present.has(key)) return true;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
      [table, column]);
    if (rows.length) { present.add(key); return true; }
    return false;
  } catch {
    return false;   // never let a catalog hiccup break a read path
  }
}

// Test seam — lets a test clear what a previous test cached.
function _resetCache() { present.clear(); }

module.exports = { hasColumn, _resetCache };
