'use client';
// SPOKE 2 — NOZZLE EVENTS. The chain.
//
// A nozzle carries ONE CHAIN of readings. Each reading CLOSES the account before it and
// OPENS the one after — one number, stored once, read from both directions. There is no
// closing column and no opening column, so they cannot differ.
//
// THE PUMP IS NEVER BLOCKED, AND THERE IS NO OVERRIDE TO BUILD. If a man walks off
// without printing, the next man's scan IS the closing event and the outstanding
// strikes against the man who left. The act of taking over is the act of closing, so
// there is nothing to freeze and no break-glass.
//
// A CO-EVENT carries no value. It appears when a reading matches the one before it —
// no fuel moved, only time passed — and it exists to show the owner the DRIFT IN TIME
// between the outgoing man's print and the incoming man's. A metric, not a measurement.
//
// TWO ALARMS, BOTH PHYSICS. A handover where the readings differ is usually just fuel
// sold in the gap and says nothing: a manager who justifies three litres twice a day
// learns to click through, and then a real reset sails past on the same habit.
import { useState, useEffect, useCallback } from 'react';
import { Gauge, Info, Clock, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import Banner from '../../components/shared/Banner';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { nozName } from '../../lib/nozzle';
import { useTranslation } from 'react-i18next';
import { errText } from '../../lib/apiError';

const when = ts => ts ? new Date(ts).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
}) : '';
const L = n => n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
// Drift is about discipline, so it reads in the units a person argues in.
const drift = s => {
  if (s == null) return null;
  const m = Math.round(Math.abs(s) / 60);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
};

export default function NozzleEventsPage() {
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [events, setEvents]   = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const r = await api.get('/spokes/chain', { params: { station_id: sid, limit: 100 } });
      setEnabled(r?.enabled !== false);
      setEvents(Array.isArray(r?.events) ? r.events : []);
    } catch (e) { setErr(errText(e, 'Could not load the chain just now.')); }
    setLoading(false);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  if (!hubSpokesFlow) {
    return (
      <AppShell>
        <div className="card" style={{ maxWidth: 640, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Info size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, color: '#666' }}>
            {tc('spoke.off', 'Nozzle Events belongs to the hub-and-spokes flow, which is switched off here. Turn it on in Settings → Shift Timings, one outlet at a time.')}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <Gauge size={19} style={{ color: 'var(--brand)' }} />
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>
            {tc('spoke.eventsTitle', 'Nozzle Events')}
          </h1>
        </div>

        {err && <Banner tone="error">{err}</Banner>}

        {!enabled && (
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={17} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13.5, color: '#666' }}>
              {tc('spoke.notMigrated', 'Nozzle Events is not switched on for this database yet. Nothing is lost — the chain will appear once the tables are added.')}
            </div>
          </div>
        )}

        {enabled && (loading ? (
          <div className="card" style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {tc('spoke.loading', 'Loading…')}
          </div>
        ) : events.length === 0 ? (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>
              {tc('spoke.emptyTitle', 'No handovers recorded yet')}
            </div>
            <div style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6 }}>
              {tc('spoke.emptyBody', 'Each nozzle carries one chain of readings. A reading closes the man who was on it and opens the man taking over — one number, recorded once. The pump is never held up: if someone leaves without printing, the next man’s reading closes the account for him.')}
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {events.map((e, i) => {
              const decreased = e.drift_reason && Number(e.reading) < Number(events[i + 1]?.reading ?? e.reading);
              return (
                <div key={e.id} style={{
                  padding: '13px 16px',
                  borderTop: i ? '1px solid #f0ebe3' : 'none',
                  background: e.is_co_event ? '#faf8f5' : 'transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                    {/* THE ONE NAME, read through lib/nozzle — never built here. */}
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13.5 }}>
                      {nozName(e)}
                    </span>
                    {e.is_co_event && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em',
                                     padding: '2px 7px', borderRadius: 4,
                                     background: '#eef2f7', color: '#475569' }}>
                        {tc('spoke.coEvent', 'CO-EVENT')}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>
                      {L(e.reading)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5,
                                fontSize: 12.5, color: 'var(--text-3)', flexWrap: 'wrap' }}>
                    <span>{when(e.recorded_at)}</span>
                    {/* THE CO-EVENT'S WHOLE PURPOSE: the gap between one man's print and
                        the next's, so the owner has data to push the manager on. */}
                    {e.drift_seconds != null && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> {drift(e.drift_seconds)}
                      </span>
                    )}
                    {e.source && <span>{e.source === 'photo' ? tc('spoke.scanned', 'scanned') : tc('spoke.typedWord', 'typed')}</span>}
                  </div>

                  {/* A JUSTIFIED DRIFT, IN HIS OWN WORDS. Never a dropdown — a canned
                      reason code becomes a reflex. */}
                  {e.drift_reason && (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 7,
                                  background: '#fbeee4', color: '#9a3412', fontSize: 12.5,
                                  display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{e.drift_reason}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
