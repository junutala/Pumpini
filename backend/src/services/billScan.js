// src/services/billScan.js
//
// OCR + AI extraction for an expense bill. Mirrors the delivery-invoice scanner
// (routes/deliveries.js) — optional Google Vision pre-pass → Claude, else Claude vision —
// rather than building a second pipeline. Returns the fields the Bill & Payment form
// pre-fills, plus an AI-suggested expense head that the manager confirms or changes.
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function prompt(categories, vendors) {
  const cats = (categories || []).map(c => `${c.code} (${c.name})`).join(', ');
  const known = (vendors || []).slice(0, 60).map(v => v.name).join(', ');
  return `You are reading a petrol-station's EXPENSE BILL / invoice (electricity, internet,
rent, repairs, purchases, etc). Extract the details and return STRICT JSON only:
{
 "vendor": "the payee/seller name as printed",
 "invoice_number": "string or null",
 "date": "YYYY-MM-DD or null",
 "amount": number (the TOTAL payable including any GST),
 "gst_amount": number or null (total GST/CGST+SGST if shown),
 "description": "short: what it is for, or null",
 "suggested_category": "the SINGLE best-fit code from this list: ${cats}",
 "is_asset": true or false (true only if this is buying equipment/a fixed asset like a machine, dispenser, furniture — not a running expense),
 "confidence": "high|medium|low",
 "notes": "anything unclear"
}
Rules:
- amount is the final payable total (incl. GST), not the pre-tax value.
- suggested_category MUST be one of the provided codes; pick the closest. Use other_expense only if nothing fits.
- Known vendors at this outlet (match to one if it's clearly the same payee): ${known || 'none yet'}.
- If a value is missing or unreadable, use null. NEVER guess.`;
}

async function googleVisionOcr(base64) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    const resp = j?.responses?.[0];
    if (resp?.error) return null;
    return resp?.fullTextAnnotation?.text || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function parseJson(txt) {
  const m = (txt || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// Returns the parsed bill object, or throws with a manager-friendly message.
async function scanBill({ file_base64, media_type, categories, vendors }) {
  if (!file_base64 || !media_type) { const e = new Error('file_base64 and media_type are required'); e.status = 400; throw e; }
  if (!OK_TYPES.includes(media_type)) { const e = new Error('Upload a photo (JPG/PNG) or a PDF.'); e.status = 400; throw e; }
  const P = prompt(categories, vendors);

  // Preferred: Vision OCR text → Claude text (robust on smudged phone photos).
  try {
    const ocrText = await googleVisionOcr(file_base64);
    if (ocrText && ocrText.replace(/\s/g, '').length > 40) {
      const msg = await ai.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 1200,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${P}\n\nOCR text from the bill:\n\n${ocrText}` }] }],
      });
      const parsed = parseJson(msg.content.find(b => b.type === 'text')?.text);
      if (parsed && parsed.amount) return parsed;
    }
  } catch { /* fall through to vision */ }

  const fileBlock = media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type, data: file_base64 } }
    : { type: 'image',    source: { type: 'base64', media_type, data: file_base64 } };
  let msg;
  try {
    msg = await ai.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1200,
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: P }] }],
    });
  } catch (e) { const err = new Error('Bill scanning is unavailable right now — enter the details manually.'); err.status = 503; throw err; }

  const parsed = parseJson(msg.content.find(b => b.type === 'text')?.text);
  if (!parsed) { const e = new Error('Could not read the bill — enter the details manually.'); e.status = 422; throw e; }
  return parsed;
}

module.exports = { scanBill, OK_TYPES };
