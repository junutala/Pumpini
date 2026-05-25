'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle, Printer } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, getAttendantDashboard, submitReco, getReco } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const fmt = n => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function ReconcilePage() {
  const { t }             = useTranslation();
  const { user, station } = useAuth();
  const stationId         = typeof station === 'object' ? station?.id : station;
  const today             = new Date().toISOString().slice(0, 10);

  const [shifts, setShifts]     = useState([]);
  const [selectedShift, setSelectedShift] = useState('');
  const [summary, setSummary]   = useState(null);
  const [existingReco, setExistingReco] = useState(null);
  const [cashActual, setCashActual] = useState('');
  const [remarks, setRemarks]   = useState('');
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (stationId) getShifts({ station_id: stationId, date: today }).then(setShifts);
  }, [stationId]);

  const loadSummary = async (shiftId) => {
    setSelectedShift(shiftId);
    setResult(null);
    const s = await getAttendantDashboard(user.id, shiftId);
    setSummary(s.summary);
    const reco = await getReco(shiftId);
    setExistingReco(reco?.[0] || null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const res = await submitReco({
        shift_id: selectedShift,
        attendant_id: user.id,
        cash_actual: parseFloat(cashActual),
        remarks,
      });
      setResult(res);
      setExistingReco(res);
    } catch (err) { alert(err.error || 'Failed to submit'); }
    finally { setLoading(false); }
  };

  const reco = existingReco || result;

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('reconcile.title')}</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem' }}>
        {/* Form */}
        <div className="card">
          <div style={{ marginBottom: '1rem' }}>
            <label className="label">Select Shift</label>
            <select className="input" value={selectedShift} onChange={e => loadSummary(e.target.value)}>
              <option value="">Select shift...</option>
              {shifts.map(s => (
                <option key={s.id} value={s.id}>Shift {s.shift_number} – {s.status}</option>
              ))}
            </select>
          </div>

          {summary && !reco && (
            <form onSubmit={handleSubmit}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>Your sales summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span>Total Sales</span><strong>₹{fmt(summary.total_sales)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span>UPI</span><span>₹{fmt(summary.upi)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span>Credit</span><span>₹{fmt(summary.credit)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                  <span>Cash expected</span><strong>₹{fmt(summary.cash)}</strong>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="label" style={{ fontSize: 14, fontWeight: 600 }}>{t('reconcile.blind_drop')}</label>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Enter the cash you've counted — without looking at the expected amount above</div>
                <input className="input input-lg" type="number" step="0.01" placeholder="₹ 0.00"
                  value={cashActual} onChange={e => setCashActual(e.target.value)} required />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Remarks (optional)</label>
                <textarea className="input" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Submitting...' : t('reconcile.submit_reco')}
              </button>
            </form>
          )}

          {!selectedShift && <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 8 }}>Select a shift to begin reconciliation</div>}
        </div>

        {/* Reco slip */}
        {reco && (
          <div className="card" id="reco-slip">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {Math.abs(reco.variance) <= 50
                  ? <CheckCircle size={20} color="var(--success)" />
                  : <AlertTriangle size={20} color="var(--danger)" />}
                <span style={{ fontWeight: 600, fontSize: 16 }}>{t('reconcile.reco_slip')}</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
                <Printer size={14} /> Print
              </button>
            </div>

            {Math.abs(parseFloat(reco.variance)) > 50 && (
              <div className="alert-banner danger" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={16} />
                <div>
                  <strong>Cash Variance Detected</strong>
                  <div style={{ fontSize: 12, marginTop: 2 }}>Alert sent to Owner and Manager</div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                ['Total Sales',    reco.total_sales],
                ['Cash Expected',  reco.cash_expected],
                ['Cash Received',  reco.cash_actual],
                ['UPI',            reco.upi_total],
                ['Credit',         reco.credit_total],
                ['Card',           reco.card_total],
              ].map(([label, val]) => (
                <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '0.75rem' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 3 }}>₹{fmt(val)}</div>
                </div>
              ))}
            </div>

            <div style={{
              padding: '1rem', borderRadius: 8, border: '2px solid',
              borderColor: Math.abs(reco.variance) <= 50 ? 'var(--success)' : 'var(--danger)',
              background: Math.abs(reco.variance) <= 50 ? '#dcfce7' : '#fee2e2',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Variance</span>
              <span className="num" style={{ fontSize: 22, fontWeight: 700, color: Math.abs(reco.variance) <= 50 ? 'var(--success)' : 'var(--danger)' }}>
                {parseFloat(reco.variance) >= 0 ? '+' : ''}₹{fmt(reco.variance)}
              </span>
            </div>

            {reco.remarks && (
              <div style={{ marginTop: '1rem', fontSize: 13, color: 'var(--text-2)' }}>
                <strong>Remarks:</strong> {reco.remarks}
              </div>
            )}

            <div style={{ marginTop: '1rem', fontSize: 12, color: 'var(--text-3)' }}>
              Reconciled at {new Date(reco.reconciled_at).toLocaleString('en-IN')}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
