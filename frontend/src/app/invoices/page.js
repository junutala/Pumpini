'use client';
// Credit Invoices — control-total model. Credit is captured at the pump but never
// tagged to a customer; at shift close the credit lump is booked into a single
// station suspense ("Credit pending invoicing"). Here the manager raises a credit
// invoice per customer (vehicle / fuel / qty / rate keyed from the chits) and the
// control total simply DEPRECIATES by the invoice amount — no rate reconciliation.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, FileText, ChevronRight, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt   = n => Number(n||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });
const inp   = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const FUELS = ['petrol','diesel'];
const emptyLine = () => ({ vehicle:'', fuel:'diesel', qty:'', rate:'' });
const lineAmt  = l => (parseFloat(l.qty)||0) * (parseFloat(l.rate)||0);

export default function InvoicesPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [corps,    setCorps]    = useState([]);
  const [settings, setSettings] = useState(null);
  const [pending,  setPending]  = useState({ pending:0, booked:0, invoiced:0 });
  const [recent,   setRecent]   = useState([]);

  const [corp,    setCorp]    = useState('');
  const [invNo,   setInvNo]   = useState('');
  const [invDate, setInvDate] = useState(today());
  const [lines,   setLines]   = useState([emptyLine()]);
  const [busy,    setBusy]    = useState(false);
  const [msg,     setMsg]     = useState(null);   // { ok, text }

  const load = useCallback(async () => {
    if (!stationId) return;
    const [c, s, p, r] = await Promise.all([
      api.get('/corporate', { params:{ station_id: stationId } }).catch(()=>[]),
      api.get(`/stations/${stationId}/settings`).catch(()=>null),
      api.get('/invoices/credit-pending', { params:{ station_id: stationId } }).catch(()=>({ pending:0 })),
      api.get('/invoices', { params:{ station_id: stationId } }).catch(()=>[]),
    ]);
    setCorps(Array.isArray(c)?c:[]);
    setSettings(s);
    setPending(p || { pending:0 });
    setRecent(Array.isArray(r) ? r.slice(0, 8) : []);
  }, [stationId]);

  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load);

  // Next invoice number — PREFIX-YYYYMMDD-NNNN (mirrors the prior convention).
  useEffect(() => {
    const prefix = settings?.invoice_prefix || 'INV';
    const seq    = String(settings?.invoice_seq || 1).padStart(4,'0');
    const d      = today().replace(/-/g,'');
    setInvNo(`${prefix}-${d}-${seq}`);
  }, [settings]);

  const total   = lines.reduce((s,l) => s + lineAmt(l), 0);
  const willGoNegative = total > Number(pending.pending || 0) + 0.005;

  const setLine = (i,k,v) => setLines(ls => ls.map((l,idx) => idx===i ? { ...l, [k]:v } : l));
  const addLine = () => setLines(ls => [...ls, emptyLine()]);
  const delLine = (i) => setLines(ls => ls.length>1 ? ls.filter((_,idx)=>idx!==i) : [emptyLine()]);

  const generate = async () => {
    if (!corp) return setMsg({ ok:false, text:tc('invp.errPickCustomer', 'Pick a credit customer first.') });
    const valid = lines.filter(l => lineAmt(l) > 0);
    if (!valid.length) return setMsg({ ok:false, text:tc('invp.errAddLine', 'Add at least one line with quantity and rate.') });
    setBusy(true); setMsg(null);
    try {
      const t = +total.toFixed(2);
      const line_items = valid.map(l => ({
        vehicle_number: l.vehicle?.trim() || null,
        fuel_type:      l.fuel,
        quantity_ltrs:  parseFloat(l.qty)  || 0,
        rate_per_ltr:   parseFloat(l.rate) || 0,
        amount:         +lineAmt(l).toFixed(2),
      }));
      await api.post('/invoices', {
        station_id:   stationId,
        corporate_id: corp,
        invoice_number: invNo,
        invoice_date: invDate,
        subtotal:     t,
        cgst_rate: 0, sgst_rate: 0, cgst_amount: 0, sgst_amount: 0,
        total_amount: t,
        line_items,
        is_opening_balance: false,   // opening balances are seeded by superadmin now
      });
      const name = corps.find(c=>c.id===corp)?.company_name || tc('invp.customerFallback', 'customer');
      const suffix = tc('invp.successReduced', ' Control total reduced.');
      setMsg({ ok:true, text: tc('invp.successInvoice', '✓ Invoice {invNo} raised for {name} — ₹{amt}.')
        .replace('{invNo}', invNo).replace('{name}', name).replace('{amt}', fmt(t)) + suffix });
      setLines([emptyLine()]); setCorp('');
      load();
    } catch (e) {
      setMsg({ ok:false, text: e.response?.data?.error || e.error || tc('invp.errGeneric', 'Could not raise the invoice.') });
    }
    setBusy(false);
  };

  return (
    <AppShell>
      {/* Breadcrumb */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('invp.dashboard', 'Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('invp.creditInvoices', 'Credit Invoices')}</span>
      </div>

      {/* Control total */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',
        background:'#0f172a',color:'#fff',borderRadius:14,padding:'1rem 1.25rem',marginBottom:'1.25rem'}}>
        <div>
          <div style={{fontSize:12,opacity:.7,textTransform:'uppercase',letterSpacing:'.05em'}}>{tc('invp.creditPending', 'Credit pending invoicing')}</div>
          <div style={{fontSize:30,fontWeight:800,lineHeight:1.1,marginTop:2}}>₹{fmt(pending.pending)}</div>
          <div style={{fontSize:11.5,opacity:.6,marginTop:3}}>{tc('invp.creditPendingHint', 'Credit booked at shift close, not yet invoiced to customers. Raise invoices below until this clears.')}</div>
        </div>
        <div style={{textAlign:'right',fontSize:12,opacity:.75,lineHeight:1.7}}>
          <div>{tc('invp.booked', 'Booked')}: ₹{fmt(pending.booked)}</div>
          <div>{tc('invp.invoiced', 'Invoiced')}: ₹{fmt(pending.invoiced)}</div>
        </div>
      </div>

      {msg && (
        <div style={{borderRadius:10,padding:'10px 12px',fontSize:13,marginBottom:12,
          background: msg.ok ? '#dcfce7' : '#fee2e2', color: msg.ok ? '#166534' : '#991b1b'}}>
          {msg.text}
        </div>
      )}

      {/* Raise an invoice */}
      <div className="card" style={{marginBottom:'1.25rem'}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:'0.9rem'}}>{tc('invp.raiseInvoice', 'Raise a credit invoice')}</div>

        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 220px 160px',gap:12,marginBottom:'1rem'}}>
          <div>
            <label className="label">{tc('invp.creditCustomer', 'Credit customer *')}</label>
            <select style={inp} value={corp} onChange={e=>setCorp(e.target.value)}>
              <option value="">{tc('invp.selectCustomer', 'Select customer…')}</option>
              {corps.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{tc('invp.invoiceNo', 'Invoice no.')}</label>
            <input style={inp} value={invNo} onChange={e=>setInvNo(e.target.value)} />
          </div>
          <div>
            <label className="label">{tc('invp.date', 'Date')}</label>
            <input style={inp} type="date" value={invDate} onChange={e=>setInvDate(e.target.value)} />
          </div>
        </div>

        {/* Lines */}
        <div className="table-wrap">
          <table className="dms-table" style={{minWidth:640}}>
            <thead>
              <tr>
                <th style={{width:'30%'}}>{tc('invp.vehicleNo', 'Vehicle No.')}</th>
                <th style={{width:120}}>{tc('invp.fuel', 'Fuel')}</th>
                <th style={{width:110,textAlign:'right'}}>{tc('invp.qtyL', 'Qty (L)')}</th>
                <th style={{width:110,textAlign:'right'}}>{tc('invp.rateL', 'Rate ₹/L')}</th>
                <th style={{width:130,textAlign:'right'}}>{tc('invp.amount', 'Amount')}</th>
                <th style={{width:40}}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l,i) => (
                <tr key={i}>
                  <td><input style={{...inp,padding:'7px 9px'}} placeholder={tc('invp.vehiclePlaceholder', 'e.g. TN09AB1234')} value={l.vehicle} onChange={e=>setLine(i,'vehicle',e.target.value.toUpperCase())} /></td>
                  <td>
                    <select style={{...inp,padding:'7px 9px'}} value={l.fuel} onChange={e=>setLine(i,'fuel',e.target.value)}>
                      {FUELS.map(f => <option key={f} value={f}>{f[0].toUpperCase()+f.slice(1)}</option>)}
                    </select>
                  </td>
                  <td><input style={{...inp,padding:'7px 9px',textAlign:'right'}} type="number" step="0.001" min="0" placeholder="0" value={l.qty} onChange={e=>setLine(i,'qty',e.target.value)} /></td>
                  <td><input style={{...inp,padding:'7px 9px',textAlign:'right'}} type="number" step="0.01" min="0" placeholder="0.00" value={l.rate} onChange={e=>setLine(i,'rate',e.target.value)} /></td>
                  <td className="num" style={{fontWeight:700}}>₹{fmt(lineAmt(l))}</td>
                  <td>
                    <button onClick={()=>delLine(i)} title={tc('invp.remove', 'Remove')} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Trash2 size={15}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button onClick={addLine} style={{marginTop:10,display:'inline-flex',alignItems:'center',gap:5,background:'#f1f5f9',border:'1px solid #e2e8f0',borderRadius:8,padding:'7px 12px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
          <Plus size={14}/> {tc('invp.addLine', 'Add line')}
        </button>

        {/* Total + generate */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid #eef0f2'}}>
          <div>
            <span style={{fontSize:13,color:'var(--text-3)'}}>{tc('invp.invoiceTotal', 'Invoice total')}</span>
            <div style={{fontSize:24,fontWeight:800}}>₹{fmt(total)}</div>
            {willGoNegative && total>0 && (
              <div style={{fontSize:11.5,color:'#b45309',marginTop:2}}>{tc('invp.exceedsWarning', '⚠ Exceeds the pending control total — allowed, but it will push the balance below zero.')}</div>
            )}
          </div>
          <button onClick={generate} disabled={busy}
            style={{height:48,padding:'0 24px',background: busy?'#94a3b8':'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:busy?'default':'pointer',display:'inline-flex',alignItems:'center',gap:8}}>
            <FileText size={17}/>{busy ? tc('invp.raising', 'Raising…') : tc('invp.generateInvoice', 'Generate Invoice')}
          </button>
        </div>
      </div>

      {/* Recent invoices */}
      <div className="card">
        <div style={{fontWeight:700,fontSize:14,marginBottom:'0.75rem'}}>{tc('invp.recentInvoices', 'Recent credit invoices')}</div>
        {recent.length === 0 ? (
          <div style={{color:'var(--text-3)',fontSize:13}}>{tc('invp.noInvoices', 'No credit invoices raised yet.')}</div>
        ) : (
          <div className="table-wrap">
            <table className="dms-table">
              <thead><tr><th>{tc('invp.invoiceNoCol', 'Invoice No.')}</th><th>{tc('invp.customer', 'Customer')}</th><th>{tc('invp.date', 'Date')}</th><th style={{textAlign:'right'}}>{tc('invp.amount', 'Amount')}</th></tr></thead>
              <tbody>
                {recent.map(iv => (
                  <tr key={iv.id}>
                    <td><strong>{iv.invoice_number}</strong></td>
                    <td>{iv.company_name}</td>
                    <td>{iv.invoice_date ? String(iv.invoice_date).slice(0,10) : '—'}</td>
                    <td className="num">₹{fmt(iv.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
