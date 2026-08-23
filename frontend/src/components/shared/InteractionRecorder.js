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
import { dayChoices, dayOffset, combine, minTimeFor, isPast, startOfDay, toTimeInput }
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
// A row of REAL DAYS and a free time field. Two controls, no arithmetic, no
// assumptions about when a manager is willing to see anyone.
//
// The version this replaces offered "Today / Tomorrow / Day after / Monday" and
// fixed 2-hour slots. Both were wrong, and the owner caught both on the first
// day of real use (23-Aug-2026):
//
//   - On a SUNDAY, "Tomorrow" and "Monday" are the same day. Two chips, one
//     meaning. Relative words also make the reader do arithmetic to answer
//     "which date is that?" — so days are now named outright: "Mon 25".
//   - "we cannot assume that the manager/owner will give us slot at exactly
//     2 hour apart" — exactly right. An owner says 11:30 or 4:15, so the time is
//     a plain time field that accepts any minute, not a menu of five options.
//
// Past times are refused rather than accepted-and-hidden: on today, the field
// carries a `min` of now, and a stale pair is caught before saving.
function AppointmentPicker({ value, onChange, tc }) {
  const current = value ? new Date(value) : null;
  const valid   = current && !Number.isNaN(current.getTime());

  // A day is chosen as soon as a value exists; the time may still be midnight,
  // which is how "day picked, time not yet" is represented.
  const chosenDay  = valid ? startOfDay(current) : null;
  const chosenTime = valid && !(current.getHours() === 0 && current.getMinutes() === 0)
    ? toTimeInput(current) : '';

  const days = dayChoices(14);
  const offset = valid ? dayOffset(current) : null;

  const pickDay  = (d) => onChange(combine(d, chosenTime));
  const pickTime = (t) => onChange(combine(chosenDay || startOfDay(new Date()), t));

  const stale = isPast(value);

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

      {/* Real dates, scrolled sideways. Nothing here needs working out. */}
      <div className="lead-rail" style={{
        display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 10,
      }}>
        {days.map((d) => {
          const active = offset === d.offset;
          return (
            <button key={d.offset} type="button" onClick={() => pickDay(d.date)} style={{
              flexShrink: 0, width: 58, padding: '7px 0', borderRadius: 10, cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'center',
              border: `1.5px solid ${active ? '#1a1a1a' : '#ddd'}`,
              background: active ? '#1a1a1a' : '#fff',
              color: active ? '#fff' : '#444',
            }}>
              <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, opacity: .75 }}>
                {d.isToday ? tc('lead.dayToday', 'Today') : d.weekday}
              </span>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 800, lineHeight: 1.25 }}>
                {d.day}
              </span>
              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, opacity: .6 }}>
                {d.month}
              </span>
            </button>
          );
        })}
      </div>

      {/* Any time the owner actually offers — 11:30, 4:15, whatever was said. */}
      <input
        type="time"
        value={chosenTime}
        min={minTimeFor(chosenDay) || undefined}
        onChange={(e) => pickTime(e.target.value)}
        style={{
          width: '100%', padding: '11px 12px', border: '1.5px solid #ddd', borderRadius: 9,
          fontSize: 16, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
          background: '#fff', color: chosenTime ? '#1a1a1a' : '#888',
        }}
      />

      {/* Says the choice back in words, so a mis-tap is caught here rather than
          discovered when nobody is at the outlet. */}
      {valid && chosenTime && (
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, borderRadius: 8, padding: '8px 11px',
          background: stale ? '#fef2f2' : '#eef2ff',
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: stale ? '#991b1b' : '#3730a3' }}>
            {stale ? tc('lead.apptPast', 'That time has passed — pick another.')
                   : current.toLocaleString('en-IN', {
                       weekday: 'short', day: '2-digit', month: 'short',
                       hour: '2-digit', minute: '2-digit', hour12: true,
                     })}
          </span>
          <button type="button" onClick={() => onChange('')}
            aria-label={tc('lead.clearAppointment', 'Clear appointment')}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: stale ? '#dc2626' : '#6366f1', display: 'inline-flex',
              alignItems: 'center', flexShrink: 0,
            }}><X size={16} /></button>
        </div>
      )}

      {/* A day with no time is not yet an appointment; say so rather than
          silently filing midnight. */}
      {valid && !chosenTime && (
        <p style={{ fontSize: 12, color: '#888', margin: '8px 0 0' }}>
          {tc('lead.pickTimeToo', 'Now pick a time.')}
        </p>
      )}
    </div>
  );
}
