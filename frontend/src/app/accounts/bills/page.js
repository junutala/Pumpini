'use client';
// Bill & Payment — the manager's expense/asset capture.
// Ideal flow: scan → confirm the pre-filled details → tick PAID → save. Manual entry
// works too (skip the scan). The engine posts the double-entry; the manager never sees
// a debit or a credit. Reads/writes only the Accounts module's own endpoints.
import { useState, useEffect, useCallback } from 'react';
import { Receipt, CheckCircle } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import PhotoCapture from '../../../components/shared/PhotoCapture';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

import { errText } from '../../../lib/apiError';
const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const BLANK = {
  vendor_name: '', amount: '', gst_amount: '', expense_date: todayISO(), invoice_number: '',
  description: '', category: '', is_asset: false, asset_life_years: '',
  paid: false, payment_mode: 'bank', ai_suggested_category: '', ai_confidence: '',
};

export default function BillPaymentPage() {
  const { station } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [enabled, setEnabled] = useState(null);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [scan, setScan] = useState(null);       // { base64, media_type }
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const loadRecent = useCallback(async () => {
    if (!sid) return;
    const r = await api.get(`/accounts/expenses?station_id=${sid}&limit=30`).catch(() => null);
    setRecent(r && r.enabled ? (r.expenses || []) : []);
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`).then(s => setEnabled(!!s?.accounts_enabled)).catch(() => setEnabled(false));
  }, [sid]);

  useEffect(() => {
    if (!enabled || !sid) return;
    api.get(`/accounts/expense-categories?station_id=${sid}`).then(r => setCategories(r?.categories || [])).catch(() => {});
    loadRecent();
  }, [enabled, sid, loadRecent]);

  const onScan = async (cap) => {
    setScan(cap);
    if (!cap) return;
    setScanning(true);
    try {
      const r = await api.post('/accounts/scan-bill', { station_id: sid, file_base64: cap.base64, media_type: cap.media_type });
      setForm(f => ({
        ...f,
        vendor_name: r.vendor || f.vendor_name,
        amount: r.amount != null ? String(r.amount) : f.amount,
        gst_amount: r.gst_amount != null ? String(r.gst_amount) : f.gst_amount,
        expense_date: r.date || f.expense_date,
        invoice_number: r.invoice_number || f.invoice_number,
        description: r.description || f.description,
        category: r.suggested_category || f.category,
        is_asset: !!r.is_asset,
        ai_suggested_category: r.suggested_category || '',
        ai_confidence: r.confidence || '',
      }));
      showToast(tc('bill.scanned', 'Details read — please check them.'));
    } catch (e) {
      showToast(errText(e, tc('bill.scanFailed', 'Could not read the bill — enter it manually.')));
    }
    setScanning(false);
  };

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const save = async () => {
    if (!(Number(form.amount) > 0)) return showToast(tc('bill.needAmount', 'Enter the amount.'));
    if (!form.is_asset && !form.category) return showToast(tc('bill.needCategory', 'Pick an expense head.'));
    setSaving(true);
    try {
      await api.post('/accounts/expenses', {
        station_id: sid, ...form,
        amount: Number(form.amount), gst_amount: Number(form.gst_amount || 0),
        asset_life_years: form.asset_life_years ? Number(form.asset_life_years) : null,
        file_base64: scan?.base64, media_type: scan?.media_type,
      });
      setForm(BLANK); setScan(null);
      await loadRecent();
      showToast(tc('bill.saved', 'Saved.'));
    } catch (e) {
      showToast(errText(e, tc('bill.saveFailed', 'Could not save.')));
    }
    setSaving(false);
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
            <Receipt size={22} /> {tc('bill.title', 'Bill & Payment')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {tc('bill.subtitle', 'Scan a bill or enter it — Pumpini does the accounting.')}
          </div>
        </div>
      </div>

      {enabled === false && (
        <div className="card" style={{ maxWidth: 560 }}>
          {tc('bill.off', 'The Accounts module is off for this outlet. Turn it on in Settings → Accounting.')}
        </div>
      )}

      {enabled && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{tc('bill.scan', 'Scan the bill')}</div>
            <PhotoCapture label={scanning ? tc('bill.reading', 'Reading…') : tc('bill.takePhoto', 'Take photo of bill')}
              disabled={scanning} onCapture={onScan}
              hint={tc('bill.scanHint', 'Or fill the details below by hand.')} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <Field label={tc('bill.vendor', 'Vendor / payee')} span2>
                <input className="input" value={form.vendor_name} onChange={e => set('vendor_name', e.target.value)} />
              </Field>
              <Field label={tc('bill.amount', 'Amount (₹, incl GST)')}>
                <input className="input" type="number" inputMode="decimal" value={form.amount} onChange={e => set('amount', e.target.value)} />
              </Field>
              <Field label={tc('bill.gst', 'GST (₹, if any)')}>
                <input className="input" type="number" inputMode="decimal" value={form.gst_amount} onChange={e => set('gst_amount', e.target.value)} />
              </Field>
              <Field label={tc('bill.date', 'Date')}>
                <input className="input" type="date" value={form.expense_date} onChange={e => set('expense_date', e.target.value)} />
              </Field>
              <Field label={tc('bill.invoiceNo', 'Bill / invoice no.')}>
                <input className="input" value={form.invoice_number} onChange={e => set('invoice_number', e.target.value)} />
              </Field>

              <Field label={tc('bill.assetQ', 'Is this buying an asset?')} span2>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={form.is_asset} onChange={e => set('is_asset', e.target.checked)} />
                  {tc('bill.assetHelp', 'Tick if it is equipment / a fixed asset (a machine, dispenser, furniture) — not a running expense.')}
                </label>
              </Field>

              {!form.is_asset ? (
                <Field label={tc('bill.head', 'Expense head')} span2>
                  <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="">{tc('bill.pickHead', '— pick —')}</option>
                    {categories.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                  {form.ai_suggested_category && form.category === form.ai_suggested_category && (
                    <div style={{ fontSize: 11.5, color: '#16a34a', marginTop: 4 }}>{tc('bill.aiSuggest', 'Suggested by Pumpini — change if wrong.')}</div>
                  )}
                </Field>
              ) : (
                <Field label={tc('bill.assetLife', 'Asset life (years)')}>
                  <input className="input" type="number" inputMode="decimal" value={form.asset_life_years} onChange={e => set('asset_life_years', e.target.value)} />
                </Field>
              )}

              <Field label={tc('bill.for', 'What is it for?')} span2>
                <input className="input" value={form.description} onChange={e => set('description', e.target.value)} />
              </Field>
            </div>

            {/* Paid? */}
            <div style={{ marginTop: 14, padding: '12px', background: 'var(--surface-2, #f7f6f3)', borderRadius: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
                <input type="checkbox" checked={form.paid} onChange={e => set('paid', e.target.checked)} />
                {tc('bill.paid', 'Paid')}
              </label>
              {form.paid && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{tc('bill.paidBy', 'Paid by')}</span>
                  {['bank', 'upi', 'cheque'].map(m => (
                    <button key={m} type="button" onClick={() => set('payment_mode', m)} style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      border: `1px solid ${form.payment_mode === m ? '#FF6B00' : 'var(--border)'}`,
                      background: form.payment_mode === m ? 'rgba(255,107,0,.08)' : '#fff',
                      color: form.payment_mode === m ? '#FF6B00' : 'var(--text-2)', fontWeight: form.payment_mode === m ? 600 : 400,
                    }}>{tc('bill.mode_' + m, m === 'bank' ? 'Bank' : m === 'upi' ? 'UPI' : 'Cheque')}</button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
                {tc('bill.cashHint', 'Cash-drawer expenses go on the Petty Cash screen, not here.')}
              </div>
            </div>

            <button onClick={save} disabled={saving} style={{
              marginTop: 14, background: '#FF6B00', color: '#fff', fontWeight: 700, fontSize: 14,
              padding: '11px 20px', borderRadius: 9, border: 'none', cursor: saving ? 'wait' : 'pointer',
            }}>{saving ? tc('bill.saving', 'Saving…') : tc('bill.save', 'Save')}</button>
          </div>

          {recent.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{tc('bill.recent', 'Recent bills')}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {recent.map(e => (
                  <div key={e.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-2)' }}>
                      {e.expense_date} · {e.vendor_name || e.category_name || (e.is_asset ? 'Asset' : 'Expense')}
                      {e.payment_status === 'unpaid' && <span style={{ color: '#dc2626', marginLeft: 6 }}>· {tc('bill.unpaid', 'unpaid')}</span>}
                    </span>
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

function Field({ label, span2, children }) {
  return (
    <div style={{ gridColumn: span2 ? '1 / -1' : 'auto' }}>
      <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{label}</label>
      {children}
    </div>
  );
}
