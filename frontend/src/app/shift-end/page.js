'use client';
// End Shift — guided manager-driven close:
//   Select shift (any open shift; >24h flagged) → Close operators (cash/card/UPI,
//   sequential, gated) → Closing meters per nozzle → Close (collections vs
//   wet-meter + bay-dry − credit variance). Sales-of-record = the meter; the
//   opening for each nozzle auto-carries from the prior shift's closing.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, ArrowLeft, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inp = { width:'100%', padding:'8px 10px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:13.5, outline:'none', boxSizing:'border-box', background:'#fff' };
const fmt = n => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2})}`;
const STEPS = ['Select', 'Operators', 'Meters', 'Close'];
const hoursSince = (t) => t ? (Date.now() - new Date(t).getTime())/3.6e6 : 0;
const openedLabel = (t) => { const h = hoursSince(t); return h < 1 ? `${Math.round(h*60)}m ago` : h < 24 ? `${h.toFixed(1)}h ago` : `${Math.floor(h/24)}d ${Math.round(h%24)}h ago`; };

export default function ShiftEndPage() {
  const router = useRouter();
  const { station, setActiveShift } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [step, setStep]   = useState(0);
  const [open, setOpen]   = useState([]);          // open shifts to pick from
  const [shift, setShift] = useState(null);        // selected shift (+attendants)
  const [nozzles, setNozzles] = useState([]);
  const [forms, setForms] = useState({});          // attendant_id -> {cash,card,upi}
  const [closed, setClosed] = useState({});        // attendant_id -> true
  const [meters, setMeters] = useState({});        // nozzle_id -> closing
  const [scanning, setScanning] = useState('');    // nozzle_id being OCR'd
  const [fuelCredit, setFuelCredit] = useState('');
  const [recon, setRecon] = useState(null);
  const [busy, setBusy]   = useState('');
  const [err, setErr]     = useState('');
  const [done, setDone]   = useState(false);

  // Load open shifts (any date — a shift can sit open for days)
  useEffect(() => {
    if (!stationId) return;
    api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
      .then(r => setOpen(Array.isArray(r)?r:[])).catch(()=>setOpen([]));
  }, [stationId]);

  const pickShift = async (s) => {
    setBusy('pick'); setErr('');
    try {
      const [d, nz] = await Promise.all([
        api.get(`/shifts/${s.id}`),
        api.get(`/stations/${stationId}/nozzles`).catch(()=>[]),
      ]);
      setShift(d); setActiveShift({ id:d.id, shift_number:d.shift_number, start_time:d.start_time, station_id:d.station_id });
      setNozzles((Array.isArray(nz)?nz:[]).filter(n=>n.is_active));
      const seed = {}; (d?.attendants||[]).forEach(a=>{ seed[a.attendant_id]={ cash:'', card:'', upi:'' }; });
      setForms(seed); setClosed({}); setStep(1);
    } catch(e){ setErr(e.response?.data?.error||e.error||'Could not load shift'); }
    setBusy('');
  };

  const setF = (aid,k,v) => setForms(p=>({...p,[aid]:{...p[aid],[k]:v}}));
  const closeOperator = async (a) => {
    const fm = forms[a.attendant_id]||{};
    if (fm.cash==='' && fm.card==='' && fm.upi==='') return setErr(`Enter collections for ${a.attendant_name} (0 where none)`);
    setBusy('op'+a.attendant_id); setErr('');
    try {
      await api.post('/reconcile/operator-cash', {
        shift_id: shift.id, attendant_id: a.attendant_id,
        cash_total: parseFloat(fm.cash||0), card_total: parseFloat(fm.card||0), upi_total: parseFloat(fm.upi||0),
      });
      setClosed(p=>({...p,[a.attendant_id]:true}));
    } catch(e){ setErr(e.response?.data?.error||e.error||'Could not close operator'); }
    setBusy('');
  };

  const attendants = shift?.attendants || [];
  const allClosed = attendants.length>0 && attendants.every(a=>closed[a.attendant_id]);

  // Snap the totalizer → backend → Claude reads it → fills the field. Manager
  // confirms on screen; legible=false flags a verify. Image kept for audit.
  const scanMeter = async (nozzle, file) => {
    if (!file) return;
    setScanning(nozzle.id); setErr('');
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('Could not read image'));
        r.readAsDataURL(file);
      });
      const r = await api.post('/reconcile/ocr-meter', {
        shift_id: shift.id, nozzle_id: nozzle.id, image_base64: b64, media_type: file.type || 'image/jpeg',
      });
      if (r.reading) setMeters(p => ({ ...p, [nozzle.id]: r.reading }));
      if (!r.legible) setErr(`Nozzle ${nozzle.nozzle_number}: scan unclear${r.notes ? ` (${r.notes})` : ''} — check the reading.`);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Scan failed'); }
    setScanning('');
  };

  const computeMeters = async () => {
    setBusy('meters'); setErr('');
    try {
      const readings = nozzles.map(n=>({ nozzle_id:n.id, closing_reading: meters[n.id] })).filter(r=>r.closing_reading!=='' && r.closing_reading!=null);
      const r = await api.post('/reconcile/shift-meters', { shift_id: shift.id, readings, fuel_credit: parseFloat(fuelCredit||0) });
      setRecon(r); setStep(3);
    } catch(e){ setErr(e.response?.data?.error||e.error||'Could not compute'); }
    setBusy('');
  };

  const closeShift = async () => {
    setBusy('close');
    try { await api.patch(`/shifts/${shift.id}/close`, { confirm:true }); setActiveShift(null); setDone(true); }
    catch(e){ setErr(e.response?.data?.error||e.error||'Close failed'); }
    setBusy('');
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>Dashboard</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>End Shift{shift?` — Shift ${shift.shift_number}`:''}</span>
      </div>

      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s} onClick={()=>{ if(!done && shift && i<=step) setStep(i); }} disabled={done || (!shift && i>0)}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:shift&&i<=step?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {s}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* STEP 0 — Select shift */}
      {step===0 && (
        <div className="card" style={{maxWidth:620}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Pick the shift to close</div>
          {open.length===0 ? <div style={{color:'#aaa',fontSize:13}}>No open shifts.</div>
            : open.map(s=>{ const stale = hoursSince(s.start_time) > 24; return (
              <button key={s.id} onClick={()=>pickShift(s)} disabled={busy==='pick'}
                style={{width:'100%',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center',
                  background:stale?'#fef2f2':'#f8fafc',border:'1.5px solid '+(stale?'#fca5a5':'#eef0f2'),borderRadius:10,padding:'10px 12px',marginBottom:8,cursor:'pointer'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>Shift {s.shift_number} <span style={{fontWeight:400,color:'#888',fontSize:12.5}}>· {s.date} · {s.attendant_count} operator{s.attendant_count===1?'':'s'}</span></div>
                  <div style={{fontSize:12,color:stale?'#dc2626':'#888',display:'flex',alignItems:'center',gap:4,marginTop:2}}>
                    <Clock size={12}/> opened {openedLabel(s.start_time)} {stale && <span style={{fontWeight:700}}>· OPEN &gt;24h</span>}
                  </div>
                </div>
                <ChevronRight size={18} color="#bbb"/>
              </button>
            ); })}
        </div>
      )}

      {/* STEP 1 — Close operators */}
      {step===1 && shift && (
        <div style={{maxWidth:620}}>
          {attendants.length===0 && <div className="card" style={{color:'#aaa',fontSize:13}}>No operators on this shift.</div>}
          {attendants.map(a=>{ const c=closed[a.attendant_id], fm=forms[a.attendant_id]||{}; return (
            <div key={a.attendant_id} className="card" style={{marginBottom:'0.85rem',background:c?'#f0fdf4':undefined}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:c?0:10}}>
                <div style={{fontWeight:700,fontSize:14}}>{a.attendant_name} <span style={{fontWeight:400,color:'#888',fontSize:12}}>· float {fmt(a.opening_cash)}</span></div>
                {c && <span style={{color:'#16a34a',fontSize:12.5,fontWeight:700,display:'flex',alignItems:'center',gap:4}}><CheckCircle size={15}/>Closed · {fmt((parseFloat(fm.cash||0))+(parseFloat(fm.card||0))+(parseFloat(fm.upi||0)))}</span>}
              </div>
              {!c && (<>
                <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  <div><label className="label">Cash ₹</label><input style={inp} type="number" step="0.01" value={fm.cash||''} onChange={e=>setF(a.attendant_id,'cash',e.target.value)}/></div>
                  <div><label className="label">Card ₹</label><input style={inp} type="number" step="0.01" value={fm.card||''} onChange={e=>setF(a.attendant_id,'card',e.target.value)}/></div>
                  <div><label className="label">UPI ₹</label><input style={inp} type="number" step="0.01" value={fm.upi||''} onChange={e=>setF(a.attendant_id,'upi',e.target.value)}/></div>
                </div>
                <button onClick={()=>closeOperator(a)} disabled={busy==='op'+a.attendant_id} style={{marginTop:10,height:38,padding:'0 16px',background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer',fontSize:13}}>{busy==='op'+a.attendant_id?'Closing…':'Close operator'}</button>
              </>)}
            </div>
          ); })}
          <button onClick={()=>setStep(2)} disabled={!allClosed} style={{width:'100%',height:44,marginTop:'0.25rem',background:allClosed?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:allClosed?'pointer':'not-allowed'}}>
            {allClosed?'Next: Closing meters →':'Close every operator first'}
          </button>
        </div>
      )}

      {/* STEP 2 — Closing meters */}
      {step===2 && shift && (
        <div className="card" style={{maxWidth:560}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem'}}>Closing meter readings</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>Enter each nozzle's cumulative totalizer. The opening auto-carries from the last shift's closing, so you only key the closing. Optional — leave a nozzle blank to skip it.</div>
          {nozzles.length===0 && <div style={{color:'#aaa',fontSize:13}}>No nozzles configured.</div>}
          {nozzles.map(n=>(
            <div key={n.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:140,fontSize:13,fontWeight:600}}>Nozzle {n.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{n.fuel_type}</span></div>
              <input style={{...inp,flex:1}} type="number" step="0.001" placeholder="Closing totalizer" value={meters[n.id]||''} onChange={e=>setMeters(p=>({...p,[n.id]:e.target.value}))}/>
              <label title="Scan the totalizer" style={{flexShrink:0,width:42,height:38,display:'flex',alignItems:'center',justifyContent:'center',background:scanning===n.id?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:scanning===n.id?'default':'pointer',fontSize:17}}>
                {scanning===n.id?'…':'📷'}
                <input type="file" accept="image/*" capture="environment" disabled={scanning===n.id} style={{display:'none'}} onChange={e=>{ scanMeter(n, e.target.files?.[0]); e.target.value=''; }}/>
              </label>
            </div>
          ))}
          <div style={{marginTop:'1rem',paddingTop:'0.75rem',borderTop:'1px solid #eef0f2'}}>
            <label className="label">Fuel sold on credit this shift ₹ <span style={{fontWeight:400,color:'#888'}}>(manager's separate recon — netted out here)</span></label>
            <input style={{...inp,maxWidth:220}} type="number" step="0.01" placeholder="0" value={fuelCredit} onChange={e=>setFuelCredit(e.target.value)}/>
          </div>
          <button onClick={computeMeters} disabled={busy==='meters'} style={{width:'100%',height:44,marginTop:'1rem',background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>{busy==='meters'?'Computing…':'Compute & review →'}</button>
        </div>
      )}

      {/* STEP 3 — Close */}
      {step===3 && shift && (
        <div className="card" style={{maxWidth:480}}>
          {done ? (
            <div style={{textAlign:'center'}}>
              <CheckCircle size={48} color="#16a34a" style={{margin:'0.5rem auto'}}/>
              <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>Shift closed</div>
              <div style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>Sales recorded; cash is now in “awaiting deposit”.</div>
              <button onClick={()=>router.push('/dashboard')} style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>Back to Dashboard</button>
            </div>
          ) : (<>
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Reconciliation</div>
            {recon && (() => {
              const v = Number(recon.variance||0), short = v < -1, over = v > 1;
              const row = (l,val,bold) => <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:13.5,fontWeight:bold?700:400}}><span>{l}</span><span>{fmt(val)}</span></div>;
              return (
                <div style={{marginBottom:'1rem'}}>
                  {row('Wet sales (meter)', recon.wet_sales)}
                  {row('Bay dry sales', recon.dry_sales)}
                  {row('Less: credit', -Math.abs(recon.credit))}
                  <div style={{borderTop:'1px solid #eef0f2',margin:'4px 0'}}/>
                  {row('Expected collections', recon.expected, true)}
                  {row('Actual collected (cash+card+UPI)', recon.collections, true)}
                  <div style={{borderTop:'1px solid #eef0f2',margin:'4px 0'}}/>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',borderRadius:8,marginTop:4,
                    background: short?'#fef2f2':over?'#fff7ed':'#f0fdf4', color: short?'#991b1b':over?'#9a3412':'#166534'}}>
                    <span style={{fontWeight:700,display:'flex',alignItems:'center',gap:6}}>{short&&<AlertTriangle size={15}/>}{short?'Shortage':over?'Overage':'Tallied'}</span>
                    <span style={{fontWeight:800}}>{fmt(Math.abs(v))}</span>
                  </div>
                  {recon.unvalued_readings>0 && <div style={{fontSize:12,color:'#9a3412',marginTop:8}}>{recon.unvalued_readings} reading(s) couldn’t be valued yet (no prior opening / price) — seed with a dummy shift.</div>}
                  {recon.source_conflicts?.length>0 && (
                    <div style={{background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:8,padding:'8px 10px',marginTop:8}}>
                      <div style={{fontWeight:700,fontSize:12.5,color:'#92400e',marginBottom:4}}>⚠️ Manager vs attendant closing differs</div>
                      {recon.source_conflicts.map(c=>(
                        <div key={c.nozzle_id} style={{fontSize:12,color:'#92400e'}}>Nozzle {c.nozzle_number}: manager {c.manager} vs attendant {c.attendant} (Δ {c.delta>0?'+':''}{c.delta})</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            <button onClick={closeShift} disabled={busy==='close' || !allClosed} style={{width:'100%',height:48,background:allClosed?'#dc2626':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:allClosed?'pointer':'not-allowed'}}>{busy==='close'?'Closing…':'Close Shift'}</button>
          </>)}
        </div>
      )}
    </AppShell>
  );
}
