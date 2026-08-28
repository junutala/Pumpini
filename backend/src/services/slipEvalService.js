// THE REPLAY BENCH, as a service rather than only a script.
//
// § "Validation is REPLAY, not a field trial": the stored artifacts — the 25/26-Aug
// composites, the Nagole set, the 02–04 Aug photographs — ARE the regression corpus.
// Real slips, real glare, known right answers. The reader is measured against them
// offline before any screen ships, instead of by asking the owner to photograph slips
// and read the results back out of the database by hand.
//
// WHY IT MOVED OUT OF scripts/. The bench needs ANTHROPIC_API_KEY and
// GOOGLE_VISION_API_KEY, and those live on RAILWAY. A script on a laptop cannot run it,
// so the measurement the plan requires before shipping had nowhere to happen. The same
// problem, with the same answer, as the artifact backfill: the job has to RUN where the
// credential is, so it becomes a superadmin route — and superadmin.js had carried
// runBackfill() for months for exactly this reason. Search before you build.
//
// NOTHING HERE RE-IMPLEMENTS THE PARSER. It calls parseCompositeSlips, the same function
// every screen calls, with the same prompt and the same models. If the bench says a scan
// is good, production produces that scan.
const pool = require('../db/pool');
const { parseCompositeSlips } = require('./slipParser');
// Bytes through the SAME resolver every screen uses, so the corpus reaches an artifact
// wherever it lives — bucket or inline.
const artifacts = require('./artifactService');

// THE CORPUS IS WHATEVER HAS BYTES ANYWHERE.
//
// This once required `file_base64 IS NOT NULL`, which quietly made the bench a measure
// of the storage migration rather than of the reader: of the 40 nozzle_slip artifacts on
// 27-Aug-2026 all 40 are in the bucket and only 21 were still inline, so half the corpus
// was already invisible. After the prune step clears base64 it would have been all of
// it, and the bench would have reported "no artifacts" rather than "the reader got
// worse". A regression bench that shrinks as a migration proceeds reports success by
// having nothing left to test.
async function loadArtifacts({ ids = [], latest = 0, station = null } = {}) {
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

// One row per nozzle line, so two runs can be set side by side.
function summarise(res) {
  if (!res) return { engine: 'PARSE FAILED', ocr_chars: 0, slips: 0, lines: [], legible: 0, total: 0 };
  const lines = [];
  for (const s of res.slips || []) {
    for (const n of s.nozzles || []) {
      lines.push({
        serial: s.pump_serial || null,
        noz: n.nozzle_no ?? null,
        amount: n.cumulative_amount ?? null,
        volume: n.cumulative_volume ?? null,
        legible: n.legible === true,
        swapped: n.swapped_amount_for_volume === true,
        implied: n.implied_price ?? null,
        reason: n.reject_reason || null,
      });
    }
  }
  return {
    engine: res.engine || 'unknown',
    ocr_chars: res.ocr_chars || 0,
    fallback_reason: res.fallback_reason ?? null,
    slips: (res.slips || []).length,
    lines,
    legible: lines.filter(l => l.legible).length,
    total: lines.length,
  };
}

// RUN THE BENCH. Structured, so a route can return it and a script can print it.
//
// `runs > 1` is the point of the exercise, not a convenience: the parse call sets no
// temperature, so the SAME image can return different answers and one scan proves
// nothing. Two runs of one image tell you more than one run of two.
async function runEval({ ids = [], latest = 0, station = null, runs = 1 } = {}) {
  const rows = await loadArtifacts({ ids, latest, station });
  // Serials actually configured at the outlets, so a returned serial is scored against
  // the database rather than against anybody's opinion of the photograph.
  const { rows: known } = await pool.query(
    `SELECT DISTINCT upper(btrim(serial)) AS serial FROM pumps
      WHERE serial IS NOT NULL AND end_date IS NULL`);
  const knownSerials = new Set(known.map(k => k.serial));

  const out = {
    vision_key: !!process.env.GOOGLE_VISION_API_KEY,
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    images: rows.length, runs, artifacts: [],
  };

  for (const art of rows) {
    const entry = { id: art.id, outlet: art.outlet, captured_at: art.captured_at, runs: [] };
    // Fetched ONCE per artifact, not once per run, so `runs` measures the reader's
    // variance and not the network's.
    let img = null;
    try { img = await artifacts.getImage(art.id); } catch { img = null; }
    if (!img?.file_base64) {
      entry.skipped = 'image could not be fetched';
      out.artifacts.push(entry);
      continue;
    }
    for (let r = 1; r <= runs; r++) {
      const t0 = Date.now();
      let res = null, threw = null;
      try {
        res = await parseCompositeSlips({
          file_base64: img.file_base64,
          media_type: img.media_type || art.media_type || 'image/jpeg',
        });
      } catch (e) { threw = e?.message || String(e); }
      const sum = summarise(res);
      entry.runs.push({
        ...sum, ms: Date.now() - t0, threw,
        // THE NUMBER THAT MATTERS. A line whose serial names no real pump is a line
        // that will be dropped in production — Nagole, 20-Aug: 0 of 28.
        serial_hits: sum.lines.filter(l => knownSerials.has(String(l.serial || '').toUpperCase())).length,
      });
    }
    out.artifacts.push(entry);
  }
  return out;
}

module.exports = { runEval, loadArtifacts, summarise };
