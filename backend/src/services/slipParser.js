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

const SLIP_PROMPT = `This image is a printed fuel-dispenser "Electronic Totalizer" / pump report slip. It belongs to ONE pump and lists that pump's nozzles, each with a CUMULATIVE volume totalizer (total litres dispensed over the pump's life).

Known layouts — detect which, and if it is NONE of them still apply the rules below:
- Layout A (IndianOil): header has "FP. ID : <n>" and "Pump SNo : <serial>", then Date/Time; each "Nozzle No1 / No2 …" block has Shif1/2/3Sale+Vol, ShDaySale/Vol, ShMTHSale/Vol and finally "CumVolume:" (litres) plus "CumSale:" (rupees). Use **CumVolume** — NOT ShDayVol, NOT ShMTHVol, which are period figures that reset. FP. ID is the pump id; Pump SNo is the serial.
- Layout B: header has "FIP No."; an "Electronic Totalizer" block lists each "Nozzle No. : 0X" with "Ecal Factor", "Atot" (rupees) and "Vtot" (litres). Use Vtot as the nozzle's cumulative volume.
- Layout C (HPCL/IOCL "ETOT-MAIN"): header carries PUMP SERIAL NUMBER and MODEL, then "---: ETOT-MAIN :---" and one block per nozzle reading "NOZZLE : 1" followed by "A:<number>", "V:<number>" and "TOT SALES:<number>". Here **V is the VOLUME in litres and is the figure we want**; A is the cumulative AMOUNT in rupees and TOT SALES is a COUNT of transactions. Use V.

🔴 THE SINGLE MOST IMPORTANT RULE: RETURN LITRES, NEVER RUPEES.
Every layout prints a money total beside the volume total, and the money total is the BIGGER number — roughly 100x the litres, because fuel sells at about ₹100 per litre. Whatever the labels look like:
- "V", "Vtot", "CumVolume", "VOLUME", "Ltr" -> LITRES -> this is cumulative_volume.
- "A", "Atot", "CumSale", "AMOUNT", "Rs", "₹" -> RUPEES -> this is cumulative_amount, NOT the volume.
If a block shows 149341096.920 next to 1654101.290, the volume is 1654101.290 — the SMALLER one. Putting the rupee figure in cumulative_volume overstates a nozzle's meter by a hundredfold and destroys the shift's sales calculation, so when the labels are ambiguous prefer the SMALLER of the two totals and say so in notes.

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
- pump_serial: the machine's own serial. The LABEL VARIES BY MAKE and you must accept any of them: "PUMP SERIAL NUMBER", "Pump SNo", "Pump S.No", "SNo", "SERIAL NO", "S/N", "Sr. No.". Copy the value VERBATIM — every letter and digit, in order, no spaces added or removed. It may be alphanumeric like "15BC1412V" or all digits like "201807000927"; both are real examples from the same outlet, both are normal, and neither shape is more correct — do not "correct" one towards the other. It is how we tell WHICH dispenser printed this slip when the slip carries no pump number, so it matters more than pump_id on those layouts. Do NOT confuse it with MODEL, with the phone number in the address block, or with a Weights-and-Measures seal number printed elsewhere on the paper. If more than one candidate appears, take the one on the line carrying the serial label itself.
- model: the value after "MODEL", e.g. "2224" or "1224/2224". Digits and slashes are normal. Null if not printed.
- pump_id: ONLY a genuine pump/FIP identifier — a small number like 1, 2 or 3. A PUMP SERIAL NUMBER, a MODEL and a phone number are NOT pump ids: return null instead. A wrong pump id is worse than none, because it is used to match the slip to our nozzles.
- READ nozzle_no OFF THE SLIP. It is the number printed next to that block — "Nozzle No1" -> "1", "Nozzle No. : 03" -> "3". DO NOT renumber the blocks by their position on the page. If the first block you can see is nozzle 3, report 3, NOT 1. A slip photographed in two parts must report the SAME numbers it prints in each part, or the second photo silently overwrites the first photo's readings against the wrong nozzles.
- If a block's nozzle number is itself unreadable, return null for nozzle_no rather than inferring it from order.
Include ONLY nozzles actually visible in THIS image. Set a nozzle's legible=false (and overall legible=false) if its volume digits are unclear, glare/blur-obscured, mid-roll, or cut off the edge. NEVER guess a digit.`;

// A real pump/FIP id is a small number. Stripping non-digits off whatever comes back
// turns a serial like "17CH2653V" into "172653" and a model "1224/2224" into
// "12242224", then builds the label "172653.1", which matches no nozzle anywhere.
function cleanPumpId(v) {
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits && digits.length <= 2 ? digits : null;
}

// Read one slip. Returns null when the image could not be parsed at all; the caller
// decides what that means for its own screen.
async function parseSlip({ file_base64, media_type = 'image/jpeg' }) {
  let parsed = null;
  try {
    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type, data: file_base64 } },
        { type: 'text', text: SLIP_PROMPT },
      ] }],
    });
    const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
    const m = txt.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch (e) {
    try { require('../utils/logger').warn('slip parse failed: ' + (e.message || e)); } catch { /* noop */ }
    return null;
  }
  if (!parsed || !Array.isArray(parsed.nozzles)) return null;

  const nozzles = parsed.nozzles.map(n => {
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

  return {
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

module.exports = { parseSlip, SLIP_PROMPT };
