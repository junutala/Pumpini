'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Droplets } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getDipstick, recordDipstick, getTankStock, getShifts } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const FUEL_COLORS = { petrol: '#3b82f6', diesel: '#f59e0b', cng: '#10b981', premium_petrol: '#8b5cf6' };
const fmtL = n => Number(n || 0).toFixed(2);

export default function DipstickPage() {
  const { t } = useTranslation();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const today = new Date().toISOString().slice(0, 10);

  const [tanks, setTanks]       = useState([]);
  const [readings, setReadings] = useState([]);
  const [shifts, setShifts]     = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ reading_type: 'opening', temperature_c: 30 });
  const [loading, setLoading]   = useState(false);

  const load = async () => {
    if (!stationId) return;
    const [t, r, s] = await Promise.all([
      getTankStock(stationId),
      getDipstick({ station_id: stationId }),
      getShifts({ station_id: stationId, date: today }),
    ]);
    setTanks(t); setReadings(r); setShifts(s);
    setForm(p => ({ ...p, station_id: stationId }));
  };

  useEffect(() => { load(); }, [stationId]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await recordDipstick({ ...form, station_id: stationId });
      setShowForm(false); load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('dipstick.title')}</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} />{t('dipstick.record')}</button>
      </div>

      {/* Current tank stock */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: '0.75rem' }}>{t('dipstick.current_stock')}</div>
        <div className="grid-4">
          {tanks.map(tank => {
            const pct = tank.capacity_ltrs > 0 ? Math.round((tank.current_stock / tank.capacity_ltrs) * 100) : 0;
            const color = FUEL_COLORS[tank.fuel_type] || 'var(--brand)';
            return (
              <div key={tank.id} className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Tank {tank.tank_number}</span>
                  <span className={`fuel-chip fuel-${tank.fuel_type}`}>{t(`fuel_types.${tank.fuel_type}`)}</span>
                </div>
                {/* Visual tank */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 32, height: 60, border: `2px solid ${color}`, borderRadius: 4, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', bottom: 0, width: '100%', background: color, height: `${pct}%`, opacity: 0.7, transition: 'height 0.5s' }} />
                  </div>
                  <div>
                    <div className="stat-value" style={{ fontSize: '1.25rem', color }}>{fmtL(tank.current_stock)} L</div>
                    <div className="stat-sub">of {fmtL(tank.capacity_ltrs)} L ({pct}%)</div>
                  </div>
                </div>
                <div className="tank-bar">
                  <div className="tank-bar-fill" style={{ width: `${pct}%`, background: pct < 20 ? 'var(--danger)' : pct < 40 ? 'var(--warning)' : color }} />
                </div>
                {tank.last_reading_at && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                    Last dip: {new Date(tank.last_reading_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            );
          })}
          {tanks.length === 0 && <div className="card" style={{ color: 'var(--text-3)', gridColumn: '1/-1' }}>No tanks configured for this station</div>}
        </div>
      </div>

      {/* Recent readings */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>Recent Readings</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Tank</th>
                <th>Fuel</th>
                <th>Type</th>
                <th>Dip (cm)</th>
                <th>Volume (L)</th>
                <th>Density</th>
                <th>Temp (°C)</th>
                <th>Recorded By</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {readings.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No readings yet</td></tr>
              )}
              {readings.slice(0, 30).map(r => (
                <tr key={r.id}>
                  <td>Tank {r.tank_number}</td>
                  <td><span className={`fuel-chip fuel-${r.fuel_type}`}>{t(`fuel_types.${r.fuel_type}`)}</span></td>
                  <td><span className="badge badge-gray">{r.reading_type}</span></td>
                  <td className="num">{r.dip_cm}</td>
                  <td className="num">{fmtL(r.volume_ltrs)}</td>
                  <td className="num">{r.density || '—'}</td>
                  <td className="num">{r.temperature_c || '—'}</td>
                  <td>{r.recorded_by_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{new Date(r.recorded_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Record reading */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>{t('dipstick.record')}</span>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="label">Tank</label>
                  <select className="input" onChange={e => setForm(p => ({ ...p, tank_id: e.target.value }))} required>
                    <option value="">Select tank...</option>
                    {tanks.map(t => <option key={t.id} value={t.id}>Tank {t.tank_number} – {t.fuel_type}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Shift</label>
                  <select className="input" onChange={e => setForm(p => ({ ...p, shift_id: e.target.value }))}>
                    <option value="">Select shift...</option>
                    {shifts.map(s => <option key={s.id} value={s.id}>Shift {s.shift_number}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Reading Type</label>
                  <select className="input" value={form.reading_type} onChange={e => setForm(p => ({ ...p, reading_type: e.target.value }))}>
                    <option value="opening">Opening</option>
                    <option value="mid_shift">Mid Shift</option>
                    <option value="closing">Closing</option>
                  </select>
                </div>
                <div>
                  <label className="label">Dip (cm)</label>
                  <input className="input" type="number" step="0.1" placeholder="e.g. 124.5" required
                    onChange={e => setForm(p => ({ ...p, dip_cm: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Volume (Ltrs)</label>
                  <input className="input" type="number" step="0.01" placeholder="e.g. 8500.00" required
                    onChange={e => setForm(p => ({ ...p, volume_ltrs: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Density (kg/L)</label>
                  <input className="input" type="number" step="0.0001" placeholder="e.g. 0.7350"
                    onChange={e => setForm(p => ({ ...p, density: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Temperature (°C)</label>
                  <input className="input" type="number" step="0.1" value={form.temperature_c}
                    onChange={e => setForm(p => ({ ...p, temperature_c: e.target.value }))} />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem' }} disabled={loading}>
                {loading ? 'Saving...' : 'Save Reading'}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
