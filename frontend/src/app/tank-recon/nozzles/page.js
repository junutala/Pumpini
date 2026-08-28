'use client';
// SPOKE 1 · STEP 2 of 3 — THE NOZZLE READINGS.
//
// TAKEN AT THE SAME MOMENT AS THE CONSOLE, which is the whole point. An ATG reading is
// an instant; a nozzle account is a span. Because both are captured in one act, the
// tank window and the nozzle totals share a boundary by construction rather than by
// prorating afterwards — and prorating is the back-solved dip wearing a different hat.
//
// PARTIAL IS THE NORMAL STATE, NOT AN ERROR (owner, 27-Aug: screens 4 and 4a are ONE
// screen). The nine that read sit beside the three that did not, and each unread one
// offers the camera and the keyboard together at the same size.
//
// IT NEVER MOVES AN ATTENDANT'S ACCOUNT. These readings land in tank_recon_nozzles —
// Spoke 1's own table, deliberately apart from Spoke 2's events, because money flows
// from Spoke 2 only. Two tables make "a recon scan moved a man's liability" unwritable
// rather than one forgotten WHERE clause away.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Keyboard, Info } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import PhotoCapture from '../../../components/shared/PhotoCapture';
import Banner from '../../../components/shared/Banner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { nozName } from '../../../lib/nozzle';
import { useTranslation } from 'react-i18next';
import { errText } from '../../../lib/apiError';

// A CNG unit prints no slip (owner, 20-Aug) — its serial is recorded as the literal
// "CNG" for want of a printed identity, and there is nothing here to photograph.
const readable = n => String(n.fuel_type || '').toLowerCase() !== 'cng';

export default function ReconNozzlesPage() {
  const router = useRouter();
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [nozzles, setNozzles] = useState([]);
  const [draft, setDraft]     = useState(null);
  // nozzle_id -> { value, amount, source, serial, no }
  const [figures, setFigures] = useState({});
  const [banner, setBanner]   = useState(null);
  const [notes, setNotes]     = useState([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/nozzles`)
      .then(r => setNozzles((Array.isArray(r) ? r : []).filter(readable)))
      .catch(() => setNozzles([]));
  }, [sid]);

  const loadDraft = useCallback(async () => {
    if (!sid) return;
    try {
      const r = await api.get('/tank-recon', { params: { station_id: sid } });
      const d = r?.draft || null;
      setDraft(d);
      if (d?.nozzles?.length) {
        const back = {};
        for (const n of d.nozzles) {
          if (n.cumulative_volume != null) {
            back[n.nozzle_id] = {
              value: String(n.cumulative_volume),
              amount: n.cumulative_amount != null ? String(n.cumulative_amount) : '',
              source: n.source || 'typed',
              serial: n.read_pump_serial || '', no: n.read_nozzle_no || '',
            };
          }
        }
        setFigures(f => ({ ...back, ...f }));
      }
    } catch { /* the screen still works; he can type */ }
  }, [sid]);
  useEffect(() => { loadDraft(); }, [loadDraft]);

  const missing = useMemo(
    () => nozzles.filter(n => {
      const f = figures[n.id];
      return !f || f.value === '' || f.value == null;
    }),
    [nozzles, figures]
  );
  const ready = nozzles.length > 0 && missing.length === 0;

  const setFigure = (id, patch) =>
    setFigures(f => ({ ...f, [id]: { ...(f[id] || {}), ...patch } }));

  // ONE PHOTOGRAPH OF EVERY SLIP, read by the ONE reader. slipParser carries the
  // rupee/litre cross-check (#306) and the V-line fix (#353); a screen with its own
  // prompt is exactly what returned the rupee line as a meter for four months.
  const onComposite = async (cap) => {
    if (!cap) return;
    setScanning(true); setBanner(null); setNotes([]);
    try {
      // The SAME endpoint the shift flow scans with, given a station instead of a
      // shift. One reader, one matcher — a second endpoint here is exactly how
      // /pos-meter and /ocr-meter became two copies of one OCR call.
      const r = await api.post('/reconcile/parse-slips', {
        station_id: sid, image_base64: cap.base64, media_type: cap.media_type,
      });
      const next = {}; const said = [];
      for (const slip of (Array.isArray(r?.slips) ? r.slips : [])) {
        for (const ln of (slip.lines || [])) {
          const label = ln.nozzle_name || `${slip.pump_serial || '?'}.${ln.slip_no || '?'}`;
          if (ln.nozzle_id && ln.cumulative_volume != null && ln.legible) {
            next[ln.nozzle_id] = {
              value: String(ln.cumulative_volume),
              amount: ln.cumulative_amount != null ? String(ln.cumulative_amount) : '',
              source: 'photo',
              serial: slip.pump_serial || '', no: ln.slip_no || '',
            };
          } else if (!slip.serial_known) {
            // WRONG OUTLET, SAID OUT LOUD. Nagole, 20-Aug: 0 of 28 lines matched
            // because the slips were another outlet's machines, and no screen said a
            // word — serial_known sat false on every line and nothing shouted.
            said.push(`${label} — ${tc('recon.notOurs', 'not a machine at this outlet.')}`);
          } else if (!ln.nozzle_id) {
            said.push(`${label} — ${tc('recon.noMatch', 'no nozzle at this outlet prints that line.')}`);
          } else if (!ln.legible) {
            said.push(`${label} — ${tc('recon.refused', 'refused by the cross-check; read it again or type it.')}`);
          }
        }
      }
      setFigures(f => ({ ...f, ...next }));
      setNotes(said);
      const filled = Object.keys(next).length;
      setBanner(filled === 0
        ? { tone: 'error', text: tc('recon.slipNone', 'Nothing usable on that photo — enter the readings below.') }
        : said.length
          ? { tone: 'warn', text: tc('recon.slipCheck', 'Check the figures before you continue.') }
          : { tone: 'ok', text: tc('recon.slipOk', 'Read — check the figures and continue.') });
    } catch (e) {
      setBanner({ tone: 'error', text: errText(e, tc('recon.slipFailed', 'Could not read those slips — enter the readings below.')) });
    } finally { setScanning(false); }
  };

  const saveAndContinue = async () => {
    if (!draft?.id) { setErr(tc('recon.noDraft', 'This recon is no longer open — start it again from Tank Recon.')); return; }
    setSaving(true); setErr('');
    try {
      await api.post(`/tank-recon/${draft.id}/figures`, {
        station_id: sid,
        nozzles: nozzles.map(n => ({
          nozzle_id: n.id,
          cumulative_volume: figures[n.id]?.value ?? null,
          cumulative_amount: figures[n.id]?.amount ?? null,
          source: figures[n.id]?.source ?? null,
          read_pump_serial: figures[n.id]?.serial ?? null,
          read_nozzle_no: figures[n.id]?.no ?? null,
        })),
      });
      router.push('/tank-recon/variance');
    } catch (e) {
      setErr(errText(e, tc('recon.saveFailed', 'Could not save those figures just now.')));
      setSaving(false);
    }
  };

  if (!hubSpokesFlow) {
    return (
      <AppShell>
        <div className="card" style={{ maxWidth: 560, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Info size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, color: '#666' }}>
            {tc('recon.offBody', 'Tank Recon belongs to the hub-and-spokes flow, which is switched off here. Turn it on in Settings → Shift Timings, one outlet at a time.')}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 560 }}>
        <Stepper step={2} tc={tc} />

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 4 }}>
            {tc('recon.nozTitle', 'Read the nozzle slips')}
          </div>
          <div style={{ fontSize: 13.5, color: '#666', marginBottom: 14 }}>
            {tc('recon.nozBody', 'Print every nozzle slip, lay them flat and take one photo — or enter any line by hand.')}
          </div>
          {/* TYPING IS NOT A FALLBACK: the camera sits beside the count of what is left,
              not above a smaller "or type it" link. */}
          <PhotoCapture
            label={scanning ? tc('recon.reading', 'Reading…') : tc('recon.scanAll', 'Photograph all slips')}
            disabled={scanning} onCapture={onComposite} />
        </div>

        {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

        {notes.length > 0 && (
          <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #f59e0b' }}>
            <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#666' }}>
              {notes.map((n, i) => <div key={i}>{n}</div>)}
            </div>
          </div>
        )}

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{tc('recon.nozzles', 'Nozzles')}</span>
            {/* PARTIAL IS NORMAL — it is a count, not a warning. */}
            <span style={{ fontSize: 12.5, color: missing.length ? 'var(--brand)' : '#166534' }}>
              {nozzles.length - missing.length} / {nozzles.length} {tc('recon.read', 'read')}
            </span>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            {nozzles.map(n => {
              const f = figures[n.id];
              const src = f?.source;
              return (
                <div key={n.id}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                    {/* THE ONE NAME — read through lib/nozzle, never built here. */}
                    <span style={{ fontWeight: 600, fontSize: 13.5, fontFamily: 'monospace' }}>{nozName(n)}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-3)', textTransform: 'capitalize' }}>
                      {String(n.fuel_type || '').replace('_', ' ')}
                    </span>
                    {src && (
                      <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em',
                                     padding: '2px 7px', borderRadius: 4,
                                     background: src === 'photo' ? '#e8f2ea' : '#eef2f7',
                                     color: src === 'photo' ? '#166534' : '#475569',
                                     display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {src === 'photo' ? <Camera size={11} /> : <Keyboard size={11} />}
                        {src === 'photo' ? tc('recon.fromPhoto', 'FROM PHOTO') : tc('recon.typed', 'TYPED')}
                      </span>
                    )}
                  </div>
                  <input className="input" inputMode="decimal" value={f?.value ?? ''}
                    placeholder={tc('recon.cumVolume', 'Cumulative volume (the V line), litres')}
                    onChange={e => setFigure(n.id, { value: e.target.value, source: 'typed' })} />
                </div>
              );
            })}
            {nozzles.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                {tc('recon.noNozzles', 'No slip-printing nozzles are configured at this outlet.')}
              </div>
            )}
          </div>
        </div>

        {err && <div style={{ marginTop: 12 }}><Banner tone="error">{err}</Banner></div>}

        {/* THE CTA IS EARNED, and while grey it NAMES the nozzle it waits on. */}
        <button onClick={saveAndContinue} disabled={!ready || saving}
          style={{ width: '100%', height: 48, marginTop: 14,
                   background: (!ready || saving) ? '#e5e3de' : 'var(--brand)',
                   color: (!ready || saving) ? '#8b9099' : '#fff',
                   border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14.5,
                   cursor: (!ready || saving) ? 'not-allowed' : 'pointer' }}>
          {saving ? tc('recon.saving', 'Saving…')
            : !ready
              ? (missing.length === 1
                  ? `${tc('recon.waitingOnNoz', 'Waiting on')} ${nozName(missing[0])}`
                  : `${tc('recon.waitingOnMany', 'Waiting on')} ${missing.length} ${tc('recon.nozzlesWord', 'nozzles')}`)
              : tc('recon.nextVariance', 'Next: the variance')}
        </button>

        {/* THE QUIET WAY ON. A slip that will not read must not hold the whole recon —
            the reading can be typed, and a nozzle genuinely out of service is a reason
            to continue, not a reason to invent a figure for it. */}
        <button onClick={() => router.push('/tank-recon/variance')}
          style={{ width: '100%', marginTop: 10, background: 'none', border: '1px solid #e5e3de',
                   borderRadius: 10, padding: '10px', fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
          {tc('recon.continuePartial', 'Continue without the missing readings')}
        </button>

        <button onClick={() => router.push('/tank-recon')}
          style={{ width: '100%', marginTop: 10, background: 'none', border: 'none',
                   color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', padding: 8 }}>
          {tc('recon.backToRecon', 'Back to Tank Recon')}
        </button>
      </div>
    </AppShell>
  );
}

function Stepper({ step, tc }) {
  const steps = [tc('recon.step1', 'Console'), tc('recon.step2', 'Nozzles'), tc('recon.step3', 'Variance')];
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
      {steps.map((s, i) => (
        <div key={s} style={{ flex: 1 }}>
          <div style={{ height: 3, borderRadius: 99, background: i + 1 <= step ? 'var(--brand)' : '#e5e3de' }} />
          <div style={{ fontSize: 11.5, marginTop: 5, color: i + 1 === step ? 'var(--text)' : 'var(--text-3)',
                        fontWeight: i + 1 === step ? 600 : 400 }}>
            {i + 1}. {s}
          </div>
        </div>
      ))}
    </div>
  );
}
