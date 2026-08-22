// backend/src/routes/voice.js
// Sarvam AI Speech-to-Text integration for Voice POS Entry

const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const multer  = require('multer');
// The Sarvam call itself lives in ONE place now (CLAUDE.md one-writer rule).
// This route is the tenant-JWT boundary over it; routes/leads.js is the public
// one. Same endpoint, same model, same key — they differ only in the `mode`
// they ask for, and in who is allowed to ask.
const { transcribe, LANG_MAP } = require('../services/transcribeService');

// Use memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── POST /api/voice/transcribe ────────────────────────────
router.post('/transcribe', authenticate, upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const lang = req.body.language || 'en';

    // 'codemix' keeps the speaker's own words. parsePOSCommand() below matches
    // BOTH 'petrol' and 'పెట్రోల్', so translating to English here would not
    // help it — it would just throw away one half of the vocabulary it knows.
    const { transcript } = await transcribe({
      buffer:   req.file.buffer,
      mimetype: req.file.mimetype,
      language: lang,
      mode:     'codemix',
    });

    console.log(`Transcript [${lang}]: "${transcript}"`);
    res.json({ transcript, parsed: parsePOSCommand(transcript, lang) });

  } catch (err) {
    // Preserve the response shape the POS screen and FloatingChat already read:
    // { error, details, status } on failure, so neither needs a change.
    if (err.isTranscribeError) {
      return res.status(err.status || 502).json({
        error: err.message, details: err.details, status: err.status,
      });
    }
    console.error('Voice route error:', err.message);
    next(err);
  }
});

// ── POST /api/voice/speak ─ Sarvam TTS (Bulbul): text → spoken audio ──
// Completes the voice loop: Claude's reply (e.g. Telugu text) → Sarvam speaks it.
router.post('/speak', authenticate, async (req, res, next) => {
  try {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Sarvam API key not configured' });

    const text = (req.body.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'No text provided' });
    const langCode = LANG_MAP[req.body.language] || 'en-IN';

    const sarvamRes = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 1500),          // Bulbul per-request cap; long replies are clipped
        target_language_code: langCode,
        speaker: 'shubh',                   // v3 voice catalog (v2's 'anushka' does not exist in v3)
        model: 'bulbul:v3',
      }),
    });
    const data = await sarvamRes.json();
    if (!sarvamRes.ok) {
      return res.status(502).json({ error: 'TTS failed', details: data, status: sarvamRes.status });
    }
    const audio = Array.isArray(data.audios) ? data.audios[0] : (data.audio || null);
    if (!audio) return res.status(502).json({ error: 'No audio returned', details: data });
    res.json({ audio, format: 'wav' });
  } catch (err) {
    console.error('TTS route error:', err.message);
    next(err);
  }
});

// ── POS Command Parser ────────────────────────────────────
function parsePOSCommand(text, lang) {
  const t = text.toLowerCase().trim();
  const result = {
    quantity: null, entry_type: null,
    payment_mode: null, fuel_type: null, raw: text,
  };

  const numMatch = t.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) result.quantity = parseFloat(numMatch[1]);

  const LITRES_WORDS = ['litre','litres','liter','liters','ltr','ltrs',
    'లీటర్','లీటర్లు','लीटर','லிட்டர்','ಲೀಟರ್'];
  const AMOUNT_WORDS = ['rupee','rupees','rs','₹','worth','amount',
    'రూపాయలు','रुपये','ரூபாய்','ರೂಪಾಯಿ'];

  if (LITRES_WORDS.some(w => t.includes(w))) result.entry_type = 'litres';
  else if (AMOUNT_WORDS.some(w => t.includes(w))) result.entry_type = 'amount';
  else result.entry_type = 'litres';

  const PAYMENT_MAP = {
    cash:   ['cash','నగదు','कैश','பணம்','ನಗದು','रोख'],
    upi:    ['upi','gpay','phonepe','paytm','google pay','యూపీఐ','यूपीआई'],
    card:   ['card','debit','swipe','కార్డ్','कार्ड','கார்டு','ಕಾರ್ಡ್'],
    credit: ['credit','udhar','account','క్రెడిట్','उधार','கடன்','ಸಾಲ'],
  };
  for (const [mode, keywords] of Object.entries(PAYMENT_MAP)) {
    if (keywords.some(w => t.includes(w))) { result.payment_mode = mode; break; }
  }
  if (!result.payment_mode) result.payment_mode = 'cash';

  const FUEL_MAP = {
    petrol:  ['petrol','పెట్రోల్','पेट्रोल','பெட்ரோல்','ಪೆಟ್ರೋಲ್'],
    diesel:  ['diesel','డీజిల్','डीजल','டீசல்','ಡೀಸೆಲ್'],
    cng:     ['cng','gas','గ్యాస్','गैस','கேஸ்','ಗ್ಯಾಸ್'],
    premium: ['premium','speed','power','xp95'],
  };
  for (const [fuel, keywords] of Object.entries(FUEL_MAP)) {
    if (keywords.some(w => t.includes(w))) { result.fuel_type = fuel; break; }
  }

  return result;
}

module.exports = router;
