'use client';
import DateRangePicker from '../../components/shared/DateRangePicker';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, Bell, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getOwnerDashboard, getCurrentPrices } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';
import LiveEventsWidget from '../../components/ui/LiveEventsWidget';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const PAYMENT_COLORS = { cash:'#16a34a', upi:'#2563eb', credit:'#9333ea', card:'#ea580c' };
const FUEL_COLORS    = { petrol:'#3b82f6', diesel:'#f59e0b', cng:'#10b981', premium_petrol:'#8b5cf6', lubes:'#ec4899' };

const toIST = ts => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
    year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
  });
};
const fmt  = n => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits:0 });
const fmtL = n => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits:1 });

export default function DashboardPage() {
  const { t }             = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId         = typeof station==='object' ? station?.id : station;
  const today             = new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });

  const [data,      setData]      = useState(null);
  const [bookStock, setBookStock] = useState([]);
  const [prices,    setPrices]    = useState([]);
  const [corps,     setCorps]     = useState([]);
  const [cashInt,   setCashInt]   = useState([]);
  const [tankLive,  setTankLive]  = useState([]);
  const [deposit,   setDeposit]   = useState(null);
  const [loading,   setLoading]   = useState(true);

  const { on } = useSocket(stationId, null);

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      const [d, bs, p, c, ci, tl, dp] = await Promise.all([
        getOwnerDashboard(stationId, today),
        api.get(`/deliveries/book-stock/${stationId}`).catch(() => []),
        getCurrentPrices(stationId),
        api.get('/corporate', {params:{station_id:stationId}}).catch(()=>[]),
        user?.role==='owner'
          ? api.get('/dashboard/cash-integrity', {params:{station_id:stationId, days:90}}).catch(()=>[])
          : Promise.resolve([]),
        api.get('/tank-reco/live', {params:{station_id:stationId}}).catch(()=>[]),
        user?.role==='owner'
          ? api.get('/cash-deposits', {params:{station_id:stationId}}).then(r=>r?.status||null).catch(()=>null)
          : Promise.resolve(null),
      ]);
      setData(d);
      setBookStock(Array.isArray(bs) ? bs : []);
      setPrices(Array.isArray(p) ? p : []);
      setCorps(Array.isArray(c) ? c : []);
      setCashInt(Array.isArray(ci) ? ci : []);
      setTankLive(Array.isArray(tl) ? tl : []);
      setDeposit(dp || null);
    } catch (e) { console.error('Dashboard load error:', e); }
    finally { setLoading(false); }
  }, [stationId, today, user?.role]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => on('dispense:new', () => load()), [on, load]);
  useRefreshOnFocus(load);

  if (!stationId) return (
    <AppShell>
      <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>
        {tc('dash_page.no_station','No station assigned. Contact your administrator.')}
      </div>
    </AppShell>
  );

  if (loading) return (
    <AppShell>
      <div style={{padding:'3rem',textAlign:'center',color:'var(--text-3)'}}>{tc('dash_page.loading','Loading...')}</div>
    </AppShell>
  );

  // ── Aggregates ────────────────────────────────────────────
  const sales        = data?.sales || [];
  const totalSales   = sales.reduce((s,r) => s + parseFloat(r.total_amount||0), 0);
  const totalLtrs    = sales.reduce((s,r) => s + parseFloat(r.total_ltrs||0), 0);
  const totalTxns    = sales.reduce((s,r) => s + parseInt(r.txn_count||0), 0);
  const salesMasked  = !!data?.sales_masked; // blind drop: open shift, non-owner
  const unreadAlerts = (data?.alerts || []).filter(a => !a.acknowledged_at);

  // Payment pie
  const paymentData = ['cash','upi','credit','card'].map(mode => ({
    name:  t(`dispense.${mode}`),
    value: sales.filter(r=>r.payment_mode===mode).reduce((s,r)=>s+parseFloat(r.total_amount||0),0),
    fill:  PAYMENT_COLORS[mode],
  })).filter(d => d.value > 0);

  // Fuel bar
  const fuelTypes = [...new Set(sales.map(r => r.fuel_type))];
  const fuelData  = fuelTypes.map(ft => ({
    name:   ft === 'premium_petrol' ? tc('dash_page.premium','Premium') : (t(`fuel_types.${ft}`)===`fuel_types.${ft}` ? ft.charAt(0).toUpperCase()+ft.slice(1) : t(`fuel_types.${ft}`)),
    amount: sales.filter(r=>r.fuel_type===ft).reduce((s,r)=>s+parseFloat(r.total_amount||0),0),
    fill:   FUEL_COLORS[ft] || '#888',
  }));

  // Tank display — prefer book stock API, fall back to dashboard stock
  const tankDisplay = bookStock.length > 0 ? bookStock : (data?.stock || []);

  return (
    <AppShell>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('dash_page.title','Dashboard')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>{toIST(new Date())}</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {unreadAlerts.length > 0 && (
            <div className="badge badge-danger" style={{padding:'6px 10px'}}>
              <Bell size={13}/> {unreadAlerts.length} {tc('dash_page.alerts','alerts')}
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshCw size={14}/>
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid-4" style={{marginBottom:'1.5rem'}}>
        <div className="stat-card">
          <div className="stat-label">{tc('dash_page.todays_sales',"Today's Sales")}</div>
          {salesMasked ? (
            <div style={{fontSize:12.5,fontWeight:600,color:'var(--text-3)',marginTop:8,lineHeight:1.4}}>
              🔒 {tc('dash_page.hidden_open','Hidden during open shift')}
            </div>
          ) : (<>
            <div className="stat-value amount">{fmt(totalSales)}</div>
            <div className="stat-sub">{totalTxns} {tc('dash_page.transactions','transactions')}</div>
          </>)}
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('dash_page.total_litres','Total Litres')}</div>
          {salesMasked ? (
            <div style={{fontSize:12.5,fontWeight:600,color:'var(--text-3)',marginTop:8,lineHeight:1.4}}>
              🔒 {tc('dash_page.hidden_open','Hidden during open shift')}
            </div>
          ) : (<>
            <div className="stat-value" style={{color:'var(--petrol)'}}>{fmtL(totalLtrs)} L</div>
            <div className="stat-sub">{fuelData.length} {tc('dash_page.fuel_types','fuel types')}</div>
          </>)}
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('dash_page.open_shifts','Open Shifts')}</div>
          <div className="stat-value" style={{color:'var(--brand)'}}>
            {(data?.shifts||[]).filter(s=>s.status==='open').length}
          </div>
          <div className="stat-sub">{(data?.shifts||[]).length} {tc('dash_page.total_today','total today')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('dash_page.unread_alerts','Unread Alerts')}</div>
          <div className="stat-value" style={{color:unreadAlerts.length?'var(--danger)':'var(--success)'}}>
            {unreadAlerts.length}
          </div>
          <div className="stat-sub">{unreadAlerts.length ? tc('dash_page.action_needed','Action needed') : tc('dash_page.all_clear','All clear ✓')}</div>
        </div>
      </div>

      {/* Cash awaiting bank deposit — flags the overnight/T+1 custody gap */}
      {user?.role==='owner' && deposit && deposit.awaiting>0.5 && (
        <a href="/deposits" style={{textDecoration:'none'}}>
          <div className="card" style={{marginBottom:'1.5rem',display:'flex',justifyContent:'space-between',alignItems:'center',
            borderLeft:`4px solid ${deposit.stale?'#dc2626':'#FF6B00'}`,background:deposit.stale?'#fef2f2':undefined}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:'var(--text-1)'}}>🏦 Cash awaiting bank deposit</div>
              <div style={{fontSize:12.5,color:deposit.stale?'#dc2626':'var(--text-3)',marginTop:2}}>
                {deposit.stale ? `⚠ Sitting ${deposit.age_days} day(s) — deposit overdue` : `Oldest: ${deposit.age_days} day(s)`}
              </div>
            </div>
            <div style={{fontSize:22,fontWeight:900,color:deposit.stale?'#dc2626':'var(--brand)'}}>
              ₹{Number(deposit.awaiting||0).toLocaleString('en-IN')}
            </div>
          </div>
        </a>
      )}

      {/* Cash Integrity — owner oversight: each operator's last shift-end report + undercash count */}
      {user?.role==='owner' && cashInt.length>0 && (
        <div className="card" style={{marginBottom:'1.5rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
            <div style={{fontWeight:700,fontSize:14}}>🛡 Cash Integrity
              <span style={{fontSize:11,fontWeight:400,color:'var(--text-3)',marginLeft:6}}>· last 90 days · over or exact, never under</span>
            </div>
            <a href="/cash-integrity" style={{fontSize:12,color:'var(--brand)',textDecoration:'none',fontWeight:600}}>View all →</a>
          </div>
          <div className="table-wrap">
            <table className="dms-table">
              <thead><tr>
                <th>Operator</th><th>Last shift-end report</th>
                <th style={{textAlign:'center'}}>Undercash</th><th style={{textAlign:'center'}}>Flag</th>
              </tr></thead>
              <tbody>
                {cashInt.slice(0,6).map(r=>{
                  const v = parseFloat(r.last_variance||0);
                  const suspect = r.undercash_count>=3 || (r.total_recons>=4 && r.undercash_count/r.total_recons>0.4);
                  return (
                    <tr key={r.attendant_id} style={suspect?{background:'#fef2f2'}:undefined}>
                      <td style={{fontWeight:600}}>{r.attendant_name}</td>
                      <td style={{fontSize:13}}>
                        {r.last_recon_at ? (
                          <>
                            <span style={{fontWeight:600,color:v<0?'#dc2626':v>0?'#16a34a':'var(--text-2)'}}>
                              {v<0?`Short ₹${Math.abs(v).toLocaleString('en-IN')}`:v>0?`Over ₹${Math.abs(v).toLocaleString('en-IN')}`:'Exact'}
                            </span>
                            <span style={{color:'var(--text-3)',marginLeft:6}}>· {new Date(r.last_recon_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{textAlign:'center',fontWeight:700,color:r.undercash_count?'#dc2626':'var(--text-3)'}}>{r.undercash_count}/{r.total_recons}</td>
                      <td style={{textAlign:'center',fontSize:12}}>
                        {suspect?<span style={{color:'#dc2626',fontWeight:700}}>Suspect</span>:r.undercash_count>0?<span style={{color:'#d97706'}}>Watch</span>:<span style={{color:'#16a34a'}}>Clean</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Live Tank Status — real-time wet-stock variance vs book between dips */}
      {tankLive.length>0 && (
        <div className="card" style={{marginBottom:'1.5rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
            <div style={{fontWeight:700,fontSize:14}}>💧 Live Tank Status
              <span style={{fontSize:11,fontWeight:400,color:'var(--text-3)',marginLeft:6}}>· variance since last dip · 🟢 within limit / 🔴 over</span>
            </div>
            <a href="/stock-reco" style={{fontSize:12,color:'var(--brand)',textDecoration:'none',fontWeight:600}}>Reconcile →</a>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:10}} className="stack-mobile">
            {tankLive.map(tk=>{
              const mins = tk.last_reading_at ? Math.round((Date.now()-new Date(tk.last_reading_at).getTime())/60000) : null;
              const stale = mins!=null && mins > 720; // >12h old
              const ago = mins==null ? 'no reading' : mins<60 ? `${mins} min ago` : mins<1440 ? `${Math.round(mins/60)} h ago` : `${Math.round(mins/1440)} d ago`;
              const dot = tk.status==='loss'||tk.status==='gain' ? '#dc2626' : tk.status==='ok' ? '#16a34a' : '#94a3b8';
              return (
                <div key={tk.tank_id} style={{border:'1px solid var(--border)',borderLeft:`4px solid ${dot}`,borderRadius:10,padding:'0.7rem 0.85rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                    <div style={{fontWeight:700,fontSize:13}}>T{tk.tank_number} <span style={{fontWeight:400,color:'var(--text-3)',fontSize:11}}>{tk.fuel_type}</span></div>
                    <div style={{fontSize:11,color:stale?'#dc2626':'var(--text-3)'}}>{stale?'⚠ ':''}{ago}</div>
                  </div>
                  <div style={{fontSize:18,fontWeight:800,margin:'2px 0'}}>
                    {tk.current_vol!=null?Number(tk.current_vol).toLocaleString('en-IN',{maximumFractionDigits:0}):'—'}<span style={{fontSize:11,fontWeight:400,color:'var(--text-3)'}}> L{tk.fill_pct!=null?` · ${tk.fill_pct}%`:''}</span>
                  </div>
                  <div style={{fontSize:12.5,fontWeight:600,color:dot}}>
                    {tk.variance_ltrs==null
                      ? (tk.status==='baseline'?'Baseline set':'No data')
                      : `${tk.status==='loss'?'🔴 Loss':tk.status==='gain'?'🔴 Gain':'🟢 OK'} ${tk.variance_ltrs>0?'+':''}${Number(tk.variance_ltrs).toFixed(1)} L`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem',marginBottom:'1.5rem'}}>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>
            {tc('dash_page.sales_by_fuel','Sales by Fuel Type (incl. Lubes)')}
          </div>
          {salesMasked ? (
            <div style={{textAlign:'center',color:'var(--text-3)',paddingTop:40,fontSize:13,fontWeight:600}}>🔒 {tc('dash_page.hidden_open','Hidden during open shift')}</div>
          ) : fuelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={fuelData} margin={{top:0,right:0,left:-20,bottom:0}}>
                <XAxis dataKey="name" tick={{fontSize:11}}/>
                <YAxis tick={{fontSize:11}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                <Tooltip formatter={v=>`₹${fmt(v)}`}/>
                <Bar dataKey="amount" radius={[4,4,0,0]}>
                  {fuelData.map((e,i) => <Cell key={i} fill={e.fill}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{textAlign:'center',color:'var(--text-3)',paddingTop:40}}>{tc('dash_page.no_sales','No sales yet today')}</div>
          )}
        </div>

        <div className="card">
          <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>{tc('dash_page.by_payment','By Payment Mode')}</div>
          {salesMasked ? (
            <div style={{textAlign:'center',color:'var(--text-3)',paddingTop:40,fontSize:13,fontWeight:600}}>🔒 {tc('dash_page.hidden_open','Hidden during open shift')}</div>
          ) : paymentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={paymentData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                  label={({name,percent}) => `${name} ${(percent*100).toFixed(0)}%`}
                  labelLine={false} fontSize={11}>
                  {paymentData.map((e,i) => <Cell key={i} fill={e.fill}/>)}
                </Pie>
                <Tooltip formatter={v=>`₹${fmt(v)}`}/>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{textAlign:'center',color:'var(--text-3)',paddingTop:40}}>{tc('dash_page.no_sales','No sales yet today')}</div>
          )}
        </div>
      </div>

      {/* Tank levels — Book Stock vs Actual Dip */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>
          {tc('dash_page.tank_levels','Tank Levels — Book Stock vs Actual Dip')}
        </div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('dash_page.tank','Tank')}</th><th>{tc('dash_page.fuel','Fuel')}</th><th>{tc('dash_page.capacity','Capacity')}</th>
                <th>{tc('dash_page.book_stock','Book Stock')}</th><th>{tc('dash_page.actual_dip','Actual Dip')}</th>
                <th>{tc('dash_page.variance','Variance')}</th><th>{tc('dash_page.fill_level','Fill Level')}</th>
              </tr>
            </thead>
            <tbody>
              {tankDisplay.length === 0 && (
                <tr>
                  <td colSpan={7} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>
                    {tc('dash_page.no_tanks','No tanks configured')}
                  </td>
                </tr>
              )}
              {tankDisplay.map(tank => {
                const book   = parseFloat(tank.book_stock   || tank.current_stock || 0);
                const actual = parseFloat(tank.closing_dip  || tank.current_stock || book);
                const diff   = actual - book;
                const ok     = Math.abs(diff) <= 100;
                const cap    = parseFloat(tank.capacity_ltrs || 0);
                const pct    = cap > 0 ? Math.min(100, Math.round((book / cap) * 100)) : 0;
                return (
                  <tr key={tank.tank_id || tank.id}>
                    <td><strong>{tc('dash_page.tank','Tank')} {tank.tank_number}</strong></td>
                    <td>
                      <span className={`fuel-chip fuel-${tank.fuel_type}`}>
                        {t(`fuel_types.${tank.fuel_type}`) || tank.fuel_type}
                      </span>
                    </td>
                    <td className="num">{fmtL(cap)} L</td>
                    <td className="num">{fmtL(book)} L</td>
                    <td className="num">
                      {tank.closing_dip ? fmtL(actual)+' L' : <span style={{color:'var(--text-3)'}}>{tc('dash_page.no_dip','No dip yet')}</span>}
                    </td>
                    <td>
                      {tank.closing_dip ? (
                        <span style={{fontFamily:'var(--font-mono)',fontWeight:700,
                          color: ok ? 'var(--success)' : 'var(--danger)'}}>
                          {diff >= 0 ? '+' : ''}{fmtL(diff)} L
                        </span>
                      ) : <span style={{color:'var(--text-3)',fontSize:12}}>—</span>}
                    </td>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div className="tank-bar" style={{width:80}}>
                          <div className="tank-bar-fill" style={{
                            width: `${pct}%`,
                            background: pct < 20 ? 'var(--danger)'
                              : pct < 40 ? 'var(--warning)'
                              : FUEL_COLORS[tank.fuel_type] || 'var(--brand)'
                          }}/>
                        </div>
                        <span style={{fontSize:12,fontFamily:'var(--font-mono)'}}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{fontSize:11,color:'var(--text-3)',marginTop:8}}>
          {tc('dash_page.book_stock_note','Book Stock = Opening Dip + Deliveries − Sales this shift. Variance shown only after closing dip is recorded.')}
        </div>
      </div>

      {/* Fuel Prices + Credit Customers */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem',marginBottom:'1.5rem'}}>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>{tc('dash_page.current_prices','Current Fuel Prices')}</div>
          {prices.length === 0 && (
            <div style={{color:'var(--text-3)',fontSize:13}}>{tc('dash_page.no_prices','No prices set in Settings')}</div>
          )}
          {prices.map(p => (
            <div key={p.id} style={{display:'flex',justifyContent:'space-between',
              alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <span className={`fuel-chip fuel-${p.fuel_type}`}>
                {t(`fuel_types.${p.fuel_type}`) || p.fuel_type}
              </span>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:18}}>
                  ₹{Number(p.price).toFixed(2)}
                  <span style={{fontSize:11,color:'var(--text-3)'}}>/L</span>
                </div>
                <div style={{fontSize:11,color:'var(--text-3)'}}>
                  {tc('dash_page.updated','Updated')}: {toIST(p.effective_from)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>
            {tc('dash_page.credit_mtd','Credit Customers — Month to Date')}
          </div>
          {corps.length === 0 && (
            <div style={{color:'var(--text-3)',fontSize:13}}>{tc('dash_page.no_credit','No credit customers')}</div>
          )}
          {corps.map(corp => {
            const pct = corp.credit_limit > 0
              ? Math.round((corp.current_outstanding / corp.credit_limit) * 100)
              : 0;
            return (
              <div key={corp.id} style={{marginBottom:'1rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:4}}>
                  <span style={{fontWeight:500}}>{corp.company_name}</span>
                  <span style={{
                    color: pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)',
                    fontWeight:600
                  }}>{pct}%</span>
                </div>
                <div className="tank-bar">
                  <div className="tank-bar-fill" style={{
                    width: `${Math.min(100,pct)}%`,
                    background: pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)'
                  }}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',
                  fontSize:11,color:'var(--text-3)',marginTop:3}}>
                  <span>{tc('dash_page.used','Used')}: ₹{fmt(corp.current_outstanding)}</span>
                  <span>{tc('dash_page.limit','Limit')}: ₹{fmt(corp.credit_limit)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Variances + Alerts */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem',marginBottom:'1.5rem'}}>
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>{tc('dash_page.cash_variances','Cash Variances Today')}</div>
          {(data?.variances || []).length > 0 ? (
            data.variances.map(v => (
              <div key={v.id} className="alert-banner danger" style={{marginBottom:8}}>
                <AlertTriangle size={16} style={{flexShrink:0}}/>
                <div>
                  <div style={{fontWeight:500}}>{v.attendant_name}</div>
                  <div style={{fontSize:12,marginTop:2}}>
                    {tc('dash_page.expected','Expected')} ₹{fmt(v.cash_expected)} · {tc('dash_page.got','Got')} ₹{fmt(v.cash_actual)} ·
                    {tc('dash_page.diff','Diff')} <strong>₹{fmt(Math.abs(v.variance))}</strong>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{color:'var(--text-3)',fontSize:13}}>{tc('dash_page.no_variances','No variances today ✓')}</div>
          )}
        </div>

        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>{tc('dash_page.recent_alerts','Recent Alerts')}</div>
          {unreadAlerts.length > 0 ? (
            unreadAlerts.slice(0,4).map(a => (
              <div key={a.id}
                className={`alert-banner ${a.severity==='critical'?'danger':'warning'}`}
                style={{marginBottom:8}}>
                <Bell size={15} style={{flexShrink:0}}/>
                <div style={{fontSize:13}}>{a.message}</div>
              </div>
            ))
          ) : (
            <div style={{color:'var(--text-3)',fontSize:13}}>{tc('dash_page.no_unread','No unread alerts ✓')}</div>
          )}
        </div>
      </div>

      {/* Live Events Widget */}
      <LiveEventsWidget stationId={stationId} maxRows={8}/>

    </AppShell>
  );
}
