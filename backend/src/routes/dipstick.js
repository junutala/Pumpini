// src/routes/dipstick.js
const router = require('express').Router();
const { readImageAsJson } = require('../services/visionOcr');
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireStationAccess } = require('../middleware/stationAccess');
const { dipToVolume } = require('../lib/calibration');
const artifacts = require('../services/artifactService');
const openings = require('../services/openingService');
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Does dipstick_readings.artifact_id exist yet? Owner-run DDL means this code
// deploys first, so the column is named only once it is there. Probed against the
// catalog rather than discovered by a failing INSERT — see CLAUDE.md.
let _hasArtifactCol = false;
async function hasArtifactCol() {
  if (_hasArtifactCol) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dipstick_readings'
          AND column_name='artifact_id' LIMIT 1`);
    _hasArtifactCol = rows.length > 0;
  } catch { _hasArtifactCol = false; }
  return _hasArtifactCol;   // a false is re-probed, so no restart is needed after the DDL
}

// POST /api/dipstick
// dip_cm is the TRUE dip (the form converts the mark-ordinal entry first). When
// the tank has a calibration type, volume is computed authoritatively from the
// geometry and the client's volume_ltrs is ignored; otherwise it falls back to
// the manually entered volume (tanks not yet assigned a type).
//
// 🔴 ONE READING PER SHIFT PER TANK PER TYPE. This used to INSERT unconditionally,
// and a shift-start sequence writes twice by construction: the manager types his
// dips before the shift exists, persistDip calls ensureShift(), the server seeds
// the carried opening from the last close — and THEN this route inserted his typed
// figure alongside it. Every tank-shift since 02-Aug-2026 carries exactly two
// opening rows, and where the two disagree the readers disagree too: the stock
// reconciliation takes the NEWEST, deliveries and the settlement ledger take the
// OLDEST, and data-health takes the LARGEST. The same tank-shift therefore reports
// three different opening stocks on three screens. (Highway tank 1: 6,592.56 vs
// 3,475.52 — a 3,117 L difference of opinion about the same morning.)
//
// So the write is now conditional on what already exists, and the two types differ
// deliberately:
//
//   opening — FIRST WRITE WINS. Once an opening exists it is not replaced. When the
//     server has carried it from the last close, that figure IS the control (owner
//     rule 01-Aug-2026: the close is the next open, so no litre can fall in a gap
//     between two shifts) and the shift-start screen renders the tank locked for
//     exactly that reason. A later POST is either the pre-shift typing described
//     above or a client racing itself; neither may overturn the carry. The caller
//     is told, so the screen can show what was kept.
//
//   closing — LAST WRITE WINS, in place. A manager re-shooting the gauge at close
//     is correcting his own reading, and every reader already takes the newest
//     closing, so updating the row preserves today's behaviour exactly while
//     removing the duplicate.
//
// Serialised on an advisory lock over (shift, tank, type) so two concurrent posts
// cannot both find nothing and both insert. A unique index is the proper backstop
// and is owner-run DDL; the lock holds the line until it is applied, and remains
// correct afterwards.
router.post('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { station_id, tank_id, shift_id, reading_type, dip_cm, density, temperature_c,
            artifact_id } = req.body;
    let volume_ltrs = req.body.volume_ltrs;

    // Re-scope tank to the validated station — a tank_id from another outlet
    // must not be writable here even though station_id passed the guard. Also
    // pull its calibration type in the same hop.
    let chart = null;
    if (tank_id) {
      const { rows: tk } = await client.query(
        `SELECT t.capacity_ltrs, t.tank_number, c.diameter_cm, c.length_cm
         FROM tanks t
         LEFT JOIN tank_calibration_charts c ON c.id = t.calibration_chart_id
         WHERE t.id=$1 AND t.station_id=$2`, [tank_id, station_id]);
      if (!tk.length) return res.status(400).json({ error: 'Tank does not belong to this station.' });
      chart = tk[0];
    }

    // Authoritative volume from the dip + tank geometry, when a type is set.
    if (chart && chart.diameter_cm && chart.length_cm && dip_cm != null) {
      const v = dipToVolume(chart.diameter_cm, chart.length_cm, dip_cm);
      if (v != null) volume_ltrs = v;
    }

    // ── A TANK CANNOT HOLD MORE THAN IT HOLDS ────────────────────────────────
    //
    // The installed capacity comes from the MASTER tank record, never from the
    // figure OCR'd off the console. Owner-set 20-Aug-2026, after a gauge scan of
    // Sri Balaji read capacities of 12,650 and 4,000 L for tanks the database
    // records as 16,000 and 9,000 — and returned checks_ok: true on all three,
    // because both existing checks are null-guarded and the console's ullage was
    // unreadable, so neither ever ran.
    //
    // A misread volume is not off by a percent, it is off by a decimal place or a
    // whole digit. Nothing else in this write stops 145,000 litres being recorded
    // against a 16,000 litre tank, and that figure would then BE the stock — the
    // number every variance, every loss and every reconciliation is measured from.
    //
    // The tolerance is not zero because nominal capacity is not a physical ceiling:
    // a tank filled to its nameplate can gauge a little over on a warm afternoon,
    // and refusing a manager at 6am over 0.4% would be the wrong trade. It is small
    // enough that no digit error survives it.
    const CAPACITY_TOLERANCE = 1.02;
    if (chart && chart.capacity_ltrs != null && volume_ltrs != null) {
      const cap = Number(chart.capacity_ltrs);
      const vol = Number(volume_ltrs);
      if (Number.isFinite(cap) && cap > 0 && Number.isFinite(vol) && vol > cap * CAPACITY_TOLERANCE) {
        return res.status(400).json({
          error: `That reading is ${Math.round(vol).toLocaleString('en-IN')} L for a tank installed at `
               + `${Math.round(cap).toLocaleString('en-IN')} L. A tank cannot hold more than its capacity — `
               + `re-read the gauge, or correct the capacity in Settings if the tank was changed.`,
          volume_ltrs: vol, capacity_ltrs: cap, tank_number: chart.tank_number,
        });
      }
    }

    // artifact_id links this figure back to the gauge-screen photograph it was read
    // off, so a number on the stock reconciliation can always be traced to a picture.
    // A manually dipped tank simply has none — it is optional by design, and the
    // column is only named once the migration has been applied. Probed against the
    // catalog BEFORE the transaction opens: a failed statement inside one aborts it.
    const withArtifact = !!artifact_id && await hasArtifactCol();

    await client.query('BEGIN');
    // int4 pair, so the lock is specific to this shift+tank and this type.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [`${shift_id}:${tank_id}`, String(reading_type || '')]);

    const { rows: existing } = await client.query(
      `SELECT * FROM dipstick_readings
        WHERE shift_id=$1 AND tank_id=$2 AND reading_type=$3
        ORDER BY recorded_at ASC LIMIT 1`, [shift_id, tank_id, reading_type]);

    let row, kept = false;
    if (existing.length && reading_type === 'opening') {
      // Already carried or already entered. Keep it, write nothing.
      row = existing[0];
      kept = true;
    } else if (existing.length) {
      const sets = ['dip_cm=$1','volume_ltrs=$2','density=$3','temperature_c=$4','recorded_by=$5','recorded_at=NOW()'];
      const vals = [dip_cm, volume_ltrs, density, temperature_c, req.user.id];
      if (withArtifact) { vals.push(artifact_id); sets.push(`artifact_id=$${vals.length}`); }
      vals.push(existing[0].id);
      const { rows } = await client.query(
        `UPDATE dipstick_readings SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
      row = rows[0];
    } else {
      const cols = ['station_id','tank_id','shift_id','reading_type','dip_cm','volume_ltrs','density','temperature_c','recorded_by'];
      const vals = [station_id, tank_id, shift_id, reading_type, dip_cm, volume_ltrs, density, temperature_c, req.user.id];
      if (withArtifact) { cols.push('artifact_id'); vals.push(artifact_id); }
      const { rows } = await client.query(
        `INSERT INTO dipstick_readings(${cols.join(',')})
         VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        vals
      );
      row = rows[0];
    }

    // Update tank current stock (station-scoped as a belt-and-suspenders guard).
    // From the row that SURVIVED, never from a figure that was refused — otherwise
    // a rejected opening would still move the tank.
    await client.query('UPDATE tanks SET current_stock=$1, density=$2 WHERE id=$3 AND station_id=$4',
      [row.volume_ltrs, row.density, tank_id, station_id]);

    await client.query('COMMIT');

    // The other half of the carry-forward rule. A night handover opens tomorrow
    // before it closes today, so at open time there was nothing to carry and the
    // next shift's opening was deliberately left empty. It exists now — fill it.
    //
    // AFTER the commit, on the pool, deliberately. The back-fill is best-effort and
    // swallows its own errors; run inside the transaction above, a swallowed failure
    // would still have ABORTED it, and the COMMIT would then take the closing
    // reading down with it (CLAUDE.md — a failed statement poisons the whole
    // transaction, which is why we never rely on catching inside one). Out here the
    // closing is already durable and a back-fill that cannot run costs nothing but
    // an empty opening the next screen asks for.
    if (reading_type === 'closing') {
      await openings.backfillOpeningFromClose({ station_id, tank_id, shift_id });
    }

    res.status(kept ? 200 : 201).json({ ...row, kept_existing: kept });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    next(err);
  } finally { client.release(); }
});

// GET /api/dipstick?tank_id=&date_from=&date_to=
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { tank_id, shift_id, station_id } = req.query;
    let q = `
      SELECT dr.*, t.tank_number, t.fuel_type, u.name AS recorded_by_name
      FROM dipstick_readings dr
      JOIN tanks t ON t.id = dr.tank_id
      JOIN users u ON u.id = dr.recorded_by
      WHERE 1=1
    `;
    const p = [];
    if (station_id) { p.push(station_id); q += ` AND dr.station_id=$${p.length}`; }
    if (tank_id)    { p.push(tank_id);    q += ` AND dr.tank_id=$${p.length}`; }
    if (shift_id)   { p.push(shift_id);   q += ` AND dr.shift_id=$${p.length}`; }
    q += ' ORDER BY dr.recorded_at DESC';

    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Density register ──────────────────────────────────────────────
// The OMC compliance ritual: every density observation (shift-dip checks +
// tanker decants) in one dated register, corrected to 15°C and checked against
// the normal band for the fuel and the last delivery's invoice density.
const DENSITY_BANDS = {            // kg/L at 15°C — keep in sync with ai-chat.js
  petrol:         [0.720, 0.775],
  premium_petrol: [0.720, 0.775],
  diesel:         [0.820, 0.860],
};
const HYDROMETER_CORRECTION = 0.00065; // kg/L per °C (Indian RO field practice)
const INVOICE_TOLERANCE     = 0.0030;  // ±3.0 kg/m³ vs delivery invoice density

// GET /api/dipstick/density-register?station_id=&date_from=&date_to=
router.get('/density-register', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    const dateTo   = req.query.date_to   || new Date().toISOString().slice(0, 10);
    const dateFrom = req.query.date_from ||
      new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);

    const [dips, decants] = await Promise.all([
      pool.query(
        `SELECT dr.id, dr.recorded_at AS observed_at, 'dip' AS source, dr.reading_type,
                t.tank_number, t.fuel_type, dr.density, dr.temperature_c,
                u.name AS recorded_by_name,
                ld.density AS reference_density, ld.dc_number AS reference_challan
         FROM dipstick_readings dr
         JOIN tanks t ON t.id = dr.tank_id
         LEFT JOIN users u ON u.id = dr.recorded_by
         LEFT JOIN LATERAL (
           SELECT fd.density, fd.dc_number
           FROM fuel_deliveries fd
           WHERE fd.tank_id = dr.tank_id AND fd.density IS NOT NULL
             AND fd.received_at <= dr.recorded_at
           ORDER BY fd.received_at DESC LIMIT 1
         ) ld ON TRUE
         WHERE dr.station_id = $1 AND dr.density IS NOT NULL
           AND dr.recorded_at >= $2::date
           AND dr.recorded_at <  $3::date + INTERVAL '1 day'`,
        [station_id, dateFrom, dateTo]
      ),
      pool.query(
        `SELECT fd.id, fd.received_at AS observed_at, 'delivery' AS source,
                NULL AS reading_type, t.tank_number, t.fuel_type, fd.density,
                NULL::numeric AS temperature_c, u.name AS recorded_by_name,
                fd.dc_number AS challan_number
         FROM fuel_deliveries fd
         JOIN tanks t ON t.id = fd.tank_id
         LEFT JOIN users u ON u.id = fd.received_by
         WHERE fd.station_id = $1 AND fd.density IS NOT NULL
           AND fd.received_at >= $2::date
           AND fd.received_at <  $3::date + INTERVAL '1 day'`,
        [station_id, dateFrom, dateTo]
      ),
    ]);

    const rows = [...dips.rows, ...decants.rows]
      .sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at))
      .map(r => {
        const obs  = parseFloat(r.density);
        const temp = r.temperature_c != null ? parseFloat(r.temperature_c) : null;
        // Hydrometer reads lighter when warm; challan densities are already @15°C
        const at15 = r.source === 'dip' && temp != null
          ? +(obs + HYDROMETER_CORRECTION * (temp - 15)).toFixed(4)
          : obs;
        const band = DENSITY_BANDS[r.fuel_type] || null;
        const ref  = r.reference_density != null ? parseFloat(r.reference_density) : null;
        const variation = ref != null ? +(at15 - ref).toFixed(4) : null;

        let status = 'ok';
        if (!band) status = 'no_band';                                   // e.g. CNG
        else if (at15 < band[0] || at15 > band[1]) status = 'out_of_band';
        else if (variation != null && Math.abs(variation) > INVOICE_TOLERANCE) status = 'drift';

        return { ...r, density_at_15: at15, variation, status, band };
      });

    res.json({
      rows,
      tolerance: INVOICE_TOLERANCE,
      bands: DENSITY_BANDS,
      summary: {
        total:       rows.length,
        out_of_band: rows.filter(r => r.status === 'out_of_band').length,
        drift:       rows.filter(r => r.status === 'drift').length,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/dipstick/tanks/:station_id  - current stock per tank
router.get('/tanks/:station_id', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
        c.name AS chart_name, c.diameter_cm, c.length_cm,
        lr.volume_ltrs  AS last_reading,
        lr.recorded_at  AS last_reading_at,
        lr.dip_cm       AS last_dip_cm,
        lr.reading_type AS last_reading_type
       FROM tanks t
       LEFT JOIN tank_calibration_charts c ON c.id = t.calibration_chart_id
       LEFT JOIN LATERAL (
         SELECT dr.volume_ltrs, dr.recorded_at, dr.dip_cm, dr.reading_type
         FROM dipstick_readings dr WHERE dr.tank_id = t.id
         ORDER BY dr.recorded_at DESC LIMIT 1
       ) lr ON true
       WHERE t.station_id=$1 ORDER BY t.tank_number`, [req.params.station_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Gauge-screen scan (ATG / Pinelabs tank-status photo) ──────────────
// Reads a photo of the automation console's tank-status screen and returns the
// per-tank figures so the manager doesn't retype them.
//
// NO READING IS SAVED HERE — the rows only PRE-FILL the normal dipstick form,
// which the manager reviews, edits and submits through POST /api/dipstick like
// any manual reading. That matters: IOCL outlets have no such console and take a
// physical dip, so manual entry stays the primary path and this is purely a
// typing accelerator. Mirrors the invoice-scan pattern in routes/deliveries.js.
//
// THE PHOTOGRAPH ITSELF *IS* KEPT (2026-08-01). It used to be parsed and dropped,
// which meant the opening and closing stock — the two figures the whole wet-stock
// reconciliation rests on — had nothing behind them. The endpoint now stores the
// screen and hands back an artifact_id; the form passes that id to POST /dipstick
// on each tank it fills, so every figure points at the picture it came from.
// Storing is best-effort (artifactService swallows its own failures): a scan must
// still work on a database where the migration has not been run.
const GAUGE_OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const GAUGE_PROMPT = `You read an Indian petrol-pump fuel automation console screen (Pinelabs/Dresser Wayne/Gilbarco "TANK STATUS"), photographed off a monitor. It lists several underground tanks with their gauge readings.

Return ONLY a JSON object (no prose, no markdown) of this exact shape:
{
 "customer_code": "dealer/customer code shown in the header, or null",
 "tanks": [{
   "tank_label": "the tank NUMBER as printed (e.g. \\"1\\", \\"3\\", \\"4\\")",
   "product": "petrol|diesel|premium_petrol|cng|null",
   "product_raw": "as printed (MS, HSD, Power, XtraPremium, ...) or null",
   "capacity_ltrs": number or null,
   "dip_mm": number or null,
   "gross_volume_ltrs": number or null,
   "net_volume_ltrs": number or null,
   "water_dip_mm": number or null,
   "water_ltrs": number or null,
   "temperature_c": number or null,
   "ullage_ltrs": number or null,
   "todays_sale_ltrs": number or null,
   "todays_receipt_ltrs": number or null
 }],
 "table_state": "used" | "cropped" | "absent" — see the layout rule below. "used" = a bottom summary table was present and you read from it; "cropped" = a table IS there but its data rows are cut off or unreadable; "absent" = this console has no summary table at all, only tank cards,
 "confidence": "high|medium|low",
 "notes": "anything unclear, glared out, or cut off"
}

Rules:
- product: MS / Motor Spirit / Petrol -> "petrol"; HSD / Diesel -> "diesel"; Power / Speed / XtraPremium / any branded premium -> "premium_petrol"; CNG -> "cng". Keep the printed text in product_raw either way.
- DIP IS IN MILLIMETRES on these consoles (e.g. 766.30, 1540.80). Report it as printed in dip_mm — do NOT convert to cm.
- 🔴 TWO CONSOLE LAYOUTS EXIST. Decide which you are looking at, and report it in table_state.
  * HPCL-style: graphical tank cards on top AND a plain summary table below them (TANK | PRODUCT | VOLUME | DIP | CAPACITY). Read from the TABLE — set table_state "used".
  * IOCL-style: tank cards ONLY, no summary table anywhere. Each card is a labelled list — "1 - Motor Spirit", then Fuel Height, Temperature, Net Volume, Water Height, Ullage, Water Volume, Density, Gross Volume, Today's Sale, MTD Sale. This layout is perfectly readable: the labels sit beside their values, so read the cards and set table_state "absent". Do NOT refuse an IOCL console for lacking a table it never had.
  * CROPPED: a table IS present but its data rows are cut off or illegible (a header row alone counts as cropped). Set table_state "cropped", return every numeric field null, and say so in notes — do NOT fall back to the cards in this case. That is the 20-Aug-2026 failure: a photograph of a phone showing an HPCL console, table cut to its header, read off the glare-lit cards and returned tank numbers 1/2/3 for an outlet whose tanks are 1/3/4 and capacities of 12,650 and 4,000 L against 16,000 and 9,000 installed. When a table exists, it is the truth and a cropped one is a re-take, not a guess.

- IOCL FIELD NAMES map to ours as: "Fuel Height" -> dip_mm, "Net Volume" -> net_volume_ltrs, "Gross Volume" -> gross_volume_ltrs, "Water Height" -> water_dip_mm, "Water Volume" -> water_ltrs, "Ullage" -> ullage_ltrs, "Temperature" -> temperature_c, "Today's Sale" -> todays_sale_ltrs. The card heading "2 - High Speed Diesel" carries BOTH the tank number (2) and the product (High Speed Diesel = diesel); "Motor Spirit" = petrol. This console prints no capacity — leave capacity_ltrs null rather than deriving it.

- ANCHOR ON THE SUMMARY TABLE AT THE BOTTOM. These screens show the same tanks TWICE: graphical cards on top, and below them a plain table with column headers (typically TANK | PRODUCT | VOLUME (Ltr.) | DIP (MM.) | CAPACITY (Ltr.)). The table is labelled, tabular and free of the cards' glare-prone artwork, so it is the RELIABLE source. Read tank_label, product, net_volume_ltrs, dip_mm and capacity_ltrs FROM THE TABLE. Use the cards only to (a) supply the fields the table does not carry — water, temperature, ullage, today's sale/receipt — and (b) cross-check the table. They are the SAME tanks: return ONE entry per tank, never one per view. If a figure differs between the two, TRUST THE TABLE and say so in notes.
- The table's VOLUME column is the NET volume (it matches the card's "Net Volume", not "Gross Volume"). Put it in net_volume_ltrs.
- capacity_ltrs from the table matters — we use it to identify which of OUR tanks a row belongs to. Read it carefully.
- Volumes are litres, temperature is Celsius, water dip is millimetres.
- ARITHMETIC CROSS-CHECK: gross_volume_ltrs - net_volume_ltrs should approximately equal water_ltrs, and net_volume_ltrs + ullage_ltrs should approximately equal capacity_ltrs. If either is badly off you have misread a digit — re-read that tank's block before answering.
- This is a photo of a screen: glare bands, moire and a skewed angle are expected. If a digit is genuinely unreadable use null and say which field in notes. NEVER guess a digit.
- One entry per tank shown. If a tank reads all zeros or "Idle" that is legitimate — report the zeros.`;

// Advisory arithmetic check per tank, so the form can flag a suspect row instead
// of silently trusting a misread digit. Never blocks; just annotates.
function withGaugeChecks(parsed) {
  try {
    const tanks = Array.isArray(parsed.tanks) ? parsed.tanks : [];
    parsed.tanks = tanks.map(t => {
      const num = v => (v == null ? null : Number(v));
      const gross = num(t.gross_volume_ltrs), net = num(t.net_volume_ltrs);
      const water = num(t.water_ltrs), ull = num(t.ullage_ltrs), cap = num(t.capacity_ltrs);
      const checks = [];
      // Water accounts for the gross/net gap (tolerate 1 L of rounding).
      if (gross != null && net != null && water != null && Math.abs((gross - net) - water) > 1) {
        checks.push('gross − net does not match water');
      }
      // Net + ullage should fill the tank (tolerate 1% — ullage is a coarse figure).
      if (net != null && ull != null && cap && Math.abs((net + ull) - cap) > cap * 0.01) {
        checks.push('net + ullage does not match capacity');
      }
      return { ...t, checks, checks_ok: checks.length === 0 };
    });
  } catch { /* noop */ }
  return parsed;
}

// A console lists several TANKS down one screen, and OCR flattens that into a run of
// numbers. Naming the shape stops two tanks' figures being merged into one.
const GAUGE_OCR_PREAMBLE = `Below is text extracted from a PHOTOGRAPH of the gauge console
screen by an OCR engine. The layout may be imperfect: lines can arrive out of order and
columns can be flattened. The screen lists SEVERAL TANKS, each with its own block of
figures — keep every figure with the tank whose block it is printed in, and never merge
two tanks' readings. Use the printed LABELS to decide what each figure is, never position
on the page.

OCR text:

`;

router.post('/parse-gauge', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { file_base64, media_type, shift_id, reading_type } = req.body;
    if (!file_base64 || !media_type) return res.status(400).json({ error: 'file_base64 and media_type are required' });
    if (!GAUGE_OK_TYPES.includes(media_type)) return res.status(400).json({ error: 'Upload a photo (JPG/PNG) of the gauge screen.' });

    // Google Vision first, Claude on the text — the same pipeline as invoices and
    // slips. A gauge console is a backlit LCD photographed at an angle, which is the
    // hardest thing we ask a vision model to read: on 18-Aug-2026 a single glared
    // frame of this screen produced three confident and entirely false findings about
    // Sri Balaji's fuel types and tank capacities. Falls back to the direct vision
    // call, so a missing key or a failed OCR behaves exactly as before.
    const read = await readImageAsJson({
      file_base64, media_type, prompt: GAUGE_PROMPT, max_tokens: 3000,
      ocrPreamble: GAUGE_OCR_PREAMBLE,
    });
    if (read.error === 'api') {
      return res.status(503).json({ error: 'Screen scanning is unavailable right now — enter the reading manually.' });
    }
    const parsed = read.parsed;
    if (!parsed) {
      return res.status(422).json({ error: 'Could not read the screen — enter the reading manually.' });
    }
    if (!Array.isArray(parsed.tanks)) parsed.tanks = [];
    // Which engine read this screen, kept on the artifact for the same reason it is
    // kept on a slip: so a question about a figure is answered by the row rather
    // than by inference. A gauge screen is the hardest read we do, which makes it
    // the one most worth being able to explain afterwards.
    // THE TABLE IS THE SOURCE. Without its rows the reader has only the glare-prone
    // cards, and that is precisely what produced tank numbers 1/2/3 for an outlet
    // numbered 1/3/4 on 20-Aug. Refuse rather than hand back numbers sourced from
    // artwork — the manager re-takes the photograph with the table in frame.
    // Refuse ONLY a table that exists and was cut off. An IOCL console has no
    // summary table at all and is perfectly readable from its cards — the rule
    // shipped on 20-Aug made the table mandatory outright and would have refused
    // every IOCL outlet, Kamala included, for lacking something it never had.
    if (parsed.table_state === 'cropped') {
      return res.status(422).json({
        error: 'The summary table at the bottom of the console screen was cut off in that photo. '
             + 'Re-take it with the whole table in frame — the tank numbers and volumes are read from there, '
             + 'not from the coloured tank pictures.',
        table_state: 'cropped',
        notes: String(parsed.notes ?? ''),
      });
    }

    const out = { ...withGaugeChecks(parsed), engine: read.engine ?? null, ocr_chars: read.ocr_chars ?? null,
                  table_state: parsed.table_state ?? null };

    // Keep the screen. A gauge screen photographed inside a shift hangs off that
    // shift; one taken for the plain dip register belongs to the outlet.
    const artifact = await artifacts.save({
      station_id: req.body.station_id,
      entity_type: shift_id ? 'shift' : 'station',
      entity_id: shift_id || null,
      kind: 'gauge_screen',
      file_base64, media_type,
      ocr: out,
      meta: { reading_type: reading_type || null },
      uploaded_by: req.user.id,
    });

    res.json({ ...out, artifact_id: artifact ? artifact.id : null });
  } catch (err) { next(err); }
});

module.exports = router;
