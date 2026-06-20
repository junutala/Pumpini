'use client';
// Start Shift — guided 2-step flow: open the slot → add operators (name + opening
// cash float) → live. Manager-driven model: no nozzle/meter detail. Sales are
// captured per operator at End Shift (cash + UPI + card + credit). Readings/RFID/
// VPA stay in the data model (optional) but are off this simplified screen.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, ChevronRight, ArrowLeft } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });
const STEPS = ['Open', 'Operators', 'Opening meters'];

export default function ShiftStartPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [step, setStep]       = useState(0);
  const [defs, setDefs]       = useState([]);
  const [users, setUsers]     = useState([]);       // operators (all attendants — always available)
  const [shift, setShift]     = useState(null);     // the open shift once created
  const [attendants, setAttendants] = useState([]); // assigned operators
  const [nozzles, setNozzles] = useState([]);
  const [meters, setMeters]   = useState({});       // nozzle_id -> opening totalizer
  const [scanning, setScanning] = useState('');     // nozzle_id being OCR'd
  const [mismatches, setMismatches] = useState([]); // opening vs prior closing
  const [srcConflicts, setSrcConflicts] = useState([]); // manager vs attendant opening
  const [open, setOpen]       = useState({ shift_number:1, date: today() });
  const [asg, setAsg]         = useState({});       // add-operator form
  const [openShifts, setOpenShifts] = useState([]); // shifts already open at this station
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  const refreshOpen = () => api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
    .then(os => setOpenShifts(Array.isArray(os)?os:[])).catch(()=>{});

  useEffect(() => {
    if (!stationId) return;
    Promise.all([
      api.get(`/shifts/definitions/${stationId}`).catch(()=>[]),
      api.get(`/users?station_id=${stationId}&role=attendant`).catch(()=>[]),
      api.get(`/stations/${stationId}/nozzles`).catch(()=>[]),
      api.get('/shifts', { params:{ station_id: stationId, status:'open' } }).catch(()=>[]),
    ]).then(([d,u,n,os]) => {
      setDefs(Array.isArray(d)?d:[]); setUsers(Array.isArray(u)?u:[]);
      setNozzles((Array.isArray(n)?n:[]).filter(x=>x.is_active));
      setOpenShifts(Array.isArray(os)?os:[]);
    });
  }, [stationId]);

  // A slot already open for the chosen date can't be opened again — steer the form to a free one.
  const dateKey = d => String(d).slice(0,10);
  const takenSlots = new Set(openShifts.filter(s => dateKey(s.date) === open.date).map(s => s.shift_number));
  const slotTaken = takenSlots.has(open.shift_number);
  const allTaken = [1,2,3].every(n => takenSlots.has(n));
  useEffect(() => {
    if (takenSlots.has(open.shift_number)) {
      const free = [1,2,3].find(n => !takenSlots.has(n));
      if (free) setOpen(p => ({ ...p, shift_number: free }));
    }
  }, [openShifts, open.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = n => { const def = defs.find(d=>d.shift_number===n); return def ? `Shift ${n} — ${def.name} (${def.start_time}–${def.end_time})` : `Shift ${n}`; };
  const refreshShift = async (id) => { const d = await api.get(`/shifts/${id}`); setShift(d); setAttendants(d?.attendants||[]); };

  const openShift = async () => {
    setBusy(true); setErr('');
    try {
      const s = await api.post('/shifts', { ...open, station_id: stationId });
      await refreshShift(s.id); refreshOpen();
      setStep(1);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not open shift'); }
    setBusy(false);
  };

  // Re-enter an already-open shift to add late operators or capture meters.
  const resumeShift = async (s) => {
    setBusy(true); setErr(''); setMeters({}); setMismatches([]); setSrcConflicts([]);
    try { await refreshShift(s.id); setStep(1); }
    catch (e) { setErr(e.response?.data?.error || e.error || 'Could not load that shift'); }
    setBusy(false);
  };

  const addOperator = async () => {
    if (!asg.attendant_id) return setErr('Pick an operator');
    if (asg.opening_cash === undefined || asg.opening_cash === '') return setErr('Enter opening cash (0 if no float is given)');
    setBusy(true); setErr('');
    try {
      await api.post(`/shifts/${shift.id}/assign`, { attendant_id: asg.attendant_id, opening_cash: asg.opening_cash });
      setAsg({}); await refreshShift(shift.id); refreshOpen();
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not add operator'); }
    setBusy(false);
  };

  const f = (k,v) => setAsg(p=>({ ...p, [k]: v }));
  const assignedIds = new Set(attendants.map(a=>a.attendant_id));

  // Snap the totalizer → backend → Claude reads it → fills the opening field.
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
      const r = await api.post('/reconcile/ocr-meter', { shift_id: shift.id, nozzle_id: nozzle.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      if (r.reading) { setMeters(p => ({ ...p, [nozzle.id]: r.reading })); setMismatches([]); setSrcConflicts([]); }
      if (!r.legible) setErr(`Nozzle ${nozzle.nozzle_number}: scan unclear${r.notes ? ` (${r.notes})` : ''} — check the reading.`);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Scan failed'); }
    setScanning('');
  };

  // Save opening readings + run the handover check vs the prior shift's closings.
  const startLive = async () => {
    setBusy(true); setErr('');
    try {
      const readings = nozzles.map(n => ({ nozzle_id: n.id, opening_reading: meters[n.id] }))
        .filter(r => r.opening_reading !== '' && r.opening_reading != null);
      if (readings.length) {
        const r = await api.post('/reconcile/shift-opening-meters', { shift_id: shift.id, readings });
        if (r.mismatches?.length || r.source_conflicts?.length) {
          setMismatches(r.mismatches || []); setSrcConflicts(r.source_conflicts || []); setBusy(false); return;
        }
      }
      router.push('/dashboard');
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not save opening meters'); }
    setBusy(false);
  };

  return (
    <AppShell>
      {/* Breadcrumb */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>Dashboard</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>Start Shift</span>
      </div>

      {/* Stepper */}
      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s} onClick={()=>{ if(shift) setStep(i); }} disabled={!shift && i>0}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),
              background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:shift?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {s}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* STEP 0 — Open */}
      {step===0 && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'440px 1fr',gap:'1.25rem',alignItems:'start'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'1rem'}}>Open a new shift</div>
            <div style={{marginBottom:'1rem'}}>
              <label className="label">Shift slot</label>
              <select style={inp} value={open.shift_number} onChange={e=>setOpen(p=>({...p,shift_number:parseInt(e.target.value)}))}>
                {[1,2,3].map(n=><option key={n} value={n} disabled={takenSlots.has(n)}>{label(n)}{takenSlots.has(n)?' — already open':''}</option>)}
              </select>
            </div>
            <div style={{marginBottom:'1.25rem'}}>
              <label className="label">Date</label>
              <input style={inp} type="date" value={open.date} onChange={e=>setOpen(p=>({...p,date:e.target.value}))}/>
            </div>
            <button onClick={openShift} disabled={busy||slotTaken||allTaken} style={{width:'100%',height:46,background:(slotTaken||allTaken)?'#e5e3de':'#FF6B00',color:(slotTaken||allTaken)?'#888':'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:(busy||slotTaken||allTaken)?'default':'pointer'}}>
              {busy?'Opening…':allTaken?'All slots open':slotTaken?'This slot is already open':'Open Shift →'}
            </button>
            {(slotTaken||allTaken) && <div style={{fontSize:12,color:'var(--text-3)',marginTop:8}}>{allTaken?'Every slot for this date is already open — use “Add operators” on the right.':'That slot is open already — pick another slot or use “Add operators” on the right.'}</div>}
          </div>

          <div className="card">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.5rem'}}>
              <div style={{fontWeight:700,fontSize:15}}>Currently open shifts</div>
              {openShifts.length>0 && <span style={{fontSize:12,fontWeight:700,color:'#16a34a',background:'#dcfce7',borderRadius:99,padding:'2px 10px'}}>{openShifts.length} open</span>}
            </div>
            {openShifts.length===0
              ? <div style={{color:'var(--text-3)',fontSize:13,padding:'8px 0'}}>No shifts are open right now.</div>
              : openShifts.map(s=>(
                <div key={s.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,background:'#f8fafc',border:'1px solid #eef0f2',borderRadius:10,padding:'10px 12px',marginBottom:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:14}}>{label(s.shift_number)}</div>
                    <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{dateKey(s.date)} · {s.attendant_count||0} operator{(s.attendant_count||0)===1?'':'s'}{s.start_time?` · opened ${new Date(s.start_time).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true})}`:''}</div>
                  </div>
                  <button onClick={()=>resumeShift(s)} disabled={busy} style={{flexShrink:0,padding:'8px 12px',background:'#fff7ed',color:'#9a3412',border:'1.5px solid #fed7aa',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer'}}>Add operators →</button>
                </div>
              ))}
            <div style={{fontSize:12,color:'var(--text-3)',marginTop:6,lineHeight:1.5}}>These are read-only here. Tap <strong>Add operators</strong> to bring in late or staggered staff, or to capture opening meters — you can return any time while the shift is open.</div>
          </div>
        </div>
      )}

      {/* STEP 1 — Operators */}
      {step===1 && shift && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Add an operator</div>
            <div style={{display:'grid',gap:10}}>
              <div><label className="label">Operator</label>
                <select style={inp} value={asg.attendant_id||''} onChange={e=>f('attendant_id',e.target.value)}>
                  <option value="">Select…</option>
                  {users.filter(u=>!assignedIds.has(u.id)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select></div>
              <div><label className="label">Opening cash (₹)</label>
                <input style={inp} type="number" step="0.01" placeholder="Float handed over (0 if none)" value={asg.opening_cash||''} onChange={e=>f('opening_cash',e.target.value)}/></div>
              <button onClick={addOperator} disabled={busy} style={{height:42,background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}><Plus size={15} style={{verticalAlign:'middle'}}/> Add operator</button>
            </div>
          </div>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Operators ({attendants.length})</div>
            {attendants.length===0 ? <div style={{color:'#aaa',fontSize:13}}>No operators added yet.</div>
              : attendants.map(a=>(
                <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc',borderRadius:8,padding:'8px 10px',marginBottom:6}}>
                  <div style={{fontWeight:600,fontSize:13}}>{a.attendant_name}</div>
                  <div style={{fontSize:12,color:'#888'}}>float ₹{Number(a.opening_cash||0).toLocaleString('en-IN')}</div>
                </div>
              ))}
            <button onClick={()=>setStep(2)} disabled={attendants.length===0}
              style={{width:'100%',height:46,marginTop:12,background:attendants.length?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:attendants.length?'pointer':'not-allowed'}}>
              Next: Opening meters →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — Opening meters (handover check) */}
      {step===2 && shift && (
        <div className="card" style={{maxWidth:560}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem'}}>Opening meter readings</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>Snap each nozzle&apos;s totalizer (or type it). It should match the previous shift&apos;s closing — we flag any that don&apos;t. Optional, but it&apos;s the handover tripwire.</div>
          {nozzles.length===0 && <div style={{color:'#aaa',fontSize:13}}>No nozzles configured.</div>}
          {nozzles.map(n=>(
            <div key={n.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:140,fontSize:13,fontWeight:600}}>Nozzle {n.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{n.fuel_type}</span></div>
              <input style={{...inp,flex:1}} type="number" step="0.001" placeholder="Opening totalizer" value={meters[n.id]||''} onChange={e=>{ setMeters(p=>({...p,[n.id]:e.target.value})); setMismatches([]); setSrcConflicts([]); }}/>
              <label title="Scan the totalizer" style={{flexShrink:0,width:42,height:38,display:'flex',alignItems:'center',justifyContent:'center',background:scanning===n.id?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:scanning===n.id?'default':'pointer',fontSize:17}}>
                {scanning===n.id?'…':'📷'}
                <input type="file" accept="image/*" capture="environment" disabled={scanning===n.id} style={{display:'none'}} onChange={e=>{ scanMeter(n, e.target.files?.[0]); e.target.value=''; }}/>
              </label>
            </div>
          ))}
          {mismatches.length>0 && (
            <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:10,padding:'10px 12px',marginTop:'0.75rem'}}>
              <div style={{fontWeight:700,fontSize:13,color:'#991b1b',marginBottom:6}}>⚠️ Handover mismatch — opening ≠ last shift&apos;s closing</div>
              {mismatches.map(m=>(
                <div key={m.nozzle_id} style={{fontSize:12.5,color:'#991b1b'}}>Nozzle {m.nozzle_number}: opening {m.opening} vs last close {m.prior_closing} (Δ {m.delta>0?'+':''}{m.delta})</div>
              ))}
              <div style={{fontSize:12,color:'#9a3412',marginTop:6}}>Investigate, or start anyway if you&apos;ve verified it.</div>
            </div>
          )}
          {srcConflicts.length>0 && (
            <div style={{background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:10,padding:'10px 12px',marginTop:'0.75rem'}}>
              <div style={{fontWeight:700,fontSize:13,color:'#92400e',marginBottom:6}}>⚠️ Manager vs attendant opening differs</div>
              {srcConflicts.map(c=>(
                <div key={c.nozzle_id} style={{fontSize:12.5,color:'#92400e'}}>Nozzle {c.nozzle_number}: manager {c.manager} vs attendant {c.attendant} (Δ {c.delta>0?'+':''}{c.delta})</div>
              ))}
            </div>
          )}
          <button onClick={(mismatches.length||srcConflicts.length) ? ()=>router.push('/dashboard') : startLive} disabled={busy}
            style={{width:'100%',height:46,marginTop:'1rem',background: (mismatches.length||srcConflicts.length)?'#dc2626':'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:'pointer'}}>
            {busy?'Saving…':(mismatches.length||srcConflicts.length)?'Start anyway — Shift is live':'Start — Shift is live ✓'}
          </button>
        </div>
      )}
    </AppShell>
  );
}
