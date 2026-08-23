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
import { Mic, Square, Loader2, CalendarClock, X } from 'lucide-react';
import { startRecording, audioFormData } from '../../lib/recordAudio';
// The date arithmetic lives in lib/appointment.js so it can be tested — a
// picker that books the wrong day fails silently and costs a wasted drive.
import { applyDay, applyHour, dayOffset, daysToMonday, isHourPast, isDayPast, toLocalInput }
  from '../../lib/appointment';

const uiLang = () => (typeof window !== 'undefined' && localStorage.getItem('i18nextLng')) || 'en';

const MAX_MS = 120_000;   // a forgotten recording stops itself

export default function InteractionRecorder({
  value, onChange, tc, placeholder, hint, textareaStyle, onBusy,
  // Optional appointment. Passed by both screens, so the picker is written once
  // here rather than twice — it belongs to "capture an interaction", which is
  // what this block is, not just to the recording half of it.
  appointment, onAppointmentChange,
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

      {onAppointmentChange && (
        <AppointmentPicker value={appointment} onChange={onAppointmentChange} tc={tc} />
      )}
    </>
  );
}


// ── AppointmentPicker ────────────────────────────────────────────────────────
//
// Two taps, standing on a forecourt, one-handed. The native datetime-local
// control is several taps of scrolling through a wheel, which is the wrong tool
// for somebody who has been walking outlets all day (owner, 23-Aug-2026:
// "running around the outlets is tiring... a complicated date&time picker will
// break the back").
//
// Nearly every appointment a canvasser sets is near-term and on the hour — the
// owner's own field notes read "he'll be back only on Monday" and "contact after
// 2 p.m." So: a row of days, a row of hours, and the full picker kept behind
// "Other…" for the rare appointment that is neither.
//
// The value stays a `datetime-local` string throughout, so the two screens that
// embed this are unchanged and still convert it to a real instant when sending.
function AppointmentPicker({ value, onChange, tc }) {
  const [manual, setManual] = useState(false);

  const current = value ? new Date(value) : null;
  const valid   = current && !Number.isNaN(current.getTime());

  const DAYS = [
    [tc('lead.dayToday',    'Today'),     0],
    [tc('lead.dayTomorrow', 'Tomorrow'),  1],
    [tc('lead.dayAfter',    'Day after'), 2],
    [tc('lead.dayMonday',   'Monday'),    daysToMonday()],
  ];
  const HOURS = [
    ['10 AM', 10], ['12 PM', 12], ['2 PM', 14], ['4 PM', 16], ['6 PM', 18],
  ];

  const offset = valid ? dayOffset(current) : null;


  // A past slot is greyed rather than hidden: the row keeps its shape through
  // the day, so the chip a thumb is used to reaching for does not move.
  const chip = (label, active, onClick, past = false) => (
    <button key={label} type="button" onClick={onClick} disabled={past} style={{
      padding: '7px 12px', borderRadius: 99, fontFamily: 'inherit',
      fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
      cursor: past ? 'not-allowed' : 'pointer',
      border: `1.5px solid ${active ? '#1a1a1a' : past ? '#eee' : '#ddd'}`,
      background: active ? '#1a1a1a' : past ? '#f6f6f6' : '#fff',
      color: active ? '#fff' : past ? '#c4c4c4' : '#444',
      textDecoration: past ? 'line-through' : 'none',
    }}>{label}</button>
  );

  return (
    <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px dashed #e5e3de' }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
        color: '#666', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 9,
      }}>
        <CalendarClock size={13} />{tc('lead.appointment', 'Next appointment')}
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: '#aaa' }}>
          {tc('lead.optional', '(optional)')}
        </span>
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 7 }}>
        {DAYS.map(([label, off]) => chip(label, offset === off,
          () => onChange(applyDay(off, valid ? current : null)),
          isDayPast(off, HOURS.map(h => h[1]))))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {HOURS.map(([label, h]) => chip(label, valid && current.getHours() === h,
          () => onChange(applyHour(h, valid ? current : null)),
          isHourPast(h, valid ? current : null)))}
        {chip(tc('lead.otherTime', 'Other…'), manual, () => setManual(m => !m))}
      </div>

      {manual && (
        <input
          type="datetime-local"
          value={value || ''}
          min={toLocalInput(new Date())}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%', marginTop: 9, padding: '10px 11px', border: '1.5px solid #ddd',
            borderRadius: 9, fontSize: 15, outline: 'none', boxSizing: 'border-box',
            fontFamily: 'inherit', background: '#fff',
          }}
        />
      )}

      {/* Says the choice back in words, so a mis-tap is caught before saving
          rather than discovered when nobody is at the outlet. */}
      {valid && (
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, background: '#eef2ff', borderRadius: 8, padding: '8px 11px',
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#3730a3' }}>
            {current.toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short',
              hour: '2-digit', minute: '2-digit', hour12: true,
            })}
          </span>
          <button type="button" onClick={() => { onChange(''); setManual(false); }}
            aria-label={tc('lead.clearAppointment', 'Clear appointment')}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: '#6366f1', display: 'inline-flex', alignItems: 'center', flexShrink: 0,
            }}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
