'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Download, Receipt } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt    = n => Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const toIST  = ts => ts ? new Date(ts).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}) : '—';
const todayIST = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const monthStart = () => { const d=new Date(); d.setDate(1); return d.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}); };

const PAYMENT_TYPES = ['cash','cheque','rtgs','upi'];

export default function ReceiptsPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [corps,    setCorps]    = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [summary,  setSummary]  = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [saved,    setSaved]    = useState('');
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo,   setDateTo]   = useState(todayIST());

  const [form, setForm] = useState({
    corporate_id:'', receipt_date:todayIST(),
    amount:'', payment_type:'cash',
    reference_no:'', invoice_id:'', remarks:'',
  });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  const load = async () => {
    if (!stationId) return;
    const [c, r] = await Promise.all([
      api.get('/corporate',{params:{station_id:stationId}}),
      api.get('/receipts',{params:{station_id:stationId,limit:100}}),
    ]);
    setCorps(Array.isArray(c)?c:[]);
    setReceipts(Array.isArray(r)?r:[]);
  };

  useEffect(()=>{ load(); },[stationId]);
  useRefreshOnFocus(load);

  // When customer changes, load their invoices and summary
  useEffect(()=>{
    if (!form.corporate_id || !stationId) { setInvoices([]); setSummary(null); return; }
    Promise.all([
      api.get(`/invoices`,{params:{corporate_id:form.corporate_id,station_id:stationId,status:'unpaid'}}).catch(()=>[]),
      api.get(`/receipts/summary/${form.corporate_id}`,{params:{station_id:stationId}}).catch(()=>null),
    ]).then(([inv,sum])=>{ setInvoices(Array.isArray(inv)?inv:[]); setSummary(sum); });
  },[form.corporate_id, stationId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.corporate_id) { alert(tc('rec_page.err_customer','Select a credit customer')); return; }
    if (!form.amount || parseFloat(form.amount)<=0) { alert(tc('rec_page.err_amount','Enter a valid amount')); return; }
    if (!form.payment_type) { alert(tc('rec_page.err_payment','Select a payment mode')); return; }
    setLoading(true);
    try {
      await api.post('/receipts',{
        ...form,
        station_id: stationId,
        amount: parseFloat(form.amount),
        invoice_id: form.invoice_id||null,
        recorded_by: user?.id,
      });
      setSaved(tc('rec_page.saved_ok','Receipt recorded ✓'));
      setTimeout(()=>setSaved(''),3000);
      setShowForm(false);
      setForm({corporate_id:'',receipt_date:todayIST(),amount:'',payment_type:'cash',reference_no:'',invoice_id:'',remarks:''});
      load();
    } catch(err) { alert(err.error||tc('rec_page.failed','Failed to record receipt')); }
    finally { setLoading(false); }
  };

  const filteredReceipts = receipts.filter(r=>{
    const d = r.receipt_date||r.created_at?.slice(0,10)||'';
    return d>=dateFrom && d<=dateTo;
  });
  const periodTotal = filteredReceipts.reduce((s,r)=>s+parseFloat(r.amount||0),0);

  const ptLabel = {
    cash:  tc('rec_page.cash','Cash'),
    cheque:tc('rec_page.cheque','Cheque'),
    rtgs:  tc('rec_page.rtgs','RTGS / NEFT'),
    upi:   tc('rec_page.upi','UPI'),
  };

  const exportCSV = () => {
    const csv = [tc('rec_page.date','Date')+','+tc('rec_page.customer','Customer')+','+tc('rec_page.amount','Amount')+','+tc('rec_page.payment_type','Payment Type')+','+tc('rec_page.reference','Reference')].join('')+'\n'+
      filteredReceipts.map(r=>[toIST(r.receipt_date),r.company_name,fmt(r.amount),r.payment_type,r.reference_no||''].join(',')).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`receipts-${dateFrom}-${dateTo}.csv`; a.click();
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('rec_page.title','Credit Receipts')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>{tc('rec_page.subtitle','Record payments received from credit customers')}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {saved && <div className="badge badge-success" style={{padding:'6px 12px'}}>✓ {saved}</div>}
          <button className="btn btn-secondary" onClick={exportCSV}><Download size={15}/>{tc('rec_page.export_csv','Export CSV')}</button>
          <button className="btn btn-primary" onClick={()=>setShowForm(true)}><Plus size={16}/>{tc('rec_page.record_receipt','Record Receipt')}</button>
        </div>
      </div>

      {/* Date filter + KPIs */}
      <div style={{display:'flex',gap:10,marginBottom:'1.5rem',flexWrap:'wrap',alignItems:'flex-end'}}>
        <div>
          <label className="label">{tc('common.from','From')}</label>
          <input className="input" type="date" value={dateFrom} style={{width:160}} onChange={e=>setDateFrom(e.target.value)}/>
        </div>
        <div>
          <label className="label">{tc('common.to','To')}</label>
          <input className="input" type="date" value={dateTo} style={{width:160}} onChange={e=>setDateTo(e.target.value)}/>
        </div>
      </div>

      <div className="grid-3" style={{marginBottom:'1.5rem'}}>
        <div className="stat-card">
          <div className="stat-label">{tc('rec_page.total_received','Total Received')}</div>
          <div className="stat-value amount">{fmt(periodTotal)}</div>
          <div className="stat-sub">{filteredReceipts.length} {tc('rec_page.receipts_count','receipts')} · {tc('rec_page.period','this period')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('rec_page.outstanding_now','Outstanding Now')}</div>
          <div className="stat-value" style={{color:'var(--danger)',fontSize:'1.25rem'}}>
            {fmt(corps.reduce((s,c)=>s+parseFloat(c.current_outstanding||0),0))}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('common.customers','Customers')}</div>
          <div className="stat-value" style={{color:'var(--petrol)'}}>{corps.length}</div>
        </div>
      </div>

      {/* Receipt table */}
      <div className="card">
        <div style={{fontWeight:600,fontSize:14,marginBottom:'0.75rem'}}>{tc('rec_page.receipt_register','Receipt Register')}</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('rec_page.date','Date')}</th>
                <th>{tc('rec_page.customer','Customer')}</th>
                <th>{tc('rec_page.amount','Amount')}</th>
                <th>{tc('rec_page.payment_type','Payment Type')}</th>
                <th>{tc('rec_page.reference','Reference')}</th>
                <th>{tc('rec_page.invoice','Invoice')}</th>
                <th>{tc('rec_page.recorded_by','Recorded By')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReceipts.length===0 && (
                <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-3)',padding:'3rem'}}>
                  <Receipt size={32} style={{margin:'0 auto 8px',opacity:.3}}/>
                  <div>{tc('rec_page.no_receipts','No receipts recorded yet')}</div>
                </td></tr>
              )}
              {filteredReceipts.map(r=>(
                <tr key={r.id}>
                  <td style={{fontSize:12,whiteSpace:'nowrap'}}>{toIST(r.receipt_date)}</td>
                  <td style={{fontWeight:600}}>{r.company_name}</td>
                  <td className="num" style={{fontWeight:700,color:'var(--success)'}}>₹{fmt(r.amount)}</td>
                  <td><span className="badge badge-info" style={{fontSize:11}}>{ptLabel[r.payment_type]||r.payment_type}</span></td>
                  <td style={{fontSize:12,fontFamily:'var(--font-mono)'}}>{r.reference_no||'—'}</td>
                  <td style={{fontSize:12}}>{r.invoice_number||tc('rec_page.on_account','On Account')}</td>
                  <td style={{fontSize:12,color:'var(--text-3)'}}>{r.recorded_by_name||'—'}</td>
                </tr>
              ))}
            </tbody>
            {filteredReceipts.length>0 && (
              <tfoot>
                <tr style={{background:'var(--surface-2)',fontWeight:700}}>
                  <td colSpan={2} style={{padding:'10px 14px'}}>{tc('common.total','Total')}</td>
                  <td className="num" style={{padding:'10px 14px',color:'var(--success)'}}>₹{fmt(periodTotal)}</td>
                  <td colSpan={4} style={{padding:'10px 14px'}}/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal: Record receipt */}
      {showForm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:100,overflowY:'auto',padding:'1.5rem 1rem'}}>
          <div className="card" style={{width:'100%',maxWidth:620}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:'1.25rem'}}>{tc('rec_page.new_receipt','Record New Receipt')}</div>

            <form onSubmit={handleSubmit}>
              {/* Customer */}
              <div style={{marginBottom:'1rem'}}>
                <label className="label">{tc('rec_page.credit_customer','Credit Customer *')}</label>
                <select className="input" value={form.corporate_id} onChange={e=>f('corporate_id',e.target.value)} required>
                  <option value="">{tc('rec_page.select_customer','Select credit customer...')}</option>
                  {corps.map(c=>(
                    <option key={c.id} value={c.id}>
                      {c.company_name} — {tc('rec_page.outstanding_now','Outstanding')}: ₹{fmt(c.current_outstanding)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Account summary strip */}
              {summary && (
                <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:'1rem',padding:'0.75rem',background:'var(--surface-2)',borderRadius:8,fontSize:12}}>
                  {[
                    [tc('rec_page.credit_limit','Credit Limit'), fmt(summary.credit_limit), 'var(--text-1)'],
                    [tc('rec_page.total_sales','Total Sales'),   fmt(summary.total_sales),   'var(--text-1)'],
                    [tc('rec_page.total_receipts','Total Receipts'), fmt(summary.total_receipts), 'var(--success)'],
                    [tc('rec_page.net_outstanding','Net Outstanding'), fmt(summary.outstanding), summary.outstanding>summary.credit_limit*0.8?'var(--danger)':'var(--brand)'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:'center'}}>
                      <div style={{color:'var(--text-3)',marginBottom:2}}>{l}</div>
                      <div style={{fontWeight:700,fontFamily:'var(--font-mono)',color:c}}>₹{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Date + Amount */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:'1rem'}}>
                <div>
                  <label className="label">{tc('rec_page.receipt_date','Receipt Date *')}</label>
                  <input className="input" type="date" value={form.receipt_date} onChange={e=>f('receipt_date',e.target.value)} required/>
                </div>
                <div>
                  <label className="label">{tc('rec_page.receipt_amount','Amount Received (₹) *')}</label>
                  <input className="input" type="number" step="0.01" min="0.01" placeholder="0.00"
                    value={form.amount} onChange={e=>f('amount',e.target.value)} required/>
                </div>
              </div>

              {/* Payment type */}
              <div style={{marginBottom:'1rem'}}>
                <label className="label">{tc('rec_page.payment_mode','Payment Mode *')}</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {PAYMENT_TYPES.map(pt=>(
                    <button key={pt} type="button"
                      className={`btn btn-sm ${form.payment_type===pt?'btn-primary':'btn-secondary'}`}
                      onClick={()=>f('payment_type',pt)}>
                      {ptLabel[pt]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference number (conditional) */}
              {['cheque','rtgs','upi'].includes(form.payment_type) && (
                <div style={{marginBottom:'1rem'}}>
                  <label className="label">{tc('rec_page.reference_no','Reference No.')}</label>
                  <input className="input"
                    placeholder={form.payment_type==='cheque'?tc('rec_page.cheque_ph','Cheque number'):form.payment_type==='upi'?tc('rec_page.upi_ph','UPI transaction ID'):tc('rec_page.rtgs_ph','UTR number')}
                    value={form.reference_no} onChange={e=>f('reference_no',e.target.value)}/>
                </div>
              )}

              {/* Against invoice */}
              {invoices.length>0 && (
                <div style={{marginBottom:'1rem'}}>
                  <label className="label">{tc('rec_page.against_invoice','Against Invoice (optional)')}</label>
                  <select className="input" value={form.invoice_id} onChange={e=>f('invoice_id',e.target.value)}>
                    <option value="">{tc('rec_page.select_invoice','On account (no specific invoice)')}</option>
                    {invoices.map(inv=>(
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} — ₹{fmt(inv.total_amount)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Remarks */}
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">{tc('rec_page.remarks','Remarks (optional)')}</label>
                <textarea className="input" rows={2} placeholder={tc('rec_page.remarks_ph','Any notes about this payment...')}
                  value={form.remarks} onChange={e=>f('remarks',e.target.value)}/>
              </div>

              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary btn-lg" type="submit" style={{flex:1,justifyContent:'center'}} disabled={loading}>
                  {loading?tc('rec_page.saving','Saving...'):tc('rec_page.save_receipt','✓ Save Receipt')}
                </button>
                <button className="btn btn-secondary" type="button" onClick={()=>setShowForm(false)}>
                  {tc('common.cancel','Cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
