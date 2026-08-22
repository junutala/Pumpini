// src/services/transcribeService.js
//
// ONE writer for speech → text (CLAUDE.md "one writer per concept"). Every
// transcription in Pumpini comes through here; callers differ only in their
// trust boundary and in the MODE they ask for. Before this file the Sarvam call
// was written out inline in routes/voice.js, and adding the lead form would have
// made a second copy of it — which is exactly the drift the cardinal rule bans.
//
// ── The mode matters, and getting it wrong FAILS SILENTLY ────────────────────
// Sarvam's saaras:v3 is a single model with several output modes:
//
//   'codemix'   keeps the speaker's own code-mixed words. The POS voice command
//               needs this: parsePOSCommand() matches BOTH "petrol" and
//               "పెట్రోల్", so flattening one into the other loses the match.
//   'translate' renders any supported Indic language as ENGLISH. The lead form
//               needs this: the rep may canvass in Telugu, the owner reads the
//               admin screen in English.
//
// Ask for 'codemix' when you wanted English and nothing errors — you simply get
// good Telugu back. That is why the mode is an explicit argument with no default
// that silently suits one caller better than the other.
//
// Sources: Sarvam docs — saaras model page and "which STT API to use". The
// legacy /speech-to-text-translate endpoint is saaras:v2.5; new integrations use
// /speech-to-text with the mode parameter, which is what this does.

const logger = require('../utils/logger');

const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';

// Sarvam language codes. Anything unrecognised falls back to Indian English
// rather than erroring — a lead is worth more than a strict language argument.
const LANG_MAP = {
  en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN',
  te: 'te-IN', kn: 'kn-IN', mr: 'mr-IN',
};

const MODES = new Set(['codemix', 'translate', 'transcribe', 'verbatim', 'transliterate']);

/** Error carrying the HTTP status a route should surface, plus provider detail. */
function transcribeError(message, status, details) {
  const err = new Error(message);
  err.status = status;
  err.details = details;
  err.isTranscribeError = true;
  return err;
}

/**
 * Send one audio buffer to Sarvam and return its text.
 *
 * @param {Buffer} buffer     raw audio bytes (multer memory storage)
 * @param {string} mimetype   e.g. 'audio/webm' — passed straight to the Blob
 * @param {string} language   short code ('te', 'hi', …); unknown → 'en-IN'
 * @param {string} mode       'codemix' | 'translate' | … see the note above
 * @returns {Promise<{transcript: string, languageCode: string, raw: object}>}
 */
async function transcribe({ buffer, mimetype, language = 'en', mode = 'codemix' }) {
  if (!buffer?.length) throw transcribeError('No audio provided', 400);

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw transcribeError('Sarvam API key not configured', 500);

  const languageCode = LANG_MAP[language] || 'en-IN';
  const outMode = MODES.has(mode) ? mode : 'codemix';

  const blob = new Blob([buffer], { type: mimetype || 'audio/webm' });
  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  form.append('model', 'saaras:v3');
  form.append('mode', outMode);
  form.append('language_code', languageCode);

  logger.info(`transcribe: ${buffer.length}B ${mimetype || 'audio/webm'} lang=${languageCode} mode=${outMode}`);

  let res, data;
  try {
    res = await fetch(SARVAM_STT_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: form,
    });
    data = await res.json();
  } catch (err) {
    // Network/parse failure talking to Sarvam — a 502, not a 500: the fault is
    // upstream, and the caller may usefully retry.
    throw transcribeError('Transcription service unreachable', 502, err.message);
  }

  if (!res.ok) {
    logger.warn(`transcribe: Sarvam ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw transcribeError('Transcription failed', 502, data);
  }

  return {
    transcript: data.transcript || '',
    languageCode,
    raw: data,
  };
}

module.exports = { transcribe, LANG_MAP, MODES };
