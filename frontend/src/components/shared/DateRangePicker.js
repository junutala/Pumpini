'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronDown } from 'lucide-react';

const toIST = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const todayIST = () => toIST(new Date());
const label = (from, to) => {
  const t = todayIST();
  if (from === t && to === t) return 'Today';
  const y = toIST(new Date(Date.now() - 86400000));
  if (from === y && to === y) return 'Yesterday';
  if (from === toIST(new Date(new Date().setDate(new Date().getDate() - 6))) && to === t) return 'Last 7 days';
  if (from === toIST(new Date(new Date().setDate(1))) && to === t) return 'This month';
  const lms = new Date(); lms.setDate(0);
  const lmf = new Date(lms); lmf.setDate(1);
  if (from === toIST(lmf) && to === toIST(lms)) return 'Last month';
  return `${from} → ${to}`;
};

export default function DateRangePicker({ from, to, onChange }) {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);

  const today      = todayIST();
  const yesterday  = toIST(new Date(Date.now() - 86400000));
  const last7      = toIST(new Date(new Date().setDate(new Date().getDate() - 6)));
  const monthStart = toIST(new Date(new Date().setDate(1)));

  const lastMonthEnd   = new Date(); lastMonthEnd.setDate(0);
  const lastMonthStart = new Date(lastMonthEnd); lastMonthStart.setDate(1);

  const PRESETS = [
    { label: 'Today',      from: today,                    to: today },
    { label: 'Yesterday',  from: yesterday,                to: yesterday },
    { label: 'Last 7 days',from: last7,                    to: today },
    { label: 'This month', from: monthStart,               to: today },
    { label: 'Last month', from: toIST(lastMonthStart),    to: toIST(lastMonthEnd) },
  ];

  const select = (f, t) => { onChange(f, t); setOpen(false); setCustom(false); };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', background: '#fff',
          border: '1.5px solid var(--border)', borderRadius: 8,
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
          color: 'var(--text-1)',
        }}>
        <Calendar size={14} color="var(--brand)" />
        {label(from, to)}
        <ChevronDown size={14} style={{ opacity: .5 }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => { setOpen(false); setCustom(false); }} />
          <div style={{
            position: 'absolute', top: '110%', right: 0, zIndex: 200,
            background: '#fff', borderRadius: 10, padding: '0.5rem',
            boxShadow: '0 8px 32px rgba(0,0,0,.15)',
            border: '1px solid var(--border)', minWidth: 200,
          }}>
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => select(p.from, p.to)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 14px', border: 'none', borderRadius: 6,
                  cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  background: from === p.from && to === p.to ? 'var(--brand-light, #fff3e0)' : 'transparent',
                  color: from === p.from && to === p.to ? 'var(--brand)' : 'var(--text-1)',
                }}>
                {p.label}
              </button>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            <button onClick={() => setCustom(p => !p)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 14px', border: 'none', borderRadius: 6,
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                background: custom ? 'var(--surface-2)' : 'transparent',
              }}>
              Custom range…
            </button>
            {custom && (
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', width: 30 }}>{tc('daterange.from','From')}</label>
                  <input type="date" className="input" style={{ flex: 1, fontSize: 12 }}
                    value={from} max={today}
                    onChange={e => onChange(e.target.value, to)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', width: 30 }}>{tc('daterange.to','To')}</label>
                  <input type="date" className="input" style={{ flex: 1, fontSize: 12 }}
                    value={to} max={today}
                    onChange={e => onChange(from, e.target.value)} />
                </div>
                <button className="btn btn-primary btn-sm"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 2 }}
                  onClick={() => { setOpen(false); setCustom(false); }}>
                  Apply
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

