// scripts/artifacts-to-bucket.js
//
// Moves already-stored artifact images out of Postgres and into the private
// bucket, one row at a time.
//
// WHY. artifactService.save() has always ACCEPTED a storage_path but never
// produced one, and no caller uploaded first — so every station_artifacts row
// ever written sat inline as base64 while delivery_invoices (78/78) and
// meter_photos (39/39) went to the bucket correctly. As of 20-Aug-2026 new
// artifacts upload themselves; these are the ones written before that.
//
// SAFE BY CONSTRUCTION. For each row: upload first, verify the bytes come back
// byte-identical, and only then clear file_base64. A row whose upload or
// verification fails is left exactly as it was. Nothing is deleted that has not
// first been proven readable from its new home.
//
//   node scripts/artifacts-to-bucket.js --dry-run     # report only, no writes
//   node scripts/artifacts-to-bucket.js               # move them
//   node scripts/artifacts-to-bucket.js --limit 5     # a few first
//
// Needs DATABASE_URL and the SUPABASE_* storage vars — run it where the backend runs.
const pool = require('../src/db/pool');
const { storageConfigured, uploadDocumentBase64, downloadDocument } = require('../src/services/vaweStorage');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 ? Math.max(1, parseInt(argv[i + 1], 10) || 1) : null;
})();

const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';

async function main() {
  if (!storageConfigured()) {
    console.error('Object storage is not configured (SUPABASE_URL / service key missing). Nothing done.');
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT id, station_id, entity_id, kind, media_type,
            length(file_base64) AS b64_len
       FROM station_artifacts
      WHERE file_base64 IS NOT NULL AND storage_path IS NULL
      ORDER BY captured_at
      ${LIMIT ? 'LIMIT ' + LIMIT : ''}`);

  if (!rows.length) { console.log('Nothing to move — every artifact already has a storage_path.'); await pool.end(); return; }

  const total = rows.reduce((s, r) => s + Number(r.b64_len || 0), 0);
  console.log(`\n${rows.length} artifact(s) inline, ${mb(total)} of base64${DRY ? '  [DRY RUN — no writes]' : ''}\n`);

  let moved = 0, freed = 0, failed = 0;
  for (const r of rows) {
    const tag = `${r.kind} ${r.id.slice(0, 8)}`;
    if (DRY) { console.log(`  would move  ${tag}  ${mb(Number(r.b64_len))}`); continue; }
    try {
      // Read the bytes fresh — the listing above deliberately did not carry them,
      // so a 200-row backfill never holds 200 images in memory at once.
      const { rows: [full] } = await pool.query(
        'SELECT file_base64 FROM station_artifacts WHERE id = $1', [r.id]);
      if (!full || !full.file_base64) { console.log(`  skipped     ${tag} — no bytes`); continue; }

      const path = await uploadDocumentBase64({
        prefix: `artifacts/${r.kind}`,
        scope: r.entity_id || r.station_id,
        base64: full.file_base64,
        contentType: r.media_type || 'image/jpeg',
        filename: r.media_type === 'application/pdf' ? 'doc.pdf' : 'image.jpg',
      });

      // PROVE IT LANDED before dropping the only other copy.
      const back = (await downloadDocument(path)).toString('base64');
      if (back !== full.file_base64) {
        console.error(`  MISMATCH    ${tag} — uploaded bytes differ; row left untouched`);
        failed++; continue;
      }

      await pool.query(
        'UPDATE station_artifacts SET storage_path = $1, file_base64 = NULL WHERE id = $2',
        [path, r.id]);
      moved++; freed += Number(r.b64_len || 0);
      console.log(`  moved       ${tag}  ${mb(Number(r.b64_len))}  -> ${path}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED      ${tag} — ${e.message || e}  (row left untouched)`);
    }
  }

  if (!DRY) {
    console.log(`\nmoved ${moved}, failed ${failed}, freed ${mb(freed)} from Postgres`);
    console.log('Run VACUUM FULL station_artifacts to reclaim the disk (takes an exclusive lock — do it off-peak).');
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
