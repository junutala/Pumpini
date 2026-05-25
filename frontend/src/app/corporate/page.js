'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Eye, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getCorporates, createCorporate, getDrivers, addDriver, verifyBiometric, getCorpStatement } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const fmt = n => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function CorporatePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [corps, setCorps]           = useState([]);
  const [selected, setSelected]     = useState(null);
  const [drivers, setDrivers]       = useState([]);
  const [statement, setStatement]   = useState(null);
  const [showAddCorp, setShowAddCorp] = useState(false);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [corpForm, setCorpForm]     = useState({});
  const [driverForm, setDriverForm] = useState({});
  const [biometricRef, setBiometricRef] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [loading, setLoading]       = useState(false);

  useEffect(() => { getCorporates().then(setCorps); }, []);

  const selectCorp = async (corp) => {
    setSelected(corp);
    setStatement(null);
    getDrivers(corp.id).then(setDrivers);
  };

  const loadStatement = async () => {
    const s = await getCorpStatement(selected.id, new Date().toISOString().slice(0,7));
    setStatement(s);
  };

  const handleAddCorp = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await createCorporate(corpForm);
      setShowAddCorp(false); getCorporates().then(setCorps);
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const handleAddDriver = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await addDriver(selected.id, driverForm);
      setShowAddDriver(false); getDrivers(selected.id).then(setDrivers);
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const handleVerify = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const res = await verifyBiometric({ biometric_ref: biometricRef, requested_amount: 5000 });
      setVerifyResult({ ...res, ok: true });
    } catch (err) { setVerifyResult({ ok: false, error: err.error || 'Not verified' }); }
    finally { setLoading(false); }
  };

  const creditPct = (corp) => corp.credit_limit > 0 ? Math.round((corp.current_outstanding / corp.credit_limit) * 100) : 0;

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('corporate.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowVerify(true)}>Verify Biometric</button>
          {['owner','manager'].includes(user?.role) && (
            <button className="btn btn-primary" onClick={() => setShowAddCorp(true)}><Plus size={16} />Add Company</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : '1fr', gap: '1.5rem' }}>
        {/* Companies list */}
        <div>
          {corps.map(corp => (
            <div key={corp.id} className="card" style={{ marginBottom: '0.75rem', cursor: 'pointer', borderColor: selected?.id === corp.id ? 'var(--brand)' : 'var(--border)' }}
              onClick={() => selectCorp(corp)}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{corp.company_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: '0.75rem' }}>{corp.contact_person} · {corp.contact_phone}</div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-3)' }}>Credit used</span>
                  <span>{creditPct(corp)}%</span>
                </div>
                <div className="tank-bar">
                  <div className="tank-bar-fill" style={{
                    width: `${creditPct(corp)}%`,
                    background: creditPct(corp) > 80 ? 'var(--danger)' : creditPct(corp) > 60 ? 'var(--warning)' : 'var(--success)'
                  }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>Outstanding: <strong>₹{fmt(corp.current_outstanding)}</strong></span>
                <span style={{ color: 'var(--text-3)' }}>Limit: ₹{fmt(corp.credit_limit)}</span>
              </div>
            </div>
          ))}
          {corps.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No corporate accounts yet</div>}
        </div>

        {/* Company detail */}
        {selected && (
          <div>
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{selected.company_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>GST: {selected.gst_number || '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={loadStatement}><Eye size={14} />Statement</button>
                  {['owner','manager'].includes(user?.role) && (
                    <button className="btn btn-primary btn-sm" onClick={() => setShowAddDriver(true)}><Plus size={14} />Driver</button>
                  )}
                </div>
              </div>
              <div className="grid-3">
                <div className="stat-card">
                  <div className="stat-label">Credit Limit</div>
                  <div className="stat-value" style={{ fontSize: '1.25rem' }}>₹{fmt(selected.credit_limit)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outstanding</div>
                  <div className="stat-value" style={{ fontSize: '1.25rem', color: 'var(--danger)' }}>₹{fmt(selected.current_outstanding)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Available</div>
                  <div className="stat-value" style={{ fontSize: '1.25rem', color: 'var(--success)' }}>₹{fmt(selected.available_credit)}</div>
                </div>
              </div>
            </div>

            {/* Drivers */}
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Enrolled Drivers</div>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead><tr><th>Name</th><th>Vehicle</th><th>FASTag</th><th>Per Fill Limit</th><th>Status</th></tr></thead>
                  <tbody>
                    {drivers.map(d => (
                      <tr key={d.id}>
                        <td>{d.name}<div style={{ fontSize: 12, color: 'var(--text-3)' }}>{d.phone}</div></td>
                        <td className="num">{d.vehicle_number || '—'}</td>
                        <td className="num" style={{ fontSize: 12 }}>{d.fasttag_id || '—'}</td>
                        <td>{d.per_fill_limit ? `₹${fmt(d.per_fill_limit)}` : 'No limit'}</td>
                        <td><span className={`badge ${d.is_active ? 'badge-success' : 'badge-gray'}`}>{d.is_active ? 'Active' : 'Inactive'}</span></td>
                      </tr>
                    ))}
                    {drivers.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)' }}>No drivers enrolled</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Statement */}
            {statement && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 600 }}>Monthly Statement</div>
                  <div style={{ fontWeight: 700, color: 'var(--brand)' }}>Total: ₹{fmt(statement.total_amount)}</div>
                </div>
                <div className="table-wrap">
                  <table className="dms-table">
                    <thead><tr><th>Date/Time</th><th>Driver</th><th>Vehicle</th><th>Fuel</th><th>Qty (L)</th><th>Amount</th></tr></thead>
                    <tbody>
                      {statement.transactions.map(tx => (
                        <tr key={tx.id}>
                          <td style={{ fontSize: 12 }}>{new Date(tx.occurred_at).toLocaleString('en-IN')}</td>
                          <td>{tx.driver_name}</td>
                          <td className="num">{tx.vehicle_number}</td>
                          <td><span className={`fuel-chip fuel-${tx.fuel_type}`}>{tx.fuel_type}</span></td>
                          <td className="num">{Number(tx.quantity_ltrs).toFixed(2)}</td>
                          <td className="num">₹{fmt(tx.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddCorp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>Add Corporate Account</span>
              <button onClick={() => setShowAddCorp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleAddCorp}>
              {[['company_name','Company Name',true],['gst_number','GST Number',false],['contact_person','Contact Person',true],['contact_phone','Contact Phone',true],['contact_email','Email',false]].map(([f,l,r]) => (
                <div key={f} style={{ marginBottom: '0.75rem' }}>
                  <label className="label">{l}</label>
                  <input className="input" placeholder={l} required={r} onChange={e => setCorpForm(p => ({ ...p, [f]: e.target.value }))} />
                </div>
              ))}
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Credit Limit (₹)</label>
                <input className="input" type="number" step="1000" onChange={e => setCorpForm(p => ({ ...p, credit_limit: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Saving...' : 'Save Account'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showAddDriver && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>Enroll Driver</span>
              <button onClick={() => setShowAddDriver(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleAddDriver}>
              {[['name','Driver Name',true],['phone','Phone',false],['vehicle_number','Vehicle Number',false],['fasttag_id','FASTag ID',false],['biometric_ref','Biometric Reference ID',false]].map(([f,l,r]) => (
                <div key={f} style={{ marginBottom: '0.75rem' }}>
                  <label className="label">{l}</label>
                  <input className="input" placeholder={l} required={r} onChange={e => setDriverForm(p => ({ ...p, [f]: e.target.value }))} />
                </div>
              ))}
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Per Fill Limit (₹)</label>
                <input className="input" type="number" step="100" onChange={e => setDriverForm(p => ({ ...p, per_fill_limit: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Enrolling...' : 'Enroll Driver'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showVerify && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>Biometric Verification</span>
              <button onClick={() => { setShowVerify(false); setVerifyResult(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleVerify}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Biometric Reference ID</label>
                <input className="input input-lg" placeholder="Scan biometric device..." value={biometricRef} onChange={e => setBiometricRef(e.target.value)} required />
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Provided by fingerprint/face scanner device</div>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </form>
            {verifyResult && (
              <div className={`alert-banner ${verifyResult.ok ? 'success' : 'danger'}`} style={{ marginTop: '1rem' }}>
                {verifyResult.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <div>
                  {verifyResult.ok ? (
                    <>
                      <strong>{verifyResult.driver_name}</strong> – {verifyResult.vehicle_number}<br/>
                      <span style={{ fontSize: 12 }}>{verifyResult.company_name} · Available credit: ₹{fmt(verifyResult.available_credit)}</span>
                    </>
                  ) : verifyResult.error}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
