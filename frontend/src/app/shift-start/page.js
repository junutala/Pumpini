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
const STEPS = ['Open', 'Operators'];

export default function ShiftStartPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [step, setStep]       = useState(0);
  const [defs, setDefs]       = useState([]);
  const [users, setUsers]     = useState([]);       // operators (all attendants — always available)
  const [shift, setShift]     = useState(null);     // the open shift once created
  const [attendants, setAttendants] = useState([]); // assigned operators
  const [open, setOpen]       = useState({ shift_number:1, date: today() });
  const [asg, setAsg]         = useState({});       // add-operator form
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    if (!stationId) return;
    Promise.all([
      api.get(`/shifts/definitions/${stationId}`).catch(()=>[]),
      api.get(`/users?station_id=${stationId}&role=attendant`).catch(()=>[]),
    ]).then(([d,u]) => {
      setDefs(Array.isArray(d)?d:[]); setUsers(Array.isArray(u)?u:[]);
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
    if (asg.opening_cash === undefined || asg.opening_cash === '') return setErr('Enter opening cash (0 if no float is given)');
    setBusy(true); setErr('');
    try {
      await api.post(`/shifts/${shift.id}/assign`, { attendant_id: asg.attendant_id, opening_cash: asg.opening_cash });
      setAsg({}); await refreshShift(shift.id);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not add operator'); }
    setBusy(false);
  };

  const f = (k,v) => setAsg(p=>({ ...p, [k]: v }));
  const assignedIds = new Set(attendants.map(a=>a.attendant_id));

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
            <button onClick={()=>router.push('/dashboard')} disabled={attendants.length===0}
              style={{width:'100%',height:46,marginTop:12,background:attendants.length?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:attendants.length?'pointer':'not-allowed'}}>
              Start — Shift is live ✓
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
