// src/db/backfill-settlement-ledger.js — one-time (re-runnable) rebuild of the
// reconciliation ledger from the source tables. Safe to run any time: the writer
// is idempotent, so this simply re-derives every shift and converges the ledger.
//
//   node src/db/backfill-settlement-ledger.js            # all shifts
//   node src/db/backfill-settlement-ledger.js 2026-06-01 # shifts on/after a date
//
// Run AFTER the settlement-ledger DDL is applied.
const pool = require('./pool');
const { recomputeShift } = require('../services/settlementLedger');

(async () => {
  const since = process.argv[2] || null;
  const { rows } = since
    ? await pool.query(`SELECT id FROM shifts WHERE date >= $1 ORDER BY date, shift_number`, [since])
    : await pool.query(`SELECT id FROM shifts ORDER BY date, shift_number`);

  console.log(`Backfilling settlement ledger for ${rows.length} shift(s)${since ? ` since ${since}` : ''}...`);
  let n = 0;
  for (const s of rows) {
    await recomputeShift(s.id);
    if (++n % 25 === 0) console.log(`  ${n}/${rows.length}`);
  }
  console.log(`Done — ${n} shift(s) processed.`);
  await pool.end();
})().catch(async (e) => {
  console.error('Backfill failed:', e.message);
  await pool.end();
  process.exit(1);
});
