'use client';
// components/shared/InteractionRecorder.js
//
// ONE record-and-transcribe control (CLAUDE.md: reuse the form, do not open a
// new route). Two screens capture a lead interaction and they must not grow two
// copies of this:
//   • app/lead/page.js               — the field temp's cold-capture form
//   • components/admin/LeadRail.js   — the owner working a lead into the funnel
//
// Both post to /api/leads/transcribe, which is the public guard over the SAME
// Sarvam service the POS voice entry uses — same endpoint, same model, same key,
// mode 'translate' so a Telugu or Hindi visit reads back as English.
//
// Recording again APPENDS to the text rather than replacing it: a second thought
// adds to the account of the visit instead of wiping the first.
import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { startRecording, audioFormData } from '../../lib/recordAudio';

const uiLang = () => (typeof window !== 'undefined' && localStorage.getItem('i18nextLng')) || 'en';

const MAX_MS = 120_000;   // a forgotten recording stops itself

export default function InteractionRecorder({
  value, onChange, tc, placeholder, hint, textareaStyle, onBusy,
}) {
  const [state, setState] = useState('idle');   // idle | recording | transcribing
  const [secs, setSecs]   = useState(0);
  const [err, setErr]     = useState('');
  const recorder = useRef(null);
  const timer    = useRef(null);

  // Release the microphone if the screen closes mid-recording — otherwise the
  // browser keeps showing its recording indicator over a page that is gone.
  useEffect(() => () => { clearInterval(timer.current); recorder.current?.cancel(); }, []);

  // Let the host screen keep its Save button honest: saving while the mic is
  // still open would drop the half of the visit not yet transcribed.
  useEffect(() => { onBusy?.(state !== 'idle'); }, [state, onBusy]);

  const toggle = async () => {
    setErr('');

    if (state === 'recording') {
      const rec = recorder.current;
      recorder.current = null;
      clearInterval(timer.current);
      setState('transcribing');
      try {
        const { blob, ext } = await rec.stop();
        const res  = await fetch('/api/leads/transcribe', {
          method: 'POST', body: audioFormData(blob, ext, uiLang()),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || `Transcription failed (${res.status})`);

        const heard = (data.transcript || '').trim();
        if (!heard) setErr(tc('lead.heardNothing', 'Heard nothing — speak a little longer, closer to the phone.'));
        else onChange(value ? `${value.trim()} ${heard}` : heard);
      } catch (e) {
        setErr(e?.message || tc('lead.transcribeFailed', 'Transcription failed. You can type the note instead.'));
      } finally {
        setState('idle');
        setSecs(0);
      }
      return;
    }

    try {
      recorder.current = await startRecording({
        maxMs: MAX_MS,
        onAutoStop: () => setErr(tc('lead.autoStopped', 'Stopped at 2 minutes. Record again to add more.')),
      });
      setState('recording');
      setSecs(0);
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch (e) {
      setErr(e?.message || tc('lead.micDenied', 'Microphone not available. You can type the note instead.'));
      setState('idle');
    }
  };

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <>
      <button type="button" onClick={toggle} disabled={state === 'transcribing'} style={{
        width: '100%', height: 50, borderRadius: 10, border: 'none', cursor: 'pointer',
        fontSize: 15, fontWeight: 700, marginBottom: 11, fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        background: state === 'recording' ? '#b91c1c' : state === 'transcribing' ? '#e5e3de' : '#1a1a1a',
        color: state === 'transcribing' ? '#666' : '#fff',
      }}>
        {state === 'recording'      ? <><Square size={16} fill="#fff" />{tc('lead.stopRecording', 'Stop')} · {mmss}</>
         : state === 'transcribing' ? <><Loader2 size={17} className="spin" />{tc('lead.transcribing', 'Transcribing…')}</>
         : <><Mic size={17} />{value ? tc('lead.recordMore', 'Record more') : tc('lead.record', 'Record')}</>}
      </button>

      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || tc('lead.interactionPlaceholder', 'What was discussed. Record it, or type it here.')}
        style={{
          width: '100%', padding: '12px 13px', border: '1.5px solid #ddd', borderRadius: 9,
          fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
          background: '#fff', minHeight: 110, resize: 'vertical', lineHeight: 1.55,
          ...textareaStyle,
        }}
      />

      <p style={{ fontSize: 12, color: '#888', margin: '7px 0 0', lineHeight: 1.5 }}>
        {hint || tc('lead.interactionHint', 'Speak in any Indian language — it is transcribed to English. Correct the text before saving if it misheard.')}
      </p>
      {err && <p style={{ color: '#b91c1c', fontSize: 12.5, margin: '7px 0 0', lineHeight: 1.5 }}>{err}</p>}
    </>
  );
}
