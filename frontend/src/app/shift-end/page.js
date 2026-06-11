'use client';
// Shift End — one guided, breadcrumbed screen for closing a shift: closing tank
// dips → reconcile each operator → review wet-stock variance → close. Adapts to
// the station's mode (manager-driven keys it all; POS mode confirms operators'
// submitted reconciliations). Reuses existing endpoints; the close auto-runs the
// wet-stock reco + deposit aging on the server.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, ArrowLeft, AlertTriangle, CheckCircle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inp = { width:'100%', padding:'8px 10px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:13.5, outline:'none', boxSizing:'border-box', background:'#fff' };
const fmt = n => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2})}`;
const L = n => `${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:1})} L`;
const STEPS = ['Closing dips', 'Reconcile', 'Wet-stock', 'Close'];

export default function ShiftEndPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [shiftId, setShiftId] = useState('');
  const [shift, setShift]     = useState(null);
  const [tanks, setTanks]     = useState([]);
  const [prices, setPrices]   = useState({});
  const [managerMode, setManagerMode] = useState(false);
  const [step, setStep]       = useState(0);
  const [dips, setDips]       = useState({});
  const [dipsDone, setDipsDone] = useState({});
  const [forms, setForms]     = useState({});   // attendant_id -> manager-mode form
  const [recos, setRecos]     = useState({});   // attendant_id -> result (manager) or submitted (pos)
  const [posRecos, setPosRecos] = useState([]); // POS-mode submitted reconciliations
  const [tankReco, setTankReco] = useState([]);
  const [busy, setBusy]       = useState('');
  const [err, setErr]         = useState('');
  const [done, setDone]       = useState(false);

  useEffect(() => {
    const id = typeof window!=='undefined' ? new URLSearchParams(window.location.search).get('shift') : '';
    if (id) setShiftId(id);
  }, []);

  useEffect(() => {
    if (!shiftId || !stationId) return;
    (async () => {
      const [d, t, pr, st] = await Promise.all([
        api.get(`/shifts/${shiftId}`).catch(()=>null),
        api.get(`/stations/${stationId}/tanks`).catch(()=>[]),
        api.get('/prices', { params:{ station_id: stationId } }).catch(()=>[]),
        api.get(`/stations/${stationId}/settings`).catch(()=>({})),
      ]);
      setShift(d); setTanks(Array.isArray(t)?t:[]);
      const pm = {}; (Array.isArray(pr)?pr:[]).forEach(p=>{ pm[p.fuel_type]=parseFloat(p.price); }); setPrices(pm);
      setManagerMode(!!st?.manager_blind_drop);
      const seed = {}; (d?.attendants||[]).forEach(a=>{ seed[a.attendant_id]={ closing_reading:'', price_per_ltr:'', test_ltrs:'', card_total:'', upi_total:'', cash_actual:'' }; });
      setForms(seed);
    })();
  }, [shiftId, stationId]);

  const refreshPos = async () => { const r = await api.get(`/reconcile/${shiftId}`).catch(()=>[]); setPosRecos(Array.isArray(r)?r:[]); };
  useEffect(() => { if (step===1 && !managerMode) refreshPos(); }, [step, managerMode]);

  const saveDip = async (tank) => {
    const vol = parseFloat(dips[tank.id]); if (!(vol>=0)) return setErr('Enter a volume');
    setBusy('dip'+tank.id); setErr('');
    try { await api.post('/dipstick', { station_id: stationId, tank_id: tank.id, shift_id: shiftId, reading_type:'closing', volume_ltrs: vol }); setDipsDone(p=>({...p,[tank.id]:true})); }
    catch(e){ setErr(e.response?.data?.error||e.error||'Could not save dip'); }
    setBusy('');
  };

  const setF = (aid,k,v) => setForms(p=>({...p,[aid]:{...p[aid],[k]:v}}));
  const reconcileMgr = async (a) => {
    const aid=a.attendant_id, fm=forms[aid];
    const price = parseFloat(fm.price_per_ltr || prices[a.fuel_type] || 0);
    if (fm.closing_reading==='') return setErr('Enter the closing meter for '+a.attendant_name);
    if (!price) return setErr('Enter price/litre for '+a.attendant_name);
    setBusy('rec'+aid); setErr('');
    try {
      const r = await api.post('/reconcile/manager', {
        shift_id: shiftId, attendant_id: aid, closing_reading: parseFloat(fm.closing_reading), price_per_ltr: price,
        test_ltrs: parseFloat(fm.test_ltrs||0), card_total: parseFloat(fm.card_total||0), upi_total: parseFloat(fm.upi_total||0),
        cash_actual: parseFloat(fm.cash_actual||0),
      });
      setRecos(p=>({...p,[aid]:r}));
    } catch(e){ setErr(e.response?.data?.error||e.error||'Reconcile failed'); }
    setBusy('');
  };
  const confirmPos = async (r) => {
    setBusy('pos'+r.id);
    try { await api.patch(`/reconcile/${r.id}/confirm`, {}); refreshPos(); }
    catch(e){ setErr(e.error||'Confirm failed'); }
    setBusy('');
  };

  const loadTankReco = async () => { const r = await api.get(`/tank-reco/shift/${shiftId}`).catch(()=>({})); setTankReco(r?.tanks||[]); };
  useEffect(() => { if (step===2) loadTankReco(); }, [step]);

  const attendants = shift?.attendants || [];
  const allReconciled = managerMode
    ? attendants.length>0 && attendants.every(a=>recos[a.attendant_id])
    : posRecos.length>0 && posRecos.every(r=>r.manager_confirmed);

  const closeShift = async () => {
    setBusy('close');
    try { await api.patch(`/shifts/${shiftId}/close`, { confirm:true }); setDone(true); }
    catch(e){ setErr(e.error||'Close failed'); }
    setBusy('');
  };

  if (!shiftId) return <AppShell><div className="card" style={{padding:'2rem',textAlign:'center',color:'var(--text-3)'}}>No shift selected. Open it from <a href="/shifts" style={{color:'var(--brand)'}}>Shifts</a>.</div></AppShell>;

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/shifts')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>Shifts</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>Shift End{shift?` — Shift ${shift.shift_number}`:''}</span>
        {managerMode && <span style={{fontSize:11,fontWeight:700,color:'#9a3412',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:6,padding:'2px 7px'}}>🔒 Manager-driven</span>}
      </div>
      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s} onClick={()=>{ if(!done && i<=step) setStep(i); }}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:i<=step?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {s}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* STEP 0 — Closing dips */}
      {step===0 && (
        <div className="card" style={{maxWidth:560}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem'}}>Closing tank dips</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>Physical dip per tank — used for the wet-stock variance.</div>
          {tanks.map(t=>(
            <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:110,fontSize:13,fontWeight:600}}>T{t.tank_number} <span style={{color:'#888',fontWeight:400}}>{t.fuel_type}</span></div>
              <input style={{...inp,flex:1}} type="number" step="0.1" placeholder="Closing volume (L)" value={dips[t.id]||''} onChange={e=>setDips(p=>({...p,[t.id]:e.target.value}))} disabled={dipsDone[t.id]}/>
              {dipsDone[t.id] ? <span style={{color:'#16a34a',display:'flex',alignItems:'center',gap:4,fontSize:13,fontWeight:600,width:90}}><Check size={15}/>Saved</span>
                : <button onClick={()=>saveDip(t)} disabled={busy==='dip'+t.id} style={{width:90,height:36,background:'#475569',color:'#fff',border:'none',borderRadius:8,fontWeight:600,cursor:'pointer',fontSize:13}}>Save</button>}
            </div>
          ))}
          <button onClick={()=>setStep(1)} style={{width:'100%',height:44,marginTop:'1rem',background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>Next: Reconcile →</button>
        </div>
      )}

      {/* STEP 1 — Reconcile */}
      {step===1 && (
        <div>
          {managerMode ? (
            attendants.map(a=>{
              const fm=forms[a.attendant_id]||{}, r=recos[a.attendant_id];
              const v = r ? parseFloat(r.variance) : null; const short = v!=null && v<0;
              return (
                <div key={a.attendant_id} className="card" style={{marginBottom:'0.85rem',background:r?(short?'#fef2f2':'#f0fdf4'):undefined}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:14}}>{a.attendant_name} <span style={{fontWeight:400,color:'#888',fontSize:12}}>N{a.nozzle_number}·{a.fuel_type} · open meter {Number(a.opening_reading||0).toFixed(1)} · float {fmt(a.opening_cash)}</span></div>
                    {r && <span style={{fontSize:12,fontWeight:700,color:short?'#dc2626':'#16a34a'}}>{short?'Short':v>0?'Over':'Tallied'} {fmt(Math.abs(v))}</span>}
                  </div>
                  <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                    <div><label className="label">Closing meter</label><input style={inp} type="number" step="0.001" value={fm.closing_reading||''} onChange={e=>setF(a.attendant_id,'closing_reading',e.target.value)}/></div>
                    <div><label className="label">Price/L</label><input style={inp} type="number" step="0.01" placeholder={prices[a.fuel_type]||''} value={fm.price_per_ltr||''} onChange={e=>setF(a.attendant_id,'price_per_ltr',e.target.value)}/></div>
                    <div><label className="label">Test L</label><input style={inp} type="number" step="0.01" value={fm.test_ltrs||''} onChange={e=>setF(a.attendant_id,'test_ltrs',e.target.value)}/></div>
                    <div><label className="label">Card ₹</label><input style={inp} type="number" step="0.01" value={fm.card_total||''} onChange={e=>setF(a.attendant_id,'card_total',e.target.value)}/></div>
                    <div><label className="label">UPI ₹</label><input style={inp} type="number" step="0.01" value={fm.upi_total||''} onChange={e=>setF(a.attendant_id,'upi_total',e.target.value)}/></div>
                    <div><label className="label">Cash counted ₹</label><input style={inp} type="number" step="0.01" value={fm.cash_actual||''} onChange={e=>setF(a.attendant_id,'cash_actual',e.target.value)}/></div>
                  </div>
                  {r && <div style={{fontSize:12.5,marginTop:8}}>Expected {fmt(r.cash_expected)} · Counted {fmt(r.cash_actual)} · <strong style={{color:short?'#dc2626':'#16a34a'}}>{short?'Shortage':v>0?'Overage':'Variance'} {fmt(Math.abs(v))}</strong></div>}
                  <button onClick={()=>reconcileMgr(a)} disabled={busy==='rec'+a.attendant_id} style={{marginTop:8,height:38,padding:'0 16px',background:r?'#475569':'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer',fontSize:13}}>{busy==='rec'+a.attendant_id?'Saving…':r?'Recompute':'Reconcile'}</button>
                </div>
              );
            })
          ) : (
            <div className="card">
              <div style={{fontWeight:700,fontSize:14,marginBottom:'0.75rem'}}>Operator submissions — confirm cash received</div>
              {posRecos.length===0 ? <div style={{color:'#aaa',fontSize:13}}>No operator has submitted their cash yet.</div>
                : posRecos.map(r=>(
                  <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #f0f0f0',padding:'8px 0'}}>
                    <div><div style={{fontWeight:600,fontSize:13}}>{r.attendant_name}</div><div style={{fontSize:12,color:'#888'}}>Submitted {fmt(r.cash_actual)}{r.manager_confirmed?` · variance ${fmt(Math.abs((r.cash_actual||0)-(r.cash_expected||0)))}`:''}</div></div>
                    {r.manager_confirmed ? <span style={{color:'#16a34a',fontSize:12,fontWeight:700,display:'flex',alignItems:'center',gap:4}}><CheckCircle size={14}/>Confirmed</span>
                      : <button onClick={()=>confirmPos(r)} disabled={busy==='pos'+r.id} className="btn btn-secondary btn-sm">Confirm receipt</button>}
                  </div>
                ))}
            </div>
          )}
          <button onClick={()=>setStep(2)} disabled={!allReconciled} style={{width:'100%',maxWidth:560,height:44,marginTop:'0.85rem',background:allReconciled?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:allReconciled?'pointer':'not-allowed'}}>
            {allReconciled?'Next: Wet-stock review →':'Reconcile every operator first'}
          </button>
        </div>
      )}

      {/* STEP 2 — Wet-stock */}
      {step===2 && (
        <div className="card">
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Wet-stock review</div>
          <div className="table-wrap">
            <table className="dms-table">
              <thead><tr><th>Tank</th><th style={{textAlign:'right'}}>Opening</th><th style={{textAlign:'right'}}>+Deliv</th><th style={{textAlign:'right'}}>−Sales</th><th style={{textAlign:'right'}}>Book</th><th style={{textAlign:'right'}}>Dip</th><th style={{textAlign:'right'}}>Variance</th></tr></thead>
              <tbody>
                {tankReco.length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-3)',padding:'1.5rem'}}>Computing…</td></tr>}
                {tankReco.map(t=>{ const loss=t.has_closing&&t.variance_ltrs<0; return (
                  <tr key={t.tank_id} style={t.beyond_tolerance?{background:'#fef2f2'}:undefined}>
                    <td style={{fontWeight:600}}>T{t.tank_number} <span style={{color:'var(--text-3)',fontWeight:400,fontSize:12}}>{t.fuel_type}</span></td>
                    <td className="num" style={{textAlign:'right'}}>{L(t.opening_ltrs)}</td>
                    <td className="num" style={{textAlign:'right',color:'#16a34a'}}>{L(t.deliveries_ltrs)}</td>
                    <td className="num" style={{textAlign:'right'}}>{L(t.sales_ltrs)}</td>
                    <td className="num" style={{textAlign:'right',fontWeight:600}}>{L(t.book_closing)}</td>
                    <td className="num" style={{textAlign:'right'}}>{t.has_closing?L(t.actual_closing):'—'}</td>
                    <td className="num" style={{textAlign:'right',fontWeight:700,color:!t.has_closing?'var(--text-3)':loss?'#dc2626':'#16a34a'}}>{t.has_closing?`${t.variance_ltrs>0?'+':''}${L(t.variance_ltrs)} (${t.variance_pct}%)`:'—'}{t.beyond_tolerance&&<AlertTriangle size={12} style={{marginLeft:4,verticalAlign:'middle'}}/>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          <button onClick={()=>setStep(3)} style={{width:'100%',height:44,marginTop:'1rem',background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>Next: Close shift →</button>
        </div>
      )}

      {/* STEP 3 — Close */}
      {step===3 && (
        <div className="card" style={{maxWidth:460,textAlign:'center'}}>
          {done ? (
            <>
              <CheckCircle size={48} color="#16a34a" style={{margin:'0.5rem auto'}}/>
              <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>Shift closed</div>
              <div style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>Sales recorded, wet-stock reconciled, and the cash is now in “awaiting deposit”.</div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>router.push('/shifts')} style={{flex:1,height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>Back to Shifts</button>
                <button onClick={()=>router.push('/deposits')} style={{flex:1,height:44,background:'#f1f5f9',color:'#334155',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>Bank Deposits</button>
              </div>
            </>
          ) : (
            <>
              <div style={{fontWeight:700,fontSize:15,marginBottom:'0.5rem'}}>Ready to close</div>
              <div style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>All operators reconciled. Closing the shift finalises sales, runs the wet-stock reconciliation, and moves the cash to “awaiting deposit”.</div>
              <button onClick={closeShift} disabled={busy==='close'} style={{width:'100%',height:48,background:'#dc2626',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:'pointer'}}>{busy==='close'?'Closing…':'Close Shift'}</button>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
