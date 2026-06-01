// backend/src/routes/voice.js
// Sarvam AI Speech-to-Text integration for Voice POS Entry

const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const multer  = require('multer');

// Use memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Language code mapping
const LANG_MAP = {
  en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN',
  te: 'te-IN', kn: 'kn-IN', mr: 'mr-IN',
};

// ── POST /api/voice/transcribe ────────────────────────────
router.post('/transcribe', authenticate, upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Sarvam API key not configured' });

    const lang     = req.body.language || 'en';
    const langCode = LANG_MAP[lang] || 'en-IN';

    console.log(`Voice: ${req.file.size} bytes, ${req.file.mimetype}, lang: ${langCode}`);

    // Use Node 18 native FormData + Blob
    const blob = new Blob([req.file.buffer], {
      type: req.file.mimetype || 'audio/webm'
    });

    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', 'saaras:v3');
    form.append('mode', 'codemix');
    form.append('language_code', langCode);

    const sarvamRes = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: form,
    });

    const sarvamData = await sarvamRes.json();
    console.log('Sarvam status:', sarvamRes.status, JSON.stringify(sarvamData).slice(0, 200));

    if (!sarvamRes.ok) {
      return res.status(502).json({
        error: 'Transcription failed',
        details: sarvamData,
        status: sarvamRes.status
      });
    }

    const transcript = sarvamData.transcript || '';
    console.log(`Transcript [${lang}]: "${transcript}"`);

    res.json({ transcript, parsed: parsePOSCommand(transcript, lang) });

  } catch (err) {
    console.error('Voice route error:', err.message);
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
