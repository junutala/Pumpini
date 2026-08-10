'use client';
// Payables — what the outlet owes, and paying it down.
// Two aggregate payables (Trade creditors incl. OMC fuel, and CNG owed to IOCL) with a
// "record payment", plus the list of unpaid bills each with a "mark paid". The engine
// posts every payment; balances drop as they're paid.
import { useState, useEffect, useCallback } from 'react';
import { CreditCard, CheckCircle } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '';

export default function PayablesPage() {
  const { station } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [enabled, setEnabled] = useState(null);
  const [data, setData] = useState(null);
  const [fuel, setFuel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [payMode, setPayMode] = useState({});    // per-row chosen mode
  const [payAmt, setPayAmt] = useState({ creditors: '', cng_payable: '' });

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    if (!sid) return;
    const [r, fp] = await Promise.all([
      api.get(`/accounts/payables?station_id=${sid}`).catch(() => null),
      api.get(`/accounts/fuel-purchases?station_id=${sid}`).catch(() => null),
    ]);
    setData(r && r.enabled ? r : null);
    setFuel(fp && fp.enabled ? (fp.purchases || []) : []);
  }, [sid]);

  const setFuelPaid = async (ids, paid) => {
    setBusy(true);
    try {
      await api.patch('/deliveries/mark-paid', { station_id: sid, ids, paid });
      await load();
      showToast(tc('pay.markedRepost', 'Updated — Re-post on the Accounts screen to apply.'));
    } catch (e) { showToast(e.response?.data?.error || tc('pay.failed', 'Could not update.')); }
    setBusy(false);
  };

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`).then(s => setEnabled(!!s?.accounts_enabled)).catch(() => setEnabled(false));
  }, [sid]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const payAccount = async (target) => {
    const amount = Number(payAmt[target]);
    if (!(amount > 0)) return showToast(tc('pay.needAmount', 'Enter an amount.'));
    setBusy(true);
    try {
      await api.post('/accounts/pay-supplier', { station_id: sid, target, amount, payment_mode: payMode['acct_' + target] || 'bank' });
      setPayAmt(a => ({ ...a, [target]: '' }));
      await load(); showToast(tc('pay.done', 'Payment recorded.'));
    } catch (e) { showToast(e.response?.data?.error || tc('pay.failed', 'Could not record.')); }
    setBusy(false);
  };

  const payBill = async (id) => {
    setBusy(true);
    try {
      await api.post(`/accounts/expenses/${id}/pay`, { station_id: sid, payment_mode: payMode[id] || 'bank' });
      await load(); showToast(tc('pay.done', 'Payment recorded.'));
    } catch (e) { showToast(e.response?.data?.error || tc('pay.failed', 'Could not record.')); }
    setBusy(false);
  };

  const modePicker = (key) => (
    <select value={payMode[key] || 'bank'} onChange={e => setPayMode(m => ({ ...m, [key]: e.target.value }))}
      className="input" style={{ width: 90, height: 34, padding: '0 8px', fontSize: 13 }}>
      <option value="bank">{tc('pay.bank', 'Bank')}</option>
      <option value="upi">{tc('pay.upi', 'UPI')}</option>
      <option value="cheque">{tc('pay.cheque', 'Cheque')}</option>
    </select>
  );

  const AcctCard = (target, label, hint) => {
    const bal = Number(data?.[target] || 0);
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{hint}</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmt(bal)}</div>
        </div>
        {bal > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" type="number" inputMode="decimal" placeholder={tc('pay.amount', 'Amount paid')}
              value={payAmt[target]} onChange={e => setPayAmt(a => ({ ...a, [target]: e.target.value }))}
              style={{ width: 150 }} />
            {modePicker('acct_' + target)}
            <button onClick={() => payAccount(target)} disabled={busy} style={{
              background: '#FF6B00', color: '#fff', fontWeight: 600, fontSize: 13, padding: '8px 16px',
              borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
            }}>{tc('pay.record', 'Record payment')}</button>
          </div>
        )}
      </div>
    );
  };

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
            <CreditCard size={22} /> {tc('pay.title', 'Payables')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('pay.subtitle', 'What the outlet owes, and paying it down.')}</div>
        </div>
      </div>

      {enabled === false && (
        <div className="card" style={{ maxWidth: 560 }}>{tc('pay.off', 'The Accounts module is off for this outlet. Turn it on in Settings → Accounting.')}</div>
      )}

      {enabled && data && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
          {AcctCard('trade_payables', tc('pay.trade', 'Trade Payables'), tc('pay.tradeHint', 'Suppliers & oil company (fuel bought on credit).'))}
          {AcctCard('cng_payable', tc('pay.cng', 'CNG Collections Payable (IOCL)'), tc('pay.cngHint', 'CNG cash collected on IOCL’s behalf.'))}

          {fuel.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{tc('pay.fuelPurchases', 'Fuel purchases (oil-company invoices)')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
                {tc('pay.fuelHint', 'Prepaid invoices are paid from your bank; credit ones sit in Trade Payables. Fix any here, then Re-post on the Accounts screen.')}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      <th style={{ padding: '6px 8px' }}>{tc('pay.date', 'Date')}</th>
                      <th style={{ padding: '6px 8px' }}>{tc('pay.invoice', 'Invoice')}</th>
                      <th style={{ padding: '6px 8px' }}>{tc('pay.fuel', 'Fuel')}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>{tc('pay.litres', 'Litres')}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>{tc('pay.value', 'Value')}</th>
                      <th style={{ padding: '6px 8px' }}>{tc('pay.status', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuel.map(p => (
                      <tr key={p.invoice_key} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fmtDate(p.date)}</td>
                        <td style={{ padding: '6px 8px' }}>{[p.oil_company, p.dc_number].filter(Boolean).join(' ')}</td>
                        <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{p.fuels}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(p.ltrs || 0).toLocaleString('en-IN')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.value)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => setFuelPaid(p.ids, true)} disabled={busy} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: busy ? 'wait' : 'pointer', border: `1px solid ${p.status === 'prepaid' ? '#16a34a' : 'var(--border)'}`, background: p.status === 'prepaid' ? '#16a34a' : '#fff', color: p.status === 'prepaid' ? '#fff' : 'var(--text-2)' }}>{tc('pay.prepaid', 'Prepaid')}</button>
                            <button onClick={() => setFuelPaid(p.ids, false)} disabled={busy} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: busy ? 'wait' : 'pointer', border: `1px solid ${p.status === 'credit' ? '#FF6B00' : 'var(--border)'}`, background: p.status === 'credit' ? 'rgba(255,107,0,.08)' : '#fff', color: p.status === 'credit' ? '#FF6B00' : 'var(--text-2)' }}>{tc('pay.credit', 'Credit')}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{tc('pay.unpaidBills', 'Unpaid bills')}</div>
            {(!data.unpaid_expenses || !data.unpaid_expenses.length) ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('pay.noBills', 'No unpaid bills.')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {data.unpaid_expenses.map(e => (
                  <div key={e.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13 }}>
                      <div style={{ fontWeight: 600 }}>{e.vendor_name || e.category_name || (e.is_asset ? tc('pay.asset', 'Asset') : tc('pay.expense', 'Expense'))}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{e.expense_date}{e.invoice_number ? ' · ' + e.invoice_number : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(e.amount)}</span>
                      {modePicker(e.id)}
                      <button onClick={() => payBill(e.id)} disabled={busy} style={{
                        background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13, padding: '7px 14px',
                        borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
                      }}>{tc('pay.markPaid', 'Mark paid')}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
