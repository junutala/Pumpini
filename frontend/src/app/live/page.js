'use client';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Zap, TrendingUp, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt  = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtL = n => Number(n||0).toFixed(2);
const toIST = ts => new Date(ts).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});

const FUEL_COLORS = { petrol:'#3b82f6', diesel:'#f59e0b', cng:'#10b981', premium_petrol:'#8b5cf6', lubes:'#ec4899' };
const MODE_COLORS = { cash:'#16a34a', upi:'#2563eb', credit:'#9333ea', card:'#ea580c' };

export default function LiveEventsPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [events,setEvents]   = useState([]);
  const [shifts,setShifts]   = useState([]);
  const [stats,setStats]     = useState({ total:0, litres:0, txns:0 });
  const [flash,setFlash]     = useState(null);
  const tableRef = useRef();
  const { on }   = useSocket(stationId, null);

  const loadRecent = async () => {
    if (!stationId) return;
    const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
    const [evs, shs] = await Promise.all([
      api.get('/dispense',{params:{station_id:stationId,limit:50}}),
      api.get('/shifts',{params:{station_id:stationId,date:today,status:'open'}}),
    ]);
    const rows = Array.isArray(evs)?evs:[];
    setEvents(rows);
    setShifts(Array.isArray(shs)?shs:[]);
    setStats({
      total:  rows.reduce((s,r)=>s+parseFloat(r.amount||0),0),
      litres: rows.reduce((s,r)=>s+parseFloat(r.quantity_ltrs||0),0),
      txns:   rows.length,
    });
  };

  useEffect(()=>{ loadRecent(); },[stationId]);
  useRefreshOnFocus(load);
  
  // Real-time new events
  useEffect(()=>{
    return on('dispense:new', ev => {
      setEvents(prev => [ev, ...prev].slice(0,100));
      setStats(p=>({
        total:  p.total  + parseFloat(ev.amount||0),
        litres: p.litres + parseFloat(ev.quantity_ltrs||0),
        txns:   p.txns   + 1,
      }));
      // Flash animation
      setFlash(ev.id);
      setTimeout(()=>setFlash(null), 2000);
    });
  },[on]);

  return (
    <AppShell>
      <div className="page-header">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div className="live-dot"/>
          <div>
            <h1 className="page-title">{tc('live_page.title','Live Events')}</h1>
            <div style={{fontSize:13,color:'var(--text-3)'}}>
              {new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',
                weekday:'long',day:'2-digit',month:'long',year:'numeric'})}
              {' · '}{shifts.length} {shifts.length!==1?tc('live_page.shifts_open','shifts'):tc('live_page.shift_open','shift')} {tc('live_page.open','open')}
            </div>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadRecent}>
          <RefreshCw size={14}/>{tc('live_page.refresh','Refresh')}
        </button>
      </div>

      {/* Live KPIs */}
      <div className="grid-3" style={{marginBottom:'1.5rem'}}>
        <div className="stat-card" style={{borderLeft:'3px solid var(--brand)'}}>
          <div className="stat-label">{tc('live_page.todays_revenue',"Today's Revenue")}</div>
          <div className="stat-value amount">{fmt(stats.total)}</div>
          <div className="stat-sub">{tc('live_page.updates_live','updates live')}</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #3b82f6'}}>
          <div className="stat-label">{tc('live_page.litres_dispensed','Litres Dispensed')}</div>
          <div className="stat-value" style={{color:'#3b82f6'}}>{fmtL(stats.litres)} L</div>
          <div className="stat-sub">{tc('live_page.updates_live','updates live')}</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #16a34a'}}>
          <div className="stat-label">{tc('live_page.transactions','Transactions')}</div>
          <div className="stat-value" style={{color:'#16a34a'}}>{stats.txns}</div>
          <div className="stat-sub">{tc('live_page.since_shift','since shift start')}</div>
        </div>
      </div>

      {/* Live feed */}
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.75rem'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:600}}>
            <div className="live-dot"/>
            {tc('live_page.live_feed','Live Dispense Feed')}
          </div>
          <span style={{fontSize:12,color:'var(--text-3)'}}>
            {tc('live_page.showing_last','Showing last')} {events.length} {tc('live_page.events','events')}
          </span>
        </div>

        <div ref={tableRef} style={{maxHeight:'calc(100vh - 320px)',overflowY:'auto'}}>
          <div className="table-wrap">
            <table className="dms-table">
              <thead style={{position:'sticky',top:0,zIndex:1}}>
                <tr>
                  <th>#</th>
                  <th>{tc('live_page.time_ist','Time (IST)')}</th>
                  <th>{tc('live_page.attendant','Attendant')}</th>
                  <th>{tc('live_page.nozzle','Nozzle')}</th>
                  <th>{tc('live_page.fuel','Fuel')}</th>
                  <th>{tc('live_page.qty_l','Qty (L)')}</th>
                  <th>{tc('live_page.amount','Amount')}</th>
                  <th>{tc('live_page.mode','Mode')}</th>
                  <th>{tc('live_page.vehicle','Vehicle')}</th>
                </tr>
              </thead>
              <tbody>
                {events.length===0 && (
                  <tr><td colSpan={9} style={{textAlign:'center',color:'var(--text-3)',padding:'3rem'}}>
                    <Activity size={32} style={{margin:'0 auto 8px',opacity:.3}}/>
                    <div>{tc('live_page.no_events','No events yet. Transactions will appear here in real time.')}</div>
                  </td></tr>
                )}
                {events.map((ev,i)=>(
                  <tr key={ev.id} style={{
                    background: flash===ev.id ? '#fff3e0' : i===0&&!flash ? 'var(--surface-2)' : '',
                    transition: 'background .5s',
                  }}>
                    <td className="num" style={{color:'var(--text-3)',fontSize:12}}>{ev.event_seq}</td>
                    <td style={{fontSize:12,fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>{toIST(ev.occurred_at)}</td>
                    <td style={{fontWeight:500}}>{ev.attendant_name||'—'}</td>
                    <td style={{fontWeight:600}}>N{ev.nozzle_number}</td>
                    <td>
                      <span style={{
                        display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:12,fontWeight:600,
                        background:`${FUEL_COLORS[ev.fuel_type]}20`,color:FUEL_COLORS[ev.fuel_type]||'#888'
                      }}>
                        {ev.fuel_type}
                      </span>
                    </td>
                    <td className="num">{fmtL(ev.quantity_ltrs)}</td>
                    <td className="num" style={{fontWeight:600,color:'var(--brand)'}}>₹{fmt(ev.amount)}</td>
                    <td>
                      <span style={{
                        display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:12,fontWeight:600,
                        background:`${MODE_COLORS[ev.payment_mode]}15`,color:MODE_COLORS[ev.payment_mode]||'#888'
                      }}>
                        {ev.payment_mode}
                      </span>
                    </td>
                    <td style={{fontSize:12,fontFamily:'var(--font-mono)'}}>{ev.vehicle_number||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
