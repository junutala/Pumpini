'use client';
// COMMISSIONING BY SLIP — the act that unlocks the hub-and-spokes switch.
//
// WHY THIS SCREEN EXISTS AT ALL. The new flow matches money on the pair
// `<pump serial>.<printed nozzle number>`. Until now the printed number was DEFAULTED
// from our own index — "1.3" became "3" — a convention this repo invented and no slip
// has ever confirmed. In the shift flow that default is harmless. Here it is not: a
// wrong printed number puts one nozzle's meter on another nozzle's account, and both
// men's outstandings are wrong with nothing on any screen to show it.
//
// So the pair is read off real paper, by a person who looks at it, once per pump. Five
// minutes at switch-on, and the guess is retired for this outlet.
//
// THE READING IS THE CHAIN'S GENESIS EVENT. It opens the first account without closing
// anybody's — which is why commissioning is also where the chain begins, rather than a
// separate act that would need its own record of having happened.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, Info, Check, AlertTriangle } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import PhotoCapture from '../../../components/shared/PhotoCapture';
import Banner from '../../../components/shared/Banner';
import EngineNotice from '../../../components/shared/EngineNotice';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { nozName } from '../../../lib/nozzle';
import { useTranslation } from 'react-i18next';
import { errText } from '../../../lib/apiError';

// A CNG unit prints no slip (owner, 20-Aug) — its serial is the literal "CNG" for want
// of a printed identity, so there is nothing here to photograph and nothing to confirm.
// It is commissioned by typing, like any nozzle whose slip will not read.
const WANT_WORDS = {
  // A nozzle attached to no pump cannot hold a serial at all — that is a Settings act,
  // not something to type here, so it is said as itself.
  pump:       'not attached to a pump — define it in Settings first',
  serial:     'no serial on file',
  printed_no: 'printed number never read off a slip',
  genesis:    'no opening reading',
};

const inp = {
  width: '100%', padding: '7px 9px', border: '1.5px solid #e5e3de', borderRadius: 7,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff',
};

export default function CommissioningPage() {
  const { station, user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [state, setState]   = useState(null);
  const [loading, setLoad]  = useState(true);
  // nozzle_id -> { serial, printed, reading, source }
  const [entry, setEntry]   = useState({});
  const [scanning, setScan] = useState(false);
  const [saving, setSave]   = useState(false);
  const [err, setErr]       = useState('');
  const [ok, setOk]         = useState('');
  const [notes, setNotes]   = useState([]);
  // Which reader produced these figures. Loud only when it was the weaker one.
  const [engine, setEngine] = useState(null);

  const load = useCallback(async () => {
    if (!sid) return;
    setLoad(true);
    try { setState(await api.get(`/stations/${sid}/commissioning`)); }
    catch (e) { setErr(errText(e, 'Could not read the commissioning state.')); }
    setLoad(false);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const nozzles = useMemo(() => state?.nozzles || [], [state]);
  const pending = nozzles.filter(n => !n.ready);

  // ONE PHOTOGRAPH OF EVERY SLIP, read by the ONE reader — the same endpoint the shift
  // flow and Spoke 1 scan with. A screen with its own OCR prompt is exactly how
  // /pos-meter and /ocr-meter became two copies of one call.
  const onScan = async (cap) => {
    if (!cap) return;
    setScan(true); setErr(''); setOk(''); setNotes([]); setEngine(null);
    try {
      const r = await api.post('/reconcile/parse-slips', {
        station_id: sid, image_base64: cap.base64, media_type: cap.media_type,
      });
      const next = {}; const said = [];
      for (const slip of (Array.isArray(r?.slips) ? r.slips : [])) {
        const serial = String(slip.pump_serial || '').trim().toUpperCase();
        for (const ln of (slip.lines || [])) {
          if (!ln.legible || ln.cumulative_volume == null) continue;
          const printed = String(ln.slip_no ?? '').trim();
          // MATCHED BY THE PAIR WHERE THE PAIR IS ALREADY ON FILE. Where it is not —
          // which is the ordinary case at commissioning — the line waits for the owner
          // to say which nozzle it is. Nothing here guesses.
          const hit = ln.nozzle_id
            ? nozzles.find(n => n.id === ln.nozzle_id)
            : nozzles.find(n => String(n.pump_serial || '').toUpperCase() === serial
                             && String(n.slip_nozzle_no || '') === printed);
          if (hit) {
            next[hit.id] = { serial: serial || hit.pump_serial || '', printed,
                             reading: String(ln.cumulative_volume), source: 'photo' };
          } else {
            said.push(`${serial || '?'}.${printed || '?'} — ${tc('comm.unassigned', 'read, but not yet pointed at a nozzle. Pick it below.')}`);
          }
        }
        if (!slip.lines?.length) {
          said.push(`${serial || tc('comm.aSlip', 'a slip')} — ${tc('comm.noLines', 'nothing readable on it. Try again in better light, or type the figures.')}`);
        }
      }
      setEntry(e => ({ ...e, ...next }));
      setNotes(said);
      setEngine({ engine: r?.engine ?? null, reason: r?.fallback_reason ?? null });
      if (!Object.keys(next).length && !said.length) {
        setErr(tc('comm.nothingRead', 'Nothing was read from that photograph.'));
      }
    } catch (e) { setErr(errText(e, 'That photograph could not be read.')); }
    setScan(false);
  };

  const set = (id, patch) => setEntry(e => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }));

  // WHAT WILL BE SENT. A nozzle is only commissioned when all three facts are present —
  // a half-filled row is left alone rather than written with a blank standing in for a
  // number nobody read.
  const entries = useMemo(() => nozzles.map(n => {
    const e = entry[n.id] || {};
    const serial  = String(e.serial ?? n.pump_serial ?? '').trim();
    const printed = String(e.printed ?? n.slip_nozzle_no ?? '').trim();
    const reading = String(e.reading ?? '').trim();
    if (!printed || reading === '' || !Number.isFinite(Number(reading))) return null;
    return { nozzle_id: n.id, pump_id: n.pump_id || undefined, serial, slip_nozzle_no: printed,
             reading: Number(reading), source: e.source === 'photo' ? 'photo' : 'typed' };
  }).filter(Boolean), [nozzles, entry]);

  const save = async () => {
    setSave(true); setErr(''); setOk('');
    try {
      const r = await api.post(`/stations/${sid}/commissioning`, { entries });
      setState(r?.readiness || null);
      setEntry({});
      setOk(r?.readiness?.ready
        ? tc('comm.done', 'Every nozzle is commissioned. The hub-and-spokes switch can now be turned on for this outlet.')
        : `${r?.committed?.length || 0} ${tc('comm.recorded', 'recorded.')}`);
    } catch (e) { setErr(errText(e, 'Could not record that.')); }
    setSave(false);
  };

  // OWNER ONLY, and said on the screen rather than only enforced in the backend — a
  // manager who reaches this page should learn why, not meet a 403.
  if (user && user.role !== 'owner') {
    return (
      <AppShell>
        <div className="card" style={{ maxWidth: 640, display: 'flex', gap: 12 }}>
          <Info size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, color: '#666' }}>
            {tc('comm.ownerOnly', 'Commissioning fixes the identity every later reading is matched on, so only the outlet owner can do it.')}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <ShieldCheck size={19} style={{ color: 'var(--brand)' }} />
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>
            {tc('comm.title', 'Commissioning')}
          </h1>
        </div>
        <p style={{ fontSize: 13, color: '#666', lineHeight: 1.6, marginTop: 0, marginBottom: 14 }}>
          {tc('comm.blurb', 'Scan one slip per pump. Pumpini records the serial and the nozzle number exactly as the paper prints them, and takes the reading on it as each nozzle’s starting point. Until every nozzle has been through this, the hub-and-spokes flow cannot be switched on here — a nozzle number nobody has read is a guess, and a guess puts one man’s litres on another man’s account.')}
        </p>

        {err && <Banner tone="error">{err}</Banner>}
        {ok && <Banner tone="ok">{ok}</Banner>}

        {loading ? (
          <div className="card" style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {tc('comm.loading', 'Loading…')}
          </div>
        ) : !state?.spokes_ready ? (
          <div className="card" style={{ display: 'flex', gap: 12 }}>
            <Info size={17} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13.5, color: '#666' }}>
              {tc('comm.noTables', 'The hub-and-spokes tables are not in this database yet, so there is nowhere for a nozzle’s chain to begin.')}
            </div>
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 12, display: 'flex',
                                           alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {state.ready ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
                               color: '#166534', fontWeight: 700, fontSize: 14 }}>
                  <Check size={16} /> {tc('comm.allDone', 'All')} {state.total} {tc('comm.commissioned', 'nozzles commissioned')}
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
                               color: '#9a3412', fontWeight: 700, fontSize: 14 }}>
                  <AlertTriangle size={16} /> {state.missing} {tc('comm.of', 'of')} {state.total} {tc('comm.stillToDo', 'still to do')}
                </span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <PhotoCapture onCapture={onScan} disabled={scanning}
                  label={scanning ? tc('comm.reading', 'Reading…') : tc('comm.scanAll', 'Photograph the slips')} />
              </div>
            </div>

            <EngineNotice engine={engine?.engine} reason={engine?.reason} />

            {notes.length > 0 && (
              <div className="card" style={{ marginBottom: 12, background: '#fbeee4' }}>
                {notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: '#9a3412', marginTop: i ? 6 : 0 }}>{n}</div>
                ))}
              </div>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {nozzles.map((n, i) => {
                const e = entry[n.id] || {};
                const serial  = e.serial  ?? n.pump_serial ?? '';
                const printed = e.printed ?? n.slip_nozzle_no ?? '';
                const reading = e.reading ?? '';
                return (
                  <div key={n.id} style={{ padding: '13px 15px',
                                           borderTop: i ? '1px solid #f0ebe3' : 'none',
                                           background: n.ready ? '#f7faf7' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                      {/* THE ONE NAME, read through lib/nozzle. Never built here. */}
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13.5 }}>
                        {nozName(n)}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{n.fuel_type}</span>
                      {n.ready ? (
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#166534',
                                       display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Check size={13} /> {tc('comm.ok', 'commissioned')}
                        </span>
                      ) : (
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9a3412' }}>
                          {(n.wants || []).map(w => tc(`comm.want.${w}`, WANT_WORDS[w] || w)).join(' · ')}
                        </span>
                      )}
                    </div>

                    {!n.ready && (n.wants || []).includes('pump') ? (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: '#9a3412' }}>
                        {tc('comm.noPump', 'Attach this nozzle to a pump in Settings → Pumps, then come back. There is nowhere here for its serial to be stored.')}
                      </div>
                    ) : !n.ready && (
                      <div className="stack-mobile"
                        style={{ display: 'grid', gridTemplateColumns: '1.2fr .7fr 1fr', gap: 8, marginTop: 10 }}>
                        <div>
                          <label className="label">{tc('comm.serial', 'Serial, as printed')}</label>
                          <input style={inp} value={serial}
                            onChange={ev => set(n.id, { serial: ev.target.value })} />
                        </div>
                        <div>
                          <label className="label">{tc('comm.printedNo', 'Nozzle no, as printed')}</label>
                          <input style={inp} value={printed}
                            onChange={ev => set(n.id, { printed: ev.target.value })} />
                        </div>
                        <div>
                          <label className="label">{tc('comm.opening', 'Reading on the slip')}</label>
                          <input style={inp} type="number" step="0.001" value={reading}
                            onChange={ev => set(n.id, { reading: ev.target.value, source: 'typed' })} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                {entries.length} {tc('comm.ready', 'ready to record')}
              </span>
              <button onClick={save} disabled={saving || !entries.length}
                style={{ marginLeft: 'auto',
                         background: (saving || !entries.length) ? '#e5e3de' : 'var(--brand)',
                         color: (saving || !entries.length) ? '#8b9099' : '#fff', border: 'none',
                         borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700,
                         cursor: (saving || !entries.length) ? 'not-allowed' : 'pointer' }}>
                {saving ? tc('comm.recording', 'Recording…') : tc('comm.confirm', 'Confirm what the slips print')}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
