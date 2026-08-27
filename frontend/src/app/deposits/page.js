'use client';
// Cash custody → bank deposit. Sales cash collected at shift close accumulates as
// "awaiting deposit"; a bank deposit draws it down; the owner confirms it landed
// in the bank. Stale undeposited cash is flagged (and alerts the owner).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Banknote, CheckCircle, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

import { errText } from '../../lib/apiError';
const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const toDate = ts => ts ? new Date(ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function DepositsPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const isOwner = user?.role === 'owner';

  const [status, setStatus]     = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [cfg, setCfg]           = useState({});

  const load = async () => {
    if (!stationId) return;
    try {
      const r = await api.get('/cash-deposits', { params: { station_id: stationId } });
      setStatus(r?.status || null);
      setDeposits(Array.isArray(r?.deposits) ? r.deposits : []);
    } catch { /* ignore */ }
    if (isOwner) {
      const s = await api.get(`/stations/${stationId}/settings`).catch(() => ({}));
      setCfg({ deposit_alert_days: s?.deposit_alert_days ?? 2, deposit_alert_amount: s?.deposit_alert_amount ?? 0 });
    }
  };

  useEffect(() => { load(); }, [stationId]);
  useRefreshOnFocus(load);

  const save = async (e) => {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { alert(tc('deppage.enterAmount', 'Enter a deposit amount')); return; }
    setSaving(true);
    try {
      await api.post('/cash-deposits', { station_id: stationId, ...form, amount: amt });
      setModal(false); setForm({}); load();
    } catch (err) { alert(errText(err, tc('deppage.failed', 'Failed'))); }
    setSaving(false);
  };

  const confirmDeposit = async (d) => {
    if (!confirm(tc('deppage.confirmReflected', 'Confirm {amount} ({date}) is reflected in the bank?').replace('{amount}', fmt(d.amount)).replace('{date}', toDate(d.deposit_date)))) return;
    try { await api.patch(`/cash-deposits/${d.id}/confirm`); load(); }
    catch (err) { alert(errText(err, tc('deppage.failed', 'Failed'))); }
  };

  const saveCfg = async () => {
    try {
      await api.patch(`/stations/${stationId}/deposit-alert`, {
        deposit_alert_days: parseInt(cfg.deposit_alert_days),
        deposit_alert_amount: parseFloat(cfg.deposit_alert_amount || 0),
      });
      load();
    } catch (err) { alert(errText(err, tc('deppage.failed', 'Failed'))); }
  };

  const stale = status?.stale;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('deppage.bankDeposits', 'Bank Deposits')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('deppage.subtitle', 'Track sales cash from shift close to the bank.')}</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ amount: status?.awaiting ? String(status.awaiting) : '' }); setModal(true); }}>
          <Plus size={16} />{tc('deppage.recordDeposit', 'Record Deposit')}
        </button>
      </div>

      {/* Awaiting + aging */}
      <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: '1.5rem' }}>
        <div className="stat-card" style={{ borderLeft: `4px solid ${stale ? '#dc2626' : '#FF6B00'}` }}>
          <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Banknote size={14} />{tc('deppage.cashAwaitingDeposit', 'Cash Awaiting Deposit')}</div>
          <div className="stat-value" style={{ color: stale ? 'var(--danger)' : 'var(--text-1)' }}>{fmt(status?.awaiting)}</div>
          <div className="stat-sub" style={{ color: stale ? 'var(--danger)' : 'var(--text-3)' }}>
            {status?.awaiting > 0.5
              ? `${tc('deppage.oldestDays', 'Oldest: {n} day(s)').replace('{n}', status.age_days)}${stale ? ` ${tc('deppage.overdue', '⚠ overdue')}` : ''}`
              : tc('deppage.allDeposited', 'All deposited ✓')}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('deppage.collectedAllTime', 'Collected (all time)')}</div>
          <div className="stat-value">{fmt(status?.collected)}</div>
          <div className="stat-sub">{tc('deppage.collectedSub', 'Sales cash + cash credit-receipts')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('deppage.depositedAllTime', 'Deposited (all time)')}</div>
          <div className="stat-value" style={{ color: '#16a34a' }}>{fmt(status?.deposited)}</div>
          <div className="stat-sub">{tc('deppage.last', 'Last:')} {toDate(status?.last_deposit)}</div>
        </div>
      </div>

      {/* Aging config (owner) */}
      {isOwner && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{tc('deppage.agingAlert', 'Aging Alert')}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label className="label">{tc('deppage.alertIfDays', 'Alert if undeposited > (days)')}</label><input className="input" style={{ width: 120 }} type="number" min="1" value={cfg.deposit_alert_days ?? ''} onChange={e => setCfg(p => ({ ...p, deposit_alert_days: e.target.value }))} /></div>
            <div><label className="label">{tc('deppage.alertIfAmount', '…or amount > ₹ (0 = off)')}</label><input className="input" style={{ width: 140 }} type="number" min="0" value={cfg.deposit_alert_amount ?? ''} onChange={e => setCfg(p => ({ ...p, deposit_alert_amount: e.target.value }))} /></div>
            <button className="btn btn-secondary" onClick={saveCfg}>{tc('deppage.save', 'Save')}</button>
          </div>
        </div>
      )}

      {/* Deposits list */}
      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr><th>{tc('deppage.thDate', 'Date')}</th><th style={{ textAlign: 'right' }}>{tc('deppage.thAmount', 'Amount')}</th><th>{tc('deppage.thBankRef', 'Bank / Ref')}</th><th>{tc('deppage.thBy', 'By')}</th><th style={{ textAlign: 'center' }}>{tc('deppage.thBankConfirmed', 'Bank confirmed')}</th></tr>
            </thead>
            <tbody>
              {deposits.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>{tc('deppage.noDeposits', 'No deposits recorded yet.')}</td></tr>}
              {deposits.map(d => (
                <tr key={d.id}>
                  <td style={{ fontSize: 13 }}>{toDate(d.deposit_date)}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(d.amount)}</td>
                  <td style={{ fontSize: 13 }}>{d.bank_account || '—'}{d.reference_no ? ` · ${d.reference_no}` : ''}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{d.deposited_by_name || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    {d.confirmed
                      ? <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}><CheckCircle size={14} />{tc('deppage.confirmed', 'Confirmed')}</span>
                      : isOwner
                        ? <button className="btn btn-secondary btn-sm" onClick={() => confirmDeposit(d)}>{tc('deppage.confirmInBank', 'Confirm in bank')}</button>
                        : <span style={{ color: '#d97706', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}><AlertTriangle size={13} />{tc('deppage.pending', 'Pending')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record deposit modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div className="card" style={{ width: 400, maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>{tc('deppage.recordBankDeposit', 'Record Bank Deposit')}</span>
              <button onClick={() => setModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={save}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">{tc('deppage.amountLabel', 'Amount (₹)')}</label>
                <input className="input" type="number" step="0.01" min="0" autoFocus value={form.amount || ''} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
                {status?.awaiting > 0.5 && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{tc('deppage.awaitingDeposit', 'Awaiting deposit:')} {fmt(status.awaiting)}</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '0.75rem' }}>
                <div><label className="label">{tc('deppage.dateLabel', 'Date')}</label><input className="input" type="date" value={form.deposit_date || ''} onChange={e => setForm(p => ({ ...p, deposit_date: e.target.value }))} /></div>
                <div><label className="label">{tc('deppage.bankAc', 'Bank A/C')}</label><input className="input" placeholder={tc('deppage.optional', 'optional')} value={form.bank_account || ''} onChange={e => setForm(p => ({ ...p, bank_account: e.target.value }))} /></div>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">{tc('deppage.referenceLabel', 'Reference (slip / UTR)')}</label>
                <input className="input" placeholder={tc('deppage.optional', 'optional')} value={form.reference_no || ''} onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={saving}>
                {saving ? tc('deppage.saving', 'Saving…') : tc('deppage.recordDeposit', 'Record Deposit')}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
