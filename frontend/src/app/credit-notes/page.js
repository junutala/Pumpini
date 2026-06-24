'use client';
import { useState, useEffect } from 'react';
import { RotateCcw, X, Printer } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8,
  fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const fmt = n => Number(n||0).toLocaleString('en-IN',{ minimumFractionDigits:2, maximumFractionDigits:2 });

export default function CreditNotesPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [notes,     setNotes]     = useState([]);
  const [corps,     setCorps]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  // New-return form
  const [custKey,   setCustKey]   = useState('cash');     // 'cash' | corporate id
  const [invoices,  setInvoices]  = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [lines,     setLines]     = useState([]);          // returnable items with returnQty
  const [reason,    setReason]    = useState('');
  // Petrol/diesel credit-note flow (credit customers): adjust against a gst_invoice
  const [creditInvs,     setCreditInvs]     = useState([]);
  const [creditInvId,    setCreditInvId]    = useState('');
  const [cnAmount,       setCnAmount]       = useState('');
  const [reduceSuspense, setReduceSuspense] = useState(false);
  const [saved,          setSaved]          = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [n, c] = await Promise.all([
        api.get('/product-credit-notes', { params:{ station_id:stationId } }),
        api.get('/corporate', { params:{ station_id:stationId } }),
      ]);
      setNotes(Array.isArray(n)?n:[]); setCorps(Array.isArray(c)?c:[]);
    } catch(e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { if (stationId) load(); }, [stationId]);

  // Load eligible invoices when the customer changes.
  // Cash → product invoices (returns). Credit → open petrol/diesel credit invoices.
  useEffect(() => {
    if (!modal || !stationId) return;
    setInvoices([]); setInvoiceId(''); setLines([]);
    setCreditInvs([]); setCreditInvId(''); setCnAmount(''); setReduceSuspense(false);
    if (custKey === 'cash') {
      api.get('/product-credit-notes/eligible', { params:{ station_id:stationId, customer_type:'cash' } })
        .then(r => setInvoices(Array.isArray(r)?r:[])).catch(()=>setInvoices([]));
    } else {
      api.get('/product-credit-notes/credit-invoices', { params:{ station_id:stationId, customer_id:custKey } })
        .then(r => setCreditInvs(Array.isArray(r)?r:[])).catch(()=>setCreditInvs([]));
    }
  }, [custKey, modal, stationId]);

  const selectCreditInv = (id) => {
    setCreditInvId(id);
    const ci = creditInvs.find(i => i.id === id);
    setCnAmount(ci ? Number(ci.outstanding).toFixed(2) : '');
  };

  const submitCredit = async () => {
    if (!creditInvId) { setErr(tc('cnotes.errSelectInvoice', 'Select the original invoice')); return; }
    const amt = parseFloat(cnAmount);
    const ci  = creditInvs.find(i => i.id === creditInvId);
    if (!amt || amt <= 0) { setErr(tc('cnotes.errAmount', 'Enter a credit note amount greater than zero')); return; }
    if (ci && amt > Number(ci.outstanding) + 0.001) { setErr(tc('cnotes.errExceeds', 'Amount exceeds the invoice outstanding')); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/product-credit-notes/credit-adjustment', {
        station_id: stationId, corporate_id: custKey, invoice_id: creditInvId,
        amount: amt, reason, reduce_suspense: reduceSuspense,
      });
      setModal(false); setSaved(tc('cnotes.savedCredit', 'Credit note issued — customer outstanding reduced.')); load();
      setTimeout(() => setSaved(''), 4000);
    } catch(e) { setErr(e.response?.data?.error || e.error || tc('cnotes.errCreateFailed', 'Could not create credit note')); }
    setSaving(false);
  };

  const loadReturnable = async (id) => {
    setInvoiceId(id); setLines([]);
    if (!id) return;
    try {
      const items = await api.get(`/product-credit-notes/invoice/${id}/returnable`);
      setLines((Array.isArray(items)?items:[]).map(i => ({ ...i, returnQty: 0 })));
    } catch { setLines([]); }
  };

  const setQty = (id, val) => setLines(prev => prev.map(l => {
    if (l.id !== id) return l;
    const max = parseFloat(l.returnable);
    let q = parseFloat(val); if (isNaN(q) || q < 0) q = 0; if (q > max) q = max;
    return { ...l, returnQty: q };
  }));

  const lineAmt = (l) => l.returnQty * parseFloat(l.unit_price) * (1 + parseFloat(l.gst_rate)/100);
  const grand = lines.reduce((s,l) => s + lineAmt(l), 0);

  const openNew = () => { setCustKey('cash'); setInvoiceId(''); setInvoices([]); setLines([]); setReason(''); setErr('');
    setCreditInvs([]); setCreditInvId(''); setCnAmount(''); setReduceSuspense(false); setModal(true); };

  const submit = async () => {
    const toReturn = lines.filter(l => l.returnQty > 0).map(l => ({ invoice_item_id: l.id, quantity: l.returnQty }));
    if (!invoiceId) { setErr(tc('cnotes.errSelectInvoice', 'Select the original invoice')); return; }
    if (!toReturn.length) { setErr(tc('cnotes.errEnterReturnQty', 'Enter a return quantity for at least one item')); return; }
    setSaving(true); setErr('');
    try {
      const inv = invoices.find(i => i.id === invoiceId);
      await api.post('/product-credit-notes', {
        station_id: stationId,
        invoice_id: invoiceId,
        invoice_number: inv?.invoice_number,
        customer_name: inv?.customer_name,
        reason,
        items: toReturn,
      });
      setModal(false); load();
    } catch(e) { setErr(e.response?.data?.error || e.error || tc('cnotes.errCreateFailed', 'Could not create credit note')); }
    setSaving(false);
  };

  const isCredit = custKey !== 'cash';

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('cnotes.title', 'Credit Notes')}</h1>
          <div style={{ fontSize:13, color:'var(--text-3)' }}>{tc('cnotes.subtitle', 'Product returns against an invoice (GST credit note)')}</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}><RotateCcw size={15}/> {tc('cnotes.newReturn', 'New Return')}</button>
      </div>

      {saved && <div className="alert-banner success" style={{ marginBottom:'1rem' }}>{saved}</div>}

      <div className="table-wrap">
        <table className="dms-table">
          <thead><tr>
            {[
              tc('cnotes.thCreditNote','Credit Note'),
              tc('cnotes.thDate','Date'),
              tc('cnotes.thCustomer','Customer'),
              tc('cnotes.thAgainstInvoice','Against Invoice'),
              tc('cnotes.thSettlement','Settlement'),
              tc('cnotes.thAmount','Amount'),
            ].map(h=><th key={h}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-3)' }}>{tc('cnotes.loading', 'Loading…')}</td></tr>
            ) : notes.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-3)' }}>{tc('cnotes.empty', 'No credit notes yet')}</td></tr>
            ) : notes.map(n => (
              <tr key={n.id}>
                <td className="num" style={{ fontWeight:600 }}>{n.cn_number}</td>
                <td>{new Date(n.created_at).toLocaleDateString('en-IN')}</td>
                <td>{n.customer_name}</td>
                <td className="num">{n.original_invoice_number || '—'}</td>
                <td><span className="badge badge-gray">{n.settlement === 'outstanding' ? tc('cnotes.outstandingDown', 'Outstanding ↓') : tc('cnotes.pettyCash', 'Petty cash')}</span></td>
                <td className="num" style={{ fontWeight:600 }}>₹{fmt(n.grand_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New return modal */}
      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex',
          alignItems:'center', justifyContent:'center', zIndex:200, padding:'1rem', overflowY:'auto' }}>
          <div className="card" style={{ width:'100%', maxWidth:560, maxHeight:'92vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem' }}>
              <span style={{ fontWeight:700, fontSize:16 }}>{tc('cnotes.modalTitle', 'New Return / Credit Note')}</span>
              <button onClick={()=>setModal(false)} style={{ background:'none', border:'none', cursor:'pointer' }}><X size={18}/></button>
            </div>

            <div style={{ marginBottom:'0.85rem' }}>
              <label className="label">{tc('cnotes.customer', 'Customer')}</label>
              <select style={inp} value={custKey} onChange={e=>setCustKey(e.target.value)}>
                <option value="cash">{tc('cnotes.cashCustomer', 'Cash Customer (refund from petty cash)')}</option>
                {corps.map(c => <option key={c.id} value={c.id}>{tc('cnotes.corpOptionSuffix', '{name} (credit — reduces outstanding)').replace('{name}', c.company_name)}</option>)}
              </select>
            </div>

            {/* CASH customer → product return against a product invoice */}
            {!isCredit && (<>
              <div style={{ marginBottom:'0.85rem' }}>
                <label className="label">{tc('cnotes.originalInvoice', 'Original invoice')} *{' '}
                  <span style={{ fontWeight:400, color:'var(--text-3)' }}>{tc('cnotes.withinReturnPolicy', '(within return policy)')}</span>
                </label>
                <select style={inp} value={invoiceId} onChange={e=>loadReturnable(e.target.value)}>
                  <option value="">{invoices.length ? tc('cnotes.selectInvoice', 'Select invoice…') : tc('cnotes.noInvoicesInWindow', 'No invoices in the return window')}</option>
                  {invoices.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.invoice_number} · {new Date(i.created_at).toLocaleDateString('en-IN')} · ₹{fmt(i.grand_total)}
                    </option>
                  ))}
                </select>
              </div>

              {lines.length > 0 && (
                <div style={{ marginBottom:'0.85rem' }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text-2)', marginBottom:6 }}>{tc('cnotes.itemsToReturn', 'Items to return')}</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {lines.map(l => (
                      <div key={l.id} style={{ display:'flex', alignItems:'center', gap:8,
                        background:'var(--surface-2)', borderRadius:8, padding:'8px 10px',
                        opacity: parseFloat(l.returnable) === 0 ? 0.5 : 1 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600 }}>{l.product_name}</div>
                          <div style={{ fontSize:11, color:'var(--text-3)' }}>
                            ₹{fmt(l.unit_price)} · {l.gst_rate}% GST · {tc('cnotes.sold', 'sold {n}').replace('{n}', Number(l.quantity))} · {tc('cnotes.returnable', 'returnable {n}').replace('{n}', Number(l.returnable))}
                          </div>
                        </div>
                        <input type="number" step="0.1" min="0" max={l.returnable}
                          disabled={parseFloat(l.returnable) === 0}
                          value={l.returnQty || ''} placeholder="0"
                          onChange={e=>setQty(l.id, e.target.value)}
                          style={{ ...inp, width:72, textAlign:'center' }}/>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* CREDIT customer → credit note against an open petrol/diesel credit invoice */}
            {isCredit && (<>
              <div style={{ marginBottom:'0.85rem' }}>
                <label className="label">{tc('cnotes.openInvoice', 'Open credit invoice')} *</label>
                <select style={inp} value={creditInvId} onChange={e=>selectCreditInv(e.target.value)}>
                  <option value="">{creditInvs.length ? tc('cnotes.selectInvoice', 'Select invoice…') : tc('cnotes.noOpenInvoices', 'No open credit invoices for this customer')}</option>
                  {creditInvs.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.invoice_number} · {new Date(i.invoice_date).toLocaleDateString('en-IN')} · {tc('cnotes.outstandingShort', 'outstanding')} ₹{fmt(i.outstanding)}
                    </option>
                  ))}
                </select>
              </div>

              {creditInvId && (
                <div style={{ marginBottom:'0.85rem' }}>
                  <label className="label">{tc('cnotes.creditAmount', 'Credit note amount')} *</label>
                  <input type="number" step="0.01" min="0" style={inp} value={cnAmount}
                    onChange={e=>setCnAmount(e.target.value)} placeholder="0.00"/>
                  {(() => { const ci = creditInvs.find(i=>i.id===creditInvId); return ci
                    ? <div style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>{tc('cnotes.maxOutstanding', 'Max (outstanding): ₹{n}').replace('{n}', fmt(ci.outstanding))}</div>
                    : null; })()}
                </div>
              )}
            </>)}

            <div style={{ marginBottom:'0.85rem' }}>
              <label className="label">{tc('cnotes.reason', 'Reason (optional)')}</label>
              <input style={inp} value={reason} onChange={e=>setReason(e.target.value)} placeholder={tc('cnotes.reasonPlaceholder', 'e.g. wrong item, damaged in transit')} />
            </div>

            {/* Suspense toggle — credit customers only (mirrors the opening-balance flag) */}
            {isCredit && (
              <label style={{ display:'inline-flex', alignItems:'center', gap:8, marginBottom:'0.85rem',
                fontSize:13, cursor:'pointer', color: reduceSuspense?'#9a3412':'var(--text-2)' }}>
                <input type="checkbox" checked={reduceSuspense} onChange={e=>setReduceSuspense(e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }}/>
                <span>{tc('cnotes.reduceSuspense', 'Add this back to the credit control total (reverses the invoice — e.g. correcting an over-invoice)')}</span>
              </label>
            )}

            {err && <div className="alert-banner danger" style={{ marginBottom:'0.85rem' }}>{err}</div>}

            {!isCredit ? (<>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'4px 0 12px' }}>
                <span style={{ fontSize:13, color:'var(--text-3)' }}>
                  {tc('cnotes.refundPettyCash', 'Refund from petty cash')} {tc('cnotes.inclGst', '(incl. GST)')}
                </span>
                <span style={{ fontSize:20, fontWeight:800 }}>₹{fmt(grand)}</span>
              </div>
              <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', height:46 }}
                onClick={submit} disabled={saving || grand <= 0}>
                {saving ? tc('cnotes.issuing', 'Issuing…') : tc('cnotes.issueCreditNote', 'Issue Credit Note')}
              </button>
            </>) : (<>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'4px 0 12px' }}>
                <span style={{ fontSize:13, color:'var(--text-3)' }}>
                  {tc('cnotes.reducesOutstanding', 'Reduces customer outstanding')}{reduceSuspense ? tc('cnotes.andControlTotal', ' + adds back to control total') : ''}
                </span>
                <span style={{ fontSize:20, fontWeight:800 }}>₹{fmt(parseFloat(cnAmount) || 0)}</span>
              </div>
              <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', height:46 }}
                onClick={submitCredit} disabled={saving || !(parseFloat(cnAmount) > 0)}>
                {saving ? tc('cnotes.issuing', 'Issuing…') : tc('cnotes.issueCreditNote', 'Issue Credit Note')}
              </button>
            </>)}
          </div>
        </div>
      )}
    </AppShell>
  );
}
