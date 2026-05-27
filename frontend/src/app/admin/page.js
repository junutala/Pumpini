'use client';
import { useState, useEffect } from 'react';
import { Users, Building2, Globe, TrendingUp, Plus, X, Shield, LogOut } from 'lucide-react';
import api from '../../lib/api';
import Cookies from 'js-cookie';

const PLAN_COLORS = { trial:'badge-warning', basic:'badge-info', pro:'badge-success', enterprise:'badge-danger' };
const fmt = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});

// SuperAdmin uses a separate token
const adminApi = {
  get:  (url)      => fetch(`/api/superadmin${url}`,{headers:{Authorization:`Bearer ${localStorage.getItem('admin_token')}`}}).then(r=>r.json()),
  post: (url,data) => fetch(`/api/superadmin${url}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('admin_token')}`},body:JSON.stringify(data)}).then(r=>r.json()),
  patch:(url,data) => fetch(`/api/superadmin${url}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('admin_token')}`},body:JSON.stringify(data)}).then(r=>r.json()),
};

function LoginScreen({ onLogin }) {
  const [form,setForm] = useState({email:'',password:''});
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);

  const submit = async(e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const res = await fetch('/api/superadmin/login',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(form)
      }).then(r=>r.json());
      if(res.error) { setError(res.error); return; }
      localStorage.setItem('admin_token', res.token);
      onLogin(res.admin);
    } catch(e){ setError('Login failed'); }
    finally{ setLoading(false); }
  };

  return (
    <div style={{minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0F1923'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2.5rem',width:360,boxShadow:'0 20px 60px rgba(0,0,0,.3)'}}>
        <div style={{textAlign:'center',marginBottom:'2rem'}}>
          <div style={{width:52,height:52,background:'#1A5F7A',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}>
            <Shield size={26} color="#fff"/>
          </div>
          <div style={{fontSize:20,fontWeight:700}}>Pumpini Admin</div>
          <div style={{fontSize:13,color:'#666',marginTop:4}}>SuperAdmin access only</div>
        </div>
        <form onSubmit={submit}>
          <div style={{marginBottom:'0.75rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Email</label>
            <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14,outline:'none'}}
              type="email" placeholder="admin@pumpini.in" value={form.email}
              onChange={e=>setForm(p=>({...p,email:e.target.value}))} required/>
          </div>
          <div style={{marginBottom:'1.5rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Password</label>
            <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14,outline:'none'}}
              type="password" placeholder="••••••••" value={form.password}
              onChange={e=>setForm(p=>({...p,password:e.target.value}))} required/>
          </div>
          {error && <div style={{background:'#fee2e2',color:'#991b1b',padding:'8px 12px',borderRadius:8,fontSize:13,marginBottom:'1rem'}}>{error}</div>}
          <button style={{width:'100%',height:46,background:'#1A5F7A',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:700,cursor:'pointer'}}
            type="submit" disabled={loading}>{loading?'Logging in...':'Login to Admin Panel'}</button>
        </form>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [admin,setAdmin]   = useState(null);
  const [tab,setTab]       = useState('dashboard');
  const [stats,setStats]   = useState(null);
  const [groups,setGroups] = useState([]);
  const [owners,setOwners] = useState([]);
  const [stations,setStations] = useState([]);
  const [showModal,setShowModal] = useState(null);
  const [form,setForm]     = useState({});
  const [loading,setLoading] = useState(false);

  useEffect(()=>{
    const token = localStorage.getItem('admin_token');
    if(token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if(payload.isSuperAdmin && payload.exp > Date.now()/1000) setAdmin(payload);
        else localStorage.removeItem('admin_token');
      } catch{ localStorage.removeItem('admin_token'); }
    }
  },[]);

  useEffect(()=>{
    if(!admin) return;
    Promise.all([adminApi.get('/platform-stats'),adminApi.get('/groups'),adminApi.get('/owners'),adminApi.get('/stations')])
      .then(([s,g,o,st])=>{ setStats(s); setGroups(g); setOwners(o); setStations(st); });
  },[admin]);

  const reload = () => Promise.all([adminApi.get('/groups'),adminApi.get('/owners'),adminApi.get('/stations')])
    .then(([g,o,st])=>{ setGroups(g); setOwners(o); setStations(st); });

  if(!admin) return <LoginScreen onLogin={setAdmin}/>;

  const TABS = [
    {id:'dashboard',label:'Platform Dashboard',icon:<TrendingUp size={15}/>},
    {id:'groups',   label:'Owner Groups',       icon:<Globe size={15}/>},
    {id:'owners',   label:'Owners',             icon:<Users size={15}/>},
    {id:'stations', label:'Petrol Bunks',        icon:<Building2 size={15}/>},
  ];

  const createGroup = async(e) => {
    e.preventDefault(); setLoading(true);
    const res = await adminApi.post('/groups',form);
    if(!res.error){ setShowModal(null); reload(); }
    else alert(res.error);
    setLoading(false);
  };

  const createOwner = async(e) => {
    e.preventDefault(); setLoading(true);
    const res = await adminApi.post('/owners',form);
    if(!res.error){ setShowModal(null); reload(); }
    else alert(res.error);
    setLoading(false);
  };

  const createStation = async(e) => {
    e.preventDefault(); setLoading(true);
    const res = await adminApi.post('/stations',form);
    if(!res.error){ setShowModal(null); reload(); }
    else alert(res.error);
    setLoading(false);
  };

  const updateSub = async(groupId,data) => {
    await adminApi.patch(`/subscriptions/${groupId}`,data); reload();
  };

  return (
    <div style={{display:'flex',minHeight:'100dvh',fontFamily:'DM Sans,system-ui,sans-serif',background:'#F4F7FA'}}>
      {/* Sidebar */}
      <div style={{width:220,background:'#0F1923',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100dvh'}}>
        <div style={{padding:'1.25rem 1rem',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
          <div style={{fontSize:18,fontWeight:800,color:'#fff'}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
          </div>
          <div style={{fontSize:11,color:'rgba(255,255,255,.4)',marginTop:2}}>Admin Panel</div>
        </div>
        <nav style={{flex:1,padding:'0.5rem 0'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 16px',background:tab===t.id?'rgba(255,107,0,.15)':'none',
                border:'none',cursor:'pointer',color:tab===t.id?'#FF6B00':'rgba(255,255,255,.6)',fontSize:14,fontWeight:tab===t.id?600:400,textAlign:'left'}}>
              {t.icon}{t.label}
            </button>
          ))}
        </nav>
        <div style={{padding:'1rem',borderTop:'1px solid rgba(255,255,255,.08)'}}>
          <div style={{fontSize:13,color:'rgba(255,255,255,.6)',marginBottom:8}}>{admin.name}</div>
          <button style={{background:'none',border:'1px solid rgba(255,255,255,.2)',color:'rgba(255,255,255,.6)',borderRadius:6,padding:'6px 12px',cursor:'pointer',fontSize:13,width:'100%'}}
            onClick={()=>{ localStorage.removeItem('admin_token'); setAdmin(null); }}>
            <LogOut size={13} style={{marginRight:6}}/>Logout
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,padding:'2rem',overflow:'auto'}}>

        {/* Platform Dashboard */}
        {tab==='dashboard' && (
          <div>
            <h1 style={{fontSize:'1.5rem',fontWeight:800,marginBottom:'1.5rem'}}>Platform Dashboard</h1>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1rem',marginBottom:'2rem'}}>
              {[
                ['Owner Groups',  stats?.total_groups||0,   '#FF6B00'],
                ['Petrol Bunks',  stats?.total_stations||0, '#1A5F7A'],
                ['Active Users',  stats?.total_users||0,    '#16a34a'],
                ["Today's Sales", `₹${fmt(stats?.today_sales||0)}`, '#9333ea'],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:'#fff',borderRadius:12,padding:'1.25rem',border:'1px solid #DDE5EA'}}>
                  <div style={{fontSize:12,color:'#666',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>{l}</div>
                  <div style={{fontSize:'1.75rem',fontWeight:800,color:c}}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{background:'#fff',borderRadius:12,padding:'1.5rem',border:'1px solid #DDE5EA'}}>
              <div style={{fontWeight:700,marginBottom:'1rem'}}>All Owner Groups</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #DDE5EA'}}>
                    {['Group Name','Owners','Stations','Plan','Status','Actions'].map(h=>(
                      <th key={h} style={{padding:'8px 12px',textAlign:'left',color:'#666',fontWeight:600,fontSize:12,textTransform:'uppercase'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g=>(
                    <tr key={g.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'10px 12px',fontWeight:600}}>{g.name}</td>
                      <td style={{padding:'10px 12px'}}>{g.owner_count}</td>
                      <td style={{padding:'10px 12px'}}>{g.station_count}</td>
                      <td style={{padding:'10px 12px'}}>
                        <span style={{padding:'2px 8px',borderRadius:4,fontSize:12,fontWeight:600,background:g.plan==='trial'?'#fef9c3':g.plan==='pro'?'#dcfce7':'#dbeafe',color:g.plan==='trial'?'#854d0e':g.plan==='pro'?'#15803d':'#1d4ed8'}}>
                          {g.plan||'trial'}
                        </span>
                      </td>
                      <td style={{padding:'10px 12px'}}>
                        <span style={{padding:'2px 8px',borderRadius:4,fontSize:12,fontWeight:600,background:g.sub_status==='active'?'#dcfce7':'#fee2e2',color:g.sub_status==='active'?'#15803d':'#991b1b'}}>
                          {g.sub_status||'active'}
                        </span>
                      </td>
                      <td style={{padding:'10px 12px'}}>
                        <select style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',cursor:'pointer'}}
                          value={g.plan||'trial'} onChange={e=>updateSub(g.id,{plan:e.target.value})}>
                          {['trial','basic','pro','enterprise'].map(p=><option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Owner Groups */}
        {tab==='groups' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.5rem',fontWeight:800}}>Owner Groups</h1>
              <button style={{display:'flex',alignItems:'center',gap:6,padding:'0 16px',height:40,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:'pointer'}}
                onClick={()=>{setForm({});setShowModal('group');}}>
                <Plus size={16}/> New Group
              </button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'1rem'}}>
              {groups.map(g=>(
                <div key={g.id} style={{background:'#fff',borderRadius:12,padding:'1.5rem',border:'1px solid #DDE5EA'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1rem'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:16}}>{g.name}</div>
                      <div style={{fontSize:12,color:'#666',marginTop:2}}>{g.description||'No description'}</div>
                    </div>
                    <span style={{padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600,background:g.plan==='trial'?'#fef9c3':'#dcfce7',color:g.plan==='trial'?'#854d0e':'#15803d'}}>
                      {g.plan||'trial'}
                    </span>
                  </div>
                  <div style={{display:'flex',gap:'1rem',fontSize:13,color:'#666'}}>
                    <span>👥 {g.owner_count} owners</span>
                    <span>⛽ {g.station_count} bunks</span>
                  </div>
                  <div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid #f0f0f0',display:'flex',gap:8}}>
                    <button style={{fontSize:12,padding:'6px 12px',background:'#f4f7fa',border:'1px solid #ddd',borderRadius:6,cursor:'pointer'}}
                      onClick={()=>{setForm({group_id:g.id});setShowModal('add_member');}}>
                      + Add Owner
                    </button>
                    <select style={{fontSize:12,padding:'6px 8px',borderRadius:6,border:'1px solid #ddd',cursor:'pointer',flex:1}}
                      value={g.sub_status||'active'} onChange={e=>updateSub(g.id,{status:e.target.value})}>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Owners */}
        {tab==='owners' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.5rem',fontWeight:800}}>Owners</h1>
              <button style={{display:'flex',alignItems:'center',gap:6,padding:'0 16px',height:40,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:'pointer'}}
                onClick={()=>{setForm({});setShowModal('owner');}}>
                <Plus size={16}/> New Owner
              </button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #DDE5EA',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
                <thead>
                  <tr style={{background:'#f8f7f5',borderBottom:'1px solid #DDE5EA'}}>
                    {['Name','Phone','Email','Groups','Stations','Actions'].map(h=>(
                      <th key={h} style={{padding:'10px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:12,textTransform:'uppercase'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {owners.map(o=>(
                    <tr key={o.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'12px 14px',fontWeight:600}}>{o.name}</td>
                      <td style={{padding:'12px 14px',fontFamily:'monospace'}}>{o.phone}</td>
                      <td style={{padding:'12px 14px',color:'#666'}}>{o.email||'—'}</td>
                      <td style={{padding:'12px 14px'}}>{(o.groups||[]).filter(Boolean).join(', ')||'—'}</td>
                      <td style={{padding:'12px 14px'}}>{o.station_count}</td>
                      <td style={{padding:'12px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:4,fontSize:11,background:o.is_active?'#dcfce7':'#fee2e2',color:o.is_active?'#15803d':'#991b1b'}}>
                          {o.is_active?'Active':'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stations */}
        {tab==='stations' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.5rem',fontWeight:800}}>Petrol Bunks</h1>
              <button style={{display:'flex',alignItems:'center',gap:6,padding:'0 16px',height:40,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:'pointer'}}
                onClick={()=>{setForm({});setShowModal('station');}}>
                <Plus size={16}/> New Bunk
              </button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #DDE5EA',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
                <thead>
                  <tr style={{background:'#f8f7f5',borderBottom:'1px solid #DDE5EA'}}>
                    {['Station Name','City','State','Oil Co.','GSTN','Owners'].map(h=>(
                      <th key={h} style={{padding:'10px 14px',textAlign:'left',color:'#666',fontWeight:600,fontSize:12,textTransform:'uppercase'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stations.map(s=>(
                    <tr key={s.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'12px 14px',fontWeight:600}}>{s.name}</td>
                      <td style={{padding:'12px 14px'}}>{s.city||'—'}</td>
                      <td style={{padding:'12px 14px'}}>{s.state||'—'}</td>
                      <td style={{padding:'12px 14px'}}><span style={{padding:'2px 8px',borderRadius:4,fontSize:11,background:'#dbeafe',color:'#1d4ed8',fontWeight:600}}>{s.oil_company||'—'}</span></td>
                      <td style={{padding:'12px 14px',fontFamily:'monospace',fontSize:12}}>{s.gstn||'—'}</td>
                      <td style={{padding:'12px 14px',fontSize:13,color:'#666'}}>{(s.owners||[]).filter(Boolean).join(', ')||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
          <div style={{background:'#fff',borderRadius:16,padding:'2rem',width:420,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.5rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>
                {showModal==='group'?'New Owner Group':showModal==='owner'?'New Owner':showModal==='station'?'New Petrol Bunk':'Add Owner to Group'}
              </span>
              <button onClick={()=>setShowModal(null)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            {showModal==='group' && (
              <form onSubmit={createGroup}>
                {[['name','Group Name','e.g. Venkataraman Group',true],['description','Description','Optional',false],['billing_email','Billing Email','admin@group.com',false]].map(([f,l,ph,r])=>(
                  <div key={f} style={{marginBottom:'0.75rem'}}>
                    <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>{l}</label>
                    <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14}} placeholder={ph} required={r} onChange={e=>setForm(p=>({...p,[f]:e.target.value}))}/>
                  </div>
                ))}
                <div style={{marginBottom:'1.25rem'}}>
                  <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Plan</label>
                  <select style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14}} onChange={e=>setForm(p=>({...p,plan:e.target.value}))}>
                    <option value="trial">Trial (30 days)</option>
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <button style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:700,cursor:'pointer'}} type="submit" disabled={loading}>{loading?'Creating...':'Create Group'}</button>
              </form>
            )}

            {showModal==='owner' && (
              <form onSubmit={createOwner}>
                {[['name','Full Name','Rajesh Kumar',true],['phone','Phone','+91 98765 43210',true],['email','Email','owner@example.com',false],['password','Temporary Password','Min 8 chars',false]].map(([f,l,ph,r])=>(
                  <div key={f} style={{marginBottom:'0.75rem'}}>
                    <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>{l}</label>
                    <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14}} placeholder={ph} required={r} type={f==='password'?'password':f==='email'?'email':'text'} onChange={e=>setForm(p=>({...p,[f]:e.target.value}))}/>
                  </div>
                ))}
                <div style={{marginBottom:'1.25rem'}}>
                  <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Assign to Group</label>
                  <select style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14}} onChange={e=>setForm(p=>({...p,group_id:e.target.value}))}>
                    <option value="">No group yet</option>
                    {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div style={{fontSize:12,color:'#666',marginBottom:'1rem'}}>Default password: Welcome@123 if left blank</div>
                <button style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:700,cursor:'pointer'}} type="submit" disabled={loading}>{loading?'Creating...':'Create Owner'}</button>
              </form>
            )}

            {showModal==='station' && (
              <form onSubmit={createStation}>
                {[['name','Station Name','e.g. Anna Salai HPCL',true],['address','Address','Full address',false],['city','City','Chennai',false],['state','State','Tamil Nadu',false],['gst_number','GSTN','33ABCDE1234F1Z5',false],['oil_company','Oil Company','HPCL / BPCL / IOC',false]].map(([f,l,ph,r])=>(
                  <div key={f} style={{marginBottom:'0.75rem'}}>
                    <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>{l}</label>
                    <input style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14}} placeholder={ph} required={r} onChange={e=>setForm(p=>({...p,[f]:e.target.value}))}/>
                  </div>
                ))}
                <div style={{marginBottom:'0.75rem'}}>
                  <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Assign Owner</label>
                  <select style={{width:'100%',padding:'10px 12px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14}} onChange={e=>setForm(p=>({...p,owner_id:e.target.value}))}>
                    <option value="">Select owner...</option>
                    {owners.map(o=><option key={o.id} value={o.id}>{o.name} ({o.phone})</option>)}
                  </select>
                </div>
                <button style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:700,cursor:'pointer',marginTop:'0.5rem'}} type="submit" disabled={loading}>{loading?'Creating...':'Create Petrol Bunk'}</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
