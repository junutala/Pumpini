'use client';
import { useState, useEffect } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt  = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtL = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:1});

export default function GroupDashboardPage() {
  const { user } = useAuth();
  const [groups,setGroups]       = useState([]);
  const [selectedGroup,setSelectedGroup] = useState(null);
  const [data,setData]           = useState(null);
  const [loading,setLoading]     = useState(false);

  useEffect(()=>{
    api.get('/groups/my').then(g=>{ setGroups(g); if(g.length===1){ setSelectedGroup(g[0]); loadGroup(g[0].id); }});
  },[]);
  useRefreshOnFocus(load);

  const loadGroup = async(id) => {
    setLoading(true);
    try { const d = await api.get(`/groups/${id}/dashboard`); setData(d); }
    catch(e){ console.error(e); }
    finally{ setLoading(false); }
  };

  const handleSelectGroup = (g) => { setSelectedGroup(g); loadGroup(g.id); };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Group Dashboard</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>Consolidated view across all petrol bunks</div>
        </div>
        {selectedGroup && <button className="btn btn-secondary btn-sm" onClick={()=>loadGroup(selectedGroup.id)}><RefreshCw size={14}/></button>}
      </div>

      {/* Group selector */}
      {groups.length > 1 && (
        <div style={{display:'flex',gap:10,marginBottom:'1.5rem',flexWrap:'wrap'}}>
          {groups.map(g=>(
            <button key={g.id}
              className={`btn ${selectedGroup?.id===g.id?'btn-primary':'btn-secondary'}`}
              onClick={()=>handleSelectGroup(g)}>
              <Globe size={14}/>{g.name}
            </button>
          ))}
        </div>
      )}

      {groups.length===0 && (
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>
          You are not part of any owner group yet. Contact the administrator.
        </div>
      )}

      {loading && <div style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>Loading group data...</div>}

      {data && !loading && (
        <>
          {/* Group KPIs */}
          <div className="grid-4" style={{marginBottom:'1.5rem'}}>
            <div className="stat-card">
              <div className="stat-label">Group Sales Today</div>
              <div className="stat-value amount">{fmt(data.totals.total_sales)}</div>
              <div className="stat-sub">{data.totals.total_txns} transactions</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Litres</div>
              <div className="stat-value" style={{color:'var(--petrol)'}}>{fmtL(data.totals.total_litres)} L</div>
              <div className="stat-sub">across {data.stations.length} bunks</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Open Shifts</div>
              <div className="stat-value" style={{color:'var(--brand)'}}>{data.totals.open_shifts}</div>
              <div className="stat-sub">group-wide</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Unread Alerts</div>
              <div className="stat-value" style={{color:data.totals.unread_alerts>0?'var(--danger)':'var(--success)'}}>{data.totals.unread_alerts}</div>
              <div className="stat-sub">{data.totals.unread_alerts>0?'Needs attention':'All clear ✓'}</div>
            </div>
          </div>

          {/* Per-station breakdown */}
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem',fontSize:14}}>Station-wise Performance — {new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'})}</div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>City</th>
                    <th>State</th>
                    <th>Oil Co.</th>
                    <th>Today's Sales</th>
                    <th>Litres</th>
                    <th>Transactions</th>
                    <th>Open Shifts</th>
                    <th>Alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map(s=>(
                    <tr key={s.id}>
                      <td style={{fontWeight:600}}>{s.name}</td>
                      <td>{s.city}</td>
                      <td>{s.state}</td>
                      <td><span className="badge badge-info" style={{fontSize:11}}>{s.oil_company||'—'}</span></td>
                      <td className="num" style={{fontWeight:600}}>₹{fmt(s.today_sales)}</td>
                      <td className="num">{fmtL(s.today_litres)} L</td>
                      <td className="num">{s.txn_count}</td>
                      <td>
                        <span className={`badge ${s.open_shifts>0?'badge-success':'badge-gray'}`}>
                          {s.open_shifts} open
                        </span>
                      </td>
                      <td>
                        {s.unread_alerts>0
                          ? <span className="badge badge-danger">{s.unread_alerts} ⚠</span>
                          : <span style={{color:'var(--text-3)',fontSize:13}}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr style={{background:'var(--surface-2)',fontWeight:700}}>
                    <td colSpan={4} style={{padding:'10px 14px',fontSize:13}}>GROUP TOTAL</td>
                    <td className="num" style={{padding:'10px 14px'}}>₹{fmt(data.totals.total_sales)}</td>
                    <td className="num" style={{padding:'10px 14px'}}>{fmtL(data.totals.total_litres)} L</td>
                    <td className="num" style={{padding:'10px 14px'}}>{data.totals.total_txns}</td>
                    <td style={{padding:'10px 14px'}}>{data.totals.open_shifts}</td>
                    <td style={{padding:'10px 14px'}}>{data.totals.unread_alerts}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
