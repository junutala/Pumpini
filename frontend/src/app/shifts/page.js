'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, UserPlus, RefreshCw, Clock, Users, Activity } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';


const fmt    = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtL   = n => Number(n||0).toFixed(2);
const toIST  = ts => ts ? new Date(ts).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
const toDate = ts => ts ? new Date(ts).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short'}) : '—';

export default function ShiftsPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;
  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const isManager = ['owner','manager'].includes(user?.role);

  const [shifts,    setShifts]    = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [attendants,setAttendants]= useState([]);
  const [nozzles,   setNozzles]   = useState([]);
  const [rfidTags,  setRfidTags]  = useState([]);
  const [shiftDefs, setShiftDefs] = useState([]);
  const [users,     setUsers]     = useState([]);
  const [showOpen,  setShowOpen]  = useState(false);
  const [showAssign,setShowAssign]= useState(false);
  const [openForm,  setOpenForm]  = useState({shift_number:1,date:today});
  const [assignForm,setAssignForm]= useState({});
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const { on } = useSocket(stationId, selected?.id);

  const loadShifts = async() => {
    if(!stationId) return;
    const s = await api.get('/shifts',{params:{station_id:stationId,date:today}});
    setShifts(Array.isArray(s)?s:[]);
  };

  const loadShiftDetail = async(shift) => {
    setSelected(shift);
    const detail = await api.get(`/shifts/${shift.id}`);
    setSelected(detail);
  };

  useEffect(()=>{
    if(!stationId) return;
    loadShifts();
    Promise.all([
      api.get(`/users?station_id=${stationId}&role=attendant`),
      api.get(`/stations/${stationId}/nozzles`),
      api.get(`/rfid?station_id=${stationId}`),
      api.get(`/shifts/definitions/${stationId}`),
    ]).then(([u,n,r,d])=>{
      setUsers(Array.isArray(u)?u:[]);
      setNozzles(Array.isArray(n)?n:[]);
      setRfidTags(Array.isArray(r)?r:[]);
      setShiftDefs(Array.isArray(d)?d:[]);
    });
  },[stationId]);

  // Real-time update
  useEffect(()=> on('dispense:new', ()=>{ if(selected) loadShiftDetail(selected); }),[on,selected]);
  useRefreshOnFocus(loadShifts);
  
  const getShiftLabel = (num) => {
    const def = shiftDefs.find(d=>d.shift_number===num);
    return def ? `${tc('shifts_page.shift_label','Shift')} ${num} — ${def.name} (${def.start_time}–${def.end_time})` : `${tc('shifts_page.shift_label','Shift')} ${num}`;
  };

  const handleOpenShift = async(e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      await api.post('/shifts',{...openForm,station_id:stationId});
      setShowOpen(false); loadShifts();
    } catch(err){ setError(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const handleAssign = async(e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      if(!assignForm.attendant_id) throw {error:tc('shifts_page.select_attendant_err','Select an attendant')};
      if(!assignForm.nozzle_id)    throw {error:tc('shifts_page.select_nozzle_err','Select a nozzle')};
      await api.post(`/shifts/${selected.id}/assign`,assignForm);
      setShowAssign(false); setAssignForm({});
      loadShiftDetail(selected);
    } catch(err){ setError(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const handleClose = async(shift, force = false) => {
    if(!force && !confirm(tc('shifts_page.close_confirm','Close this shift?'))) return;
    try {
      await api.patch(`/shifts/${shift.id}/close`, force ? { confirm: true } : {});
      loadShifts();
      if(selected?.id===shift.id) setSelected(null);
    } catch(err) {
      if(err.error === 'active_pos') {
        if(confirm(`⚠️ ${err.message}\n\nForce close the shift anyway?`)) {
          handleClose(shift, true);
        }
      } else {
        alert(err.error || 'Failed to close shift');
      }
    }
  };

  const shiftAttendants = selected?.attendants || [];
  const shiftTotalSales = shiftAttendants.reduce((s,a)=>s+parseFloat(a.total_sales||0),0);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('shifts_page.title','Shifts')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>
            {today} · {shifts.filter(s=>s.status==='open').length} {tc('shifts_page.shifts_open','shift(s) open')}
          </div>
        </div>
        {isManager && (
          <button className="btn btn-primary" onClick={()=>{setError('');setShowOpen(true);}}>
            <Plus size={16}/>{tc('shifts_page.open_shift','Open Shift')}
          </button>
        )}
      </div>

      <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:selected?'320px 1fr':'1fr',gap:'1.5rem'}}>

        {/* Shifts list */}
        <div>
          {shifts.length===0 && (
            <div className="card" style={{textAlign:'center',color:'var(--text-3)',padding:'2rem',fontSize:13}}>
              {tc('shifts_page.no_shifts','No shifts today.')}<br/>
              {isManager?tc('shifts_page.click_open','Click "Open Shift" to start.'):tc('shifts_page.contact_mgr','Contact your manager to open a shift.')}
            </div>
          )}
          {shifts.map(shift=>(
            <div key={shift.id} className="card"
              style={{marginBottom:'0.75rem',cursor:'pointer',
                borderLeft:`3px solid ${shift.status==='open'?'var(--success)':'var(--border)'}`,
                borderColor:selected?.id===shift.id?'var(--brand)':'var(--border)'}}
              onClick={()=>loadShiftDetail(shift)}>

              {/* Shift header */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{getShiftLabel(shift.shift_number)}</div>
                  <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>
                    <Clock size={11} style={{verticalAlign:'middle',marginRight:3}}/>
                    {toIST(shift.start_time)}
                    {shift.end_time && ` → ${toIST(shift.end_time)}`}
                  </div>
                  <div style={{fontSize:12,color:'var(--text-3)'}}>
                    {tc('shifts_page.manager','Manager')}: {shift.manager_name}
                  </div>
                </div>
                <span className={`badge ${shift.status==='open'?'badge-success':'badge-gray'}`}>
                  {shift.status}
                </span>
              </div>

              {/* Quick stats */}
              <div style={{display:'flex',gap:'1rem',fontSize:12,color:'var(--text-2)',
                background:'var(--surface-2)',borderRadius:6,padding:'6px 10px'}}>
                <span><Users size={11} style={{verticalAlign:'middle'}}/> {shift.attendant_count} {tc('shifts_page.attendants','attendants')}</span>
                <span>₹{fmt(shift.total_sales)} {tc('shifts_page.sales','sales')}</span>
              </div>

              {/* Actions */}
              {isManager && shift.status==='open' && (
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  <button className="btn btn-primary btn-sm"
                    onClick={e=>{e.stopPropagation();setSelected(shift);setError('');setShowAssign(true);}}>
                    <UserPlus size={13}/>{tc('shifts_page.add_attendant','Add Attendant')}
                  </button>
                  <button className="btn btn-danger btn-sm"
                    onClick={e=>{e.stopPropagation();handleClose(shift);}}>
                    {tc('shifts_page.close_shift','Close Shift')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Shift Detail — Attendant Grid */}
        {selected && (
          <div>
            {/* Shift summary */}
            <div className="card" style={{marginBottom:'1rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
                <div style={{fontWeight:700,fontSize:15}}>{getShiftLabel(selected.shift_number)}</div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {selected.status==='open' && isManager && (
                    <>
                      <button className="btn btn-primary btn-sm"
                        onClick={()=>{setError('');setShowAssign(true);}}>
                        <UserPlus size={13}/>{tc('shifts_page.add_attendant','Add Attendant')}
                      </button>
                      <button className="btn btn-danger btn-sm"
                        onClick={()=>handleClose(selected)}>{tc('shifts_page.close_shift','Close Shift')}</button>
                    </>
                  )}
                  <button style={{background:'none',border:'none',cursor:'pointer'}}
                    onClick={()=>setSelected(null)}><X size={18}/></button>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid-3">
                {[
                  [tc('shifts_page.total_sales','Total Sales'),`₹${fmt(shiftTotalSales)}`,'var(--brand)'],
                  [tc('shifts_page.attendants','Attendants'),shiftAttendants.length,'var(--petrol)'],
                  [tc('shifts_page.transactions','Transactions'),shiftAttendants.reduce((s,a)=>s+parseInt(a.txn_count||0),0),'var(--success)'],
                ].map(([l,v,c])=>(
                  <div key={l} style={{background:'var(--surface-2)',borderRadius:8,padding:'0.75rem'}}>
                    <div style={{fontSize:11,color:'var(--text-3)',textTransform:'uppercase',marginBottom:3}}>{l}</div>
                    <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:16,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Attendant grid */}
            <div className="card" style={{marginBottom:'1rem'}}>
              <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>
                {tc('shifts_page.active_attendants','Active Attendants')} — {shiftAttendants.length} {tc('shifts_page.assigned','assigned')}
              </div>
              {shiftAttendants.length===0 && (
                <div style={{color:'var(--text-3)',fontSize:13,padding:'1rem',textAlign:'center'}}>
                  {tc('shifts_page.none_assigned','No attendants assigned yet.')}{isManager?tc('shifts_page.use_add_btn',' Use "Add Attendant" button.'):''}
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'0.75rem'}}>
                {shiftAttendants.map(att=>(
                  <div key={att.id} style={{
                    background:'var(--surface-2)',borderRadius:10,padding:'1rem',
                    border:'1px solid var(--border)',
                  }}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <div style={{width:32,height:32,borderRadius:'50%',background:'var(--brand)',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        color:'#fff',fontWeight:700,fontSize:14,flexShrink:0}}>
                        {(att.attendant_name||'?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>{att.attendant_name}</div>
                        <div style={{fontSize:11,color:'var(--text-3)'}}>
                          N{att.nozzle_number} · {att.fuel_type}
                        </div>
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:12}}>
                      <div style={{background:'#fff',borderRadius:6,padding:'4px 8px'}}>
                        <div style={{color:'var(--text-3)',fontSize:10}}>SALES</div>
                        <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--brand)'}}>₹{fmt(att.total_sales)}</div>
                      </div>
                      <div style={{background:'#fff',borderRadius:6,padding:'4px 8px'}}>
                        <div style={{color:'var(--text-3)',fontSize:10}}>LITRES</div>
                        <div style={{fontFamily:'var(--font-mono)',fontWeight:700}}>{fmtL(att.total_ltrs)}L</div>
                      </div>
                    </div>
                    {att.tag_uid && (
                      <div style={{marginTop:6,fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>
                        RFID: {att.tag_uid}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Open Shift */}
      {showOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:380}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>{tc('shifts_page.open_new_shift','Open New Shift')}</span>
              <button onClick={()=>setShowOpen(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            {error && <div className="alert-banner danger" style={{marginBottom:'1rem'}}>{error}</div>}
            <form onSubmit={handleOpenShift}>
              <div style={{marginBottom:'1rem'}}>
                <label className="label">{tc('shifts_page.shift_label','Shift')}</label>
                <select className="input" value={openForm.shift_number}
                  onChange={e=>setOpenForm(p=>({...p,shift_number:parseInt(e.target.value)}))}>
                  {[1,2,3].map(n=><option key={n} value={n}>{getShiftLabel(n)}</option>)}
                </select>
              </div>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">{tc('shifts_page.date','Date')}</label>
                <input className="input" type="date" value={openForm.date}
                  onChange={e=>setOpenForm(p=>({...p,date:e.target.value}))} required/>
              </div>
              <button className="btn btn-primary" type="submit"
                style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading?tc('shifts_page.opening','Opening...'):tc('shifts_page.open_shift','Open Shift')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Assign Attendant */}
      {showAssign && selected && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:460}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>{tc('shifts_page.add_to_shift','Add Attendant to Shift')}</div>
                <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{getShiftLabel(selected.shift_number)}</div>
              </div>
              <button onClick={()=>{setShowAssign(false);setError('');setAssignForm({});}}
                style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            {error && <div className="alert-banner danger" style={{marginBottom:'1rem'}}>{error}</div>}
            <form onSubmit={handleAssign}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="label">{tc('shifts_page.attendant','Attendant')} *</label>
                  <select className="input" required
                    onChange={e=>setAssignForm(p=>({...p,attendant_id:e.target.value}))}>
                    <option value="">{tc('shifts_page.select_attendant','Select attendant...')}</option>
                    {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('shifts_page.nozzle','Nozzle')} *</label>
                  <select className="input" required
                    onChange={e=>setAssignForm(p=>({...p,nozzle_id:e.target.value}))}>
                    <option value="">{tc('shifts_page.select_nozzle','Select nozzle...')}</option>
                    {nozzles.filter(n=>n.is_active).map(n=>(
                      <option key={n.id} value={n.id}>{tc('shifts_page.nozzle_word','Nozzle')} {n.nozzle_number} — {n.fuel_type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('shifts_page.rfid_tag','RFID Tag')}</label>
                  <select className="input"
                    onChange={e=>setAssignForm(p=>({...p,rfid_tag_id:e.target.value||null}))}>
                    <option value="">{tc('shifts_page.no_rfid','No RFID (manual POS)')}</option>
                    {rfidTags.map(r=><option key={r.id} value={r.id}>{r.tag_uid}{r.label?` — ${r.label}`:''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('shifts_page.opening_cash','Opening Cash (₹)')}</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    onChange={e=>setAssignForm(p=>({...p,opening_cash:e.target.value}))}/>
                </div>
                <div>
                  <label className="label">{tc('shifts_page.opening_meter','Opening Meter Reading')}</label>
                  <input className="input" type="number" step="0.001" placeholder="0.000"
                    onChange={e=>setAssignForm(p=>({...p,opening_reading:e.target.value}))}/>
                </div>
                <div>
                  <label className="label">{tc('shifts_page.upi_vpa','UPI VPA')}</label>
                  <input className="input" placeholder="attendant@upi"
                    onChange={e=>setAssignForm(p=>({...p,upi_vpa:e.target.value}))}/>
                </div>
              </div>
              <button className="btn btn-primary" type="submit"
                style={{width:'100%',justifyContent:'center',marginTop:'1rem'}} disabled={loading}>
                {loading?tc('shifts_page.adding','Adding...'):tc('shifts_page.add_to_shift','Add Attendant to Shift')}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
