'use client';
// SPOKE 1 · STEP 1 of 3 — PHOTOGRAPH THE GAUGE CONSOLE.
//
// Screens 2, 3 and 3b of the design are ONE page, because they are one act: point the
// camera, wait, check what came back. Splitting them into routes would put a page load
// between a manager and the figure he is still holding the console up to verify.
//
// THREE RULES FROM THE DESIGN, AND WHERE THEY LIVE HERE:
//
// 1. TYPING IS NOT A FALLBACK. The camera and "Enter by hand" are the same size, the
//    same height, the same border, side by side. Neither is styled as the escape from
//    the other, and every figure carries a badge saying which one produced it.
//
// 2. THE BAR FILLS TO 90% AND HOLDS. Three real stages, and it never animates to 100
//    before the answer is back. A bar that claims to be finished and then sits there is
//    exactly how a manager learns not to trust the camera.
//
// 3. THE CTA IS EARNED. Grey until every dippable tank carries a figure, and while grey
//    it names the tank it is waiting on.
//
// NOT A SECOND MATCHER. The console rows are placed onto this outlet's tanks by
// lib/gaugeMatch.matchGaugeRows — the same function Shift Close uses. A screen that
// matched tanks its own way is precisely the drift the cardinal rule forbids, and this
// matcher already carries the 20-Aug lesson (the MASTER capacity refuses an impossible
// volume; the console's own capacity never does).
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Keyboard, RotateCcw, Smartphone, Info } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import PhotoCapture from '../../../components/shared/PhotoCapture';
import Banner from '../../../components/shared/Banner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { matchGaugeRows } from '../../../lib/gaugeMatch';
import { useTranslation } from 'react-i18next';
import { errText } from '../../../lib/apiError';

// CNG is sold by weight and is never dipped — it is not part of a tank recon, exactly
// as the dip-staleness flags already exclude it.
const isDippable = t => String(t.fuel_type || '').toLowerCase() !== 'cng';
const L = n => (n == null || n === '') ? '—'
  : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;

const STAGES = [
  { pct: 30, key: 'recon.stageSend',  fallback: 'Sending the photograph' },
  { pct: 65, key: 'recon.stageRead',  fallback: 'Reading the console screen' },
  { pct: 90, key: 'recon.stageMatch', fallback: 'Matching the tanks to this outlet' },
];

export default function AtgCapturePage() {
  const router = useRouter();
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [tanks, setTanks]   = useState([]);
  const [phase, setPhase]   = useState('capture');   // capture | reading | result
  const [stage, setStage]   = useState(0);
  const [banner, setBanner] = useState(null);        // {tone, text}
  // tank_id -> { value, source: 'photo'|'typed' }
  const [figures, setFigures] = useState({});
  const [notes, setNotes]     = useState([]);
  const [draft, setDraft]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    if (!sid) return;
    api.get(`/dipstick/tanks/${sid}`)
      .then(r => setTanks((Array.isArray(r) ? r : []).filter(isDippable)))
      .catch(() => setTanks([]));
  }, [sid]);

  // THE DRAFT HE IS FILLING. Started on the landing, resumed here — and its stored
  // figures are loaded back, so a man who closed the tab picks up where he left off
  // rather than photographing the console a second time.
  useEffect(() => {
    if (!sid) return;
    api.get('/tank-recon', { params: { station_id: sid } })
      .then(r => {
        const d = r?.draft || null;
        setDraft(d);
        if (d?.tanks?.length) {
          const back = {};
          for (const t of d.tanks) {
            if (t.volume_ltrs != null) back[t.tank_id] = { value: String(t.volume_ltrs), source: t.source || 'typed' };
          }
          if (Object.keys(back).length) { setFigures(f => ({ ...back, ...f })); setPhase('result'); }
        }
      })
      .catch(() => {});
  }, [sid]);

  const dippable = tanks;
  const missing = useMemo(
    () => dippable.filter(t => {
      const f = figures[t.id];
      return !f || f.value === '' || f.value == null;
    }),
    [dippable, figures]
  );
  const ready = dippable.length > 0 && missing.length === 0;

  const setFigure = (tankId, value, source) =>
    setFigures(f => ({ ...f, [tankId]: { value, source } }));

  // SAVED BEFORE HE DECIDES, then on to the nozzles. The figures land on the draft
  // first: if the next screen fails to load, or the phone locks on the forecourt, the
  // console reading is already kept and he resumes rather than re-photographs.
  const saveAndContinue = async () => {
    if (!draft?.id) { setSaveErr(tc('recon.noDraft', 'This recon is no longer open — start it again from Tank Recon.')); return; }
    setSaving(true); setSaveErr('');
    try {
      await api.post(`/tank-recon/${draft.id}/figures`, {
        station_id: sid,
        tanks: dippable.map(t => ({
          tank_id: t.id,
          volume_ltrs: figures[t.id]?.value ?? null,
          source: figures[t.id]?.source ?? null,
        })),
      });
      router.push('/tank-recon/nozzles');
    } catch (e) {
      setSaveErr(errText(e, tc('recon.saveFailed', 'Could not save those figures just now.')));
      setSaving(false);
    }
  };

  // SKIP LANDS STRAIGHT ON THE FIGURES. A man who has decided to type should not be
  // made to watch a spinner first — the progress bar belongs to the camera, not to him.
  const enterByHand = () => {
    setBanner(null);
    setNotes([]);
    setPhase('result');
  };

  const onCapture = async (cap) => {
    if (!cap) return;
    setPhase('reading');
    setStage(0);
    setBanner(null);
    setNotes([]);
    // The stages advance on their own up to 90 and then STOP. Whatever happens next is
    // the response landing, never the bar deciding it is done.
    const timers = [
      setTimeout(() => setStage(1), 1200),
      setTimeout(() => setStage(2), 3600),
    ];
    try {
      const r = await api.post('/dipstick/parse-gauge', {
        file_base64: cap.base64, media_type: cap.media_type,
      });
      const rows = Array.isArray(r?.tanks) ? r.tanks : [];
      const m = matchGaugeRows(rows, dippable, { table_state: r?.table_state });

      const next = {};
      for (const [tank, row] of (m.pairs || [])) {
        if (row.net_volume_ltrs != null) next[tank.id] = { value: String(row.net_volume_ltrs), source: 'photo' };
      }
      setFigures(f => ({ ...f, ...next }));

      // WHAT THE MATCHER REFUSED OR RENAMED, said plainly and never swallowed. These
      // are the cases that produced three false findings on 18-Aug when they were left
      // to a banner nobody read.
      const said = [];
      // The table was read and its own two keys disagree — the tank number says one
      // thing, the product says another. Neither is worth more than the other, so the
      // row is not placed. See lib/gaugeMatch.js, 31-Aug-2026.
      for (const o of (m.mismatched || [])) {
        said.push(tc('recon.noteMismatch',
          `The screen's tank ${o.console} reads as ${o.fuel}, which does not match that tank here. Not filled — check the photo or type it.`));
      }
      for (const o of (m.overCapacity || [])) {
        said.push(tc('recon.noteOverCap', `Tank ${o.tank} — the screen read ${L(o.vol)} against ${L(o.cap)} installed. Not filled; read it again or type it.`));
      }
      for (const u of (m.unplaced || [])) said.push(tc('recon.noteUnplaced', `The console shows ${u}, which is not a tank at this outlet.`));
      for (const d of (m.dropped || []))  said.push(tc('recon.noteDropped',  `${d} — the console showed no volume for it.`));
      for (const rn of (m.renumbered || [])) said.push(tc('recon.noteRenum', `Console tank ${rn.console} filled Tank ${rn.tank} (${rn.fuel}) — the numbers disagree.`));
      setNotes(said);

      const filled = Object.keys(next).length;
      setBanner(
        filled === 0
          ? { tone: 'error',   text: tc('recon.readNone', 'Nothing usable on that photo — enter the readings below.') }
          : said.length
            ? { tone: 'warn',  text: tc('recon.readCheck', 'Check the figures before you continue.') }
            : { tone: 'ok', text: tc('recon.readOk', 'Read — check the figures and continue.') }
      );
    } catch (e) {
      setBanner({ tone: 'error', text: errText(e, tc('recon.readFailed', 'Could not read the screen — enter the readings below.')) });
    } finally {
      timers.forEach(clearTimeout);
      setPhase('result');           // NOTHING DEAD-ENDS: a failed read still lands on the figures.
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

        <Stepper step={1} tc={tc} />

        {phase === 'capture' && (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 4 }}>
              {tc('recon.atgTitle', 'Photograph the gauge console')}
            </div>
            <div style={{ fontSize: 13.5, color: '#666', marginBottom: 14 }}>
              {tc('recon.atgBody', 'One photo of the whole screen, with every tank visible.')}
            </div>

            {/* LANDSCAPE. The console is a wide screen and it reads far better held
                the same way round. Worth nothing if the upload arrives rotated, so the
                capture component honours the EXIF orientation. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px',
                          background: '#faf8f5', border: '1px solid #f0ebe3', borderRadius: 8,
                          fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
              <Smartphone size={15} style={{ transform: 'rotate(90deg)', flexShrink: 0 }} />
              {tc('recon.atgLandscape', 'Turn the phone sideways — the console is a wide screen.')}
            </div>

            {/* TYPING IS NOT A FALLBACK: same size, same height, same border. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <PhotoCapture label={tc('recon.atgTake', 'Photograph')} onCapture={onCapture} />
              <button onClick={enterByHand}
                style={{ height: 44, background: '#fff', border: '1.5px solid #e5e3de', borderRadius: 8,
                         fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                         display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Keyboard size={16} />
                {tc('recon.atgType', 'Enter by hand')}
              </button>
            </div>
          </div>
        )}

        {phase === 'reading' && (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 14 }}>
              {tc('recon.reading', 'Reading the console')}
            </div>
            <div style={{ height: 6, background: '#f0ebe3', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${STAGES[stage].pct}%`, background: 'var(--brand)',
                            borderRadius: 99, transition: 'width .7s ease' }} />
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
              {STAGES.map((s, i) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                                          color: i <= stage ? 'var(--text)' : 'var(--text-3)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, flexShrink: 0,
                                 background: i <= stage ? 'var(--brand)' : '#ddd' }} />
                  {tc(s.key, s.fallback)}{i === stage ? '…' : ''}
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'result' && (
          <>
            {banner && <div style={{ marginBottom: 12 }}><Banner tone={banner.tone}>{banner.text}</Banner></div>}

            {notes.length > 0 && (
              <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #f59e0b' }}>
                <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#666' }}>
                  {notes.map((n, i) => <div key={i}>{n}</div>)}
                </div>
              </div>
            )}

            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 2 }}>
                {tc('recon.figuresTitle', 'What we read')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
                {tc('recon.figuresBody', 'Every figure is yours to change. The tag says where it came from.')}
              </div>

              {dippable.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                  {tc('recon.noTanks', 'No dippable tanks are configured at this outlet.')}
                </div>
              )}

              <div style={{ display: 'grid', gap: 12 }}>
                {dippable.map(t => {
                  const f = figures[t.id];
                  const src = f?.source;
                  return (
                    <div key={t.id}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                          {tc('recon.tank', 'Tank')} {t.tank_number}
                        </span>
                        <span style={{ fontSize: 12.5, color: 'var(--text-3)', textTransform: 'capitalize' }}>
                          {String(t.fuel_type || '').replace('_', ' ')}
                        </span>
                        {/* THE BADGE. Every figure says which hand produced it. */}
                        {src && (
                          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em',
                                         padding: '2px 7px', borderRadius: 4,
                                         background: src === 'photo' ? '#e8f2ea' : '#eef2f7',
                                         color:      src === 'photo' ? '#166534' : '#475569',
                                         display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {src === 'photo' ? <Camera size={11} /> : <Keyboard size={11} />}
                            {src === 'photo' ? tc('recon.fromPhoto', 'FROM PHOTO') : tc('recon.typed', 'TYPED')}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="input" inputMode="decimal" value={f?.value ?? ''}
                          placeholder={tc('recon.netVolume', 'Net volume, litres')}
                          onChange={e => setFigure(t.id, e.target.value, 'typed')}
                          style={{ flex: 1 }} />
                        {t.capacity_ltrs != null && (
                          <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                            / {L(t.capacity_ltrs)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => { setPhase('capture'); setBanner(null); setNotes([]); }}
                style={{ marginTop: 16, background: 'none', border: '1px solid #e5e3de', borderRadius: 8,
                         padding: '7px 13px', fontSize: 13, cursor: 'pointer',
                         display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RotateCcw size={14} />
                {tc('recon.retake', 'Photograph again')}
              </button>
            </div>

            {saveErr && <div style={{ marginTop: 12 }}><Banner tone="error">{saveErr}</Banner></div>}

            {/* THE CTA IS EARNED. Grey until every tank carries a figure, and while grey
                it NAMES the tank it is waiting on rather than just refusing. */}
            <button onClick={saveAndContinue} disabled={!ready || saving}
              style={{ width: '100%', height: 48, marginTop: 14,
                       background: (!ready || saving) ? '#e5e3de' : 'var(--brand)',
                       color: (!ready || saving) ? '#8b9099' : '#fff',
                       border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14.5,
                       cursor: (!ready || saving) ? 'not-allowed' : 'pointer' }}>
              {saving ? tc('recon.saving', 'Saving…')
                : !ready
                  ? (missing.length === 1
                      ? `${tc('recon.waitingOn', 'Waiting on Tank')} ${missing[0].tank_number}`
                      : `${tc('recon.waitingOnMany', 'Waiting on')} ${missing.length} ${tc('recon.tanksWord', 'tanks')}`)
                  : tc('recon.nextNozzles', 'Next: nozzle readings')}
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, textAlign: 'center' }}>
              {ready
                ? tc('recon.savedAsDraft', 'Saved as a draft — nothing is in the ledger until you confirm.')
                : tc('recon.ctaWhy', 'Every tank needs a figure before this step can close.')}
            </div>

            <button onClick={() => router.push('/tank-recon')}
              style={{ width: '100%', marginTop: 12, background: 'none', border: 'none',
                       color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', padding: 8 }}>
              {tc('recon.backToRecon', 'Back to Tank Recon')}
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}

// TOP STEPPER, never a right-hand rail (owner, 27-Aug): the rail broke on a phone, and
// the phone is where this work actually happens.
function Stepper({ step, tc }) {
  const steps = [
    tc('recon.step1', 'Console'),
    tc('recon.step2', 'Nozzles'),
    tc('recon.step3', 'Variance'),
  ];
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
