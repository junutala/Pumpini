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
import { Gauge, Info, Clock, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import Banner from '../../components/shared/Banner';
import PhotoCapture from '../../components/shared/PhotoCapture';
import EngineNotice from '../../components/shared/EngineNotice';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { nozName } from '../../lib/nozzle';
import { useTranslation } from 'react-i18next';
import { errText, errCode } from '../../lib/apiError';

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
  // WHERE EACH NOZZLE STANDS: last reading, when, and the man it is open against. Shown
  // before anything is asked, so the manager confirms rather than remembers.
  const [state, setState]     = useState([]);
  const [attendants, setAtts] = useState([]);
  const [openId, setOpenId]   = useState(null);
  // nozzle_id -> { reading, opens, reason, source, serial, no }
  const [form, setForm]       = useState({});
  const [engine, setEngine]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const [ok, setOk]           = useState('');
  // The physics refusal, held per nozzle so the reason box appears exactly where it is
  // needed rather than as a page-level alarm.
  const [refused, setRefused] = useState({});
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const [r, st] = await Promise.all([
        api.get('/spokes/chain', { params: { station_id: sid, limit: 100 } }),
        api.get('/spokes/nozzles', { params: { station_id: sid } }),
      ]);
      setEnabled(r?.enabled !== false);
      setEvents(Array.isArray(r?.events) ? r.events : []);
      setState(Array.isArray(st?.nozzles) ? st.nozzles : []);
    } catch (e) { setErr(errText(e, 'Could not load the chain just now.')); }
    setLoading(false);
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    // The SAME picker Start Shift reads. A second list of attendants is a second answer
    // to "who works here".
    api.get(`/users?station_id=${sid}&role=attendant`)
      .then(r => setAtts(Array.isArray(r) ? r : []))
      .catch(() => setAtts([]));
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const set = (id, patch) => setForm(f => ({ ...f, [id]: { ...(f[id] || {}), ...patch } }));

  // ONE PHOTOGRAPH OF THE SLIP, read by the ONE reader — the same endpoint the shift
  // flow, Spoke 1 and commissioning all scan with. A screen with its own OCR prompt is
  // exactly how /pos-meter and /ocr-meter became two copies of one call.
  const onSlip = async (cap, n) => {
    if (!cap) return;
    setBusy(true); setErr(''); setEngine(null);
    try {
      const r = await api.post('/reconcile/parse-slips', {
        station_id: sid, image_base64: cap.base64, media_type: cap.media_type,
      });
      setEngine({ engine: r?.engine ?? null, reason: r?.fallback_reason ?? null });
      let hit = null;
      for (const slip of (Array.isArray(r?.slips) ? r.slips : [])) {
        for (const ln of (slip.lines || [])) {
          // ONLY THE LINE FOR THE NOZZLE HE IS STANDING AT. A composite photograph of
          // six slips must not silently move a different nozzle's account — the
          // handover is one man taking over one nozzle.
          if (ln.nozzle_id === n.id && ln.legible && ln.cumulative_volume != null) {
            hit = { reading: String(ln.cumulative_volume), source: 'photo',
                    serial: slip.pump_serial || '', no: String(ln.slip_no ?? '') };
          }
        }
      }
      if (hit) {
        setForm(f => ({ ...f, [n.id]: { ...(f[n.id] || {}), ...hit } }));
      } else {
        setErr(`${nozName(n)} — ${tc('spoke.notOnThisSlip', 'that photograph does not carry a readable line for this nozzle. Type the figure, or photograph its own slip.')}`);
      }
    } catch (e) { setErr(errText(e, 'That photograph could not be read.')); }
    setBusy(false);
  };

  // THE HANDOVER. One reading closes the man the chain says is on it and opens the next.
  // WHO IT CLOSES IS NOT SENT: the backend derives it from the previous event, so a
  // manager cannot strike the outstanding against a different name.
  const record = async (n) => {
    const f = form[n.id] || {};
    setBusy(true); setErr(''); setOk('');
    try {
      await api.post('/spokes/event', {
        station_id: sid, nozzle_id: n.id,
        reading: Number(f.reading),
        opens_attendant_id: f.opens || null,
        source: f.source === 'photo' ? 'photo' : 'typed',
        drift_reason: f.reason || undefined,
        read_pump_serial: f.serial || undefined, read_nozzle_no: f.no || undefined,
      });
      setOk(`${nozName(n)} — ${tc('spoke.handedOver', 'handed over.')}`);
      setOpenId(null);
      setForm(x => ({ ...x, [n.id]: undefined }));
      setRefused(x => ({ ...x, [n.id]: null }));
      await load();
    } catch (e) {
      // THE TWO PHYSICS REFUSALS come back with the sentence already written. It is
      // shown where the reading was typed, with the reason box, rather than as a page
      // alarm he learns to dismiss.
      // THE ONE READER for a machine code — never e.error by hand. lib/apiError
      // exists because reading the payload by hand is what put `missing_closing_dip`
      // in front of a manager in a red box.
      const code = errCode(e);
      if (code === 'reading_decreased' || code === 'faster_than_the_pump') {
        setRefused(x => ({ ...x, [n.id]: errText(e, 'That figure cannot be right.') }));
      } else {
        setErr(errText(e, 'Could not record that handover.'));
      }
    }
    setBusy(false);
  };

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
        {ok && <Banner tone="ok">{ok}</Banner>}
        <EngineNotice engine={engine?.engine} reason={engine?.reason} />

        {/* ── THE HANDOVER, which is the act that creates an outstanding ─────────
            Until a reading is recorded here, no man owes anything and Attendant Dues
            is empty by arithmetic rather than by luck.

            THE PUMP IS NEVER BLOCKED and there is no override to build. If a man walks
            off without printing, the next man's reading IS the closing event and the
            outstanding stands against the man who left — so this screen never refuses
            to let somebody take over, and offers no break-glass to do it anyway. */}
        {enabled && state.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '11px 15px', borderBottom: '1px solid #f0ebe3',
                          display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowRightLeft size={15} style={{ color: 'var(--brand)' }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {tc('spoke.handover', 'Hand a nozzle over')}
              </span>
            </div>
            {state.map(n => {
              const f = form[n.id] || {};
              const open = openId === n.id;
              return (
                <div key={n.id} style={{ padding: '12px 15px', borderTop: '1px solid #f7f4ef' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                    {/* THE ONE NAME, read through lib/nozzle. Never built here. */}
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13.5 }}>
                      {nozName(n)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {n.on_attendant_name
                        ? `${tc('spoke.on', 'on')} ${n.on_attendant_name}`
                        : n.reading != null
                          ? tc('spoke.idle', 'idle')
                          : tc('spoke.uncommissioned', 'no opening reading yet')}
                    </span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 13 }}>
                      {L(n.reading)}
                    </span>
                    {!open && (
                      <button onClick={() => { setOpenId(n.id); setOk(''); }}
                        style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 7,
                                 padding: '5px 11px', fontSize: 12.5, cursor: 'pointer' }}>
                        {tc('spoke.handOver', 'Hand over')}
                      </button>
                    )}
                  </div>

                  {open && (
                    <div style={{ marginTop: 11 }}>
                      <div className="stack-mobile"
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label className="label">{tc('spoke.newReading', 'Reading on the slip')}</label>
                          <input type="number" step="0.001" value={f.reading || ''}
                            onChange={e => set(n.id, { reading: e.target.value })}
                            style={{ width: '100%', padding: '7px 9px', border: '1.5px solid #e5e3de',
                                     borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          {/* WHO TAKES OVER. Who it CLOSES is never asked — the chain
                              already knows, and asking would let the wrong man be
                              struck. "Nobody" is a real answer: a nozzle goes idle. */}
                          <label className="label">{tc('spoke.takesOver', 'Who takes over')}</label>
                          <select value={f.opens || ''} onChange={e => set(n.id, { opens: e.target.value })}
                            style={{ width: '100%', padding: '7px 9px', border: '1.5px solid #e5e3de',
                                     borderRadius: 7, fontSize: 13, boxSizing: 'border-box', background: '#fff' }}>
                            <option value="">{tc('spoke.nobody', 'Nobody — it goes idle')}</option>
                            {attendants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* A JUSTIFIED DRIFT, IN HIS OWN WORDS. The box appears only after
                          the physics has refused — never a dropdown, because a canned
                          reason code becomes a reflex, and it is not offered up front
                          for the same reason. */}
                      {refused[n.id] && (
                        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8,
                                      background: '#fbeee4', color: '#9a3412', fontSize: 12.5,
                                      lineHeight: 1.55 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>{refused[n.id]}</span>
                          </div>
                          <input value={f.reason || ''} placeholder={tc('spoke.reasonPh', 'Say what happened, in your own words')}
                            onChange={e => set(n.id, { reason: e.target.value })}
                            style={{ width: '100%', marginTop: 9, padding: '7px 9px',
                                     border: '1.5px solid #f0c9a8', borderRadius: 7, fontSize: 13,
                                     boxSizing: 'border-box', background: '#fff' }} />
                          <div style={{ fontSize: 11.5, marginTop: 7, opacity: .85 }}>
                            {tc('spoke.resetNote', 'A meter that was reset or replaced needs a new starting point — that is a commissioning action in Settings, not a reason typed here.')}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
                        <PhotoCapture onCapture={cap => onSlip(cap, n)} disabled={busy}
                          label={tc('spoke.photograph', 'Photograph the slip')} />
                        <button onClick={() => record(n)} disabled={busy || !(f.reading !== undefined && f.reading !== '')}
                          style={{ marginLeft: 'auto',
                                   background: (busy || !(f.reading !== undefined && f.reading !== '')) ? '#e5e3de' : 'var(--brand)',
                                   color: (busy || !(f.reading !== undefined && f.reading !== '')) ? '#8b9099' : '#fff',
                                   border: 'none', borderRadius: 8, padding: '8px 15px', fontSize: 13,
                                   fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                          {busy ? tc('spoke.recording', 'Recording…') : tc('spoke.recordHandover', 'Record the handover')}
                        </button>
                        <button onClick={() => { setOpenId(null); setRefused(x => ({ ...x, [n.id]: null })); }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-3)',
                                   fontSize: 13, cursor: 'pointer' }}>
                          {tc('spoke.cancel', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}


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
