'use client';
// Manager-driven blind-drop close. The operator did nothing in-system, so the
// manager reconciles each attendant here: closing meter reading + price + test
// litres + card/UPI totals + denomination count. The server derives expected
// cash from the meter delta and returns the variance. Shortage → recover or
// salary-deduct (with operator acknowledgement); overage is silent. Once every
// attendant is reconciled, the shift can be closed.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, CheckCircle, AlertTriangle, Lock } from 'lucide-react';
import api from '../../lib/api';
import { nozName } from '../../lib/nozzle';

const NOTES = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const inp = { width: '100%', padding: '7px 9px', border: '1.5px solid #e5e3de', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff' };

export default function ManagerReconcileModal({ shift, onClose, onClosed }) {
  const [attendants, setAttendants] = useState([]);
  const [prices, setPrices]   = useState({});   // fuel_type -> price
  const [forms, setForms]     = useState({});   // attendant_id -> form
  const [results, setResults] = useState({});   // attendant_id -> server reco
  const [busy, setBusy]       = useState('');
  const [closing, setClosing] = useState(false);
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  useEffect(() => {
    (async () => {
      const d = await api.get(`/shifts/${shift.id}`);
      const att = d?.attendants || [];
      try {
        const pr = await api.get('/prices', { params: { station_id: shift.station_id } });
        const map = {}; (Array.isArray(pr) ? pr : []).forEach(p => { map[p.fuel_type] = parseFloat(p.price); });
        setPrices(map);
      } catch { /* manager can enter price */ }
      const seed = {};
      att.forEach(a => { seed[a.attendant_id] = {
        closing_reading: '', price_per_ltr: '', test_ltrs: '', card_total: '', upi_total: '',
        denom: {}, resolution: '', operator_ack: false, remarks: '' }; });
      setForms(seed);
      setAttendants(att);
    })();
  }, [shift.id]);

  const setF     = (aid, k, v)    => setForms(p => ({ ...p, [aid]: { ...p[aid], [k]: v } }));
  const setDenom = (aid, note, v) => setForms(p => ({ ...p, [aid]: { ...p[aid], denom: { ...p[aid].denom, [note]: v } } }));
  const cashCounted = (aid) => NOTES.reduce((s, n) => s + (parseInt(forms[aid]?.denom?.[n] || 0) * n), 0);

  const save = async (a) => {
    const aid = a.attendant_id;
    const f = forms[aid];
    const price = parseFloat(f.price_per_ltr || prices[a.fuel_type] || 0);
    if (f.closing_reading === '' || f.closing_reading == null) return alert(tc('rmodal.enterClosingMeter', 'Enter the closing meter reading'));
    if (!price) return alert(tc('rmodal.enterPricePerLitre', 'Enter the price per litre'));
    setBusy(aid);
    try {
      const denomination = {};
      NOTES.forEach(n => { denomination[`note_${n}`] = parseInt(f.denom?.[n] || 0); });
      const r = await api.post('/reconcile/manager', {
        shift_id: shift.id, attendant_id: aid,
        closing_reading: parseFloat(f.closing_reading),
        price_per_ltr: price,
        test_ltrs: parseFloat(f.test_ltrs || 0),
        card_total: parseFloat(f.card_total || 0),
        upi_total: parseFloat(f.upi_total || 0),
        cash_actual: cashCounted(aid),
        denomination,
        resolution: f.resolution || null,
        operator_ack: f.operator_ack,
        remarks: f.remarks || null,
      });
      setResults(p => ({ ...p, [aid]: r }));
    } catch (e) { alert(e.response?.data?.error || e.error || tc('rmodal.failedToReconcile', 'Failed to reconcile')); }
    setBusy('');
  };

  const allDone = attendants.length > 0 && attendants.every(a => results[a.attendant_id]);

  const closeShift = async () => {
    setClosing(true);
    try {
      await api.patch(`/shifts/${shift.id}/close`, { confirm: true });
      onClosed && onClosed();
    } catch (e) { alert(e.error || tc('rmodal.failedToCloseShift', 'Failed to close shift')); }
    setClosing(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200, display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center', padding: '1.5rem 1rem', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', width: '100%', maxWidth: 560,
        boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ fontWeight: 800, fontSize: 17, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={16} color="#FF6B00" /> {tc('rmodal.title', 'Manager Reconciliation')}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: '#666', margin: '0 0 1rem' }}>
          {tc('rmodal.intro', 'Count cash with the operator and enter readings. Expected cash is derived from the meter — the operator never saw it.')}
        </p>

        {attendants.length === 0 && <div style={{ color: '#999', fontSize: 13, padding: '1rem 0' }}>{tc('rmodal.noAttendants', 'No attendants assigned to this shift.')}</div>}

        {attendants.map(a => {
          const aid = a.attendant_id;
          const f = forms[aid] || {};
          const r = results[aid];
          const counted = cashCounted(aid);
          const variance = r ? parseFloat(r.variance) : null;
          const short = variance != null && variance < 0;
          const over  = variance != null && variance > 0;
          return (
            <div key={aid} style={{ border: '1px solid #e5e3de', borderRadius: 12, padding: '0.9rem', marginBottom: '0.85rem',
              background: r ? (short ? '#fef2f2' : '#f0fdf4') : '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{a.attendant_name}
                  <span style={{ fontWeight: 400, color: '#888', fontSize: 12, marginLeft: 6 }}>{nozName(a)} · {a.fuel_type}</span>
                </div>
                {r && <span style={{ fontSize: 12, fontWeight: 700, color: short ? '#dc2626' : '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {short ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}{short ? tc('rmodal.shortage', 'Shortage') : over ? tc('rmodal.overage', 'Overage') : tc('rmodal.tallied', 'Tallied')}
                </span>}
              </div>
              <div style={{ fontSize: 11.5, color: '#888', marginBottom: 8 }}>
                {/* Opening cash appears only when there is one — shift start stopped
                    asking for a float (no outlet gives one), so it is ₹0.00 on every
                    new shift. Kept for older shifts, where it is real money. */}
                {tc('rmodal.openingMeter', 'Opening meter')}: <strong>{Number(a.opening_reading || 0).toFixed(3)}</strong>
                {Number(a.opening_cash || 0) !== 0 && (
                  <> · {tc('rmodal.openingCash', 'Opening cash')}: <strong>{fmt(a.opening_cash)}</strong></>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
                <div><label style={{ fontSize: 11, fontWeight: 600 }}>{tc('rmodal.closingMeter', 'Closing meter *')}</label>
                  <input style={inp} type="number" step="0.001" value={f.closing_reading || ''} onChange={e => setF(aid, 'closing_reading', e.target.value)} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 600 }}>{tc('rmodal.pricePerLitre', 'Price / litre *')}</label>
                  <input style={inp} type="number" step="0.01" placeholder={prices[a.fuel_type] ? `${prices[a.fuel_type]}` : ''} value={f.price_per_ltr || ''} onChange={e => setF(aid, 'price_per_ltr', e.target.value)} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 600 }}>{tc('rmodal.testLitresReturned', 'Test litres returned')}</label>
                  <input style={inp} type="number" step="0.01" value={f.test_ltrs || ''} onChange={e => setF(aid, 'test_ltrs', e.target.value)} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 600 }}>{tc('rmodal.cardTotal', 'Card total (₹)')}</label>
                  <input style={inp} type="number" step="0.01" value={f.card_total || ''} onChange={e => setF(aid, 'card_total', e.target.value)} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 600 }}>{tc('rmodal.upiTotal', 'UPI total (₹)')}</label>
                  <input style={inp} type="number" step="0.01" value={f.upi_total || ''} onChange={e => setF(aid, 'upi_total', e.target.value)} /></div>
              </div>

              {/* Denomination */}
              <div style={{ fontSize: 11, fontWeight: 600, margin: '4px 0' }}>{tc('rmodal.cashDenomination', 'Cash denomination (count with operator)')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
                {NOTES.map(n => (
                  <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, color: '#888', width: 28 }}>₹{n}</span>
                    <input style={{ ...inp, padding: '5px 7px' }} type="number" min="0" value={f.denom?.[n] || ''} onChange={e => setDenom(aid, n, e.target.value)} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12.5, marginBottom: 8 }}>{tc('rmodal.cashCounted', 'Cash counted')}: <strong>{fmt(counted)}</strong></div>

              {/* Result */}
              {r && (
                <div style={{ background: '#fff', border: '1px solid #e5e3de', borderRadius: 8, padding: '8px 10px', marginBottom: 8, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{tc('rmodal.expectedCash', 'Expected cash')}</span><strong>{fmt(r.cash_expected)}</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{tc('rmodal.countedCash', 'Counted cash')}</span><strong>{fmt(r.cash_actual)}</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: short ? '#dc2626' : '#16a34a', fontWeight: 700, marginTop: 2 }}>
                    <span>{short ? tc('rmodal.shortage', 'Shortage') : over ? tc('rmodal.overageBooked', 'Overage (booked as Other Income)') : tc('rmodal.variance', 'Variance')}</span><span>{fmt(Math.abs(variance))}</span>
                  </div>
                </div>
              )}

              {/* Shortage resolution */}
              {short && (
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9a3412', marginBottom: 6 }}>{tc('rmodal.howSettled', 'How is the shortage settled?')}</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    {[['recovered', tc('rmodal.cashRecovered', 'Cash recovered')], ['salary_deduction', tc('rmodal.deductFromSalary', 'Deduct from salary')]].map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setF(aid, 'resolution', id)}
                        style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          border: '1.5px solid ' + (f.resolution === id ? '#FF6B00' : '#fdba74'),
                          background: f.resolution === id ? '#FF6B00' : '#fff', color: f.resolution === id ? '#fff' : '#9a3412' }}>{label}</button>
                    ))}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9a3412' }}>
                    <input type="checkbox" checked={!!f.operator_ack} onChange={e => setF(aid, 'operator_ack', e.target.checked)} />
                    {tc('rmodal.operatorAgrees', 'Operator present and agrees')}
                  </label>
                </div>
              )}

              <button onClick={() => save(a)} disabled={busy === aid}
                style={{ width: '100%', height: 38, background: r ? '#475569' : '#16a34a', color: '#fff', border: 'none',
                  borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {busy === aid ? tc('rmodal.saving', 'Saving…') : r ? tc('rmodal.recompute', 'Recompute') : tc('rmodal.reconcile', 'Reconcile')}
              </button>
            </div>
          );
        })}

        <button onClick={closeShift} disabled={!allDone || closing}
          style={{ width: '100%', height: 46, marginTop: 6, background: allDone ? '#FF6B00' : '#cbd5e1', color: '#fff',
            border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: allDone ? 'pointer' : 'not-allowed' }}>
          {closing ? tc('rmodal.closing', 'Closing…') : allDone ? tc('rmodal.closeShift', 'Close Shift') : tc('rmodal.reconcileAllFirst', 'Reconcile all attendants first ({done}/{total})').replace('{done}', Object.keys(results).length).replace('{total}', attendants.length)}
        </button>
      </div>
    </div>
  );
}
