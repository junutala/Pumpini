'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Eye, Building2, Users, Activity,
  CreditCard, BarChart2, AlertTriangle, RefreshCw } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRouter } from 'next/navigation';
import { displayMobile } from '../../lib/india';

const fmt = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const toIST = ts => ts ? new Date(ts).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',
  day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';

export default function SupportPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user } = useAuth();
  const router   = useRouter();

  const [stations,  setStations]  = useState([]);
  const [users,     setUsers]     = useState([]);
  const [corps,     setCorps]     = useState([]);
  const [alerts,    setAlerts]    = useState([]);
  const [search,    setSearch]    = useState('');
  const [tab,       setTab]       = useState('stations');
  const [loading,   setLoading]   = useState(true);

  // Only owner/superadmin can access
  if (user && !['owner','superadmin'].includes(user.role)) {
    return (
      <AppShell>
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--danger)'}}>
          {tc('support_page.access_denied','Access denied. Owner or SuperAdmin only.')}
        </div>
      </AppShell>
    );
  }

  useEffect(()=>{
    Promise.all([
      api.get('/stations').catch(()=>[]),
      api.get('/users').catch(()=>[]),
      api.get('/corporate/all').catch(()=>[]),
      api.get('/alerts?unread=true&limit=20').catch(()=>[]),
    ]).then(([s,u,c,a])=>{
      setStations(Array.isArray(s)?s:[]);
      setUsers(Array.isArray(u)?u:[]);
      setCorps(Array.isArray(c)?c:[]);
      setAlerts(Array.isArray(a)?a:[]);
    }).finally(()=>setLoading(false));
  },[]);

  const TABS = [
    {id:'stations', label:tc('support_page.stations','Stations'),         icon:<Building2 size={14}/>,  count:stations.length},
    {id:'users',    label:tc('support_page.users','Users'),            icon:<Users size={14}/>,       count:users.length},
    {id:'credits',  label:tc('support_page.credit_customers','Credit Customers'), icon:<CreditCard size={14}/>,  count:corps.length},
    {id:'alerts',   label:tc('support_page.alerts','Alerts'),           icon:<AlertTriangle size={14}/>,count:alerts.length},
  ];

  const q = search.toLowerCase();

  const filteredStations = stations.filter(s=>
    !q || s.name?.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q)
  );
  const filteredUsers = users.filter(u=>
    !q || u.name?.toLowerCase().includes(q) || u.phone?.includes(q)
  );
  const filteredCorps = corps.filter(c=>
    !q || c.company_name?.toLowerCase().includes(q) || c.gst_number?.includes(q)
  );

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('support_page.title','Support View')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>
            {tc('support_page.subtitle','God view — see everything across all stations')}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={()=>window.location.reload()}>
          <RefreshCw size={14}/>{tc('support_page.refresh','Refresh')}
        </button>
      </div>

      {/* Search */}
      <div style={{position:'relative',marginBottom:'1.5rem',maxWidth:400}}>
        <Search size={16} style={{position:'absolute',left:12,top:'50%',
          transform:'translateY(-50%)',color:'var(--text-3)'}}/>
        <input className="input" style={{paddingLeft:36}}
          placeholder={tc('support_page.search_ph','Search stations, users, credit customers...')}
          value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,borderBottom:'1px solid var(--border)',
        marginBottom:'1.5rem'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            display:'flex',alignItems:'center',gap:6,
            padding:'10px 16px',background:'none',border:'none',cursor:'pointer',
            fontWeight:tab===t.id?700:400,
            color:tab===t.id?'var(--brand)':'var(--text-2)',
            borderBottom:`2px solid ${tab===t.id?'var(--brand)':'transparent'}`,
            marginBottom:-1,fontSize:13,
          }}>
            {t.icon}{t.label}
            <span style={{background:tab===t.id?'var(--brand)':'var(--surface-2)',
              color:tab===t.id?'#fff':'var(--text-3)',
              borderRadius:99,padding:'1px 7px',fontSize:11,fontWeight:700}}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div style={{textAlign:'center',color:'var(--text-3)',padding:'3rem'}}>{tc('support_page.loading','Loading...')}</div>
      )}

      {/* Stations */}
      {tab==='stations' && !loading && (
        <div className="card">
          <div className="table-wrap">
            <table className="dms-table">
              <thead>
                <tr><th>{tc('support_page.station','Station')}</th><th>{tc('support_page.city','City')}</th><th>{tc('support_page.oil_co','Oil Co.')}</th>
                  <th>{tc('support_page.users','Users')}</th><th>{tc('support_page.actions','Actions')}</th></tr>
              </thead>
              <tbody>
                {filteredStations.map(s=>(
                  <tr key={s.id}>
                    <td style={{fontWeight:600}}>{s.name}</td>
                    <td>{s.city}, {s.state}</td>
                    <td><span className="badge badge-info">{s.oil_company||'—'}</span></td>
                    <td>{s.user_count||'—'}</td>
                    <td>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-primary btn-sm"
                          onClick={()=>router.push(`/dashboard?station_id=${s.id}`)}>
                          <Eye size={12}/>{tc('support_page.dashboard','Dashboard')}
                        </button>
                        <button className="btn btn-secondary btn-sm"
                          onClick={()=>router.push(`/shifts?station_id=${s.id}`)}>
                          {tc('support_page.shifts','Shifts')}
                        </button>
                        <button className="btn btn-secondary btn-sm"
                          onClick={()=>router.push(`/reports?station_id=${s.id}`)}>
                          {tc('support_page.reports','Reports')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users */}
      {tab==='users' && !loading && (
        <div className="card">
          <div className="table-wrap">
            <table className="dms-table">
              <thead>
                <tr><th>{tc('support_page.name','Name')}</th><th>{tc('support_page.mobile','Mobile')}</th><th>{tc('support_page.role','Role')}</th>
                  <th>{tc('support_page.status','Status')}</th><th>{tc('support_page.last_login','Last Login')}</th></tr>
              </thead>
              <tbody>
                {filteredUsers.map(u=>(
                  <tr key={u.id}>
                    <td style={{fontWeight:500}}>{u.name}</td>
                    <td style={{fontFamily:'var(--font-mono)',fontSize:13}}>
                      {displayMobile(u.phone)}
                    </td>
                    <td>
                      <span className="badge badge-gray"
                        style={{textTransform:'capitalize'}}>{u.role}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.is_active?'badge-success':'badge-danger'}`}>
                        {u.is_active?tc('support_page.active','Active'):tc('support_page.inactive','Inactive')}
                      </span>
                    </td>
                    <td style={{fontSize:12,color:'var(--text-3)'}}>
                      {toIST(u.last_login_at)||tc('support_page.never','Never')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Credit Customers */}
      {tab==='credits' && !loading && (
        <div className="card">
          <div className="table-wrap">
            <table className="dms-table">
              <thead>
                <tr><th>{tc('support_page.company','Company')}</th><th>GSTN</th><th>{tc('support_page.phone','Phone')}</th>
                  <th>{tc('support_page.stations','Stations')}</th><th>{tc('support_page.actions','Actions')}</th></tr>
              </thead>
              <tbody>
                {filteredCorps.map(c=>(
                  <tr key={c.id}>
                    <td style={{fontWeight:600}}>{c.company_name}</td>
                    <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>
                      {c.gst_number||c.gstn||'—'}
                    </td>
                    <td style={{fontSize:13}}>{displayMobile(c.contact_phone)}</td>
                    <td style={{fontSize:12,color:'var(--text-3)'}}>
                      {(c.stations||[]).filter(Boolean).join(', ')||'—'}
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm"
                        onClick={()=>router.push(`/credit-dashboard?corp_id=${c.id}`)}>
                        <Eye size={12}/>{tc('support_page.view_dashboard','View Dashboard')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Alerts */}
      {tab==='alerts' && !loading && (
        <div className="card">
          {alerts.length===0 && (
            <div style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>
              {tc('support_page.no_alerts','✓ No unread alerts')}
            </div>
          )}
          {alerts.map(a=>(
            <div key={a.id} style={{display:'flex',gap:12,padding:'12px 0',
              borderBottom:'1px solid var(--border)',alignItems:'flex-start'}}>
              <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,marginTop:6,
                background:a.severity==='critical'?'var(--danger)':
                  a.severity==='warning'?'var(--warning)':'var(--brand)'}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500}}>{a.message}</div>
                <div style={{fontSize:11,color:'var(--text-3)',marginTop:2}}>
                  {a.station_name} · {toIST(a.created_at)}
                </div>
              </div>
              <span className={`badge ${
                a.severity==='critical'?'badge-danger':
                a.severity==='warning'?'badge-warning':'badge-info'}`}>
                {a.severity}
              </span>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

