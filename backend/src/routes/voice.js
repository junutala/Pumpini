// backend/src/routes/voice.js
// Sarvam AI Speech-to-Text integration for Voice POS Entry

const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const multer  = require('multer');
// Using native fetch (Node 18+)
const FormData = require('form-data');

// Use memory storage — we forward directly to Sarvam, no disk needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Language code mapping from app language to Sarvam language code
const LANG_MAP = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  mr: 'mr-IN',
};

// ── POST /api/voice/transcribe ────────────────────────────
// Receives audio blob from frontend, sends to Sarvam, returns
// transcription + parsed POS fields
router.post('/transcribe', authenticate, upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const apiKey  = process.env.SARVAM_API_KEY;
    if (!apiKey)  return res.status(500).json({ error: 'Sarvam API key not configured' });

    const lang    = req.body.language || 'te'; // default Telugu
    const langCode = LANG_MAP[lang] || 'te-IN';

    // Build multipart form for Sarvam
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename:    'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model',            'saaras:v3');
    form.append('language_code',    langCode);
    form.append('mode',             'codemix'); // handles mixed Telugu+English ("50 litres petrol cash")
    form.append('with_timestamps',  'false');
    form.append('with_diarization', 'false');

    const sarvamRes = await fetch('https://api.sarvam.ai/speech-to-text', {
      method:  'POST',
      headers: {
        'api-subscription-key': apiKey,
        ...form.getHeaders(),
      },
      body: form,
    });

    const sarvamData = await sarvamRes.json();

    if (!sarvamRes.ok) {
      console.error('Sarvam error:', sarvamData);
      return res.status(502).json({ error: 'Transcription failed', details: sarvamData });
    }

    const transcript = sarvamData.transcript || '';
    console.log(`Voice transcription [${lang}]: "${transcript}"`);

    // Parse POS fields from transcript
    const parsed = parsePOSCommand(transcript, lang);

    res.json({ transcript, parsed });

  } catch (err) {
    next(err);
  }
});

// ── POS Command Parser ────────────────────────────────────
// Extracts: quantity (litres or amount), entry_type, payment_mode
// from natural speech in any supported language

function parsePOSCommand(text, lang) {
  const t = text.toLowerCase().trim();

  const result = {
    quantity:     null,
    entry_type:   null, // 'litres' or 'amount'
    payment_mode: null, // 'cash', 'upi', 'card', 'credit'
    fuel_type:    null, // 'petrol', 'diesel', 'cng'
    raw:          text,
  };

  // ── Extract number ────────────────────────────────────
  // Matches: 50, 50.5, 1000, ₹500, 500 rupees
  const numMatch = t.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) result.quantity = parseFloat(numMatch[1]);

  // ── Entry type (litres vs amount) ─────────────────────
  const LITRES_WORDS = [
    'litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs', 'l',
    'లీటర్', 'లీటర్లు',      // Telugu
    'लीटर', 'लीटर्स',         // Hindi/Marathi
    'லிட்டர்', 'லிட்டர்கள்', // Tamil
    'ಲೀಟರ್', 'ಲೀಟರ್ಗಳು',    // Kannada
  ];
  const AMOUNT_WORDS = [
    'rupee', 'rupees', 'rs', '₹', 'worth', 'amount', 'ka',
    'రూపాయలు', 'రూపాయి',   // Telugu
    'रुपये', 'रुपया',       // Hindi/Marathi
    'ரூபாய்', 'ரூபாய்கள்', // Tamil
    'ರೂಪಾಯಿ', 'ರೂಪಾಯಿಗಳು', // Kannada
  ];

  if (LITRES_WORDS.some(w => t.includes(w)))  result.entry_type = 'litres';
  else if (AMOUNT_WORDS.some(w => t.includes(w))) result.entry_type = 'amount';
  else result.entry_type = 'litres'; // default assumption for POS

  // ── Payment mode ──────────────────────────────────────
  const PAYMENT_MAP = {
    cash:   ['cash', 'నగదు', 'कैश', 'பணம்', 'ನಗದು', 'रोख', 'nakit'],
    upi:    ['upi', 'gpay', 'phonepe', 'paytm', 'google pay', 'phone pe', 'యూపీఐ', 'यूपीआई'],
    card:   ['card', 'debit', 'credit card', 'swipe', 'కార్డ్', 'कार्ड', 'கார்டு', 'ಕಾರ್ಡ್'],
    credit: ['credit', 'udhar', 'account', 'క్రెడిట్', 'उधार', 'கடன்', 'ಸಾಲ'],
  };

  for (const [mode, keywords] of Object.entries(PAYMENT_MAP)) {
    if (keywords.some(w => t.includes(w))) {
      result.payment_mode = mode;
      break;
    }
  }
  if (!result.payment_mode) result.payment_mode = 'cash'; // default

  // ── Fuel type ─────────────────────────────────────────
  const FUEL_MAP = {
    petrol:  ['petrol', 'పెట్రోల్', 'पेट्रोल', 'பெட்ரோல்', 'ಪೆಟ್ರೋಲ್', 'पेट्रोल'],
    diesel:  ['diesel', 'డీజిల్', 'डीजल', 'டீசல்', 'ಡೀಸೆಲ್', 'डिझेल'],
    cng:     ['cng', 'gas', 'గ్యాస్', 'गैस', 'கேஸ்', 'ಗ್ಯಾಸ್'],
    premium: ['premium', 'speed', 'power', 'xp95', 'hi speed'],
  };

  for (const [fuel, keywords] of Object.entries(FUEL_MAP)) {
    if (keywords.some(w => t.includes(w))) {
      result.fuel_type = fuel;
      break;
    }
  }

  return result;
}

module.exports = router;
