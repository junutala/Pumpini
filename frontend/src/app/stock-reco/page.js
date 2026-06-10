'use client';
// Wet-stock (tank dip) reconciliation. Per tank, per shift:
//   book = opening dip + deliveries − sales(L);  variance = actual dip − book.
// Negative = loss (evaporation/pilferage). Beyond the per-fuel tolerance → owner
// alert. Also shows cumulative drift per tank to catch slow, under-tolerance leaks.
import { useState, useEffect } from 'react';
import { Droplet, AlertTriangle, CheckCircle, Save } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const L = n => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function StockRecoPage() {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const isOwner = user?.role === 'owner';

  const [shifts, setShifts]   = useState([]);
  const [shiftId, setShiftId] = useState('');
  const [reco, setReco]       = useState(null);   // { tanks: [...] }
  const [cum, setCum]         = useState([]);     // cumulative drift
  const [busy, setBusy]       = useState(false);
  const [tol, setTol]         = useState({});     // tolerance settings
  const [savingTol, setSavingTol] = useState(false);

  const loadShifts = async () => {
    if (!stationId) return;
    const s = await api.get('/shifts', { params: { station_id: stationId, date: today() } }).catch(() => []);
    const arr = Array.isArray(s) ? s : [];
    setShifts(arr);
    if (arr.length && !shiftId) setShiftId(arr[0].id);
  };
  const loadCum = async () => {
    if (!stationId) return;
    const r = await api.get('/tank-reco', { params: { station_id: stationId, days: 30 } }).catch(() => ({}));
    setCum(Array.isArray(r?.cumulative) ? r.cumulative : []);
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

  useEffect(() => { loadShifts(); loadCum(); loadTol(); }, [stationId]);
  useRefreshOnFocus(loadCum);

  useEffect(() => {
    if (!shiftId) { setReco(null); return; }
    api.get(`/tank-reco/shift/${shiftId}`).then(setReco).catch(() => setReco(null));
  }, [shiftId]);

  const finalize = async () => {
    if (!shiftId) return;
    setBusy(true);
    try {
      const r = await api.post(`/tank-reco/shift/${shiftId}`);
      alert(`Reconciliation saved for ${r.stored} tank(s). ${r.breaches ? `⚠️ ${r.breaches} beyond tolerance — owner alerted.` : 'All within tolerance.'}`);
      loadCum();
    } catch (e) { alert(e.response?.data?.error || e.error || 'Failed'); }
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
      if (shiftId) api.get(`/tank-reco/shift/${shiftId}`).then(setReco).catch(() => {});
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
    setSavingTol(false);
  };

  const tanks = reco?.tanks || [];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock Reconciliation</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Tank dip vs book — catches evaporation, leakage and pilferage.</div>
        </div>
        <select className="input" style={{ width: 220 }} value={shiftId} onChange={e => setShiftId(e.target.value)}>
          <option value="">Select a shift…</option>
          {shifts.map(s => <option key={s.id} value={s.id}>Shift {s.shift_number} · {s.status}</option>)}
        </select>
      </div>

      {/* Tolerance config (owner) */}
      {isOwner && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Variance Tolerance</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label className="label">Petrol %</label><input className="input" style={{ width: 100 }} type="number" step="0.05" value={tol.stock_tol_pct_petrol ?? ''} onChange={e => setTol(p => ({ ...p, stock_tol_pct_petrol: e.target.value }))} /></div>
            <div><label className="label">Diesel %</label><input className="input" style={{ width: 100 }} type="number" step="0.05" value={tol.stock_tol_pct_diesel ?? ''} onChange={e => setTol(p => ({ ...p, stock_tol_pct_diesel: e.target.value }))} /></div>
            <div><label className="label">Min floor (L)</label><input className="input" style={{ width: 100 }} type="number" step="1" value={tol.stock_tol_floor_ltrs ?? ''} onChange={e => setTol(p => ({ ...p, stock_tol_floor_ltrs: e.target.value }))} /></div>
            <button className="btn btn-secondary" onClick={saveTol} disabled={savingTol}><Save size={14} />{savingTol ? 'Saving…' : 'Save'}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Tolerance = max(floor, (opening + deliveries) × %). Petrol evaporates faster than diesel.</div>
        </div>
      )}

      {/* Per-tank reconciliation for the selected shift */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Selected Shift</div>
          <button className="btn btn-primary" onClick={finalize} disabled={busy || !tanks.some(t => t.has_closing)}>
            {busy ? 'Saving…' : 'Finalize & Alert'}
          </button>
        </div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Tank</th><th style={{ textAlign: 'right' }}>Opening</th><th style={{ textAlign: 'right' }}>+ Deliveries</th>
                <th style={{ textAlign: 'right' }}>− Sales</th><th style={{ textAlign: 'right' }}>Book</th>
                <th style={{ textAlign: 'right' }}>Actual dip</th><th style={{ textAlign: 'right' }}>Variance</th><th style={{ textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tanks.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>Select a shift to see its tank reconciliation.</td></tr>}
              {tanks.map(t => {
                const loss = t.has_closing && t.variance_ltrs < 0;
                return (
                  <tr key={t.tank_id} style={t.beyond_tolerance ? { background: '#fef2f2' } : undefined}>
                    <td style={{ fontWeight: 600 }}>T{t.tank_number} <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 12 }}>{t.fuel_type}</span></td>
                    <td className="num" style={{ textAlign: 'right' }}>{L(t.opening_ltrs)}</td>
                    <td className="num" style={{ textAlign: 'right', color: '#16a34a' }}>{L(t.deliveries_ltrs)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{L(t.sales_ltrs)}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{L(t.book_closing)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{t.has_closing ? L(t.actual_closing) : '—'}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: !t.has_closing ? 'var(--text-3)' : loss ? '#dc2626' : '#16a34a' }}>
                      {t.has_closing ? `${t.variance_ltrs > 0 ? '+' : ''}${L(t.variance_ltrs)} (${t.variance_pct}%)` : '—'}
                    </td>
                    <td style={{ textAlign: 'center', fontSize: 12 }}>
                      {!t.has_closing ? <span style={{ color: 'var(--text-3)' }}>Awaiting dip</span>
                        : t.beyond_tolerance ? <span style={{ color: '#dc2626', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={13} />{loss ? 'Loss' : 'Gain'}</span>
                          : <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle size={13} />OK</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 14px' }}>“Awaiting dip” = closing dip not yet entered for that tank (record it on the Dipstick screen, then finalize).</div>
      </div>

      {/* Cumulative drift — slow leaks that hide under per-shift tolerance */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: '0.75rem' }}>Cumulative Drift <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>· last 30 days</span></div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead><tr><th>Tank</th><th style={{ textAlign: 'center' }}>Reconciliations</th><th style={{ textAlign: 'center' }}>Breaches</th><th style={{ textAlign: 'right' }}>Net variance (30d)</th></tr></thead>
            <tbody>
              {cum.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '1.5rem' }}>No finalized reconciliations yet.</td></tr>}
              {cum.map(c => {
                const net = parseFloat(c.cum_variance || 0);
                return (
                  <tr key={c.tank_id}>
                    <td style={{ fontWeight: 600 }}>T{c.tank_number} <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 12 }}>{c.fuel_type}</span></td>
                    <td style={{ textAlign: 'center' }}>{c.recos}</td>
                    <td style={{ textAlign: 'center', color: c.breaches ? '#dc2626' : 'var(--text-3)', fontWeight: c.breaches ? 700 : 400 }}>{c.breaches}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: net < 0 ? '#dc2626' : '#16a34a' }}>{net > 0 ? '+' : ''}{L(net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 14px' }}>A persistent one-way net variance — even if each shift passes — is the fingerprint of a slow leak or steady pilferage.</div>
      </div>
    </AppShell>
  );
}
