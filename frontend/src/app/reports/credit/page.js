'use client';
// Credit reports: receivables ageing (who owes what, how old) and per-customer
// statements with running balance — the two documents owners send with payment
// reminders. Owner/manager only; corporate logins have their own dashboard.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Printer, Hourglass, FileText } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useRefreshOnFocus } from '../../../hooks/useRefreshOnFocus';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtD = ts => ts ? new Date(ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const csvDownload = (name, headers, rows) => {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
};

export default function CreditReportsPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { station } = useAuth();
  if (typeof window === 'undefined') return null;
  const stationId = typeof station === 'object' ? station?.id : station;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const monthStart = today.slice(0, 8) + '01';

  const [tab, setTab] = useState('ageing');
  const [ageing, setAgeing] = useState(null);
  const [corps, setCorps]   = useState([]);

  const [corpId, setCorpId]     = useState('');
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo]     = useState(today);
  const [stmt, setStmt]         = useState(null);
  const [loading, setLoading]   = useState(false);

  const loadAgeing = useCallback(async () => {
    if (!stationId) return;
    try {
      const [a, c] = await Promise.all([
        api.get('/credit-reports/ageing', { params: { station_id: stationId } }),
        api.get('/corporate', { params: { station_id: stationId } }).catch(() => []),
      ]);
      setAgeing(a);
      setCorps(Array.isArray(c) ? c : []);
    } catch (e) { console.error(e); }
  }, [stationId]);

  useEffect(() => { loadAgeing(); }, [loadAgeing]);
  useRefreshOnFocus(loadAgeing);

  const loadStatement = async (id = corpId) => {
    if (!stationId || !id) return;
    setLoading(true);
    try {
      const s = await api.get(`/credit-reports/statement/${id}`, {
        params: { station_id: stationId, date_from: dateFrom, date_to: dateTo },
      });
      setStmt(s);
    } catch (e) { console.error(e); alert(e.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const openStatement = (id) => { setCorpId(id); setTab('statement'); setStmt(null); loadStatement(id); };

  const exportAgeing = () => csvDownload(`ageing-${today}.csv`,
    ['Customer', 'Phone', 'Credit limit', 'Outstanding', '0-30 days', '31-60 days', '61-90 days', '90+ days', 'Oldest (days)', 'Last payment', 'Over limit'],
    ageing.rows.map(r => [r.company_name, r.contact_phone || '', r.credit_limit, r.outstanding,
      r.b0_30, r.b31_60, r.b61_90, r.b90_plus, r.oldest_days ?? '', r.last_payment_at ? fmtD(r.last_payment_at) : '', r.over_limit ? 'YES' : '']));

  const exportStmt = () => csvDownload(`statement-${stmt.corporate?.company_name || corpId}-${dateFrom}-${dateTo}.csv`,
    ['Date', 'Type', 'Particulars', 'Ref', 'Debit', 'Credit', 'Balance'],
    [['', '', tc('credit_reports.opening_balance', 'Opening balance'), '', '', '', stmt.opening_balance],
     ...stmt.lines.map(l => [fmtD(l.date), l.type, l.description, l.ref || '', l.debit || '', l.credit || '', l.balance])]);

  const TABS = [
    ['ageing', tc('credit_reports.tab_ageing', 'Ageing'), Hourglass],
    ['statement', tc('credit_reports.tab_statement', 'Statement'), FileText],
  ];

  const bucketCell = (v, hot) => (
    <td className="num" style={v > 0 && hot ? { color: 'var(--danger)', fontWeight: 700 } : v > 0 ? { fontWeight: 600 } : { color: 'var(--text-3)' }}>
      {v > 0 ? `₹${fmt(v)}` : '—'}
    </td>
  );

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{tc('nav.credit_reports', 'Credit Reports')}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: '1rem', maxWidth: 640 }}>
          {tc('credit_reports.info', 'ℹ️ Who owes what and for how long, plus the running-balance statement to send with payment reminders. Outstanding is recomputed from every credit sale, lube invoice, payment and credit note — payments are set against the oldest dues first.')}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1.25rem' }} className="no-print">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} className={`btn ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ── Ageing ── */}
      {tab === 'ageing' && ageing && (
        <>
          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            <div className="stat-card">
              <div className="stat-label">{tc('credit_reports.total_outstanding', 'Total outstanding')}</div>
              <div className="stat-value amount" style={{ fontSize: '1.25rem' }}>{fmt(ageing.totals.outstanding)}</div>
              <div className="stat-sub">{ageing.totals.customers_with_dues} {tc('credit_reports.customers_with_dues', 'customers with dues')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{tc('credit_reports.bucket_90', 'Overdue 90+ days')}</div>
              <div className="stat-value" style={{ fontSize: '1.25rem', color: ageing.totals.b90_plus > 0 ? 'var(--danger)' : 'var(--success)' }}>₹{fmt(ageing.totals.b90_plus)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{tc('credit_reports.bucket_61_90', '61–90 days')}</div>
              <div className="stat-value" style={{ fontSize: '1.25rem', color: ageing.totals.b61_90 > 0 ? 'var(--warning)' : 'var(--success)' }}>₹{fmt(ageing.totals.b61_90)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{tc('credit_reports.over_limit', 'Over credit limit')}</div>
              <div className="stat-value" style={{ fontSize: '1.25rem', color: ageing.totals.over_limit_count ? 'var(--danger)' : 'var(--success)' }}>{ageing.totals.over_limit_count}</div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{tc('credit_reports.ageing_title', 'Receivables by age')}</div>
              {ageing.rows.length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={exportAgeing}><Download size={14} /> {tc('credit_reports.export', 'Export CSV')}</button>
              )}
            </div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead>
                  <tr>
                    <th>{tc('credit_reports.customer', 'Customer')}</th>
                    <th>{tc('credit_reports.outstanding', 'Outstanding')}</th>
                    <th>0–30</th><th>31–60</th><th>61–90</th><th>90+</th>
                    <th>{tc('credit_reports.oldest', 'Oldest')}</th>
                    <th>{tc('credit_reports.last_payment', 'Last payment')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ageing.rows.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>{tc('credit_reports.no_customers', 'No credit customers for this station')}</td></tr>
                  )}
                  {ageing.rows.map(r => (
                    <tr key={r.corporate_id} style={r.b90_plus > 0 ? { background: 'rgba(239,68,68,.05)' } : undefined}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.company_name}
                          {r.over_limit && <span className="badge badge-danger" style={{ marginLeft: 6 }}>{tc('credit_reports.over_limit_badge', 'Over limit')}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {r.contact_phone || '—'}{r.credit_limit > 0 ? ` · ${tc('credit_reports.limit', 'Limit')} ₹${fmt(r.credit_limit)}` : ''}
                          {r.unapplied_credit > 0 ? ` · ${tc('credit_reports.advance', 'Advance')} ₹${fmt(r.unapplied_credit)}` : ''}
                        </div>
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>{r.outstanding > 0 ? `₹${fmt(r.outstanding)}` : <span style={{ color: 'var(--success)' }}>✓</span>}</td>
                      {bucketCell(r.b0_30, false)}
                      {bucketCell(r.b31_60, false)}
                      {bucketCell(r.b61_90, false)}
                      {bucketCell(r.b90_plus, true)}
                      <td style={{ fontSize: 12, color: r.oldest_days > 90 ? 'var(--danger)' : 'var(--text-2)' }}>
                        {r.oldest_days != null ? `${r.oldest_days} ${tc('credit_reports.days', 'days')}` : '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>{r.last_payment_at ? fmtD(r.last_payment_at) : <span style={{ color: 'var(--warning)' }}>{tc('credit_reports.never', 'Never')}</span>}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openStatement(r.corporate_id)}>
                          {tc('credit_reports.statement_btn', 'Statement →')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Statement ── */}
      {tab === 'statement' && (
        <>
          <div className="card no-print" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 220 }}>
                <label className="label">{tc('credit_reports.customer', 'Customer')}</label>
                <select className="input" value={corpId} onChange={e => setCorpId(e.target.value)}>
                  <option value="">{tc('credit_reports.select_customer', 'Select customer...')}</option>
                  {corps.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{tc('credit_reports.from', 'From')}</label>
                <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 160 }} />
              </div>
              <div>
                <label className="label">{tc('credit_reports.to', 'To')}</label>
                <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 160 }} />
              </div>
              <button className="btn btn-primary" onClick={() => loadStatement()} disabled={loading || !corpId}>
                {loading ? tc('credit_reports.loading', 'Loading...') : tc('credit_reports.generate', 'Generate')}
              </button>
              {stmt && (
                <>
                  <button className="btn btn-secondary" onClick={exportStmt}><Download size={15} /> CSV</button>
                  <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={15} /> {tc('credit_reports.print', 'Print')}</button>
                </>
              )}
            </div>
          </div>

          {stmt && stmt.corporate && (
            <div className="card">
              {/* Statement header — also what prints */}
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{stmt.corporate.company_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {stmt.corporate.contact_person || ''} {stmt.corporate.contact_phone ? `· ${stmt.corporate.contact_phone}` : ''}
                    {(stmt.corporate.gst_number || stmt.corporate.gstn) ? ` · GST ${stmt.corporate.gst_number || stmt.corporate.gstn}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {tc('credit_reports.period', 'Period')}: {fmtD(stmt.date_from)} – {fmtD(stmt.date_to)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>{tc('credit_reports.closing_balance', 'Closing balance')}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: stmt.closing_balance > 0 ? 'var(--danger)' : 'var(--success)' }}>₹{fmt(stmt.closing_balance)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                    {tc('credit_reports.debits', 'Debits')} ₹{fmt(stmt.totals.debits)} · {tc('credit_reports.credits', 'Credits')} ₹{fmt(stmt.totals.credits)}
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="dms-table">
                  <thead>
                    <tr>
                      <th>{tc('credit_reports.date', 'Date')}</th>
                      <th>{tc('credit_reports.particulars', 'Particulars')}</th>
                      <th>{tc('credit_reports.ref', 'Ref')}</th>
                      <th>{tc('credit_reports.debit', 'Debit')}</th>
                      <th>{tc('credit_reports.credit', 'Credit')}</th>
                      <th>{tc('credit_reports.balance', 'Balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <td></td>
                      <td style={{ fontWeight: 700 }}>{tc('credit_reports.opening_balance', 'Opening balance')}</td>
                      <td></td><td></td><td></td>
                      <td className="num" style={{ fontWeight: 700 }}>₹{fmt(stmt.opening_balance)}</td>
                    </tr>
                    {stmt.lines.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '1.5rem' }}>{tc('credit_reports.no_lines', 'No transactions in this period')}</td></tr>
                    )}
                    {stmt.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtD(l.date)}</td>
                        <td style={{ fontSize: 13 }}>
                          <span className={`badge ${l.type === 'payment' ? 'badge-success' : l.type === 'credit_note' ? 'badge-info' : 'badge-gray'}`} style={{ marginRight: 6 }}>
                            {tc(`credit_reports.type_${l.type}`, l.type)}
                          </span>
                          {l.description}
                        </td>
                        <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{l.ref || '—'}</td>
                        <td className="num">{l.debit > 0 ? `₹${fmt(l.debit)}` : '—'}</td>
                        <td className="num" style={{ color: l.credit > 0 ? 'var(--success)' : undefined }}>{l.credit > 0 ? `₹${fmt(l.credit)}` : '—'}</td>
                        <td className="num" style={{ fontWeight: 600 }}>₹{fmt(l.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!stmt && !loading && (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>
              {tc('credit_reports.pick_hint', 'Select a customer and period, then Generate')}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
