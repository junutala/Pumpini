'use client';
// components/admin/LeadRail.js
//
// The owner's working view of the lead pipeline: one lead per card in a
// left-right rail, its running interaction history beneath, and the same
// record-and-transcribe control the field temp uses to add the next visit.
//
// The arrows ARE the indicator — they appear only on a side where another record
// actually exists, so a permanently greyed pair never has to be read as "is
// there more?". They stay in the layout when hidden so the rail does not change
// width as you reach either end.
//
// The table on the Leads tab is the overview; this is the working surface. Both
// read the same GET /leads and write through the same PATCH — no second writer.
import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Loader2, Phone, User } from 'lucide-react';
import InteractionRecorder from '../shared/InteractionRecorder';

// House rule: en-IN + Asia/Kolkata, never a raw ISO timestamp, never MM/DD.
const IST = { timeZone: 'Asia/Kolkata' };
const fmtDateTime = (d) => new Date(d).toLocaleString('en-IN', {
  ...IST, day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  ...IST, day: '2-digit', month: 'short', year: 'numeric',
});

const ORANGE = '#FF6B00';
const card = { background: '#fff', borderRadius: 12, border: '1px solid #e5e3de', padding: '1.1rem' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 700, color: '#666',
               textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 };

export default function LeadRail({ leads, statuses, adminFetch, tc, onChanged }) {
  const [idx, setIdx] = useState(0);
  const rail = useRef(null);

  // A lead deleted or filtered out from under us must not leave the rail
  // pointing past the end.
  useEffect(() => {
    if (idx > leads.length - 1) setIdx(Math.max(0, leads.length - 1));
  }, [leads.length, idx]);

  // Derive the active card from the scroll position rather than tracking it
  // separately — a swipe and an arrow tap then agree by construction.
  const onScroll = () => {
    const el = rail.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    setIdx(Math.max(0, Math.min(leads.length - 1, Math.round(el.scrollLeft / w))));
  };

  const go = (delta) => {
    const el = rail.current;
    if (!el) return;
    const next = Math.max(0, Math.min(leads.length - 1, idx + delta));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };

  if (!leads.length) {
    return <div style={{ ...card, textAlign: 'center', padding: '2.5rem', color: '#aaa' }}>
      {tc('adminp.noLeads', 'No leads')}
    </div>;
  }

  const active = leads[idx];

  const arrow = (dir, show) => (
    <button
      onClick={() => go(dir === 'prev' ? -1 : 1)}
      aria-label={dir === 'prev' ? tc('lead.previous', 'Previous lead') : tc('lead.next', 'Next lead')}
      style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0, fontFamily: 'inherit',
        border: '1px solid #e5e3de', background: '#fff', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#1a1a1a', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        visibility: show ? 'visible' : 'hidden',
      }}>
      {dir === 'prev' ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}
    </button>
  );

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 9, padding: '0 2px' }}>
        <span style={{ fontSize: 12.5, color: '#666', fontWeight: 600 }}>
          {tc('lead.leadOf', 'Lead')} {idx + 1} / {leads.length}
        </span>
        <span style={{ fontSize: 12, color: '#aaa' }}>
          {tc('lead.swipeHint', 'Swipe or use the arrows')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {arrow('prev', idx > 0)}
        <div
          ref={rail}
          onScroll={onScroll}
          className="lead-rail"
          style={{
            flex: 1, minWidth: 0, display: 'flex', overflowX: 'auto',
            scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
          }}>
          {leads.map(l => (
            <div key={l.id} style={{ flex: '0 0 100%', scrollSnapAlign: 'center', boxSizing: 'border-box' }}>
              <LeadCard lead={l} statuses={statuses} adminFetch={adminFetch} tc={tc} onChanged={onChanged} />
            </div>
          ))}
        </div>
        {arrow('next', idx < leads.length - 1)}
      </div>

      {/* Keyed on the lead id so switching cards remounts the log rather than
          showing the previous lead's history for a beat. */}
      <LeadLog key={active.id} lead={active} adminFetch={adminFetch} tc={tc} onChanged={onChanged} />

      <style jsx global>{`
        .lead-rail { scrollbar-width: none; -ms-overflow-style: none; }
        .lead-rail::-webkit-scrollbar { display: none; }
        .spin { animation: leadspin 1s linear infinite; }
        @keyframes leadspin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── One lead's card ──────────────────────────────────────────────────────────
function LeadCard({ lead: l, statuses, adminFetch, tc, onChanged }) {
  const meta = statuses.find(x => x[0] === l.status) || ['', '', '#f3f4f6', '#374151'];

  const setStatus = async (status) => {
    await adminFetch(`/leads/${l.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    onChanged?.();
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>
            <User size={16} color="#888" style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
          </div>
          <a href={`tel:${l.phone}`} style={{
            fontSize: 16, fontWeight: 700, color: '#1a1a1a', textDecoration: 'none',
            fontVariantNumeric: 'tabular-nums', marginTop: 4,
            display: 'inline-flex', alignItems: 'center', gap: 7,
          }}>
            <Phone size={15} color="#888" />{l.phone}
          </a>
        </div>
        <span style={{ background: meta[2], color: meta[3], borderRadius: 20, padding: '4px 11px',
                       fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {tc('adminp.leadStatus_' + l.status, meta[1] || l.status)}
        </span>
      </div>

      <div style={{ marginTop: 13, fontSize: 12.5, color: '#666', lineHeight: 1.75 }}>
        {(l.station_name || l.city || l.state) && (
          <div>{[l.station_name, l.city, l.state].filter(Boolean).join(' · ')}</div>
        )}
        <div>
          {tc('adminp.colSource', 'Source')}: <strong style={{ color: '#444' }}>
            {tc('adminp.leadSource_' + l.source, l.source)}
          </strong>
          {l.captured_by && <> · {tc('lead.capturedBy', 'by')} {l.captured_by}</>}
        </div>
        <div>{tc('lead.filedOn', 'Filed')} {fmtDate(l.created_at)}</div>
        {l.lat != null && l.lng != null && (
          <a href={`https://www.google.com/maps?q=${l.lat},${l.lng}`} target="_blank" rel="noreferrer"
             style={{ color: ORANGE, fontWeight: 700, textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={12} />{tc('lead.openMap', 'Open in Maps')}
          </a>
        )}
      </div>

      <div style={{ marginTop: 13 }}>
        <label style={lbl}>{tc('adminp.status', 'Status')}</label>
        <select value={l.status} onChange={e => setStatus(e.target.value)} style={{
          width: '100%', padding: '9px 11px', border: '1.5px solid #ddd', borderRadius: 8,
          fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
        }}>
          {statuses.map(([v, label]) => (
            <option key={v} value={v}>{tc('adminp.leadStatus_' + v, label)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── The running log, plus the control that adds to it ────────────────────────
function LeadLog({ lead, adminFetch, tc, onChanged }) {
  const [items, setItems]   = useState(null);   // null = still loading
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const load = useCallback(async () => {
    const data = await adminFetch(`/leads/${lead.id}/interactions`);
    setItems(data?.interactions || []);
  }, [lead.id, adminFetch]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const body = note.trim();
    if (!body) return;
    setErr('');
    setSaving(true);
    try {
      const data = await adminFetch(`/leads/${lead.id}/interactions`, {
        method: 'POST', body: JSON.stringify({ note: body }),
      });
      // adminFetch swallows non-JSON/5xx into null, so an empty reply is a
      // failure, not an empty success — say so rather than clearing the note the
      // owner just dictated.
      if (!data || data.error) throw new Error(data?.error || tc('lead.saveFailed', 'Could not save. Try again.'));
      setNote('');
      await load();
      onChanged?.();          // refresh counts on the card and the table
    } catch (e) {
      setErr(e?.message || tc('lead.saveFailed', 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  // A lead captured before the interaction log existed kept its note in
  // `message`. Show it as the opening entry so nothing is invisible, and label it
  // for what it is rather than pretending it is a logged visit.
  const legacy = !items?.length && lead.message ? lead.message : null;

  return (
    <div>
      <div style={{ ...card, marginBottom: 12 }}>
        <label style={lbl}>{tc('lead.addInteraction', 'Add an interaction')}</label>
        <InteractionRecorder
          value={note} onChange={setNote} tc={tc}
          placeholder={tc('lead.addInteractionPlaceholder', 'What was said this time. Record it, or type it here.')}
        />
        {err && <p style={{ color: '#b91c1c', fontSize: 12.5, margin: '7px 0 0' }}>{err}</p>}
        <button onClick={add} disabled={!note.trim() || saving} style={{
          width: '100%', marginTop: 12, height: 44, borderRadius: 9, border: 'none', fontFamily: 'inherit',
          background: note.trim() && !saving ? ORANGE : '#e5e3de',
          color: note.trim() && !saving ? '#fff' : '#999',
          fontSize: 14.5, fontWeight: 800, cursor: note.trim() && !saving ? 'pointer' : 'not-allowed',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {saving ? <><Loader2 size={16} className="spin" />{tc('lead.saving', 'Saving…')}</> : tc('lead.addToLog', 'ADD TO LOG')}
        </button>
      </div>

      <div style={{ ...lbl, marginBottom: 9, paddingLeft: 2 }}>{tc('lead.history', 'History')}</div>

      {items === null ? (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 13.5 }}>
          <Loader2 size={15} className="spin" />{tc('lead.loadingHistory', 'Loading…')}
        </div>
      ) : legacy ? (
        <div style={{ ...card, padding: '0.9rem 1rem' }}>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 700, marginBottom: 5 }}>
            {fmtDateTime(lead.created_at)} · {tc('lead.originalEnquiry', 'Original enquiry')}
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{lead.message}</div>
        </div>
      ) : !items.length ? (
        <div style={{ ...card, color: '#888', fontSize: 13.5, textAlign: 'center', padding: '1.6rem 1.1rem' }}>
          {tc('lead.noInteractions', 'Nothing logged against this lead yet.')}
        </div>
      ) : items.map(it => (
        <div key={it.id} style={{ ...card, padding: '0.9rem 1rem', marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 700, marginBottom: 5 }}>
            {fmtDateTime(it.created_at)}{it.captured_by ? ` · ${it.captured_by}` : ''}
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{it.note}</div>
          {it.lat != null && it.lng != null && (
            <a href={`https://www.google.com/maps?q=${it.lat},${it.lng}`} target="_blank" rel="noreferrer"
               style={{ color: ORANGE, fontWeight: 700, textDecoration: 'none', fontSize: 12,
                        display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 7 }}>
              <MapPin size={11} />{tc('lead.openMap', 'Open in Maps')}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
