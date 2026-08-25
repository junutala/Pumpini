'use client';
// components/admin/ActivityFeed.js
//
// Every interaction across every lead, newest first, grouped by day.
//
// WHY THIS EXISTS. The rail files an interaction under its outlet and shows one
// outlet at a time. That is right when you are working a single lead — and
// useless first thing in the morning, when the question is "what happened
// yesterday". On 25-Aug the owner's ten notes from one afternoon sat across
// SEVEN leads, so nine of them were twelve swipes away and read as lost.
//
// Two questions, two views. The rail answers "what is the story of this outlet".
// This answers "what did I do", which is what gets asked at 9am.
import { MapPin, CalendarClock, ChevronRight, Phone } from 'lucide-react';
import { leadHeading, ownerSubtitle, phoneHref } from '../../lib/lead';

const ORANGE = '#FF6B00';
const IST = { timeZone: 'Asia/Kolkata' };

const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', {
  ...IST, hour: '2-digit', minute: '2-digit', hour12: true,
});
const fmtWhen = (d) => new Date(d).toLocaleString('en-IN', {
  ...IST, weekday: 'short', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', IST);

// "Today" and "Yesterday" earn their words here, unlike in the appointment
// picker: a heading is read once, not chosen from, so there is nothing to
// mistake it for.
const dayLabel = (key, tc) => {
  const today = new Date().toLocaleDateString('en-CA', IST);
  const yest  = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', IST);
  if (key === today) return tc('lead.today', 'Today');
  if (key === yest)  return tc('lead.yesterday', 'Yesterday');
  return new Date(key + 'T00:00:00').toLocaleDateString('en-IN', {
    ...IST, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
};

export default function ActivityFeed({ interactions, tc, onOpen }) {
  if (!interactions.length) {
    return (
      <div style={{
        background: '#fff', borderRadius: 12, border: '1px solid #e5e3de',
        textAlign: 'center', padding: '2.5rem 1.1rem', color: '#aaa', fontSize: 14,
      }}>{tc('lead.noActivity', 'Nothing recorded yet.')}</div>
    );
  }

  // Grouped in one pass; the server already ordered them newest-first, so the
  // groups come out in order without sorting anything again.
  const days = [];
  for (const it of interactions) {
    const k = dayKey(it.created_at);
    if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, items: [] });
    days[days.length - 1].items.push(it);
  }

  return (
    <div style={{ maxWidth: 700 }}>
      {days.map(day => (
        <div key={day.key} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11.5, fontWeight: 800, color: '#666', textTransform: 'uppercase',
            letterSpacing: '.04em', marginBottom: 8, paddingLeft: 2,
          }}>
            {dayLabel(day.key, tc)}
            <span style={{ fontWeight: 500, color: '#aaa', textTransform: 'none', letterSpacing: 0 }}>
              {' '}· {day.items.length}
            </span>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {day.items.map(it => (
              <div key={it.id}
                onClick={onOpen ? () => onOpen(it.lead_id) : undefined}
                role={onOpen ? 'button' : undefined}
                style={{
                  background: '#fff', borderRadius: 12, border: '1px solid #e5e3de',
                  padding: '0.85rem 1rem', cursor: onOpen ? 'pointer' : 'default',
                }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    {/* The OUTLET leads. In a chronological feed the outlet is
                        what places the note; the time alone places nothing. */}
                    <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3 }}>
                      {leadHeading(it) || <span style={{ color: '#ccc' }}>—</span>}
                    </div>
                    {ownerSubtitle(it) && (
                      <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{ownerSubtitle(it)}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: '#888', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {fmtTime(it.created_at)}
                    </span>
                    {onOpen && <ChevronRight size={16} color="#c4c4c4" />}
                  </div>
                </div>

                <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 7, whiteSpace: 'pre-wrap' }}>
                  {it.note}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                  {it.appointment_at && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: '#eef2ff', color: '#3730a3', borderRadius: 7,
                      padding: '3px 9px', fontSize: 11.5, fontWeight: 700,
                    }}>
                      <CalendarClock size={12} />{fmtWhen(it.appointment_at)}
                    </span>
                  )}
                  {phoneHref(it) && (
                    <a href={phoneHref(it)} onClick={e => e.stopPropagation()} style={{
                      color: '#1a1a1a', textDecoration: 'none', fontSize: 12.5, fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}><Phone size={12} color="#888" />{it.phone}</a>
                  )}
                  {it.lat != null && it.lng != null && (
                    <a href={`https://www.google.com/maps?q=${it.lat},${it.lng}`}
                       target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                       style={{ color: ORANGE, fontWeight: 700, textDecoration: 'none', fontSize: 12.5,
                                display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <MapPin size={12} />{tc('adminp.colMap', 'Map')}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
