'use client';
// Petty cash / imprest ledger. Shows the manager's current cash float and every
// movement: top-ups (in), expenses (out), and auto credit-note cash refunds (out).
import { useState, useEffect } from 'react';
import { Plus, X, Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDateTime = ts => ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const TYPE_LABEL = { topup: 'Top-up', expense: 'Expense', refund: 'Refund (credit note)', adjustment: 'Adjustment' };

export default function PettyCashPage() {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState([]);
  const [modal, setModal]     = useState(null); // 'in' | 'out' | null
  const [form, setForm]       = useState({ amount: '', description: '' });
  const [saving, setSaving]   = useState(false);

  const load = async () => {
    if (!stationId) return;
    try {
      const r = await api.get('/petty-cash', { params: { station_id: stationId } });
      setBalance(r?.balance || 0);
      setEntries(Array.isArray(r?.entries) ? r.entries : []);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [stationId]);
  useRefreshOnFocus(load);

  const open = (direction) => { setForm({ amount: '', description: '' }); setModal(direction); };

  const save = async (e) => {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { alert('Enter an amount greater than 0'); return; }
    setSaving(true);
    try {
      await api.post('/petty-cash', {
        station_id: stationId,
        direction: modal,
        amount: amt,
        entry_type: modal === 'in' ? 'topup' : 'expense',
        description: form.description || null,
      });
      setModal(null); load();
    } catch (err) { alert(err.response?.data?.error || err.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const totalIn  = entries.filter(e => e.direction === 'in').reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalOut = entries.filter(e => e.direction === 'out').reduce((s, e) => s + parseFloat(e.amount), 0);

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">Petty Cash</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => open('out')}><ArrowUpCircle size={16} />Record Expense</button>
          <button className="btn btn-primary" onClick={() => open('in')}><Plus size={16} />Top Up</button>
        </div>
      </div>

      {/* Balance + totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: '1.5rem' }} className="stack-mobile">
        <div className="stat-card" style={{ borderLeft: '4px solid #FF6B00' }}>
          <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={14} />Float Balance</div>
          <div className="stat-value" style={{ color: balance < 0 ? 'var(--danger)' : 'var(--text-1)' }}>{fmt(balance)}</div>
          <div className="stat-sub">Cash in hand (imprest)</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ArrowDownCircle size={14} color="#16a34a" />Total In</div>
          <div className="stat-value" style={{ color: '#16a34a' }}>{fmt(totalIn)}</div>
          <div className="stat-sub">Top-ups</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ArrowUpCircle size={14} color="#dc2626" />Total Out</div>
          <div className="stat-value" style={{ color: '#dc2626' }}>{fmt(totalOut)}</div>
          <div className="stat-sub">Expenses + refunds</div>
        </div>
      </div>

      {/* Ledger */}
      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>In</th>
                <th style={{ textAlign: 'right' }}>Out</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No petty-cash entries yet</td></tr>
              )}
              {entries.map(e => (
                <tr key={e.id}>
                  <td style={{ fontSize: 13 }}>{fmtDateTime(e.created_at)}</td>
                  <td><span className={`badge ${e.direction === 'in' ? 'badge-success' : 'badge-warning'}`}>{TYPE_LABEL[e.entry_type] || e.entry_type}</span></td>
                  <td style={{ fontSize: 13 }}>{e.description || '—'}</td>
                  <td className="num" style={{ textAlign: 'right', color: '#16a34a' }}>{e.direction === 'in' ? fmt(e.amount) : '—'}</td>
                  <td className="num" style={{ textAlign: 'right', color: '#dc2626' }}>{e.direction === 'out' ? fmt(e.amount) : '—'}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{e.created_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div className="card" style={{ width: 380, maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>{modal === 'in' ? 'Top Up Petty Cash' : 'Record an Expense'}</span>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={save}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Amount (₹)</label>
                <input className="input" type="number" step="0.01" min="0" autoFocus
                  value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">Description {modal === 'out' ? '(what was it for?)' : '(source)'}</label>
                <input className="input" placeholder={modal === 'out' ? 'e.g. tea, stationery, repair' : 'e.g. cash from owner'}
                  value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={saving}>
                {saving ? 'Saving…' : (modal === 'in' ? 'Add to Float' : 'Record Expense')}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
