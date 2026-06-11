'use client';
import { useState, useEffect } from 'react';
import { Users, Building2, Globe, TrendingUp, Plus, X, Shield, Layers,
         ToggleLeft, ToggleRight, LogOut, Edit2, Trash2, Key, UserPlus,
         CheckCircle, Eye, EyeOff, Calendar, IndianRupee, Inbox } from 'lucide-react';
import { INDIAN_STATES, getCities } from '../../lib/india';

if (typeof window === 'undefined') {
  // SSR guard — export empty component during server render
}

const fmt    = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtAmt = n => '₹' + Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});

const adminFetch = (url, opts={}) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : '';
  return fetch(`/api/superadmin${url}`, {
    ...opts,
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(opts.headers||{})}
  }).then(r=>r.json());
};

const PLAN_COLORS   = { pro:['#dbeafe','#1d4ed8'], enterprise:['#ede9fe','#5b21b6'] };
const STATUS_COLORS = { active:['#dcfce7','#15803d'], suspended:['#fef9c3','#854d0e'], cancelled:['#fee2e2','#991b1b'] };

// Lead pipeline
const LEAD_STATUS = [
  ['new',       'New',       '#dbeafe', '#1d4ed8'],
  ['contacted', 'Contacted', '#fef9c3', '#854d0e'],
  ['trial',     'Trial Set', '#ede9fe', '#5b21b6'],
  ['converted', 'Converted', '#dcfce7', '#15803d'],
  ['lost',      'Lost',      '#fee2e2', '#991b1b'],
];
const LEAD_SOURCE = ['website','whatsapp','referral','call','other'];
const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit'};
const btn = (bg='#FF6B00',color='#fff') => ({padding:'0 14px',height:34,background:bg,color,border:'none',borderRadius:7,cursor:'pointer',fontSize:13,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5});

function Field({label,children,required}){
  return (
    <div style={{marginBottom:'0.85rem'}}>
      <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4,color:'#333'}}>
        {label}{required&&<span style={{color:'#e07b0c',marginLeft:2}}>*</span>}
      </label>
      {children}
    </div>
  );
}

function PwField({value,onChange,placeholder}){
  const [show,setShow]=useState(false);
  return (
    <div style={{display:'flex',border:'1.5px solid #ddd',borderRadius:8,overflow:'hidden'}}>
      <input style={{flex:1,padding:'9px 11px',border:'none',fontSize:14,outline:'none'}}
        type={show?'text':'password'} placeholder={placeholder||'Min 8 chars'}
        value={value||''} onChange={e=>onChange(e.target.value)}/>
      <button type="button" onClick={()=>setShow(p=>!p)}
        style={{background:'none',border:'none',cursor:'pointer',padding:'0 12px',color:'#aaa'}}>
        {show?<EyeOff size={15}/>:<Eye size={15}/>}
      </button>
    </div>
  );
}

function Modal({title,onClose,children}){
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:300,overflowY:'auto',padding:'1rem'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'1.75rem',width:'100%',
        maxWidth:520,boxShadow:'0 20px 60px rgba(0,0,0,.3)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
          <span style={{fontWeight:700,fontSize:16}}>{title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',padding:4}}><X size={18}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SubBadge({plan,status}){
  const [pb,pt]=PLAN_COLORS[plan]||['#f3f4f6','#374151'];
  const [sb,st]=STATUS_COLORS[status]||['#f3f4f6','#374151'];
  return (
    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
      {plan&&<span style={{padding:'2px 7px',borderRadius:99,fontSize:11,fontWeight:600,background:pb,color:pt}}>{plan.toUpperCase()}</span>}
      {status&&<span style={{padding:'2px 7px',borderRadius:99,fontSize:11,fontWeight:600,background:sb,color:st}}>{status}</span>}
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────
function LoginScreen({onLogin}){
  const [form,setForm]=useState({email:'',password:''});
  const [showPw,setShowPw]=useState(false);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  const submit=async e=>{
    e.preventDefault(); setLoading(true); setError('');
    const res=await fetch('/api/superadmin/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(form)
    }).then(r=>r.json());
    if(res.error){setError(res.error);setLoading(false);return;}
    localStorage.setItem('admin_token',res.token);
    onLogin(res.admin);
    setLoading(false);
  };

  return (
    <div style={{minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0F1923'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2.5rem',width:380,boxShadow:'0 20px 60px rgba(0,0,0,.4)'}}>
        <div style={{textAlign:'center',marginBottom:'2rem'}}>
          <div style={{fontSize:32,fontWeight:900,marginBottom:8}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#1A5F7A'}}>ini</span>
          </div>
          <div style={{display:'inline-flex',alignItems:'center',gap:6,background:'#f0f9ff',
            padding:'4px 12px',borderRadius:99,fontSize:13,color:'#1A5F7A',fontWeight:600}}>
            <Shield size={14}/> SuperAdmin Console
          </div>
        </div>
        <form onSubmit={submit}>
          <div style={{marginBottom:'1rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Email</label>
            <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box'}}
              type="email" placeholder="admin@pumpini.in" value={form.email}
              onChange={e=>setForm(p=>({...p,email:e.target.value}))} required/>
          </div>
          <div style={{marginBottom:'1.5rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Password</label>
            <div style={{display:'flex',border:'1.5px solid #ddd',borderRadius:8,overflow:'hidden'}}>
              <input style={{flex:1,padding:'10px 12px',border:'none',fontSize:14,outline:'none'}}
                type={showPw?'text':'password'} placeholder="••••••••" value={form.password}
                onChange={e=>setForm(p=>({...p,password:e.target.value}))} required/>
              <button type="button" onClick={()=>setShowPw(p=>!p)}
                style={{background:'none',border:'none',cursor:'pointer',padding:'0 12px',color:'#aaa'}}>
                {showPw?<EyeOff size={16}/>:<Eye size={16}/>}
              </button>
            </div>
          </div>
          {error&&<div style={{background:'#fee2e2',color:'#991b1b',padding:'10px 12px',borderRadius:8,fontSize:13,marginBottom:'1rem'}}>{error}</div>}
          <button style={{width:'100%',height:46,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:700,cursor:'pointer'}}
            type="submit" disabled={loading}>{loading?'Logging in...':'Login'}</button>
        </form>
      </div>
    </div>
  );
}

// ── Main Admin App ────────────────────────────────────────
export default function AdminPage(){
  if (typeof window === 'undefined') return null;

  const [admin,setAdmin]         = useState(null);
  const [tab,setTab]             = useState('dashboard');
  const [stats,setStats]         = useState(null);
  const [groups,setGroups]       = useState([]);
  const [owners,setOwners]       = useState([]);
  const [stations,setStations]   = useState([]);
  const [plans,setPlans]         = useState([]);
  const [alertDefs,setAlertDefs] = useState([]);
  const [stationSubs,setStationSubs]   = useState({});
  const [groupMembers,setGroupMembers] = useState({});
  const [groupStations,setGroupStations] = useState({});
  const [selStation,setSelStation]     = useState('');
  const [stationUsers,setStationUsers] = useState([]);
  const [leads,setLeads]               = useState([]);
  const [leadSort,setLeadSort]         = useState({ field:'created_at', dir:'desc' });
  const [hideClosed,setHideClosed]     = useState(false);
  const [modal,setModal]   = useState(null);
  const [form,setForm]     = useState({});
  const [loading,setLoading] = useState(false);
  const [toast,setToast]   = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const openModal  = (type,data={}) => { setForm({...data}); setModal({type,data}); };
  const closeModal = () => { setModal(null); setForm({}); };
  const todayIST   = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

  useEffect(()=>{
    const token = localStorage.getItem('admin_token');
    if(!token) return;
    try {
      const p = JSON.parse(atob(token.split('.')[1]));
      if(p.isSuperAdmin && p.exp > Date.now()/1000) setAdmin(p);
      else localStorage.removeItem('admin_token');
    } catch { localStorage.removeItem('admin_token'); }
  },[]);

  const reload = async()=>{
    const [s,g,o,st,pl,ad] = await Promise.all([
      adminFetch('/platform-stats'),
      adminFetch('/groups'),
      adminFetch('/owners'),
      adminFetch('/stations'),
      adminFetch('/plans'),
      adminFetch('/alert-definitions'),
    ]);
    setStats(s); setGroups(Array.isArray(g)?g:[]); setOwners(Array.isArray(o)?o:[]);
    setStations(Array.isArray(st)?st:[]); setPlans(Array.isArray(pl)?pl:[]);
    setAlertDefs(Array.isArray(ad)?ad:[]);
    loadLeads();
  };

  useEffect(()=>{ if(admin) reload(); },[admin]);

  const loadLeads = async()=>{ const r=await adminFetch('/leads'); setLeads(Array.isArray(r)?r:[]); };
  const patchLead = async(id,body)=>{ await adminFetch(`/leads/${id}`,{method:'PATCH',body:JSON.stringify(body)}); loadLeads(); };
  const LEAD_CLOSED = ['converted','lost'];
  const sortLeads = (field)=> setLeadSort(s=>({ field, dir: s.field===field && s.dir==='asc' ? 'desc' : 'asc' }));
  const sortedLeads = [...leads]
    .filter(l=> !hideClosed || !LEAD_CLOSED.includes(l.status))
    .sort((a,b)=>{
      const f = leadSort.field; let va, vb;
      if (f==='status') { va = LEAD_STATUS.findIndex(x=>x[0]===a.status); vb = LEAD_STATUS.findIndex(x=>x[0]===b.status); }
      else { va = (a[f]||'').toString().toLowerCase(); vb = (b[f]||'').toString().toLowerCase(); }
      if (va<vb) return leadSort.dir==='asc'?-1:1;
      if (va>vb) return leadSort.dir==='asc'?1:-1;
      return 0;
    });
  const loadGroupMembers  = async gid => { const r=await adminFetch(`/groups/${gid}/members-list`); setGroupMembers(p=>({...p,[gid]:Array.isArray(r)?r:[]})); };
  const loadGroupStations = async gid => { const r=await adminFetch(`/groups/${gid}/stations`); setGroupStations(p=>({...p,[gid]:Array.isArray(r)?r:[]})); };
  const loadStationUsers  = async sid => { if(!sid)return; const r=await adminFetch(`/station-users/${sid}`); setStationUsers(Array.isArray(r)?r:[]); };

  const save = async(url,method='POST')=>{
    setLoading(true);
    const res=await adminFetch(url,{method,body:JSON.stringify(form)});
    setLoading(false);
    if(res.error){alert(res.error);return false;}
    closeModal(); reload(); showToast('Saved!');
    return true;
  };

  const resetPassword = async userId=>{
    const pw=prompt('New password (min 8 chars):');
    if(!pw||pw.length<8){alert('Too short');return;}
    await adminFetch(`/owners/${userId}`,{method:'PATCH',body:JSON.stringify({password:pw})});
    showToast('Password reset!');
  };

  if(!admin) return <LoginScreen onLogin={a=>setAdmin(a)}/>;

  const TABS=[
    {id:'dashboard',label:'Platform Dashboard',icon:<TrendingUp size={14}/>},
    {id:'groups',   label:'Owner Groups',      icon:<Globe size={14}/>},
    {id:'owners',   label:'Owners',            icon:<Users size={14}/>},
    {id:'stations', label:'Petrol Bunks',      icon:<Building2 size={14}/>},
    {id:'plans',    label:'Plans',             icon:<Layers size={14}/>},
    {id:'alertdefs',label:'Alert Definitions', icon:<Shield size={14}/>},
    {id:'stationusers',label:'Users & Roles',  icon:<UserPlus size={14}/>},
    {id:'leads',    label:'Leads',             icon:<Inbox size={14}/>},
  ];

  const formCities = getCities(form.state||'');

  return (
    <div style={{display:'flex',minHeight:'100dvh',fontFamily:'DM Sans,system-ui,sans-serif',background:'#F4F7FA',fontSize:14}}>

      {toast&&(
        <div style={{position:'fixed',top:20,right:20,background:'#16a34a',color:'#fff',
          padding:'10px 18px',borderRadius:10,zIndex:999,display:'flex',alignItems:'center',gap:8}}>
          <CheckCircle size={16}/>{toast}
        </div>
      )}

      {/* Sidebar */}
      <div style={{width:220,background:'#0F1923',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100dvh',flexShrink:0}}>
        <div style={{padding:'1.25rem 1rem 1rem',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
          <div style={{fontSize:22,fontWeight:900}}><span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span></div>
          <div style={{fontSize:11,color:'rgba(255,255,255,.35)',marginTop:2}}>ADMIN CONSOLE</div>
        </div>
        <nav style={{flex:1,padding:'0.5rem 0'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 16px',
              background:tab===t.id?'rgba(255,107,0,.15)':'none',border:'none',cursor:'pointer',
              color:tab===t.id?'#FF6B00':'rgba(255,255,255,.55)',fontSize:13,fontWeight:tab===t.id?600:400,
              textAlign:'left',borderLeft:tab===t.id?'3px solid #FF6B00':'3px solid transparent',
            }}>{t.icon}{t.label}</button>
          ))}
        </nav>
        <div style={{padding:'1rem',borderTop:'1px solid rgba(255,255,255,.08)'}}>
          <div style={{fontSize:12,color:'rgba(255,255,255,.5)',marginBottom:8}}>{admin.name}</div>
          <button style={{background:'rgba(255,255,255,.08)',border:'none',color:'rgba(255,255,255,.6)',
            borderRadius:7,padding:'7px 12px',cursor:'pointer',fontSize:12,width:'100%',display:'flex',alignItems:'center',gap:6}}
            onClick={()=>{localStorage.removeItem('admin_token');setAdmin(null);}}>
            <LogOut size={13}/>Logout
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,padding:'2rem',overflow:'auto',minWidth:0}}>

        {/* ── Platform Dashboard ── */}
        {tab==='dashboard'&&(
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>Platform Dashboard</h1>
            <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem',marginBottom:'2rem'}}>
              {[
                ['Owner Groups',  stats?.total_groups||0,   '#FF6B00'],
                ['Owners',        stats?.total_owners||0,   '#9333ea'],
                ['Petrol Bunks',  stats?.total_stations||0, '#1A5F7A'],
                ['Active Users',  stats?.total_users||0,    '#16a34a'],
                ["Today's Sales", fmtAmt(stats?.today_sales||0),'#dc2626'],
                ['MTD Sales',     fmtAmt(stats?.mtd_sales||0),  '#0891b2'],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:'#fff',borderRadius:12,padding:'1.25rem',border:'1px solid #e5e3de',borderTop:`3px solid ${c}`}}>
                  <div style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{l}</div>
                  <div style={{fontSize:'1.75rem',fontWeight:800,color:c}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Recent Petrol Bunks</span>
                <button style={btn()} onClick={()=>openModal('station')}><Plus size={14}/>New Bunk</button>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Station','City','Plan','Status'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stations.slice(0,8).map(s=>(
                    <tr key={s.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{s.name}</td>
                      <td style={{padding:'11px 14px'}}>{s.city||'—'}</td>
                      <td style={{padding:'11px 14px'}}><SubBadge plan={s.plan}/></td>
                      <td style={{padding:'11px 14px'}}><SubBadge status={s.sub_status}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Owner Groups ── */}
        {tab==='groups'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Owner Groups</h1>
              <button style={btn()} onClick={()=>openModal('group')}><Plus size={15}/>New Group</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))',gap:'1rem'}}>
              {groups.map(g=>(
                <div key={g.id} style={{background:'#fff',borderRadius:12,padding:'1.5rem',border:'1px solid #e5e3de',borderTop:`3px solid ${g.is_active?'#FF6B00':'#ccc'}`}}>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{g.name}</div>
                  <div style={{fontSize:12,color:'#888',marginBottom:'0.75rem'}}>{g.description||'No description'}</div>
                  <div style={{fontSize:12,color:'#555',marginBottom:'0.5rem',fontWeight:600}}>
                    👥 {g.owner_count||0} owners · ⛽ {g.station_count||0} bunks
                  </div>

                  {/* Owners sub-grid */}
                  <div style={{background:'#f8f7f5',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.5rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase'}}>Owners</span>
                      <button style={{...btn('#f0fff4','#15803d'),height:24,padding:'0 8px',fontSize:11}}
                        onClick={()=>openModal('addMember',{group_id:g.id,group_name:g.name})}><Plus size={11}/>Add</button>
                    </div>
                    {groupMembers[g.id]
                      ? groupMembers[g.id].length===0
                        ? <div style={{color:'#aaa',fontSize:11}}>No owners yet</div>
                        : groupMembers[g.id].map(m=>(
                          <div key={m.user_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #ece9e4'}}>
                            <span style={{fontWeight:600}}>{m.owner_name}</span>
                            <button style={{fontSize:10,padding:'1px 6px',background:'#fee2e2',border:'none',borderRadius:4,cursor:'pointer',color:'#991b1b'}}
                              onClick={()=>adminFetch(`/groups/${g.id}/members/${m.user_id}`,{method:'DELETE'}).then(()=>{loadGroupMembers(g.id);reload();})}>Remove</button>
                          </div>
                        ))
                      : <button style={{fontSize:11,color:'#1A5F7A',background:'none',border:'none',cursor:'pointer'}} onClick={()=>loadGroupMembers(g.id)}>Click to view</button>
                    }
                  </div>

                  {/* Bunks sub-grid */}
                  <div style={{background:'#f0f9ff',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase'}}>Petrol Bunks</span>
                      <button style={{...btn('#f0fff4','#15803d'),height:24,padding:'0 8px',fontSize:11}}
                        onClick={()=>{ loadGroupStations(g.id); openModal('addBunk',{group_id:g.id,group_name:g.name}); }}><Plus size={11}/>Add</button>
                    </div>
                    {groupStations[g.id]
                      ? groupStations[g.id].length===0
                        ? <div style={{color:'#aaa',fontSize:11}}>No bunks</div>
                        : groupStations[g.id].map(s=>(
                          <div key={s.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #e0eefb'}}>
                            <span style={{fontWeight:600}}>{s.name}</span>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <SubBadge plan={s.plan} status={s.sub_status}/>
                              <button style={{fontSize:10,padding:'1px 6px',background:'#fee2e2',border:'none',borderRadius:4,cursor:'pointer',color:'#991b1b'}}
                                onClick={()=>adminFetch(`/groups/${g.id}/stations/${s.id}`,{method:'DELETE'}).then(()=>{loadGroupStations(g.id);reload();showToast('Bunk removed.');})}>Remove</button>
                            </div>
                          </div>
                        ))
                      : <button style={{fontSize:11,color:'#1A5F7A',background:'none',border:'none',cursor:'pointer'}} onClick={()=>loadGroupStations(g.id)}>Click to view</button>
                    }
                  </div>

                  <div style={{display:'flex',gap:6}}>
                    <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('group',{id:g.id,name:g.name,description:g.description})}><Edit2 size={12}/>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Owners ── */}
        {tab==='owners'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Owners</h1>
              <button style={btn()} onClick={()=>openModal('owner')}><Plus size={15}/>New Owner</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Name','Mobile','Email','Bunks','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {owners.map(o=>(
                    <tr key={o.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{o.name}</td>
                      <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:13}}>{(o.phone||'').replace('+91','')}</td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'#666'}}>{o.email||'—'}</td>
                      <td style={{padding:'11px 14px'}}>{o.station_count||0}</td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',gap:5}}>
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editOwner',{id:o.id,name:o.name,email:o.email,phone:(o.phone||'').replace('+91','')})}><Edit2 size={12}/>Edit</button>
                          <button style={btn('#fff7ed','#9a3412')} onClick={()=>resetPassword(o.id)}><Key size={12}/>Reset PW</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Petrol Bunks ── */}
        {tab==='stations'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Petrol Bunks</h1>
              <button style={btn()} onClick={()=>openModal('station')}><Plus size={15}/>New Petrol Bunk</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Station','City','Oil Co.','Plan / Status','Start','End','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stations.map(s=>(
                    <tr key={s.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{s.name}</td>
                      <td style={{padding:'11px 14px'}}>{s.city||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12}}>{s.oil_company||'—'}</td>
                      <td style={{padding:'11px 14px'}}><SubBadge plan={s.plan} status={s.sub_status}/></td>
                      <td style={{padding:'11px 14px',fontSize:12,fontFamily:'monospace'}}>{s.start_date||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12}}>{s.end_date||<span style={{color:'#16a34a',fontWeight:600,fontSize:11}}>Active</span>}</td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',gap:5}}>
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editStation',{id:s.id,name:s.name,address:s.address,city:s.city,state:s.state,gst_number:s.gst_number,oil_company:s.oil_company,owner_id:(s.owner_ids&&s.owner_ids[0])||'',owner_group_id:s.owner_group_id||''})}><Edit2 size={12}/>Edit</button>
                          <button style={btn('#fff7ed','#9a3412')} onClick={()=>{setForm({station_id:s.id,plan:s.plan||'pro',status:s.sub_status||'active',start_date:s.start_date||todayIST(),end_date:s.end_date||''});setModal({type:'editSub',data:s});}}><Calendar size={12}/>Plan</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Plans ── */}
        {tab==='plans'&&(
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>Plans</h1>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem'}}>
              {['pro','enterprise'].map(planName=>{
                const plan=plans.find(p=>p.name===planName);
                const features=plan?.features?(typeof plan.features==='string'?JSON.parse(plan.features):plan.features):[];
                const [pb,pt]=PLAN_COLORS[planName]||['#f3f4f6','#374151'];
                return (
                  <div key={planName} style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
                    <div style={{background:pb,padding:'1rem 1.25rem',borderBottom:`2px solid ${pt}`}}>
                      <div style={{fontSize:18,fontWeight:800,color:pt}}>{planName.toUpperCase()}</div>
                      <div style={{fontSize:13,color:pt,opacity:.8,marginTop:2}}>{plan?`₹${Number(plan.price_per_month||0).toLocaleString('en-IN')}/month`:'Not configured'}</div>
                    </div>
                    <div style={{padding:'1rem 1.25rem'}}>
                      <div style={{marginBottom:'0.75rem'}}>
                        <label style={{fontSize:12,fontWeight:600,color:'#555',display:'block',marginBottom:4}}>Price/month (₹)</label>
                        <input style={{...inp}} type="number" placeholder="e.g. 999" defaultValue={plan?.price_per_month||''} id={`price-${planName}`}/>
                      </div>
                      <div style={{marginBottom:'0.75rem'}}>
                        <div style={{fontSize:12,fontWeight:600,color:'#555',marginBottom:6}}>Features</div>
                        <div style={{maxHeight:180,overflowY:'auto'}}>
                          {features.map((feat,i)=>(
                            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',background:'#f8f7f5',borderRadius:6,marginBottom:4,fontSize:13}}>
                              <span>{feat}</span>
                              <button style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:2}}
                                onClick={async()=>{const nf=features.filter((_,fi)=>fi!==i);await adminFetch(plan?`/plans/${plan.id}`:`/plans`,{method:plan?'PATCH':'POST',body:JSON.stringify({name:planName,features:nf,price_per_month:plan?.price_per_month||0})});reload();}}><X size={12}/></button>
                            </div>
                          ))}
                        </div>
                        <div style={{display:'flex',gap:6,marginTop:6}}>
                          <input style={{...inp,flex:1}} placeholder="Add feature..." id={`feat-${planName}`}/>
                          <button style={btn()} onClick={async()=>{const el=document.getElementById(`feat-${planName}`);if(!el.value.trim())return;const nf=[...features,el.value.trim()];await adminFetch(plan?`/plans/${plan.id}`:`/plans`,{method:plan?'PATCH':'POST',body:JSON.stringify({name:planName,features:nf,price_per_month:plan?.price_per_month||0})});el.value='';reload();}}><Plus size={13}/></button>
                        </div>
                      </div>
                      <button style={{...btn(),width:'100%',justifyContent:'center'}}
                        onClick={async()=>{const price=document.getElementById(`price-${planName}`).value;await adminFetch(plan?`/plans/${plan.id}`:`/plans`,{method:plan?'PATCH':'POST',body:JSON.stringify({name:planName,price_per_month:parseFloat(price)||0,features})});reload();showToast('Saved!');}}>Save {planName.toUpperCase()}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Alert Definitions ── */}
        {tab==='alertdefs'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Alert Definitions</h1>
              <button style={btn()} onClick={()=>openModal('alertDef')}><Plus size={15}/>New Alert</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Name','Type','Severity','WhatsApp','Active','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {alertDefs.length===0&&<tr><td colSpan={6} style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>No alert definitions yet</td></tr>}
                  {alertDefs.map(a=>(
                    <tr key={a.id} style={{borderBottom:'1px solid #f0f0f0',opacity:a.is_active?1:0.6}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{a.name}</td>
                      <td style={{padding:'11px 14px'}}><span style={{fontFamily:'monospace',fontSize:11,background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>{a.alert_type}</span></td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                          background:a.severity==='critical'?'#fee2e2':a.severity==='warning'?'#fef9c3':'#dbeafe',
                          color:a.severity==='critical'?'#991b1b':a.severity==='warning'?'#854d0e':'#1d4ed8'}}>{a.severity}</span>
                      </td>
                      <td style={{padding:'11px 14px',textAlign:'center'}}>
                        <button onClick={()=>adminFetch(`/alert-definitions/${a.id}`,{method:'PATCH',body:JSON.stringify({whatsapp_enabled:!a.whatsapp_enabled})}).then(reload)}
                          style={{background:'none',border:'none',cursor:'pointer',color:a.whatsapp_enabled?'#16a34a':'#ccc'}}>
                          {a.whatsapp_enabled?<ToggleRight size={22}/>:<ToggleLeft size={22}/>}
                        </button>
                      </td>
                      <td style={{padding:'11px 14px',textAlign:'center'}}>
                        <button onClick={()=>adminFetch(`/alert-definitions/${a.id}`,{method:'PATCH',body:JSON.stringify({is_active:!a.is_active})}).then(reload)}
                          style={{background:'none',border:'none',cursor:'pointer',color:a.is_active?'#16a34a':'#ccc'}}>
                          {a.is_active?<ToggleRight size={22}/>:<ToggleLeft size={22}/>}
                        </button>
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',gap:5}}>
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('alertDef',{id:a.id,name:a.name,description:a.description,alert_type:a.alert_type,severity:a.severity,whatsapp_enabled:a.whatsapp_enabled,is_active:a.is_active})}><Edit2 size={12}/>Edit</button>
                          <button style={btn('#fee2e2','#991b1b')} onClick={()=>adminFetch(`/alert-definitions/${a.id}`,{method:'DELETE'}).then(()=>{reload();showToast('Deleted.');})}><Trash2 size={12}/>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Users & Roles ── */}
        {tab==='stationusers'&&(
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>Users & Roles</h1>
            <div style={{display:'flex',gap:12,alignItems:'flex-end',marginBottom:'1.5rem',flexWrap:'wrap'}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4,color:'#555'}}>Select Petrol Bunk</label>
                <select style={{...inp,width:260}} value={selStation} onChange={e=>{setSelStation(e.target.value);loadStationUsers(e.target.value);}}>
                  <option value="">Select a petrol bunk...</option>
                  {stations.map(s=><option key={s.id} value={s.id}>{s.name} — {s.city||''}</option>)}
                </select>
              </div>
              {selStation&&<button style={btn()} onClick={()=>openModal('stationUser',{station_id:selStation})}><UserPlus size={14}/>Add User</button>}
            </div>
            {!selStation
              ? <div style={{background:'#fff',borderRadius:12,border:'1px dashed #ddd',padding:'3rem',textAlign:'center',color:'#aaa'}}>Select a petrol bunk above</div>
              : <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr style={{background:'#f8f7f5'}}>
                      {['Name','Mobile','Role','Status','Actions'].map(h=>(
                        <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {stationUsers.length===0&&<tr><td colSpan={5} style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>No users yet</td></tr>}
                      {stationUsers.map(u=>(
                        <tr key={u.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                          <td style={{padding:'11px 14px',fontWeight:600}}>{u.name}</td>
                          <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:13}}>{(u.phone||'').replace('+91','')}</td>
                          <td style={{padding:'11px 14px'}}><span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:'#ede9fe',color:'#5b21b6',textTransform:'capitalize'}}>{u.role}</span></td>
                          <td style={{padding:'11px 14px'}}><span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:u.is_active?'#dcfce7':'#fee2e2',color:u.is_active?'#15803d':'#991b1b'}}>{u.is_active?'Active':'Inactive'}</span></td>
                          <td style={{padding:'11px 14px'}}>
                            <div style={{display:'flex',gap:5}}>
                              <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editStationUser',{id:u.id,name:u.name,email:u.email,role:u.role,phone:(u.phone||'').replace('+91','')})}><Edit2 size={12}/>Edit</button>
                              <button style={btn('#fff7ed','#9a3412')} onClick={()=>resetPassword(u.id)}><Key size={12}/>Reset PW</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </div>
        )}

        {/* ── Leads ── */}
        {tab==='leads'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Leads <span style={{fontSize:14,color:'#888',fontWeight:500}}>({sortedLeads.length})</span></h1>
              <div style={{display:'flex',gap:14,alignItems:'center'}}>
                <label style={{fontSize:12.5,color:'#666',display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}>
                  <input type="checkbox" checked={hideClosed} onChange={e=>setHideClosed(e.target.checked)}/> Hide closed
                </label>
                <button style={btn()} onClick={()=>openModal('lead',{source:'website',status:'new'})}><Plus size={15}/>Add Lead</button>
              </div>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:980}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {[['Date','created_at'],['Name','name'],['Phone',null],['Bunk','station_name'],['City','city'],['State','state'],['Source','source'],['Status','status'],['Notes',null],['',null]].map(([h,field],i)=>(
                    <th key={i} onClick={()=>field&&sortLeads(field)}
                      style={{padding:'9px 12px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de',cursor:field?'pointer':'default',userSelect:'none',whiteSpace:'nowrap'}}>
                      {h}{field&&leadSort.field===field?(leadSort.dir==='asc'?' ▲':' ▼'):''}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {sortedLeads.length===0&&<tr><td colSpan={10} style={{textAlign:'center',padding:'2.5rem',color:'#aaa'}}>No leads</td></tr>}
                  {sortedLeads.map(l=>{
                    const m = LEAD_STATUS.find(x=>x[0]===l.status) || ['','','#f3f4f6','#374151'];
                    const sb = m[2], st = m[3];
                    return (
                      <tr key={l.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                        <td style={{padding:'10px 12px',fontSize:12,color:'#666',whiteSpace:'nowrap'}}>{(l.created_at||'').slice(0,10)}</td>
                        <td style={{padding:'10px 12px',fontWeight:600}} title={l.message||''}>{l.name}{l.message?' 💬':''}</td>
                        <td style={{padding:'10px 12px',fontFamily:'monospace',fontSize:13,whiteSpace:'nowrap'}}>{l.phone}</td>
                        <td style={{padding:'10px 12px',fontSize:13}}>{l.station_name||'—'}</td>
                        <td style={{padding:'10px 12px',fontSize:13}}>{l.city||'—'}</td>
                        <td style={{padding:'10px 12px',fontSize:13}}>{l.state||'—'}</td>
                        <td style={{padding:'10px 12px'}}><span style={{fontSize:11,padding:'2px 7px',borderRadius:99,background:'#f1f5f9',color:'#475569',textTransform:'capitalize'}}>{l.source}</span></td>
                        <td style={{padding:'10px 12px'}}>
                          <select value={l.status} onChange={e=>patchLead(l.id,{status:e.target.value})}
                            style={{padding:'4px 8px',borderRadius:99,border:'none',fontSize:11,fontWeight:600,background:sb,color:st,cursor:'pointer'}}>
                            {LEAD_STATUS.map(([v,lab])=><option key={v} value={v}>{lab}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'10px 12px',minWidth:180}}>
                          <input defaultValue={l.notes||''} placeholder="Add note…"
                            onBlur={e=>{ if(e.target.value!==(l.notes||'')) patchLead(l.id,{notes:e.target.value}); }}
                            style={{width:'100%',padding:'5px 8px',border:'1px solid #e5e7eb',borderRadius:6,fontSize:12,outline:'none'}}/>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <button style={btn('#fee2e2','#991b1b')} title="Delete"
                            onClick={()=>{ if(confirm('Delete this lead?')) adminFetch(`/leads/${l.id}`,{method:'DELETE'}).then(()=>{loadLeads();showToast('Deleted.');}); }}><Trash2 size={12}/></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {modal?.type==='group'&&(
        <Modal title={form.id?'Edit Group':'New Owner Group'} onClose={closeModal}>
          <Field label="Group Name" required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Description"><input style={inp} value={form.description||''} onChange={e=>f('description',e.target.value)}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(form.id?`/groups/${form.id}`:'/groups',form.id?'PATCH':'POST')} disabled={loading}>{loading?'Saving...':form.id?'Save':'Create'}</button>
        </Modal>
      )}

      {modal?.type==='addMember'&&(
        <Modal title={`Add Owner to: ${modal.data.group_name}`} onClose={closeModal}>
          <Field label="Select Owner" required>
            <select style={inp} value={form.user_id||''} onChange={e=>f('user_id',e.target.value)}>
              <option value="">Select...</option>
              {owners.map(o=><option key={o.id} value={o.id}>{o.name} — {(o.phone||'').replace('+91','')}</option>)}
            </select>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(`/groups/${modal.data.group_id}/members`).then(()=>loadGroupMembers(modal.data.group_id))} disabled={loading}>{loading?'Adding...':'Add to Group'}</button>
        </Modal>
      )}

      {modal?.type==='owner'&&(
        <Modal title="New Owner" onClose={closeModal}>
          <Field label="Full Name" required><input style={inp} placeholder="Rajesh Kumar" value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Mobile (10 digits)" required>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label="Email"><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label="Password"><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save('/owners')} disabled={loading}>{loading?'Creating...':'Create Owner'}</button>
        </Modal>
      )}

      {modal?.type==='editOwner'&&(
        <Modal title="Edit Owner" onClose={closeModal}>
          <Field label="Full Name"><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Mobile (10 digits)">
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label="Email"><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label="New Password (blank = keep)"><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(`/owners/${form.id}`,'PATCH')} disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

      {(modal?.type==='station'||modal?.type==='editStation')&&(
        <Modal title={modal.type==='editStation'?'Edit Petrol Bunk':'New Petrol Bunk'} onClose={closeModal}>
          <Field label="Station Name" required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="State" required>
              <select style={inp} value={form.state||''} onChange={e=>f('state',e.target.value)}>
                <option value="">Select...</option>
                {INDIAN_STATES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City" required>
              <select style={inp} value={form.city||''} onChange={e=>f('city',e.target.value)} disabled={!form.state}>
                <option value="">Select...</option>
                {formCities.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Address"><input style={inp} value={form.address||''} onChange={e=>f('address',e.target.value)}/></Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Oil Company">
              <select style={inp} value={form.oil_company||''} onChange={e=>f('oil_company',e.target.value)}>
                <option value="">Select...</option>
                {['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="GSTN"><input style={inp} value={form.gst_number||''} onChange={e=>f('gst_number',e.target.value.toUpperCase())}/></Field>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Assign Owner">
              <select style={inp} value={form.owner_id||''} onChange={e=>f('owner_id',e.target.value)}>
                <option value="">Select owner...</option>
                {owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Owner Group">
              <select style={inp} value={form.owner_group_id||''} onChange={e=>f('owner_group_id',e.target.value)}>
                <option value="">No group (independent)</option>
                {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          </div>
          {modal.type==='station'&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Field label="Plan">
                <select style={inp} value={form.plan||'pro'} onChange={e=>f('plan',e.target.value)}>
                  <option value="pro">PRO</option><option value="enterprise">ENTERPRISE</option>
                </select>
              </Field>
              <Field label="Start Date"><input style={inp} type="date" value={form.start_date||todayIST()} onChange={e=>f('start_date',e.target.value)}/></Field>
            </div>
          )}
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,marginTop:4}} onClick={()=>save(modal.type==='editStation'?`/stations/${form.id}`:'/stations',modal.type==='editStation'?'PATCH':'POST')} disabled={loading}>{loading?'Saving...':modal.type==='editStation'?'Save Changes':'Create Bunk'}</button>
        </Modal>
      )}

      {modal?.type==='addBunk'&&(
        <Modal title={`Add Bunk — ${modal.data.group_name}`} onClose={closeModal}>
          <Field label="Petrol Bunk">
            <select style={inp} value={form.station_id||''} onChange={e=>f('station_id',e.target.value)}>
              <option value="">Select a bunk…</option>
              {stations.map(s=><option key={s.id} value={s.id}>{s.name}{s.owner_group_id&&s.owner_group_id!==modal.data.group_id?' · in another group':''}</option>)}
            </select>
          </Field>
          <div style={{fontSize:12,color:'#888',marginBottom:10}}>A bunk belongs to one group — adding it here moves it from any other group.</div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} disabled={loading||!form.station_id}
            onClick={async()=>{ setLoading(true); const r=await adminFetch(`/groups/${modal.data.group_id}/stations`,{method:'POST',body:JSON.stringify({station_id:form.station_id})}); setLoading(false); if(r.error){alert(r.error);return;} loadGroupStations(modal.data.group_id); closeModal(); reload(); showToast('Bunk added.'); }}>
            {loading?'Adding…':'Add Bunk to Group'}
          </button>
        </Modal>
      )}

      {modal?.type==='editSub'&&(
        <Modal title={`Subscription — ${modal.data.name}`} onClose={closeModal}>
          <Field label="Plan">
            <select style={inp} value={form.plan||'pro'} onChange={e=>f('plan',e.target.value)}>
              <option value="pro">PRO</option><option value="enterprise">ENTERPRISE</option>
            </select>
          </Field>
          <Field label="Status">
            <div style={{display:'flex',gap:8}}>
              {['active','suspended','cancelled'].map(s=>(
                <button key={s} type="button" onClick={()=>f('status',s)}
                  style={{...btn(form.status===s?(s==='active'?'#16a34a':s==='suspended'?'#ca8a04':'#dc2626'):'#f3f4f6',form.status===s?'#fff':'#374151'),flex:1,justifyContent:'center',textTransform:'capitalize'}}>{s}</button>
              ))}
            </div>
          </Field>
          <Field label="End Date (optional)">
            <input style={inp} type="date" value={form.end_date||''} onChange={e=>f('end_date',e.target.value||null)}/>
            {form.end_date&&<div style={{fontSize:11,color:'#9333ea',marginTop:4}}>⚡ New subscription auto-starts next day</div>}
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} disabled={loading}
            onClick={async()=>{
              setLoading(true);
              const subs=await adminFetch(`/station-subscriptions/${form.station_id}`);
              const active=Array.isArray(subs)?subs.find(s=>!s.end_date):null;
              const res=active
                ?await adminFetch(`/station-subscriptions/${active.id}`,{method:'PATCH',body:JSON.stringify({plan:form.plan,status:form.status,end_date:form.end_date||null})})
                :await adminFetch('/station-subscriptions',{method:'POST',body:JSON.stringify({station_id:form.station_id,plan:form.plan,status:form.status,start_date:form.start_date||todayIST(),end_date:form.end_date||null})});
              setLoading(false);
              if(res.error){alert(res.error);return;}
              closeModal();reload();showToast('Subscription updated!');
            }}>{loading?'Saving...':'Save Subscription'}</button>
        </Modal>
      )}

      {modal?.type==='alertDef'&&(
        <Modal title={form.id?'Edit Alert':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Description"><textarea style={{...inp,height:72,resize:'vertical'}} value={form.description||''} onChange={e=>f('description',e.target.value)}/></Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay','nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option><option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc'}}>{form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}</div>
            <div><div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div><div style={{fontSize:12,color:'#555'}}>Alert sent to station owner's WhatsApp</div></div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(form.id?`/alert-definitions/${form.id}`:'/alert-definitions',form.id?'PATCH':'POST')} disabled={loading}>{loading?'Saving...':form.id?'Save':'Create Alert'}</button>
        </Modal>
      )}

      {modal?.type==='stationUser'&&(
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Mobile (10 digits)" required>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label="Email"><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option><option value="manager">Manager</option><option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password"><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))} disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {modal?.type==='lead'&&(
        <Modal title="Add Lead" onClose={closeModal}>
          <Field label="Name" required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Mobile" required><input style={inp} value={form.phone||''} onChange={e=>f('phone',e.target.value)} placeholder="+91…"/></Field>
          <Field label="Petrol Bunk"><input style={inp} value={form.station_name||''} onChange={e=>f('station_name',e.target.value)}/></Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="State">
              <select style={inp} value={form.state||''} onChange={e=>{ f('state',e.target.value); f('city',''); }}>
                <option value="">Select…</option>
                {INDIAN_STATES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City">
              <select style={inp} value={form.city||''} onChange={e=>f('city',e.target.value)} disabled={!form.state}>
                <option value="">{form.state?'Select…':'Pick state first'}</option>
                {getCities(form.state).map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Source">
              <select style={inp} value={form.source||'whatsapp'} onChange={e=>f('source',e.target.value)}>
                {LEAD_SOURCE.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={inp} value={form.status||'new'} onChange={e=>f('status',e.target.value)}>
                {LEAD_STATUS.map(([v,lab])=><option key={v} value={v}>{lab}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes"><textarea style={{...inp,height:72,resize:'vertical'}} value={form.notes||''} onChange={e=>f('notes',e.target.value)}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save('/leads')} disabled={loading}>{loading?'Saving...':'Add Lead'}</button>
        </Modal>
      )}

      {modal?.type==='editStationUser'&&(
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name"><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label="Mobile (10 digits)">
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label="Email"><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option><option value="manager">Manager</option><option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (blank = keep)"><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank"/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))} disabled={loading}>{loading?'Saving...':'Save'}</button>
        </Modal>
      )}

    </div>
  );
}
