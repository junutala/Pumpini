// src/services/visionOcr.js
//
// THE one way Pumpini reads a photographed document. Two things live here and both
// are single writers:
//
//   visionOcr()       — the one Google Vision call.
//   readImageAsJson() — the one Vision-first-then-Claude pipeline built on it.
//
// SIX readers share them: delivery invoices, expense bills, dispenser slips, the
// UGT/auto-gauge console screen, the per-nozzle totalizer photo and credit coupons.
// Before this file there were two byte-identical copies of the Vision call
// (routes/deliveries.js and services/billScan.js) and the pipeline was about to be
// copied a further four times — precisely the duplication the cardinal rule forbids.
// One concept, one writer, so a fix to how we read a photograph reaches every screen
// by construction rather than by somebody remembering.
//
// WHY VISION FIRST, THEN CLAUDE ON THE *TEXT*.
// Managers photograph smudged physical paper on a phone. A general vision model
// reads those intermittently — it will return prose, or drop a field, or put a
// rupee figure where the litres go. Google Vision DOCUMENT_TEXT_DETECTION reads
// the characters reliably, and Claude is then far more dependable structuring
// clean TEXT than reading a bad photograph. This was proven on HPCL delivery
// invoices: the same failure pattern, and it stopped the day the pre-pass went in
// (owner, 20-Aug-2026: "after we switched to google OCR, we never had problems").
//
// DEGRADES, NEVER THROWS. Returns null when the key is unset, the call fails, the
// request times out or Vision reports an error — every caller falls back to its
// existing Claude-vision path on a null, so wiring this in can only add a chance
// of success, never remove one.
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OCR_TIMEOUT_MS = 20000;

// WHY VISION GAVE US NOTHING — returned, not just logged.
//
// The pipeline below falls back to the engine that already lost the managers
// (claude_vision, 63% line-match against Vision's 97%), and until now it did so in
// silence: the reason went to warn() and no further. On 26-Aug-2026 the fallback
// fired on 3 of 8 Sri Balaji scans and NOTHING in the database says why — the
// post-mortem had to reconstruct it from absence. A downgrade nobody can see is a
// defect in its own right, so the reason now travels with the result.
//
// visionOcr() keeps its text-or-null contract; billScan and deliveries call it
// directly and must not change. This is the same call reporting one extra fact.
async function visionOcrDetailed(base64) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key)    return { text: null, reason: 'vision_key_unset' };
  if (!base64) return { text: null, reason: 'no_image' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OCR_TIMEOUT_MS);
  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) { warn(`vision-ocr http ${r.status}`); return { text: null, reason: `vision_http_${r.status}` }; }
    const j = await r.json();
    const resp = j?.responses?.[0];
    if (resp?.error) { warn('vision-ocr error: ' + (resp.error.message || '')); return { text: null, reason: 'vision_error' }; }
    const text = resp?.fullTextAnnotation?.text || null;
    return { text, reason: text ? null : 'vision_no_text' };
  } catch (e) {
    warn('vision-ocr failed: ' + (e.message || e));
    // An abort is the timeout above, which is worth telling apart from a network
    // failure: one says the frame was too slow, the other that we never got there.
    return { text: null, reason: e?.name === 'AbortError' ? 'vision_timeout' : 'vision_failed' };
  } finally { clearTimeout(timer); }
}

// The original contract, unchanged, for the two callers that want only the text.
async function visionOcr(base64) {
  return (await visionOcrDetailed(base64)).text;
}

// READ THE FRAME TWICE — AS TAKEN, AND ENLARGED — AND KEEP THE BETTER READ.
//
// The manager photographs a monitor on a machine he may not touch, so a clean file
// is never coming; the digits arrive a few pixels tall inside a 1280-wide frame.
// Enlarging before the read is the whole fix, and 31-Aug measured both ends of it:
// Vision on a re-photographed frame returned 732-1,140 characters of '216000' and
// 'Ultage', and on the original file 1,478 characters with every field correct.
//
// WHY BOTH, RATHER THAN JUST THE ENLARGED ONE. I cannot measure this from a session
// with no Vision key, and the repo's rule is that a claim needs data behind it. So
// the two reads race, the longer text wins, and BOTH counts are reported for the
// caller to store. After a week of real scans the rows will say plainly whether the
// upscale earns its place — and if it does not, deleting it costs nothing, because
// the untouched read is always one of the two candidates.
//
// It cannot regress: the worst case is that the enlarged read is discarded and we
// keep exactly today's answer. The cost is one extra Vision call per scan — $1.50
// per 1,000 after the first 1,000 free each month, so at four outlets it stays
// inside the free tier.
async function visionOcrBest(base64) {
  // 🔴 THE TWO READS RACE IN PARALLEL. Shipped sequentially on 31-Aug, which simply
  // ADDED the second read's latency to the first — the manager waits for both, one
  // after the other, on a phone. The owner felt it the same evening: "now it took
  // really long time and failed". They share no state, so there was never a reason
  // to queue them.
  //
  // The enlarge itself is awaited first because the second read needs its output; it
  // is local CPU on one frame, not a network call.
  let big = null;
  try {
    const { upscaleForOcr } = require('./imagePrep');
    big = await upscaleForOcr(base64);
  } catch (e) {
    warn('vision-ocr upscale failed: ' + (e.message || e));
  }

  const [raw, prepped] = await Promise.all([
    visionOcrDetailed(base64),
    // No enlargement worth making — the frame is already at the cap — so there is no
    // second call to pay for. This is the common case on a modern phone photo.
    big ? visionOcrDetailed(big) : Promise.resolve(null),
  ]);

  return pickBetterRead(raw, prepped);
}

// THE RULE, on its own so a test can pin the real thing rather than a copy of it.
//
// Longer wins, and a TIE KEEPS THE ORIGINAL — an upscale that buys nothing should
// not be recorded as having been used, or the rows we are gathering to judge it will
// flatter it. Anything missing counts as zero characters, so a failed or skipped
// upscale simply loses.
function pickBetterRead(raw, prepped) {
  const rawLen  = raw?.text?.length ?? 0;
  const prepLen = prepped?.text?.length ?? 0;
  const useprep = prepLen > rawLen;
  const win = useprep ? prepped : raw;
  return {
    text: win?.text ?? null,
    // The reason belongs to whichever read we are returning, so a stored scan still
    // says why it fell back.
    reason: win?.reason ?? null,
    variant: useprep ? 'upscaled' : 'as_taken',
    ocr_chars_as_taken: rawLen,
    ocr_chars_upscaled: prepLen,
  };
}

// Enough characters to be worth handing to a text model. A near-empty read means
// Vision found nothing usable, so the caller should go to its vision fallback
// rather than ask Claude to structure four characters of noise.
function usable(text, min = 40) {
  return !!text && text.replace(/\s/g, '').length > min;
}

function warn(msg) {
  try { require('../utils/logger').warn(msg); } catch { /* noop */ }
}

// Generic framing for OCR text. A caller with a layout-specific warning (several
// slips in one frame, several tanks on one console) passes its own.
const DEFAULT_PREAMBLE = `Below is text extracted from a PHOTOGRAPH of the document by an
OCR engine. The layout may be imperfect: lines can arrive out of order and columns can be
flattened. Use the printed LABELS to decide what each figure is — never position on the page.

OCR text:

`;

function extractJson(txt) {
  const m = (txt || '').trim().match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// READ A PHOTOGRAPHED DOCUMENT INTO JSON.
//
// Google Vision first, Claude on the TEXT. Managers photograph smudged paper and
// glare-lit console screens on a phone; a vision model reads those intermittently,
// while Vision reads the characters reliably and Claude is far more dependable
// structuring clean text than squinting at a bad photo. Proven on HPCL delivery
// invoices (owner, 20-Aug-2026: "after we switched to google OCR, we never had
// problems") and extended to every other reader the same day.
//
// The direct vision call is kept as the FALLBACK, never deleted: Vision returns null
// when the key is unset, the network fails or the frame yields nothing, and on that
// path each caller behaves exactly as it did before. This can add a success; it
// cannot remove one.
//
// Returns { parsed, engine, error }:
//   error 'api'      — both attempts failed to reach the model  (callers answer 503)
//   error 'unparsed' — the model answered but not with JSON     (callers answer 422)
// The split is kept because those two mean different things to a manager: one is
// "come back in a minute", the other is "this photo will never read — type it".
async function readImageAsJson({
  file_base64, media_type = 'image/jpeg', prompt,
  max_tokens = 1500, model = 'claude-sonnet-4-6', ocrPreamble = DEFAULT_PREAMBLE,
  // Race an enlarged copy of the frame against the original and keep the better
  // read. Worth it where the subject is small text photographed off a screen — the
  // gauge console — and pointless on a document held up to the camera.
  prep = false,
}) {
  let reachedModel = false;
  // Why the Vision path did not produce the answer. Null on the happy path; set on
  // every route to the claude_vision fallback so a stored scan can say WHICH engine
  // read it and WHY it was not the better one.
  let fallbackReason = null;
  // Which of the two reads won, and what each recovered. Stored on the artifact so
  // the upscale is judged on rows rather than on anybody's expectation of it.
  let ocrVariant = null, ocrCharsAsTaken = null, ocrCharsUpscaled = null;

  try {
    const read = prep ? await visionOcrBest(file_base64) : await visionOcrDetailed(file_base64);
    const { text: ocrText, reason } = read;
    ocrVariant = read.variant ?? null;
    ocrCharsAsTaken = read.ocr_chars_as_taken ?? null;
    ocrCharsUpscaled = read.ocr_chars_upscaled ?? null;
    if (reason) fallbackReason = reason;
    if (usable(ocrText)) {
      const msg = await ai.messages.create({
        model, max_tokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${prompt}\n\n${ocrPreamble}${ocrText}` }] }],
      });
      reachedModel = true;
      const parsed = extractJson(msg.content.find(b => b.type === 'text')?.text);
      // THE RAW READ TRAVELS WITH THE RESULT. On 31-Aug a gauge scan swapped two
      // product names and the post-mortem had only the model's OWN interpretation to
      // work from — we had thrown away what Vision actually saw. A caller that stores
      // its scan should store this beside it: it is the primary source, and the text
      // model's answer is a reading of it.
      if (parsed) return { parsed, engine: 'google_vision+claude_text', ocr_chars: ocrText.length, ocr_text: ocrText,
                           ocr_variant: ocrVariant, ocr_chars_as_taken: ocrCharsAsTaken, ocr_chars_upscaled: ocrCharsUpscaled,
                           fallback_reason: null, error: null };
      // Vision read the characters, but the text model did not answer with JSON.
      fallbackReason = 'text_model_unparsed';
    } else if (!fallbackReason) {
      // Vision answered with something, just not enough of it to be worth structuring.
      fallbackReason = 'vision_text_too_short';
    }
  } catch (e) {
    warn('vision-ocr read path failed: ' + (e.message || e));
    if (!fallbackReason) fallbackReason = 'vision_path_threw';
  }

  try {
    const msg = await ai.messages.create({
      model, max_tokens,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type, data: file_base64 } },
        { type: 'text', text: prompt },
      ] }],
    });
    reachedModel = true;
    const parsed = extractJson(msg.content.find(b => b.type === 'text')?.text);
    return parsed
      ? { parsed, engine: 'claude_vision', ocr_chars: 0, fallback_reason: fallbackReason, error: null }
      : { parsed: null, engine: 'claude_vision', ocr_chars: 0, fallback_reason: fallbackReason, error: 'unparsed' };
  } catch (e) {
    warn('image read failed: ' + (e.message || e));
    return { parsed: null, engine: null, ocr_chars: 0, fallback_reason: fallbackReason, error: reachedModel ? 'unparsed' : 'api' };
  }
}

module.exports = { visionOcr, visionOcrDetailed, visionOcrBest, pickBetterRead, usable, readImageAsJson };
