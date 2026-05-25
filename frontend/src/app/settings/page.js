'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Save } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getCurrentPrices, setPrice, getNozzles, getRfidTags, addRfidTag } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const FUEL_TYPES = ['petrol', 'diesel', 'cng', 'premium_petrol'];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [prices, setPrices]     = useState([]);
  const [nozzles, setNozzles]   = useState([]);
  const [rfidTags, setRfidTags] = useState([]);
  const [tanks, setTanks]       = useState([]);
  const [tab, setTab]           = useState('prices');

  const [priceForm, setPriceForm]   = useState({ fuel_type: 'petrol', price: '', effective_from: new Date().toISOString().slice(0, 10) });
  const [rfidForm, setRfidForm]     = useState({ tag_uid: '' });
  const [nozzleForm, setNozzleForm] = useState({ nozzle_number: '', fuel_type: 'petrol' });
  const [tankForm, setTankForm]     = useState({ tank_number: '', fuel_type: 'petrol', capacity_ltrs: '', density: '' });
  const [loading, setLoading]       = useState(false);
  const [saved, setSaved]           = useState('');

  const load = async () => {
    if (!stationId) return;
    const [p, n, r] = await Promise.all([getCurrentPrices(stationId), getNozzles(stationId), getRfidTags(stationId)]);
    setPrices(p); setNozzles(n); setRfidTags(r);
  };

  useEffect(() => { load(); }, [stationId]);

  const savePrice = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await setPrice({ ...priceForm, station_id: stationId });
      setSaved('Price saved!'); load();
      setTimeout(() => setSaved(''), 3000);
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const saveRfid = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await addRfidTag({ tag_uid: rfidForm.tag_uid, station_id: stationId });
      setRfidForm({ tag_uid: '' }); load();
    } catch (err) { alert(err.error || 'Tag already exists'); }
    finally { setLoading(false); }
  };

  const saveNozzle = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/stations/' + stationId + '/nozzles', { ...nozzleForm, station_id: stationId });
      load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const saveTank = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/tanks', { ...tankForm, station_id: stationId });
      load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const TABS = [
    { id: 'prices',  label: 'Fuel Prices' },
    { id: 'rfid',    label: 'RFID Tags' },
    { id: 'nozzles', label: 'Nozzles' },
  ];

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('nav.settings')}</h1>
        {saved && <div className="badge badge-success" style={{ padding: '6px 12px', fontSize: 13 }}>✓ {saved}</div>}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
              fontWeight: tab === tb.id ? 600 : 400,
              color: tab === tb.id ? 'var(--brand)' : 'var(--text-2)',
              borderBottom: `2px solid ${tab === tb.id ? 'var(--brand)' : 'transparent'}`,
              marginBottom: -1, fontSize: 14,
            }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Fuel Prices */}
      {tab === 'prices' && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Set New Price</div>
            <form onSubmit={savePrice}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Fuel Type</label>
                <select className="input" value={priceForm.fuel_type} onChange={e => setPriceForm(p => ({ ...p, fuel_type: e.target.value }))}>
                  {FUEL_TYPES.map(f => <option key={f} value={f}>{t(`fuel_types.${f}`)}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Price per Litre (₹)</label>
                <input className="input" type="number" step="0.01" placeholder="e.g. 105.50" required
                  value={priceForm.price} onChange={e => setPriceForm(p => ({ ...p, price: e.target.value }))} />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Effective From</label>
                <input className="input" type="date" value={priceForm.effective_from}
                  onChange={e => setPriceForm(p => ({ ...p, effective_from: e.target.value }))} required />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                <Save size={14} /> Save Price
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Current Prices</div>
            {prices.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No prices set yet</div>}
            {prices.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={`fuel-chip fuel-${p.fuel_type}`}>{t(`fuel_types.${p.fuel_type}`)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>₹{Number(p.price).toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>from {new Date(p.effective_from).toLocaleDateString('en-IN')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RFID Tags */}
      {tab === 'rfid' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Register RFID Tag</div>
            <form onSubmit={saveRfid}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Tag UID</label>
                <input className="input" placeholder="Scan or enter UID..." required value={rfidForm.tag_uid}
                  onChange={e => setRfidForm({ tag_uid: e.target.value })} />
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Scan the RFID card/badge to populate</div>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                <Plus size={14} /> Register Tag
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Registered Tags ({rfidTags.length})</div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead><tr><th>Tag UID</th><th>Assigned To</th><th>Status</th></tr></thead>
                <tbody>
                  {rfidTags.map(r => (
                    <tr key={r.id}>
                      <td className="num" style={{ fontSize: 13 }}>{r.tag_uid}</td>
                      <td>{r.attendant_name || <span style={{ color: 'var(--text-3)' }}>Unassigned</span>}</td>
                      <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-gray'}`}>{r.is_active ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                  {rfidTags.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)' }}>No tags registered</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Nozzles */}
      {tab === 'nozzles' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Add Nozzle</div>
            <form onSubmit={saveNozzle}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Nozzle Number</label>
                <input className="input" type="number" min="1" placeholder="e.g. 1" required
                  value={nozzleForm.nozzle_number} onChange={e => setNozzleForm(p => ({ ...p, nozzle_number: e.target.value }))} />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Fuel Type</label>
                <select className="input" value={nozzleForm.fuel_type} onChange={e => setNozzleForm(p => ({ ...p, fuel_type: e.target.value }))}>
                  {FUEL_TYPES.map(f => <option key={f} value={f}>{t(`fuel_types.${f}`)}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                <Plus size={14} /> Add Nozzle
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Configured Nozzles</div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead><tr><th>Nozzle #</th><th>Fuel Type</th><th>Tank</th><th>Status</th></tr></thead>
                <tbody>
                  {nozzles.map(n => (
                    <tr key={n.id}>
                      <td><strong>N{n.nozzle_number}</strong></td>
                      <td><span className={`fuel-chip fuel-${n.fuel_type}`}>{t(`fuel_types.${n.fuel_type}`)}</span></td>
                      <td>{n.tank_number ? `Tank ${n.tank_number}` : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                      <td><span className={`badge ${n.is_active ? 'badge-success' : 'badge-gray'}`}>{n.is_active ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                  {nozzles.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)' }}>No nozzles configured</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
