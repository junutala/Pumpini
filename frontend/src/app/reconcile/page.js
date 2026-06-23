'use client';
import { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, getReco } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';

const fmt = n => Number(n||0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});

export default function ReconcilePage() {
  const { user, station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;

  const [shifts, setShifts]           = useState([]);
  const [selected, setSelected]       = useState(null); // active shift
  const [submissions, setSubmissions] = useState([]);
  const [threshold, setThreshold]     = useState(50);
  const [loading, setLoading]         = useState(false);
  const [confirming, setConfirming]   = useState(null); // id being confirmed

  const isManager = ['owner', 'manager'].includes(user?.role);

  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  useEffect(() => {
    if (!stationId) return;
    const today = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Kolkata'});
    getShifts({ station_id: stationId, date: today })
      .then(s => {
        setShifts(s);
        const open = s.find(x => x.status === 'open') || s[0];
        if (open) setSelected(open);
      })
      .catch(console.error);

    // Load station settings for variance threshold
    api.get(`/stations/${stationId}/settings`)
      .then(cfg => { if (cfg?.variance_threshold) setThreshold(Number(cfg.variance_threshold)); })
      .catch(() => {});
  }, [stationId]);

  useEffect(() => {
    if (!selected) return;
    loadSubmissions(selected.id);
  }, [selected]);

  const loadSubmissions = async (shiftId) => {
    setLoading(true);
    try {
      const rows = await getReco(shiftId);
      setSubmissions(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (recoId) => {
    setConfirming(recoId);
    try {
      await api.patch(`/reconcile/${recoId}/confirm`, {});
      await loadSubmissions(selected.id);
    } catch (err) {
      alert(err.error || tc('reconp.confirmationFailed', 'Confirmation failed'));
    } finally {
      setConfirming(null);
    }
  };

  const varBadge = (variance) => {
    const abs = Math.abs(variance);
    if (abs <= threshold) return { color:'#15803d', bg:'#f0fdf4', border:'#86efac', label:tc('reconp.withinLimit', 'Within limit'), icon:<CheckCircle size={13}/> };
    if (abs <= 500)       return { color:'#92400e', bg:'#fffbeb', border:'#fcd34d', label:`⚠ ${tc('reconp.variance', 'Variance')} ₹${fmt(abs)}`, icon:<AlertTriangle size={13}/> };
    return                       { color:'#991b1b', bg:'#fef2f2', border:'#fca5a5', label:`❌ ${tc('reconp.highVariance', 'High variance')} ₹${fmt(abs)}`, icon:<XCircle size={13}/> };
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('reconp.title', 'Reconciliation')}</h1>
          <p style={{margin:0,fontSize:13,color:'var(--text-2)'}}>
            {tc('reconp.subtitle', 'Review attendant cash submissions and confirm collection.')}
          </p>
        </div>
        <button className="btn btn-secondary" style={{display:'flex',alignItems:'center',gap:6}}
          onClick={() => selected && loadSubmissions(selected.id)}>
          <RefreshCw size={14}/> {tc('reconp.refresh', 'Refresh')}
        </button>
      </div>

      {/* Shift selector */}
      {shifts.length > 1 && (
        <div style={{display:'flex',gap:8,marginBottom:'1rem',flexWrap:'wrap'}}>
          {shifts.map(s => (
            <button key={s.id}
              className={`btn ${selected?.id===s.id?'btn-primary':'btn-secondary'}`}
              onClick={() => setSelected(s)}>
              {tc('reconp.shift', 'Shift')} {s.shift_number}
              <span style={{marginLeft:6,fontSize:11,opacity:.7,textTransform:'capitalize'}}>({s.status})</span>
            </button>
          ))}
        </div>
      )}

      {!selected && (
        <div className="card" style={{textAlign:'center',color:'var(--text-3)',padding:'3rem',fontSize:14}}>
          {tc('reconp.noShiftsToday', 'No shifts found for today.')}
        </div>
      )}

      {selected && (
        <div className="card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
            <div style={{fontWeight:700,fontSize:15}}>
              {tc('reconp.shift', 'Shift')} {selected.shift_number} — {new Date(selected.start_time)
                .toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'})}
            </div>
            <span className={`badge ${selected.status==='open'?'badge-success':'badge-gray'}`}
              style={{textTransform:'capitalize'}}>{selected.status}</span>
          </div>

          {loading && (
            <div style={{textAlign:'center',padding:'2rem',color:'var(--text-3)',fontSize:13}}>
              {tc('reconp.loadingSubmissions', 'Loading submissions…')}
            </div>
          )}

          {!loading && submissions.length === 0 && (
            <div style={{textAlign:'center',padding:'2rem',color:'var(--text-3)',fontSize:13}}>
              {tc('reconp.noSubmissionsYet', 'No cash submissions yet for this shift.')}
              <br/>{tc('reconp.attendantsAppearHere', 'Attendants will appear here after they end their shift.')}
            </div>
          )}

          {!loading && submissions.length > 0 && (
            <div className="table-wrap">
              <table className="dms-table">
                <thead>
                  <tr>
                    <th>{tc('reconp.attendant', 'Attendant')}</th>
                    <th className="num">{tc('reconp.cashSubmitted', 'Cash Submitted')}</th>
                    {isManager && <th className="num">{tc('reconp.cashExpected', 'Cash Expected')}</th>}
                    {isManager && <th className="num">{tc('reconp.variance', 'Variance')}</th>}
                    <th>{tc('reconp.status', 'Status')}</th>
                    {isManager && <th style={{width:140}}>{tc('reconp.action', 'Action')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {submissions.map(row => {
                    const variance = row.manager_confirmed
                      ? parseFloat(row.cash_actual) - parseFloat(row.cash_expected)
                      : null;
                    const badge = variance !== null ? varBadge(variance) : null;
                    return (
                      <tr key={row.id}>
                        <td style={{fontWeight:600}}>{row.attendant_name}</td>
                        <td className="num" style={{fontWeight:700}}>
                          ₹{fmt(row.cash_actual)}
                        </td>
                        {isManager && (
                          <td className="num" style={{color:'var(--text-2)'}}>
                            {row.manager_confirmed ? `₹${fmt(row.cash_expected)}` : '—'}
                          </td>
                        )}
                        {isManager && (
                          <td className="num">
                            {badge ? (
                              <span style={{
                                display:'inline-flex',alignItems:'center',gap:4,
                                padding:'3px 8px',borderRadius:6,fontSize:12,fontWeight:600,
                                color:badge.color,background:badge.bg,border:`1px solid ${badge.border}`
                              }}>
                                {badge.icon} {variance >= 0 ? '+' : ''}{fmt(variance)}
                              </span>
                            ) : '—'}
                          </td>
                        )}
                        <td>
                          {row.manager_confirmed
                            ? <span className="badge badge-success">{tc('reconp.confirmed', 'Confirmed')}</span>
                            : <span className="badge badge-gray">{tc('reconp.pending', 'Pending')}</span>}
                        </td>
                        {isManager && (
                          <td>
                            {!row.manager_confirmed && (
                              <button
                                className="btn btn-primary"
                                style={{padding:'6px 14px',fontSize:12}}
                                onClick={() => handleConfirm(row.id)}
                                disabled={confirming === row.id}>
                                {confirming === row.id ? tc('reconp.confirming', 'Confirming…') : tc('reconp.confirmReceipt', 'Confirm Receipt')}
                              </button>
                            )}
                            {row.manager_confirmed && variance !== null && (
                              <span style={{fontSize:12,color:'var(--text-3)'}}>
                                {new Date(row.confirmed_at).toLocaleTimeString('en-IN',
                                  {timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true})}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && submissions.length > 0 && isManager && (
            <div style={{marginTop:'1rem',fontSize:12,color:'var(--text-3)',borderTop:'1px solid var(--border)',paddingTop:'0.75rem'}}>
              {tc('reconp.varianceThreshold', 'Variance threshold: ₹{n} (from station settings).').replace('{n}', threshold)}
              {' '}{tc('reconp.alertsNote', 'Alerts > ₹500 are sent to owner via WhatsApp automatically.')}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
