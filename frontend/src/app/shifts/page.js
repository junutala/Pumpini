'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Plus, X, UserPlus, Clock, Users } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import ManagerReconcileModal from '../../components/shared/ManagerReconcileModal';
import { nozName } from '../../lib/nozzle';


const fmt    = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtL   = n => Number(n||0).toFixed(2);
const toIST  = ts => ts ? new Date(ts).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
const toDate = ts => ts ? new Date(ts).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short'}) : '—';

// The day a shift is FILED UNDER, as a person reads it. `shifts.date` is a plain
// YYYY-MM-DD, so it is sliced rather than parsed — constructing a Date from it and
// formatting in another zone is how a date drifts by one day.
const dateKey = (d) => String(d || '').slice(0, 10);
const fmtShiftDate = (d) => {
  const k = dateKey(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
  const [y, m, day] = k.split('-').map(Number);
  // en-IN, DD MMM YYYY (CLAUDE.md house facts). Built from the parts at UTC noon so
  // no timezone can push it either side of midnight.
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString('en-IN',
    { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ShiftsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;
  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const isManager = ['owner','manager'].includes(user?.role);

  // THE DAY BEING LOOKED AT. Defaults to today, which is every previous version of
  // this screen. Ramana, 23-Sep-2026, asked how to see an attendant's earlier
  // readings; the answer was that the list hardcoded today and the endpoint had
  // taken a `date` all along.
  const [viewDate,  setViewDate]  = useState(today);
  const [shifts,    setShifts]    = useState([]);
  const [selected,  setSelected]  = useState(null);
  // The pump rate in force on the viewed shift's own date, so a reading from last
  // week is priced at last week's rate. `/prices/:id/as-at` already existed for the
  // back-dated credit invoice — this is its second reader, not a second endpoint.
  const [prices,    setPrices]    = useState({});
  const [attendants,setAttendants]= useState([]);
  const [nozzles,   setNozzles]   = useState([]);
  const [shiftDefs, setShiftDefs] = useState([]);
  const [showOpen,  setShowOpen]  = useState(false);
  const [openForm,  setOpenForm]  = useState({shift_number:1,date:today});
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [managerMode, setManagerMode] = useState(false); // station runs manager-driven blind drop
  const [recoShift,   setRecoShift]   = useState(null);  // shift being reconciled+closed by manager

  const { on } = useSocket(stationId, selected?.id);

  // TODAY'S SHIFTS, PLUS EVERY OPEN ONE WHATEVER ITS DATE.
  //
  // This screen used to ask only for `date: today`, and a shift whose stored date is
  // not today then did not exist as far as the manager was concerned. That is not
  // hypothetical: SBR's live shift on 22-Sep-2026 carried date 20-Sep — two operators,
  // eight open legs, running — and the manager reported he "could not see the shift
  // had been closed". He could not see the shift at all.
  //
  // `shifts.date` is written straight from the Shift Start screen's date field, so it
  // is a LABEL the manager chose, not a fact the server derived. A label is a fine
  // thing to group a report by and a terrible thing to hide live state behind.
  //
  // So an OPEN shift is fetched unconditionally. Nothing else changes: the day's
  // closed shifts still come back by date, and the two lists are merged by id, newest
  // first, so a shift that is both today's and open appears exactly once.
  //
  // THE OPEN-SHIFT INJECTION IS FOR TODAY ONLY. Its whole purpose is that a live
  // shift can never be hidden on the screen a manager opens by default. Carrying it
  // into a browsed past date would do the opposite — today's running shift would
  // appear inside 15-Sep and read as though it belonged there, which is the same
  // confusion in a new place.
  const loadShifts = async() => {
    if(!stationId) return;
    const isToday = viewDate === today;
    const [byDate, open] = await Promise.all([
      api.get('/shifts',{params:{station_id:stationId,date:viewDate}}).catch(()=>[]),
      isToday ? api.get('/shifts',{params:{station_id:stationId,status:'open'}}).catch(()=>[]) : [],
    ]);
    const merged = new Map();
    for (const s of [...(Array.isArray(byDate)?byDate:[]), ...(Array.isArray(open)?open:[])]) {
      if (s && s.id) merged.set(s.id, s);
    }
    setShifts([...merged.values()].sort((a,b) =>
      String(b.date).localeCompare(String(a.date)) || (b.shift_number - a.shift_number)));
  };

  const loadShiftDetail = async(shift) => {
    setSelected(shift);
    const [detail, px] = await Promise.all([
      api.get(`/shifts/${shift.id}`),
      api.get(`/prices/${stationId}/as-at`,{params:{date:dateKey(shift.date)}}).catch(()=>[]),
    ]);
    const byFuel = {};
    (Array.isArray(px)?px:[]).forEach(r=>{ byFuel[r.fuel_type] = parseFloat(r.price); });
    setPrices(byFuel);
    setSelected(detail);
  };

  // The list reloads on the picked date; the station's fixtures load once.
  useEffect(()=>{ if(stationId) { loadShifts(); setSelected(null); } },[stationId,viewDate]);

  useEffect(()=>{
    if(!stationId) return;
    Promise.all([
      api.get(`/stations/${stationId}/nozzles`),
      api.get(`/shifts/definitions/${stationId}`),
      api.get(`/stations/${stationId}/settings`).catch(()=>({})),
    ]).then(([n,d,st])=>{
      setNozzles(Array.isArray(n)?n:[]);
      setShiftDefs(Array.isArray(d)?d:[]);
      setManagerMode(!!st?.manager_blind_drop);
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

  // BLIND DROP, MIRRORED EXACTLY. `GET /shifts` nulls total_sales for a non-owner on
  // an OPEN shift. Litres × price would hand that same figure straight back, so the
  // rupee column obeys the identical rule and nothing else changes: the READINGS and
  // the LITRES always show, because they are the meter, and the manager photographs
  // them off the slips himself. It is the money that is masked, not the evidence.
  const isOwner   = user?.role === 'owner';
  const showMoney = !!selected && (selected.status !== 'open' || isOwner);

  // One leg's working, as a manager checks it against paper: two readings he took,
  // the litres between them, the rate, the rupees. Never a total on its own —
  // CLAUDE.md, 29-Aug-2026: "when a total is computed from parts, return the parts."
  const legWorking = (nz) => {
    const open  = nz.opening_reading == null ? null : Number(nz.opening_reading);
    const close = nz.closing_reading == null ? null : Number(nz.closing_reading);
    const ltrs  = (open == null || close == null) ? null : close - open;
    const price = prices[nz.fuel_type];
    const amt   = (ltrs == null || price == null) ? null : ltrs * price;
    return { open, close, ltrs, price, amt };
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('shifts_page.title','Shifts')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <input className="input" type="date" value={viewDate} max={today}
              onChange={e=>setViewDate(e.target.value || today)}
              style={{width:150,height:30,fontSize:12.5,padding:'2px 8px'}}
              aria-label={tc('shifts_page.viewDate','Show shifts filed under')} />
            {viewDate !== today && (
              <button className="btn btn-secondary btn-sm" onClick={()=>setViewDate(today)}>
                {tc('shifts_page.backToToday','Today')}
              </button>
            )}
            <span>{shifts.filter(s=>s.status==='open').length} {tc('shifts_page.shifts_open','shift(s) open')}</span>
            {managerMode && <span style={{marginLeft:8,fontSize:11,fontWeight:700,color:'#9a3412',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:6,padding:'2px 7px'}}>🔒 Manager-driven mode</span>}
          </div>
        </div>
        {isManager && (
          <button className="btn btn-primary" onClick={()=>router.push('/shift-start')}>
            <Plus size={16}/>{tc('shifts_page.open_shift','Open Shift')}
          </button>
        )}
      </div>

      <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:selected?'320px 1fr':'1fr',gap:'1.5rem'}}>

        {/* Shifts list */}
        <div>
          {shifts.length===0 && (
            <div className="card" style={{textAlign:'center',color:'var(--text-3)',padding:'2rem',fontSize:13}}>
              {viewDate === today
                ? tc('shifts_page.no_shifts','No shifts today.')
                : tc('shifts_page.noShiftsOn','No shifts filed under {d}.').replace('{d}', fmtShiftDate(viewDate))}<br/>
              {viewDate !== today
                ? tc('shifts_page.pickAnotherDay','Pick another day above.')
                : (isManager?tc('shifts_page.click_open','Click "Open Shift" to start.'):tc('shifts_page.contact_mgr','Contact your manager to open a shift.'))}
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
                  {/* SAY WHEN IT IS FILED UNDER, but only when that is not today.
                      An open shift now appears whatever its date, so without this a
                      shift filed under 20-Sep would sit in today's list looking like
                      today's — which is the confusion this change exists to end, one
                      step further down. Silent on today's shifts: a date on every row
                      is noise, and noise is how the odd one stops being noticed. */}
                  {dateKey(shift.date) !== today && (
                    <div style={{fontSize:11.5,marginTop:2,color:'#b45309',fontWeight:600}}>
                      {tc('shifts_page.filedUnder','Filed under {d}').replace('{d}', fmtShiftDate(shift.date))}
                    </div>
                  )}
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <span className={`badge ${shift.status==='open'?'badge-success':'badge-gray'}`}>
                    {shift.status}
                  </span>
                  {/* Entry mode: how this shift's sales were recorded */}
                  {parseInt(shift.manager_events||0)>0 ? (
                    <span className="badge badge-warning" title={tc('shifts_page.mode_consolidated_hint','Sales entered as one consolidated total per attendant by the manager at close')}>
                      🧾 {tc('shifts_page.mode_consolidated','Consolidated')}
                    </span>
                  ) : parseInt(shift.pos_events||0)>0 ? (
                    <span className="badge badge-info" title={tc('shifts_page.mode_pos_hint','Each fill recorded live on the POS in the bay')}>
                      ⛽ {tc('shifts_page.mode_pos','POS live')}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Quick stats */}
              <div style={{display:'flex',gap:'1rem',fontSize:12,color:'var(--text-2)',
                background:'var(--surface-2)',borderRadius:6,padding:'6px 10px'}}>
                <span><Users size={11} style={{verticalAlign:'middle'}}/> {shift.attendant_count} {tc('shifts_page.attendants','attendants')}</span>
              </div>

              {/* Actions */}
              {isManager && shift.status==='open' && (
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  {/* RETIRED 01-Aug-2026 — this used to open a SECOND attendant-assign
                      form here. It diverged from the real one badly enough to be
                      actively misleading: it took one nozzle where an operator may man
                      several, asked for an opening cash float that outlets do not give,
                      took no photograph, and — after the close-carries-forward rule —
                      offered an "Opening Meter Reading" box whose value the server now
                      correctly IGNORES. A form that silently discards what a manager
                      types is worse than no form. The button stays because the job is
                      real; it now goes to the one place that does it. */}
                  <button className="btn btn-primary btn-sm"
                    onClick={e=>{e.stopPropagation(); router.push('/shift-start?shift='+shift.id);}}>
                    <UserPlus size={13}/>{tc('shifts_page.add_attendant','Add Attendant')}
                  </button>
                  <button className="btn btn-danger btn-sm"
                    onClick={e=>{e.stopPropagation(); router.push('/shift-end?shift='+shift.id);}}>
                    {tc('shifts_page.end_shift','End Shift')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Shift detail — who was on, and every nozzle leg they held with its two
            readings. The readings were always in this payload (`GET /shifts/:id`
            returns attendants[].nozzles[] with opening_reading and closing_reading);
            until 23-Sep-2026 the panel fetched them and rendered the attendant's name
            and ONE nozzle. Rupees still obey blind drop — see showMoney above. */}
        {selected && (
          <div className="card" style={{alignSelf:'flex-start'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
              <div style={{fontWeight:700,fontSize:14}}>
                {selected.status === 'open'
                  ? tc('shifts_page.active_attendants','Active Attendants')
                  : tc('shifts_page.whoWasOn','Who was on')} — {shiftAttendants.length} {tc('shifts_page.assigned','assigned')}
                <div style={{fontWeight:400,fontSize:11.5,color:'var(--text-3)',marginTop:2}}>
                  {getShiftLabel(selected.shift_number)} · {fmtShiftDate(selected.date)}
                </div>
              </div>
              <button style={{background:'none',border:'none',cursor:'pointer'}} onClick={()=>setSelected(null)}><X size={18}/></button>
            </div>
            {shiftAttendants.length===0 ? (
              <div style={{color:'var(--text-3)',fontSize:13,padding:'1rem',textAlign:'center'}}>
                {tc('shifts_page.none_assigned','No attendants assigned yet.')}{isManager?tc('shifts_page.use_add_btn',' Use "Add Attendant" button.'):''}
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'0.75rem'}}>
                {shiftAttendants.map(att=>{
                  // HIS LEGS, NOT "his nozzle". `shift_attendants.nozzle_id` is the
                  // legacy single slot and shows ONE machine for a man working four.
                  // The legs are the truth and have been arriving in this payload all
                  // along — this panel simply threw them away.
                  const legs  = att.nozzles || [];
                  const works = legs.map(nz => [nz, legWorking(nz)]);
                  const total = works.reduce((s,[,w]) => s + (w.amt ?? 0), 0);
                  const anyAmt = works.some(([,w]) => w.amt != null);
                  return (
                  <div key={att.id} style={{background:'var(--surface-2)',borderRadius:10,padding:'0.85rem',border:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:32,height:32,borderRadius:'50%',background:'var(--brand)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:14,flexShrink:0}}>
                        {(att.attendant_name||'?')[0].toUpperCase()}
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{att.attendant_name}</div>
                        <div style={{fontSize:11,color:'var(--text-3)'}}>
                          {legs.length
                            ? `${legs.length} ${legs.length===1?tc('shifts_page.nozzle','nozzle'):tc('shifts_page.nozzles','nozzles')}`
                            : `${nozName(att)} · ${att.fuel_type}`}
                        </div>
                      </div>
                    </div>

                    {/* THE READINGS. Two numbers he photographed, the litres between
                        them, and — when the money is his to see — the rupees. He
                        verifies one line against paper in ten seconds and after that
                        he stops verifying; that is what trust is. */}
                    {legs.length > 0 && (
                      <div style={{marginTop:8,borderTop:'1px solid var(--border)',paddingTop:8,display:'grid',gap:6}}>
                        {works.map(([nz,w])=>(
                          <div key={nz.nozzle_id} style={{fontSize:11.5}}>
                            <div style={{fontWeight:600,color:'var(--text-2)'}}>{nozName(nz)}</div>
                            <div style={{fontFamily:'var(--font-mono)',color:'var(--text-3)',display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
                              <span>
                                {w.open == null ? '—' : w.open.toFixed(3)}
                                {' → '}
                                {w.close == null
                                  ? <em style={{color:'#b45309',fontStyle:'normal'}}>{tc('shifts_page.stillOpen','open')}</em>
                                  : w.close.toFixed(3)}
                              </span>
                              <span>
                                {w.ltrs == null ? '' : `${fmtL(w.ltrs)} L`}
                                {showMoney && w.price != null && w.ltrs != null && ` × ₹${w.price}`}
                              </span>
                            </div>
                            {showMoney && w.amt != null && (
                              <div style={{textAlign:'right',fontWeight:700,fontSize:12}}>₹{fmt(w.amt)}</div>
                            )}
                          </div>
                        ))}
                        {showMoney && anyAmt && (
                          <div style={{borderTop:'1px solid var(--border)',paddingTop:6,display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:700}}>
                            <span>{tc('shifts_page.legTotal','Meter total')}</span><span>₹{fmt(total)}</span>
                          </div>
                        )}
                        {!showMoney && (
                          <div style={{fontSize:10.5,color:'var(--text-3)'}}>
                            {tc('shifts_page.moneyOnClose','Amounts show once the shift is closed.')}
                          </div>
                        )}
                      </div>
                    )}

                    {att.tag_uid && (
                      <div style={{marginTop:6,fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>RFID: {att.tag_uid}</div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
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

      {/* Manager-driven blind-drop: reconcile each attendant, then close */}
      {recoShift && (
        <ManagerReconcileModal
          shift={recoShift}
          onClose={()=>setRecoShift(null)}
          onClosed={()=>{ setRecoShift(null); setSelected(null); loadShifts(); }}
        />
      )}
    </AppShell>
  );
}
