'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, RefreshCw, ChevronDown, Zap } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, openShift, closeShift, getShiftEvents, assignRfid, getUsers, getNozzles, getRfidTags } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';

const fmt = n => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtL = n => Number(n||0).toFixed(2);

export default function ShiftsPage() {
  const { t }             = useTranslation();
  const { user, station } = useAuth();
  const stationId         = typeof station === 'object' ? station?.id : station;
  const today             = new Date().toISOString().slice(0, 10);

  const [shifts, setShifts]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [events, setEvents]     = useState([]);
  const [attendants, setAttendants] = useState([]);
  const [nozzles, setNozzles]   = useState([]);
  const [rfidTags, setRfidTags] = useState([]);
  const [showOpen, setShowOpen] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [openForm, setOpenForm] = useState({ shift_number: 1, date: today });
  const [assignForm, setAssignForm] = useState({});
  const [loading, setLoading]   = useState(false);

  const { on } = useSocket(stationId, selected?.id);

  const loadShifts = async () => {
    if (!stationId) return;
    const rows = await getShifts({ station_id: stationId, date: today });
    setShifts(rows);
  };

  const loadShiftDetail = async (shift) => {
    setSelected(shift);
    const evs = await getShiftEvents(shift.id);
    setEvents(evs);
  };

  useEffect(() => { loadShifts(); }, [stationId]);
  useEffect(() => {
    if (stationId) {
      getUsers({ station_id: stationId, role: 'attendant' }).then(setAttendants);
      getNozzles(stationId).then(setNozzles);
      getRfidTags(stationId).then(setRfidTags);
    }
  }, [stationId]);

  // Real-time new events
  useEffect(() => on('dispense:new', (ev) => {
    if (selected && ev.shift_id === selected.id) setEvents(prev => [ev, ...prev]);
  }), [on, selected]);

  const handleOpenShift = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await openShift({ ...openForm, station_id: stationId });
      setShowOpen(false); await loadShifts();
    } catch (err) { alert(err.error || 'Failed to open shift'); }
    finally { setLoading(false); }
  };

  const handleCloseShift = async (id) => {
    if (!confirm('Close this shift?')) return;
    await closeShift(id); await loadShifts();
    if (selected?.id === id) setSelected(null);
  };

  const handleAssign = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await assignRfid(selected.id, assignForm);
      setShowAssign(false);
      await loadShiftDetail(selected);
    } catch (err) { alert(err.error || 'Failed to assign'); }
    finally { setLoading(false); }
  };

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('nav.shifts')}</h1>
        {['owner','manager'].includes(user?.role) && (
          <button className="btn btn-primary" onClick={() => setShowOpen(true)}><Plus size={16} />{t('shift.open')}</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : '1fr', gap: '1.5rem' }}>
        {/* Shifts list */}
        <div>
          {shifts.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No shifts today</div>}
          {shifts.map(shift => (
            <div key={shift.id} className="card" style={{ marginBottom: '0.75rem', cursor: 'pointer', borderColor: selected?.id === shift.id ? 'var(--brand)' : 'var(--border)' }}
              onClick={() => loadShiftDetail(shift)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>Shift {shift.shift_number}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{shift.manager_name}</div>
                </div>
                <span className={`badge ${shift.status === 'open' ? 'badge-success' : 'badge-gray'}`}>
                  {shift.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: 13 }}>
                <div><span style={{ color: 'var(--text-3)' }}>Attendants: </span><strong>{shift.attendant_count}</strong></div>
                <div><span style={{ color: 'var(--text-3)' }}>Sales: </span><strong>₹{fmt(shift.total_sales)}</strong></div>
              </div>
              {shift.status === 'open' && ['owner','manager'].includes(user?.role) && (
                <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
                  <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setShowAssign(true); setSelected(shift); }}>
                    + Assign RFID
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); handleCloseShift(shift.id); }}>
                    Close
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Shift detail - live events */}
        {selected && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="live-dot" />
                <span style={{ fontWeight: 600 }}>Live Events – Shift {selected.shift_number}</span>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setSelected(null)}><X size={18} /></button>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Attendant</th>
                      <th>Nozzle</th>
                      <th>Qty (L)</th>
                      <th>Amount</th>
                      <th>Mode</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No events yet</td></tr>
                    )}
                    {events.map(ev => (
                      <tr key={ev.id}>
                        <td className="num" style={{ color: 'var(--text-3)' }}>{ev.event_seq}</td>
                        <td>{ev.attendant_name}</td>
                        <td>N{ev.nozzle_number}</td>
                        <td className="num">{fmtL(ev.quantity_ltrs)}</td>
                        <td className="num">₹{fmt(ev.amount)}</td>
                        <td><span className={`badge ${ev.payment_mode === 'cash' ? 'badge-gray' : ev.payment_mode === 'upi' ? 'badge-info' : 'badge-warning'}`}>{ev.payment_mode}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{new Date(ev.occurred_at).toLocaleTimeString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Open shift */}
      {showOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>Open New Shift</span>
              <button onClick={() => setShowOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleOpenShift}>
              <div style={{ marginBottom: '1rem' }}>
                <label className="label">Shift Number</label>
                <select className="input" value={openForm.shift_number} onChange={e => setOpenForm(p => ({ ...p, shift_number: parseInt(e.target.value) }))}>
                  <option value={1}>Shift 1 (Morning)</option>
                  <option value={2}>Shift 2 (Afternoon)</option>
                  <option value={3}>Shift 3 (Night)</option>
                </select>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Date</label>
                <input className="input" type="date" value={openForm.date} onChange={e => setOpenForm(p => ({ ...p, date: e.target.value }))} required />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Opening...' : 'Open Shift'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Assign RFID */}
      {showAssign && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>Assign RFID to Attendant</span>
              <button onClick={() => setShowAssign(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleAssign}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Attendant</label>
                <select className="input" onChange={e => setAssignForm(p => ({ ...p, attendant_id: e.target.value }))} required>
                  <option value="">Select attendant...</option>
                  {attendants.map(a => <option key={a.id} value={a.id}>{a.name} ({a.phone})</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">RFID Tag</label>
                <select className="input" onChange={e => setAssignForm(p => ({ ...p, rfid_tag_id: e.target.value }))} required>
                  <option value="">Select tag...</option>
                  {rfidTags.map(r => <option key={r.id} value={r.id}>{r.tag_uid}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Nozzle</label>
                <select className="input" onChange={e => setAssignForm(p => ({ ...p, nozzle_id: e.target.value }))} required>
                  <option value="">Select nozzle...</option>
                  {nozzles.map(n => <option key={n.id} value={n.id}>Nozzle {n.nozzle_number} – {n.fuel_type}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">UPI VPA (bank account QR)</label>
                <input className="input" placeholder="attendant@upi" onChange={e => setAssignForm(p => ({ ...p, upi_vpa: e.target.value }))} />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Opening Meter Reading</label>
                <input className="input" type="number" step="0.001" placeholder="0.000" onChange={e => setAssignForm(p => ({ ...p, opening_reading: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Assigning...' : 'Assign & Activate'}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
