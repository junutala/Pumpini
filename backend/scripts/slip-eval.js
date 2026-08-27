// scripts/slip-eval.js
//
// Measures what PUMPINI returns when it reads a dispenser slip — the real
// slipParser, the real prompt, the real models — against images already stored in
// station_artifacts. Nothing here re-implements the parser; if this script says a
// scan is good, production will produce the same thing.
//
// WHY IT EXISTS. On 20-Aug-2026 the only way to test a parser change was for the
// owner to photograph slips, upload them through the app, and then have someone
// read the stored OCR back out of the database by hand. That makes him the courier
// for every iteration, and it cannot be repeated often enough to tell a real
// improvement from run-to-run variance. The parse call sets no temperature, so the
// SAME image can return different answers — one scan proves nothing. Hence -n.
//
//   Run:  node scripts/slip-eval.js --artifact <uuid> [--artifact <uuid>] [-n 3]
//         node scripts/slip-eval.js --latest 2 [-n 3]        # newest composite slips
//         node scripts/slip-eval.js --station <uuid> --latest 4
//
// Needs DATABASE_URL, ANTHROPIC_API_KEY and (for the Vision path) GOOGLE_VISION_API_KEY
// — i.e. run it where the backend runs.
const pool = require('../src/db/pool');
const { parseCompositeSlips } = require('../src/services/slipParser');
// The bench reads its images through the SAME resolver every screen uses, so it can
// reach an artifact wherever it lives. See loadArtifacts for why that matters.
const artifacts = require('../src/services/artifactService');

function args() {
  const a = process.argv.slice(2);
  const out = { artifacts: [], runs: 1, latest: 0, station: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--artifact') out.artifacts.push(a[++i]);
    else if (a[i] === '-n' || a[i] === '--runs') out.runs = Math.max(1, parseInt(a[++i], 10) || 1);
    else if (a[i] === '--latest') out.latest = Math.max(1, parseInt(a[++i], 10) || 1);
    else if (a[i] === '--station') out.station = a[++i];
  }
  return out;
}

// THE CORPUS IS WHATEVER HAS BYTES ANYWHERE — bucket or inline.
//
// This used to require `file_base64 IS NOT NULL`, which quietly made the bench a
// measure of the storage migration rather than of the reader. Of the 40 nozzle_slip
// artifacts on 27-Aug-2026, ALL 40 are in the bucket and only 21 are still inline —
// so half the regression corpus was already invisible here. After the documented
// prune step clears the base64 column it would have been all of it, and the bench
// would have said "no artifacts" rather than "the reader got worse".
//
// A regression bench that shrinks as a migration proceeds is worse than none: it
// reports success by having nothing left to test. Selection now asks only whether
// the row HAS an image; getImage() below fetches the bytes from wherever they are.
async function loadArtifacts({ artifacts: ids, latest, station }) {
  const has = `(a.file_base64 IS NOT NULL OR a.storage_path IS NOT NULL)`;
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT a.id, a.media_type, a.captured_at, s.name AS outlet
         FROM station_artifacts a JOIN stations s ON s.id = a.station_id
        WHERE a.id = ANY($1::uuid[]) AND ${has}`, [ids]);
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.media_type, a.captured_at, s.name AS outlet
       FROM station_artifacts a JOIN stations s ON s.id = a.station_id
      WHERE a.kind = 'nozzle_slip' AND ${has}
        AND ($1::uuid IS NULL OR a.station_id = $1::uuid)
      ORDER BY a.captured_at DESC LIMIT $2`, [station, latest || 2]);
  return rows;
}

// One line per nozzle, so two runs can be eyeballed side by side.
function summarise(res) {
  if (!res) return { engine: 'PARSE FAILED', slips: 0, lines: [], legible: 0, total: 0 };
  const lines = [];
  for (const s of res.slips || []) {
    for (const n of s.nozzles || []) {
      lines.push({
        serial: s.pump_serial || '—',
        noz: n.nozzle_no || '—',
        amount: n.cumulative_amount,
        volume: n.cumulative_volume,
        legible: n.legible === true,
        swapped: n.swapped_amount_for_volume === true,
        implied: n.implied_price,
        reason:  n.reject_reason || '',
      });
    }
  }
  return {
    engine: res.engine || 'unknown',
    ocr_chars: res.ocr_chars || 0,
    slips: (res.slips || []).length,
    lines,
    legible: lines.filter(l => l.legible).length,
    total: lines.length,
  };
}

const fmt = v => (v == null ? 'null' : String(v));

async function main() {
  const opt = args();
  const rows = await loadArtifacts(opt);
  if (!rows.length) { console.error('No slip artifacts found carrying an image.'); process.exit(1); }

  console.log(`\nslip-eval — ${rows.length} image(s) x ${opt.runs} run(s)`);
  console.log(`vision key: ${process.env.GOOGLE_VISION_API_KEY ? 'SET' : 'NOT SET (vision path will be skipped)'}\n`);

  // Serials actually configured at the outlet, so a returned serial can be scored
  // against the database rather than against anybody's opinion of the photo.
  const { rows: known } = await pool.query(
    `SELECT DISTINCT upper(btrim(serial)) AS serial FROM pumps WHERE serial IS NOT NULL AND end_date IS NULL`);
  const knownSerials = new Set(known.map(k => k.serial));

  for (const art of rows) {
    const when = new Date(art.captured_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log('='.repeat(78));
    console.log(`${art.outlet}  ·  ${when}  ·  ${art.id}`);
    console.log('='.repeat(78));

    // Bytes via the shared resolver — inline rows answer immediately, bucket rows are
    // downloaded. Fetched ONCE per artifact, not once per run, so -n measures the
    // reader's variance and not the network's.
    const img = await artifacts.getImage(art.id);
    if (!img?.file_base64) {
      console.log('  image could not be fetched (bucket download failed?) — SKIPPED\n');
      continue;
    }

    for (let r = 1; r <= opt.runs; r++) {
      const t0 = Date.now();
      let res = null;
      try {
        res = await parseCompositeSlips({ file_base64: img.file_base64, media_type: img.media_type || art.media_type || 'image/jpeg' });
      } catch (e) { console.error(`  run ${r}: threw — ${e.message}`); continue; }
      const sum = summarise(res);
      const hits = sum.lines.filter(l => knownSerials.has(String(l.serial).toUpperCase())).length;

      console.log(`\n  run ${r}  ·  engine=${sum.engine}  ·  ocr_chars=${sum.ocr_chars}  ·  ${Date.now() - t0}ms`);
      console.log(`  slips=${sum.slips}  lines=${sum.total}  legible=${sum.legible}/${sum.total}  ` +
                  `lines whose serial matches a real pump=${hits}/${sum.total}`);
      console.log('  ' + 'serial'.padEnd(16) + 'noz'.padEnd(5) + 'amount'.padEnd(18) + 'volume'.padEnd(18) + 'Rs/L'.padEnd(10) + 'flags');
      for (const l of sum.lines) {
        console.log('  ' + String(l.serial).padEnd(16) + String(l.noz).padEnd(5) +
          fmt(l.amount).padEnd(18) + fmt(l.volume).padEnd(18) + fmt(l.implied).padEnd(10) +
          (l.legible ? 'legible ' : 'REFUSED ') + (l.swapped ? 'SWAPPED ' : '') + l.reason);
      }
    }
    console.log('');
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
