'use client';
import { useState, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
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
  }).then(r=>r.json()).catch(()=>null);   // non-JSON/5xx (e.g. mid-deploy) → null, never throw
};

const PLAN_COLORS   = { starter:['#dcfce7','#15803d'], pro:['#fff7ed','#9a3412'], enterprise:['#ede9fe','#5b21b6'] };
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

function Modal({title,onClose,children,width=520}){
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:300,overflowY:'auto',padding:'1rem'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'1.75rem',width:'100%',
        maxWidth:width,boxShadow:'0 20px 60px rgba(0,0,0,.3)',maxHeight:'90vh',overflowY:'auto'}}>
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
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

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
            <Shield size={14}/> {tc('adminp.superadminConsole', 'SuperAdmin Console')}
          </div>
        </div>
        <form onSubmit={submit}>
          <div style={{marginBottom:'1rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>{tc('adminp.email', 'Email')}</label>
            <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box'}}
              type="email" placeholder="admin@pumpini.in" value={form.email}
              onChange={e=>setForm(p=>({...p,email:e.target.value}))} required/>
          </div>
          <div style={{marginBottom:'1.5rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>{tc('adminp.password', 'Password')}</label>
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
            type="submit" disabled={loading}>{loading?tc('adminp.loggingIn', 'Logging in...'):tc('adminp.login', 'Login')}</button>
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
  const [daySale,setDaySale]     = useState(null); // Day Sale tile — isolated from stats
  const [dayDate,setDayDate]     = useState('');   // Day Sale tile date picker
  const [groups,setGroups]       = useState([]);
  const [owners,setOwners]       = useState([]);
  const [stations,setStations]   = useState([]);
  const [plans,setPlans]         = useState([]);
  const [modules,setModules]     = useState([]);   // function catalog
  const [planFeat,setPlanFeat]   = useState({});   // planName -> [module codes]
  const [alertDefs,setAlertDefs] = useState([]);
  const [stationSubs,setStationSubs]   = useState({});
  const [groupMembers,setGroupMembers] = useState({});
  const [groupStations,setGroupStations] = useState({});
  const [selStation,setSelStation]     = useState('');
  const [stationUsers,setStationUsers] = useState([]);
  const [stTemplates,setStTemplates]   = useState([]);   // responsibilities for selected bunk
  const [leads,setLeads]               = useState([]);
  const [leadSort,setLeadSort]         = useState({ field:'created_at', dir:'desc' });
  const [hideClosed,setHideClosed]     = useState(false);
  const [modal,setModal]   = useState(null);
  const [form,setForm]     = useState({});
  const [loading,setLoading] = useState(false);
  const [toast,setToast]   = useState('');
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const openModal  = (type,data={}) => { setForm({...data}); setModal({type,data}); };
  const closeModal = () => { setModal(null); setForm({}); };

  // ── Go-live seeding grids (superadmin, per outlet) ──────────────────────
  const [ccList,setCcList]   = useState([]);   // existing credit customers
  const [ccRows,setCcRows]   = useState([]);   // new rows being entered
  const [attList,setAttList] = useState([]);
  const [attRows,setAttRows] = useState([]);
  const [gridBusy,setGridBusy] = useState(false);
  const loadCC  = async sid => { const r = await adminFetch(`/credit-customers/${sid}`); setCcList(Array.isArray(r)?r:[]); };
  const loadAtt = async sid => { const r = await adminFetch(`/attendants/${sid}`);        setAttList(Array.isArray(r)?r:[]); };
  const openCreditCustomers = s => { setModal({type:'creditCustomers',data:{station_id:s.id,name:s.name}}); setCcRows([{company_name:'',contact_phone:'',opening_balance:''}]); loadCC(s.id); };
  const openAttendants      = s => { setModal({type:'attendants',     data:{station_id:s.id,name:s.name}}); setAttRows([{name:'',phone:''}]); loadAtt(s.id); };
  const setCcRow  = (i,k,v) => setCcRows(rs=>rs.map((r,idx)=>idx===i?{...r,[k]:v}:r));
  const setAttRow = (i,k,v) => setAttRows(rs=>rs.map((r,idx)=>idx===i?{...r,[k]:v}:r));
  const saveCreditCustomers = async () => {
    const rows = ccRows.filter(r=>(r.company_name||'').trim());
    if(!rows.length) return;
    setGridBusy(true);
    const r = await adminFetch('/credit-customers',{method:'POST',body:JSON.stringify({station_id:modal.data.station_id,rows})});
    setGridBusy(false);
    if(r.error){alert(r.error);return;}
    setCcRows([{company_name:'',contact_phone:'',opening_balance:''}]); loadCC(modal.data.station_id);
    showToast(tc('adminp.ccSaved','Credit customers saved.'));
  };
  const delCreditCustomer = async id => {
    if(!window.confirm(tc('adminp.ccDeleteConfirm','Remove this customer and its opening balance from this outlet?'))) return;
    await adminFetch(`/credit-customers/${id}?station_id=${modal.data.station_id}`,{method:'DELETE'});
    loadCC(modal.data.station_id);
  };
  const saveAttendants = async () => {
    const rows = attRows.filter(r=>(r.name||'').trim() && (r.phone||'').trim());
    if(!rows.length) return;
    setGridBusy(true);
    const r = await adminFetch('/attendants',{method:'POST',body:JSON.stringify({station_id:modal.data.station_id,rows})});
    setGridBusy(false);
    if(r.error){alert(r.error);return;}
    setAttRows([{name:'',phone:''}]); loadAtt(modal.data.station_id);
    showToast(tc('adminp.attSaved','Attendants saved.'));
  };
  const toggleAttEnd = async a => {
    const leaving = a.is_active!==false;
    await adminFetch(`/attendants/${a.id}`,{method:'PATCH',body:JSON.stringify({end_date: leaving? todayIST():null})});
    loadAtt(modal.data.station_id);
  };
  const todayIST   = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const fmtDate    = s => s ? new Date(s).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}) : '—';

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
    const [s,g,o,st,pl,ad,md,ds] = await Promise.all([
      adminFetch('/platform-stats'),
      adminFetch('/groups'),
      adminFetch('/owners'),
      adminFetch('/stations'),
      adminFetch('/plans'),
      adminFetch('/alert-definitions'),
      adminFetch('/modules'),
      adminFetch('/day-sales'),
    ]);
    if (s && typeof s.total_stations !== 'undefined') setStats(s);  // ignore an error/partial response
    if (ds && typeof ds.day_sales !== 'undefined') setDaySale(ds);
    setGroups(Array.isArray(g)?g:[]); setOwners(Array.isArray(o)?o:[]);
    setStations(Array.isArray(st)?st:[]); setPlans(Array.isArray(pl)?pl:[]);
    setAlertDefs(Array.isArray(ad)?ad:[]);
    const mods = Array.isArray(md)?md:[]; setModules(mods);
    // Seed plan→features selection with only RECOGNISED module codes (ignore old free text)
    const codes = new Set(mods.map(m=>m.code));
    const pf = {};
    (Array.isArray(pl)?pl:[]).forEach(p=>{
      let f = p.features; if(typeof f==='string'){ try{ f=JSON.parse(f); }catch{ f=[]; } }
      pf[p.name] = (Array.isArray(f)?f:[]).filter(x=>codes.has(x));
    });
    setPlanFeat(pf);
    loadLeads();
  };

  useEffect(()=>{ if(admin) reload(); },[admin]);

  // Seed the Day Sale picker with the effective day the backend chose (latest day
  // with sales), then let the admin pick any day — refetch just the stats.
  useEffect(()=>{ if(daySale?.day_date) setDayDate(prev=>prev||daySale.day_date); },[daySale?.day_date]);
  const onDayDate = async(d)=>{
    setDayDate(d);
    if(!d) return;
    const ds = await adminFetch(`/day-sales?date=${d}`);   // isolated — only touches the Day Sale tile
    if(ds && typeof ds.day_sales !== 'undefined') setDaySale(ds);
  };

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
  const loadStTemplates   = async sid => { if(!sid){setStTemplates([]);return;} const r=await adminFetch(`/templates?station_id=${sid}`); setStTemplates(Array.isArray(r)?r:[]); };
  const assignResp        = async (user_id, template_id) => { await adminFetch('/templates/assign',{method:'POST',body:JSON.stringify({user_id,template_id:template_id||null,station_id:selStation})}); loadStationUsers(selStation); showToast(tc('adminp.responsibilityUpdated', 'Responsibility updated.')); };

  const save = async(url,method='POST')=>{
    setLoading(true);
    const res=await adminFetch(url,{method,body:JSON.stringify(form)});
    setLoading(false);
    if(res.error){alert(res.error);return false;}
    closeModal(); reload(); showToast(tc('adminp.saved', 'Saved!'));
    return true;
  };

  const resetPassword = async userId=>{
    const pw=prompt(tc('adminp.newPasswordPrompt', 'New password (min 8 chars):'));
    if(!pw||pw.length<8){alert(tc('adminp.tooShort', 'Too short'));return;}
    await adminFetch(`/owners/${userId}`,{method:'PATCH',body:JSON.stringify({password:pw})});
    showToast(tc('adminp.passwordReset', 'Password reset!'));
  };

  if(!admin) return <LoginScreen onLogin={a=>setAdmin(a)}/>;

  const TABS=[
    {id:'dashboard',label:tc('adminp.tabPlatformDashboard','Platform Dashboard'),icon:<TrendingUp size={14}/>},
    {id:'groups',   label:tc('adminp.tabOwnerGroups','Owner Groups'),      icon:<Globe size={14}/>},
    {id:'owners',   label:tc('adminp.tabOwners','Owners'),            icon:<Users size={14}/>},
    {id:'stations', label:tc('adminp.tabPetrolBunks','Petrol Bunks'),      icon:<Building2 size={14}/>},
    {id:'plans',    label:tc('adminp.tabPlans','Plans'),             icon:<Layers size={14}/>},
    {id:'alertdefs',label:tc('adminp.tabAiChat','AI Chat'),           icon:<Shield size={14}/>},
    {id:'stationusers',label:tc('adminp.tabUsersRoles','Users & Roles'),  icon:<UserPlus size={14}/>},
    {id:'leads',    label:tc('adminp.tabLeads','Leads'),             icon:<Inbox size={14}/>},
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
          <div style={{fontSize:11,color:'rgba(255,255,255,.35)',marginTop:2}}>{tc('adminp.adminConsole', 'ADMIN CONSOLE')}</div>
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
            <LogOut size={13}/>{tc('adminp.logout', 'Logout')}
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,padding:'2rem',overflow:'auto',minWidth:0}}>

        {/* ── Platform Dashboard ── */}
        {tab==='dashboard'&&(
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>{tc('adminp.platformDashboard', 'Platform Dashboard')}</h1>
            <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem',marginBottom:'2rem'}}>
              {[
                [tc('adminp.statOwnerGroups','Owner Groups'),  stats?.total_groups||0,   '#FF6B00'],
                [tc('adminp.statOwners','Owners'),        stats?.total_owners||0,   '#9333ea'],
                [tc('adminp.statPetrolBunks','Petrol Bunks'),  stats?.total_stations||0, '#1A5F7A'],
                [tc('adminp.statActiveUsers','Active Users'),  stats?.total_users||0,    '#16a34a'],
                [tc('adminp.statDaySale','Day Sale'), fmtAmt(daySale?.day_sales ?? 0),'#dc2626',
                  <input key="dp" type="date" value={dayDate} max={todayIST()} onChange={e=>onDayDate(e.target.value)}
                    style={{marginTop:10,fontSize:12,padding:'5px 8px',border:'1px solid #e5e3de',borderRadius:6,color:'#333',fontFamily:'inherit',width:'100%',boxSizing:'border-box',cursor:'pointer'}}/>],
                [tc('adminp.statMtdSales','MTD Sales'),     fmtAmt(stats?.mtd_sales||0),  '#0891b2'],
              ].map(([l,v,c,extra])=>(
                <div key={l} style={{background:'#fff',borderRadius:12,padding:'1.25rem',border:'1px solid #e5e3de',borderTop:`3px solid ${c}`}}>
                  <div style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{l}</div>
                  <div style={{fontSize:'1.75rem',fontWeight:800,color:c}}>{v}</div>
                  {extra||null}
                </div>
              ))}
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>{tc('adminp.recentPetrolBunks', 'Recent Petrol Bunks')}</span>
                <button style={btn()} onClick={()=>openModal('station')}><Plus size={14}/>{tc('adminp.newBunk', 'New Bunk')}</button>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {[tc('adminp.colStation','Station'),tc('adminp.colCity','City'),tc('adminp.colPlan','Plan'),tc('adminp.colStatus','Status')].map(h=>(
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
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>{tc('adminp.ownerGroups', 'Owner Groups')}</h1>
              <button style={btn()} onClick={()=>openModal('group')}><Plus size={15}/>{tc('adminp.newGroup', 'New Group')}</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))',gap:'1rem'}}>
              {groups.map(g=>(
                <div key={g.id} style={{background:'#fff',borderRadius:12,padding:'1.5rem',border:'1px solid #e5e3de',borderTop:`3px solid ${g.is_active?'#FF6B00':'#ccc'}`}}>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{g.name}</div>
                  <div style={{fontSize:12,color:'#888',marginBottom:'0.75rem'}}>{g.description||tc('adminp.noDescription','No description')}</div>
                  <div style={{fontSize:12,color:'#555',marginBottom:'0.5rem',fontWeight:600}}>
                    👥 {tc('adminp.ownersBunksCount','{owners} owners · ⛽ {bunks} bunks').replace('{owners}',g.owner_count||0).replace('{bunks}',g.station_count||0)}
                  </div>

                  {/* Owners sub-grid */}
                  <div style={{background:'#f8f7f5',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.5rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase'}}>{tc('adminp.owners', 'Owners')}</span>
                      <button style={{...btn('#f0fff4','#15803d'),height:24,padding:'0 8px',fontSize:11}}
                        onClick={()=>openModal('addMember',{group_id:g.id,group_name:g.name})}><Plus size={11}/>{tc('adminp.add', 'Add')}</button>
                    </div>
                    {groupMembers[g.id]
                      ? groupMembers[g.id].filter(m=>m.role!=='cco').length===0
                        ? <div style={{color:'#aaa',fontSize:11}}>{tc('adminp.noOwnersYet', 'No owners yet')}</div>
                        : groupMembers[g.id].filter(m=>m.role!=='cco').map(m=>(
                          <div key={m.user_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #ece9e4'}}>
                            <span style={{fontWeight:600}}>{m.owner_name}</span>
                            <button style={{fontSize:10,padding:'1px 6px',background:'#fee2e2',border:'none',borderRadius:4,cursor:'pointer',color:'#991b1b'}}
                              onClick={()=>adminFetch(`/groups/${g.id}/members/${m.user_id}`,{method:'DELETE'}).then(()=>{loadGroupMembers(g.id);reload();})}>{tc('adminp.remove', 'Remove')}</button>
                          </div>
                        ))
                      : <button style={{fontSize:11,color:'#1A5F7A',background:'none',border:'none',cursor:'pointer'}} onClick={()=>loadGroupMembers(g.id)}>{tc('adminp.clickToView', 'Click to view')}</button>
                    }
                  </div>

                  {/* CCO (Central Cash Office) sub-grid — back-office users with
                      operational access to every outlet in this group. */}
                  <div style={{background:'#f5f3ff',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.5rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase'}}>{tc('adminp.cco', 'Central Cash Office')}</span>
                      <button style={{...btn('#f5f3ff','#5b21b6'),height:24,padding:'0 8px',fontSize:11}}
                        onClick={()=>{ if(!groupMembers[g.id]) loadGroupMembers(g.id); openModal('cco',{group_id:g.id,group_name:g.name}); }}><Plus size={11}/>{tc('adminp.add', 'Add')}</button>
                    </div>
                    {groupMembers[g.id]
                      ? groupMembers[g.id].filter(m=>m.role==='cco').length===0
                        ? <div style={{color:'#aaa',fontSize:11}}>{tc('adminp.noCcoYet', 'No CCO users yet')}</div>
                        : groupMembers[g.id].filter(m=>m.role==='cco').map(m=>(
                          <div key={m.user_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #e9e4f7'}}>
                            <span style={{fontWeight:600}}>{m.owner_name}<span style={{color:'#999',fontWeight:400}}> · {(m.phone||'').replace('+91','')}</span></span>
                            <button style={{fontSize:10,padding:'1px 6px',background:'#fee2e2',border:'none',borderRadius:4,cursor:'pointer',color:'#991b1b'}}
                              onClick={()=>adminFetch(`/groups/${g.id}/members/${m.user_id}`,{method:'DELETE'}).then(()=>{loadGroupMembers(g.id);reload();})}>{tc('adminp.remove', 'Remove')}</button>
                          </div>
                        ))
                      : <button style={{fontSize:11,color:'#5b21b6',background:'none',border:'none',cursor:'pointer'}} onClick={()=>loadGroupMembers(g.id)}>{tc('adminp.clickToView', 'Click to view')}</button>
                    }
                  </div>

                  {/* Bunks sub-grid */}
                  <div style={{background:'#f0f9ff',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase'}}>{tc('adminp.petrolBunks', 'Petrol Bunks')}</span>
                      <button style={{...btn('#f0fff4','#15803d'),height:24,padding:'0 8px',fontSize:11}}
                        onClick={()=>{ loadGroupStations(g.id); openModal('addBunk',{group_id:g.id,group_name:g.name}); }}><Plus size={11}/>{tc('adminp.add', 'Add')}</button>
                    </div>
                    {groupStations[g.id]
                      ? groupStations[g.id].length===0
                        ? <div style={{color:'#aaa',fontSize:11}}>{tc('adminp.noBunks', 'No bunks')}</div>
                        : groupStations[g.id].map(s=>(
                          <div key={s.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #e0eefb'}}>
                            <span style={{fontWeight:600}}>{s.name}</span>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <SubBadge plan={s.plan} status={s.sub_status}/>
                              <button style={{fontSize:10,padding:'1px 6px',background:'#fee2e2',border:'none',borderRadius:4,cursor:'pointer',color:'#991b1b'}}
                                onClick={()=>adminFetch(`/groups/${g.id}/stations/${s.id}`,{method:'DELETE'}).then(()=>{loadGroupStations(g.id);reload();showToast(tc('adminp.bunkRemoved','Bunk removed.'));})}>{tc('adminp.remove', 'Remove')}</button>
                            </div>
                          </div>
                        ))
                      : <button style={{fontSize:11,color:'#1A5F7A',background:'none',border:'none',cursor:'pointer'}} onClick={()=>loadGroupStations(g.id)}>{tc('adminp.clickToView', 'Click to view')}</button>
                    }
                  </div>

                  <div style={{display:'flex',gap:6}}>
                    <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('group',{id:g.id,name:g.name,description:g.description})}><Edit2 size={12}/>{tc('adminp.edit', 'Edit')}</button>
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
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>{tc('adminp.ownersHeading', 'Owners')}</h1>
              <button style={btn()} onClick={()=>openModal('owner')}><Plus size={15}/>{tc('adminp.newOwner', 'New Owner')}</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {[tc('adminp.colName','Name'),tc('adminp.colMobile','Mobile'),tc('adminp.colEmail','Email'),tc('adminp.colBunks','Bunks'),tc('adminp.colActions','Actions')].map(h=>(
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
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editOwner',{id:o.id,name:o.name,email:o.email,phone:(o.phone||'').replace('+91','')})}><Edit2 size={12}/>{tc('adminp.edit', 'Edit')}</button>
                          <button style={btn('#fff7ed','#9a3412')} onClick={()=>resetPassword(o.id)}><Key size={12}/>{tc('adminp.resetPw', 'Reset PW')}</button>
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
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>{tc('adminp.petrolBunksHeading', 'Petrol Bunks')}</h1>
              <button style={btn()} onClick={()=>openModal('station')}><Plus size={15}/>{tc('adminp.newPetrolBunk', 'New Petrol Bunk')}</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {[tc('adminp.colStation','Station'),tc('adminp.colCity','City'),tc('adminp.colOilCo','Oil Co.'),tc('adminp.colPlanStatus','Plan / Status'),tc('adminp.colStart','Start'),tc('adminp.colEnd','End'),tc('adminp.colActions','Actions')].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stations.map(s=>(
                    <tr key={s.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:800,fontSize:15,color:'#1a1a1a'}}>{s.name || <span style={{color:'#dc2626',fontWeight:600,fontSize:13}}>{tc('adminp.unnamedBunk','⚠ Unnamed — edit to set name')}</span>}</td>
                      <td style={{padding:'11px 14px'}}>{s.city||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12}}>{s.oil_company||'—'}</td>
                      <td style={{padding:'11px 14px'}}><SubBadge plan={s.plan} status={s.sub_status}/></td>
                      <td style={{padding:'11px 14px',fontSize:12}}>{fmtDate(s.start_date)}</td>
                      <td style={{padding:'11px 14px',fontSize:12}}>{s.end_date ? fmtDate(s.end_date) : <span style={{color:'#16a34a',fontWeight:600,fontSize:11}}>{tc('adminp.active', 'Active')}</span>}</td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editStation',{id:s.id,name:s.name,address:s.address,city:s.city,state:s.state,gst_number:s.gst_number,oil_company:s.oil_company,owner_id:(s.owner_ids&&s.owner_ids[0])||'',owner_group_id:s.owner_group_id||''})}><Edit2 size={12}/>{tc('adminp.edit', 'Edit')}</button>
                          <button style={btn('#fff7ed','#9a3412')} onClick={()=>{setForm({station_id:s.id,plan:s.plan||'pro',status:s.sub_status||'active',start_date:s.start_date||todayIST(),end_date:s.end_date||''});setModal({type:'editSub',data:s});}}><Calendar size={12}/>{tc('adminp.plan', 'Plan')}</button>
                          <button style={btn('#f0fdf4','#15803d')} onClick={()=>openCreditCustomers(s)}><IndianRupee size={12}/>{tc('adminp.creditCustomers', 'Credit Customers')}</button>
                          <button style={btn('#eff6ff','#1d4ed8')} onClick={()=>openAttendants(s)}><Users size={12}/>{tc('adminp.attendants', 'Attendants')}</button>
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
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>{tc('adminp.plansHeading', 'Plans')}</h1>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem'}}>
              {['starter','pro','enterprise'].map(planName=>{
                const plan=plans.find(p=>p.name===planName);
                const features=plan?.features?(typeof plan.features==='string'?JSON.parse(plan.features):plan.features):[];
                const [pb,pt]=PLAN_COLORS[planName]||['#f3f4f6','#374151'];
                return (
                  <div key={planName} style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
                    <div style={{background:pb,padding:'1rem 1.25rem',borderBottom:`2px solid ${pt}`}}>
                      <div style={{fontSize:18,fontWeight:800,color:pt}}>{planName.toUpperCase()}</div>
                      <div style={{fontSize:13,color:pt,opacity:.8,marginTop:2}}>{plan?tc('adminp.perMonthPrice','₹{price}/month').replace('{price}',Number(plan.price_per_month||0).toLocaleString('en-IN')):tc('adminp.notConfigured','Not configured')}</div>
                    </div>
                    <div style={{padding:'1rem 1.25rem'}}>
                      <div style={{marginBottom:'0.75rem'}}>
                        <label style={{fontSize:12,fontWeight:600,color:'#555',display:'block',marginBottom:4}}>{tc('adminp.pricePerMonthLabel', 'Price/month (₹)')}</label>
                        <input style={{...inp}} type="number" placeholder={tc('adminp.pricePlaceholder','e.g. 999')} defaultValue={plan?.price_per_month||''} id={`price-${planName}`}/>
                      </div>
                      <div style={{marginBottom:'0.75rem'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                          <div style={{fontSize:12,fontWeight:600,color:'#555'}}>{tc('adminp.functionsIncluded','Functions included ({sel}/{total})').replace('{sel}',(planFeat[planName]||[]).length).replace('{total}',modules.length)}</div>
                          <div style={{display:'flex',gap:8}}>
                            <button style={{fontSize:11,background:'none',border:'none',color:'#1A5F7A',cursor:'pointer'}} onClick={()=>setPlanFeat(p=>({...p,[planName]:modules.map(m=>m.code)}))}>{tc('adminp.all', 'All')}</button>
                            <button style={{fontSize:11,background:'none',border:'none',color:'#991b1b',cursor:'pointer'}} onClick={()=>setPlanFeat(p=>({...p,[planName]:[]}))}>{tc('adminp.none', 'None')}</button>
                          </div>
                        </div>
                        <div style={{maxHeight:260,overflowY:'auto',border:'1px solid #eee',borderRadius:8,padding:'6px 8px'}}>
                          {[...new Set(modules.map(m=>m.category))].map(cat=>(
                            <div key={cat} style={{marginBottom:6}}>
                              <div style={{fontSize:10,fontWeight:700,color:'#999',textTransform:'uppercase',margin:'4px 0 2px'}}>{cat}</div>
                              {modules.filter(m=>m.category===cat).map(m=>{
                                const on=(planFeat[planName]||[]).includes(m.code);
                                return (
                                  <label key={m.code} style={{display:'flex',alignItems:'center',gap:6,fontSize:12.5,padding:'2px 0',cursor:'pointer'}}>
                                    <input type="checkbox" checked={on} onChange={()=>setPlanFeat(p=>{const cur=p[planName]||[];return {...p,[planName]: on?cur.filter(c=>c!==m.code):[...cur,m.code]};})}/>
                                    {m.label||m.code}
                                  </label>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                        <div style={{fontSize:11,color:'#888',marginTop:4}}>{tc('adminp.gatingHelp', 'Outlets on this plan can only use the ticked functions. Leave all unticked = no gating (fail-open).')}</div>
                      </div>
                      <button style={{...btn(),width:'100%',justifyContent:'center'}}
                        onClick={async()=>{const price=document.getElementById(`price-${planName}`).value;await adminFetch('/plans',{method:'POST',body:JSON.stringify({name:planName,price_per_month:parseFloat(price)||0,features:planFeat[planName]||[]})});reload();showToast(tc('adminp.saved','Saved!'));}}>{tc('adminp.savePlan','Save {plan}').replace('{plan}',planName.toUpperCase())}</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Tier comparison matrix (demo / explainer) ── */}
            <div style={{marginTop:'2rem',background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid #eee'}}>
                <div style={{fontSize:16,fontWeight:800}}>{tc('adminp.tierComparison', 'Tier comparison')}</div>
                <div style={{fontSize:12,color:'#888',marginTop:2}}>{tc('adminp.tierComparisonHelp', 'What each tier includes vs. withholds (reflects the selections above). Great for walking a customer through the upgrade story.')}</div>
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'#faf9f7'}}>
                      <th style={{textAlign:'left',padding:'8px 12px',fontWeight:700,color:'#555',position:'sticky',left:0,background:'#faf9f7'}}>{tc('adminp.functionColumn', 'Function')}</th>
                      {['starter','pro','enterprise'].map(pn=>{const[pb,pt]=PLAN_COLORS[pn];return(
                        <th key={pn} style={{padding:'8px 12px',textAlign:'center',color:pt,fontWeight:800,minWidth:110}}>
                          {pn.toUpperCase()}
                          <div style={{fontSize:11,fontWeight:600,opacity:.8}}>{tc('adminp.nFunctions','{n} functions').replace('{n}',(planFeat[pn]||[]).length)}</div>
                        </th>
                      );})}
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(modules.map(m=>m.category))].map(cat=>(
                      <Fragment key={cat}>
                        <tr><td colSpan={4} style={{padding:'8px 12px 2px',fontSize:10.5,fontWeight:800,color:'#999',textTransform:'uppercase',letterSpacing:.4}}>{cat}</td></tr>
                        {modules.filter(m=>m.category===cat).map(m=>(
                          <tr key={m.code} style={{borderTop:'1px solid #f1efea'}}>
                            <td style={{padding:'6px 12px',position:'sticky',left:0,background:'#fff'}}>{m.label||m.code}</td>
                            {['starter','pro','enterprise'].map(pn=>{
                              const on=(planFeat[pn]||[]).includes(m.code);const[,pt]=PLAN_COLORS[pn];
                              return <td key={pn} style={{padding:'6px 12px',textAlign:'center',color:on?pt:'#d1cfca',fontWeight:on?800:400,fontSize:on?14:13}}>{on?'✓':'—'}</td>;
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Alert Definitions ── */}
        {tab==='alertdefs'&&(
          <div>
            <div style={{marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>{tc('adminp.aiChatHeading', 'AI Chat')}</h1>
              <p style={{fontSize:13,color:'#888',marginTop:4,maxWidth:560}}>
                {tc('adminp.aiChatIntro', 'The in-app AI assistant is a plan feature. Enable it for the plans that should include it — outlets on those plans get AI Chat. (WhatsApp chat has been discontinued; operational alerts are now in-app.)')}
              </p>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden',maxWidth:520}}>
              {['starter','pro','enterprise'].map(planName=>{
                const on=(planFeat[planName]||[]).includes('ai_chat.use');
                return (
                  <div key={planName} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1rem 1.25rem',borderBottom:'1px solid #f0f0f0'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{planName.toUpperCase()}</div>
                      <div style={{fontSize:12,color:'#888'}}>{on?tc('adminp.aiAssistantEnabledForPlan','AI assistant enabled for this plan'):tc('adminp.aiAssistantDisabledForPlan','AI assistant disabled for this plan')}</div>
                    </div>
                    <button onClick={async()=>{
                      const cur=planFeat[planName]||[];
                      const next= on ? cur.filter(c=>c!=='ai_chat.use') : [...cur,'ai_chat.use'];
                      setPlanFeat(p=>({...p,[planName]:next}));
                      const price=(plans.find(pp=>pp.name===planName)?.price_per_month)||0;
                      await adminFetch('/plans',{method:'POST',body:JSON.stringify({name:planName,price_per_month:price,features:next})});
                      reload(); showToast(on?tc('adminp.aiChatDisabledToast','AI Chat disabled'):tc('adminp.aiChatEnabledToast','AI Chat enabled'));
                    }} style={{background:'none',border:'none',cursor:'pointer',color:on?'#16a34a':'#ccc'}}>
                      {on?<ToggleRight size={30}/>:<ToggleLeft size={30}/>}
                    </button>
                  </div>
                );
              })}
            </div>
            <p style={{fontSize:12,color:'#aaa',marginTop:'1rem',maxWidth:520}}>
              {tc('adminp.aiChatFootnotePre', 'This toggles the “AI Assistant” function on each plan (same as ticking it under Plans). Configure the plan’s full function list under')} <strong>{tc('adminp.tabPlans', 'Plans')}</strong> {tc('adminp.aiChatFootnotePost', 'first; Responsibilities can further restrict who within an outlet may use the AI chat.')}
            </p>
          </div>
        )}

        {/* ── Users & Roles ── */}
        {tab==='stationusers'&&(
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>{tc('adminp.usersRolesHeading', 'Users & Roles')}</h1>
            <div style={{display:'flex',gap:12,alignItems:'flex-end',marginBottom:'1.5rem',flexWrap:'wrap'}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4,color:'#555'}}>{tc('adminp.selectPetrolBunk', 'Select Petrol Bunk')}</label>
                <select style={{...inp,width:260}} value={selStation} onChange={e=>{setSelStation(e.target.value);loadStationUsers(e.target.value);loadStTemplates(e.target.value);}}>
                  <option value="">{tc('adminp.selectPetrolBunkOption', 'Select a petrol bunk...')}</option>
                  {stations.map(s=><option key={s.id} value={s.id}>{s.name} — {s.city||''}</option>)}
                </select>
              </div>
              {selStation&&<button style={btn()} onClick={()=>openModal('stationUser',{station_id:selStation})}><UserPlus size={14}/>{tc('adminp.addUser', 'Add User')}</button>}
            </div>

            {/* Responsibilities (role templates) for this bunk */}
            {selStation&&(
              <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',padding:'1rem 1.25rem',marginBottom:'1.5rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontWeight:700,fontSize:14}}>{tc('adminp.responsibilities', 'Responsibilities')} <span style={{fontWeight:400,color:'#888',fontSize:12}}>{tc('adminp.responsibilitiesSub', '· function sets you assign to users (capped by the bunk’s plan)')}</span></div>
                  <button style={btn('#f0fff4','#15803d')} onClick={()=>openModal('responsibility',{station_id:selStation,permissions:[]})}><Plus size={13}/>{tc('adminp.newResponsibility', 'New Responsibility')}</button>
                </div>
                {stTemplates.length===0
                  ? <div style={{color:'#aaa',fontSize:13}}>{tc('adminp.noResponsibilitiesYet', 'No responsibilities yet. Users fall back to their system-role defaults.')}</div>
                  : <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                      {stTemplates.map(t=>(
                        <div key={t.id} style={{display:'flex',alignItems:'center',gap:8,background:'#f8f7f5',borderRadius:8,padding:'6px 10px',fontSize:13}}>
                          <span style={{fontWeight:600}}>{t.name}</span>
                          <span style={{color:'#888',fontSize:11}}>{tc('adminp.fnUsersCount','{fn} fn · {users} user(s)').replace('{fn}',(t.permissions||[]).length).replace('{users}',t.user_count||0)}</span>
                          {!t.is_system&&<>
                            <button style={{background:'none',border:'none',cursor:'pointer',color:'#1A5F7A'}} title={tc('adminp.edit','Edit')}
                              onClick={()=>openModal('responsibility',{id:t.id,station_id:selStation,name:t.name,description:t.description,permissions:t.permissions||[]})}><Edit2 size={13}/></button>
                            <button style={{background:'none',border:'none',cursor:'pointer',color:'#991b1b'}} title={tc('adminp.delete','Delete')}
                              onClick={()=>{ if(confirm(tc('adminp.deleteResponsibilityConfirm','Delete responsibility "{name}"?').replace('{name}',t.name))) adminFetch(`/templates/${t.id}`,{method:'DELETE'}).then(()=>{loadStTemplates(selStation);showToast(tc('adminp.deleted','Deleted.'));}); }}><Trash2 size={13}/></button>
                          </>}
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}
            {!selStation
              ? <div style={{background:'#fff',borderRadius:12,border:'1px dashed #ddd',padding:'3rem',textAlign:'center',color:'#aaa'}}>{tc('adminp.selectBunkAbove', 'Select a petrol bunk above')}</div>
              : <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr style={{background:'#f8f7f5'}}>
                      {[tc('adminp.colName','Name'),tc('adminp.colMobile','Mobile'),tc('adminp.colRole','Role'),tc('adminp.colResponsibility','Responsibility'),tc('adminp.colStatus','Status'),tc('adminp.colActions','Actions')].map(h=>(
                        <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {stationUsers.length===0&&<tr><td colSpan={6} style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>{tc('adminp.noUsersYet', 'No users yet')}</td></tr>}
                      {stationUsers.map(u=>(
                        <tr key={u.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                          <td style={{padding:'11px 14px',fontWeight:600}}>{u.name}</td>
                          <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:13}}>{(u.phone||'').replace('+91','')}</td>
                          <td style={{padding:'11px 14px'}}><span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:'#ede9fe',color:'#5b21b6',textTransform:'capitalize'}}>{u.role}</span></td>
                          <td style={{padding:'11px 14px'}}>
                            <select value={u.template_id||''} onChange={e=>assignResp(u.id,e.target.value)}
                              style={{padding:'4px 8px',borderRadius:7,border:'1px solid #e5e7eb',fontSize:12,background:'#fff',cursor:'pointer'}}>
                              <option value="">{tc('adminp.defaultRole', 'Default (role)')}</option>
                              {stTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </td>
                          <td style={{padding:'11px 14px'}}><span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:u.is_active?'#dcfce7':'#fee2e2',color:u.is_active?'#15803d':'#991b1b'}}>{u.is_active?tc('adminp.active','Active'):tc('adminp.inactive','Inactive')}</span></td>
                          <td style={{padding:'11px 14px'}}>
                            <div style={{display:'flex',gap:5}}>
                              <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editStationUser',{id:u.id,name:u.name,email:u.email,role:u.role,phone:(u.phone||'').replace('+91','')})}><Edit2 size={12}/>{tc('adminp.edit', 'Edit')}</button>
                              <button style={btn('#fff7ed','#9a3412')} onClick={()=>resetPassword(u.id)}><Key size={12}/>{tc('adminp.resetPw', 'Reset PW')}</button>
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
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>{tc('adminp.leadsHeading', 'Leads')} <span style={{fontSize:14,color:'#888',fontWeight:500}}>({sortedLeads.length})</span></h1>
              <div style={{display:'flex',gap:14,alignItems:'center'}}>
                <label style={{fontSize:12.5,color:'#666',display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}>
                  <input type="checkbox" checked={hideClosed} onChange={e=>setHideClosed(e.target.checked)}/> {tc('adminp.hideClosed', 'Hide closed')}
                </label>
                <button style={btn()} onClick={()=>openModal('lead',{source:'website',status:'new'})}><Plus size={15}/>{tc('adminp.addLead', 'Add Lead')}</button>
              </div>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:980}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {[[tc('adminp.colDate','Date'),'created_at'],[tc('adminp.colName','Name'),'name'],[tc('adminp.colPhone','Phone'),null],[tc('adminp.colBunk','Bunk'),'station_name'],[tc('adminp.colCity','City'),'city'],[tc('adminp.colState','State'),'state'],[tc('adminp.colSource','Source'),'source'],[tc('adminp.colStatus','Status'),'status'],[tc('adminp.colNotes','Notes'),null],['',null]].map(([h,field],i)=>(
                    <th key={i} onClick={()=>field&&sortLeads(field)}
                      style={{padding:'9px 12px',textAlign:'left',color:'#666',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de',cursor:field?'pointer':'default',userSelect:'none',whiteSpace:'nowrap'}}>
                      {h}{field&&leadSort.field===field?(leadSort.dir==='asc'?' ▲':' ▼'):''}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {sortedLeads.length===0&&<tr><td colSpan={10} style={{textAlign:'center',padding:'2.5rem',color:'#aaa'}}>{tc('adminp.noLeads', 'No leads')}</td></tr>}
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
                            {LEAD_STATUS.map(([v,lab])=><option key={v} value={v}>{tc('adminp.leadStatus_'+v,lab)}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'10px 12px',minWidth:180}}>
                          <input defaultValue={l.notes||''} placeholder={tc('adminp.addNotePlaceholder','Add note…')}
                            onBlur={e=>{ if(e.target.value!==(l.notes||'')) patchLead(l.id,{notes:e.target.value}); }}
                            style={{width:'100%',padding:'5px 8px',border:'1px solid #e5e7eb',borderRadius:6,fontSize:12,outline:'none'}}/>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <button style={btn('#fee2e2','#991b1b')} title={tc('adminp.delete','Delete')}
                            onClick={()=>{ if(confirm(tc('adminp.deleteLeadConfirm','Delete this lead?'))) adminFetch(`/leads/${l.id}`,{method:'DELETE'}).then(()=>{loadLeads();showToast(tc('adminp.deleted','Deleted.'));}); }}><Trash2 size={12}/></button>
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
        <Modal title={form.id?tc('adminp.editGroup','Edit Group'):tc('adminp.newOwnerGroup','New Owner Group')} onClose={closeModal}>
          <Field label={tc('adminp.groupName','Group Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.description','Description')}><input style={inp} value={form.description||''} onChange={e=>f('description',e.target.value)}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(form.id?`/groups/${form.id}`:'/groups',form.id?'PATCH':'POST')} disabled={loading}>{loading?tc('adminp.saving','Saving...'):form.id?tc('adminp.save','Save'):tc('adminp.create','Create')}</button>
        </Modal>
      )}

      {modal?.type==='addMember'&&(
        <Modal title={tc('adminp.addOwnerTo','Add Owner to: {group}').replace('{group}',modal.data.group_name)} onClose={closeModal}>
          <Field label={tc('adminp.selectOwner','Select Owner')} required>
            <select style={inp} value={form.user_id||''} onChange={e=>f('user_id',e.target.value)}>
              <option value="">{tc('adminp.selectDots','Select...')}</option>
              {owners.map(o=><option key={o.id} value={o.id}>{o.name} — {(o.phone||'').replace('+91','')}</option>)}
            </select>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(`/groups/${modal.data.group_id}/members`).then(()=>loadGroupMembers(modal.data.group_id))} disabled={loading}>{loading?tc('adminp.adding','Adding...'):tc('adminp.addToGroup','Add to Group')}</button>
        </Modal>
      )}

      {modal?.type==='owner'&&(
        <Modal title={tc('adminp.newOwnerModal','New Owner')} onClose={closeModal}>
          <Field label={tc('adminp.fullName','Full Name')} required><input style={inp} placeholder={tc('adminp.namePlaceholder','Rajesh Kumar')} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.mobile10','Mobile (10 digits)')} required>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label={tc('adminp.email','Email')}><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label={tc('adminp.password','Password')}><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder={tc('adminp.defaultWelcome','Default: Welcome@123')}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save('/owners')} disabled={loading}>{loading?tc('adminp.creating','Creating...'):tc('adminp.createOwner','Create Owner')}</button>
        </Modal>
      )}

      {modal?.type==='cco'&&(
        <Modal title={tc('adminp.newCcoModal','New CCO — {group}').replace('{group}',modal.data.group_name||'')} onClose={closeModal}>
          <div style={{fontSize:12,color:'#666',background:'#f5f3ff',borderRadius:8,padding:'8px 10px',marginBottom:12}}>
            {tc('adminp.ccoHelp','Central Cash Office user: back-office access (reconciliation, credit, cash, deposits, reports) across every outlet in this group. No forecourt (shifts / POS / dipstick).')}
          </div>
          <Field label={tc('adminp.fullName','Full Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.mobile10','Mobile (10 digits)')} required>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label={tc('adminp.email','Email')}><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label={tc('adminp.password','Password')}><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder={tc('adminp.defaultWelcome','Default: Welcome@123')}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} disabled={loading}
            onClick={async()=>{ const gid=modal.data.group_id; if(await save('/cco')) loadGroupMembers(gid); }}>{loading?tc('adminp.creating','Creating...'):tc('adminp.createCco','Create CCO')}</button>
        </Modal>
      )}

      {modal?.type==='editOwner'&&(
        <Modal title={tc('adminp.editOwnerModal','Edit Owner')} onClose={closeModal}>
          <Field label={tc('adminp.fullName','Full Name')}><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.mobile10','Mobile (10 digits)')}>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label={tc('adminp.email','Email')}><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label={tc('adminp.newPasswordBlank','New Password (blank = keep)')}><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder={tc('adminp.leaveBlankToKeep','Leave blank to keep')}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(`/owners/${form.id}`,'PATCH')} disabled={loading}>{loading?tc('adminp.saving','Saving...'):tc('adminp.saveChanges','Save Changes')}</button>
        </Modal>
      )}

      {(modal?.type==='station'||modal?.type==='editStation')&&(
        <Modal title={modal.type==='editStation'?tc('adminp.editPetrolBunk','Edit Petrol Bunk'):tc('adminp.newPetrolBunkModal','New Petrol Bunk')} onClose={closeModal}>
          <Field label={tc('adminp.stationName','Station Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label={tc('adminp.state','State')} required>
              <select style={inp} value={form.state||''} onChange={e=>f('state',e.target.value)}>
                <option value="">{tc('adminp.selectDots','Select...')}</option>
                {INDIAN_STATES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label={tc('adminp.city','City')} required>
              <select style={inp} value={form.city||''} onChange={e=>f('city',e.target.value)} disabled={!form.state}>
                <option value="">{tc('adminp.selectDots','Select...')}</option>
                {formCities.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label={tc('adminp.address','Address')}><input style={inp} value={form.address||''} onChange={e=>f('address',e.target.value)}/></Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label={tc('adminp.oilCompany','Oil Company')}>
              <select style={inp} value={form.oil_company||''} onChange={e=>f('oil_company',e.target.value)}>
                <option value="">{tc('adminp.selectDots','Select...')}</option>
                {['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="GSTN"><input style={inp} value={form.gst_number||''} onChange={e=>f('gst_number',e.target.value.toUpperCase())}/></Field>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label={tc('adminp.assignOwner','Assign Owner')}>
              <select style={inp} value={form.owner_id||''} onChange={e=>f('owner_id',e.target.value)}>
                <option value="">{tc('adminp.selectOwnerDots','Select owner...')}</option>
                {owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label={tc('adminp.ownerGroup','Owner Group')}>
              <select style={inp} value={form.owner_group_id||''} onChange={e=>f('owner_group_id',e.target.value)}>
                <option value="">{tc('adminp.noGroupIndependent','No group (independent)')}</option>
                {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          </div>
          {modal.type==='station'&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Field label={tc('adminp.planLabel','Plan')}>
                <select style={inp} value={form.plan||'pro'} onChange={e=>f('plan',e.target.value)}>
                  <option value="starter">STARTER</option><option value="pro">PRO</option><option value="enterprise">ENTERPRISE</option>
                </select>
              </Field>
              <Field label={tc('adminp.startDate','Start Date')}><input style={inp} type="date" value={form.start_date||todayIST()} onChange={e=>f('start_date',e.target.value)}/></Field>
            </div>
          )}
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,marginTop:4}} onClick={()=>save(modal.type==='editStation'?`/stations/${form.id}`:'/stations',modal.type==='editStation'?'PATCH':'POST')} disabled={loading}>{loading?tc('adminp.saving','Saving...'):modal.type==='editStation'?tc('adminp.saveChanges','Save Changes'):tc('adminp.createBunk','Create Bunk')}</button>
        </Modal>
      )}

      {modal?.type==='addBunk'&&(
        <Modal title={tc('adminp.addBunkTitle','Add Bunk — {group}').replace('{group}',modal.data.group_name)} onClose={closeModal}>
          <Field label={tc('adminp.petrolBunkField','Petrol Bunk')}>
            <select style={inp} value={form.station_id||''} onChange={e=>f('station_id',e.target.value)}>
              <option value="">{tc('adminp.selectABunk','Select a bunk…')}</option>
              {stations.map(s=><option key={s.id} value={s.id}>{s.name}{s.owner_group_id&&s.owner_group_id!==modal.data.group_id?tc('adminp.inAnotherGroup',' · in another group'):''}</option>)}
            </select>
          </Field>
          <div style={{fontSize:12,color:'#888',marginBottom:10}}>{tc('adminp.bunkOneGroupNote', 'A bunk belongs to one group — adding it here moves it from any other group.')}</div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} disabled={loading||!form.station_id}
            onClick={async()=>{ setLoading(true); const r=await adminFetch(`/groups/${modal.data.group_id}/stations`,{method:'POST',body:JSON.stringify({station_id:form.station_id})}); setLoading(false); if(r.error){alert(r.error);return;} loadGroupStations(modal.data.group_id); closeModal(); reload(); showToast(tc('adminp.bunkAdded','Bunk added.')); }}>
            {loading?tc('adminp.addingEllipsis','Adding…'):tc('adminp.addBunkToGroup','Add Bunk to Group')}
          </button>
        </Modal>
      )}

      {modal?.type==='responsibility'&&(
        <Modal title={form.id?tc('adminp.editResponsibility','Edit Responsibility'):tc('adminp.newResponsibilityModal','New Responsibility')} onClose={closeModal}>
          <Field label={tc('adminp.name','Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)} placeholder={tc('adminp.egCashier','e.g. Cashier')}/></Field>
          <Field label={tc('adminp.description','Description')}><input style={inp} value={form.description||''} onChange={e=>f('description',e.target.value)}/></Field>
          <div style={{fontSize:12,fontWeight:600,color:'#555',margin:'8px 0 6px'}}>{tc('adminp.functionsCount','Functions ({sel}/{total})').replace('{sel}',(form.permissions||[]).length).replace('{total}',modules.length)}</div>
          <div style={{maxHeight:300,overflowY:'auto',border:'1px solid #eee',borderRadius:8,padding:'6px 8px'}}>
            {[...new Set(modules.map(m=>m.category))].map(cat=>(
              <div key={cat} style={{marginBottom:6}}>
                <div style={{fontSize:10,fontWeight:700,color:'#999',textTransform:'uppercase',margin:'4px 0 2px'}}>{cat}</div>
                {modules.filter(m=>m.category===cat).map(m=>{
                  const on=(form.permissions||[]).includes(m.code);
                  return (
                    <label key={m.code} style={{display:'flex',alignItems:'center',gap:6,fontSize:12.5,padding:'2px 0',cursor:'pointer'}}>
                      <input type="checkbox" checked={on} onChange={()=>setForm(p=>{const cur=p.permissions||[];return {...p,permissions: on?cur.filter(c=>c!==m.code):[...cur,m.code]};})}/>
                      {m.label||m.code}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,marginTop:10}} disabled={loading||!form.name}
            onClick={async()=>{
              setLoading(true);
              const body=JSON.stringify({station_id:selStation,name:form.name,description:form.description||'',permissions:form.permissions||[]});
              const r= form.id ? await adminFetch(`/templates/${form.id}`,{method:'PATCH',body}) : await adminFetch('/templates',{method:'POST',body});
              setLoading(false);
              if(r&&r.error){alert(r.error);return;}
              closeModal(); loadStTemplates(selStation); showToast(tc('adminp.savedDot','Saved.'));
            }}>{loading?tc('adminp.savingEllipsis','Saving…'):form.id?tc('adminp.saveResponsibility','Save Responsibility'):tc('adminp.createResponsibility','Create Responsibility')}</button>
        </Modal>
      )}

      {modal?.type==='editSub'&&(
        <Modal title={tc('adminp.subscriptionTitle','Subscription — {name}').replace('{name}',modal.data.name)} onClose={closeModal}>
          <Field label={tc('adminp.planLabel','Plan')}>
            <select style={inp} value={form.plan||'pro'} onChange={e=>f('plan',e.target.value)}>
              <option value="starter">STARTER</option><option value="pro">PRO</option><option value="enterprise">ENTERPRISE</option>
            </select>
          </Field>
          <Field label={tc('adminp.status','Status')}>
            <div style={{display:'flex',gap:8}}>
              {[['active',tc('adminp.statusActive','Active')],['suspended',tc('adminp.statusSuspended','Suspended')],['cancelled',tc('adminp.statusCancelled','Cancelled')]].map(([s,lab])=>(
                <button key={s} type="button" onClick={()=>f('status',s)}
                  style={{...btn(form.status===s?(s==='active'?'#16a34a':s==='suspended'?'#ca8a04':'#dc2626'):'#f3f4f6',form.status===s?'#fff':'#374151'),flex:1,justifyContent:'center'}}>{lab}</button>
              ))}
            </div>
          </Field>
          <Field label={tc('adminp.endDateOptional','End Date (optional)')}>
            <input style={inp} type="date" value={form.end_date||''} onChange={e=>f('end_date',e.target.value||null)}/>
            {form.end_date&&<div style={{fontSize:11,color:'#9333ea',marginTop:4}}>{tc('adminp.autoStartsNextDay','⚡ New subscription auto-starts next day')}</div>}
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
              closeModal();reload();showToast(tc('adminp.subscriptionUpdated','Subscription updated!'));
            }}>{loading?tc('adminp.saving','Saving...'):tc('adminp.saveSubscription','Save Subscription')}</button>
        </Modal>
      )}

      {modal?.type==='alertDef'&&(
        <Modal title={form.id?tc('adminp.editAlert','Edit Alert'):tc('adminp.newAlertDefinition','New Alert Definition')} onClose={closeModal}>
          <Field label={tc('adminp.alertName','Alert Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.description','Description')}><textarea style={{...inp,height:72,resize:'vertical'}} value={form.description||''} onChange={e=>f('description',e.target.value)}/></Field>
          <Field label={tc('adminp.alertType','Alert Type')} required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">{tc('adminp.selectDots','Select...')}</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay','nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label={tc('adminp.severity','Severity')}>
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">{tc('adminp.severityInfo','Info')}</option><option value="warning">{tc('adminp.severityWarning','Warning')}</option><option value="critical">{tc('adminp.severityCritical','Critical')}</option>
              </select>
            </Field>
            <Field label={tc('adminp.activeLabel','Active')}>
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">{tc('adminp.yes','Yes')}</option><option value="false">{tc('adminp.no','No')}</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc'}}>{form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}</div>
            <div><div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>{tc('adminp.sendViaWhatsapp','Send via WhatsApp')}</div><div style={{fontSize:12,color:'#555'}}>{tc('adminp.alertSentToWhatsapp',"Alert sent to station owner's WhatsApp")}</div></div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(form.id?`/alert-definitions/${form.id}`:'/alert-definitions',form.id?'PATCH':'POST')} disabled={loading}>{loading?tc('adminp.saving','Saving...'):form.id?tc('adminp.save','Save'):tc('adminp.createAlert','Create Alert')}</button>
        </Modal>
      )}

      {modal?.type==='stationUser'&&(
        <Modal title={tc('adminp.addUserToStation','Add User to Station')} onClose={closeModal}>
          <Field label={tc('adminp.fullName','Full Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.mobile10','Mobile (10 digits)')} required>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label={tc('adminp.email','Email')}><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label={tc('adminp.role','Role')}>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">{tc('adminp.roleAttendant','Attendant')}</option><option value="manager">{tc('adminp.roleManager','Manager')}</option><option value="owner">{tc('adminp.roleOwner','Owner')}</option>
            </select>
          </Field>
          <Field label={tc('adminp.responsibility','Responsibility')}>
            <select style={inp} value={form.template_id||''} onChange={e=>f('template_id',e.target.value)}>
              <option value="">{tc('adminp.defaultRoleSystemPerms','Default (role) — system permissions')}</option>
              {stTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{fontSize:11,color:'#888',marginTop:4}}>{tc('adminp.responsibilityHelp', 'Pick a function set (e.g. Manager_lite). Leave as Default to use plain role permissions — you can change this later on the user row.')}</div>
          </Field>
          <Field label={tc('adminp.password','Password')}><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder={tc('adminp.defaultWelcome','Default: Welcome@123')}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} disabled={loading}
            onClick={async()=>{
              setLoading(true);
              const created=await adminFetch('/station-users',{method:'POST',body:JSON.stringify(form)});
              if(created&&created.error){ setLoading(false); alert(created.error); return; }
              if(form.template_id&&created&&created.id){
                await adminFetch('/templates/assign',{method:'POST',body:JSON.stringify({user_id:created.id,template_id:form.template_id,station_id:form.station_id})});
              }
              setLoading(false); closeModal(); loadStationUsers(form.station_id); reload(); showToast(tc('adminp.userAdded','User added.'));
            }}>{loading?tc('adminp.adding','Adding...'):tc('adminp.addUser','Add User')}</button>
        </Modal>
      )}

      {modal?.type==='creditCustomers'&&(
        <Modal title={tc('adminp.ccTitle','Credit customers — {n}').replace('{n}',modal.data.name)} onClose={closeModal} width={680}>
          <div style={{fontSize:12.5,color:'#666',marginBottom:14}}>{tc('adminp.ccHint','Seed customers with their go-live opening balance. Name required; mobile recommended. The manager adds GSTN etc. later.')}</div>
          {ccList.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,color:'#888',marginBottom:6,textTransform:'uppercase',letterSpacing:'.04em'}}>{tc('adminp.ccExisting','Already added ({n})').replace('{n}',ccList.length)}</div>
              {ccList.map(c=>(
                <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,background:'#f8fafc',borderRadius:8,padding:'7px 10px',marginBottom:5}}>
                  <div style={{minWidth:0}}><span style={{fontWeight:600,fontSize:13}}>{c.company_name}</span> <span style={{fontSize:12,color:'#888',fontFamily:'monospace'}}>{c.contact_phone||'—'}</span></div>
                  <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                    <span style={{fontSize:13,fontWeight:700}}>{fmtAmt(c.outstanding)}</span>
                    <button onClick={()=>delCreditCustomer(c.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Trash2 size={15}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 130px 130px 30px',gap:8,fontSize:11,fontWeight:700,color:'#888',marginBottom:6,textTransform:'uppercase'}}>
            <div>{tc('adminp.ccName','Customer name')}</div><div>{tc('adminp.ccMobile','Mobile')}</div><div>{tc('adminp.ccOB','Opening bal ₹')}</div><div/>
          </div>
          {ccRows.map((r,i)=>(
            <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 130px 130px 30px',gap:8,marginBottom:6,alignItems:'center'}}>
              <input style={inp} value={r.company_name} onChange={e=>setCcRow(i,'company_name',e.target.value)} placeholder={tc('adminp.ccNamePh','e.g. ABC Transports')}/>
              <input style={inp} value={r.contact_phone} onChange={e=>setCcRow(i,'contact_phone',e.target.value)} placeholder="9xxxxxxxxx"/>
              <input style={inp} type="number" value={r.opening_balance} onChange={e=>setCcRow(i,'opening_balance',e.target.value)} placeholder="0"/>
              <button onClick={()=>setCcRows(rs=>rs.length>1?rs.filter((_,idx)=>idx!==i):[{company_name:'',contact_phone:'',opening_balance:''}])} style={{background:'none',border:'none',cursor:'pointer',color:'#aaa'}}><X size={16}/></button>
            </div>
          ))}
          <button onClick={()=>setCcRows(rs=>[...rs,{company_name:'',contact_phone:'',opening_balance:''}])} style={{...btn('#f1f5f9','#334155'),marginTop:4}}><Plus size={14}/>{tc('adminp.addRow','Add row')}</button>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:44,marginTop:14}} disabled={gridBusy} onClick={saveCreditCustomers}>{gridBusy?tc('adminp.saving','Saving...'):tc('adminp.ccSave','Save customers')}</button>
        </Modal>
      )}
      {modal?.type==='attendants'&&(
        <Modal title={tc('adminp.attTitle','Attendants — {n}').replace('{n}',modal.data.name)} onClose={closeModal} width={620}>
          <div style={{fontSize:12.5,color:'#666',marginBottom:14}}>{tc('adminp.attHint','Seed currently-available attendants. Name + mobile both required. The manager can add/remove and end-date later.')}</div>
          {attList.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,color:'#888',marginBottom:6,textTransform:'uppercase',letterSpacing:'.04em'}}>{tc('adminp.attExisting','Already added ({n})').replace('{n}',attList.length)}</div>
              {attList.map(a=>{const inactive=a.is_active===false;return(
                <div key={a.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,background:'#f8fafc',borderRadius:8,padding:'7px 10px',marginBottom:5,opacity:inactive?0.65:1}}>
                  <div style={{minWidth:0}}><span style={{fontWeight:600,fontSize:13}}>{a.name}</span> <span style={{fontSize:12,color:'#888',fontFamily:'monospace'}}>{a.phone}</span>{inactive&&<span style={{color:'#dc2626',fontSize:11,marginLeft:6}}>{tc('adminp.attEnded','ended {d}').replace('{d}',a.end_date||'')}</span>}</div>
                  <button onClick={()=>toggleAttEnd(a)} style={{flexShrink:0,fontSize:12,fontWeight:600,cursor:'pointer',border:'1px solid',borderRadius:7,padding:'4px 9px',background:'#fff',borderColor:inactive?'#16a34a':'#e5e3de',color:inactive?'#16a34a':'#9a3412'}}>{inactive?tc('adminp.reactivate','Reactivate'):tc('adminp.endDate','End-date')}</button>
                </div>
              );})}
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 150px 30px',gap:8,fontSize:11,fontWeight:700,color:'#888',marginBottom:6,textTransform:'uppercase'}}>
            <div>{tc('adminp.attName','Name')}</div><div>{tc('adminp.attMobile','Mobile')}</div><div/>
          </div>
          {attRows.map((r,i)=>(
            <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 150px 30px',gap:8,marginBottom:6,alignItems:'center'}}>
              <input style={inp} value={r.name} onChange={e=>setAttRow(i,'name',e.target.value)} placeholder={tc('adminp.attNamePh','e.g. Suresh')}/>
              <input style={inp} value={r.phone} onChange={e=>setAttRow(i,'phone',e.target.value)} placeholder="9xxxxxxxxx"/>
              <button onClick={()=>setAttRows(rs=>rs.length>1?rs.filter((_,idx)=>idx!==i):[{name:'',phone:''}])} style={{background:'none',border:'none',cursor:'pointer',color:'#aaa'}}><X size={16}/></button>
            </div>
          ))}
          <button onClick={()=>setAttRows(rs=>[...rs,{name:'',phone:''}])} style={{...btn('#f1f5f9','#334155'),marginTop:4}}><Plus size={14}/>{tc('adminp.addRow','Add row')}</button>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:44,marginTop:14}} disabled={gridBusy} onClick={saveAttendants}>{gridBusy?tc('adminp.saving','Saving...'):tc('adminp.attSave','Save attendants')}</button>
        </Modal>
      )}
      {modal?.type==='lead'&&(
        <Modal title={tc('adminp.addLead','Add Lead')} onClose={closeModal}>
          <Field label={tc('adminp.name','Name')} required><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.mobile','Mobile')} required><input style={inp} value={form.phone||''} onChange={e=>f('phone',e.target.value)} placeholder="+91…"/></Field>
          <Field label={tc('adminp.petrolBunkField','Petrol Bunk')}><input style={inp} value={form.station_name||''} onChange={e=>f('station_name',e.target.value)}/></Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label={tc('adminp.state','State')}>
              <select style={inp} value={form.state||''} onChange={e=>{ f('state',e.target.value); f('city',''); }}>
                <option value="">{tc('adminp.selectEllipsis','Select…')}</option>
                {INDIAN_STATES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label={tc('adminp.city','City')}>
              <select style={inp} value={form.city||''} onChange={e=>f('city',e.target.value)} disabled={!form.state}>
                <option value="">{form.state?tc('adminp.selectEllipsis','Select…'):tc('adminp.pickStateFirst','Pick state first')}</option>
                {getCities(form.state).map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label={tc('adminp.source','Source')}>
              <select style={inp} value={form.source||'whatsapp'} onChange={e=>f('source',e.target.value)}>
                {LEAD_SOURCE.map(s=><option key={s} value={s}>{tc('adminp.leadSource_'+s,s.charAt(0).toUpperCase()+s.slice(1))}</option>)}
              </select>
            </Field>
            <Field label={tc('adminp.status','Status')}>
              <select style={inp} value={form.status||'new'} onChange={e=>f('status',e.target.value)}>
                {LEAD_STATUS.map(([v,lab])=><option key={v} value={v}>{tc('adminp.leadStatus_'+v,lab)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={tc('adminp.notes','Notes')}><textarea style={{...inp,height:72,resize:'vertical'}} value={form.notes||''} onChange={e=>f('notes',e.target.value)}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save('/leads')} disabled={loading}>{loading?tc('adminp.saving','Saving...'):tc('adminp.addLead','Add Lead')}</button>
        </Modal>
      )}

      {modal?.type==='editStationUser'&&(
        <Modal title={tc('adminp.editUser','Edit User')} onClose={closeModal}>
          <Field label={tc('adminp.fullName','Full Name')}><input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/></Field>
          <Field label={tc('adminp.mobile10','Mobile (10 digits)')}>
            <div style={{display:'flex',gap:8}}><span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
            <input style={{...inp,flex:1}} maxLength={10} value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></div>
          </Field>
          <Field label={tc('adminp.email','Email')}><input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/></Field>
          <Field label={tc('adminp.role','Role')}>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">{tc('adminp.roleAttendant','Attendant')}</option><option value="manager">{tc('adminp.roleManager','Manager')}</option><option value="owner">{tc('adminp.roleOwner','Owner')}</option>
            </select>
          </Field>
          <Field label={tc('adminp.newPasswordBlank','New Password (blank = keep)')}><PwField value={form.password||''} onChange={v=>f('password',v)} placeholder={tc('adminp.leaveBlank','Leave blank')}/></Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42}} onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))} disabled={loading}>{loading?tc('adminp.saving','Saving...'):tc('adminp.save','Save')}</button>
        </Modal>
      )}

    </div>
  );
}
