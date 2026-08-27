'use client';
// Owner Money — manager-recorded money in/out with the owner.
// IN = owner puts money in (capital, or a loan he'll take back) or other income (scrap).
// OUT = owner takes money (drawings). The engine posts it; no debits/credits shown.
import { useState, useEffect, useCallback } from 'react';
import { Wallet, CheckCircle } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

import { errText } from '../../../lib/apiError';
const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function OwnerMoneyPage() {
  const { station } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [enabled, setEnabled] = useState(null);
  const [dir, setDir] = useState('out');       // 'in' | 'out'
  const [kind, setKind] = useState('capital');  // for IN: capital | loan | income
  const [account, setAccount] = useState('cash');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const loadRecent = useCallback(async () => {
    if (!sid) return;
    const r = await api.get(`/accounts/owner-money?station_id=${sid}`).catch(() => null);
    setRecent(r && r.enabled ? (r.entries || []) : []);
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`).then(s => setEnabled(!!s?.accounts_enabled)).catch(() => setEnabled(false));
  }, [sid]);
  useEffect(() => { if (enabled) loadRecent(); }, [enabled, loadRecent]);

  const save = async () => {
    if (!(Number(amount) > 0)) return showToast(tc('om.needAmount', 'Enter an amount.'));
    setSaving(true);
    try {
      await api.post('/accounts/owner-money', {
        station_id: sid, direction: dir, kind: dir === 'in' ? kind : undefined,
        amount: Number(amount), account, date, description,
      });
      setAmount(''); setDescription('');
      await loadRecent();
      showToast(tc('om.saved', 'Recorded.'));
    } catch (e) {
      showToast(errText(e, tc('om.failed', 'Could not save.')));
    }
    setSaving(false);
  };

  const seg = (val, cur, setter, label) => (
    <button type="button" onClick={() => setter(val)} style={{
      padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
      border: `1px solid ${cur === val ? '#FF6B00' : 'var(--border)'}`,
      background: cur === val ? 'rgba(255,107,0,.08)' : '#fff',
      color: cur === val ? '#FF6B00' : 'var(--text-2)', fontWeight: cur === val ? 600 : 400,
    }}>{label}</button>
  );

  return (
    <AppShell>
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#16a34a', color: '#fff', padding: '10px 18px', borderRadius: 10, zIndex: 400, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <CheckCircle size={16} />{toast}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wallet size={22} /> {tc('om.title', 'Owner Money')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {tc('om.subtitle', 'Money the owner puts in or takes out.')}
          </div>
        </div>
      </div>

      {enabled === false && (
        <div className="card" style={{ maxWidth: 560 }}>{tc('om.off', 'The Accounts module is off for this outlet. Turn it on in Settings → Accounting.')}</div>
      )}

      {enabled && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {seg('out', dir, setDir, tc('om.out', 'Owner took money'))}
              {seg('in', dir, setDir, tc('om.in', 'Owner put money in'))}
            </div>

            {dir === 'in' && (
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-3)' }}>{tc('om.what', 'What is it?')}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {seg('capital', kind, setKind, tc('om.capital', 'My money (capital)'))}
                  {seg('loan', kind, setKind, tc('om.loan', 'A loan (I’ll take it back)'))}
                  {seg('income', kind, setKind, tc('om.income', 'Other income (scrap…)'))}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{tc('om.amount', 'Amount (₹)')}</label>
                <input className="input" type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{tc('om.date', 'Date')}</label>
                <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-3)' }}>
                {dir === 'out' ? tc('om.fromWhere', 'Taken from') : tc('om.intoWhere', 'Received in')}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {seg('cash', account, setAccount, tc('om.cash', 'Cash'))}
                {seg('bank', account, setAccount, tc('om.bank', 'Bank'))}
              </div>
            </div>

            <div>
              <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{tc('om.note', 'Note (optional)')}</label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            <button onClick={save} disabled={saving} style={{
              background: '#FF6B00', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 20px',
              borderRadius: 9, border: 'none', cursor: saving ? 'wait' : 'pointer', justifySelf: 'start',
            }}>{saving ? tc('om.saving', 'Saving…') : tc('om.save', 'Record')}</button>
          </div>

          {recent.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{tc('om.recent', 'Recent')}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {recent.map(e => (
                  <div key={e.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-2)' }}>{e.entry_date} · {e.narration}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
