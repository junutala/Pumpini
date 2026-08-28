'use client';
// WHICH ENGINE READ THE SLIP — said out loud, in one place.
//
// There are two readers. The good one is Google Vision for the characters and Claude
// over that text for the structure. The FALLBACK is Claude reading the photograph
// directly, and it is taken when Vision is unconfigured, errors, or hands back too
// little text to work with.
//
// The fallback is weaker at exactly the thing that matters here: it is what returned a
// serial matching no pump at Sri Balaji, and on the 13 scans Pumpini has stored from
// that outlet it took 4 of them. Until now the engine was written into the artifact and
// then dropped on the way back to the screen — so those 4 reads looked identical to the
// 9 good ones to the person confirming them. § 10 rule 2 of the build plan: a
// fallback-engine read is marked low-trust and ALWAYS goes through human confirmation,
// with the reason recorded.
//
// It renders NOTHING on a good read. A badge on every scan is a badge nobody sees.
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Why the better engine did not read it. Plain sentences, because the manager is the
// one who has to decide whether to trust the figures underneath.
const WHY = {
  vision_key_unset:       'the text reader is not configured on this server',
  no_image:               'the photograph did not arrive',
  vision_error:           'the text reader failed on this image',
  vision_no_text:         'the text reader found no text on it',
  vision_timeout:         'the text reader took too long',
  vision_failed:          'the text reader could not be reached',
  vision_text_too_short:  'the text reader returned too little to work with',
  text_model_unparsed:    'the text came back but could not be made sense of',
  vision_path_threw:      'the text reader failed part-way',
};

// vision_http_404, vision_http_403 and the rest carry the status in the code itself, so
// they are matched by shape rather than listed one by one — and an UNRECOGNISED reason
// still shows the card. A code this file has not met yet must never silence the warning;
// the point of the card is the fallback, not the explanation.
const whyFor = r => WHY[r] || (/^vision_http_/.test(r || '')
  ? `the text reader refused the request (${String(r).replace('vision_http_', 'HTTP ')})`
  : null);

export default function EngineNotice({ engine, reason }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  // Anything that is not the fallback is the good path — including a null engine on a
  // read that never got as far as an engine, which the screen reports its own way.
  if (engine !== 'claude_vision') return null;

  const why = whyFor(reason);
  return (
    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8,
                  background: '#fbeee4', color: '#9a3412', display: 'flex',
                  gap: 9, alignItems: 'flex-start' }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
        <strong>{tc('engine.fallbackTitle', 'Read by the backup reader.')}</strong>{' '}
        {why
          ? `${tc('engine.because', 'The usual one was not used because')} ${tc(`engine.why.${reason}`, why)}. `
          : ''}
        {tc('engine.checkEvery', 'It is the weaker of the two on serials and nozzle numbers, so check every figure below against the paper before you confirm.')}
      </div>
    </div>
  );
}
