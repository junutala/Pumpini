// src/db/backfill-vawe-outlets.js — one-off (re-runnable) push of every existing
// outlet to VAWE, so VAWE receives our current set. Safe to re-run any time:
// VAWE upserts on pumpiniOutletId, so re-pushing simply refreshes each outlet.
//
//   node src/db/backfill-vawe-outlets.js               # all outlets, 400ms apart
//   node src/db/backfill-vawe-outlets.js --delay 800   # gentler rate-limit
//
// Requires VAWE_API_URL and PUMPINI_WEBHOOK_SECRET in the environment.
const pool = require('./pool');
const { syncOutlet } = require('../services/vaweService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseDelay(argv) {
  const i = argv.indexOf('--delay');
  if (i !== -1 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 400; // default: gentle 400ms between outlets
}

(async () => {
  if (!process.env.VAWE_API_URL || !process.env.PUMPINI_WEBHOOK_SECRET) {
    console.error('VAWE_API_URL and PUMPINI_WEBHOOK_SECRET must be set. Aborting.');
    process.exit(1);
  }

  const delayMs = parseDelay(process.argv);
  const { rows } = await pool.query('SELECT id, name FROM stations ORDER BY created_at');
  console.log(`Pushing ${rows.length} outlet(s) to VAWE (${delayMs}ms apart)...`);

  let pushed = 0, skipped = 0, failed = 0;
  for (const s of rows) {
    try {
      const res = await syncOutlet(s.id);
      if (res) { pushed++; console.log(`  ✓ ${s.name} (${s.id})`); }
      else     { skipped++; console.log(`  – ${s.name} (${s.id}) — not found`); }
    } catch (e) {
      failed++;
      const why = e.code === 'VAWE_INCOMPLETE' ? e.message : (e.message || e);
      console.error(`  ✗ ${s.name} (${s.id}): ${why}`);
    }
    await sleep(delayMs);
  }

  console.log(`Done — ${pushed} pushed, ${skipped} skipped, ${failed} failed.`);
  await pool.end();
})().catch(async (e) => {
  console.error('Backfill failed:', e.message);
  await pool.end();
  process.exit(1);
});
