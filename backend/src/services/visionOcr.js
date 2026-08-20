// src/services/visionOcr.js
//
// THE one Google Vision OCR call. Three readers now share it — delivery invoices,
// expense bills and dispenser slips — and before this file there were two
// byte-identical copies of the same function (routes/deliveries.js and
// services/billScan.js), which is precisely the duplication the cardinal rule
// forbids: one concept, one writer.
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

module.exports = { visionOcr, usable };
