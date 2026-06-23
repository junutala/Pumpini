'use client';
// Start Shift — Open → Dipstick (opening stock, auto-volume) → Operators (each
// operator + opening cash + the nozzle(s) he mans, with each nozzle's opening
// meter). One operator can hold several nozzles (manpower shortage); the opening
// meter auto-carries from the prior shift's closing and is editable/scannable.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, ChevronRight, ArrowLeft, Droplets, X } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { markToTrueDip, dipToVolume } from '../../lib/calibration';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });
const fmtL = n => Number(n||0).toFixed(2);
const STEPS = ['Open', 'Dipstick', 'Operators'];

const readB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read image'));
  r.readAsDataURL(file);
});

export default function ShiftStartPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [step, setStep]       = useState(0);
  const [defs, setDefs]       = useState([]);
  const [users, setUsers]     = useState([]);
  const [shift, setShift]     = useState(null);
  const [attendants, setAttendants] = useState([]);
  const [nozzles, setNozzles] = useState([]);
  const [openShifts, setOpenShifts] = useState([]);
  const [open, setOpen]       = useState({ shift_number:1, date: today() });
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [prices, setPrices]   = useState([]);   // current selling price per fuel — parallel-run reminder

  // Dipstick step
  const [tanks, setTanks]     = useState([]);
  const [dips, setDips]       = useState({});       // tank_id -> entered mark-ordinal
  const [dipVol, setDipVol]   = useState({});       // tank_id -> manual volume (no-chart fallback)
  const [savedDips, setSavedDips] = useState({});   // tank_id -> true

  // Operators step
  const [asg, setAsg]         = useState({});       // { attendant_id, opening_cash }
  const [nozPick, setNozPick] = useState({});       // nozzle_id -> { selected, opening }
  const [openings, setOpenings] = useState({});     // nozzle_id -> suggested opening (prior close)
  const [scanning, setScanning] = useState('');

  const refreshOpen = () => api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
    .then(os => setOpenShifts(Array.isArray(os)?os:[])).catch(()=>{});

  useEffect(() => {
    if (!stationId) return;
    Promise.all([
      api.get(`/shifts/definitions/${stationId}`).catch(()=>[]),
      api.get(`/users?station_id=${stationId}&role=attendant`).catch(()=>[]),
      api.get(`/stations/${stationId}/nozzles`).catch(()=>[]),
      api.get('/shifts', { params:{ station_id: stationId, status:'open' } }).catch(()=>[]),
      api.get(`/dipstick/tanks/${stationId}`).catch(()=>[]),
      api.get(`/prices/${stationId}/current`).catch(()=>[]),
    ]).then(([d,u,n,os,tk,pr]) => {
      setDefs(Array.isArray(d)?d:[]); setUsers(Array.isArray(u)?u:[]);
      setNozzles((Array.isArray(n)?n:[]).filter(x=>x.is_active));
      setOpenShifts(Array.isArray(os)?os:[]);
      setTanks(Array.isArray(tk)?tk:[]);
      setPrices(Array.isArray(pr)?pr:[]);
    });
  }, [stationId]);

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

  const refreshShift = async (id) => {
    const d = await api.get(`/shifts/${id}`);
    setShift(d); setAttendants(d?.attendants || []);
    const ops = await api.get(`/shifts/${id}/nozzle-openings`).catch(()=>[]);
    const map = {}; (Array.isArray(ops)?ops:[]).forEach(o => { if (o.suggested_opening != null) map[o.nozzle_id] = o.suggested_opening; });
    setOpenings(map);
  };

  const openShift = async () => {
    setBusy(true); setErr('');
    try {
      const s = await api.post('/shifts', { ...open, station_id: stationId });
      await refreshShift(s.id); refreshOpen();
      setStep(1);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not open shift'); }
    setBusy(false);
  };

  const resumeShift = async (s) => {
    setBusy(true); setErr('');
    try { await refreshShift(s.id); setStep(1); }
    catch (e) { setErr(e.response?.data?.error || e.error || 'Could not load that shift'); }
    setBusy(false);
  };

  // ── Dipstick ──────────────────────────────────────────────────────
  const tankVol = (tank) => {
    const entered = dips[tank.id];
    if (entered === '' || entered == null) return null;
    if (tank.diameter_cm && tank.length_cm) return dipToVolume(tank.diameter_cm, tank.length_cm, markToTrueDip(entered));
    return dipVol[tank.id] !== '' && dipVol[tank.id] != null ? parseFloat(dipVol[tank.id]) : null;
  };
  const saveDip = async (tank) => {
    const entered = dips[tank.id];
    if (entered === '' || entered == null) return;
    const hasChart = tank.diameter_cm && tank.length_cm;
    const vol = tankVol(tank);
    if (vol == null) return setErr(`Tank ${tank.tank_number}: enter a volume.`);
    setBusy(true); setErr('');
    try {
      await api.post('/dipstick', {
        station_id: stationId, tank_id: tank.id, shift_id: shift.id,
        reading_type: 'opening',
        dip_cm: hasChart ? markToTrueDip(entered) : entered,
        volume_ltrs: vol,
      });
      setSavedDips(p => ({ ...p, [tank.id]: true }));
      // Reflect the save inline immediately (so the "last saved" line updates without a reload).
      setTanks(ts => ts.map(t => t.id === tank.id
        ? { ...t, last_dip_cm: (hasChart ? markToTrueDip(entered) : entered), last_reading: vol,
            last_reading_at: new Date().toISOString(), last_reading_type: 'opening' }
        : t));
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not save dip'); }
    setBusy(false);
  };

  // Only liquid tanks are dipped — CNG is sold by mass/pressure, never dip-measured.
  const dipTanks = tanks.filter(t => (t.fuel_type||'').toLowerCase() !== 'cng');
  const fmtWhen = (ts) => new Date(ts).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });

  // ── Operators ─────────────────────────────────────────────────────
  const assignedIds   = new Set(attendants.map(a => a.attendant_id));
  const assignedNozzles = new Set(attendants.flatMap(a => (a.nozzles||[]).map(nz => nz.nozzle_id)));
  const availNozzles  = nozzles.filter(n => !assignedNozzles.has(n.id));
  const pickNoz = (id, patch) => setNozPick(p => ({ ...p, [id]: { selected:true, opening: openings[id] ?? '', ...(p[id]||{}), ...patch } }));

  const scanMeter = async (nozzle, file) => {
    if (!file) return;
    setScanning(nozzle.id); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/ocr-meter', { shift_id: shift.id, nozzle_id: nozzle.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      if (r.reading) pickNoz(nozzle.id, { selected:true, opening: r.reading });
      if (!r.legible) setErr(`Nozzle ${nozzle.nozzle_number}: scan unclear${r.notes ? ` (${r.notes})` : ''} — check the reading.`);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Scan failed'); }
    setScanning('');
  };

  const addOperator = async () => {
    if (!asg.attendant_id) return setErr('Pick an operator');
    if (asg.opening_cash === undefined || asg.opening_cash === '') return setErr('Enter opening cash (0 if no float)');
    const chosen = nozzles.filter(n => nozPick[n.id]?.selected).map(n => {
      const v = nozPick[n.id].opening;
      const opening = v !== '' && v != null ? parseFloat(v) : (openings[n.id] != null ? Number(openings[n.id]) : 0);
      return { nozzle_id: n.id, opening_reading: opening };
    });
    setBusy(true); setErr('');
    try {
      await api.post(`/shifts/${shift.id}/assign`, { attendant_id: asg.attendant_id, opening_cash: asg.opening_cash, nozzles: chosen });
      setAsg({}); setNozPick({}); await refreshShift(shift.id); refreshOpen();
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Could not add operator'); }
    setBusy(false);
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>Dashboard</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>Start Shift</span>
      </div>

      {/* Current selling price — reminder to keep the system in step with the board during parallel run */}
      {prices.length>0 && (
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'8px 12px',marginBottom:'1rem'}}>
          <span style={{fontSize:11.5,fontWeight:800,color:'#92400e',textTransform:'uppercase',letterSpacing:'.04em'}}>Selling price in system</span>
          {prices.map(p=>(
            <span key={p.fuel_type} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:14,fontWeight:800}}>
              <span className={`fuel-chip fuel-${p.fuel_type}`} style={{textTransform:'capitalize'}}>{String(p.fuel_type).replace('_',' ')}</span>
              ₹{Number(p.price).toFixed(2)}
              {p.effective_from && <span style={{fontSize:10.5,fontWeight:500,color:'#a16207'}}>since {new Date(p.effective_from).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>}
            </span>
          ))}
          <span style={{fontSize:11.5,color:'#92400e',marginLeft:'auto'}}>⚠ Board price changed? Update it in <strong>Prices</strong> before the shift runs.</span>
        </div>
      )}

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
            {(slotTaken||allTaken) && <div style={{fontSize:12,color:'var(--text-3)',marginTop:8}}>{allTaken?'Every slot for this date is already open — resume one on the right.':'That slot is open already — pick another or resume on the right.'}</div>}
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
                    <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{dateKey(s.date)} · {s.attendant_count||0} operator{(s.attendant_count||0)===1?'':'s'}</div>
                  </div>
                  <button onClick={()=>resumeShift(s)} disabled={busy} style={{flexShrink:0,padding:'8px 12px',background:'#fff7ed',color:'#9a3412',border:'1.5px solid #fed7aa',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer'}}>Resume →</button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* STEP 1 — Dipstick (opening stock) */}
      {step===1 && shift && (
        <div className="card" style={{maxWidth:620}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><Droplets size={16} color="#0ea5e9"/>Opening dip readings</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>Enter each tank&apos;s dip (4 marks/cm). Volume is computed from the tank&apos;s calibration. This is the opening stock for today&apos;s reconciliation.</div>
          {dipTanks.length===0 && <div style={{color:'#aaa',fontSize:13}}>No dip-measured tanks configured.</div>}
          {dipTanks.map(tk => {
            const hasChart = tk.diameter_cm && tk.length_cm;
            const vol = tankVol(tk);
            return (
              <div key={tk.id} style={{marginBottom:12,paddingBottom:10,borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <div style={{width:120,fontSize:13,fontWeight:600}}>Tank {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                  <input style={{...inp,width:120}} type="number" step="0.1" placeholder={hasChart?'dip e.g. 64.2':'dip cm'}
                    value={dips[tk.id]||''} onChange={e=>{ setDips(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                  {hasChart
                    ? <div style={{minWidth:120,fontSize:13,fontWeight:600,color:'#0369a1'}}>{vol!=null?`${fmtL(vol)} L`:'—'}</div>
                    : <input style={{...inp,width:130}} type="number" step="0.01" placeholder="volume L"
                        value={dipVol[tk.id]||''} onChange={e=>{ setDipVol(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>}
                  <button onClick={()=>saveDip(tk)} disabled={busy||savedDips[tk.id]}
                    style={{padding:'8px 12px',borderRadius:8,border:'none',fontSize:12.5,fontWeight:700,cursor:savedDips[tk.id]?'default':'pointer',
                      background:savedDips[tk.id]?'#dcfce7':'#475569',color:savedDips[tk.id]?'#166534':'#fff'}}>
                    {savedDips[tk.id]?'✓ Saved':'Save'}
                  </button>
                  {!hasChart && <span style={{fontSize:11,color:'#b45309'}}>No calibration — type volume</span>}
                </div>
                {/* Last saved reading — so a blank entry box never looks like lost data. */}
                {tk.last_reading_at
                  ? <div style={{fontSize:11.5,color:'#475569',marginTop:5,marginLeft:130}}>
                      <span style={{color:'#16a34a',fontWeight:700}}>● Last saved</span>{' '}
                      {tk.last_reading_type ? `${tk.last_reading_type} ` : ''}dip {tk.last_dip_cm!=null?`${tk.last_dip_cm} cm`:'—'}
                      {tk.last_reading!=null?` → ${fmtL(tk.last_reading)} L`:''} · {fmtWhen(tk.last_reading_at)}
                    </div>
                  : <div style={{fontSize:11.5,color:'#94a3b8',marginTop:5,marginLeft:130}}>No reading saved yet for this tank.</div>}
              </div>
            );
          })}
          <button onClick={()=>setStep(2)} style={{width:'100%',height:46,marginTop:12,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:'pointer'}}>
            Next: Operators →
          </button>
        </div>
      )}

      {/* STEP 2 — Operators (+ their nozzles + opening meters) */}
      {step===2 && shift && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem',alignItems:'start'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Add an operator</div>
            <div style={{display:'grid',gap:10}}>
              <div><label className="label">Operator</label>
                <select style={inp} value={asg.attendant_id||''} onChange={e=>setAsg(p=>({...p,attendant_id:e.target.value}))}>
                  <option value="">Select…</option>
                  {users.filter(u=>!assignedIds.has(u.id)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select></div>
              <div><label className="label">Opening cash (₹)</label>
                <input style={inp} type="number" step="0.01" placeholder="Float handed over (0 if none)" value={asg.opening_cash||''} onChange={e=>setAsg(p=>({...p,opening_cash:e.target.value}))}/></div>

              <div>
                <label className="label">Nozzles he mans <span style={{fontWeight:400,color:'#888'}}>(tick each; opening auto-carries from last close)</span></label>
                {availNozzles.length===0 && <div style={{fontSize:12.5,color:'#aaa'}}>All nozzles are already assigned.</div>}
                {availNozzles.map(n=>{
                  const pick = nozPick[n.id]; const sel = !!pick?.selected;
                  const sug = openings[n.id];
                  const cur = pick?.opening ?? (sug ?? '');
                  const drift = sel && cur!=='' && sug!=null && Math.abs(Number(cur)-Number(sug))>1;
                  return (
                    <div key={n.id} style={{border:'1px solid '+(sel?'#fed7aa':'#eef0f2'),background:sel?'#fff7ed':'#fff',borderRadius:8,padding:'8px 10px',marginBottom:6}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                        <input type="checkbox" checked={sel} onChange={e=>{ if(e.target.checked) pickNoz(n.id,{selected:true}); else setNozPick(p=>({...p,[n.id]:{...(p[n.id]||{}),selected:false}})); }}/>
                        Nozzle {n.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{n.fuel_type}</span>
                      </label>
                      {sel && (
                        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                          <input style={{...inp,flex:1}} type="number" step="0.001" placeholder="Opening meter"
                            value={cur} onChange={e=>pickNoz(n.id,{opening:e.target.value})}/>
                          <label title="Scan the totalizer" style={{flexShrink:0,width:40,height:36,display:'flex',alignItems:'center',justifyContent:'center',background:scanning===n.id?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:scanning===n.id?'default':'pointer',fontSize:16}}>
                            {scanning===n.id?'…':'📷'}
                            <input type="file" accept="image/*" capture="environment" disabled={scanning===n.id} style={{display:'none'}} onChange={e=>{ scanMeter(n, e.target.files?.[0]); e.target.value=''; }}/>
                          </label>
                        </div>
                      )}
                      {drift && <div style={{fontSize:11,color:'#b45309',marginTop:4}}>⚠ differs from last close ({sug}) — verify handover</div>}
                    </div>
                  );
                })}
              </div>

              <button onClick={addOperator} disabled={busy} style={{height:42,background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}><Plus size={15} style={{verticalAlign:'middle'}}/> Add operator</button>
            </div>
          </div>

          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Operators ({attendants.length})</div>
            {attendants.length===0 ? <div style={{color:'#aaa',fontSize:13}}>No operators added yet.</div>
              : attendants.map(a=>(
                <div key={a.id} style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px',marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontWeight:700,fontSize:13.5}}>{a.attendant_name}</div>
                    <div style={{fontSize:12,color:'#888'}}>float ₹{Number(a.opening_cash||0).toLocaleString('en-IN')}</div>
                  </div>
                  {(a.nozzles||[]).length>0
                    ? <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
                        {a.nozzles.map(nz=>(
                          <span key={nz.nozzle_id} style={{fontSize:11.5,background:'#eef2ff',color:'#3730a3',borderRadius:99,padding:'2px 8px'}}>
                            N{nz.nozzle_number} · {nz.fuel_type} · open {Number(nz.opening_reading||0)}
                          </span>
                        ))}
                      </div>
                    : <div style={{fontSize:11.5,color:'#b45309',marginTop:4}}>No nozzles assigned</div>}
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
