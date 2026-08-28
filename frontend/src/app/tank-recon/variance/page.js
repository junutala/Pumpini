'use client';
// SPOKE 1 · STEP 3 of 3 — THE VARIANCE.
//
// SAVED BEFORE HE DECIDES. Everything on this screen is already on the draft; Confirm
// moves it into the ledger, and "Start again" marks the draft ABANDONED and keeps it.
// A recon that vanishes when a man changes his mind is a recon he will not start twice.
//
// TESTING GETS ITS OWN LINE (owner, 27-Aug). Folded into sales it becomes an
// unexplained variance every single day. It shows only when a draw actually CROSSED
// tanks — a same-tank draw left and came back, and printing a zero for it every day
// teaches him to stop reading the line.
//
// THE ARITHMETIC IS NOT COMPUTED HERE. The server returns it from lib/varianceMath,
// the same sum Stock Reco uses over its own window. A screen that did its own
// subtraction would be a second opinion about money-adjacent stock.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Info, Truck, RotateCcw, Check } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import Banner from '../../../components/shared/Banner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText } from '../../../lib/apiError';

const L = n => n == null ? '—'
  : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const signed = n => n == null ? '—'
  : `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// A DECANT IS COMPARTMENT-SIZED, NOT TANKER-SIZED (owner, 27-Aug). Tankers are shared
// between unrelated outlets — one compartment discharged here, another elsewhere — so a
// single compartment of ~3–4 KL is a normal delivery. Fire only on a GAIN beyond the
// outlet's own tolerance AND at least this much; ~100 L is dip noise and must never ask
// a manager for a tanker invoice.
const COMPARTMENT_FLOOR_LTRS = 1000;

export default function ReconVariancePage() {
  const router = useRouter();
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [draft, setDraft] = useState(null);
  const [v, setV]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]   = useState('');
  const [err, setErr]     = useState('');
  const [done, setDone]   = useState(false);

  const load = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const r = await api.get('/tank-recon', { params: { station_id: sid } });
      const d = r?.draft || null;
      setDraft(d);
      if (d?.id) setV(await api.get(`/tank-recon/${d.id}/variance`, { params: { station_id: sid } }));
    } catch (e) {
      setErr(errText(e, tc('recon.varFailed', 'Could not work out the variance just now.')));
    }
    setLoading(false);
    // tc is rebuilt every render (it closes over i18n's `t`), so listing it here would
    // reload the variance on every keystroke elsewhere on the page. The station is the
    // only thing this actually depends on.
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const confirm = async () => {
    if (!draft?.id) return;
    setBusy('confirm'); setErr('');
    try {
      await api.post(`/tank-recon/${draft.id}/confirm`, { station_id: sid });
      setDone(true);
    } catch (e) {
      setErr(errText(e, tc('recon.confirmFailed', 'Could not confirm this recon just now.')));
      setBusy('');
    }
  };

  const startAgain = async () => {
    if (!draft?.id) return;
    setBusy('abandon'); setErr('');
    try {
      await api.post(`/tank-recon/${draft.id}/abandon`, { station_id: sid });
      router.push('/tank-recon');
    } catch (e) {
      setErr(errText(e, tc('recon.abandonFailed', 'Could not set that aside just now.')));
      setBusy('');
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

  if (done) {
    return (
      <AppShell>
        <div style={{ maxWidth: 560 }}>
          <div className="card" style={{ borderLeft: '3px solid #166534' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <Check size={18} style={{ color: '#166534' }} />
              <span style={{ fontWeight: 700, fontSize: 15.5 }}>{tc('recon.confirmed', 'Recon confirmed')}</span>
            </div>
            <div style={{ fontSize: 13.5, color: '#666' }}>
              {tc('recon.confirmedBody', 'This reading is now the boundary the next window starts from.')}
            </div>
          </div>
          <button onClick={() => router.push('/tank-recon')}
            style={{ width: '100%', height: 46, marginTop: 14, background: 'var(--brand)', color: '#fff',
                     border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>
            {tc('recon.backToRecon', 'Back to Tank Recon')}
          </button>
        </div>
      </AppShell>
    );
  }

  const tanks = v?.tanks || [];
  // The deliveries exception: a GAIN beyond tolerance and at least a compartment.
  const decantSized = tanks.filter(t =>
    t.variance_ltrs != null && t.variance_ltrs > 0 &&
    t.variance_ltrs >= COMPARTMENT_FLOOR_LTRS && t.beyond_tolerance);

  return (
    <AppShell>
      <div style={{ maxWidth: 560 }}>
        <Stepper step={3} tc={tc} />

        {err && <Banner tone="error">{err}</Banner>}

        {loading ? (
          <div className="card" style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {tc('recon.working', 'Working out the variance…')}
          </div>
        ) : !draft ? (
          <div className="card">
            <div style={{ fontSize: 13.5, color: '#666' }}>
              {tc('recon.noDraft', 'This recon is no longer open — start it again from Tank Recon.')}
            </div>
          </div>
        ) : (
          <>
            {/* THE FIRST RECON HAS NOTHING BEHIND IT, and that is a state, not a fault.
                Inventing an opening is how a phantom loss gets its first airing. */}
            {v?.first_recon && (
              <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Info size={17} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13.5, color: '#666' }}>
                  {tc('recon.firstBody', 'This is the first recon at this outlet, so there is nothing to reconcile against yet. Confirm it to set the baseline — the next one will show a variance.')}
                </div>
              </div>
            )}

            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 12 }}>
                {tc('recon.varianceTitle', 'The variance')}
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                {tanks.map(t => (
                  <div key={t.tank_id} style={{ paddingTop: 12, borderTop: '1px solid #f0ebe3' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                        {tc('recon.tank', 'Tank')} {t.tank_number}
                      </span>
                      <span style={{ fontSize: 12.5, color: 'var(--text-3)', textTransform: 'capitalize' }}>
                        {String(t.fuel_type || '').replace('_', ' ')}
                      </span>
                      <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 700, fontSize: 15,
                                     color: t.variance_ltrs == null ? 'var(--text-3)'
                                          : t.beyond_tolerance ? '#991b1b' : '#166534' }}>
                        {signed(t.variance_ltrs)} L
                      </span>
                    </div>

                    <Row label={tc('recon.opening', 'Opening')} value={L(t.opening_ltrs)} tc={tc} />
                    <Row label={tc('recon.delivered', 'Delivered')} value={L(t.delivered_ltrs)} tc={tc} />
                    <Row label={tc('recon.sales', 'Sold, by the nozzles')} value={L(t.sales_ltrs)} tc={tc} />
                    {/* TESTING ON ITS OWN LINE — but only when a draw crossed tanks. */}
                    {Number(t.testing_ltrs) !== 0 && (
                      <Row label={tc('recon.testing', 'Testing moved between tanks')}
                        value={signed(t.testing_ltrs)} tc={tc} />
                    )}
                    <Row label={tc('recon.book', 'Book')} value={L(t.book_ltrs)} tc={tc} strong />
                    <Row label={tc('recon.actual', 'Read from the console')} value={L(t.actual_ltrs)} tc={tc} strong />
                    {t.variance_ltrs != null && (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 5 }}>
                        {tc('recon.tolerance', 'Tolerance')} ±{L(t.tolerance_ltrs)} L
                        {t.beyond_tolerance ? ` — ${tc('recon.beyond', 'beyond it')}` : ''}
                      </div>
                    )}
                  </div>
                ))}
                {tanks.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                    {tc('recon.noTanks', 'No dippable tanks are configured at this outlet.')}
                  </div>
                )}
              </div>
            </div>

            {/* THE EXCEPTION, NOT A STEP. Deliveries can be weekly; a daily screen for a
                weekly event teaches a manager to tap through it. A decant-sized GAIN
                leads here instead, at the moment he has a reason to remember it. */}
            {decantSized.length > 0 && (
              <div className="card" style={{ marginTop: 12, borderLeft: '3px solid var(--brand)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                  <Truck size={17} style={{ color: 'var(--brand)' }} />
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                    {tc('recon.tankerTitle', 'A delivery may be missing')}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: '#666' }}>
                  {decantSized.map(t => `${tc('recon.tank', 'Tank')} ${t.tank_number}`).join(', ')}
                  {' '}{tc('recon.tankerBody', 'gained more than a compartment holds. If a tanker was decanted and its invoice never scanned, this is the moment to add it.')}
                </div>
                <button onClick={() => router.push('/deliveries')}
                  style={{ marginTop: 12, background: 'var(--brand)', color: '#fff', border: 'none',
                           borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                  {tc('recon.tankerYes', 'Yes — add the delivery')}
                </button>
              </div>
            )}

            <button onClick={confirm} disabled={!!busy}
              style={{ width: '100%', height: 48, marginTop: 14,
                       background: busy ? '#e5e3de' : 'var(--brand)',
                       color: busy ? '#8b9099' : '#fff',
                       border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15,
                       cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy === 'confirm' ? tc('recon.confirming', 'Confirming…') : tc('recon.confirmCta', 'Confirm this recon')}
            </button>

            {/* START AGAIN KEEPS IT. Marked abandoned, never deleted. */}
            <button onClick={startAgain} disabled={!!busy}
              style={{ width: '100%', marginTop: 10, background: 'none', border: '1px solid #e5e3de',
                       borderRadius: 10, padding: '10px', fontSize: 13, color: 'var(--text-3)',
                       cursor: busy ? 'not-allowed' : 'pointer',
                       display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <RotateCcw size={14} />
              {busy === 'abandon' ? tc('recon.settingAside', 'Setting aside…') : tc('recon.startAgain', 'Start again')}
            </button>

            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10, textAlign: 'center' }}>
              {tc('recon.draftNote', 'Saved as a draft either way — starting again keeps this one on file rather than deleting it.')}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
      <span style={{ fontSize: 13, color: strong ? 'var(--text)' : '#666', fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontSize: 13.5, fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
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
