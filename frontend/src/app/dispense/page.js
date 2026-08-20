'use client';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, getManagerDashboard, submitReco, getReco } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { nozName } from '../../lib/nozzle';

const DENOMS = [500,200,100,50,20,10,5,2,1];
const fmt = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const toIST = ts => ts ? new Date(ts).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';

export default function ReconcilePage() {
  const { user, station } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const stationId = typeof station==='object'?station?.id:station;
  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

  const [shifts,setShifts]         = useState([]);
  const [selectedShift,setSelectedShift] = useState(null);
  const [attendants,setAttendants] = useState([]);
  const [expanded,setExpanded]     = useState(null);
  const [denoms,setDenoms]         = useState({});   // {attendantId: {500:0,200:0,...}}
  const [recos,setRecos]           = useState({});   // {attendantId: reco result}
  const [loading,setLoading]       = useState(false);
  const [dispute,setDispute]       = useState({});   // {attendantId: {type,notes}}

  const loadShifts = useCallback(()=>{
    if(stationId) return getShifts({station_id:stationId,date:today}).then(setShifts);
  },[stationId,today]);

  useEffect(()=>{ loadShifts(); },[loadShifts]);
  useRefreshOnFocus(loadShifts);
  
  
  const loadShift = async(shift) => {
    setSelectedShift(shift);
    setExpanded(null);
    const mgr = await getManagerDashboard(stationId,shift.id);
    setAttendants(mgr.attendant_summary||[]);
    // load existing recos
    const r = await getReco(shift.id);
    const recoMap={};
    (r||[]).forEach(x=>{ recoMap[x.attendant_id]=x; });
    setRecos(recoMap);
  };

  const getDenomTotal = (attId) => {
    const d = denoms[attId]||{};
    return DENOMS.reduce((s,n)=>s+(parseInt(d[n]||0)*n),0);
  };

  const handleEndShift = async(att) => {
    const cashActual = getDenomTotal(att.attendant_id);
    if(cashActual===0 && !window.confirm(tc('dispp.confirmZeroCash','Cash total is ₹0. Continue?'))) return;
    setLoading(true);
    try {
      // Save denomination
      await api.post('/reconcile/denomination',{
        shift_id:selectedShift.id,
        attendant_id:att.attendant_id,
        ...Object.fromEntries(DENOMS.map(n=>[`note_${n}`,denoms[att.attendant_id]?.[n]||0])),
      });
      // Submit reconciliation
      const res = await submitReco({
        shift_id:selectedShift.id,
        attendant_id:att.attendant_id,
        cash_actual:cashActual,
        remarks:dispute[att.attendant_id]?.notes||'',
      });
      setRecos(p=>({...p,[att.attendant_id]:res}));
      setExpanded(null);
      alert(tc('dispp.shiftEndedAlert','Shift ended for {name}. Variance: ₹{variance}').replace('{name}',att.name).replace('{variance}',fmt(res.variance)));
    } catch(e){ alert(e.error||tc('dispp.failed','Failed')); }
    finally{ setLoading(false); }
  };

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{tc('dispp.pageTitle','Shift Reconciliation')}</h1>
      </div>

      {/* Shift selector */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>{tc('dispp.selectShiftToClose','Select Shift to Close')}</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          {shifts.filter(s=>s.status==='open'||s.status==='closed').map(s=>(
            <button key={s.id}
              className={`btn ${selectedShift?.id===s.id?'btn-primary':'btn-secondary'}`}
              onClick={()=>loadShift(s)}>
              {tc('dispp.shiftButton','Shift {number} — {status}').replace('{number}',s.shift_number).replace('{status}',s.status)}
            </button>
          ))}
          {shifts.length===0 && <div style={{color:'var(--text-3)',fontSize:13}}>{tc('dispp.noShiftsToday','No shifts today')}</div>}
        </div>
      </div>

      {/* Attendant reconciliation cards */}
      {selectedShift && (
        <div>
          <div style={{fontWeight:600,fontSize:14,marginBottom:'1rem',color:'var(--text-2)'}}>
            {tc('dispp.attendantEndOfShift','Shift {number} — Attendant End-of-Shift · Last updated: {time}').replace('{number}',selectedShift.shift_number).replace('{time}',toIST(new Date()))}
          </div>

          {attendants.length===0 && (
            <div className="card" style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>{tc('dispp.noAttendants','No attendants assigned to this shift')}</div>
          )}

          {attendants.map(att=>{
            const reco   = recos[att.attendant_id];
            const isOpen = !reco;
            const dTotal = getDenomTotal(att.attendant_id);

            return (
              <div key={att.attendant_id} className="card" style={{marginBottom:'1rem',borderColor:reco?'var(--success)':'var(--border)'}}>
                {/* Header */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{att.name}</div>
                    <div style={{fontSize:12,color:'var(--text-3)'}}>
                      {tc('dispp.nozzleLine','Nozzle {nozzle} · {fuel} · {count} transactions').replace('{nozzle}',nozName(att)).replace('{fuel}',att.fuel_type).replace('{count}',att.txn_count)}
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:16}}>₹{fmt(att.sales)}</div>
                      <div style={{fontSize:11,color:'var(--text-3)'}}>{tc('dispp.litresDispensed','{litres} L dispensed').replace('{litres}',Number(att.litres).toFixed(2))}</div>
                    </div>
                    {reco
                      ? <span className={`badge ${Math.abs(reco.variance)<=50?'badge-success':'badge-danger'}`}>
                          {Math.abs(reco.variance)<=50?tc('dispp.badgeClosed','✓ Closed'):tc('dispp.badgeVariance','⚠ Variance')}
                        </span>
                      : <button className="btn btn-secondary btn-sm"
                          onClick={()=>setExpanded(expanded===att.attendant_id?null:att.attendant_id)}>
                          {tc('dispp.endShift','End Shift')} {expanded===att.attendant_id?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
                        </button>
                    }
                  </div>
                </div>

                {/* Reco summary if done */}
                {reco && (
                  <div style={{marginTop:'1rem',padding:'0.75rem',background:'var(--surface-2)',borderRadius:8}}>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,fontSize:13}}>
                      {[['Total Sales',reco.total_sales,tc('dispp.totalSales','Total Sales')],['Cash Expected',reco.cash_expected,tc('dispp.cashExpected','Cash Expected')],['Cash Received',reco.cash_actual,tc('dispp.cashReceived','Cash Received')],['Variance',reco.variance,tc('dispp.variance','Variance')]].map(([l,v,lbl])=>(
                        <div key={l}>
                          <div style={{color:'var(--text-3)',fontSize:11}}>{lbl}</div>
                          <div style={{fontFamily:'var(--font-mono)',fontWeight:600,color:l==='Variance'?(Math.abs(reco.variance)<=50?'var(--success)':'var(--danger)'):'inherit'}}>
                            {l==='Variance'&&parseFloat(reco.variance)>=0?'+':''}₹{fmt(v)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="btn btn-secondary btn-sm" style={{marginTop:8}} onClick={()=>window.print()}>
                      <Printer size={13}/> {tc('dispp.printSlip','Print Slip')}
                    </button>
                  </div>
                )}

                {/* Denomination entry */}
                {expanded===att.attendant_id && isOpen && (
                  <div style={{marginTop:'1.25rem',borderTop:'1px solid var(--border)',paddingTop:'1.25rem'}}>
                    {/* Sales summary — shown to manager */}
                    <div style={{background:'var(--surface-2)',borderRadius:8,padding:'0.75rem',marginBottom:'1rem'}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--text-2)',marginBottom:8}}>{tc('dispp.salesSummary','Sales Summary (as of now)')}</div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,fontSize:13}}>
                        <div><div style={{color:'var(--text-3)',fontSize:11}}>{tc('dispp.totalSales','Total Sales')}</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700}}>₹{fmt(att.sales)}</div></div>
                        <div><div style={{color:'var(--text-3)',fontSize:11}}>{tc('dispp.cashSales','Cash Sales')}</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700}}>₹{fmt(att.cash||0)}</div></div>
                        <div><div style={{color:'var(--text-3)',fontSize:11}}>{tc('dispp.upi','UPI')}</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700}}>₹{fmt(att.upi||0)}</div></div>
                        <div><div style={{color:'var(--text-3)',fontSize:11}}>{tc('dispp.credit','Credit')}</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700}}>₹{fmt(att.credit||0)}</div></div>
                      </div>
                    </div>

                    {/* Denomination entry */}
                    <div style={{fontWeight:600,fontSize:13,marginBottom:'0.75rem'}}>{tc('dispp.cashCount','Cash Count — Enter number of notes/coins')}</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:'1rem'}}>
                      {DENOMS.map(denom=>{
                        const count = denoms[att.attendant_id]?.[denom]||0;
                        const subtotal = count * denom;
                        return (
                          <div key={denom} style={{background:'var(--surface-2)',borderRadius:8,padding:'8px 10px',display:'flex',alignItems:'center',gap:8}}>
                            <div style={{width:44,fontSize:13,fontWeight:600,color:'var(--text-2)'}}>₹{denom}</div>
                            <input type="number" min="0" className="input" style={{flex:1,height:32,fontSize:13,textAlign:'center'}}
                              value={count||''}
                              placeholder="0"
                              onChange={e=>setDenoms(p=>({
                                ...p,
                                [att.attendant_id]:{...(p[att.attendant_id]||{}),[denom]:parseInt(e.target.value)||0}
                              }))}/>
                            <div style={{width:60,fontSize:12,fontFamily:'var(--font-mono)',color:'var(--text-3)',textAlign:'right'}}>
                              {subtotal>0?`₹${fmt(subtotal)}`:''}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Total */}
                    <div style={{background:dTotal>0?'#dcfce7':'var(--surface-2)',borderRadius:8,padding:'0.75rem 1rem',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
                      <span style={{fontWeight:600}}>{tc('dispp.totalCashCounted','Total Cash Counted')}</span>
                      <span style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:20,color:dTotal>0?'var(--success)':'var(--text-3)'}}>₹{fmt(dTotal)}</span>
                    </div>

                    {/* Dispute notes */}
                    <div style={{marginBottom:'1rem'}}>
                      <label className="label">{tc('dispp.notesRemarks','Notes / Remarks (optional)')}</label>
                      <textarea className="input" rows={2} placeholder={tc('dispp.notesPlaceholder','Any discrepancy notes, reason for variance...')}
                        onChange={e=>setDispute(p=>({...p,[att.attendant_id]:{...(p[att.attendant_id]||{}),notes:e.target.value}}))}/>
                    </div>

                    {/* Dispute resolution */}
                    <div style={{marginBottom:'1.25rem'}}>
                      <label className="label">{tc('dispp.resolutionMethod','If variance: resolution method')}</label>
                      <select className="input" onChange={e=>setDispute(p=>({...p,[att.attendant_id]:{...(p[att.attendant_id]||{}),type:e.target.value}}))}>
                        <option value="">{tc('dispp.selectIfNeeded','Select if needed...')}</option>
                        <option value="cash_collected">{tc('dispp.collectCash','Collect cash from attendant now')}</option>
                        <option value="salary_deduction">{tc('dispp.deductSalary','Deduct from salary')}</option>
                        <option value="waived">{tc('dispp.waive','Waive (management decision)')}</option>
                      </select>
                    </div>

                    <button className="btn btn-primary btn-lg" style={{width:'100%',justifyContent:'center'}}
                      onClick={()=>handleEndShift(att)} disabled={loading}>
                      {loading?tc('dispp.processing','Processing...'):tc('dispp.endShiftSubmit','✓ End Shift & Submit')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
