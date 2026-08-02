'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getAttendance, markAttendance, getUsers, getShiftClock } from '../../lib/api';
import ArtifactImage from '../../components/shared/ArtifactImage';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const STATUS_COLORS = { present:'badge-success', absent:'badge-danger', half_day:'badge-warning', leave:'badge-gray' };
const DENOMS = [500,200,100,50,20,10,5,2,1];

// IST helpers
const nowIST = () => {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5*60*60*1000));
  return ist.toISOString().slice(0,16);
};
const toIST = (ts) => {
  if(!ts) return '—';
  return new Date(ts).toLocaleString('en-IN',{
    timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true
  });
};
const todayIST = () => {
  return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
};
const daysAgoIST = (n) =>
  new Date(Date.now() - n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
// India reads DD/MM. A shift_date is a plain date string, so it is anchored at
// midnight rather than parsed as UTC and shown as the day before.
const fmtDay = (d) => d
  ? new Date(`${String(d).slice(0,10)}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
  : '—';

export default function AttendancePage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [date,setDate]           = useState(todayIST());
  const [records,setRecords]     = useState([]);
  const [employees,setEmployees] = useState([]);
  const [saving,setSaving]       = useState({});
  const [shiftFilter,setShiftFilter] = useState(1);

  // Bulk quick-mark state
  const [bulkStatus,setBulkStatus] = useState({});
  const [bulkCheckin,setBulkCheckin] = useState({});
  const [bulkCheckout,setBulkCheckout] = useState({});

  // The shift clock, over a range rather than a single day: the question an owner
  // asks is "who worked this week and for how long", not "who was here on Tuesday".
  // Defaults to the last 7 days.
  const [clock,setClock] = useState([]);
  const [clockFrom,setClockFrom] = useState(daysAgoIST(6));
  const [clockTo,setClockTo]     = useState(todayIST());

  const loadClock = async () => {
    if(!stationId) return;
    try {
      const rows = await getShiftClock({ station_id:stationId, from:clockFrom, to:clockTo });
      setClock(Array.isArray(rows)?rows:[]);
    } catch { setClock([]); }   // an empty clock reads as "nothing logged", which it is
  };
  useEffect(()=>{ loadClock(); },[stationId,clockFrom,clockTo]);

  const load = async() => {
    if(!stationId) return;
    const [r,e] = await Promise.all([
      getAttendance({station_id:stationId,date}),
      getUsers({station_id:stationId}),
    ]);
    setRecords(r); setEmployees(e);
    // Pre-fill bulk state
    const statusMap={}, cinMap={}, coutMap={};
    e.forEach(emp=>{
      const rec = r.find(x=>x.user_id===emp.id && x.shift_number===shiftFilter);
      statusMap[emp.id] = rec?.status||'present';
      cinMap[emp.id]    = rec?.check_in ? new Date(rec.check_in).toLocaleString('en-CA',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).replace(', ','\T') : '';
      coutMap[emp.id]   = rec?.check_out? new Date(rec.check_out).toLocaleString('en-CA',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).replace(', ','\T') : '';
    });
    setBulkStatus(statusMap);
  };

  useEffect(()=>{load();},[stationId,date,shiftFilter]);
  useRefreshOnFocus(load);

  const saveOne = async(empId) => {
    setSaving(p=>({...p,[empId]:true}));
    try {
      const checkIn  = bulkCheckin[empId]  ? new Date(bulkCheckin[empId]).toISOString()  : null;
      const checkOut = bulkCheckout[empId] ? new Date(bulkCheckout[empId]).toISOString() : null;
      await markAttendance({
        user_id:empId, station_id:stationId, date,
        shift_number:shiftFilter,
        status:bulkStatus[empId]||'present',
        check_in:checkIn, check_out:checkOut,
      });
      await load();
    } catch(e){ alert(e.error||tc('attend.failed','Failed')); }
    finally{ setSaving(p=>({...p,[empId]:false})); }
  };

  const saveAll = async() => {
    for(const emp of employees) {
      await saveOne(emp.id);
    }
  };

  const quickCheckIn = async(empId) => {
    const nowStr = nowIST();
    setBulkCheckin(p=>({...p,[empId]:nowStr}));
    setBulkStatus(p=>({...p,[empId]:'present'}));
    await markAttendance({
      user_id:empId, station_id:stationId, date,
      shift_number:shiftFilter, status:'present',
      check_in:new Date().toISOString(),
    });
    load();
  };

  const quickCheckOut = async(empId) => {
    const nowStr = nowIST();
    setBulkCheckout(p=>({...p,[empId]:nowStr}));
    await markAttendance({
      user_id:empId, station_id:stationId, date,
      shift_number:shiftFilter,
      status:bulkStatus[empId]||'present',
      check_out:new Date().toISOString(),
    });
    load();
  };

  const summary = ['present','absent','half_day','leave'].map(s=>({
    status:s, count:records.filter(r=>r.status===s && r.shift_number===shiftFilter).length
  }));

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{tc('attend.title','Attendance')}</h1>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:160}}/>
          <select className="input" style={{width:130}} value={shiftFilter} onChange={e=>setShiftFilter(parseInt(e.target.value))}>
            <option value={1}>{tc('attend.shift1','Shift 1')}</option>
            <option value={2}>{tc('attend.shift2','Shift 2')}</option>
            <option value={3}>{tc('attend.shift3','Shift 3')}</option>
          </select>
          <button className="btn btn-primary" onClick={saveAll}>{tc('attend.saveAll','Save All')}</button>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14}/></button>
        </div>
      </div>

      {/* Summary pills */}
      <div style={{display:'flex',gap:10,marginBottom:'1.5rem',flexWrap:'wrap'}}>
        {summary.map(s=>(
          <div key={s.status} className={`badge ${STATUS_COLORS[s.status]}`} style={{padding:'6px 12px',fontSize:13}}>
            {t(`attendance.${s.status}`)}: {s.count}
          </div>
        ))}
        <div style={{marginLeft:'auto',fontSize:13,color:'var(--text-3)',alignSelf:'center'}}>
          {tc('attend.allTimesIST','All times in IST (GMT+5:30)')}
        </div>
      </div>

      {/* ── SHIFT CLOCK ──────────────────────────────────────────────────────
          The attendant's OWN start and end, stamped by Start Shift and Close
          Shift and filed against the shift itself (shift_attendance). Kept
          visibly apart from the register below because the two are different
          kinds of record: this one is what the system observed, with a
          photograph at each end; that one is what somebody typed. Showing them
          in one grid would let a typed time borrow the authority of a stamped
          one. */}
      <div className="card" style={{marginBottom:'1.25rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:8}}>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{tc('attend.shiftClock','Shift clock')}</div>
            <div style={{fontSize:12,color:'var(--text-3)'}}>
              {tc('attend.shiftClockHint','Start and end recorded automatically when each attendant is started and settled.')}
            </div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <input className="input" type="date" style={{width:150}} value={clockFrom} onChange={e=>setClockFrom(e.target.value)}/>
            <span style={{color:'var(--text-3)',fontSize:12}}>{tc('attend.toWord','to')}</span>
            <input className="input" type="date" style={{width:150}} value={clockTo} onChange={e=>setClockTo(e.target.value)}/>
          </div>
        </div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('attend.thAttendant','Attendant')}</th>
                <th>{tc('attend.thDate','Date')}</th>
                <th>{tc('attend.thShift','Shift')}</th>
                <th>{tc('attend.thStarted','Started')}</th>
                <th>{tc('attend.thEnded','Ended')}</th>
                <th style={{textAlign:'right'}}>{tc('attend.thHours','Hours')}</th>
                <th>{tc('attend.thProof','Proof')}</th>
              </tr>
            </thead>
            <tbody>
              {clock.length === 0 ? (
                <tr><td colSpan={7} style={{color:'var(--text-3)',fontSize:13,padding:'14px 8px'}}>
                  {tc('attend.noClock','Nothing clocked in this period. Start an attendant from Start Shift and his start time appears here.')}
                </td></tr>
              ) : clock.map(c => (
                <tr key={c.id}>
                  <td style={{fontWeight:600}}>{c.attendant_name}</td>
                  <td>{fmtDay(c.shift_date)}</td>
                  <td>{c.shift_number}</td>
                  <td style={{fontVariantNumeric:'tabular-nums'}}>{toIST(c.started_at)}</td>
                  <td style={{fontVariantNumeric:'tabular-nums'}}>
                    {c.open
                      ? <span className="badge badge-warning">{tc('attend.stillOn','Still on shift')}</span>
                      : toIST(c.ended_at)}
                  </td>
                  <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                    {c.hours != null ? Number(c.hours).toFixed(2) : '—'}
                  </td>
                  <td>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      {c.start_photo_id && <ArtifactImage artifactId={c.start_photo_id} size={30} label={tc('attend.startPhoto','Photo at start')}/>}
                      {c.end_photo_id   && <ArtifactImage artifactId={c.end_photo_id}   size={30} label={tc('attend.endPhoto','Photo at close')}/>}
                      {!c.photo_backed && <span style={{fontSize:11.5,color:'var(--text-3)'}}>{tc('attend.noPhoto','—')}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk entry table */}
      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('attend.employee','Employee')}</th>
                <th>{tc('attend.role','Role')}</th>
                <th>{tc('attend.status','Status')}</th>
                <th>{tc('attend.checkInIST','Check In (IST)')}</th>
                <th>{tc('attend.checkOutIST','Check Out (IST)')}</th>
                <th>{tc('attend.quickActions','Quick Actions')}</th>
                <th>{tc('attend.save','Save')}</th>
              </tr>
            </thead>
            <tbody>
              {employees.filter(e=>e.role!=='owner').map(emp=>{
                const rec = records.find(r=>r.user_id===emp.id && r.shift_number===shiftFilter);
                return (
                  <tr key={emp.id} style={{background:rec?'transparent':'var(--surface-2)'}}>
                    <td>
                      <div style={{fontWeight:500}}>{emp.name}</div>
                      <div style={{fontSize:12,color:'var(--text-3)'}}>{emp.phone}</div>
                    </td>
                    <td><span className="badge badge-gray" style={{textTransform:'capitalize'}}>{emp.role}</span></td>
                    <td>
                      <select className="input" style={{width:110,height:32,fontSize:13}}
                        value={bulkStatus[emp.id]||'present'}
                        onChange={e=>setBulkStatus(p=>({...p,[emp.id]:e.target.value}))}>
                        <option value="present">{tc('attend.present','Present')}</option>
                        <option value="absent">{tc('attend.absent','Absent')}</option>
                        <option value="half_day">{tc('attend.halfDay','Half Day')}</option>
                        <option value="leave">{tc('attend.leave','Leave')}</option>
                      </select>
                    </td>
                    <td>
                      <input type="time" className="input" style={{width:110,height:32,fontSize:13}}
                        value={bulkCheckin[emp.id]||''}
                        onChange={e=>setBulkCheckin(p=>({...p,[emp.id]:e.target.value}))}/>
                      {rec?.check_in && <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>{tc('attend.saved','Saved')}: {toIST(rec.check_in)}</div>}
                    </td>
                    <td>
                      <input type="time" className="input" style={{width:110,height:32,fontSize:13}}
                        value={bulkCheckout[emp.id]||''}
                        onChange={e=>setBulkCheckout(p=>({...p,[emp.id]:e.target.value}))}/>
                      {rec?.check_out && <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>{tc('attend.saved','Saved')}: {toIST(rec.check_out)}</div>}
                    </td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-secondary btn-sm" title={tc('attend.checkInNow','Check In Now')}
                          onClick={()=>quickCheckIn(emp.id)}
                          style={{padding:'0 8px',fontSize:11}}>
                          <Clock size={12}/> {tc('attend.in','In')}
                        </button>
                        <button className="btn btn-secondary btn-sm" title={tc('attend.checkOutNow','Check Out Now')}
                          onClick={()=>quickCheckOut(emp.id)}
                          style={{padding:'0 8px',fontSize:11}}>
                          <Clock size={12}/> {tc('attend.out','Out')}
                        </button>
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm"
                        onClick={()=>saveOne(emp.id)}
                        disabled={saving[emp.id]}
                        style={{padding:'0 12px'}}>
                        {saving[emp.id]?'..':tc('attend.save','Save')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {employees.filter(e=>e.role!=='owner').length===0 && (
                <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>{tc('attend.noEmployees','No employees found')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{marginTop:'1rem',fontSize:12,color:'var(--text-3)'}}>
        💡 {tc('attend.tipUse','Tip: Use')} <strong>{tc('attend.in','In')}</strong> / <strong>{tc('attend.out','Out')}</strong> {tc('attend.tipStamp','buttons to stamp the current IST time instantly. Or manually type the time and click Save. Click')} <strong>{tc('attend.saveAll','Save All')}</strong> {tc('attend.tipSaveRows','to save all rows at once.')}
      </div>
    </AppShell>
  );
}
