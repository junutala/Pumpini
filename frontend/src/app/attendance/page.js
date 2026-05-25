'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, CheckCircle, X } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getAttendance, markAttendance, getUsers } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const STATUS_COLORS = { present: 'badge-success', absent: 'badge-danger', half_day: 'badge-warning', leave: 'badge-gray' };

export default function AttendancePage() {
  const { t } = useTranslation();
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate]         = useState(today);
  const [records, setRecords]   = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showMark, setShowMark] = useState(false);
  const [form, setForm]         = useState({ date: today, shift_number: 1, status: 'present' });
  const [loading, setLoading]   = useState(false);

  const load = async () => {
    if (!stationId) return;
    const rows = await getAttendance({ station_id: stationId, date });
    setRecords(rows);
  };

  useEffect(() => { load(); }, [stationId, date]);
  useEffect(() => {
    if (stationId) getUsers({ station_id: stationId }).then(setEmployees);
  }, [stationId]);

  const handleMark = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await markAttendance({ ...form, station_id: stationId });
      setShowMark(false); load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const quickMark = async (userId, status) => {
    await markAttendance({ user_id: userId, station_id: stationId, date, shift_number: 1, status });
    load();
  };

  // Summary
  const summary = ['present','absent','half_day','leave'].map(s => ({
    status: s, count: records.filter(r => r.status === s).length
  }));

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('attendance.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          <button className="btn btn-primary" onClick={() => setShowMark(true)}><Plus size={16} />Mark</button>
        </div>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {summary.map(s => (
          <div key={s.status} className={`badge ${STATUS_COLORS[s.status]}`} style={{ padding: '6px 12px', fontSize: 13 }}>
            {t(`attendance.${s.status}`)}: {s.count}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Shift</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Status</th>
                {['owner','manager'].includes(user?.role) && <th>Quick Action</th>}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No attendance records for {date}</td></tr>
              )}
              {records.map(rec => (
                <tr key={rec.id}>
                  <td style={{ fontWeight: 500 }}>{rec.name}</td>
                  <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{rec.role}</span></td>
                  <td>Shift {rec.shift_number}</td>
                  <td style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                    {rec.check_in ? new Date(rec.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                    {rec.check_out ? new Date(rec.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td><span className={`badge ${STATUS_COLORS[rec.status]}`}>{t(`attendance.${rec.status}`)}</span></td>
                  {['owner','manager'].includes(user?.role) && (
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {rec.status !== 'present' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => quickMark(rec.user_id, 'present')}>✓</button>
                        )}
                        {rec.status !== 'absent' && (
                          <button className="btn btn-danger btn-sm" onClick={() => quickMark(rec.user_id, 'absent')}>✗</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employees not yet marked */}
      {['owner','manager'].includes(user?.role) && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>Quick Mark — Unmarked Employees</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {employees
              .filter(e => !records.find(r => r.user_id === e.id))
              .map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', fontSize: 13 }}>
                  <span>{e.name}</span>
                  <button className="btn btn-secondary btn-sm" style={{ padding: '0 8px', height: 26, fontSize: 12 }} onClick={() => quickMark(e.id, 'present')}>P</button>
                  <button className="btn btn-danger btn-sm" style={{ padding: '0 8px', height: 26, fontSize: 12 }} onClick={() => quickMark(e.id, 'absent')}>A</button>
                </div>
              ))}
            {employees.filter(e => !records.find(r => r.user_id === e.id)).length === 0 && (
              <span style={{ color: 'var(--text-3)', fontSize: 13 }}>All employees marked for today ✓</span>
            )}
          </div>
        </div>
      )}

      {/* Modal: Mark attendance */}
      {showMark && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>Mark Attendance</span>
              <button onClick={() => setShowMark(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleMark}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Employee</label>
                <select className="input" onChange={e => setForm(p => ({ ...p, user_id: e.target.value }))} required>
                  <option value="">Select employee...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Date</label>
                <input className="input" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Shift</label>
                <select className="input" value={form.shift_number} onChange={e => setForm(p => ({ ...p, shift_number: parseInt(e.target.value) }))}>
                  <option value={1}>Shift 1</option><option value={2}>Shift 2</option><option value={3}>Shift 3</option>
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  {['present','absent','half_day','leave'].map(s => <option key={s} value={s}>{t(`attendance.${s}`)}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: '1.25rem' }}>
                <div>
                  <label className="label">Check In</label>
                  <input className="input" type="time" onChange={e => setForm(p => ({ ...p, check_in: e.target.value ? `${form.date}T${e.target.value}` : null }))} />
                </div>
                <div>
                  <label className="label">Check Out</label>
                  <input className="input" type="time" onChange={e => setForm(p => ({ ...p, check_out: e.target.value ? `${form.date}T${e.target.value}` : null }))} />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
