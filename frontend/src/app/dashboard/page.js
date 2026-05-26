'use client';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, Bell, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getOwnerDashboard, getCurrentPrices, getCorporates } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';

const PAYMENT_COLORS = { cash:'#16a34a', upi:'#2563eb', credit:'#9333ea', card:'#ea580c' };
const FUEL_COLORS    = { petrol:'#3b82f6', diesel:'#f59e0b', cng:'#10b981', premium_petrol:'#8b5cf6', lubes:'#ec4899' };

const toIST = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
    year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
  });
};
const fmt  = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtL = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:1});

export default function DashboardPage() {
  const { t }             = useTranslation();
  const { user, station } = useAuth();
  const stationId         = typeof station==='object' ? station?.id : station;
  const today             = new Date().toISOString().slice(0,10);
  const [data,setData]    = useState(null);
  const [prices,setPrices]= useState([]);
  const [corps,setCorps]  = useState([]);
  const [loading,setLoading] = useState(true);
  const { on }            = useSocket(stationId,null);

  const load = useCallback(async()=>{
    if(!stationId) return;
    try {
      const [d,p,c] = await Promise.all([
        getOwnerDashboard(stationId,today),
        getCurrentPrices(stationId),
        getCorporates(),
      ]);
      setData(d); setPrices(p); setCorps(c);
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  },[stationId,today]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>on('dispense:new',()=>load()),[on,load]);

  if(!stationId) return <AppShell><div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>No station assigned.</div></AppShell>;
  if(loading) return <AppShell><div style={{padding:'3rem',textAlign:'center',color:'var(--text-3)'}}>Loading...</div></AppShell>;

  const sales      = data?.sales||[];
  const totalSales = sales.reduce((s,r)=>s+parseFloat(r.total_amount||0),0);
  const totalLtrs  = sales.reduce((s,r)=>s+parseFloat(r.total_ltrs||0),0);
  const totalTxns  = sales.reduce((s,r)=>s+parseInt(r.txn_count||0),0);
  const unreadAlerts = (data?.alerts||[]).filter(a=>!a.acknowledged_at);

  const paymentData = ['cash','upi','credit','card'].map(mode=>({
    name:t(`dispense.${mode}`),
    value:sales.filter(r=>r.payment_mode===mode).reduce((s,r)=>s+parseFloat(r.total_amount||0),0),
    fill:PAYMENT_COLORS[mode],
  })).filter(d=>d.value>0);

  const fuelTypes = [...new Set(sales.map(r=>r.fuel_type))];
  const fuelData  = fuelTypes.map(ft=>({
    name: ft==='premium_petrol'?'Premium':ft.charAt(0).toUpperCase()+ft.slice(1),
    amount:sales.filter(r=>r.fuel_type===ft).reduce((s,r)=>s+parseFloat(r.total_amount||0),0),
    fill: FUEL_COLORS[ft]||'#888',
  }));

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>{toIST(new Date())}</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {unreadAlerts.length>0 && <div className="badge badge-danger" style={{padding:'6px 10px'}}><Bell size={13}/> {unreadAlerts.length} alerts</div>}
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14}/></button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{marginBottom:'1.5rem'}}>
        <div className="stat-card">
          <div className="stat-label">Today's Sales</div>
          <div className="stat-value amount">{fmt(totalSales)}</div>
          <div className="stat-sub">{totalTxns} transactions</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Litres</div>
          <div className="stat-value" style={{color:'var(--petrol)'}}>{fmtL(totalLtrs)} L</div>
          <div className="stat-sub">{fuelData.length} fuel types</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open Shifts</div>
          <div className="stat-value" style={{color:'var(--brand)'}}>{(data?.shifts||[]).filter(s=>s.status==='open').length}</div>
          <div className="stat-sub">{(data?.shifts||[]).length} total today</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unread Alerts</div>
          <div className="stat-value" style={{color:unreadAlerts.length?'var(--danger)':'var(--success)'}}>{unreadAlerts.length}</div>
          <div className="stat-sub">{unreadAlerts.length?'Action needed':'All clear ✓'}</div>
        </div>
      </div>

      {/* Charts */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem',marginBottom:'1.5rem'}}>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>Sales by Fuel Type (incl. Lubes)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={fuelData} margin={{top:0,right:0,left:-20,bottom:0}}>
              <XAxis dataKey="name" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:11}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={v=>`₹${fmt(v)}`}/>
              <Bar dataKey="amount" radius={[4,4,0,0]}>
                {fuelData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>By Payment Mode</div>
          {paymentData.length?(
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={paymentData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                  label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {paymentData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
                </Pie>
                <Tooltip formatter={v=>`₹${fmt(v)}`}/>
              </PieChart>
            </ResponsiveContainer>
          ):<div style={{textAlign:'center',color:'var(--text-3)',paddingTop:40}}>No sales yet today</div>}
        </div>
      </div>

      {/* Tank levels — Actual vs Book */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>Tank Levels — Actual Dip vs Book Stock</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr><th>Tank</th><th>Fuel</th><th>Capacity</th><th>Book Stock</th><th>Actual Dip</th><th>Variance</th><th>Fill Level</th></tr>
            </thead>
            <tbody>
              {(data?.stock||[]).map(tank=>{
                const book   = parseFloat(tank.current_stock||0);
                const actual = parseFloat(tank.last_reading||tank.current_stock||0);
                const diff   = actual - book;
                const ok     = Math.abs(diff)<=100;
                const pct    = tank.fill_pct||0;
                return (
                  <tr key={tank.id}>
                    <td><strong>Tank {tank.tank_number}</strong></td>
                    <td><span className={`fuel-chip fuel-${tank.fuel_type}`}>{t(`fuel_types.${tank.fuel_type}`)}</span></td>
                    <td className="num">{fmtL(tank.capacity_ltrs)} L</td>
                    <td className="num">{fmtL(book)} L</td>
                    <td className="num">{fmtL(actual)} L</td>
                    <td>
                      <span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:ok?'var(--success)':'var(--danger)'}}>
                        {diff>=0?'+':''}{fmtL(diff)} L
                      </span>
                    </td>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div className="tank-bar" style={{width:80}}>
                          <div className="tank-bar-fill" style={{width:`${Math.min(100,pct)}%`,background:pct<20?'var(--danger)':pct<40?'var(--warning)':FUEL_COLORS[tank.fuel_type]||'var(--brand)'}}/>
                        </div>
                        <span style={{fontSize:12,fontFamily:'var(--font-mono)'}}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!(data?.stock||[]).length && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-3)'}}>No tanks configured</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Prices + Corporate credit */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem',marginBottom:'1.5rem'}}>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>Current Fuel Prices</div>
          {prices.length===0&&<div style={{color:'var(--text-3)',fontSize:13}}>No prices set</div>}
          {prices.map(p=>(
            <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <span className={`fuel-chip fuel-${p.fuel_type}`}>{t(`fuel_types.${p.fuel_type}`)}</span>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:18}}>₹{Number(p.price).toFixed(2)}<span style={{fontSize:11,color:'var(--text-3)'}}>/L</span></div>
                <div style={{fontSize:11,color:'var(--text-3)'}}>Updated: {toIST(p.effective_from)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>Corporate Credit — Month to Date</div>
          {corps.length===0&&<div style={{color:'var(--text-3)',fontSize:13}}>No corporate accounts</div>}
          {corps.map(corp=>{
            const pct=corp.credit_limit>0?Math.round((corp.current_outstanding/corp.credit_limit)*100):0;
            return (
              <div key={corp.id} style={{marginBottom:'1rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:4}}>
                  <span style={{fontWeight:500}}>{corp.company_name}</span>
                  <span style={{color:pct>80?'var(--danger)':pct>60?'var(--warning)':'var(--success)',fontWeight:600}}>{pct}%</span>
                </div>
                <div className="tank-bar">
                  <div className="tank-bar-fill" style={{width:`${pct}%`,background:pct>80?'var(--danger)':pct>60?'var(--warning)':'var(--success)'}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text-3)',marginTop:3}}>
                  <span>Used: ₹{fmt(corp.current_outstanding)}</span>
                  <span>Limit: ₹{fmt(corp.credit_limit)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Variances + Alerts */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem'}}>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>Cash Variances Today</div>
          {(data?.variances||[]).length?data.variances.map(v=>(
            <div key={v.id} className="alert-banner danger" style={{marginBottom:8}}>
              <AlertTriangle size={16} style={{flexShrink:0}}/>
              <div>
                <div style={{fontWeight:500}}>{v.attendant_name}</div>
                <div style={{fontSize:12,marginTop:2}}>Expected ₹{fmt(v.cash_expected)} · Got ₹{fmt(v.cash_actual)} · Diff <strong>₹{fmt(Math.abs(v.variance))}</strong></div>
              </div>
            </div>
          )):<div style={{color:'var(--text-3)',fontSize:13}}>No variances today ✓</div>}
        </div>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>Recent Alerts</div>
          {unreadAlerts.length?unreadAlerts.slice(0,4).map(a=>(
            <div key={a.id} className={`alert-banner ${a.severity==='critical'?'danger':'warning'}`} style={{marginBottom:8}}>
              <Bell size={15} style={{flexShrink:0}}/>
              <div style={{fontSize:13}}>{a.message}</div>
            </div>
          )):<div style={{color:'var(--text-3)',fontSize:13}}>No unread alerts ✓</div>}
        </div>
      </div>
    </AppShell>
  );
}
