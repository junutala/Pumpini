'use client';
import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import Link from 'next/link';
import api from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';

const fmt  = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtL = n => Number(n||0).toFixed(2);
const toIST = ts => new Date(ts).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
const FUEL_COLORS = { petrol:'#3b82f6', diesel:'#f59e0b', cng:'#10b981', premium_petrol:'#8b5cf6', lubes:'#ec4899' };

export default function LiveEventsWidget({ stationId, maxRows=8 }) {
  const [events,setEvents] = useState([]);
  const [flash,setFlash]   = useState(null);
  const { on } = useSocket(stationId, null);

  useEffect(()=>{
    if (!stationId) return;
    const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
    api.get('/dispense',{params:{
      station_id:stationId,
      date_from: today,
      date_to:   today + 'T23:59:59',
      limit:maxRows
    }})
      .then(rows=>setEvents(Array.isArray(rows)?rows:[]));
  },[stationId]);

  useEffect(()=>{
    return on('dispense:new', ev => {
      setEvents(prev=>[ev,...prev].slice(0,maxRows));
      setFlash(ev.id);
      setTimeout(()=>setFlash(null),2000);
    });
  },[on]);

  return (
    <div className="card">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.75rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:600,fontSize:14}}>
          <div className="live-dot"/>Live Events
          <span style={{fontSize:11,color:'var(--text-3)',fontWeight:400}}>
            — {new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'})}
          </span>
        </div>
        <Link href="/live" style={{fontSize:12,color:'var(--brand)',textDecoration:'none',fontWeight:500}}>View all →</Link>
      </div>
      {events.length===0 && (
        <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-3)',fontSize:13}}>
          <Activity size={24} style={{margin:'0 auto 6px',opacity:.3}}/>
          No events yet today
        </div>
      )}
      {events.map((ev,i)=>(
        <div key={ev.id} style={{
          display:'flex',alignItems:'center',justifyContent:'space-between',
          padding:'8px 0',
          borderBottom:i<events.length-1?'1px solid var(--border)':'none',
          background:flash===ev.id?'#fff3e0':'transparent',
          transition:'background .5s',borderRadius:4,
        }}>
          <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
            <div style={{width:6,height:6,borderRadius:'50%',flexShrink:0,background:FUEL_COLORS[ev.fuel_type]||'#888'}}/>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {ev.attendant_name||'—'} · N{ev.nozzle_number}
              </div>
              <div style={{fontSize:11,color:'var(--text-3)'}}>
                {ev.sales_hidden ? '' : `${fmtL(ev.quantity_ltrs)}L · `}{ev.payment_mode} · {toIST(ev.occurred_at)}
              </div>
            </div>
          </div>
          <div style={{fontFamily:'var(--font-mono)',fontWeight:700,flexShrink:0,marginLeft:10,
            color: ev.sales_hidden?'var(--text-3)':'var(--brand)', fontSize: ev.sales_hidden?11:undefined}}>
            {ev.sales_hidden ? '🔒 Hidden' : `₹${fmt(ev.amount)}`}
          </div>
        </div>
      ))}
    </div>
  );
}

