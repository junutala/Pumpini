'use client';
import { useState, useEffect } from 'react';
import { Plus, X, Check, Shield, Edit2, Trash2 } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { displayMobile } from '../../lib/india';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const CATEGORY_ORDER = ['Dashboard','Shifts','Dispense','Reconciliation',
  'Corporate','Attendance','Stock','Reports','Alerts','Admin'];

export default function RolesPage() {
  const { station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [roles,       setRoles]       = useState([]);
  const [modules,     setModules]     = useState([]);
  const [users,       setUsers]       = useState([]);
  const [assignments, setAssignments] = useState({});
  const [selected,    setSelected]    = useState(null);
  const [showCreate,  setShowCreate]  = useState(false);
  const [showAssign,  setShowAssign]  = useState(false);
  const [assignTarget,setAssignTarget]= useState(null);
  const [assignRoleId,setAssignRoleId]= useState('');
  const [form,        setForm]        = useState({name:'',description:'',permissions:[]});
  const [loading,     setLoading]     = useState(false);
  const [saved,       setSaved]       = useState('');
  const [confirm,     setConfirm]     = useState(null);

  const load = async() => {
    if(!stationId) return;
    const [r,m,u,a] = await Promise.all([
      api.get(`/templates?station_id=${stationId}`),
      api.get('/templates/modules'),
      api.get(`/users?station_id=${stationId}`),
      api.get(`/templates/assignments?station_id=${stationId}`).catch(()=>[]),
    ]);
    setRoles(Array.isArray(r)?r:[]);
    setModules(Array.isArray(m)?m:[]);
    setUsers(Array.isArray(u)?u:[]);
    const map = {};
    (Array.isArray(a)?a:[]).forEach(row=>{
      map[row.user_id] = { roleId:row.template_id, roleName:row.template_name };
    });
    setAssignments(map);
  };

  useEffect(()=>{ load(); },[stationId]);
  useRefreshOnFocus(load);

  const grouped = CATEGORY_ORDER.map(cat=>({
    category:cat, items:modules.filter(m=>m.category===cat)
  })).filter(g=>g.items.length>0);

  const togglePerm = code => setForm(p=>({
    ...p,
    permissions: p.permissions.includes(code)
      ? p.permissions.filter(x=>x!==code)
      : [...p.permissions, code]
  }));

  const selectAll = cat => {
    const catCodes = modules.filter(m=>m.category===cat).map(m=>m.code);
    const allSelected = catCodes.every(c=>form.permissions.includes(c));
    setForm(p=>({
      ...p,
      permissions: allSelected
        ? p.permissions.filter(c=>!catCodes.includes(c))
        : [...new Set([...p.permissions,...catCodes])]
    }));
  };

  const handleCreate = async e => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/templates',{station_id:stationId,...form});
      setShowCreate(false);
      setForm({name:'',description:'',permissions:[]});
      load();
      setSaved('Role created!'); setTimeout(()=>setSaved(''),3000);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const handleDelete = role => {
    if(role.is_system) return alert('Built-in roles cannot be deleted');
    setConfirm({
      message:`Delete role "${role.name}"?`,
      detail:'Users assigned this role will fall back to default permissions.',
      danger:true,
      onConfirm: async()=>{
        await api.delete(`/templates/${role.id}`).catch(()=>{});
        load(); setSaved('Role deleted!'); setTimeout(()=>setSaved(''),3000);
      }
    });
  };

  const handleAssign = async() => {
    if(!assignTarget||!assignRoleId) return;
    setLoading(true);
    try {
      await api.post('/templates/assign',{
        user_id:assignTarget.id,
        template_id:assignRoleId,
        station_id:stationId,
      });
      setShowAssign(false); setAssignTarget(null); setAssignRoleId('');
      load();
      setSaved('Role assigned!'); setTimeout(()=>setSaved(''),3000);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const openAssign = user => {
    setAssignTarget(user);
    setAssignRoleId(assignments[user.id]?.roleId||'');
    setShowAssign(true);
  };

  return (
    <AppShell>
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          detail={confirm.detail}
          danger={confirm.danger}
          confirmLabel={confirm.danger?'Delete':'Confirm'}
          onConfirm={()=>{ confirm.onConfirm(); setConfirm(null); }}
          onCancel={()=>setConfirm(null)}/>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Roles</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>
            Define roles and assign to staff. The role controls what each person can see and do.
          </div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {saved && <div className="badge badge-success" style={{padding:'6px 12px'}}>✓ {saved}</div>}
          <button className="btn btn-primary" onClick={()=>{
            setForm({name:'',description:'',permissions:[]});
            setShowCreate(true);
          }}>
            <Plus size={15}/>New Role
          </button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'260px 1fr',gap:'1.5rem'}}>

        {/* Roles list */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:'var(--text-3)',
            textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>
            Built-in Roles
          </div>
          {roles.filter(r=>r.is_system).map(r=>(
            <div key={r.id} className="card"
              style={{marginBottom:'0.5rem',cursor:'pointer',padding:'0.75rem',
                borderColor:selected?.id===r.id?'var(--brand)':'var(--border)',
                borderLeft:`3px solid #1A5F7A`}}
              onClick={()=>setSelected(r)}>
              <div style={{fontWeight:600,fontSize:13}}>{r.name}</div>
              <div style={{fontSize:11,color:'var(--text-3)',marginTop:2}}>
                {(r.permissions||[]).length} permissions · {r.user_count} users
              </div>
            </div>
          ))}

          <div style={{fontSize:11,fontWeight:700,color:'var(--text-3)',
            textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8,marginTop:'1rem'}}>
            Custom Roles
          </div>
          {roles.filter(r=>!r.is_system).length===0 && (
            <div style={{fontSize:12,color:'var(--text-3)',padding:'0.5rem 0'}}>
              No custom roles yet. Click "New Role" to create one.
            </div>
          )}
          {roles.filter(r=>!r.is_system).map(r=>(
            <div key={r.id} className="card"
              style={{marginBottom:'0.5rem',cursor:'pointer',padding:'0.75rem',
                borderColor:selected?.id===r.id?'var(--brand)':'var(--border)',
                borderLeft:`3px solid var(--brand)`}}
              onClick={()=>setSelected(r)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontWeight:600,fontSize:13}}>{r.name}</div>
                  <div style={{fontSize:11,color:'var(--text-3)',marginTop:2}}>
                    {(r.permissions||[]).length} permissions · {r.user_count} users
                  </div>
                </div>
                <button style={{background:'none',border:'none',cursor:'pointer',
                  color:'var(--danger)',padding:2}}
                  onClick={e=>{e.stopPropagation();handleDelete(r);}}>
                  <Trash2 size={13}/>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Role detail */}
        {selected ? (
          <div className="card">
            <div style={{marginBottom:'1rem'}}>
              <div style={{fontWeight:700,fontSize:16}}>{selected.name}</div>
              {selected.description && (
                <div style={{fontSize:13,color:'var(--text-3)',marginTop:2}}>{selected.description}</div>
              )}
              <div style={{fontSize:12,marginTop:4,color:selected.is_system?'#1A5F7A':'var(--brand)',fontWeight:500}}>
                {selected.is_system ? '🔒 Built-in role' : '✏️ Custom role'}
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'1rem'}}>
              {grouped.map(group=>(
                <div key={group.category}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--text-2)',
                    textTransform:'uppercase',letterSpacing:'.05em',
                    marginBottom:6,paddingBottom:4,borderBottom:'1px solid var(--border)'}}>
                    {group.category}
                  </div>
                  {group.items.map(m=>{
                    const has = (selected.permissions||[]).includes(m.code);
                    return (
                      <div key={m.code} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0'}}>
                        <div style={{width:15,height:15,borderRadius:3,flexShrink:0,
                          display:'flex',alignItems:'center',justifyContent:'center',
                          background:has?'var(--brand)':'var(--surface-2)',
                          border:`1px solid ${has?'var(--brand)':'var(--border)'}`}}>
                          {has && <Check size={9} color="#fff" strokeWidth={3}/>}
                        </div>
                        <span style={{fontSize:12,color:has?'var(--text-1)':'var(--text-3)'}}>{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card" style={{display:'flex',alignItems:'center',
            justifyContent:'center',color:'var(--text-3)',fontSize:13,minHeight:200}}>
            Select a role on the left to view its permissions
          </div>
        )}
      </div>

      {/* Staff & their roles */}
      <div className="card" style={{marginTop:'1.5rem'}}>
        <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>
          Staff & Assigned Roles
        </div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th>Role</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u=>{
                const assignment = assignments[u.id];
                return (
                  <tr key={u.id}>
                    <td style={{fontWeight:500}}>{u.name}</td>
                    <td style={{fontFamily:'var(--font-mono)',fontSize:13}}>
                      {displayMobile(u.phone)}
                    </td>
                    <td>
                      {assignment ? (
                        <span className="badge badge-success" style={{fontSize:12}}>
                          {assignment.roleName}
                        </span>
                      ) : (
                        <span className="badge badge-warning" style={{fontSize:12}}>
                          Not assigned
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm"
                        onClick={()=>openAssign(u)}>
                        <Shield size={12}/>
                        {assignment ? 'Change Role' : 'Assign Role'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create Role */}
      {showCreate && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',
          display:'flex',alignItems:'center',justifyContent:'center',
          zIndex:100,overflowY:'auto',padding:'1rem'}}>
          <div className="card" style={{width:'100%',maxWidth:640}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>Create New Role</span>
              <button onClick={()=>setShowCreate(false)}
                style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:'1rem'}}>
                <div>
                  <label className="label">Role Name *</label>
                  <input className="input" placeholder="e.g. POS Operator" required
                    value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
                </div>
                <div>
                  <label className="label">Description</label>
                  <input className="input" placeholder="What does this role do?"
                    value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))}/>
                </div>
              </div>

              <label className="label" style={{marginBottom:8,display:'block'}}>
                Permissions — tick what this role can access
              </label>
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',
                gap:'0.75rem',maxHeight:380,overflowY:'auto',padding:'0.5rem',
                background:'var(--surface-2)',borderRadius:8,marginBottom:'1.25rem'}}>
                {grouped.map(group=>(
                  <div key={group.category}>
                    <div style={{display:'flex',justifyContent:'space-between',
                      alignItems:'center',marginBottom:5}}>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--text-2)',
                        textTransform:'uppercase'}}>{group.category}</div>
                      <button type="button"
                        style={{fontSize:10,background:'none',border:'none',
                          cursor:'pointer',color:'var(--brand)',fontWeight:600}}
                        onClick={()=>selectAll(group.category)}>
                        {group.items.every(m=>form.permissions.includes(m.code))?'None':'All'}
                      </button>
                    </div>
                    {group.items.map(m=>{
                      const has = form.permissions.includes(m.code);
                      return (
                        <label key={m.code}
                          style={{display:'flex',alignItems:'center',gap:8,
                            padding:'4px 6px',cursor:'pointer',fontSize:13,
                            borderRadius:4,background:has?'#fff':'transparent'}}>
                          <input type="checkbox" checked={has}
                            onChange={()=>togglePerm(m.code)}/>
                          {m.label}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:13,color:'var(--text-3)'}}>
                  {form.permissions.length} permissions selected
                </div>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading?'Creating...':'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Assign Role */}
      {showAssign && assignTarget && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',
          display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:460}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>Assign Role</div>
                <div style={{fontSize:13,color:'var(--text-3)',marginTop:2}}>
                  {assignTarget.name} · {displayMobile(assignTarget.phone)}
                </div>
              </div>
              <button onClick={()=>setShowAssign(false)}
                style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            {assignments[assignTarget.id] && (
              <div style={{background:'#f0fdf4',borderRadius:8,padding:'0.75rem',
                marginBottom:'1rem',fontSize:13,color:'#15803d'}}>
                Current role: <strong>{assignments[assignTarget.id].roleName}</strong>
              </div>
            )}

            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:'1.5rem'}}>
              {/* Custom roles first */}
              {roles.filter(r=>!r.is_system).length>0 && (
                <div style={{fontSize:10,fontWeight:700,color:'var(--brand)',
                  textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>
                  Custom Roles
                </div>
              )}
              {roles.filter(r=>!r.is_system).map(r=>(
                <label key={r.id} style={{display:'flex',alignItems:'center',gap:10,
                  padding:'10px 12px',border:`1.5px solid ${assignRoleId===r.id?'var(--brand)':'var(--border)'}`,
                  borderRadius:8,cursor:'pointer',
                  background:assignRoleId===r.id?'var(--brand-light)':'#fff'}}>
                  <input type="radio" name="role" checked={assignRoleId===r.id}
                    onChange={()=>setAssignRoleId(r.id)}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{r.name}</div>
                    <div style={{fontSize:11,color:'var(--text-3)',marginTop:1}}>
                      {(r.permissions||[]).length} permissions
                    </div>
                  </div>
                  {assignRoleId===r.id && <Check size={16} color="var(--brand)"/>}
                </label>
              ))}

              <div style={{fontSize:10,fontWeight:700,color:'var(--text-3)',
                textTransform:'uppercase',letterSpacing:'.06em',margin:'6px 0 2px'}}>
                Built-in Roles
              </div>
              {roles.filter(r=>r.is_system).map(r=>(
                <label key={r.id} style={{display:'flex',alignItems:'center',gap:10,
                  padding:'10px 12px',border:`1.5px solid ${assignRoleId===r.id?'#1A5F7A':'var(--border)'}`,
                  borderRadius:8,cursor:'pointer',
                  background:assignRoleId===r.id?'#f0f9ff':'#fff'}}>
                  <input type="radio" name="role" checked={assignRoleId===r.id}
                    onChange={()=>setAssignRoleId(r.id)}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{r.name}</div>
                    <div style={{fontSize:11,color:'var(--text-3)',marginTop:1}}>
                      {(r.permissions||[]).length} permissions · Built-in
                    </div>
                  </div>
                  {assignRoleId===r.id && <Check size={16} color="#1A5F7A"/>}
                </label>
              ))}
            </div>

            <button className="btn btn-primary"
              style={{width:'100%',justifyContent:'center'}}
              onClick={()=>setConfirm({
                message:`Assign "${roles.find(r=>r.id===assignRoleId)?.name}" to ${assignTarget.name}?`,
                detail:'This will update what screens and actions this person can access immediately after their next login.',
                onConfirm: handleAssign,
              })}
              disabled={loading||!assignRoleId}>
              {loading?'Assigning...':'Assign Role'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

