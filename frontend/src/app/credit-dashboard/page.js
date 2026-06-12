
'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import DateRangePicker from '../../components/shared/DateRangePicker';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt   = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const fmtL  = n => Number(n||0).toFixed(2);
const toIST = ts => ts ? new Date(ts).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',
  day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
const todayIST = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const monthStart = () => {
  const d = new Date(); d.setDate(1);
  return d.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
};

export default function CreditDashboardPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  // Allow owner to view any corp via ?corp_id= query param
  const [corpId, setCorpId] = useState(null);
  const [corp,    setCorp]    = useState(null);
  const [txns,    setTxns]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom,setDateFrom]= useState(monthStart());
  const [dateTo,  setDateTo]  = useState(todayIST());

  // Read corp_id from URL on mount
  useEffect(()=>{
    if(typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const cid = params.get('corp_id');
      if(cid) setCorpId(cid);
    }
  },[]);

  const effectiveCorpId = corpId || user?.corporate_id;

  const load = async() => {
    if(!effectiveCorpId){ setLoading(false); return; }
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get(`/corporate/${effectiveCorpId}`),
        api.get(`/corporate/${effectiveCorpId}/statement`, {
          params: {
            station_id: stationId,
            date_from:  dateFrom,
            date_to:    dateTo,
          }
        }),
      ]);
      setCorp(c);
      setTxns(s?.transactions||[]);
    } finally { setLoading(false); }
  };

  useEffect(()=>{ load(); },[effectiveCorpId, stationId, dateFrom, dateTo]);
  useRefreshOnFocus(load);

  // ── Consolidated view: all my bunks, grouped by PAN (customer only) ──
  const [view, setView]                 = useState('single'); // 'single' | 'consolidated'
  const [consol, setConsol]             = useState(null);
  const [consolLoading, setConsolLoading] = useState(false);
  const isCustomer = !corpId && user?.role === 'corporate';

  // ── Self-service documents: statement / ageing / invoice copies ──
  const [tab, setTab]             = useState('overview');
  const [stmt, setStmt]           = useState(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [myAgeing, setMyAgeing]   = useState(null);
  const [invoices, setInvoices]   = useState(null);
  // Staff (owner "view as") must name the account; customers get their own.
  const staffParams = user?.role !== 'corporate' ? { corporate_id: effectiveCorpId } : {};

  const loadStmt = async () => {
    if (!effectiveCorpId) return;
    setStmtLoading(true);
    try {
      const s = await api.get(`/credit-reports/statement/${effectiveCorpId}`, {
        params: { date_from: dateFrom, date_to: dateTo },
      });
      setStmt(s);
    } catch (e) { console.error(e); }
    finally { setStmtLoading(false); }
  };

  useEffect(() => {
    if (!effectiveCorpId) return;
    if (tab === 'statement') loadStmt();
    if (tab === 'ageing' && !myAgeing)
      api.get('/credit-reports/my-ageing', { params: staffParams }).then(setMyAgeing).catch(console.error);
    if (tab === 'invoices' && !invoices)
      api.get('/credit-reports/my-invoices', { params: staffParams }).then(setInvoices).catch(console.error);
  }, [tab, effectiveCorpId, dateFrom, dateTo]); // eslint-disable-line

  // Invoice copy: render a minimal printable document in a new window
  const printInvoice = (inv, kind) => {
    let items = kind === 'lube' ? (inv.items || [])
      : (Array.isArray(inv.line_items) ? inv.line_items : (() => { try { return JSON.parse(inv.line_items || '[]'); } catch { return []; } })());
    const rowsHtml = kind === 'lube'
      ? items.map(i => `<tr><td>${i.name || ''}</td><td class="r">${i.qty} ${i.unit || ''}</td><td class="r">₹${fmt(i.unit_price)}</td><td class="r">${i.gst_rate}%</td><td class="r">₹${fmt(i.total)}</td></tr>`).join('')
      : items.map(i => `<tr><td>${i.occurred_at ? toIST(i.occurred_at) : ''}</td><td>${i.vehicle_number || '—'}</td><td>${i.fuel_type || ''}</td><td class="r">${fmtL(i.quantity_ltrs)}</td><td class="r">₹${fmt(i.rate_per_ltr)}</td><td class="r">₹${fmt(i.amount)}</td></tr>`).join('');
    const headHtml = kind === 'lube'
      ? '<tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr>'
      : '<tr><th>Date</th><th>Vehicle</th><th>Fuel</th><th class="r">Qty (L)</th><th class="r">Rate/L</th><th class="r">Amount</th></tr>';
    const total = kind === 'lube' ? inv.grand_total : inv.total_amount;
    const gst = kind === 'lube'
      ? `CGST ₹${fmt(inv.total_cgst)} · SGST ₹${fmt(inv.total_sgst)}`
      : `CGST ₹${fmt(inv.cgst_amount)} · SGST ₹${fmt(inv.sgst_amount)}`;
    const w = window.open('', '_blank');
    if (!w) return alert('Allow pop-ups to print the invoice copy.');
    w.document.write(`<!doctype html><html><head><title>${inv.invoice_number}</title><style>
      body{font-family:system-ui,sans-serif;margin:24px;color:#111}
      h2{margin:0} .muted{color:#666;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left} .r{text-align:right}
      .tot{margin-top:12px;text-align:right;font-size:15px}
    </style></head><body>
      <h2>${inv.station_name || ''}</h2>
      <div class="muted">Invoice <b>${inv.invoice_number}</b> · ${toIST(inv.invoice_date || inv.created_at)}
        ${kind === 'fuel' && inv.period_from ? ` · Period ${inv.period_from} – ${inv.period_to}` : ''}</div>
      <div class="muted">${tc('credit_page.bill_to', 'Bill to')}: <b>${corp?.company_name || inv.customer_name || ''}</b></div>
      <table><thead>${headHtml}</thead><tbody>${rowsHtml}</tbody></table>
      <div class="tot">${gst}<br/><b>Total: ₹${fmt(total)}</b></div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  useEffect(()=>{
    if (view !== 'consolidated' || consol) return;
    setConsolLoading(true);
    api.get('/dashboard/my-consolidated')
      .then(setConsol)
      .catch(()=>setConsol({ error:true }))
      .finally(()=>setConsolLoading(false));
  },[view]); // eslint-disable-line
  
  const exportCSV = () => {
    const csv = ['Date,Vehicle,Fuel Type,Qty (L),Rate,Amount'].join(',')+'\n'+
      txns.map(t=>[toIST(t.occurred_at),t.vehicle_number,t.fuel_type,
        fmtL(t.quantity_ltrs),fmt(t.rate_per_ltr),fmt(t.amount)].join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `${corp?.company_name||'statement'}-${dateFrom}-${dateTo}.csv`;
    a.click();
  };

  if (loading) return (
    <AppShell>
      <div style={{padding:'3rem',textAlign:'center',color:'var(--text-3)'}}>{tc('credit_page.loading','Loading...')}</div>
    </AppShell>
  );

  if (!effectiveCorpId || !corp) return (
    <AppShell>
      <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>
        {tc('credit_page.no_account','No credit account linked to your profile.')}<br/>
        {tc('credit_page.contact_mgr','Please contact the station manager.')}
      </div>
    </AppShell>
  );

  const toggle = isCustomer ? (
    <div style={{display:'flex',gap:6,marginBottom:'1rem'}}>
      {[['single','This Bunk'],['consolidated','🏢 All My Bunks']].map(([id,label])=>(
        <button key={id} onClick={()=>setView(id)}
          style={{padding:'7px 14px',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13,
            border:'1.5px solid '+(view===id?'#FF6B00':'var(--border)'),
            background:view===id?'#fff7ed':'#fff',color:view===id?'#9a3412':'var(--text-2)'}}>{label}</button>
      ))}
    </div>
  ) : null;

  if (view === 'consolidated') {
    const c = consol || {};
    const T = c.totals || {};
    return (
      <AppShell>
        {toggle}
        <div className="page-header">
          <div>
            <h1 className="page-title">{c.company_name || corp.company_name}</h1>
            <div style={{fontSize:13,color:'var(--text-3)'}}>
              Consolidated across all your bunks{c.pan ? ` · PAN ${c.pan}` : ''}
            </div>
          </div>
        </div>

        {consolLoading && <div className="card" style={{textAlign:'center',padding:'2rem',color:'var(--text-3)'}}>Loading…</div>}
        {!consolLoading && c.error && <div className="card" style={{padding:'1.5rem',color:'var(--danger)'}}>Could not load the consolidated view.</div>}
        {!consolLoading && !c.error && (
          <>
            <div className="grid-3 stack-mobile" style={{marginBottom:'1.5rem'}}>
              <div className="stat-card"><div className="stat-label">Total Outstanding</div><div className="stat-value amount">₹{fmt(T.total_outstanding)}</div></div>
              <div className="stat-card"><div className="stat-label">Total Purchases</div><div className="stat-value">₹{fmt(T.total_purchases)}</div></div>
              <div className="stat-card"><div className="stat-label">Total Paid</div><div className="stat-value" style={{color:'var(--success)'}}>₹{fmt(T.total_paid)}</div></div>
            </div>

            <div className="card" style={{marginBottom:'1.5rem'}}>
              <div style={{fontWeight:600,fontSize:14,marginBottom:'0.75rem'}}>Your Bunks ({(c.profiles||[]).length})</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {(c.profiles||[]).map(p=>(
                  <div key={p.id} style={{background:'var(--surface-2)',borderRadius:8,padding:'0.75rem 1rem',minWidth:180}}>
                    <div style={{fontWeight:700,fontSize:13}}>{p.station_name||'—'}</div>
                    <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{p.company_name}</div>
                    <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--brand)',marginTop:4}}>
                      ₹{fmt(p.current_outstanding)} <span style={{fontSize:11,color:'var(--text-3)',fontWeight:400}}>outstanding</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>All Transactions</div>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead><tr><th>Date</th><th>Bunk</th><th>Type</th><th>Details</th><th>Debit</th><th>Credit</th></tr></thead>
                  <tbody>
                    {(c.ledger||[]).length===0 && <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>No transactions</td></tr>}
                    {(c.ledger||[]).map((r,i)=>(
                      <tr key={i}>
                        <td style={{fontSize:12}}>{toIST(r.date)}</td>
                        <td style={{fontSize:12.5}}>{r.station_name||'—'}</td>
                        <td><span className="badge badge-gray" style={{textTransform:'capitalize'}}>{(r.type||'').replace('_',' ')}</span></td>
                        <td style={{fontSize:12.5}}>{r.description}</td>
                        <td className="num" style={{color:'var(--danger)'}}>{r.debit?`₹${fmt(r.debit)}`:'—'}</td>
                        <td className="num" style={{color:'var(--success)'}}>{r.credit?`₹${fmt(r.credit)}`:'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </AppShell>
    );
  }

  const totalAmount = txns.reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const totalLitres = txns.reduce((s,t)=>s+parseFloat(t.quantity_ltrs||0),0);
  const vehicles    = [...new Set(txns.map(t=>t.vehicle_number).filter(Boolean))];
  const pct = corp.credit_limit>0
    ? Math.round((corp.current_outstanding/corp.credit_limit)*100) : 0;

  return (
    <AppShell>
      {toggle}
      {corpId && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:8,
          padding:'8px 16px',marginBottom:'1rem',fontSize:13,color:'#9a3412',
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>{tc('credit_page.viewing_as','👁 Viewing as owner —')} {corp?.company_name}{tc('credit_page.credit_account',"'s credit account")}</span>
          <button style={{background:'none',border:'none',cursor:'pointer',
            color:'#9a3412',fontWeight:600,fontSize:12}}
            onClick={()=>window.history.back()}>{tc('credit_page.back','← Back')}</button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">{corp.company_name}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>{tc('credit_page.subtitle','Credit Account Dashboard')}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}} className="no-print">
          {['overview','statement'].includes(tab) && (
            <DateRangePicker
              from={dateFrom} to={dateTo}
              onChange={(f,t)=>{ setDateFrom(f); setDateTo(t); }}/>
          )}
          {tab==='overview' && (
            <button className="btn btn-secondary" onClick={exportCSV}>
              <Download size={15}/>{tc('credit_page.export_csv','Export CSV')}
            </button>
          )}
        </div>
      </div>

      {/* Self-service tabs: the documents a credit customer needs without calling the bunk */}
      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}} className="no-print">
        {[
          ['overview',  tc('credit_page.tab_overview','Overview')],
          ['statement', tc('credit_page.tab_statement','Statement')],
          ['ageing',    tc('credit_page.tab_ageing','My Dues by Age')],
          ['invoices',  tc('credit_page.tab_invoices','Invoices')],
        ].map(([id,label])=>(
          <button key={id} className={`btn ${tab===id?'btn-primary':'btn-secondary'} btn-sm`} onClick={()=>setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab==='overview' && (<>
      {/* Credit utilisation */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:'1rem'}}>{tc('credit_page.credit_util','Credit Utilisation')}</div>
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1rem',marginBottom:'1rem'}}>
          {[
            [tc('credit_page.credit_limit','Credit Limit'),  `₹${fmt(corp.credit_limit)}`,                                      '#1A5F7A'],
            [tc('credit_page.outstanding','Outstanding'),   `₹${fmt(corp.current_outstanding)}`,   pct>80?'var(--danger)':'var(--brand)'],
            [tc('credit_page.available','Available'),     `₹${fmt((corp.credit_limit||0)-(corp.current_outstanding||0))}`,    'var(--success)'],
            [tc('credit_page.payment_terms','Payment Terms'), `${corp.payment_terms||30} ${tc('credit_page.days','days')}`,                                   'var(--text-1)'],
          ].map(([l,v,c])=>(
            <div key={l} style={{background:'var(--surface-2)',borderRadius:8,padding:'0.75rem'}}>
              <div style={{fontSize:11,color:'var(--text-3)',textTransform:'uppercase',marginBottom:3}}>{l}</div>
              <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:16,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div className="tank-bar" style={{height:10}}>
          <div className="tank-bar-fill" style={{width:`${Math.min(100,pct)}%`,height:10,
            background:pct>80?'var(--danger)':pct>60?'var(--warning)':'var(--brand)'}}/>
        </div>
        <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>
          {pct}% {tc('credit_page.utilised','utilised')} · {pct>80?tc('credit_page.near_limit','⚠ Near limit'):tc('credit_page.within_limit','✓ Within limit')}
        </div>
      </div>

      {/* Period summary */}
      <div className="grid-3" style={{marginBottom:'1.5rem'}}>
        <div className="stat-card">
          <div className="stat-label">{tc('credit_page.transactions','Transactions')}</div>
          <div className="stat-value">{txns.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('credit_page.total_amount','Total Amount')}</div>
          <div className="stat-value amount">{fmt(totalAmount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('credit_page.total_litres','Total Litres')}</div>
          <div className="stat-value" style={{color:'var(--petrol)'}}>{fmtL(totalLitres)} L</div>
        </div>
      </div>

      {/* Vehicle breakdown */}
      {vehicles.length>0 && (
        <div className="card" style={{marginBottom:'1.5rem'}}>
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>
            {tc('credit_page.vehicle_summary','Vehicle-wise Summary')}
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {vehicles.map(v=>{
              const vt = txns.filter(t=>t.vehicle_number===v);
              const va = vt.reduce((s,t)=>s+parseFloat(t.amount||0),0);
              const vl = vt.reduce((s,t)=>s+parseFloat(t.quantity_ltrs||0),0);
              return (
                <div key={v} style={{background:'var(--surface-2)',borderRadius:8,
                  padding:'0.75rem 1rem',minWidth:160}}>
                  <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:13}}>{v}</div>
                  <div style={{fontSize:12,color:'var(--text-2)',marginTop:2}}>
                    {vt.length} {tc('credit_page.fills','fills')} · {fmtL(vl)} L
                  </div>
                  <div style={{fontFamily:'var(--font-mono)',fontWeight:700,
                    color:'var(--brand)',marginTop:2}}>₹{fmt(va)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transaction table */}
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14,
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>{tc('credit_page.transactions','Transactions')}</span>
          <span style={{fontSize:12,color:'var(--text-3)'}}>
            {dateFrom===dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
          </span>
        </div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('credit_page.date_time','Date & Time')}</th><th>{tc('credit_page.vehicle','Vehicle')}</th>
                <th>{tc('credit_page.fuel','Fuel')}</th><th>{tc('credit_page.qty_l','Qty (L)')}</th>
                <th>{tc('credit_page.rate_l','Rate/L')}</th><th>{tc('credit_page.amount','Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {txns.length===0 && (
                <tr><td colSpan={6} style={{textAlign:'center',
                  color:'var(--text-3)',padding:'2rem'}}>
                  {tc('credit_page.no_txns','No transactions for selected period')}
                </td></tr>
              )}
              {txns.map(t=>(
                <tr key={t.id}>
                  <td style={{fontSize:12}}>{toIST(t.occurred_at)}</td>
                  <td style={{fontFamily:'var(--font-mono)',fontWeight:600}}>
                    {t.vehicle_number||'—'}
                  </td>
                  <td>
                    <span className={`fuel-chip fuel-${t.fuel_type}`}>{t.fuel_type}</span>
                  </td>
                  <td className="num">{fmtL(t.quantity_ltrs)}</td>
                  <td className="num">₹{fmt(t.rate_per_ltr)}</td>
                  <td className="num" style={{fontWeight:600}}>₹{fmt(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {/* ── Statement of account: running balance incl. payments & credit notes ── */}
      {tab==='statement' && (
        <div className="card">
          {stmtLoading && <div style={{textAlign:'center',padding:'2rem',color:'var(--text-3)'}}>{tc('credit_page.loading','Loading...')}</div>}
          {!stmtLoading && stmt && (<>
            <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:'1rem',paddingBottom:'0.75rem',borderBottom:'1px solid var(--border)'}}>
              <div>
                <div style={{fontWeight:800,fontSize:16}}>{tc('credit_page.stmt_title','Statement of Account')}</div>
                <div style={{fontSize:12,color:'var(--text-3)'}}>{corp.company_name} · {dateFrom} – {dateTo}</div>
              </div>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:11,color:'var(--text-3)',fontWeight:600,textTransform:'uppercase'}}>{tc('credit_page.closing_balance','Closing balance')}</div>
                  <div style={{fontSize:22,fontWeight:900,color:stmt.closing_balance>0?'var(--danger)':'var(--success)'}}>₹{fmt(stmt.closing_balance)}</div>
                </div>
                <button className="btn btn-secondary btn-sm no-print" onClick={()=>window.print()}>{tc('credit_page.print','Print')}</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead><tr>
                  <th>{tc('credit_page.date','Date')}</th><th>{tc('credit_page.bunk','Bunk')}</th>
                  <th>{tc('credit_page.particulars','Particulars')}</th>
                  <th>{tc('credit_page.debit','Debit')}</th><th>{tc('credit_page.credit','Credit')}</th>
                  <th>{tc('credit_page.balance','Balance')}</th>
                </tr></thead>
                <tbody>
                  <tr style={{background:'var(--surface-2)'}}>
                    <td></td><td></td>
                    <td style={{fontWeight:700}}>{tc('credit_page.opening_balance','Opening balance')}</td>
                    <td></td><td></td>
                    <td className="num" style={{fontWeight:700}}>₹{fmt(stmt.opening_balance)}</td>
                  </tr>
                  {stmt.lines.length===0 && (
                    <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-3)',padding:'1.5rem'}}>{tc('credit_page.no_txns','No transactions for selected period')}</td></tr>
                  )}
                  {stmt.lines.map((l,i)=>(
                    <tr key={i}>
                      <td style={{fontSize:12,whiteSpace:'nowrap'}}>{new Date(l.date).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short'})}</td>
                      <td style={{fontSize:12}}>{l.station_name||'—'}</td>
                      <td style={{fontSize:13}}>
                        <span className={`badge ${l.type==='payment'?'badge-success':l.type==='credit_note'?'badge-info':'badge-gray'}`} style={{marginRight:6,textTransform:'capitalize'}}>{(l.type||'').replace('_',' ')}</span>
                        {l.description}{l.ref?` · ${l.ref}`:''}
                      </td>
                      <td className="num">{l.debit>0?`₹${fmt(l.debit)}`:'—'}</td>
                      <td className="num" style={{color:l.credit>0?'var(--success)':undefined}}>{l.credit>0?`₹${fmt(l.credit)}`:'—'}</td>
                      <td className="num" style={{fontWeight:600}}>₹{fmt(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>)}
        </div>
      )}

      {/* ── My dues by age ── */}
      {tab==='ageing' && (
        <>
          {!myAgeing && <div className="card" style={{textAlign:'center',padding:'2rem',color:'var(--text-3)'}}>{tc('credit_page.loading','Loading...')}</div>}
          {myAgeing && (<>
            <div className="grid-4" style={{marginBottom:'1.5rem'}}>
              {[
                [tc('credit_page.total_due','Total due'), myAgeing.totals.outstanding, 'var(--brand)'],
                ['0–30', myAgeing.totals.b0_30, 'var(--text-1)'],
                ['31–60 / 61–90', myAgeing.totals.b31_60 + myAgeing.totals.b61_90, 'var(--warning)'],
                ['90+', myAgeing.totals.b90_plus, 'var(--danger)'],
              ].map(([l,v,c])=>(
                <div key={l} className="stat-card">
                  <div className="stat-label">{l}</div>
                  <div className="stat-value" style={{fontSize:'1.25rem',color:c}}>₹{fmt(v)}</div>
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{fontWeight:600,fontSize:14,marginBottom:'0.75rem'}}>{tc('credit_page.ageing_title','Outstanding by age, per bunk')}</div>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead><tr>
                    <th>{tc('credit_page.bunk','Bunk')}</th><th>{tc('credit_page.outstanding','Outstanding')}</th>
                    <th>0–30</th><th>31–60</th><th>61–90</th><th>90+</th>
                    <th>{tc('credit_page.oldest','Oldest')}</th>
                  </tr></thead>
                  <tbody>
                    {myAgeing.rows.length===0 && (
                      <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>{tc('credit_page.all_clear','No dues — account fully settled ✓')}</td></tr>
                    )}
                    {myAgeing.rows.map(r=>(
                      <tr key={r.station_id} style={r.b90_plus>0?{background:'rgba(239,68,68,.05)'}:undefined}>
                        <td style={{fontWeight:600}}>{r.station_name}
                          {r.unapplied_credit>0 && <span style={{fontSize:11,color:'var(--success)',marginLeft:6}}>{tc('credit_page.advance','Advance')} ₹{fmt(r.unapplied_credit)}</span>}
                        </td>
                        <td className="num" style={{fontWeight:700}}>{r.outstanding>0?`₹${fmt(r.outstanding)}`:<span style={{color:'var(--success)'}}>✓</span>}</td>
                        {[r.b0_30,r.b31_60,r.b61_90,r.b90_plus].map((v,i)=>(
                          <td key={i} className="num" style={v>0&&i===3?{color:'var(--danger)',fontWeight:700}:v>0?{fontWeight:600}:{color:'var(--text-3)'}}>{v>0?`₹${fmt(v)}`:'—'}</td>
                        ))}
                        <td style={{fontSize:12,color:r.oldest_days>90?'var(--danger)':'var(--text-2)'}}>{r.oldest_days!=null?`${r.oldest_days} ${tc('credit_page.days','days')}`:'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{fontSize:11.5,color:'var(--text-3)',marginTop:8}}>
                {tc('credit_page.ageing_note','Payments are adjusted against the oldest dues first.')}
              </div>
            </div>
          </>)}
        </>
      )}

      {/* ── Invoice copies ── */}
      {tab==='invoices' && (
        <>
          {!invoices && <div className="card" style={{textAlign:'center',padding:'2rem',color:'var(--text-3)'}}>{tc('credit_page.loading','Loading...')}</div>}
          {invoices && (<>
            <div className="card" style={{marginBottom:'1.5rem'}}>
              <div style={{fontWeight:600,fontSize:14,marginBottom:'0.75rem'}}>{tc('credit_page.fuel_invoices','Fuel Invoices (GST)')}</div>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead><tr>
                    <th>{tc('credit_page.invoice_no','Invoice #')}</th><th>{tc('credit_page.date','Date')}</th>
                    <th>{tc('credit_page.bunk','Bunk')}</th><th>{tc('credit_page.period','Period')}</th>
                    <th>{tc('credit_page.amount','Amount')}</th><th></th>
                  </tr></thead>
                  <tbody>
                    {invoices.fuel.length===0 && (
                      <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-3)',padding:'1.5rem'}}>{tc('credit_page.no_invoices','No invoices yet')}</td></tr>
                    )}
                    {invoices.fuel.map(inv=>(
                      <tr key={inv.id}>
                        <td style={{fontFamily:'var(--font-mono)',fontWeight:600}}>{inv.invoice_number}</td>
                        <td style={{fontSize:12}}>{new Date(inv.invoice_date||inv.created_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'})}</td>
                        <td style={{fontSize:12}}>{inv.station_name||'—'}</td>
                        <td style={{fontSize:12}}>{inv.period_from?`${inv.period_from} – ${inv.period_to}`:'—'}</td>
                        <td className="num" style={{fontWeight:700}}>₹{fmt(inv.total_amount)}</td>
                        <td><button className="btn btn-secondary btn-sm" onClick={()=>printInvoice(inv,'fuel')}>{tc('credit_page.view_print','View / Print')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div style={{fontWeight:600,fontSize:14,marginBottom:'0.75rem'}}>{tc('credit_page.lube_invoices','Lubes / Shop Invoices')}</div>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead><tr>
                    <th>{tc('credit_page.invoice_no','Invoice #')}</th><th>{tc('credit_page.date','Date')}</th>
                    <th>{tc('credit_page.bunk','Bunk')}</th><th>{tc('credit_page.items','Items')}</th>
                    <th>{tc('credit_page.amount','Amount')}</th><th></th>
                  </tr></thead>
                  <tbody>
                    {invoices.lube.length===0 && (
                      <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-3)',padding:'1.5rem'}}>{tc('credit_page.no_invoices','No invoices yet')}</td></tr>
                    )}
                    {invoices.lube.map(inv=>(
                      <tr key={inv.id}>
                        <td style={{fontFamily:'var(--font-mono)',fontWeight:600}}>{inv.invoice_number}</td>
                        <td style={{fontSize:12}}>{new Date(inv.invoice_date||inv.created_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'})}</td>
                        <td style={{fontSize:12}}>{inv.station_name||'—'}</td>
                        <td style={{fontSize:12}}>{(inv.items||[]).length}</td>
                        <td className="num" style={{fontWeight:700}}>₹{fmt(inv.grand_total)}</td>
                        <td><button className="btn btn-secondary btn-sm" onClick={()=>printInvoice(inv,'lube')}>{tc('credit_page.view_print','View / Print')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}
        </>
      )}
    </AppShell>
  );
}
