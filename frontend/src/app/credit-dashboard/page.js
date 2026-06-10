
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
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <DateRangePicker
            from={dateFrom} to={dateTo}
            onChange={(f,t)=>{ setDateFrom(f); setDateTo(t); }}/>
          <button className="btn btn-secondary" onClick={exportCSV}>
            <Download size={15}/>{tc('credit_page.export_csv','Export CSV')}
          </button>
        </div>
      </div>

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
    </AppShell>
  );
}
