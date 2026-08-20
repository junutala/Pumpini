// src/services/slipParser.js
//
// THE one reader of a printed dispenser slip. Two callers, two trust boundaries,
// one parser (CLAUDE.md rule 3):
//
//   POST /api/reconcile/parse-slip          — during a shift, to fill meters.
//                                             Resolves the lines to OUR nozzles.
//   POST /api/stations/:id/parse-pump-slip  — during setup, to identify a machine.
//                                             Wants the serial and model, nothing else.
//
// The setup caller has no shift, which is why it cannot reuse the reconcile route:
// that one is guarded on shift_id and scopes everything to the shift's station.
// Same prompt, same normalisation, different guard — never a second prompt, or the
// two would drift and a slip would read differently depending on which screen the
// manager happened to be on.
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { visionOcr, usable } = require('./visionOcr');

// SHARED RULE TEXT — the parts of the prompt that describe HOW to read a slip, factored
// out so the single-slip and composite prompts cannot drift. SLIP_PROMPT below is rebuilt
// from these constants and its final string is character-for-character identical to the
// original (see the composite prompt for the multi-slip framing that reuses the same rules).
const LAYOUTS_BLOCK = `Known layouts — detect which, and if it is NONE of them still apply the rules below:
- Layout A (IndianOil): header has "FP. ID : <n>" and "Pump SNo : <serial>", then Date/Time; each "Nozzle No1 / No2 …" block has Shif1/2/3Sale+Vol, ShDaySale/Vol, ShMTHSale/Vol and finally "CumVolume:" (litres) plus "CumSale:" (rupees). Use **CumVolume** — NOT ShDayVol, NOT ShMTHVol, which are period figures that reset. FP. ID is the pump id; Pump SNo is the serial.
- Layout B (HPCL "Electronic Totalizer"): an "Electronic Totalizer :" block per nozzle, each with "FIP No. : 0X", sometimes "Nozzle No. : 0X", "Atot" (rupees), "Vtot" (litres) and "DU SERIAL NO: <serial>". Use Vtot as the nozzle's cumulative volume, and DU SERIAL NO as pump_serial. ONE strip often carries SEVERAL of these blocks — one per nozzle of the same dispensing unit, all sharing the same DU SERIAL NO. Report every block as its own nozzle. Where a block prints FIP No. but NO "Nozzle No.", use the FIP No. as that block's nozzle_no, because on this layout it is what distinguishes one nozzle from the next. Figures are zero-padded ("00001488875.27") — drop the leading zeros, keep the decimal.
- Layout C (HPCL/IOCL "ETOT-MAIN"): header carries PUMP SERIAL NUMBER and MODEL, then "---: ETOT-MAIN :---" and one block per nozzle reading "NOZZLE : 1" followed by "A:<number>", "V:<number>" and "TOT SALES:<number>". Here **V is the VOLUME in litres and is the figure we want**; A is the cumulative AMOUNT in rupees and TOT SALES is a COUNT of transactions. Use V.`;

const LITRES_RULE_BLOCK = `🔴 THE SINGLE MOST IMPORTANT RULE: RETURN LITRES, NEVER RUPEES.
Every layout prints a money total beside the volume total, and the money total is the BIGGER number — roughly 100x the litres, because fuel sells at about ₹100 per litre. Whatever the labels look like:
- "V", "Vtot", "CumVolume", "VOLUME", "Ltr" -> LITRES -> this is cumulative_volume.
- "A", "Atot", "CumSale", "AMOUNT", "Rs", "₹" -> RUPEES -> this is cumulative_amount, NOT the volume.
If a block shows 149341096.920 next to 1654101.290, the volume is 1654101.290 — the SMALLER one. Putting the rupee figure in cumulative_volume overstates a nozzle's meter by a hundredfold and destroys the shift's sales calculation, so when the labels are ambiguous prefer the SMALLER of the two totals and say so in notes.`;

const FIELD_RULES_BLOCK = `- pump_serial: the machine's own serial. The LABEL VARIES BY MAKE and you must accept any of them: "PUMP SERIAL NUMBER", "Pump SNo", "Pump S.No", "SNo", "SERIAL NO", "DU SERIAL NO", "S/N", "Sr. No.". Copy the value VERBATIM — every letter and digit, in order, no spaces added or removed. It may be alphanumeric like "15BC1412V" or "M1832105", or all digits like "201807000927"; both are real examples from the same outlet, both are normal, and neither shape is more correct — do not "correct" one towards the other. It is how we tell WHICH dispenser printed this slip when the slip carries no pump number, so it matters more than pump_id on those layouts. Do NOT confuse it with MODEL, with the phone number in the address block, or with a Weights-and-Measures seal number printed elsewhere on the paper. If more than one candidate appears, take the one on the line carrying the serial label itself.
- model: the value after "MODEL", e.g. "2224" or "1224/2224". Digits and slashes are normal. Null if not printed.
- pump_id: ONLY a genuine pump/FIP identifier — a small number like 1, 2 or 3. A PUMP SERIAL NUMBER, a MODEL and a phone number are NOT pump ids: return null instead. A wrong pump id is worse than none, because it is used to match the slip to our nozzles.
- READ nozzle_no OFF THE SLIP. It is the number printed next to that block — "Nozzle No1" -> "1", "Nozzle No. : 03" -> "3". DO NOT renumber the blocks by their position on the page. If the first block you can see is nozzle 3, report 3, NOT 1. A slip photographed in two parts must report the SAME numbers it prints in each part, or the second photo silently overwrites the first photo's readings against the wrong nozzles.
- If a block's nozzle number is itself unreadable, return null for nozzle_no rather than inferring it from order.`;

const SLIP_PROMPT = `This image is a printed fuel-dispenser "Electronic Totalizer" / pump report slip. It belongs to ONE pump and lists that pump's nozzles, each with a CUMULATIVE volume totalizer (total litres dispensed over the pump's life).

${LAYOUTS_BLOCK}

${LITRES_RULE_BLOCK}

Extract the CUMULATIVE VOLUME for EVERY nozzle visible. Read digits exactly; drop leading zeros and separators but KEEP the decimal point.

Respond with ONLY a JSON object, nothing else:
{
 "slip_type": "A" or "B" or "C" or "other",
 "pump_id": "<the FP. ID / FIP No. as a plain number string, or null>",
 "pump_serial": "<the machine serial exactly as printed, whatever it is labelled, or null>",
 "model": "<the MODEL exactly as printed, or null>",
 "nozzles": [ { "nozzle_no": "<the nozzle number AS PRINTED>", "cumulative_volume": <litres>, "cumulative_amount": <rupees or null>, "legible": <true|false> } ],
 "legible": <true|false overall>,
 "notes": "<short note; mention any nozzle cut off the page or unclear>"
}
${FIELD_RULES_BLOCK}
Include ONLY nozzles actually visible in THIS image. Set a nozzle's legible=false (and overall legible=false) if its volume digits are unclear, glare/blur-obscured, mid-roll, or cut off the edge. NEVER guess a digit.`;

// COMPOSITE variant — same reading rules, but framed for an image that may hold SEVERAL
// slips (several pumps/serials) at once, for the "scan all slips at shift open/close" flow.
// Every slip is returned as its own group with its own serial; the litres-vs-rupees rule
// is applied per nozzle exactly as above. Reuses the SHARED constants so it cannot drift.
const COMPOSITE_SLIP_PROMPT = `This image is a photograph of ONE OR MORE printed fuel-dispenser "Electronic Totalizer" / pump report slips laid out together. Each slip belongs to its OWN pump/serial and lists that pump's nozzles, each with a CUMULATIVE volume totalizer (total litres dispensed over the pump's life). There may be a single slip or many — read EVERY slip you can see and return each as its own group.

${LAYOUTS_BLOCK}

${LITRES_RULE_BLOCK}

For EACH slip in the image, extract the CUMULATIVE VOLUME for EVERY nozzle visible on that slip. Read digits exactly; drop leading zeros and separators but KEEP the decimal point. Keep each slip's nozzles under that slip's own serial — never merge two slips' nozzles into one group.

Respond with ONLY a JSON object, nothing else:
{
 "slips": [
  {
   "pump_serial": "<the machine serial exactly as printed, whatever it is labelled, or null>",
   "model": "<the MODEL exactly as printed, or null>",
   "slip_type": "A" or "B" or "C" or "other",
   "nozzles": [ { "nozzle_no": "<the nozzle number AS PRINTED>", "cumulative_volume": <litres>, "cumulative_amount": <rupees or null>, "legible": <true|false> } ]
  }
 ],
 "legible": <true|false overall>,
 "notes": "<short note; mention any slip or nozzle cut off the page or unclear>"
}
${FIELD_RULES_BLOCK}
Include ONLY slips and nozzles actually visible in THIS image, each under its own slip. Set a nozzle's legible=false (and overall legible=false) if its volume digits are unclear, glare/blur-obscured, mid-roll, or cut off the edge. NEVER guess a digit.`;

// ── HOW A SLIP IS READ ────────────────────────────────────────────────────────
//
// GOOGLE VISION FIRST, CLAUDE ON THE TEXT. Asking a vision model to read a
// thermal slip photographed on a forecourt is the hard version of this problem,
// and it failed in exactly the ways you would expect: on 20-Aug-2026 two scans of
// the same five Sri Balaji slips returned the MODEL line as the pump serial on
// four of five slips in one pass, and lost every rupee amount in the other. Not
// one of the twenty lines came back legible.
//
// Delivery invoices had the identical problem and it went away when the Vision
// pre-pass went in. Same fix here: Vision reads the characters, Claude structures
// the TEXT. A text call does not squint.
//
// The old vision call is kept as the FALLBACK, not deleted — Vision returns null
// when the key is unset, the network fails or the photo yields nothing, and on
// that path the parser behaves exactly as it does today. So this can add a
// success; it cannot remove one.
const OCR_PREAMBLE = `Below is text extracted from a PHOTOGRAPH of the slip(s) by an OCR engine.
The layout may be imperfect: lines can arrive out of order, columns can be flattened, and
where several slips were photographed together their lines may be interleaved. Use the
printed LABELS and each slip's own header block to decide what belongs to what — never
position on the page. Each slip repeats its own header (company, PRINT DATE, PUMP SERIAL
NUMBER, MODEL), so a new header means a new slip.

OCR text:

`;

// ONE reader for both callers. Returns the parsed JSON object, or null.
// `engine` is reported back so a caller — and the eval script — can see which path
// produced the answer instead of guessing.
async function readSlipJson({ file_base64, media_type, prompt, max_tokens = 1500 }) {
  // Preferred: Vision OCR -> Claude TEXT.
  try {
    const ocrText = await visionOcr(file_base64);
    if (usable(ocrText)) {
      const msg = await ai.messages.create({
        model: 'claude-sonnet-4-6', max_tokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${prompt}\n\n${OCR_PREAMBLE}${ocrText}` }] }],
      });
      const parsed = extractJson(msg.content.find(b => b.type === 'text')?.text);
      if (parsed) return { parsed, engine: 'google_vision+claude_text', ocr_chars: ocrText.length };
    }
  } catch (e) { warn('slip vision-ocr path failed: ' + (e.message || e)); }

  // Fallback: the original Claude vision call, unchanged.
  try {
    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-6', max_tokens,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type, data: file_base64 } },
        { type: 'text', text: prompt },
      ] }],
    });
    const parsed = extractJson(msg.content.find(b => b.type === 'text')?.text);
    return parsed ? { parsed, engine: 'claude_vision', ocr_chars: 0 } : null;
  } catch (e) {
    warn('slip parse failed: ' + (e.message || e));
    return null;
  }
}

function extractJson(txt) {
  const m = (txt || '').trim().match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

function warn(msg) {
  try { require('../utils/logger').warn(msg); } catch { /* noop */ }
}

// A real pump/FIP id is a small number. Stripping non-digits off whatever comes back
// turns a serial like "17CH2653V" into "172653" and a model "1224/2224" into
// "12242224", then builds the label "172653.1", which matches no nozzle anywhere.
function cleanPumpId(v) {
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits && digits.length <= 2 ? digits : null;
}

// The ONE nozzle normaliser, shared by the single-slip and composite readers so the
// numeric clean, the rupee/litre swap guard and the legibility verdict cannot drift
// between them. Takes the raw `nozzles` array off a parsed slip and returns cleaned rows.
function normalizeSlipNozzles(rawNozzles) {
  return (Array.isArray(rawNozzles) ? rawNozzles : []).map(n => {
    const no = String(n.nozzle_no ?? '').replace(/[^\d]/g, '');
    let vol = Number(String(n.cumulative_volume ?? '').replace(/[^\d.]/g, ''));
    const amt = Number(String(n.cumulative_amount ?? '').replace(/[^\d.]/g, ''));
    // The rupee/litre swap, caught in code as well as in the prompt. At ~Rs 100/L
    // the money figure is ~100x the litres, so if the "volume" is the LARGER of the
    // two it is the amount — recorded as a meter it would post a phantom sale of a
    // hundred million litres.
    let swapped = false;
    if (isFinite(vol) && isFinite(amt) && amt > 0 && vol > amt) { swapped = true; vol = amt; }
    return {
      nozzle_no: no || null,
      cumulative_volume: isFinite(vol) && vol > 0 ? vol : null,
      cumulative_amount: isFinite(amt) && amt > 0 ? amt : null,
      swapped_amount_for_volume: swapped || undefined,
      legible: n.legible === true && isFinite(vol) && vol > 0 && !swapped,
    };
  }).filter(n => n.nozzle_no);
}

// Read one slip. Returns null when the image could not be parsed at all; the caller
// decides what that means for its own screen.
async function parseSlip({ file_base64, media_type = 'image/jpeg' }) {
  const read = await readSlipJson({ file_base64, media_type, prompt: SLIP_PROMPT });
  const parsed = read?.parsed;
  if (!parsed || !Array.isArray(parsed.nozzles)) return null;

  const nozzles = normalizeSlipNozzles(parsed.nozzles);

  return {
    engine: read.engine,
    slip_type: ['A', 'B', 'C'].includes(parsed.slip_type) ? parsed.slip_type : 'other',
    pump_id: cleanPumpId(parsed.pump_id),
    // Kept VERBATIM apart from case and surrounding space. Serials are alphanumeric
    // on some machines and all-digits on others, so any "tidying" here would corrupt
    // one shape to suit the other.
    pump_serial: String(parsed.pump_serial ?? '').trim().toUpperCase() || null,
    model: String(parsed.model ?? '').trim() || null,
    nozzles,
    legible: parsed.legible === true && nozzles.length > 0 && nozzles.every(n => n.legible),
    notes: String(parsed.notes ?? ''),
  };
}

// Read a COMPOSITE image that may hold several slips (several serials) at once — the
// "scan all slips at shift open/close" flow. Mirrors parseSlip's AI call but uses the
// composite prompt and returns one group per slip, each with its own serial and its
// nozzles normalised by the SAME shared logic. Returns null on total parse failure.
async function parseCompositeSlips({ file_base64, media_type = 'image/jpeg' }) {
  // A composite carries several slips, so its JSON is several times longer than a
  // single slip's — 1500 was tight enough that one more pump could truncate it,
  // and a truncated body fails JSON.parse and loses the WHOLE scan, not one slip.
  const read = await readSlipJson({ file_base64, media_type, prompt: COMPOSITE_SLIP_PROMPT, max_tokens: 8000 });
  const parsed = read?.parsed;
  if (!parsed || !Array.isArray(parsed.slips)) return null;

  const slips = parsed.slips.map(s => ({
    slip_type: ['A', 'B', 'C'].includes(s.slip_type) ? s.slip_type : 'other',
    // Kept VERBATIM apart from case and surrounding space, exactly as parseSlip does.
    pump_serial: String(s.pump_serial ?? '').trim().toUpperCase() || null,
    model: String(s.model ?? '').trim() || null,
    nozzles: normalizeSlipNozzles(s.nozzles),
  }));

  return {
    engine: read.engine,
    ocr_chars: read.ocr_chars,
    slips,
    legible: parsed.legible === true
      && slips.length > 0
      && slips.every(s => s.nozzles.length > 0 && s.nozzles.every(n => n.legible)),
    notes: String(parsed.notes ?? ''),
  };
}

module.exports = { parseSlip, parseCompositeSlips, SLIP_PROMPT };
