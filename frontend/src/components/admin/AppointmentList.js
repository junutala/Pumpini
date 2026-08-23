'use client';
// components/admin/AppointmentList.js
//
// ONE upcoming-appointments list. Two screens need it and must not grow two
// copies (CLAUDE.md: reuse the form, do not open a new route):
//
//   • /admin  -> Appointments tab, at a desk
//   • /lead   -> the owner's third tab, on a phone between visits
//
// Both read the same GET /superadmin/appointments, which has already dropped the
// past ones and ordered them soonest-first. No screen does date arithmetic of
// its own, so "upcoming" means exactly one thing.
//
// `compact` is a LAYOUT switch only — never a different set of rows. A phone gets
// stacked cards with the phone number as a tap-to-call target; a desk gets the
// table. The same fields either way.
import { MapPin, Phone, CalendarClock, ChevronRight } from 'lucide-react';
import { leadTitle, phoneHref, outletSubtitle, callableContacts } from '../../lib/lead';

const ORANGE = '#FF6B00';

// Mirrors the pipeline colours on /admin so a status means the same thing here.
const STATUS = {
  new:       ['#dbeafe', '#1d4ed8'], revisit:   ['#ffedd5', '#9a3412'],
  contacted: ['#fef9c3', '#854d0e'], trial:     ['#ede9fe', '#5b21b6'],
  converted: ['#dcfce7', '#15803d'], refused:   ['#ffe4e6', '#9f1239'],
  lost:      ['#fee2e2', '#991b1b'],
};

// House rule: en-IN + Asia/Kolkata, never a raw ISO timestamp, never MM/DD.
const IST = { timeZone: 'Asia/Kolkata' };
const fmtWhen = (d) => new Date(d).toLocaleString('en-IN', {
  ...IST, weekday: 'short', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
const isToday = (d) =>
  new Date(d).toLocaleDateString('en-CA', IST) === new Date().toLocaleDateString('en-CA', IST);

// Naming and dialling both come from lib/lead, so this screen and the rail
// cannot disagree about a lead with no owner or no number.


const TodayBadge = ({ tc }) => (
  <span style={{
    fontSize: 10.5, fontWeight: 800, background: '#fee2e2', color: '#991b1b',
    borderRadius: 99, padding: '1px 7px', whiteSpace: 'nowrap',
  }}>{tc('adminp.today', 'TODAY')}</span>
);

const MapLink = ({ a, tc, size = 11, onClick }) => (
  a.lat != null && a.lng != null ? (
    <a href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer"
       onClick={onClick}
       style={{ color: ORANGE, fontWeight: 700, textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
      <MapPin size={size} />{tc('adminp.colMap', 'Map')}
    </a>
  ) : <span style={{ color: '#ccc' }}>—</span>
);

export default function AppointmentList({ appointments, tc, compact = false, onOpen }) {
  // Opening a row jumps to that lead's card, so the history can be read on the
  // way in. The phone number and the map link keep their own jobs — without
  // stopPropagation a thumb aiming at "call" would navigate away instead.
  const open = (id) => (e) => { e.stopPropagation(); onOpen?.(id); };
  const stop = (e) => e.stopPropagation();
  const clickable = !!onOpen;
  if (!appointments.length) {
    return (
      <div style={{
        background: '#fff', borderRadius: 12, border: '1px solid #e5e3de',
        textAlign: 'center', padding: '2.5rem 1.1rem', color: '#aaa', fontSize: 14,
      }}>{tc('adminp.noAppointments', 'Nothing scheduled')}</div>
    );
  }

  if (compact) {
    return (
      <div style={{ display: 'grid', gap: 9 }}>
        {appointments.map(a => {
          const st = STATUS[a.status] || ['#f3f4f6', '#374151'];
          return (
            <div key={a.lead_id}
              onClick={clickable ? open(a.lead_id) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') open(a.lead_id)(e); } : undefined}
              style={{
                background: '#fff', borderRadius: 12, border: '1px solid #e5e3de', padding: '0.9rem 1rem',
                cursor: clickable ? 'pointer' : 'default',
              }}>

              {/* When */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <CalendarClock size={14} color="#3730a3" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, fontWeight: 800, color: '#3730a3' }}>{fmtWhen(a.appointment_at)}</span>
                {isToday(a.appointment_at) && <TodayBadge tc={tc} />}
              </div>

              {/* Who — the outlet is what a person recognises on a road, so it
                  leads whenever there is no owner name. */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.3 }}>
                    {leadTitle(a) || <span style={{ color: '#ccc' }}>—</span>}
                  </div>
                  {outletSubtitle(a) && (
                    <div style={{ fontSize: 12.5, color: '#888', marginTop: 1 }}>{outletSubtitle(a)}</div>
                  )}
                </div>
                {clickable && <ChevronRight size={17} color="#c4c4c4" style={{ flexShrink: 0, marginTop: 2 }} />}
              </div>

              {a.status && (
                <span style={{
                  display: 'inline-block', marginTop: 7, background: st[0], color: st[1],
                  borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700,
                }}>{tc('adminp.leadStatus_' + a.status, a.status)}</span>
              )}

              {/* Every number on the outlet, each one dialable. */}
              <div style={{ display: 'grid', gap: 6, marginTop: 9 }}>
                {callableContacts(a).map((c, i) => (
                  <a key={c.id || i} href={phoneHref(c)} onClick={stop} style={{
                    color: '#1a1a1a', textDecoration: 'none', fontSize: 14,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <Phone size={13} color="#888" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.phone}</span>
                    {c.name && <span style={{ fontSize: 12, color: '#888' }}>{c.name}</span>}
                  </a>
                ))}
                {!callableContacts(a).length && (
                  <span style={{ fontSize: 12.5, color: '#bbb', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={13} color="#ddd" />{tc('lead.noNumberYet', 'No number yet')}
                  </span>
                )}
                <div><MapLink a={a} tc={tc} size={12} onClick={stop} /></div>
              </div>

              {/* What was last said. Without it the tile is a time and a number,
                  and the owner walks in having to remember why he is there. */}
              {a.note && (
                <div style={{
                  marginTop: 9, paddingTop: 8, borderTop: '1px dashed #eee',
                  fontSize: 12.5, color: '#666', lineHeight: 1.55,
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{a.note}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e3de', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr style={{ background: '#f8f7f5' }}>
          {[tc('adminp.colWhen', 'When'), tc('adminp.colWho', 'Who'),
            tc('adminp.colPhone', 'Phone'), tc('adminp.colMap', 'Map')].map((h, i) => (
            <th key={i} style={{
              padding: '9px 12px', textAlign: 'left', color: '#666', fontWeight: 600,
              fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e3de',
              whiteSpace: 'nowrap',
            }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {appointments.map(a => (
            <tr key={a.lead_id}
              onClick={clickable ? open(a.lead_id) : undefined}
              style={{ borderBottom: '1px solid #f0f0f0', cursor: clickable ? 'pointer' : 'default' }}>
              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtWhen(a.appointment_at)}</span>
                {isToday(a.appointment_at) && <span style={{ marginLeft: 7 }}><TodayBadge tc={tc} /></span>}
              </td>
              <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13.5 }}>
                {leadTitle(a) || <span style={{ color: '#ccc' }}>—</span>}
                {outletSubtitle(a) && (
                  <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: '#888' }}>{outletSubtitle(a)}</span>
                )}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>
                {callableContacts(a).length
                  ? callableContacts(a).map((c, i) => (
                      <div key={c.id || i} style={{ marginTop: i ? 3 : 0 }}>
                        <a href={phoneHref(c)} onClick={stop}
                           style={{ color: '#1a1a1a', textDecoration: 'none', fontFamily: 'monospace' }}>{c.phone}</a>
                        {c.name && <span style={{ marginLeft: 7, fontSize: 11.5, color: '#888' }}>{c.name}</span>}
                      </div>
                    ))
                  : <span style={{ color: '#ccc' }}>—</span>}
              </td>
              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                <MapLink a={a} tc={tc} onClick={stop} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
