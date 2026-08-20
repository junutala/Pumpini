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

async function visionOcr(base64) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key || !base64) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OCR_TIMEOUT_MS);
  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) { warn(`vision-ocr http ${r.status}`); return null; }
    const j = await r.json();
    const resp = j?.responses?.[0];
    if (resp?.error) { warn('vision-ocr error: ' + (resp.error.message || '')); return null; }
    return resp?.fullTextAnnotation?.text || null;
  } catch (e) {
    warn('vision-ocr failed: ' + (e.message || e));
    return null;
  } finally { clearTimeout(timer); }
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
}) {
  let reachedModel = false;

  try {
    const ocrText = await visionOcr(file_base64);
    if (usable(ocrText)) {
      const msg = await ai.messages.create({
        model, max_tokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${prompt}\n\n${ocrPreamble}${ocrText}` }] }],
      });
      reachedModel = true;
      const parsed = extractJson(msg.content.find(b => b.type === 'text')?.text);
      if (parsed) return { parsed, engine: 'google_vision+claude_text', ocr_chars: ocrText.length, error: null };
    }
  } catch (e) { warn('vision-ocr read path failed: ' + (e.message || e)); }

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
      ? { parsed, engine: 'claude_vision', ocr_chars: 0, error: null }
      : { parsed: null, engine: 'claude_vision', ocr_chars: 0, error: 'unparsed' };
  } catch (e) {
    warn('image read failed: ' + (e.message || e));
    return { parsed: null, engine: null, ocr_chars: 0, error: reachedModel ? 'unparsed' : 'api' };
  }
}

module.exports = { visionOcr, usable, readImageAsJson };
