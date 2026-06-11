'use client';
// Shift Start — one guided, breadcrumbed screen for everything a manager does when
// opening a shift: open the slot → assign operators (nozzle, opening cash float,
// opening meter, UPI VPA) → record opening tank dips. Reuses existing endpoints.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, Trash2, ChevronRight, ArrowLeft } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });
const STEPS = ['Open', 'Operators', 'Opening dips'];

export default function ShiftStartPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [step, setStep]       = useState(0);
  const [defs, setDefs]       = useState([]);
  const [nozzles, setNozzles] = useState([]);
  const [users, setUsers]     = useState([]);
  const [rfid, setRfid]       = useState([]);
  const [tanks, setTanks]     = useState([]);
  const [shift, setShift]     = useState(null);     // the open shift once created
  const [attendants, setAttendants] = useState([]); // assigned operators
  const [open, setOpen]       = useState({ shift_number:1, date: today() });
  const [asg, setAsg]         = useState({});       // add-operator form
  const [dips, setDips]       = useState({});       // tank_id -> volume
  const [dipsDone, setDipsDone] = useState({});     // tank_id -> bool
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    if (!stationId) return;
    Promise.all([
      api.get(`/shifts/definitions/${stationId}`).catch(()=>[]),
      api.get(`/stations/${stationId}/nozzles`).catch(()=>[]),
      api.get(`/users?station_id=${stationId}&role=attendant`).catch(()=>[]),
      api.get(`/rfid?station_id=${stationId}`).catch(()=>[]),
      api.get(`/stations/${stationId}/tanks`).catch(()=>[]),
    ]).then(([d,n,u,r,t]) => {
      setDefs(Array.isArray(d)?d:[]); setNozzles(Array.isArray(n)?n:[]);
      setUsers(Array.isArray(u)?u:[]); setRfid(Array.isArray(r)?r:[]); setTanks(Array.isArray(t)?t:[]);
    });
  }, [stationId]);

  const label = n => { const def = defs.find(d=>d.shift_number===n); return def ? `Shift ${n} — ${def.name} (${def.start_time}–${def.end_time})` : `Shift ${n}`; };

  const refreshShift = async (id) => { const d = await api.get(`/shifts/${id}`); setShift(d); setAttendants(d?.attendants||[]); };

  const openShift = async () => {
    setBusy(true); setErr('');
    try {
      const s = await api.post('/shifts', { ...open, station_id: stationId });
      await refreshShift(s.id);
      setStep(1);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not open shift'); }
    setBusy(false);
  };

  const addOperator = async () => {
    if (!asg.attendant_id) return setErr('Pick an operator');
    if (!asg.nozzle_id)    return setErr('Pick a nozzle');
    setBusy(true); setErr('');
    try {
      await api.post(`/shifts/${shift.id}/assign`, asg);
      setAsg({}); await refreshShift(shift.id);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not assign'); }
    setBusy(false);
  };

  const saveDip = async (tank) => {
    const vol = parseFloat(dips[tank.id]);
    if (!(vol >= 0)) return setErr('Enter a volume');
    setBusy(true); setErr('');
    try {
      await api.post('/dipstick', { station_id: stationId, tank_id: tank.id, shift_id: shift.id, reading_type:'opening', volume_ltrs: vol });
      setDipsDone(p=>({ ...p, [tank.id]: true }));
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not save dip'); }
    setBusy(false);
  };

  const f = (k,v) => setAsg(p=>({ ...p, [k]: v }));
  const usedNozzles = new Set(attendants.map(a=>a.nozzle_id));

  return (
    <AppShell>
      {/* Breadcrumb / stepper */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/shifts')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>Shifts</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>Shift Start</span>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s} onClick={()=>{ if(shift && i<=step) setStep(i); }} disabled={!shift && i>0}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),
              background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:shift&&i<=step?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {s}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* STEP 0 — Open */}
      {step===0 && (
        <div className="card" style={{maxWidth:460}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'1rem'}}>Open the shift</div>
          <div style={{marginBottom:'1rem'}}>
            <label className="label">Shift slot</label>
            <select style={inp} value={open.shift_number} onChange={e=>setOpen(p=>({...p,shift_number:parseInt(e.target.value)}))}>
              {[1,2,3].map(n=><option key={n} value={n}>{label(n)}</option>)}
            </select>
          </div>
          <div style={{marginBottom:'1.25rem'}}>
            <label className="label">Date</label>
            <input style={inp} type="date" value={open.date} onChange={e=>setOpen(p=>({...p,date:e.target.value}))}/>
          </div>
          <button onClick={openShift} disabled={busy} style={{width:'100%',height:46,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>
            {busy?'Opening…':'Open Shift →'}
          </button>
        </div>
      )}

      {/* STEP 1 — Operators */}
      {step===1 && shift && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Assign an operator</div>
            <div style={{display:'grid',gap:10}}>
              <div><label className="label">Operator</label>
                <select style={inp} value={asg.attendant_id||''} onChange={e=>f('attendant_id',e.target.value)}>
                  <option value="">Select…</option>
                  {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select></div>
              <div><label className="label">Nozzle</label>
                <select style={inp} value={asg.nozzle_id||''} onChange={e=>f('nozzle_id',e.target.value)}>
                  <option value="">Select…</option>
                  {nozzles.filter(n=>n.is_active && !usedNozzles.has(n.id)).map(n=><option key={n.id} value={n.id}>Nozzle {n.nozzle_number} — {n.fuel_type}</option>)}
                </select></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><label className="label">Opening cash (₹)</label><input style={inp} type="number" step="0.01" value={asg.opening_cash||''} onChange={e=>f('opening_cash',e.target.value)}/></div>
                <div><label className="label">Opening meter</label><input style={inp} type="number" step="0.001" value={asg.opening_reading||''} onChange={e=>f('opening_reading',e.target.value)}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><label className="label">RFID tag</label>
                  <select style={inp} value={asg.rfid_tag_id||''} onChange={e=>f('rfid_tag_id',e.target.value||null)}>
                    <option value="">None</option>
                    {rfid.map(r=><option key={r.id} value={r.id}>{r.tag_uid}</option>)}
                  </select></div>
                <div><label className="label">UPI VPA</label><input style={inp} placeholder="operator@upi" value={asg.upi_vpa||''} onChange={e=>f('upi_vpa',e.target.value)}/></div>
              </div>
              <button onClick={addOperator} disabled={busy} style={{height:42,background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}><Plus size={15} style={{verticalAlign:'middle'}}/> Add operator</button>
            </div>
          </div>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Assigned ({attendants.length})</div>
            {attendants.length===0 ? <div style={{color:'#aaa',fontSize:13}}>No operators assigned yet.</div>
              : attendants.map(a=>(
                <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc',borderRadius:8,padding:'8px 10px',marginBottom:6}}>
                  <div><div style={{fontWeight:600,fontSize:13}}>{a.attendant_name}</div>
                    <div style={{fontSize:11,color:'#888'}}>N{a.nozzle_number} · {a.fuel_type} · float ₹{Number(a.opening_cash||0).toLocaleString('en-IN')}</div></div>
                </div>
              ))}
            <button onClick={()=>setStep(2)} disabled={attendants.length===0}
              style={{width:'100%',height:44,marginTop:10,background:attendants.length?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:attendants.length?'pointer':'not-allowed'}}>
              Next: Opening dips →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — Opening dips */}
      {step===2 && shift && (
        <div className="card" style={{maxWidth:560}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem'}}>Opening tank dips</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>Record the physical dip volume per tank to start the wet-stock book for this shift.</div>
          {tanks.length===0 && <div style={{color:'#aaa',fontSize:13}}>No tanks configured.</div>}
          {tanks.map(t=>(
            <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:110,fontSize:13,fontWeight:600}}>T{t.tank_number} <span style={{color:'#888',fontWeight:400}}>{t.fuel_type}</span></div>
              <input style={{...inp,flex:1}} type="number" step="0.1" placeholder="Opening volume (L)" value={dips[t.id]||''} onChange={e=>setDips(p=>({...p,[t.id]:e.target.value}))} disabled={dipsDone[t.id]}/>
              {dipsDone[t.id]
                ? <span style={{color:'#16a34a',display:'flex',alignItems:'center',gap:4,fontSize:13,fontWeight:600,width:90}}><Check size={15}/>Saved</span>
                : <button onClick={()=>saveDip(t)} disabled={busy} style={{width:90,height:38,background:'#475569',color:'#fff',border:'none',borderRadius:8,fontWeight:600,cursor:'pointer',fontSize:13}}>Save</button>}
            </div>
          ))}
          <button onClick={()=>router.push('/shifts')}
            style={{width:'100%',height:46,marginTop:'1rem',background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:'pointer'}}>
            Finish — Shift is live ✓
          </button>
          <div style={{fontSize:12,color:'var(--text-3)',marginTop:8,textAlign:'center'}}>Dips are optional to finish, but recommended for wet-stock reconciliation.</div>
        </div>
      )}
    </AppShell>
  );
}
