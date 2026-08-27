'use client';
// Wet-stock (tank dip) reconciliation.
//   book = opening dip + deliveries − sales(L);  variance = actual dip − book.
// Two tiles, ONE format: a chosen DAY and the month it falls in. A month is just a
// longer period — first dip to last dip, with every delivery and sale between —
// never a sum of the daily variances, which only piles up per-shift noise instead
// of letting it cancel.
//
// A THIRD tile — the Drift report — answers a different question over a period the
// owner picks: how much fuel went missing per litre SOLD, with delivery gains taken
// out. It lives here rather than on a page of its own because it reconciles the same
// tanks from the same dips; a second Stock screen is exactly the drift the cardinal
// rule forbids.
import { useState, useEffect, Fragment } from 'react';
import { AlertTriangle, CheckCircle, Save, Play } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useTranslation } from 'react-i18next';

import { errText } from '../../lib/apiError';
const L = n => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// DD MMM YYYY, en-IN — never a raw ISO string in front of a user.
const human = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN',
  { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const firstOfMonth = d => `${d.slice(0, 7)}-01`;
const lastOfMonth  = d => {
  const [y, m] = d.split('-').map(Number);
  return `${d.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const minDate = (a, b) => (a && b) ? (a < b ? a : b) : (a || b);
const daysBefore = (d, n) => {
  const t = new Date(`${d}T00:00:00`); t.setDate(t.getDate() - n);
  return t.toLocaleDateString('en-CA');
};
const signed = n => `${Number(n || 0) > 0 ? '+' : ''}${L(n)}`;

export default function StockRecoPage() {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const isOwner = user?.role === 'owner';
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [date, setDate]     = useState('');     // chosen trade day (blank until we know the last one)
  const [lastDay, setLastDay] = useState('');   // most recent day that actually has dips
  const [day, setDayReco]   = useState(null);   // { tanks, totals }
  const [month, setMonth]   = useState(null);   // { tanks, totals, date_from, date_to }
  const [busy, setBusy]     = useState(false);
  const [tol, setTol]       = useState({});
  const [savingTol, setSavingTol] = useState(false);

  // Drift report — deliberately NOT auto-loaded. It walks every shift in the period
  // against every tank, which is a far heavier read than the two tiles above; firing
  // it on page load would tax a screen most people open to check one day. On demand
  // means on demand.
  const [dFrom, setDFrom]   = useState('');
  const [dTo, setDTo]       = useState('');
  const [drift, setDrift]   = useState(null);
  const [dBusy, setDBusy]   = useState(false);
  const [dErr, setDErr]     = useState('');

  // Open on the last day that HAS readings, not on today. Today is usually empty —
  // a screen full of dashes reads as "broken" rather than "nothing recorded yet".
  const loadLastDay = async () => {
    if (!stationId) return;
    const r = await api.get('/tank-reco/last-day', { params: { station_id: stationId } }).catch(() => ({}));
    const d = r?.last_day || today();
    setLastDay(r?.last_day || '');
    setDate(p => p || d);
    // Default to the 60 days ending on the last day that HAS dips — the same reason
    // the day tile does not open on today: a period of empty days reads as a fault.
    setDTo(p => p || d);
    setDFrom(p => p || daysBefore(d, 60));
  };
  const loadTol = async () => {
    if (!stationId) return;
    const s = await api.get(`/stations/${stationId}/settings`).catch(() => ({}));
    setTol({
      stock_tol_pct_petrol: s?.stock_tol_pct_petrol ?? 0.75,
      stock_tol_pct_diesel: s?.stock_tol_pct_diesel ?? 0.50,
      stock_tol_floor_ltrs: s?.stock_tol_floor_ltrs ?? 20,
    });
  };

  const period = (from, to) => api
    .get('/tank-reco/period', { params: { station_id: stationId, date_from: from, date_to: to } })
    .catch(() => null);

  // The month tile covers the 1st of the chosen day's month up to the last day that
  // has data — so it reads "1 Jul – 28 Jul 2026" and never trails empty days.
  const monthTo = date ? minDate(lastOfMonth(date), lastDay || today()) : '';
  const monthFrom = date ? firstOfMonth(date) : '';

  const reload = async () => {
    if (!stationId || !date) return;
    const [d, m] = await Promise.all([period(date, date), period(monthFrom, monthTo)]);
    setDayReco(d); setMonth(m);
  };

  useEffect(() => { loadLastDay(); loadTol(); }, [stationId]);           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [stationId, date, monthFrom, monthTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useRefreshOnFocus(reload);

  // Finalize every shift on the chosen day — the stored reconciliation and the owner
  // alert are still per shift, so the day view fans out to each of them.
  const finalize = async () => {
    if (!date) return;
    setBusy(true);
    try {
      const shifts = await api.get('/shifts', { params: { station_id: stationId, date } }).catch(() => []);
      const list = Array.isArray(shifts) ? shifts : [];
      if (!list.length) { alert(tc('streco.noShiftsToFinalize', 'No shifts on this day to finalize.')); setBusy(false); return; }
      let stored = 0, breaches = 0;
      for (const s of list) {
        const r = await api.post(`/tank-reco/shift/${s.id}`).catch(() => null);
        if (r) { stored += r.stored || 0; breaches += r.breaches || 0; }
      }
      alert(tc('streco.recoSaved', 'Reconciliation saved for {n} tank(s).').replace('{n}', stored) + ' ' +
        (breaches ? tc('streco.breachAlert', '⚠️ {n} beyond tolerance — owner alerted.').replace('{n}', breaches)
                  : tc('streco.allWithinTol', 'All within tolerance.')));
      reload();
    } catch (e) { alert(errText(e, tc('streco.failed', 'Failed'))); }
    setBusy(false);
  };

  const runDrift = async () => {
    if (!stationId || !dFrom || !dTo) return;
    if (dFrom > dTo) { setDErr(tc('streco.driftBadRange', 'The “from” date is after the “to” date.')); return; }
    setDBusy(true); setDErr('');
    try {
      const r = await api.get('/tank-reco/drift', { params: { station_id: stationId, date_from: dFrom, date_to: dTo } });
      setDrift(r);
    } catch (e) {
      setDrift(null);
      setDErr(errText(e, tc('streco.failed', 'Failed')));
    }
    setDBusy(false);
  };

  const saveTol = async () => {
    setSavingTol(true);
    try {
      await api.patch(`/stations/${stationId}/stock-tolerance`, {
        stock_tol_pct_petrol: parseFloat(tol.stock_tol_pct_petrol),
        stock_tol_pct_diesel: parseFloat(tol.stock_tol_pct_diesel),
        stock_tol_floor_ltrs: parseFloat(tol.stock_tol_floor_ltrs),
      });
      reload();
    } catch (e) { alert(errText(e, tc('streco.failed', 'Failed'))); }
    setSavingTol(false);
  };

  const Row = ({ r, total }) => {
    const reconcilable = r.has_baseline && r.has_closing;
    const loss = reconcilable && r.variance_ltrs < 0;
    const label = total
      ? tc('streco.allOfFuel', 'All {f}').replace('{f}', r.fuel_type)
      : <>T{r.tank_number} <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 12 }}>{r.fuel_type}</span></>;
    const bg = total ? '#f8fafc' : (r.beyond_tolerance ? '#fef2f2' : undefined);
    const fw = total ? 700 : undefined;
    return (
      <tr style={{ background: bg, borderTop: total ? '2px solid #e2e8f0' : undefined }}>
        <td style={{ fontWeight: total ? 800 : 600 }}>{label}</td>
        <td className="num" style={{ textAlign: 'right', fontWeight: fw }}>{r.has_baseline ? L(r.opening_ltrs) : '—'}</td>
        <td className="num" style={{ textAlign: 'right', color: '#16a34a', fontWeight: fw }}>{L(r.deliveries_ltrs)}</td>
        <td className="num" style={{ textAlign: 'right', fontWeight: fw }}>{L(r.sales_ltrs)}</td>
        <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{reconcilable ? L(r.book_closing) : '—'}</td>
        <td className="num" style={{ textAlign: 'right', fontWeight: fw }}>{r.has_closing ? L(r.actual_closing) : '—'}</td>
        <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: !reconcilable ? 'var(--text-3)' : loss ? '#dc2626' : '#16a34a' }}>
          {reconcilable ? `${r.variance_ltrs > 0 ? '+' : ''}${L(r.variance_ltrs)}${r.variance_pct != null ? ` (${r.variance_pct}%)` : ''}` : '—'}
        </td>
        <td style={{ textAlign: 'center', fontSize: 12 }}>
          {!r.has_closing ? <span style={{ color: 'var(--text-3)' }}>{tc('streco.awaitingDip', 'Awaiting dip')}</span>
            : !r.has_baseline ? <span style={{ color: '#d97706', fontWeight: 600 }}>{tc('streco.noBaseline', 'No opening baseline')}</span>
            : r.beyond_tolerance ? <span style={{ color: '#dc2626', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={13} />{loss ? tc('streco.loss', 'Loss') : tc('streco.gain', 'Gain')}</span>
            : <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle size={13} />{tc('streco.ok', 'OK')}</span>}
        </td>
      </tr>
    );
  };

  const Table = ({ data, empty }) => {
    const tanks  = data?.tanks || [];
    const totals = data?.totals || [];
    return (
      <div className="table-wrap">
        <table className="dms-table">
          <thead>
            <tr>
              <th>{tc('streco.colTank', 'Tank')}</th>
              <th style={{ textAlign: 'right' }}>{tc('streco.colOpening', 'Opening')}</th>
              <th style={{ textAlign: 'right' }}>{tc('streco.colDeliveries', '+ Deliveries')}</th>
              <th style={{ textAlign: 'right' }}>{tc('streco.colSales', '− Sales')}</th>
              <th style={{ textAlign: 'right' }}>{tc('streco.colBook', 'Book')}</th>
              <th style={{ textAlign: 'right' }}>{tc('streco.colActualDip', 'Actual dip')}</th>
              <th style={{ textAlign: 'right' }}>{tc('streco.colVariance', 'Variance')}</th>
              <th style={{ textAlign: 'center' }}>{tc('streco.colStatus', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {tanks.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>{empty}</td></tr>}
            {tanks.map((r, i) => {
              // A fuel's subtotal sits directly under its own tanks, not in a block at
              // the foot of the table — it belongs with the rows it adds up.
              const total = totals.find(x => x.fuel_type === r.fuel_type);
              const lastOfFuel = !tanks.slice(i + 1).some(x => x.fuel_type === r.fuel_type);
              return (
                <Fragment key={r.tank_id}>
                  <Row r={r} />
                  {total && lastOfFuel && <Row r={total} total />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Only meaningful when a fuel actually has more than one tank.
  const hasTotals = (month?.totals?.length || 0) > 0;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('streco.title', 'Stock Reconciliation')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('streco.subtitle', 'Tank dip vs book — catches evaporation, leakage and pilferage.')}</div>
        </div>
      </div>

      {/* Tolerance config (owner) */}
      {isOwner && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{tc('streco.varianceTolerance', 'Variance Tolerance')}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label className="label">{tc('streco.petrolPct', 'Petrol %')}</label><input className="input" style={{ width: 100 }} type="number" step="0.05" value={tol.stock_tol_pct_petrol ?? ''} onChange={e => setTol(p => ({ ...p, stock_tol_pct_petrol: e.target.value }))} /></div>
            <div><label className="label">{tc('streco.dieselPct', 'Diesel %')}</label><input className="input" style={{ width: 100 }} type="number" step="0.05" value={tol.stock_tol_pct_diesel ?? ''} onChange={e => setTol(p => ({ ...p, stock_tol_pct_diesel: e.target.value }))} /></div>
            <div><label className="label">{tc('streco.minFloor', 'Min floor (L)')}</label><input className="input" style={{ width: 100 }} type="number" step="1" value={tol.stock_tol_floor_ltrs ?? ''} onChange={e => setTol(p => ({ ...p, stock_tol_floor_ltrs: e.target.value }))} /></div>
            <button className="btn btn-secondary" onClick={saveTol} disabled={savingTol}><Save size={14} />{savingTol ? tc('streco.saving', 'Saving…') : tc('streco.save', 'Save')}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{tc('streco.tolFormula', 'Tolerance = max(floor, (opening + deliveries) × %). Petrol evaporates faster than diesel.')}</div>
        </div>
      )}

      {/* ── Tile 1: one day ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{tc('streco.dayTitle', 'Day')} · {human(date)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {tc('streco.dayHint', 'All shifts on this day, opening dip to closing dip.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" className="input" style={{ width: 150 }} value={date} max={today()} onChange={e => setDate(e.target.value)} />
            <button className="btn btn-primary" onClick={finalize} disabled={busy || !date}>
              {busy ? tc('streco.saving', 'Saving…') : tc('streco.finalizeAlert', 'Finalize & Alert')}
            </button>
          </div>
        </div>
        <Table data={day} empty={tc('streco.emptyDay', 'No dip readings recorded on this day.')} />
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 14px' }}>
          {tc('streco.awaitingDipNote', '“Awaiting dip” = closing dip not yet entered for that tank (record it on the Dipstick screen, then finalize).')}{' '}
          {tc('streco.noBaselineNote', '“No opening baseline” = no opening dip and no prior closing dip to carry forward — record an opening dip so the tank can be reconciled (it is never counted as a loss).')}
        </div>
      </div>

      {/* ── Tile 2: the month that day falls in, same format ────────── */}
      <div className="card">
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {tc('streco.monthTitle', 'This month')} · {human(monthFrom)} — {human(monthTo)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            {tc('streco.monthHint', 'The whole period reconciled once: the first dip of the month against the last, with every delivery and sale in between.')}
          </div>
        </div>
        <Table data={month} empty={tc('streco.emptyMonth', 'No dip readings recorded this month.')} />
        {hasTotals && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 14px' }}>
            {tc('streco.totalRowNote', 'Where a fuel has more than one tank, judge the “All” row. Pumps can draw from either tank, so a single tank’s figure depends on how sales were split between them — the combined line is the one that reflects the stock actually on the ground.')}
          </div>
        )}
      </div>
      {/* ── Tile 3: Drift report — the real loss over a period the owner picks ── */}
      <div className="card" style={{ marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.75rem', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{tc('streco.driftTitle', 'Drift report')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, maxWidth: 620 }}>
              {tc('streco.driftHint', 'Loss per litre SOLD, over a period you choose. Delivery shifts are shown separately and never netted off — every outlet gains on decant, and averaging that against ordinary days hides a real loss.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div><label className="label">{tc('streco.from', 'From')}</label>
              <input type="date" className="input" style={{ width: 150 }} value={dFrom} max={today()} onChange={e => setDFrom(e.target.value)} /></div>
            <div><label className="label">{tc('streco.to', 'To')}</label>
              <input type="date" className="input" style={{ width: 150 }} value={dTo} max={today()} onChange={e => setDTo(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={runDrift} disabled={dBusy || !dFrom || !dTo}>
              <Play size={14} />{dBusy ? tc('streco.running', 'Running…') : tc('streco.run', 'Run report')}
            </button>
          </div>
        </div>

        {dErr && <div style={{ color: '#dc2626', fontSize: 13, padding: '4px 2px 10px' }}>{dErr}</div>}

        {!drift && !dBusy && !dErr && (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem', fontSize: 13 }}>
            {tc('streco.driftIdle', 'Choose a period and press Run report.')}
          </div>
        )}

        {drift && (
          <>
            <div className="table-wrap">
              <table className="dms-table">
                <thead>
                  <tr>
                    <th>{tc('streco.colTank', 'Tank')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colShifts', 'Shifts')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colSold', 'Litres sold')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colDrift', 'Drift')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colDriftPct', '% of sold')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colPerShift', 'Per shift')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colDelGain', 'Delivery gain')}</th>
                    <th style={{ textAlign: 'right' }}>{tc('streco.colEvents', 'Excluded')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(drift.tanks || []).length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>
                      {tc('streco.driftEmpty', 'No shift in this period has both an opening and a closing dip, so there is nothing to reconcile.')}
                    </td></tr>
                  )}
                  {(drift.tanks || []).map(r => {
                    const loss = r.drift_ltrs < 0;
                    return (
                      <tr key={r.tank_number}>
                        <td style={{ fontWeight: 600 }}>T{r.tank_number}{' '}
                          <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 12 }}>{r.fuel_type}</span></td>
                        <td className="num" style={{ textAlign: 'right' }}>{r.trading_shifts}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{L(r.litres_sold)}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: loss ? '#dc2626' : '#16a34a' }}>{signed(r.drift_ltrs)}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: loss ? '#dc2626' : '#16a34a' }}>
                          {r.drift_pct_of_sales == null ? '—' : `${r.drift_pct_of_sales > 0 ? '+' : ''}${r.drift_pct_of_sales}%`}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{r.drift_per_shift == null ? '—' : signed(r.drift_per_shift)}</td>
                        <td className="num" style={{ textAlign: 'right', color: 'var(--text-3)' }}>
                          {r.delivery_shifts === 0 ? '—'
                            : <>{signed(r.delivery_gain_ltrs)} <span style={{ fontSize: 11 }}>
                                {tc('streco.overNShifts', 'over {n}').replace('{n}', r.delivery_shifts)}</span></>}
                        </td>
                        <td className="num" style={{ textAlign: 'right', color: r.recording_events ? '#d97706' : 'var(--text-3)' }}>
                          {r.recording_events || '—'}</td>
                      </tr>
                    );
                  })}
                  {(drift.tanks || []).length > 0 && (() => {
                    const t = drift.totals || {};
                    const loss = (t.drift_ltrs || 0) < 0;
                    return (
                      <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                        <td style={{ fontWeight: 800 }}>{tc('streco.wholeOutlet', 'Whole outlet')}</td>
                        <td />
                        <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{L(t.litres_sold)}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 800, color: loss ? '#dc2626' : '#16a34a' }}>{signed(t.drift_ltrs)}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 800, color: loss ? '#dc2626' : '#16a34a' }}>
                          {t.drift_pct_of_sales == null ? '—' : `${t.drift_pct_of_sales > 0 ? '+' : ''}${t.drift_pct_of_sales}%`}</td>
                        <td />
                        <td className="num" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{signed(t.delivery_gain_ltrs)}</td>
                        <td className="num" style={{ textAlign: 'right', color: t.recording_events ? '#d97706' : 'var(--text-3)' }}>{t.recording_events || '—'}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>

            {/* COVERAGE IS PART OF THE ANSWER. A tank reconciled on a third of its
                shifts can read clean and mean nothing — the unmeasured shifts are not
                the same as measured-and-fine, and the number above must never be read
                without knowing how much of the period it actually covers. */}
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 14px', lineHeight: 1.7 }}>
              {drift.covered_from && (
                <div><strong>{tc('streco.driftPeriod', 'Period covered')}:</strong>{' '}
                  {human(drift.covered_from)} — {human(drift.covered_to)}</div>
              )}
              {drift.coverage && (
                <div>
                  <strong>{tc('streco.driftCoverage', 'Coverage')}:</strong>{' '}
                  <span style={{ color: (drift.coverage.pct ?? 0) < 70 ? '#d97706' : undefined, fontWeight: (drift.coverage.pct ?? 0) < 70 ? 700 : undefined }}>
                    {tc('streco.driftCoverageVal', '{r} of {s} shifts reconcilable ({p}%)')
                      .replace('{r}', drift.coverage.reconcilable).replace('{s}', drift.coverage.shifts)
                      .replace('{p}', drift.coverage.pct ?? 0)}
                  </span>{' '}
                  {tc('streco.driftCoverageNote', '— a shift with no closing dip is unmeasured, which is not the same as measured-and-fine.')}
                </div>
              )}
              <div>{tc('streco.driftExcludedNote', '“Excluded” counts shifts whose variance exceeds 1,000 L — almost always a tanker booked into the wrong shift, which produces a matching +/− pair on adjacent days and says nothing about fuel. They are left out of the drift figure and counted here rather than dropped quietly.')}</div>
              <div>{tc('streco.driftPctNote', 'The percentage is of litres SOLD, not of what sits in the tank: loss scales with throughput, so the yardstick must too.')}</div>
            </div>
          </>
        )}
      </div>

    </AppShell>
  );
}
