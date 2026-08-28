// scripts/slip-eval.js — the printing half of the replay bench.
//
// The MEASUREMENT lives in src/services/slipEvalService. This file only formats it,
// because the bench also has to be runnable where the API keys actually are — on
// Railway, through POST /api/superadmin/slip-eval — and two copies of the measurement
// would drift within a week. Same reason artifact backfill runs as a route.
//
//   Run:  node scripts/slip-eval.js --artifact <uuid> [--artifact <uuid>] [-n 3]
//         node scripts/slip-eval.js --latest 2 [-n 3]        # newest composite slips
//         node scripts/slip-eval.js --station <uuid> --latest 4
//
// Needs DATABASE_URL, ANTHROPIC_API_KEY and (for the Vision path) GOOGLE_VISION_API_KEY
// — i.e. run it where the backend runs.
const pool = require('../src/db/pool');
const { runEval } = require('../src/services/slipEvalService');

function args() {
  const a = process.argv.slice(2);
  const out = { ids: [], runs: 1, latest: 0, station: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--artifact') out.ids.push(a[++i]);
    else if (a[i] === '-n' || a[i] === '--runs') out.runs = Math.max(1, parseInt(a[++i], 10) || 1);
    else if (a[i] === '--latest') out.latest = Math.max(1, parseInt(a[++i], 10) || 1);
    else if (a[i] === '--station') out.station = a[++i];
  }
  return out;
}

const fmt = v => (v == null ? 'null' : String(v));

async function main() {
  const opt = args();
  const res = await runEval(opt);
  if (!res.images) { console.error('No slip artifacts found carrying an image.'); process.exit(1); }

  console.log(`\nslip-eval — ${res.images} image(s) x ${res.runs} run(s)`);
  console.log(`vision key: ${res.vision_key ? 'SET' : 'NOT SET (vision path will be skipped)'}\n`);

  for (const art of res.artifacts) {
    const when = new Date(art.captured_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log('='.repeat(78));
    console.log(`${art.outlet}  ·  ${when}  ·  ${art.id}`);
    console.log('='.repeat(78));
    if (art.skipped) { console.log(`  ${art.skipped} — SKIPPED\n`); continue; }

    art.runs.forEach((r, i) => {
      if (r.threw) { console.error(`  run ${i + 1}: threw — ${r.threw}`); return; }
      console.log(`\n  run ${i + 1}  ·  engine=${r.engine}  ·  ocr_chars=${r.ocr_chars}  ·  ${r.ms}ms`);
      console.log(`  slips=${r.slips}  lines=${r.total}  legible=${r.legible}/${r.total}  ` +
                  `lines whose serial matches a real pump=${r.serial_hits}/${r.total}`);
      console.log('  ' + 'serial'.padEnd(16) + 'noz'.padEnd(5) + 'amount'.padEnd(18) +
                  'volume'.padEnd(18) + 'Rs/L'.padEnd(10) + 'flags');
      for (const l of r.lines) {
        console.log('  ' + fmt(l.serial).padEnd(16) + fmt(l.noz).padEnd(5) +
          fmt(l.amount).padEnd(18) + fmt(l.volume).padEnd(18) + fmt(l.implied).padEnd(10) +
          (l.legible ? 'legible ' : 'REFUSED ') + (l.swapped ? 'SWAPPED ' : '') + (l.reason || ''));
      }
    });
    console.log('');
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
