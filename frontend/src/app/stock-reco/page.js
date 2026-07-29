'use client';
// Wet-stock (tank dip) reconciliation.
//   book = opening dip + deliveries − sales(L);  variance = actual dip − book.
// Two tiles, ONE format: a chosen DAY and the month it falls in. A month is just a
// longer period — first dip to last dip, with every delivery and sale between —
// never a sum of the daily variances, which only piles up per-shift noise instead
// of letting it cancel.
import { useState, useEffect, Fragment } from 'react';
import { AlertTriangle, CheckCircle, Save } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useTranslation } from 'react-i18next';

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

  // Open on the last day that HAS readings, not on today. Today is usually empty —
  // a screen full of dashes reads as "broken" rather than "nothing recorded yet".
  const loadLastDay = async () => {
    if (!stationId) return;
    const r = await api.get('/tank-reco/last-day', { params: { station_id: stationId } }).catch(() => ({}));
    const d = r?.last_day || today();
    setLastDay(r?.last_day || '');
    setDate(p => p || d);
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
    } catch (e) { alert(e.response?.data?.error || e.error || tc('streco.failed', 'Failed')); }
    setBusy(false);
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
    } catch (e) { alert(e.response?.data?.error || tc('streco.failed', 'Failed')); }
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
    </AppShell>
  );
}
