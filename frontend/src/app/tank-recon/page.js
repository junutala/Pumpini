'use client';
// SPOKE 1 · TANK RECON — the landing.
//
// THE OUTLET IS THE HUB. This is the manager's way into the tank's own clock: the ATG
// and every nozzle read at ONE moment, so the tank window and the nozzle totals share
// a boundary by construction rather than by arithmetic afterwards.
//
// IT SHOWS THE LAST RECON, NEVER CURRENT STOCK (owner, 27-Aug-2026: "we will not have
// data on Current Stock. That's a trap."). A figure labelled "stock now" would be the
// last dip plus assumptions, and a manager reads it as a measurement. The last recon
// is a thing that actually happened, at a time we can name.
//
// The date picker is a JUMP TO, not the primary control — one card, one line, one
// button, and the past lives behind the jump rather than as a list padding the screen.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Droplet, CalendarDays, ArrowRight, Info, FileClock } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText } from '../../lib/apiError';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// DD MMM, HH:mm — en-IN, Asia/Kolkata. Never a raw ISO string in front of a manager.
const whenIST = ts => ts ? new Date(ts).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '';
const signed = n => n == null ? '—'
  : `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;

export default function TankReconPage() {
  const router = useRouter();
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [jumpTo, setJumpTo]   = useState(today());
  const [state, setState]     = useState({ loading: true, enabled: true, last: null, draft: null });
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    if (!sid) return;
    try {
      const r = await api.get('/tank-recon', { params: { station_id: sid } });
      setState({ loading: false, enabled: r?.enabled !== false, last: r?.last || null, draft: r?.draft || null });
    } catch {
      // A failed read must not strand him on a spinner: show the screen, let him start.
      setState({ loading: false, enabled: true, last: null, draft: null });
    }
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  // ONE BUTTON, and it resumes rather than duplicates. A draft already open is his
  // unfinished work — starting a second would mean two men reconciling the same tanks
  // over overlapping windows, and the later confirm silently winning.
  const start = async () => {
    setBusy(true); setErr('');
    try {
      await api.post('/tank-recon/draft', { station_id: sid });
      router.push('/tank-recon/atg');
    } catch (e) {
      setErr(errText(e, tc('recon.startFailed', 'Could not start a recon just now.')));
      setBusy(false);
    }
  };

  if (!hubSpokesFlow) {
    return (
      <AppShell>
        <div style={{ maxWidth: 560 }}>
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                {tc('recon.offTitle', 'This outlet runs the shift flow')}
              </div>
              <div style={{ fontSize: 13.5, color: '#666' }}>
                {tc('recon.offBody', 'Tank Recon belongs to the hub-and-spokes flow, which is switched off here. Turn it on in Settings → Shift Timings, one outlet at a time.')}
              </div>
              <button onClick={() => router.push('/dashboard')}
                style={{ marginTop: 14, background: 'none', border: '1px solid #e5e3de', borderRadius: 8,
                         padding: '7px 13px', fontSize: 13, cursor: 'pointer' }}>
                {tc('recon.backToDashboard', 'Back to Bunk View')}
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const { loading, enabled, last, draft } = state;

  return (
    <AppShell>
      <div style={{ maxWidth: 560 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Droplet size={19} style={{ color: 'var(--brand)' }} />
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>
              {tc('recon.title', 'Tank Recon')}
            </h1>
          </div>
          {/* JUMP TO, not the primary control — it sits quiet beside the heading. */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5,
                          color: 'var(--text-3)', cursor: 'pointer' }}>
            <CalendarDays size={14} />
            {tc('recon.jumpTo', 'Jump to date')}
            <input type="date" value={jumpTo} max={today()}
              onChange={e => setJumpTo(e.target.value)}
              style={{ border: '1px solid #e5e3de', borderRadius: 7, padding: '4px 7px',
                       fontSize: 12.5, background: '#fff' }} />
          </label>
        </div>

        {err && <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #dc2626',
                     fontSize: 13.5, color: '#991b1b' }}>{err}</div>}

        {!enabled && (
          <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={17} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13.5, color: '#666' }}>
              {tc('recon.notMigrated', 'Tank Recon is not switched on for this database yet. Nothing is lost — it will appear once the tables are added.')}
            </div>
          </div>
        )}

        {/* HIS UNFINISHED WORK, first. A draft is saved before he decides, so a closed
            tab or a locked phone costs nothing — but only if the way back is obvious. */}
        {draft && (
          <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--brand)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <FileClock size={16} style={{ color: 'var(--brand)' }} />
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                {tc('recon.draftOpen', 'You have a recon in progress')}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>
              {tc('recon.draftStarted', 'Started')} {whenIST(draft.taken_at)}
            </div>
          </div>
        )}

        {loading ? (
          <div className="card" style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {tc('recon.loading', 'Loading…')}
          </div>
        ) : last ? (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, letterSpacing: '.05em', textTransform: 'uppercase',
                              color: 'var(--text-3)' }}>
                  {tc('recon.lastRecon', 'Last recon')}
                </div>
                <div style={{ fontWeight: 800, fontSize: 17, marginTop: 2 }}>{whenIST(last.taken_at)}</div>
              </div>
              {last.confirmed_by_name && (
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', textAlign: 'right' }}>
                  {last.confirmed_by_name}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
              {(last.tanks || []).map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                                         paddingTop: 9, borderTop: '1px solid #f0ebe3' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {tc('recon.tank', 'Tank')} {t.tank_number}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-3)', textTransform: 'capitalize' }}>
                    {String(t.fuel_type || '').replace('_', ' ')}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 13.5 }}>
                    {t.volume_ltrs == null ? '—'
                      : Number(t.volume_ltrs).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, minWidth: 92, textAlign: 'right',
                                 color: t.variance_ltrs == null ? 'var(--text-3)'
                                      : Number(t.variance_ltrs) < 0 ? '#991b1b' : '#166534' }}>
                    {signed(t.variance_ltrs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // THE EMPTY STATE — specified in the build plan (§8.4) and drawn nowhere. It
          // says what a recon is and what he will be asked for, because the first one
          // he does is the only one he does without knowing.
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>
              {tc('recon.emptyTitle', 'No recon yet at this outlet')}
            </div>
            <div style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6 }}>
              {tc('recon.emptyBody', 'A recon reads the tanks and every nozzle at one moment, so the two can be compared over the same window. Three steps: photograph the gauge console, read the nozzle slips, then check the variance before you confirm it.')}
            </div>
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#faf8f5',
                          border: '1px solid #f0ebe3', borderRadius: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
              {tc('recon.emptyNote', 'The first recon has nothing behind it, so it records the tanks without a variance. The next one reconciles against it.')}
            </div>
          </div>
        )}

        <button onClick={start} disabled={busy || !enabled}
          style={{ width: '100%', height: 48, marginTop: 14,
                   background: (busy || !enabled) ? '#e5e3de' : 'var(--brand)',
                   color: (busy || !enabled) ? '#8b9099' : '#fff',
                   border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15,
                   cursor: (busy || !enabled) ? 'not-allowed' : 'pointer',
                   display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {busy ? tc('recon.starting', 'Starting…')
                : draft ? tc('recon.resume', 'Resume this recon')
                        : tc('recon.start', 'Start a new recon')}
          <ArrowRight size={17} />
        </button>

      </div>
    </AppShell>
  );
}
