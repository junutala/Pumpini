'use client';
// End Shift — per-operator settlement (manpower-shortage: an operator can man
// several nozzles). Select shift → every operator listed → for each: his nozzles'
// closing meters + Cash/Card/UPI/Credit/Petty cash → live tally → close that
// operator (POST /reconcile/manager). Then closing dip (stock) → close shift.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, ArrowLeft, AlertTriangle, CheckCircle, Clock, Droplets } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { markToTrueDip, dipToVolume } from '../../lib/calibration';

const inp = { width:'100%', padding:'8px 10px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:13.5, outline:'none', boxSizing:'border-box', background:'#fff' };
const fmt = n => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtL = n => Number(n||0).toFixed(2);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const STEPS = ['Select', 'Operators', 'Close'];
const hoursSince = (t) => t ? (Date.now() - new Date(t).getTime())/3.6e6 : 0;
const openedLabel = (t) => { const h = hoursSince(t); return h < 1 ? `${Math.round(h*60)}m ago` : h < 24 ? `${h.toFixed(1)}h ago` : `${Math.floor(h/24)}d ${Math.round(h%24)}h ago`; };
const readB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read image'));
  r.readAsDataURL(file);
});

export default function ShiftEndPage() {
  const router = useRouter();
  const { station, setActiveShift } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [step, setStep]   = useState(0);
  const [open, setOpen]   = useState([]);
  const [shift, setShift] = useState(null);
  const [prices, setPrices] = useState({});       // fuel_type -> price
  const [forms, setForms] = useState({});         // attendant_id -> { closings:{nozzle_id:val}, cash, card, upi, credit, petty }
  const [closed, setClosed] = useState({});       // attendant_id -> { variance, total_sales }
  const [scanning, setScanning] = useState('');   // nozzle_id being OCR'd
  const [tanks, setTanks] = useState([]);
  const [dips, setDips]   = useState({});
  const [dipVol, setDipVol] = useState({});
  const [savedDips, setSavedDips] = useState({});
  const [busy, setBusy]   = useState('');
  const [err, setErr]     = useState('');
  const [done, setDone]   = useState(false);

  useEffect(() => {
    if (!stationId) return;
    api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
      .then(r => setOpen(Array.isArray(r)?r:[])).catch(()=>setOpen([]));
  }, [stationId]);

  const pickShift = async (s) => {
    setBusy('pick'); setErr('');
    try {
      const [d, tk, pr, reco] = await Promise.all([
        api.get(`/shifts/${s.id}`),
        api.get(`/dipstick/tanks/${stationId}`).catch(()=>[]),
        api.get(`/prices/${stationId}/current`).catch(()=>[]),
        api.get(`/reconcile/${s.id}`).catch(()=>[]),   // already-settled operators
      ]);
      setShift(d);
      setActiveShift({ id:d.id, shift_number:d.shift_number, start_time:d.start_time, station_id:d.station_id });
      setTanks(Array.isArray(tk)?tk:[]);
      const pm = {}; (Array.isArray(pr)?pr:[]).forEach(p => { pm[p.fuel_type] = num(p.price); }); setPrices(pm);

      // Re-hydrate operators already settled server-side, so a pause/refresh/remount
      // never wipes a recorded settlement and forces the manager to re-enter it.
      const byAtt = {}; (Array.isArray(reco)?reco:[]).forEach(r => { byAtt[r.attendant_id] = r; });
      const seed = {}; const closedSeed = {};
      (d?.attendants||[]).forEach(a => {
        const r = byAtt[a.attendant_id];
        if (r && r.manager_confirmed) {
          seed[a.attendant_id] = { closings:{},
            cash:   r.cash_actual  != null ? String(r.cash_actual)  : '',
            card:   r.card_total   != null ? String(r.card_total)   : '',
            upi:    r.upi_total    != null ? String(r.upi_total)    : '',
            credit: r.credit_total != null ? String(r.credit_total) : '',
            petty:  r.petty_cash   != null ? String(r.petty_cash)   : '' };
          closedSeed[a.attendant_id] = { variance: num(r.cash_actual) - num(r.cash_expected), total_sales: num(r.total_sales) };
        } else {
          seed[a.attendant_id] = { closings:{}, cash:'', card:'', upi:'', credit:'', petty:'' };
        }
      });
      setForms(seed); setClosed(closedSeed); setStep(1);
    } catch(e){ setErr(e.response?.data?.error||e.error||tc('send.couldNotLoadShift', 'Could not load shift')); }
    setBusy('');
  };

  const attendants = shift?.attendants || [];
  const setF  = (aid, k, v) => setForms(p => ({ ...p, [aid]: { ...p[aid], [k]: v } }));
  const setCl = (aid, nid, v) => setForms(p => ({ ...p, [aid]: { ...p[aid], closings: { ...(p[aid]?.closings||{}), [nid]: v } } }));

  // Live tally for one operator
  const opSales = (a) => {
    const fm = forms[a.attendant_id] || {};
    let s = 0;
    (a.nozzles||[]).forEach(nz => {
      const cl = fm.closings?.[nz.nozzle_id];
      if (cl !== '' && cl != null) {
        const ltr = num(cl) - num(nz.opening_reading);
        if (ltr > 0) s += ltr * (prices[nz.fuel_type] || 0);
      }
    });
    return +s.toFixed(2);
  };
  const opExpected = (a) => {
    const fm = forms[a.attendant_id] || {};
    const cashValue = opSales(a) - num(fm.card) - num(fm.upi) - num(fm.credit);
    return +(num(a.opening_cash) + cashValue - num(fm.petty)).toFixed(2);
  };
  const opVariance = (a) => +(num(forms[a.attendant_id]?.cash) - opExpected(a)).toFixed(2);

  const scanMeter = async (a, nozzle, file) => {
    if (!file) return;
    setScanning(nozzle.nozzle_id); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/ocr-meter', { shift_id: shift.id, nozzle_id: nozzle.nozzle_id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      if (r.reading) setCl(a.attendant_id, nozzle.nozzle_id, r.reading);
      if (!r.legible) setErr(tc('send.scanUnclear', 'Nozzle {n}: scan unclear{notes} — check the reading.').replace('{n}', nozzle.nozzle_number).replace('{notes}', r.notes ? ` (${r.notes})` : ''));
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('send.scanFailed', 'Scan failed')); }
    setScanning('');
  };

  // Scan the whole printed pump slip (Slip A/B) — fills the CLOSING meter for
  // every nozzle on it across all operators, matched by label "{pump}.{nozzle}".
  const scanSlip = async (file) => {
    if (!file || !shift) return;
    setScanning('slip'); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/parse-slip', { shift_id: shift.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      let matched = 0; const miss = [];
      (r.nozzles || []).forEach(n => {
        if (n.cumulative_volume == null) return;
        let found = false;
        attendants.forEach(a => (a.nozzles || []).forEach(nz => {
          if (String(nz.nozzle_number) === n.label) { setCl(a.attendant_id, nz.nozzle_id, n.cumulative_volume); matched++; found = true; }
        }));
        if (!found && n.label) miss.push(n.label);
      });
      if (!matched) setErr(tc('send.slipNoMatch', 'Slip read, but no nozzle matched. Label nozzles as pump.nozzle (e.g. {ex}).').replace('{ex}', `${r.pump_id||'1'}.1`));
      else {
        let msg = tc('send.slipFilled', 'Filled {n} closing reading(s) from the slip.').replace('{n}', matched);
        if (miss.length) msg += ' ' + tc('send.slipNoMatchSome', 'No operator nozzle for: {x}.').replace('{x}', miss.join(', '));
        if (!r.legible)  msg += ' ' + tc('send.slipVerify', '⚠ Some digits unclear — verify.');
        setErr(msg);
      }
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('send.slipFailed', 'Slip scan failed')); }
    setScanning('');
  };

  const closeOperator = async (a) => {
    const fm = forms[a.attendant_id] || {};
    const nz = a.nozzles || [];
    if (!nz.length) return setErr(tc('send.noNozzlesAssignedErr', '{name} has no nozzles assigned — fix at shift start.').replace('{name}', a.attendant_name));
    const closings = nz.map(n => ({ nozzle_id: n.nozzle_id, closing_reading: fm.closings?.[n.nozzle_id] }));
    if (closings.some(c => c.closing_reading === '' || c.closing_reading == null)) return setErr(tc('send.enterClosingEveryNozzle', 'Enter a closing meter for every nozzle of {name}.').replace('{name}', a.attendant_name));
    if (fm.cash === '' || fm.cash == null) return setErr(tc('send.enterCountedCash', 'Enter counted cash for {name} (0 if none).').replace('{name}', a.attendant_name));
    setBusy('op'+a.attendant_id); setErr('');
    try {
      const r = await api.post('/reconcile/manager', {
        shift_id: shift.id, attendant_id: a.attendant_id, closings,
        card_total: num(fm.card), upi_total: num(fm.upi), cash_actual: num(fm.cash),
        credit_total: num(fm.credit), petty_cash: num(fm.petty),
      });
      setClosed(p => ({ ...p, [a.attendant_id]: { variance: num(r.variance), total_sales: num(r.total_sales) } }));
    } catch(e){ setErr(e.response?.data?.error||e.error||tc('send.couldNotCloseOperator', 'Could not close operator')); }
    setBusy('');
  };

  const allClosed = attendants.length > 0 && attendants.every(a => closed[a.attendant_id]);

  // Closing dipstick (stock continuity)
  const tankVol = (tk) => {
    const entered = dips[tk.id];
    if (entered === '' || entered == null) return null;
    if (tk.diameter_cm && tk.length_cm) return dipToVolume(tk.diameter_cm, tk.length_cm, markToTrueDip(entered));
    return dipVol[tk.id] !== '' && dipVol[tk.id] != null ? num(dipVol[tk.id]) : null;
  };
  const saveDip = async (tk) => {
    const entered = dips[tk.id];
    if (entered === '' || entered == null) return;
    const hasChart = tk.diameter_cm && tk.length_cm;
    const vol = tankVol(tk);
    if (vol == null) return setErr(tc('send.tankEnterVolume', 'Tank {n}: enter a volume.').replace('{n}', tk.tank_number));
    setBusy('dip'+tk.id); setErr('');
    try {
      await api.post('/dipstick', { station_id: stationId, tank_id: tk.id, shift_id: shift.id,
        reading_type: 'closing', dip_cm: hasChart ? markToTrueDip(entered) : entered, volume_ltrs: vol });
      setSavedDips(p => ({ ...p, [tk.id]: true }));
      // Reflect the save inline immediately (so the "last saved" line updates without a reload).
      setTanks(ts => ts.map(t => t.id === tk.id
        ? { ...t, last_dip_cm: (hasChart ? markToTrueDip(entered) : entered), last_reading: vol,
            last_reading_at: new Date().toISOString(), last_reading_type: 'closing' }
        : t));
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('send.couldNotSaveDip', 'Could not save dip')); }
    setBusy('');
  };

  // Only liquid tanks are dipped — CNG is sold by mass/pressure, never dip-measured.
  const dipTanks = tanks.filter(t => (t.fuel_type||'').toLowerCase() !== 'cng');
  const fmtWhen = (ts) => new Date(ts).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });

  const closeShift = async () => {
    setBusy('close');
    try { await api.patch(`/shifts/${shift.id}/close`, { confirm:true }); setActiveShift(null); setDone(true); }
    catch(e){ setErr(e.response?.data?.error||e.error||tc('send.closeFailed', 'Close failed')); }
    setBusy('');
  };

  const vBadge = (v) => {
    const short = v < -1, over = v > 1;
    return (
      <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12.5,fontWeight:700,
        color: short?'#991b1b':over?'#9a3412':'#166534'}}>
        {short && <AlertTriangle size={14}/>}{short?tc('send.short','Short'):over?tc('send.over','Over'):tc('send.tallied','Tallied')} {fmt(Math.abs(v))}
      </span>
    );
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('send.dashboard','Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('send.endShift','End Shift')}{shift?` — ${tc('send.shiftLabel','Shift')} ${shift.shift_number}`:''}</span>
      </div>

      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s} onClick={()=>{ if(!done && shift && i<=step) setStep(i); }} disabled={done || (!shift && i>0)}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:shift&&i<=step?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {tc('send.step'+s, s)}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* STEP 0 — Select shift */}
      {step===0 && (
        <div className="card" style={{maxWidth:620}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('send.pickShiftToClose','Pick the shift to close')}</div>
          {open.length===0 ? <div style={{color:'#aaa',fontSize:13}}>{tc('send.noOpenShifts','No open shifts.')}</div>
            : open.map(s=>{ const stale = hoursSince(s.start_time) > 24; return (
              <button key={s.id} onClick={()=>pickShift(s)} disabled={busy==='pick'}
                style={{width:'100%',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center',
                  background:stale?'#fef2f2':'#f8fafc',border:'1.5px solid '+(stale?'#fca5a5':'#eef0f2'),borderRadius:10,padding:'10px 12px',marginBottom:8,cursor:'pointer'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{tc('send.shiftLabel','Shift')} {s.shift_number} <span style={{fontWeight:400,color:'#888',fontSize:12.5}}>· {s.date} · {s.attendant_count} {s.attendant_count===1?tc('send.operator','operator'):tc('send.operators','operators')}</span></div>
                  <div style={{fontSize:12,color:stale?'#dc2626':'#888',display:'flex',alignItems:'center',gap:4,marginTop:2}}>
                    <Clock size={12}/> {tc('send.opened','opened')} {openedLabel(s.start_time)} {stale && <span style={{fontWeight:700}}>· {tc('send.openOver24h','OPEN >24h')}</span>}
                  </div>
                </div>
                <ChevronRight size={18} color="#bbb"/>
              </button>
            ); })}
        </div>
      )}

      {/* STEP 1 — Per-operator settlement */}
      {step===1 && shift && (
        <div style={{maxWidth:680}}>
          {attendants.length>0 && (
            <label style={{display:'inline-flex',alignItems:'center',gap:8,marginBottom:12,padding:'9px 14px',background:scanning==='slip'?'#94a3b8':'#0f766e',color:'#fff',borderRadius:8,cursor:scanning==='slip'?'default':'pointer',fontSize:13,fontWeight:600}}>
              📄 {scanning==='slip' ? tc('send.slipReading','Reading slip…') : tc('send.scanSlip','Scan pump slip → fill all closing meters')}
              <input type="file" accept="image/*" capture="environment" disabled={scanning==='slip'} style={{display:'none'}} onChange={e=>{ scanSlip(e.target.files?.[0]); e.target.value=''; }}/>
            </label>
          )}
          {attendants.length===0 && <div className="card" style={{color:'#aaa',fontSize:13}}>{tc('send.noOperatorsOnShift','No operators on this shift.')}</div>}
          {attendants.map(a=>{
            const c = closed[a.attendant_id]; const fm = forms[a.attendant_id]||{};
            const sales = opSales(a), expected = opExpected(a), variance = opVariance(a);
            return (
              <div key={a.attendant_id} className="card" style={{marginBottom:'0.85rem',background:c?'#f0fdf4':undefined}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:c?0:10}}>
                  <div style={{fontWeight:700,fontSize:14}}>{a.attendant_name} <span style={{fontWeight:400,color:'#888',fontSize:12}}>· {tc('send.float','float')} {fmt(a.opening_cash)}</span></div>
                  {c
                    ? <span style={{color:'#16a34a',fontSize:12.5,fontWeight:700,display:'flex',alignItems:'center',gap:4}}><CheckCircle size={15}/>{tc('send.closed','Closed')} · {vBadge(c.variance)}</span>
                    : <span style={{fontSize:12,color:'#888'}}>{(a.nozzles||[]).length} {(a.nozzles||[]).length===1?tc('send.nozzle','nozzle'):tc('send.nozzles','nozzles')}</span>}
                </div>

                {!c && (<>
                  {/* Nozzle closings */}
                  {(a.nozzles||[]).length===0
                    ? <div style={{fontSize:12.5,color:'#b45309',marginBottom:8}}>{tc('send.noNozzlesAssigned','No nozzles assigned to this operator — fix at shift start.')}</div>
                    : (a.nozzles||[]).map(nz=>(
                      <div key={nz.nozzle_id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                        <div style={{width:150,fontSize:12.5,fontWeight:600}}>N{nz.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{nz.fuel_type}</span> <span style={{color:'#aaa',fontWeight:400}}>· open {Number(nz.opening_reading||0)}</span></div>
                        <input style={{...inp,flex:1}} type="number" step="0.001" placeholder={tc('send.closingMeter','Closing meter')}
                          value={fm.closings?.[nz.nozzle_id]||''} onChange={e=>setCl(a.attendant_id,nz.nozzle_id,e.target.value)}/>
                        <label title={tc('send.scanTotalizer','Scan the totalizer')} style={{flexShrink:0,width:38,height:34,display:'flex',alignItems:'center',justifyContent:'center',background:scanning===nz.nozzle_id?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:scanning===nz.nozzle_id?'default':'pointer',fontSize:15}}>
                          {scanning===nz.nozzle_id?'…':'📷'}
                          <input type="file" accept="image/*" capture="environment" disabled={scanning===nz.nozzle_id} style={{display:'none'}} onChange={e=>{ scanMeter(a, nz, e.target.files?.[0]); e.target.value=''; }}/>
                        </label>
                      </div>
                    ))}

                  {/* 5 buckets */}
                  <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginTop:10}}>
                    <div><label className="label">{tc('send.cash','Cash')} ₹</label><input style={inp} type="number" step="0.01" value={fm.cash||''} onChange={e=>setF(a.attendant_id,'cash',e.target.value)}/></div>
                    <div><label className="label">{tc('send.card','Card')} ₹</label><input style={inp} type="number" step="0.01" value={fm.card||''} onChange={e=>setF(a.attendant_id,'card',e.target.value)}/></div>
                    <div><label className="label">UPI ₹</label><input style={inp} type="number" step="0.01" value={fm.upi||''} onChange={e=>setF(a.attendant_id,'upi',e.target.value)}/></div>
                    <div><label className="label">{tc('send.credit','Credit')} ₹</label><input style={inp} type="number" step="0.01" value={fm.credit||''} onChange={e=>setF(a.attendant_id,'credit',e.target.value)}/></div>
                    <div><label className="label">{tc('send.pettySkim','Petty/Skim')} ₹</label><input style={inp} type="number" step="0.01" value={fm.petty||''} onChange={e=>setF(a.attendant_id,'petty',e.target.value)}/></div>
                  </div>

                  {/* Live tally */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginTop:10,paddingTop:10,borderTop:'1px solid #eef0f2'}}>
                    <div style={{fontSize:12,color:'#555'}}>{tc('send.sales','Sales')} <b>{fmt(sales)}</b> · {tc('send.expectedCash','Expected cash')} <b>{fmt(expected)}</b> → {vBadge(variance)}</div>
                    <button onClick={()=>closeOperator(a)} disabled={busy==='op'+a.attendant_id}
                      style={{height:38,padding:'0 16px',background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer',fontSize:13}}>
                      {busy==='op'+a.attendant_id?tc('send.closingEllipsis','Closing…'):tc('send.closeOperator','Close operator')}
                    </button>
                  </div>
                </>)}
              </div>
            );
          })}
          <button onClick={()=>setStep(2)} disabled={!allClosed}
            style={{width:'100%',height:44,marginTop:'0.25rem',background:allClosed?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:allClosed?'pointer':'not-allowed'}}>
            {allClosed?tc('send.nextClosingDip','Next: Closing dip & close shift →'):tc('send.closeEveryOperatorFirst','Close every operator first')}
          </button>
        </div>
      )}

      {/* STEP 2 — Closing dip + close shift */}
      {step===2 && shift && (
        <div className="card" style={{maxWidth:620}}>
          {done ? (
            <div style={{textAlign:'center'}}>
              <CheckCircle size={48} color="#16a34a" style={{margin:'0.5rem auto'}}/>
              <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>{tc('send.shiftClosed','Shift closed')}</div>
              <div style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>{tc('send.shiftClosedDesc','Operators settled; cash is now in “awaiting deposit”.')}</div>
              <button onClick={()=>router.push('/dashboard')} style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>{tc('send.backToDashboard','Back to Dashboard')}</button>
            </div>
          ) : (<>
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><Droplets size={16} color="#0ea5e9"/>{tc('send.closingDipReadings','Closing dip readings')}</div>
            <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>{tc('send.closingDipDesc','Each tank’s closing dip (4 marks/cm). This is today’s closing stock — and tomorrow’s opening.')}</div>
            {dipTanks.length===0 && <div style={{color:'#aaa',fontSize:13}}>{tc('send.noDipTanks','No dip-measured tanks configured.')}</div>}
            {dipTanks.map(tk => {
              const hasChart = tk.diameter_cm && tk.length_cm; const vol = tankVol(tk);
              return (
                <div key={tk.id} style={{marginBottom:12,paddingBottom:10,borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    <div style={{width:120,fontSize:13,fontWeight:600}}>{tc('send.tank','Tank')} {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                    <input style={{...inp,width:120}} type="number" step="0.1" placeholder={hasChart?tc('send.dipExample','dip e.g. 58.3'):tc('send.dipCm','dip cm')}
                      value={dips[tk.id]||''} onChange={e=>{ setDips(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                    {hasChart
                      ? <div style={{minWidth:110,fontSize:13,fontWeight:600,color:'#0369a1'}}>{vol!=null?`${fmtL(vol)} L`:'—'}</div>
                      : <input style={{...inp,width:120}} type="number" step="0.01" placeholder={tc('send.volumeL','volume L')}
                          value={dipVol[tk.id]||''} onChange={e=>{ setDipVol(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>}
                    <button onClick={()=>saveDip(tk)} disabled={busy==='dip'+tk.id||savedDips[tk.id]}
                      style={{padding:'8px 12px',borderRadius:8,border:'none',fontSize:12.5,fontWeight:700,cursor:savedDips[tk.id]?'default':'pointer',
                        background:savedDips[tk.id]?'#dcfce7':'#475569',color:savedDips[tk.id]?'#166534':'#fff'}}>
                      {savedDips[tk.id]?tc('send.saved','✓ Saved'):tc('send.save','Save')}
                    </button>
                  </div>
                  {/* Last saved reading — so a blank entry box never looks like lost data. */}
                  {tk.last_reading_at
                    ? <div style={{fontSize:11.5,color:'#475569',marginTop:5,marginLeft:130}}>
                        <span style={{color:'#16a34a',fontWeight:700}}>● {tc('send.lastSaved','Last saved')}</span>{' '}
                        {tk.last_reading_type ? `${tk.last_reading_type} ` : ''}{tc('send.dip','dip')} {tk.last_dip_cm!=null?`${tk.last_dip_cm} cm`:'—'}
                        {tk.last_reading!=null?` → ${fmtL(tk.last_reading)} L`:''} · {fmtWhen(tk.last_reading_at)}
                      </div>
                    : <div style={{fontSize:11.5,color:'#94a3b8',marginTop:5,marginLeft:130}}>{tc('send.noReadingSaved','No reading saved yet for this tank.')}</div>}
                </div>
              );
            })}

            <div style={{marginTop:'1rem',paddingTop:'0.75rem',borderTop:'1px solid #eef0f2'}}>
              <div style={{fontSize:12.5,fontWeight:700,color:'#555',marginBottom:6}}>{tc('send.operatorsSettled','Operators settled')}</div>
              {attendants.map(a=>(
                <div key={a.attendant_id} style={{display:'flex',justifyContent:'space-between',fontSize:12.5,padding:'3px 0'}}>
                  <span>{a.attendant_name}</span>{closed[a.attendant_id] ? vBadge(closed[a.attendant_id].variance) : <span style={{color:'#aaa'}}>—</span>}
                </div>
              ))}
            </div>

            <button onClick={closeShift} disabled={busy==='close' || !allClosed}
              style={{width:'100%',height:48,marginTop:'1rem',background:allClosed?'#dc2626':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:allClosed?'pointer':'not-allowed'}}>
              {busy==='close'?tc('send.closingEllipsis','Closing…'):tc('send.closeShift','Close Shift')}
            </button>
          </>)}
        </div>
      )}
    </AppShell>
  );
}
