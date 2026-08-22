// src/lib/recordAudio.js
//
// One microphone helper. The MediaRecorder dance — probe the supported mime
// type, collect chunks, stop every track so the browser drops its recording
// indicator — was already written out twice (app/pos/page.js and
// components/shared/FloatingChat.js). This is that same sequence in one place so
// the lead form does not become a third copy.
//
// NOTE: pos and FloatingChat still hold their own copies. Migrating them is a
// separate PR — /pos is a money screen and does not get refactored as a side
// effect of shipping a leads tool. Tracked in docs/drift-audit.md.

// Browsers disagree about what they will record. Safari/iOS refuses webm and
// gives mp4; Firefox prefers ogg. '' means "recorder's own default" and must
// stay last — it always matches.
const CANDIDATES = [
  'audio/webm;codecs=opus', 'audio/webm',
  'audio/ogg;codecs=opus',  'audio/ogg',
  'audio/mp4', '',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return CANDIDATES.find(m => m === '' || MediaRecorder.isTypeSupported(m)) || '';
}

export function extFor(mimeType = '') {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

/**
 * Begin recording. Resolves once the microphone is actually live, so the caller
 * can show "listening" only when it is true.
 *
 * @param {object}   opts
 * @param {number}   [opts.maxMs]      hard stop, so a forgotten recording can't
 *                                     run until the tab is closed
 * @param {Function} [opts.onAutoStop] called if maxMs fired rather than the user
 * @returns {Promise<{stop: () => Promise<{blob: Blob, ext: string}>, cancel: () => void}>}
 */
export async function startRecording({ maxMs = 120_000, onAutoStop } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record audio. Try Chrome on Android or Safari on iPhone.');
  }

  const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const rec      = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks   = [];

  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const release = () => stream.getTracks().forEach(t => t.stop());

  const stopped = new Promise((resolve) => {
    rec.onstop = () => {
      release();
      const type = rec.mimeType || mimeType || 'audio/webm';
      resolve({ blob: new Blob(chunks, { type }), ext: extFor(type) });
    };
  });

  rec.start();

  const timer = setTimeout(() => {
    if (rec.state === 'recording') { rec.stop(); onAutoStop?.(); }
  }, maxMs);

  return {
    stop() {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
      return stopped;
    },
    cancel() {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
      release();
    },
  };
}

/** Package a recording for an upload endpoint that expects field name "audio". */
export function audioFormData(blob, ext, language) {
  const form = new FormData();
  form.append('audio', blob, `audio.${ext}`);
  if (language) form.append('language', language);
  return form;
}
