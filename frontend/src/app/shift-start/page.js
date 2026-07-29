'use client';
// Start Shift — Open → Dipstick (opening stock, auto-volume) → Operators (each
// operator + opening cash + the nozzle(s) he mans, with each nozzle's opening
// meter). One operator can hold several nozzles (manpower shortage); the opening
// meter auto-carries from the prior shift's closing and is editable/scannable.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { Check, Plus, ChevronRight, ArrowLeft, Droplets, X, AlertTriangle } from 'lucide-react';
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
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
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
  const [shiftDips, setShiftDips] = useState(new Set()); // tank_ids already dipped for THIS shift (server)
  const [dipWarn, setDipWarn] = useState(null);     // [{tank_number, fuel_type}] awaiting acknowledgement

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
      setDefs(Array.isArray(d)?d:[]); setUsers((Array.isArray(u)?u:[]).filter(x=>x.is_active!==false));
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

  const label = n => { const def = defs.find(d=>d.shift_number===n); const sh = tc('sstart.shiftWord','Shift'); return def ? `${sh} ${n} — ${def.name} (${def.start_time}–${def.end_time})` : `${sh} ${n}`; };

  const refreshShift = async (id) => {
    const d = await api.get(`/shifts/${id}`);
    setShift(d); setAttendants(d?.attendants || []);
    const ops = await api.get(`/shifts/${id}/nozzle-openings`).catch(()=>[]);
    const map = {}; (Array.isArray(ops)?ops:[]).forEach(o => { if (o.suggested_opening != null) map[o.nozzle_id] = o.suggested_opening; });
    setOpenings(map);
    // Which tanks ALREADY have an opening dip stored for this shift, so resuming or
    // refreshing never nags about readings that are safely in.
    const dr = await api.get('/dipstick', { params:{ station_id: stationId, shift_id: id } }).catch(()=>[]);
    setShiftDips(new Set((Array.isArray(dr)?dr:[])
      .filter(x => x.reading_type === 'opening').map(x => x.tank_id)));
  };

  const openShift = async () => {
    setBusy(true); setErr('');
    try {
      const s = await api.post('/shifts', { ...open, station_id: stationId });
      await refreshShift(s.id); refreshOpen();
      setStep(1);
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errOpenShift','Could not open shift')); }
    setBusy(false);
  };

  const resumeShift = async (s) => {
    setBusy(true); setErr('');
    try { await refreshShift(s.id); setStep(1); }
    catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errLoadShift','Could not load that shift')); }
    setBusy(false);
  };

  // An orphan (opened by mistake) can be deleted only when it has NO operators AND
  // another shift the same day DOES have operators — never the real working shift.
  const canDelete = (s) => (s.attendant_count||0) === 0 &&
    openShifts.some(o => o.id !== s.id && dateKey(o.date) === dateKey(s.date) && (o.attendant_count||0) > 0);
  const deleteShift = async (s) => {
    if (!window.confirm(tc('sstart.confirmDeleteShift','Delete this empty shift opened by mistake? This cannot be undone.'))) return;
    setBusy(true); setErr('');
    try { await api.delete(`/shifts/${s.id}`); refreshOpen(); }
    catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errDeleteShift','Could not delete shift')); }
    setBusy(false);
  };

  // ── Dipstick ──────────────────────────────────────────────────────
  // Volume for a tank — from the DIP (a physical check) if a dip was entered, else
  // straight from the LITRES field (a reading typed off the ATG/HPCL system).
  const tankVol = (tank) => {
    const dip = dips[tank.id], litres = dipVol[tank.id];
    const hasChart = tank.diameter_cm && tank.length_cm;
    if (dip !== '' && dip != null) {
      if (hasChart) return dipToVolume(tank.diameter_cm, tank.length_cm, markToTrueDip(dip));
      return litres !== '' && litres != null ? parseFloat(litres) : null;  // no chart → needs manual litres
    }
    return litres !== '' && litres != null ? parseFloat(litres) : null;      // litres entered directly (system)
  };
  // Something typed into a tank's boxes that is NOT yet in the database. This is the
  // difference between "no reading" and "reading lost": the per-tank Save used to be
  // the ONLY writer, so a manager who typed a dip and pressed on lost it silently —
  // two live outlets ran a whole month with zero dips that way, which left their
  // stock reconciliation permanently blank.
  const isDirty = (tank) => !savedDips[tank.id] &&
    ((dips[tank.id] !== '' && dips[tank.id] != null) ||
     (dipVol[tank.id] !== '' && dipVol[tank.id] != null));

  // A tank is covered if it was saved just now or already has a reading on the server.
  const hasReading = (tank) => !!savedDips[tank.id] || shiftDips.has(tank.id);

  // Persist ONE tank. Returns true on success. The caller owns busy/err so the
  // per-tank button and the bulk flush below can share this single writer.
  const persistDip = async (tank) => {
    const dip = dips[tank.id], litres = dipVol[tank.id];
    const hasDip = dip !== '' && dip != null;
    const hasLitres = litres !== '' && litres != null;
    if (!hasDip && !hasLitres) return true;      // nothing typed — not a failure
    const hasChart = tank.diameter_cm && tank.length_cm;
    const vol = tankVol(tank);
    if (vol == null) {
      setErr(tc('sstart.errTankVolume','Tank {n}: enter a dip or a litres value.').replace('{n}', tank.tank_number));
      return false;
    }
    // Dip entered → physical reading (store dip_cm). Litres only → system (ATG/HPCL)
    // reading: dip_cm stays null, which is how we tell the two apart.
    const dip_cm = hasDip ? (hasChart ? markToTrueDip(dip) : parseFloat(dip)) : null;
    try {
      await api.post('/dipstick', {
        station_id: stationId, tank_id: tank.id, shift_id: shift.id,
        reading_type: 'opening', dip_cm, volume_ltrs: vol,
      });
      setSavedDips(p => ({ ...p, [tank.id]: true }));
      setShiftDips(s => new Set(s).add(tank.id));
      // Reflect the save inline immediately (so the "last saved" line updates without a reload).
      setTanks(ts => ts.map(t => t.id === tank.id
        ? { ...t, last_dip_cm: dip_cm, last_reading: vol,
            last_reading_at: new Date().toISOString(), last_reading_type: 'opening' }
        : t));
      return true;
    } catch (e) {
      setErr(e.response?.data?.error || e.error || tc('sstart.errSaveDip','Could not save dip'));
      return false;
    }
  };

  const saveDip = async (tank) => { setBusy(true); setErr(''); await persistDip(tank); setBusy(false); };

  // Save everything typed but not yet saved. Called before leaving the dip step so
  // pressing on can never throw away a reading the manager actually entered.
  const flushDips = async () => {
    const pending = dipTanks.filter(isDirty);
    if (!pending.length) return true;
    setBusy(true); setErr('');
    let ok = true;
    for (const tk of pending) { if (!(await persistDip(tk))) ok = false; }
    setBusy(false);
    return ok;
  };

  // ANY navigation off the dip step commits what was typed first — going back must
  // not throw a reading away either. Moving FORWARD additionally hard-stops when a
  // tank still has no opening dip: reconciliation is impossible without it, so this
  // is a blocking prompt naming the tanks, not a note that can be scrolled past.
  const goFromDipStep = async (target) => {
    if (!(await flushDips())) return;                 // a save failed — err is shown, stay put
    if (target > 1) {
      const missing = dipTanks.filter(tk => !hasReading(tk));
      if (missing.length) { setDipWarn(missing); return; }
    }
    setStep(target);
  };
  const leaveDipStep = () => goFromDipStep(2);

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
      if (!r.legible) setErr(tc('sstart.errScanUnclear','Nozzle {n}: scan unclear').replace('{n}', nozzle.nozzle_number) + (r.notes ? ` (${r.notes})` : '') + tc('sstart.errScanCheck',' — check the reading.'));
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errScanFailed','Scan failed')); }
    setScanning('');
  };

  // Scan the whole printed pump slip (Slip A/B) — fills the OPENING meter for
  // every nozzle on it, matched by label = "{pump}.{nozzle}" (e.g. 1.1).
  const scanSlip = async (file) => {
    if (!file || !shift) return;
    setScanning('slip'); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/parse-slip', { shift_id: shift.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      let matched = 0; const miss = [];
      (r.nozzles || []).forEach(n => {
        if (n.cumulative_volume == null) return;
        const noz = nozzles.find(x => String(x.nozzle_number) === n.label);
        if (noz) { pickNoz(noz.id, { selected:true, opening: n.cumulative_volume }); matched++; }
        else if (n.label) miss.push(n.label);
      });
      if (!matched) setErr(tc('sstart.slipNoMatch','Slip read, but no nozzle matched. Label nozzles as pump.nozzle (e.g. {ex}).').replace('{ex}', `${r.pump_id||'1'}.1`));
      else {
        let msg = tc('sstart.slipFilled','Filled {n} opening reading(s) from the slip.').replace('{n}', matched);
        if (miss.length)  msg += ' ' + tc('sstart.slipNoMatchSome','No app nozzle for: {x}.').replace('{x}', miss.join(', '));
        if (!r.legible)   msg += ' ' + tc('sstart.slipVerify','⚠ Some digits unclear — verify.');
        setErr(msg);
      }
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.slipFailed','Slip scan failed')); }
    setScanning('');
  };

  const addOperator = async () => {
    if (!asg.attendant_id) { setErr(tc('sstart.errPickOperator','Pick an operator')); return false; }
    if (asg.opening_cash === undefined || asg.opening_cash === '') { setErr(tc('sstart.errOpeningCash','Enter opening cash (0 if no float)')); return false; }
    const chosen = nozzles.filter(n => nozPick[n.id]?.selected).map(n => {
      const v = nozPick[n.id].opening;
      const opening = v !== '' && v != null ? parseFloat(v) : (openings[n.id] != null ? Number(openings[n.id]) : 0);
      return { nozzle_id: n.id, opening_reading: opening };
    });
    setBusy(true); setErr('');
    try {
      await api.post(`/shifts/${shift.id}/assign`, { attendant_id: asg.attendant_id, opening_cash: asg.opening_cash, nozzles: chosen });
      setAsg({}); setNozPick({}); await refreshShift(shift.id); refreshOpen();
      return true;
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errAddOperator','Could not add operator')); return false; }
    finally { setBusy(false); }
  };

  // An operator is "ready" once picked with at least one nozzle ticked. The Start
  // CTA below goes live the moment ONE operator's readings are in — if the form
  // holds an un-added operator, we add him first (he goes live immediately), then
  // finish. No need to wait for the rest of the operators.
  const formReady = !!asg.attendant_id && nozzles.some(n => nozPick[n.id]?.selected);
  const startShift = async () => {
    if (formReady) { const ok = await addOperator(); if (!ok) return; }
    else if (attendants.length === 0) { setErr(tc('sstart.errNeedOperatorToStart','Add an operator with their nozzle readings to start.')); return; }
    router.push('/dashboard');
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('sstart.dashboard','Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('sstart.startShift','Start Shift')}</span>
      </div>

      {/* Current selling price — reminder to keep the system in step with the board during parallel run */}
      {prices.length>0 && (
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'8px 12px',marginBottom:'1rem'}}>
          <span style={{fontSize:11.5,fontWeight:800,color:'#92400e',textTransform:'uppercase',letterSpacing:'.04em'}}>{tc('sstart.sellingPriceInSystem','Selling price in system')}</span>
          {prices.map(p=>(
            <span key={p.fuel_type} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:14,fontWeight:800}}>
              <span className={`fuel-chip fuel-${p.fuel_type}`} style={{textTransform:'capitalize'}}>{String(p.fuel_type).replace('_',' ')}</span>
              ₹{Number(p.price).toFixed(2)}
              {p.effective_from && <span style={{fontSize:10.5,fontWeight:500,color:'#a16207'}}>{tc('sstart.since','since')} {new Date(p.effective_from).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>}
            </span>
          ))}
          <span style={{fontSize:11.5,color:'#92400e',marginLeft:'auto'}}>⚠ {tc('sstart.boardPriceChangedPre','Board price changed? Update it in')} <strong>{tc('sstart.pricesLink','Prices')}</strong> {tc('sstart.boardPriceChangedPost','before the shift runs.')}</span>
        </div>
      )}

      {/* Stepper */}
      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          // Navigating OFF the dip step via a chip goes through the same commit (and,
          // forwards, the same check) as the Next button — the chips can't slip past it.
          <button key={s} onClick={()=>{ if(!shift) return; if(step===1 && i!==1) goFromDipStep(i); else setStep(i); }} disabled={!shift && i>0}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),
              background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:shift?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {tc('sstart.step'+s, s)}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* STEP 0 — Open */}
      {step===0 && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'440px 1fr',gap:'1.25rem',alignItems:'start'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'1rem'}}>{tc('sstart.openANewShift','Open a new shift')}</div>
            <div style={{marginBottom:'1rem'}}>
              <label className="label">{tc('sstart.shiftSlot','Shift slot')}</label>
              <select style={inp} value={open.shift_number} onChange={e=>setOpen(p=>({...p,shift_number:parseInt(e.target.value)}))}>
                {[1,2,3].map(n=><option key={n} value={n} disabled={takenSlots.has(n)}>{label(n)}{takenSlots.has(n)?tc('sstart.alreadyOpenSuffix',' — already open'):''}</option>)}
              </select>
            </div>
            <div style={{marginBottom:'1.25rem'}}>
              <label className="label">{tc('sstart.date','Date')}</label>
              <input style={inp} type="date" value={open.date} onChange={e=>setOpen(p=>({...p,date:e.target.value}))}/>
            </div>
            <button onClick={openShift} disabled={busy||slotTaken||allTaken} style={{width:'100%',height:46,background:(slotTaken||allTaken)?'#e5e3de':'#FF6B00',color:(slotTaken||allTaken)?'#888':'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:(busy||slotTaken||allTaken)?'default':'pointer'}}>
              {busy?tc('sstart.opening','Opening…'):allTaken?tc('sstart.allSlotsOpen','All slots open'):slotTaken?tc('sstart.thisSlotAlreadyOpen','This slot is already open'):tc('sstart.openShiftBtn','Open Shift →')}
            </button>
            {(slotTaken||allTaken) && <div style={{fontSize:12,color:'var(--text-3)',marginTop:8}}>{allTaken?tc('sstart.everySlotOpenHint','Every slot for this date is already open — resume one on the right.'):tc('sstart.slotOpenHint','That slot is open already — pick another or resume on the right.')}</div>}
          </div>

          <div className="card">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.5rem'}}>
              <div style={{fontWeight:700,fontSize:15}}>{tc('sstart.currentlyOpenShifts','Currently open shifts')}</div>
              {openShifts.length>0 && <span style={{fontSize:12,fontWeight:700,color:'#16a34a',background:'#dcfce7',borderRadius:99,padding:'2px 10px'}}>{tc('sstart.nOpen','{n} open').replace('{n}', openShifts.length)}</span>}
            </div>
            {openShifts.length===0
              ? <div style={{color:'var(--text-3)',fontSize:13,padding:'8px 0'}}>{tc('sstart.noShiftsOpen','No shifts are open right now.')}</div>
              : openShifts.map(s=>(
                <div key={s.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,background:'#f8fafc',border:'1px solid #eef0f2',borderRadius:10,padding:'10px 12px',marginBottom:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:14}}>{label(s.shift_number)}</div>
                    <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{dateKey(s.date)} · {tc('sstart.nOperators','{n} operators').replace('{n}', s.attendant_count||0)}</div>
                  </div>
                  <div style={{display:'flex',gap:8,flexShrink:0}}>
                    {canDelete(s) && (
                      <button onClick={()=>deleteShift(s)} disabled={busy} title={tc('sstart.deleteEmptyShift','Delete this empty shift (opened by mistake)')}
                        style={{padding:'8px 10px',background:'#fef2f2',color:'#b91c1c',border:'1.5px solid #fecaca',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>
                        <X size={13}/>{tc('sstart.delete','Delete')}
                      </button>
                    )}
                    <button onClick={()=>resumeShift(s)} disabled={busy} style={{padding:'8px 12px',background:'#fff7ed',color:'#9a3412',border:'1.5px solid #fed7aa',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer'}}>{tc('sstart.resumeBtn','Resume →')}</button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* STEP 1 — Dipstick (opening stock) */}
      {step===1 && shift && (
        <div className="card" style={{maxWidth:620}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><Droplets size={16} color="#0ea5e9"/>{tc('sstart.openingDipReadings','Opening dip readings')}</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>{tc('sstart.dipHelp','For each tank enter EITHER the dip (a physical check) OR the litres shown on the ATG/HPCL system — we compute the other. This is the opening stock; the reconciliation shows any variance.')}</div>
          {dipTanks.length===0 && <div style={{color:'#aaa',fontSize:13}}>{tc('sstart.noDipTanks','No dip-measured tanks configured.')}</div>}
          {dipTanks.map(tk => {
            const hasChart = tk.diameter_cm && tk.length_cm;
            const vol = tankVol(tk);
            return (
              <div key={tk.id} style={{marginBottom:12,paddingBottom:10,borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <div style={{width:120,fontSize:13,fontWeight:600}}>{tc('sstart.tank','Tank')} {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                  <input style={{...inp,width:110}} type="number" step="0.1" placeholder={hasChart?tc('sstart.dipEg','dip e.g. 64.2'):tc('sstart.dipCm','dip cm')}
                    value={dips[tk.id]||''} onChange={e=>{ setDips(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{tc('sstart.orWord','or')}</span>
                  <input style={{...inp,width:130,...((dips[tk.id]!=='' && dips[tk.id]!=null && hasChart)?{background:'#f1f5f9',color:'#0369a1',fontWeight:600}:{})}}
                    type="number" step="0.01" placeholder={tc('sstart.litresSystem','litres (system)')}
                    readOnly={dips[tk.id]!=='' && dips[tk.id]!=null && hasChart}
                    value={(dips[tk.id]!=='' && dips[tk.id]!=null && hasChart) ? (vol!=null?fmtL(vol):'') : (dipVol[tk.id]||'')}
                    onChange={e=>{ setDipVol(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                  <button onClick={()=>saveDip(tk)} disabled={busy||savedDips[tk.id]}
                    style={{padding:'8px 12px',borderRadius:8,border:'none',fontSize:12.5,fontWeight:700,cursor:savedDips[tk.id]?'default':'pointer',
                      background:savedDips[tk.id]?'#dcfce7':isDirty(tk)?'#d97706':'#475569',color:savedDips[tk.id]?'#166534':'#fff'}}>
                    {savedDips[tk.id]?tc('sstart.saved','✓ Saved'):tc('sstart.save','Save')}
                  </button>
                  {isDirty(tk) && <span style={{fontSize:12,fontWeight:700,color:'#b45309'}}>{tc('sstart.notSaved','● Not saved')}</span>}
                </div>
                {/* Last saved reading — so a blank entry box never looks like lost data. */}
                {tk.last_reading_at
                  ? <div style={{fontSize:11.5,color:'#475569',marginTop:5,marginLeft:130}}>
                      <span style={{color:'#16a34a',fontWeight:700}}>● {tc('sstart.lastSaved','Last saved')}</span>{' '}
                      {tk.last_reading_type ? `${tk.last_reading_type} ` : ''}{tc('sstart.dipLabel','dip')} {tk.last_dip_cm!=null?`${tk.last_dip_cm} cm`:'—'}
                      {tk.last_reading!=null?` → ${fmtL(tk.last_reading)} L`:''} · {fmtWhen(tk.last_reading_at)}
                    </div>
                  : <div style={{fontSize:11.5,color:'#94a3b8',marginTop:5,marginLeft:130}}>{tc('sstart.noReadingYet','No reading saved yet for this tank.')}</div>}
              </div>
            );
          })}
          <button onClick={leaveDipStep} disabled={busy} style={{width:'100%',height:46,marginTop:12,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:busy?'default':'pointer',opacity:busy?0.7:1}}>
            {busy ? tc('sstart.savingDips','Saving dips…') : tc('sstart.nextOperators','Next: Operators →')}
          </button>
        </div>
      )}

      {/* STEP 2 — Operators (+ their nozzles + opening meters) */}
      {step===2 && shift && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem',alignItems:'start'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('sstart.addAnOperator','Add an operator')}</div>
            <div style={{display:'grid',gap:10}}>
              <div><label className="label">{tc('sstart.operator','Operator')}</label>
                <select style={inp} value={asg.attendant_id||''} onChange={e=>setAsg(p=>({...p,attendant_id:e.target.value}))}>
                  <option value="">{tc('sstart.selectPlaceholder','Select…')}</option>
                  {users.filter(u=>!assignedIds.has(u.id)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select></div>
              <div><label className="label">{tc('sstart.openingCash','Opening cash (₹)')}</label>
                <input style={inp} type="number" step="0.01" placeholder={tc('sstart.floatPlaceholder','Float handed over (0 if none)')} value={asg.opening_cash||''} onChange={e=>setAsg(p=>({...p,opening_cash:e.target.value}))}/></div>

              <div>
                <label className="label">{tc('sstart.nozzlesHeMans','Nozzles he mans')} <span style={{fontWeight:400,color:'#888'}}>{tc('sstart.nozzlesHeMansHint','(tick each; opening auto-carries from last close)')}</span></label>
                <label style={{display:'inline-flex',alignItems:'center',gap:8,marginBottom:8,padding:'8px 12px',background:scanning==='slip'?'#94a3b8':'#0f766e',color:'#fff',borderRadius:8,cursor:scanning==='slip'?'default':'pointer',fontSize:13,fontWeight:600}}>
                  📄 {scanning==='slip' ? tc('sstart.slipReading','Reading slip…') : tc('sstart.scanSlip','Scan pump slip → fill all nozzles')}
                  <input type="file" accept="image/*" capture="environment" disabled={scanning==='slip'} style={{display:'none'}} onChange={e=>{ scanSlip(e.target.files?.[0]); e.target.value=''; }}/>
                </label>
                {availNozzles.length===0 && <div style={{fontSize:12.5,color:'#aaa'}}>{tc('sstart.allNozzlesAssigned','All nozzles are already assigned.')}</div>}
                {availNozzles.map(n=>{
                  const pick = nozPick[n.id]; const sel = !!pick?.selected;
                  const sug = openings[n.id];
                  const cur = pick?.opening ?? (sug ?? '');
                  const drift = sel && cur!=='' && sug!=null && Math.abs(Number(cur)-Number(sug))>1;
                  return (
                    <div key={n.id} style={{border:'1px solid '+(sel?'#fed7aa':'#eef0f2'),background:sel?'#fff7ed':'#fff',borderRadius:8,padding:'8px 10px',marginBottom:6}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                        <input type="checkbox" checked={sel} onChange={e=>{ if(e.target.checked) pickNoz(n.id,{selected:true}); else setNozPick(p=>({...p,[n.id]:{...(p[n.id]||{}),selected:false}})); }}/>
                        {tc('sstart.nozzle','Nozzle')} {n.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{n.fuel_type}</span>
                      </label>
                      {sel && (
                        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                          <input style={{...inp,flex:1}} type="number" step="0.001" placeholder={tc('sstart.openingMeter','Opening meter')}
                            value={cur} onChange={e=>pickNoz(n.id,{opening:e.target.value})}/>
                          <label title={tc('sstart.scanTotalizer','Scan the totalizer')} style={{flexShrink:0,width:40,height:36,display:'flex',alignItems:'center',justifyContent:'center',background:scanning===n.id?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:scanning===n.id?'default':'pointer',fontSize:16}}>
                            {scanning===n.id?'…':'📷'}
                            <input type="file" accept="image/*" capture="environment" disabled={scanning===n.id} style={{display:'none'}} onChange={e=>{ scanMeter(n, e.target.files?.[0]); e.target.value=''; }}/>
                          </label>
                        </div>
                      )}
                      {drift && <div style={{fontSize:11,color:'#b45309',marginTop:4}}>⚠ {tc('sstart.driftWarn','differs from last close ({sug}) — verify handover').replace('{sug}', sug)}</div>}
                    </div>
                  );
                })}
              </div>

              <button onClick={addOperator} disabled={busy} style={{height:42,background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}><Plus size={15} style={{verticalAlign:'middle'}}/> {tc('sstart.addOperatorBtn','Add operator')}</button>
            </div>
          </div>

          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('sstart.operatorsCount','Operators ({n})').replace('{n}', attendants.length)}</div>
            {attendants.length===0 ? <div style={{color:'#aaa',fontSize:13}}>{tc('sstart.noOperatorsYet','No operators added yet.')}</div>
              : attendants.map(a=>(
                <div key={a.id} style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px',marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontWeight:700,fontSize:13.5}}>{a.attendant_name}</div>
                    <div style={{fontSize:12,color:'#888'}}>{tc('sstart.float','float')} ₹{Number(a.opening_cash||0).toLocaleString('en-IN')}</div>
                  </div>
                  {(a.nozzles||[]).length>0
                    ? <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
                        {a.nozzles.map(nz=>(
                          <span key={nz.nozzle_id} style={{fontSize:11.5,background:'#eef2ff',color:'#3730a3',borderRadius:99,padding:'2px 8px'}}>
                            N{nz.nozzle_number} · {nz.fuel_type} · {tc('sstart.open','open')} {Number(nz.opening_reading||0)}
                          </span>
                        ))}
                      </div>
                    : <div style={{fontSize:11.5,color:'#b45309',marginTop:4}}>{tc('sstart.noNozzlesAssigned','No nozzles assigned')}</div>}
                </div>
              ))}
            <div style={{fontSize:12,color:'var(--text-3)',marginTop:12,marginBottom:6}}>{tc('sstart.staggerHint','Add each operator as they arrive — each goes live immediately. Stay here to add the next; click Done when you’re finished.')}</div>
            <button onClick={startShift} disabled={busy || (attendants.length===0 && !formReady)}
              style={{width:'100%',height:46,background:(attendants.length||formReady)?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:(attendants.length||formReady)?'pointer':'not-allowed'}}>
              {tc('sstart.doneToDashboard','Done — go to dashboard')}
            </button>
          </div>
        </div>
      )}

      {/* Hard stop: no opening dip = no stock reconciliation for this shift, ever.
          Blocking and specific, because a passive note demonstrably did not work. */}
      {dipWarn && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}>
          <div className="card" style={{maxWidth:440,width:'100%'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
              <AlertTriangle size={20} color="#dc2626"/>
              <span style={{fontWeight:800,fontSize:16,color:'#991b1b'}}>{tc('sstart.dipMissingTitle','Dip readings missing')}</span>
            </div>
            <div style={{fontSize:13.5,color:'var(--text-2)',marginBottom:10}}>
              {tc('sstart.dipMissingBody','No opening dip has been recorded for:')}
            </div>
            <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'10px 12px',marginBottom:12}}>
              {dipWarn.map(tk => (
                <div key={tk.id} style={{fontSize:13,fontWeight:700,color:'#991b1b'}}>
                  {tc('sstart.tank','Tank')} {tk.tank_number} <span style={{fontWeight:400}}>{tk.fuel_type}</span>
                </div>
              ))}
            </div>
            <div style={{fontSize:12.5,color:'var(--text-2)',marginBottom:16}}>
              {tc('sstart.dipMissingWhy','Without an opening dip this shift cannot be reconciled — any stock loss on these tanks will go undetected.')}
            </div>
            <button onClick={()=>setDipWarn(null)}
              style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:14.5,cursor:'pointer'}}>
              {tc('sstart.dipMissingEnter','Enter dip readings')}
            </button>
            <button onClick={()=>{ setDipWarn(null); setStep(2); }}
              style={{width:'100%',height:40,marginTop:8,background:'none',color:'var(--text-3)',border:'none',fontWeight:600,fontSize:13,cursor:'pointer',textDecoration:'underline'}}>
              {tc('sstart.dipMissingSkip','Continue without dip readings')}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
