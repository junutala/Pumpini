'use client';
// Cash Integrity — per-operator undercash frequency for the owner. A clean
// operator's drawer is over or exact, never under; so repeated undercash (even
// when made good on the spot) flags a suspect. Pure read-only oversight.
import { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const toDate = ts => ts ? new Date(ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const RANGES = [[30, '30 days'], [90, '90 days'], [180, '6 months']];

export default function CashIntegrityPage() {
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const [rows, setRows] = useState([]);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const r = await api.get('/dashboard/cash-integrity', { params: { station_id: stationId, days } });
      setRows(Array.isArray(r) ? r : []);
    } catch { setRows([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [stationId, days]);
  useRefreshOnFocus(load);

  // Suspect = 3+ undercash events, or undercash is the majority of reconciliations.
  const isSuspect = r => r.undercash_count >= 3 || (r.total_recons >= 4 && r.undercash_count / r.total_recons > 0.4);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Integrity</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            A clean operator is over or exact — <strong>never under</strong>. Repeated undercash is a red flag.
          </div>
        </div>
        <select className="input" style={{ width: 140 }} value={days} onChange={e => setDays(parseInt(e.target.value))}>
          {RANGES.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Operator</th>
                <th style={{ textAlign: 'center' }}>Reconciliations</th>
                <th style={{ textAlign: 'center' }}>Undercash</th>
                <th style={{ textAlign: 'center' }}>Overcash / Exact</th>
                <th style={{ textAlign: 'right' }}>Total Short</th>
                <th>Last Undercash</th>
                <th style={{ textAlign: 'center' }}>Flag</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>No confirmed reconciliations in this period.</td></tr>
              )}
              {!loading && rows.map(r => {
                const suspect = isSuspect(r);
                const pct = r.total_recons ? Math.round((r.undercash_count / r.total_recons) * 100) : 0;
                return (
                  <tr key={r.attendant_id} style={suspect ? { background: '#fef2f2' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{r.attendant_name}</td>
                    <td style={{ textAlign: 'center' }}>{r.total_recons}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: r.undercash_count ? '#dc2626' : 'var(--text-3)' }}>
                      {r.undercash_count}{r.undercash_count ? ` (${pct}%)` : ''}
                    </td>
                    <td style={{ textAlign: 'center', color: '#16a34a' }}>{r.total_recons - r.undercash_count}</td>
                    <td className="num" style={{ textAlign: 'right', color: r.total_short > 0 ? '#dc2626' : 'var(--text-3)' }}>{fmt(r.total_short)}</td>
                    <td style={{ fontSize: 13 }}>{toDate(r.last_short_at)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {suspect
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc2626', fontWeight: 700, fontSize: 12 }}><ShieldAlert size={14} />Suspect</span>
                        : r.undercash_count > 0
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#d97706', fontSize: 12 }}><AlertTriangle size={13} />Watch</span>
                          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: 12 }}><CheckCircle size={13} />Clean</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
          “Undercash” = the operator declared less cash than the meter expected (a shortfall), whether or not it was made good on the spot.
          Repeated undercash warrants disciplinary review — the system records the pattern; the action is yours.
        </div>
      </div>
    </AppShell>
  );
}
