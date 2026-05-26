'use client';
import { useState, useEffect } from 'react';
import { Plus, X, Shield, Check, Users } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const CATEGORY_ORDER = ['Dashboard','Shifts','Dispense','Reconciliation','Corporate','Attendance','Stock','Reports','Alerts','Admin'];

export default function TemplatesPage() {
  const { station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [templates,setTemplates] = useState([]);
  const [modules,setModules]     = useState([]);
  const [users,setUsers]         = useState([]);
  const [selected,setSelected]   = useState(null);
  const [showCreate,setShowCreate] = useState(false);
  const [showAssign,setShowAssign] = useState(false);
  const [form,setForm]           = useState({name:'',description:'',permissions:[]});
  const [assignForm,setAssignForm] = useState({user_id:'',template_id:''});
  const [loading,setLoading]     = useState(false);
  const [saved,setSaved]         = useState('');

  const load = async() => {
    if(!stationId) return;
    const [t,m,u] = await Promise.all([
      api.get(`/templates?station_id=${stationId}`),
      api.get('/templates/modules'),
      api.get(`/users?station_id=${stationId}`),
    ]);
    setTemplates(t); setModules(m); setUsers(u);
  };
  useEffect(()=>{ load(); },[stationId]);

  const grouped = CATEGORY_ORDER.map(cat=>({
    category:cat, items:modules.filter(m=>m.category===cat)
  })).filter(g=>g.items.length>0);

  const togglePerm = (code) => {
    setForm(p=>({...p, permissions:p.permissions.includes(code)?p.permissions.filter(x=>x!==code):[...p.permissions,code]}));
  };

  const handleCreate = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/templates',{station_id:stationId,...form});
      setShowCreate(false); setForm({name:'',description:'',permissions:[]}); load();
      setSaved('Template created!'); setTimeout(()=>setSaved(''),3000);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const handleAssign = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/templates/assign',{...assignForm,station_id:stationId});
      setShowAssign(false);
      setSaved('Role assigned!'); setTimeout(()=>setSaved(''),3000);
      load();
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const getUserTemplate = (userId) => {
    // This would need a join — for now show from local data
    return null;
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Role Templates & Permissions</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>Define what each role can access, then assign to users</div>
        </div>
        {saved && <div className="badge badge-success" style={{padding:'6px 12px'}}>✓ {saved}</div>}
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-secondary" onClick={()=>setShowAssign(true)}>
            <Users size={15}/> Assign Role to User
          </button>
          <button className="btn btn-primary" onClick={()=>{setForm({name:'',description:'',permissions:[]});setShowCreate(true);}}>
            <Plus size={15}/> New Template
          </button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:'1.5rem'}}>
        {/* Template list */}
        <div>
          {templates.map(t=>(
            <div key={t.id} className="card" style={{marginBottom:'0.75rem',cursor:'pointer',borderColor:selected?.id===t.id?'var(--brand)':'var(--border)'}}
              onClick={()=>setSelected(t)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{t.name}</div>
                  {t.is_system && <span className="badge badge-info" style={{fontSize:10,marginTop:3}}>System</span>}
                  <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>{t.description||'No description'}</div>
                </div>
                <div style={{fontSize:12,color:'var(--text-3)',flexShrink:0,textAlign:'right'}}>
                  <div>{(t.permissions||[]).length} perms</div>
                  <div>{t.user_count} users</div>
                </div>
              </div>
            </div>
          ))}
          {templates.length===0 && <div style={{color:'var(--text-3)',fontSize:13}}>No templates yet</div>}
        </div>

        {/* Template detail */}
        {selected ? (
          <div className="card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>{selected.name}</div>
                <div style={{fontSize:13,color:'var(--text-3)'}}>{selected.description}</div>
              </div>
              {selected.is_system && <span className="badge badge-info">System Template — read only</span>}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'1rem'}}>
              {grouped.map(group=>(
                <div key={group.category}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8,paddingBottom:4,borderBottom:'1px solid var(--border)'}}>{group.category}</div>
                  {group.items.map(m=>{
                    const has = (selected.permissions||[]).includes(m.code);
                    return (
                      <div key={m.code} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0'}}>
                        <div style={{width:18,height:18,borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',
                          background:has?'var(--brand)':'var(--surface-2)',border:`1px solid ${has?'var(--brand)':'var(--border)'}`}}>
                          {has && <Check size={11} color="#fff" strokeWidth={3}/>}
                        </div>
                        <span style={{fontSize:13,color:has?'var(--text-1)':'var(--text-3)'}}>{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Users with this template */}
            <div style={{marginTop:'1.5rem',paddingTop:'1.5rem',borderTop:'1px solid var(--border)'}}>
              <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>Users assigned this template</div>
              <div style={{color:'var(--text-3)',fontSize:13}}>
                {selected.user_count > 0 ? `${selected.user_count} user(s) have this role` : 'No users assigned yet'}
              </div>
              <button className="btn btn-secondary btn-sm" style={{marginTop:8}}
                onClick={()=>{ setAssignForm(p=>({...p,template_id:selected.id})); setShowAssign(true); }}>
                <Users size={13}/> Assign this role to a user
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-3)',fontSize:13,minHeight:300}}>
            Select a template on the left to view its permissions
          </div>
        )}
      </div>

      {/* Users and their current roles */}
      <div className="card" style={{marginTop:'1.5rem'}}>
        <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>Users & Assigned Roles</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr><th>User</th><th>Phone</th><th>System Role</th><th>Template Assigned</th><th>Action</th></tr>
            </thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id}>
                  <td style={{fontWeight:500}}>{u.name}</td>
                  <td className="num" style={{fontSize:13}}>{u.phone}</td>
                  <td><span className="badge badge-gray" style={{textTransform:'capitalize'}}>{u.role}</span></td>
                  <td><span style={{fontSize:13,color:'var(--text-3)'}}>Click assign →</span></td>
                  <td>
                    <button className="btn btn-secondary btn-sm"
                      onClick={()=>{ setAssignForm({user_id:u.id,template_id:''}); setShowAssign(true); }}>
                      Assign Role
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create template */}
      {showCreate && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100,overflowY:'auto'}}>
          <div className="card" style={{width:600,margin:'2rem auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>Create Role Template</span>
              <button onClick={()=>setShowCreate(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">Template Name</label>
                <input className="input" placeholder="e.g. Night Shift Manager" required value={form.name}
                  onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
              </div>
              <div style={{marginBottom:'1rem'}}>
                <label className="label">Description</label>
                <input className="input" placeholder="What does this role do?" value={form.description}
                  onChange={e=>setForm(p=>({...p,description:e.target.value}))}/>
              </div>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">Permissions</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'0.75rem'}}>
                  {grouped.map(group=>(
                    <div key={group.category}>
                      <div style={{fontSize:11,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',marginBottom:6}}>{group.category}</div>
                      {group.items.map(m=>{
                        const has = form.permissions.includes(m.code);
                        return (
                          <label key={m.code} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer'}}>
                            <input type="checkbox" checked={has} onChange={()=>togglePerm(m.code)}/>
                            <span style={{fontSize:13}}>{m.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading?'Creating...':'Create Template'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Assign role */}
      {showAssign && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:400}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>Assign Role to User</span>
              <button onClick={()=>setShowAssign(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <form onSubmit={handleAssign}>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">User</label>
                <select className="input" required value={assignForm.user_id}
                  onChange={e=>setAssignForm(p=>({...p,user_id:e.target.value}))}>
                  <option value="">Select user...</option>
                  {users.map(u=><option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
                </select>
              </div>
              <div style={{marginBottom:'1.5rem'}}>
                <label className="label">Role Template</label>
                <select className="input" required value={assignForm.template_id}
                  onChange={e=>setAssignForm(p=>({...p,template_id:e.target.value}))}>
                  <option value="">Select template...</option>
                  {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {assignForm.template_id && (
                  <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>
                    {templates.find(t=>t.id===assignForm.template_id)?.description}
                  </div>
                )}
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading?'Assigning...':'Assign Role'}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
