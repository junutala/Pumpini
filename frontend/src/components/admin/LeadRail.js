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
import { ChevronLeft, ChevronRight, MapPin, Loader2, Phone, User, CalendarClock,
         UserPlus, Download, Trash2, X, AlertTriangle } from 'lucide-react';
import InteractionRecorder from '../shared/InteractionRecorder';
import { toInstant } from '../../lib/appointment';
import { leadTitle, phoneHref, outletSubtitle } from '../../lib/lead';
import { saveContact } from '../../lib/vcard';

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

export default function LeadRail({ leads, statuses, adminFetch, tc, onChanged, focusLeadId }) {
  const [idx, setIdx] = useState(0);
  const rail = useRef(null);
  // Which focus request has already been honoured. Without this the effect
  // re-fires every time `leads` is refetched and would yank the rail back to the
  // appointment's lead while the owner is swiping away from it.
  const applied = useRef(null);

  // A lead deleted or filtered out from under us must not leave the rail
  // pointing past the end.
  useEffect(() => {
    if (idx > leads.length - 1) setIdx(Math.max(0, leads.length - 1));
  }, [leads.length, idx]);

  // Arriving from an appointment: jump straight to that lead so its history can
  // be read on the way into the meeting. Honoured ONCE per request — a silent
  // no-op if the lead is not in the current list (filtered out, or deleted),
  // which is better than snapping to the wrong card.
  useEffect(() => {
    if (!focusLeadId || applied.current === focusLeadId) return;
    const i = leads.findIndex(l => l.id === focusLeadId);
    if (i < 0) return;
    applied.current = focusLeadId;
    setIdx(i);
    // The rail may not be laid out on the first paint, and scrolling by a width
    // of 0 lands everywhere on card one. Wait for a frame.
    requestAnimationFrame(() => {
      const el = rail.current;
      if (el?.clientWidth) el.scrollTo({ left: i * el.clientWidth, behavior: 'auto' });
    });
  }, [focusLeadId, leads]);

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
          {/* A refused or unattended visit has no owner — the outlet off the
              board is the name. This printed a bare icon and nothing else. */}
          <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>
            <User size={16} color="#888" style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {leadTitle(l) || <span style={{ color: '#ccc', fontWeight: 600 }}>—</span>}
            </span>
          </div>

        </div>
        <span style={{ background: meta[2], color: meta[3], borderRadius: 20, padding: '4px 11px',
                       fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {tc('adminp.leadStatus_' + l.status, meta[1] || l.status)}
        </span>
      </div>

      <div style={{ marginTop: 13, fontSize: 12.5, color: '#666', lineHeight: 1.75 }}>
        {(outletSubtitle(l) || l.city || l.state) && (
          <div>{[outletSubtitle(l), l.city, l.state].filter(Boolean).join(' · ')}</div>
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

      <LeadContacts lead={l} adminFetch={adminFetch} tc={tc} />

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

// ── Contacts on a lead ───────────────────────────────────────────────────────
//
// An outlet has people, not a person. The field brings one — usually whoever was
// behind the counter — and the owner turns up later, or does not. Holding both
// is the point: the manager is often the one who actually lets you in.
//
// Only on the OWNER's screen. The temp's form stays one number and done: "He
// brings me one contact - job done. Owner - better, Manager - good. Period."
// (owner, 23-Aug-2026). Roles are written into the name — "Satish - Manager" —
// because that is how he already writes them, and a role dropdown is one more
// decision on a forecourt for no gain.
function LeadContacts({ lead, adminFetch, tc }) {
  const [items, setItems]   = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName]     = useState('');
  const [phone, setPhone]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  const load = useCallback(async () => {
    const d = await adminFetch(`/leads/${lead.id}/contacts`);
    // Same rule as the history: a failure must not read as "no contacts".
    if (!d || d.error) {
      setItems(null);
      setErr(d?.error === 'SESSION_EXPIRED'
        ? tc('lead.sessionExpired', 'Your session ended. Sign in again — nothing has been lost.')
        : tc('lead.contactsFailed', 'Could not load contacts.'));
      return;
    }
    setItems(Array.isArray(d.contacts) ? d.contacts : []);
  }, [lead.id, adminFetch, tc]);

  useEffect(() => { load(); }, [load]);

  // TRANSITIONAL, and it earns its keep twice. This panel replaced the single
  // phone line on the card, so before the lead_contacts DDL is run — or before
  // its backfill reaches a row — every lead would otherwise read "No number yet"
  // even when it plainly has one. Falling back to the lead's own name/phone
  // keeps the card TRUE whichever side of the migration we are on.
  //
  // It is not a second home for a contact: it is read-only (no id to delete),
  // and it disappears the moment a real row exists.
  const fallback = (!items?.length && (lead.name || lead.phone))
    ? [{ id: null, name: lead.name, phone: lead.phone, fromLead: true }]
    : [];
  const rows = items?.length ? items : fallback;

  const ready = name.trim() || phone.trim();

  const add = async () => {
    if (!ready) return;
    setErr(''); setBusy(true);
    try {
      const d = await adminFetch(`/leads/${lead.id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || null, phone: phone.trim() || null }),
      });
      if (!d || d.error) throw new Error(d?.error || tc('lead.saveFailed', 'Could not save. Try again.'));
      setName(''); setPhone(''); setAdding(false);
      await load();
    } catch (e) {
      setErr(e?.message || tc('lead.saveFailed', 'Could not save. Try again.'));
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm(tc('lead.removeContactConfirm', 'Remove this contact?'))) return;
    await adminFetch(`/leads/${lead.id}/contacts/${id}`, { method: 'DELETE' });
    await load();
  };

  const download = (c) => {
    if (!saveContact(c, lead)) {
      setErr(tc('lead.vcardFailed', 'Your browser blocked the download. Try again, or copy the number.'));
    }
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ ...lbl, marginBottom: 0 }}>{tc('lead.contacts', 'Contacts')}</span>
        <button onClick={() => { setAdding(a => !a); setErr(''); }} style={{
          background: 'none', border: 'none', color: ORANGE, fontSize: 12.5, fontWeight: 700,
          cursor: 'pointer', padding: 0, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          {adding ? <><X size={13} />{tc('lead.cancel', 'Cancel')}</>
                  : <><UserPlus size={13} />{tc('lead.addContact', 'Add contact')}</>}
        </button>
      </div>

      {items === null ? (
        <div style={{ fontSize: 13, color: '#aaa', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Loader2 size={13} className="spin" />{tc('lead.loadingContacts', 'Loading…')}
        </div>
      ) : !rows.length && !adding ? (
        <div style={{ fontSize: 13, color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Phone size={13} color="#ccc" />{tc('lead.noNumberYet', 'No number yet')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {rows.map(c => (
            <div key={c.id || 'from-lead'} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: '#faf9f7', border: '1px solid #eee', borderRadius: 9, padding: '8px 10px',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                {c.name && (
                  <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                )}
                {/* Same rule as everywhere: no link unless there is something to
                    dial, or the dialer gets handed the word "null". */}
                {phoneHref(c) ? (
                  <a href={phoneHref(c)} style={{
                    fontSize: 14.5, fontWeight: 700, color: '#1a1a1a', textDecoration: 'none',
                    fontVariantNumeric: 'tabular-nums',
                    display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 1,
                  }}><Phone size={13} color="#888" />{c.phone}</a>
                ) : (
                  <div style={{ fontSize: 12.5, color: '#bbb', marginTop: 1 }}>
                    {tc('lead.noNumberYet', 'No number yet')}
                  </div>
                )}
              </div>

              {phoneHref(c) && (
                <button onClick={() => download(c)}
                  title={tc('lead.saveToPhone', 'Save to phone')}
                  aria-label={tc('lead.saveToPhone', 'Save to phone')}
                  style={{
                    width: 34, height: 34, flexShrink: 0, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid #e5e3de', background: '#fff', color: '#444',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}><Download size={15} /></button>
              )}
              {/* No id means this is the lead's own name/phone shown through the
                  fallback above — there is no row to delete. */}
              {c.id && (
                <button onClick={() => remove(c.id)}
                  aria-label={tc('lead.removeContact', 'Remove contact')}
                  style={{
                    width: 34, height: 34, flexShrink: 0, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid #fee2e2', background: '#fff', color: '#991b1b',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 9, display: 'grid', gap: 7 }}>
          <input value={name} onChange={e => setName(e.target.value)} autoComplete="off"
            placeholder={tc('lead.contactNamePlaceholder', 'Name — e.g. Satish - Manager')}
            style={{ width: '100%', padding: '10px 11px', border: '1.5px solid #ddd', borderRadius: 8,
                     fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          <input value={phone} onChange={e => setPhone(e.target.value.replace(/[^0-9+ ]/g, ''))}
            inputMode="tel" autoComplete="off"
            placeholder={tc('lead.contactPhonePlaceholder', 'Mobile number')}
            style={{ width: '100%', padding: '10px 11px', border: '1.5px solid #ddd', borderRadius: 8,
                     fontSize: 16, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                     fontVariantNumeric: 'tabular-nums' }} />
          <button onClick={add} disabled={busy || !ready} style={{
            height: 40, borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
            background: !busy && ready ? ORANGE : '#e5e3de',
            color: !busy && ready ? '#fff' : '#999',
            cursor: !busy && ready ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            {busy ? <><Loader2 size={15} className="spin" />{tc('lead.saving', 'Saving…')}</>
                  : tc('lead.saveContact', 'Save contact')}
          </button>
        </div>
      )}

      {err && <p style={{ color: '#b91c1c', fontSize: 12.5, margin: '7px 0 0' }}>{err}</p>}
    </div>
  );
}

// ── The running log, plus the control that adds to it ────────────────────────
function LeadLog({ lead, adminFetch, tc, onChanged }) {
  const [items, setItems]   = useState(null);   // null = still loading
  const [note, setNote]     = useState('');
  const [appt, setAppt]     = useState('');   // datetime-local string
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const [loadErr, setLoadErr] = useState('');

  // A failed fetch is a FAILURE, never an empty history. This used to be
  // `setItems(data?.interactions || [])`, so a rejected session rendered as
  // "Nothing logged against this lead yet" — and a day of real interactions
  // looked deleted.
  const load = useCallback(async () => {
    setLoadErr('');
    const data = await adminFetch(`/leads/${lead.id}/interactions`);
    if (!data || data.error) {
      setItems(null);
      setLoadErr(data?.error === 'SESSION_EXPIRED'
        ? tc('lead.sessionExpired', 'Your session ended. Sign in again — nothing has been lost.')
        : tc('lead.historyFailed', 'Could not load the history. Nothing is lost — tap to retry.'));
      return;
    }
    setItems(data.interactions || []);
  }, [lead.id, adminFetch, tc]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const body = note.trim();
    // An appointment with no words is still worth filing — "seeing him Tuesday"
    // is the note. toInstant is the single rule for whether the picker's value
    // is a real appointment (a day with no time yet does not count).
    const at = toInstant(appt);
    if (!body && !at) return;
    setErr('');
    setSaving(true);
    try {
      const data = await adminFetch(`/leads/${lead.id}/interactions`, {
        method: 'POST',
        body: JSON.stringify({
          note: body || tc('lead.apptOnlyNote', 'Appointment set.'),
          appointment_at: at,
        }),
      });
      // adminFetch swallows non-JSON/5xx into null, so an empty reply is a
      // failure, not an empty success — say so rather than clearing the note the
      // owner just dictated.
      if (!data || data.error) throw new Error(data?.error || tc('lead.saveFailed', 'Could not save. Try again.'));
      setNote(''); setAppt('');
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
          appointment={appt} onAppointmentChange={setAppt}
        />
        {err && <p style={{ color: '#b91c1c', fontSize: 12.5, margin: '7px 0 0' }}>{err}</p>}
        <button onClick={add} disabled={(!note.trim() && !appt) || saving} style={{
          width: '100%', marginTop: 12, height: 44, borderRadius: 9, border: 'none', fontFamily: 'inherit',
          background: (note.trim() || appt) && !saving ? ORANGE : '#e5e3de',
          color: (note.trim() || appt) && !saving ? '#fff' : '#999',
          fontSize: 14.5, fontWeight: 800,
          cursor: (note.trim() || appt) && !saving ? 'pointer' : 'not-allowed',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {saving ? <><Loader2 size={16} className="spin" />{tc('lead.saving', 'Saving…')}</> : tc('lead.addToLog', 'ADD TO LOG')}
        </button>
      </div>

      <div style={{ ...lbl, marginBottom: 9, paddingLeft: 2 }}>{tc('lead.history', 'History')}</div>

      {loadErr ? (
        <div style={{ ...card, background: '#fff7ed', border: '1px solid #fed7aa' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={16} color="#9a3412" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 13.5, color: '#9a3412', lineHeight: 1.5 }}>
              {loadErr}
              <button onClick={load} style={{
                display: 'block', marginTop: 7, background: 'none', border: 'none', padding: 0,
                color: ORANGE, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>{tc('lead.retry', 'Try again')}</button>
            </div>
          </div>
        </div>
      ) : items === null ? (
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
          {it.appointment_at && (
            <div style={{
              marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 5,
              background: '#eef2ff', color: '#3730a3', borderRadius: 7,
              padding: '3px 9px', fontSize: 12, fontWeight: 700,
            }}>
              <CalendarClock size={12} />{fmtDateTime(it.appointment_at)}
            </div>
          )}
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
