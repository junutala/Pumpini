'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getAttendance, markAttendance, getUsers } from '../../lib/api';
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

export default function AttendancePage() {
  const { t } = useTranslation();
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
    } catch(e){ alert(e.error||'Failed'); }
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
        <h1 className="page-title">Attendance</h1>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:160}}/>
          <select className="input" style={{width:130}} value={shiftFilter} onChange={e=>setShiftFilter(parseInt(e.target.value))}>
            <option value={1}>Shift 1</option>
            <option value={2}>Shift 2</option>
            <option value={3}>Shift 3</option>
          </select>
          <button className="btn btn-primary" onClick={saveAll}>Save All</button>
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
          All times in IST (GMT+5:30)
        </div>
      </div>

      {/* Bulk entry table */}
      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Status</th>
                <th>Check In (IST)</th>
                <th>Check Out (IST)</th>
                <th>Quick Actions</th>
                <th>Save</th>
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
                        <option value="present">Present</option>
                        <option value="absent">Absent</option>
                        <option value="half_day">Half Day</option>
                        <option value="leave">Leave</option>
                      </select>
                    </td>
                    <td>
                      <input type="time" className="input" style={{width:110,height:32,fontSize:13}}
                        value={bulkCheckin[emp.id]||''}
                        onChange={e=>setBulkCheckin(p=>({...p,[emp.id]:e.target.value}))}/>
                      {rec?.check_in && <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>Saved: {toIST(rec.check_in)}</div>}
                    </td>
                    <td>
                      <input type="time" className="input" style={{width:110,height:32,fontSize:13}}
                        value={bulkCheckout[emp.id]||''}
                        onChange={e=>setBulkCheckout(p=>({...p,[emp.id]:e.target.value}))}/>
                      {rec?.check_out && <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>Saved: {toIST(rec.check_out)}</div>}
                    </td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-secondary btn-sm" title="Check In Now"
                          onClick={()=>quickCheckIn(emp.id)}
                          style={{padding:'0 8px',fontSize:11}}>
                          <Clock size={12}/> In
                        </button>
                        <button className="btn btn-secondary btn-sm" title="Check Out Now"
                          onClick={()=>quickCheckOut(emp.id)}
                          style={{padding:'0 8px',fontSize:11}}>
                          <Clock size={12}/> Out
                        </button>
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm"
                        onClick={()=>saveOne(emp.id)}
                        disabled={saving[emp.id]}
                        style={{padding:'0 12px'}}>
                        {saving[emp.id]?'..':'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {employees.filter(e=>e.role!=='owner').length===0 && (
                <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>No employees found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{marginTop:'1rem',fontSize:12,color:'var(--text-3)'}}>
        💡 Tip: Use <strong>In</strong> / <strong>Out</strong> buttons to stamp the current IST time instantly. Or manually type the time and click Save. Click <strong>Save All</strong> to save all rows at once.
      </div>
    </AppShell>
  );
}
