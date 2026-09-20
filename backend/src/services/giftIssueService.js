// src/services/giftIssueService.js
//
// THE one writer for a gift issue — the act at the pump.
//
// ── THE SESSION IS A DRAFT ROW, NOT A TABLE ──────────────────────────────────
//
// Opening the screen creates a `gift_issues` row with status='draft' and a
// server-held `expires_at`. Everything captured afterwards updates that row, and
// settling flips it to 'issued' or 'not_issued'.
//
// Server-held is the point. A twenty-minute limit counted in the browser is
// counted by a clock the attendant owns, which is the one thing the session
// exists to stop being true. It is twenty minutes because that is roughly how
// long a truck takes to fill, which is where the number came from.
//
// A draft that expires is NOT deleted. Its captures stay, and an abandoned
// session is simply an expired draft — which also makes the abandon rate a
// number the report can read, and the leading indicator that the flow is too
// slow for the forecourt.
//
// ── WHAT THE DATABASE ENFORCES, NOT THIS FILE ────────────────────────────────
//
//   uq_gi_vehicle_tier        one gift per vehicle per tier, partial on
//                             status='issued' — which is ALSO why an
//                             out-of-stock refusal leaves the entitlement
//                             intact for the driver's next visit
//   uq_gi_slip                one slip, one gift; partial on bill_no IS NOT
//                             NULL, so the manual path (no bill number) simply
//                             falls outside it rather than needing a branch
//   gi_manual_needs_handover  a TYPED plate cannot be saved without the
//                             handover photograph
//
// None of those is re-checked here. A rule a service checks is a rule some
// future caller forgets.
const pool = require('../db/pool');
const campaigns = require('./campaignService');
const stock = require('./stockService');
const artifacts = require('./artifactService');
const { readImageAsJson } = require('./visionOcr');

const SESSION_MINUTES = 20;
const MAX_PLATE_TRIES = 4;

function badRequest(message, extra) {
  const e = new Error(message); e.status = 400;
  if (extra) Object.assign(e, extra);
  return e;
}
function notFound(m) { const e = new Error(m); e.status = 404; return e; }

// 🔴 ONE NORMALISED VEHICLE KEY, OR THE DEDUP LEAKS.
//
// `TS 05 FQ 0975`, `ts05fq0975` and `TS-05-FQ-0975` are one car, and
// uq_gi_vehicle_tier compares strings. Normalising at the ONE door every plate
// comes through is what makes the index mean what it says. It does not fix a
// transposed digit and nothing cheap does — which is why the plate is read from
// a photograph rather than typed wherever the camera can manage it.
const normPlate = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Indian plates: the state series (TS05FQ0975) and the BH series (22BH1234AA),
// which does NOT fit the state-code shape and is why this is two patterns.
const PLATE_RE = [
  /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/,   // TS05FQ0975, DL8CAF1234
  /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/,           // 22BH1234AA
];
const plateLooksReal = p => PLATE_RE.some(re => re.test(p));

const PLATE_PROMPT = `This photograph shows the NUMBER PLATE of a vehicle at an Indian petrol pump.

Return ONLY a JSON object, no prose:
{ "plate": "the registration as printed, or null",
  "legible": true|false,
  "confidence": "high|medium|low",
  "notes": "what is unclear, if anything" }

Rules:
- Return the characters EXACTLY as they appear, without spaces or dashes: "TS 05 FQ 0975" -> "TS05FQ0975".
- Indian plates are usually a state code, a district number, a letter series and four digits (TS05FQ0975, DL8CAF1234). The newer BH series looks different: 22BH1234AA. Both are valid — do not "correct" one towards the other.
- 🔴 O AND 0, I AND 1, S AND 5, B AND 8 are the confusions that matter. If you cannot tell which, set legible=false and say which character in notes. NEVER guess a character: a wrong plate gives one man's gift to another and is worse than no reading at all, because a blank gets retaken and a plausible mistake does not.
- If the plate is partly out of frame, blurred, mud-covered, in glare, or you can read only some characters, set legible=false. Reading "most of it" is not reading it.
- A commercial vehicle often carries the number painted on the body as well. Read the PLATE, not the painted text, unless the plate is absent entirely — say so in notes if you used painted text.`;

// ── THE OUTLET'S CAPTURE RULE ────────────────────────────────────────────────
//
// TRUE  = the nozzle sales slip must be scanned; litres come off the dispenser.
// FALSE = the manager may type the fuel and litres, accepting that the quantity
//         is unverified.
//
// Internal and per outlet, deliberately not on the dealer's Settings screen: it
// is our judgement about an outlet's capture discipline, not a switch he flips
// on a busy evening. Probed, because it deploys before the DDL.
let ocrColPresent = null;
async function slipOcrRequired(station_id, client = pool) {
  if (ocrColPresent === null) {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='station_settings'
          AND column_name='gift_slip_ocr_required' LIMIT 1`);
    ocrColPresent = rows.length > 0;
  }
  if (!ocrColPresent) return true;                 // strict until told otherwise
  const { rows } = await client.query(
    `SELECT COALESCE(gift_slip_ocr_required, TRUE) AS req
       FROM station_settings WHERE station_id=$1`, [station_id]);
  return rows.length ? rows[0].req === true : true;
}

// The campaign this outlet is running today, if any. Date-bounded in Asia/Kolkata
// because a campaign's dates are the owner's dates, not UTC's.
async function runningCampaign({ station_id }) {
  const { rows } = await pool.query(
    `SELECT * FROM gift_campaigns
      WHERE station_id=$1 AND status='running'
        AND start_date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        AND end_date   >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY start_date DESC LIMIT 1`, [station_id]);
  return rows[0] || null;
}

// Is the clock inside the campaign's operating hours? NULL hours = all day.
function withinHours(c, at = new Date()) {
  if (!c?.hours_from || !c?.hours_to) return true;
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
  return hhmm >= String(c.hours_from).slice(0, 5) && hhmm <= String(c.hours_to).slice(0, 5);
}

async function openSession({ station_id, user_id }) {
  const c = await runningCampaign({ station_id });
  if (!c) throw badRequest('No campaign is running at this outlet today.');
  if (!withinHours(c)) {
    throw badRequest(
      `${c.name} runs between ${String(c.hours_from).slice(0,5)} and ${String(c.hours_to).slice(0,5)}.`,
      { code: 'outside_hours' });
  }
  const { rows } = await pool.query(
    `INSERT INTO gift_issues (station_id, campaign_id, status, expires_at, issued_by)
     VALUES($1,$2,'draft', NOW() + ($3 || ' minutes')::interval, $4) RETURNING *`,
    [station_id, c.id, String(SESSION_MINUTES), user_id || null]);
  return { ...rows[0], campaign: c, slip_ocr_required: await slipOcrRequired(station_id) };
}

// Load a draft and refuse a dead one. Expiry is read from the ROW, never from a
// clock the caller sends.
async function loadDraft({ id, station_id }, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM gift_issues WHERE id=$1 AND station_id=$2 FOR UPDATE`, [id, station_id]);
  if (!rows.length) throw notFound('That gift session no longer exists.');
  const g = rows[0];
  if (g.status !== 'draft') throw badRequest('This gift has already been settled.', { code: 'already_settled' });
  if (g.expires_at && new Date(g.expires_at) < new Date()) {
    throw badRequest('That session has expired. Start a new one — what you captured is kept.',
      { code: 'session_expired' });
  }
  return g;
}

// ── STEP 1: the fill ─────────────────────────────────────────────────────────
//
// Two doors, one writer. The SCANNED door will carry the parsed slip fields once
// the sample tells us what the receipt prints; the TYPED door is open only where
// the outlet's switch allows it, and records nothing it has not been given —
// notably no bill number, which is why uq_gi_slip is partial on bill_no.
async function setFill({ id, station_id, fuel_type, litres, bill_no, slip_date,
                         slip_pump_serial, slip_printed_at, slip_image, media_type, user_id }) {
  const qty = Number(litres);
  if (!campaigns.FUELS.includes(fuel_type)) throw badRequest('Choose the fuel that was filled.');
  if (!Number.isFinite(qty) || qty <= 0)    throw badRequest('Enter the litres dispensed.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await loadDraft({ id, station_id }, client);

    const required = await slipOcrRequired(station_id, client);
    if (required && !bill_no && !slip_image) {
      throw badRequest('This outlet requires the nozzle sales slip to be scanned.',
        { code: 'slip_required' });
    }

    let artifact_id = null;
    if (slip_image && media_type) {
      const a = await artifacts.save({
        station_id, entity_type: 'gift_issue', entity_id: id, kind: 'gift_slip',
        file_base64: slip_image, media_type, uploaded_by: user_id || null,
      }, client);
      artifact_id = a?.id || null;
    }

    const { rows } = await client.query(
      `UPDATE gift_issues SET
         fuel_type=$1, litres=$2, bill_no=$3, slip_date=$4,
         slip_pump_serial=$5, slip_printed_at=$6,
         slip_artifact_id=COALESCE($7, slip_artifact_id)
       WHERE id=$8 RETURNING *`,
      [fuel_type, qty, bill_no || null, slip_date || null,
       slip_pump_serial || null, slip_printed_at || null, artifact_id, id]);

    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    // uq_gi_slip — this receipt has already earned a gift.
    if (e.code === '23505') throw badRequest('That slip has already been used for a gift.', { code: 'slip_used' });
    throw e;
  } finally { client.release(); }
}

// ── STEP 2: the plate ────────────────────────────────────────────────────────
//
// Read, never typed, wherever the camera can manage it. The reading is returned
// for the screen to show; it is only WRITTEN by setPlate below, so a failed read
// cannot half-fill the row.
async function readPlate({ file_base64, media_type }) {
  if (!file_base64 || !media_type) throw badRequest('Photograph the number plate.');
  const out = await readImageAsJson({ file_base64, media_type, prompt: PLATE_PROMPT });
  const plate = normPlate(out?.plate);
  const ok = out?.legible === true && plate && plateLooksReal(plate);
  return {
    plate: ok ? plate : null,
    legible: ok,
    confidence: out?.confidence || null,
    // A plate that READS but does not look like a registration is reported as
    // unreadable rather than accepted: "most of it" is not a plate.
    notes: ok ? (out?.notes || null)
              : (out?.notes || (plate && !plateLooksReal(plate)
                  ? `Read "${plate}", which is not shaped like a registration.` : null)),
  };
}

async function setPlate({ id, station_id, vehicle_number, plate_source, plate_image, media_type, user_id }) {
  const plate = normPlate(vehicle_number);
  if (!plate) throw badRequest('The number plate could not be recorded.');
  if (!['ocr', 'manual'].includes(plate_source)) throw badRequest('Unknown plate source.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await loadDraft({ id, station_id }, client);

    let artifact_id = null;
    if (plate_image && media_type) {
      const a = await artifacts.save({
        station_id, entity_type: 'gift_issue', entity_id: id, kind: 'gift_plate',
        file_base64: plate_image, media_type, uploaded_by: user_id || null,
        ocr: { plate, source: plate_source },
      }, client);
      artifact_id = a?.id || null;
    }

    const { rows } = await client.query(
      `UPDATE gift_issues SET
         vehicle_number=$1, plate_source=$2,
         plate_artifact_id=COALESCE($3, plate_artifact_id)
       WHERE id=$4 RETURNING *`,
      [plate, plate_source, artifact_id, id]);

    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── WHAT THIS FILL EARNS ─────────────────────────────────────────────────────
//
// The tier, plus whether this vehicle has already had it. The second half is
// advisory ONLY — it is shown so the manager is not surprised, and the unique
// index is what actually decides, at the moment of the write, which is the only
// moment that cannot be raced.
async function preview({ id, station_id }) {
  const { rows } = await pool.query(
    `SELECT * FROM gift_issues WHERE id=$1 AND station_id=$2`, [id, station_id]);
  if (!rows.length) throw notFound('That gift session no longer exists.');
  const g = rows[0];
  if (!g.fuel_type || !g.litres) return { tier: null, reason: 'no_fill' };

  const tier = await campaigns.eligibleTier({
    campaign_id: g.campaign_id, fuel_type: g.fuel_type, litres: g.litres });
  if (!tier) return { tier: null, reason: 'below_lowest_tier' };

  let already = false;
  if (g.vehicle_number) {
    const { rows: prev } = await pool.query(
      `SELECT 1 FROM gift_issues
        WHERE campaign_id=$1 AND vehicle_number=$2 AND tier_id=$3 AND status='issued'
        LIMIT 1`, [g.campaign_id, g.vehicle_number, tier.id]);
    already = prev.length > 0;
  }
  return { tier, already, issue: g };
}

// ── SETTLE ───────────────────────────────────────────────────────────────────
//
// Issued, or not issued with a reason. Both write the row and both keep the
// evidence — a refusal nobody can check is worth nothing, and "out of stock"
// that leaves no trace is how a stock shortfall stays invisible.
async function settle({ id, station_id, status, reason, reason_note,
                        handover_image, media_type, promo_consent, user_id }) {
  if (!['issued', 'not_issued'].includes(status)) throw badRequest('Unknown outcome.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await loadDraft({ id, station_id }, client);

    let handover_id = null;
    if (handover_image && media_type) {
      const a = await artifacts.save({
        station_id, entity_type: 'gift_issue', entity_id: id, kind: 'gift_handover',
        file_base64: handover_image, media_type, uploaded_by: user_id || null,
        meta: { promo_consent: promo_consent === true },
      }, client);
      handover_id = a?.id || null;
    }

    let tier_id = null, product_id = null, quantity = null;

    if (status === 'issued') {
      if (!g.vehicle_number) throw badRequest('Photograph the number plate before issuing.');
      const tier = await campaigns.eligibleTier({
        campaign_id: g.campaign_id, fuel_type: g.fuel_type, litres: g.litres });
      if (!tier) throw badRequest('This fill does not reach any tier.', { code: 'no_tier' });

      // Takes the stock, inside this transaction: the gift row and the decrement
      // are one act or neither happened.
      await stock.consumeFromGift(
        { station_id, product_id: tier.product_id, quantity: tier.quantity }, client);

      tier_id = tier.id; product_id = tier.product_id; quantity = tier.quantity;
    }

    const { rows } = await client.query(
      `UPDATE gift_issues SET
         status=$1, tier_id=$2, product_id=$3, quantity=$4,
         reason=$5, reason_note=$6,
         handover_artifact_id=COALESCE($7, handover_artifact_id),
         promo_consent=$8, settled_at=NOW(), issued_by=COALESCE(issued_by,$9)
       WHERE id=$10 RETURNING *`,
      [status, tier_id, product_id, quantity,
       status === 'not_issued' ? (reason || 'other') : null,
       reason_note || null, handover_id, promo_consent === true, user_id || null, id]);

    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    // uq_gi_vehicle_tier — this vehicle has already had this tier. Said plainly,
    // because to the manager it is not an error, it is the answer.
    if (e.code === '23505') {
      throw badRequest('This vehicle has already received this tier in this campaign.',
        { code: 'already_awarded' });
    }
    // gi_manual_needs_handover — a typed plate without its photograph.
    if (e.code === '23514' && /manual_needs_handover/.test(e.constraint || '')) {
      throw badRequest('A typed plate needs the handover photograph before the gift can be issued.',
        { code: 'handover_required' });
    }
    throw e;
  } finally { client.release(); }
}

module.exports = {
  SESSION_MINUTES,
  MAX_PLATE_TRIES,
  normPlate,
  plateLooksReal,
  slipOcrRequired,
  runningCampaign,
  withinHours,
  openSession,
  setFill,
  readPlate,
  setPlate,
  preview,
  settle,
};
