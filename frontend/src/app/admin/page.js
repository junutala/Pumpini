'use client';
import { useState, useEffect } from 'react';
import { Users, Building2, Globe, TrendingUp, Plus, X, Shield, Layers, ToggleLeft, ToggleRight,
         LogOut, Edit2, Trash2, Key, UserPlus, CheckCircle, Eye, EyeOff,
         Calendar, IndianRupee } from 'lucide-react';
import { INDIAN_STATES, getCities } from '../../lib/india';

const fmt    = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtAmt = n => '₹' + Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});

const adminFetch = (url, opts={}) => {
  const token = localStorage.getItem('admin_token');
  return fetch(`/api/superadmin${url}`, {
    ...opts,
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(opts.headers||{})}
  }).then(r=>r.json());
};

// ── Login ─────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [form,setForm]   = useState({email:'',password:''});
  const [showPw,setShowPw] = useState(false);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault(); setLoading(true); setError('');
    const res = await fetch('/api/superadmin/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(form)
    }).then(r=>r.json());
    if(res.error){ setError(res.error); setLoading(false); return; }
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
          {error && <div style={{background:'#fee2e2',color:'#991b1b',padding:'10px 12px',borderRadius:8,fontSize:13,marginBottom:'1rem'}}>{error}</div>}
          <button style={{width:'100%',height:46,background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:700,cursor:'pointer'}}
            type="submit" disabled={loading}>{loading?'Logging in...':'Login'}</button>
        </form>
      </div>

      {/* Alert Definition Modal */}
      {modal?.type==='alertDef' && (
        <Modal title={form.id?'Edit Alert Definition':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required>
            <input style={inp} placeholder="e.g. Low Stock Warning"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <textarea style={{...inp,height:72,resize:'vertical'}}
              placeholder="When does this alert trigger?"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select type...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay',
                'nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',
            borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc',flexShrink:0}}>
              {form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div>
              <div style={{fontSize:12,color:'#555'}}>Alert will be sent to station owner's WhatsApp when triggered</div>
            </div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(form.id?`/alert-definitions/${form.id}`:`/alert-definitions`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Alert'}</button>
        </Modal>
      )}

      {/* Add Station User Modal */}
      {modal?.type==='stationUser' && (
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Ravi Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="user@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role" required>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))}
            disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {/* Edit Station User Modal */}
      {modal?.type==='editStationUser' && (
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (leave blank to keep)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))}
            disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:300,overflowY:'auto',padding:'1rem'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'1.75rem',width:'100%',
        maxWidth:wide?700:500,boxShadow:'0 20px 60px rgba(0,0,0,.3)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
          <span style={{fontWeight:700,fontSize:16}}>{title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',padding:4}}><X size={18}/></button>
        </div>
        {children}
      </div>

      {/* Alert Definition Modal */}
      {modal?.type==='alertDef' && (
        <Modal title={form.id?'Edit Alert Definition':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required>
            <input style={inp} placeholder="e.g. Low Stock Warning"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <textarea style={{...inp,height:72,resize:'vertical'}}
              placeholder="When does this alert trigger?"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select type...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay',
                'nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',
            borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc',flexShrink:0}}>
              {form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div>
              <div style={{fontSize:12,color:'#555'}}>Alert will be sent to station owner's WhatsApp when triggered</div>
            </div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(form.id?`/alert-definitions/${form.id}`:`/alert-definitions`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Alert'}</button>
        </Modal>
      )}

      {/* Add Station User Modal */}
      {modal?.type==='stationUser' && (
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Ravi Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="user@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role" required>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))}
            disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {/* Edit Station User Modal */}
      {modal?.type==='editStationUser' && (
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (leave blank to keep)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))}
            disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

    </div>
  );
}

const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #ddd',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit'};
const btn = (color='#FF6B00',text='#fff') => ({padding:'0 14px',height:34,background:color,color:text,border:'none',borderRadius:7,cursor:'pointer',fontSize:13,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5});

function Field({label,children,required}){
  return (
    <div style={{marginBottom:'0.85rem'}}>
      <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4,color:'#333'}}>
        {label}{required&&<span style={{color:'#e07b0c',marginLeft:2}}>*</span>}
      </label>
      {children}

      {/* Alert Definition Modal */}
      {modal?.type==='alertDef' && (
        <Modal title={form.id?'Edit Alert Definition':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required>
            <input style={inp} placeholder="e.g. Low Stock Warning"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <textarea style={{...inp,height:72,resize:'vertical'}}
              placeholder="When does this alert trigger?"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select type...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay',
                'nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',
            borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc',flexShrink:0}}>
              {form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div>
              <div style={{fontSize:12,color:'#555'}}>Alert will be sent to station owner's WhatsApp when triggered</div>
            </div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(form.id?`/alert-definitions/${form.id}`:`/alert-definitions`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Alert'}</button>
        </Modal>
      )}

      {/* Add Station User Modal */}
      {modal?.type==='stationUser' && (
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Ravi Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="user@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role" required>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))}
            disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {/* Edit Station User Modal */}
      {modal?.type==='editStationUser' && (
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (leave blank to keep)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))}
            disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

    </div>
  );
}

function PwField({value,onChange,placeholder}){
  const [show,setShow] = useState(false);
  return (
    <div style={{display:'flex',border:'1.5px solid #ddd',borderRadius:8,overflow:'hidden'}}>
      <input style={{flex:1,padding:'9px 11px',border:'none',fontSize:14,outline:'none'}}
        type={show?'text':'password'} placeholder={placeholder||'Min 8 chars'}
        value={value||''} onChange={e=>onChange(e.target.value)}/>
      <button type="button" onClick={()=>setShow(p=>!p)}
        style={{background:'none',border:'none',cursor:'pointer',padding:'0 12px',color:'#aaa'}}>
        {show?<EyeOff size={15}/>:<Eye size={15}/>}
      </button>

      {/* Alert Definition Modal */}
      {modal?.type==='alertDef' && (
        <Modal title={form.id?'Edit Alert Definition':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required>
            <input style={inp} placeholder="e.g. Low Stock Warning"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <textarea style={{...inp,height:72,resize:'vertical'}}
              placeholder="When does this alert trigger?"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select type...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay',
                'nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',
            borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc',flexShrink:0}}>
              {form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div>
              <div style={{fontSize:12,color:'#555'}}>Alert will be sent to station owner's WhatsApp when triggered</div>
            </div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(form.id?`/alert-definitions/${form.id}`:`/alert-definitions`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Alert'}</button>
        </Modal>
      )}

      {/* Add Station User Modal */}
      {modal?.type==='stationUser' && (
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Ravi Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="user@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role" required>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))}
            disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {/* Edit Station User Modal */}
      {modal?.type==='editStationUser' && (
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (leave blank to keep)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))}
            disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

    </div>
  );
}

const STATUS_COLORS = {
  active:    ['#dcfce7','#15803d'],
  suspended: ['#fef9c3','#854d0e'],
  cancelled: ['#fee2e2','#991b1b'],
};
const PLAN_COLORS = {
  pro:        ['#dbeafe','#1d4ed8'],
  enterprise: ['#ede9fe','#5b21b6'],
};

function SubBadge({plan,status}){
  const [pb,pt] = PLAN_COLORS[plan]||['#f3f4f6','#374151'];
  const [sb,st] = STATUS_COLORS[status]||['#f3f4f6','#374151'];
  return (
    <div style={{display:'flex',gap:4}}>
      {plan && <span style={{padding:'2px 7px',borderRadius:99,fontSize:11,fontWeight:600,background:pb,color:pt}}>{plan?.toUpperCase()}</span>}
      {status && <span style={{padding:'2px 7px',borderRadius:99,fontSize:11,fontWeight:600,background:sb,color:st}}>{status}</span>}

      {/* Alert Definition Modal */}
      {modal?.type==='alertDef' && (
        <Modal title={form.id?'Edit Alert Definition':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required>
            <input style={inp} placeholder="e.g. Low Stock Warning"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <textarea style={{...inp,height:72,resize:'vertical'}}
              placeholder="When does this alert trigger?"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select type...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay',
                'nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',
            borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc',flexShrink:0}}>
              {form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div>
              <div style={{fontSize:12,color:'#555'}}>Alert will be sent to station owner's WhatsApp when triggered</div>
            </div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(form.id?`/alert-definitions/${form.id}`:`/alert-definitions`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Alert'}</button>
        </Modal>
      )}

      {/* Add Station User Modal */}
      {modal?.type==='stationUser' && (
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Ravi Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="user@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role" required>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))}
            disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {/* Edit Station User Modal */}
      {modal?.type==='editStationUser' && (
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (leave blank to keep)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))}
            disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

    </div>
  );
}

// ── Main Admin ────────────────────────────────────────────
export default function AdminPage() {
  const [admin,setAdmin]       = useState(null);
  const [tab,setTab]           = useState('dashboard');
  const [stats,setStats]       = useState(null);
  const [groups,setGroups]     = useState([]);
  const [owners,setOwners]     = useState([]);
  const [stations,setStations] = useState([]);
  const [stationSubs,setStationSubs] = useState({});
  const [plans,setPlans]           = useState([]);
  const [alertDefs,setAlertDefs]   = useState([]);
  const [selStation,setSelStation] = useState('');
  const [stationUsers,setStationUsers] = useState([]); // {stationId: [subs]}
  const [groupMembers,setGroupMembers] = useState({});
  const [groupStations,setGroupStations] = useState({});
  const [modal,setModal]       = useState(null);
  const [form,setForm]         = useState({});
  const [loading,setLoading]   = useState(false);
  const [toast,setToast]       = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  useEffect(()=>{
    const token = localStorage.getItem('admin_token');
    if(!token) return;
    try {
      const p = JSON.parse(atob(token.split('.')[1]));
      if(p.isSuperAdmin && p.exp > Date.now()/1000) setAdmin(p);
      else localStorage.removeItem('admin_token');
    } catch{ localStorage.removeItem('admin_token'); }
  },[]);

  const reload = async() => {
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
  };

  const loadStationUsers = async(sid) => {
    if (!sid) return;
    const res = await adminFetch(`/station-users/${sid}`);
    setStationUsers(Array.isArray(res)?res:[]);
  };

  useEffect(()=>{ if(admin) reload(); },[admin]);

  const loadGroupMembers = async(gid) => {
    const res = await adminFetch(`/groups/${gid}/members-list`);
    setGroupMembers(p=>({...p,[gid]:Array.isArray(res)?res:[]}));
  };

  const loadGroupStations = async(gid) => {
    const res = await adminFetch(`/groups/${gid}/stations`);
    setGroupStations(p=>({...p,[gid]:Array.isArray(res)?res:[]}));
  };

  const loadStationSubs = async(sid) => {
    const res = await adminFetch(`/station-subscriptions/${sid}`);
    setStationSubs(p=>({...p,[sid]:Array.isArray(res)?res:[]}));
  };

  if (typeof window === 'undefined') return null;
  if(!admin) return <LoginScreen onLogin={a=>setAdmin(a)}/>;

  const openModal = (type, data={}) => { setForm({...data}); setModal({type,data}); };
  const closeModal = () => { setModal(null); setForm({}); };

  const save = async(url, method='POST') => {
    setLoading(true);
    const res = await adminFetch(url,{method,body:JSON.stringify(form)});
    setLoading(false);
    if(res.error){ alert(res.error); return false; }
    closeModal(); reload(); showToast('Saved!');
    return true;
  };

  const resetPassword = async(userId) => {
    const password = prompt('Enter new password (min 8 chars):');
    if(!password||password.length<8){ alert('Password too short'); return; }
    await adminFetch(`/owners/${userId}`,{method:'PATCH',body:JSON.stringify({password})});
    showToast('Password reset!');
  };

  const deactivate = async(url,label) => {
    if(!confirm(`Deactivate ${label}?`)) return;
    await adminFetch(url,{method:'DELETE'});
    reload(); showToast('Deactivated.');
  };

  const TABS = [
    {id:'dashboard',label:'Platform Dashboard',icon:<TrendingUp size={14}/>},
    {id:'groups',   label:'Owner Groups',       icon:<Globe size={14}/>},
    {id:'owners',   label:'Owners',             icon:<Users size={14}/>},
    {id:'stations', label:'Petrol Bunks',        icon:<Building2 size={14}/>},
    {id:'plans',    label:'Plans',              icon:<Layers size={14}/>},
    {id:'alertdefs',label:'Alert Definitions',  icon:<Bell size={14}/>},
    {id:'stationusers',label:'Users & Roles',   icon:<UserPlus size={14}/>},
  ];

  const formCities = getCities(form.state||'');
  const todayIST = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

  return (
    <div style={{display:'flex',minHeight:'100dvh',fontFamily:'DM Sans,system-ui,sans-serif',background:'#F4F7FA',fontSize:14}}>

      {toast && (
        <div style={{position:'fixed',top:20,right:20,background:'#16a34a',color:'#fff',
          padding:'10px 18px',borderRadius:10,zIndex:999,display:'flex',alignItems:'center',
          gap:8,boxShadow:'0 4px 20px rgba(0,0,0,.2)'}}>
          <CheckCircle size={16}/>{toast}
        </div>
      )}

      {/* Sidebar */}
      <div style={{width:220,background:'#0F1923',display:'flex',flexDirection:'column',
        position:'sticky',top:0,height:'100dvh',flexShrink:0}}>
        <div style={{padding:'1.25rem 1rem 1rem',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
          <div style={{fontSize:22,fontWeight:900}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
          </div>
          <div style={{fontSize:11,color:'rgba(255,255,255,.35)',marginTop:2,letterSpacing:'.05em'}}>ADMIN CONSOLE</div>
        </div>
        <nav style={{flex:1,padding:'0.5rem 0'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              width:'100%',display:'flex',alignItems:'center',gap:10,
              padding:'10px 16px',background:tab===t.id?'rgba(255,107,0,.15)':'none',
              border:'none',cursor:'pointer',
              color:tab===t.id?'#FF6B00':'rgba(255,255,255,.55)',
              fontSize:13,fontWeight:tab===t.id?600:400,textAlign:'left',
              borderLeft:tab===t.id?'3px solid #FF6B00':'3px solid transparent',
            }}>
              {t.icon}{t.label}
            </button>
          ))}
        </nav>
        <div style={{padding:'1rem',borderTop:'1px solid rgba(255,255,255,.08)'}}>
          <div style={{fontSize:12,color:'rgba(255,255,255,.5)',marginBottom:8}}>{admin.name}</div>
          <button style={{background:'rgba(255,255,255,.08)',border:'none',color:'rgba(255,255,255,.6)',
            borderRadius:7,padding:'7px 12px',cursor:'pointer',fontSize:12,width:'100%',
            display:'flex',alignItems:'center',gap:6}}
            onClick={()=>{localStorage.removeItem('admin_token');setAdmin(null);}}>
            <LogOut size={13}/>Logout
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{flex:1,padding:'2rem',overflow:'auto',minWidth:0}}>

        {/* ── Platform Dashboard ── */}
        {tab==='dashboard' && (
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>Platform Dashboard</h1>

            {/* KPI Cards — 6 cards */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem',marginBottom:'2rem'}}>
              {[
                ['Owner Groups',  stats?.total_groups||0,    '#FF6B00', null],
                ['Owners',        stats?.total_owners||0,    '#9333ea', null],
                ['Petrol Bunks',  stats?.total_stations||0,  '#1A5F7A', null],
                ['Active Users',  stats?.total_users||0,     '#16a34a', null],
                ["Today's Sales", fmtAmt(stats?.today_sales||0), '#dc2626', null],
                ['MTD Sales',     fmtAmt(stats?.mtd_sales||0),   '#0891b2', 'Running month'],
              ].map(([l,v,c,sub])=>(
                <div key={l} style={{background:'#fff',borderRadius:12,padding:'1.25rem',
                  border:'1px solid #e5e3de',borderTop:`3px solid ${c}`}}>
                  <div style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{l}</div>
                  <div style={{fontSize:'1.75rem',fontWeight:800,color:c}}>{v}</div>
                  {sub && <div style={{fontSize:11,color:'#aaa',marginTop:4}}>{sub}</div>}
                </div>
              ))}
            </div>

            {/* Quick summary table */}
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',
                display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Recent Petrol Bunks</span>
                <button style={btn()} onClick={()=>openModal('station')}><Plus size={14}/>New Bunk</button>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Station','City','Oil Co.','Plan','Status'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',
                      fontWeight:600,fontSize:11,textTransform:'uppercase',
                      borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stations.slice(0,8).map(s=>(
                    <tr key={s.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{s.name}</td>
                      <td style={{padding:'11px 14px'}}>{s.city||'—'}</td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:'#dbeafe',color:'#1d4ed8'}}>
                          {s.oil_company||'—'}
                        </span>
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                          background:(PLAN_COLORS[s.plan]||['#f3f4f6'])[0],
                          color:(PLAN_COLORS[s.plan]||['','#374151'])[1]}}>
                          {s.plan?.toUpperCase()||'—'}
                        </span>
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                          background:(STATUS_COLORS[s.sub_status]||['#f3f4f6'])[0],
                          color:(STATUS_COLORS[s.sub_status]||['','#374151'])[1]}}>
                          {s.sub_status||'—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Owner Groups ── */}
        {tab==='groups' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Owner Groups</h1>
              <button style={btn()} onClick={()=>openModal('group')}><Plus size={15}/>New Group</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))',gap:'1rem'}}>
              {groups.map(g=>(
                <div key={g.id} style={{background:'#fff',borderRadius:12,padding:'1.5rem',
                  border:'1px solid #e5e3de',borderTop:`3px solid ${g.is_active?'#FF6B00':'#ccc'}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.75rem'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:15}}>{g.name}</div>
                      <div style={{fontSize:12,color:'#888',marginTop:2}}>{g.description||'No description'}</div>
                    </div>
                  </div>

                  <div style={{fontSize:12,color:'#555',marginBottom:'0.5rem',fontWeight:600}}>
                    👥 {g.owner_count} owners · ⛽ {g.station_count} bunks
                  </div>

                  {/* Owners sub-grid */}
                  <div style={{background:'#f8f7f5',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.5rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase',letterSpacing:'.05em'}}>Owners</span>
                      <button style={{...btn('#f0fff4','#15803d'),height:24,padding:'0 8px',fontSize:11}}
                        onClick={()=>openModal('addMember',{group_id:g.id,group_name:g.name})}>
                        <Plus size={11}/>Add
                      </button>
                    </div>
                    {groupMembers[g.id] ? (
                      groupMembers[g.id].length===0
                        ? <div style={{color:'#aaa',fontSize:11,padding:'4px 0'}}>No owners yet</div>
                        : groupMembers[g.id].map(m=>(
                          <div key={m.user_id} style={{display:'flex',justifyContent:'space-between',
                            alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #ece9e4'}}>
                            <div>
                              <span style={{fontWeight:600}}>{m.owner_name}</span>
                              <span style={{color:'#888',marginLeft:4,fontSize:11}}>({m.role})</span>
                            </div>
                            <button style={{fontSize:10,padding:'1px 6px',background:'#fee2e2',
                              border:'none',borderRadius:4,cursor:'pointer',color:'#991b1b'}}
                              onClick={()=>adminFetch(`/groups/${g.id}/members/${m.user_id}`,{method:'DELETE'}).then(()=>{ loadGroupMembers(g.id); reload(); })}>
                              Remove
                            </button>
                          </div>
                        ))
                    ) : (
                      <button style={{fontSize:11,color:'#1A5F7A',background:'none',border:'none',cursor:'pointer',padding:'2px 0'}}
                        onClick={()=>loadGroupMembers(g.id)}>
                        Click to view owners
                      </button>
                    )}
                  </div>

                  {/* Petrol bunks sub-grid */}
                  <div style={{background:'#f0f9ff',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase',letterSpacing:'.05em'}}>Petrol Bunks</span>
                    </div>
                    {groupStations[g.id] ? (
                      groupStations[g.id].length===0
                        ? <div style={{color:'#aaa',fontSize:11,padding:'4px 0'}}>No bunks in this group</div>
                        : groupStations[g.id].map(s=>(
                          <div key={s.id} style={{display:'flex',justifyContent:'space-between',
                            alignItems:'center',fontSize:12,padding:'3px 0',borderBottom:'1px solid #dbeafe'}}>
                            <div>
                              <span style={{fontWeight:600}}>{s.name}</span>
                              <span style={{color:'#888',marginLeft:4,fontSize:11}}>{s.city}</span>
                            </div>
                            <SubBadge plan={s.plan} status={s.sub_status}/>
                          </div>
                        ))
                    ) : (
                      <button style={{fontSize:11,color:'#1A5F7A',background:'none',border:'none',cursor:'pointer',padding:'2px 0'}}
                        onClick={()=>loadGroupStations(g.id)}>
                        Click to view bunks
                      </button>
                    )}
                  </div>

                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('group',{id:g.id,name:g.name,description:g.description})}><Edit2 size={12}/>Edit</button>
                    <button style={btn('#fee2e2','#991b1b')} onClick={()=>deactivate(`/groups/${g.id}`,'this group')}><Trash2 size={12}/>Deactivate</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Owners ── */}
        {tab==='owners' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Owners</h1>
              <button style={btn()} onClick={()=>openModal('owner')}><Plus size={15}/>New Owner</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Name','Mobile','Email','Groups','Bunks','Status','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',
                      fontWeight:600,fontSize:11,textTransform:'uppercase',
                      borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {owners.map(o=>(
                    <tr key={o.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{o.name}</td>
                      <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:13}}>
                        {(o.phone||'').replace('+91','')}
                      </td>
                      <td style={{padding:'11px 14px',color:'#666',fontSize:12}}>{o.email||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12}}>{(o.groups||[]).filter(Boolean).join(', ')||'—'}</td>
                      <td style={{padding:'11px 14px'}}>{o.station_count}</td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                          background:o.is_active?'#dcfce7':'#fee2e2',
                          color:o.is_active?'#15803d':'#991b1b'}}>
                          {o.is_active?'Active':'Inactive'}
                        </span>
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editOwner',{
                            id:o.id,name:o.name,email:o.email,
                            phone:(o.phone||'').replace('+91',''),
                            is_active:o.is_active
                          })}><Edit2 size={12}/>Edit</button>
                          <button style={btn('#fff7ed','#9a3412')} onClick={()=>resetPassword(o.id)}><Key size={12}/>Reset PW</button>
                          <button style={btn('#fee2e2','#991b1b')} onClick={()=>adminFetch(`/owners/${o.id}`,{method:'PATCH',body:JSON.stringify({is_active:!o.is_active})}).then(reload)}>
                            {o.is_active?'Deactivate':'Activate'}
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

        {/* ── Petrol Bunks ── */}
        {tab==='stations' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Petrol Bunks</h1>
              <button style={btn()} onClick={()=>openModal('station')}><Plus size={15}/>New Petrol Bunk</button>
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Station','City','Oil Co.','Owner','Plan / Status','Start Date','End Date','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',
                      fontWeight:600,fontSize:11,textTransform:'uppercase',
                      borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stations.map(s=>(
                    <tr key={s.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{s.name}</td>
                      <td style={{padding:'11px 14px'}}>{s.city||'—'}</td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:'#dbeafe',color:'#1d4ed8'}}>
                          {s.oil_company||'—'}
                        </span>
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'#555'}}>{(s.owners||[]).filter(Boolean).join(', ')||'—'}</td>
                      <td style={{padding:'11px 14px'}}>
                        <SubBadge plan={s.plan} status={s.sub_status}/>
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,fontFamily:'monospace'}}>{s.start_date||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12,fontFamily:'monospace'}}>{s.end_date||<span style={{color:'#16a34a',fontWeight:600}}>Active</span>}</td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',gap:5}}>
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editStation',{
                            id:s.id, name:s.name, address:s.address,
                            city:s.city, state:s.state,
                            gst_number:s.gst_number, oil_company:s.oil_company,
                            owner_id: s.owner_ids?.[0]||'',
                          })}><Edit2 size={12}/>Edit</button>
                          <button style={btn('#fff7ed','#9a3412')} onClick={()=>{
                            setForm({station_id:s.id, plan:s.plan||'pro', status:s.sub_status||'active',
                              start_date:s.start_date||todayIST(), end_date:s.end_date||''});
                            setModal({type:'editSub',data:s});
                          }}><Calendar size={12}/>Plan</button>
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
        {tab==='plans' && (
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>Plans</h1>
            <div style={{background:'#f0f9ff',borderRadius:10,padding:'0.75rem 1rem',marginBottom:'1.5rem',fontSize:13,color:'#1A5F7A',border:'1px solid #bae6fd'}}>
              ℹ️ Two plans only: <strong>PRO</strong> and <strong>ENTERPRISE</strong>. Set price and features for each. These flow down to petrol bunks and their users.
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem'}}>
              {['pro','enterprise'].map(planName => {
                const plan = plans.find(p=>p.name===planName);
                const features = plan?.features ? (typeof plan.features==='string'?JSON.parse(plan.features):plan.features) : [];
                const [pb,pt] = PLAN_COLORS[planName]||['#f3f4f6','#374151'];
                return (
                  <div key={planName} style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
                    <div style={{background:pb,padding:'1rem 1.25rem',borderBottom:`2px solid ${pt}`}}>
                      <div style={{fontSize:18,fontWeight:800,color:pt}}>{planName.toUpperCase()}</div>
                      <div style={{fontSize:13,color:pt,opacity:.8,marginTop:2}}>
                        {plan ? `₹${Number(plan.price_per_month||0).toLocaleString('en-IN')}/month` : 'Not configured'}
                      </div>
                    </div>
                    <div style={{padding:'1rem 1.25rem'}}>
                      <div style={{marginBottom:'0.75rem'}}>
                        <label style={{fontSize:12,fontWeight:600,color:'#555',display:'block',marginBottom:4}}>Price per Month (₹)</label>
                        <input style={{...inp,width:'100%'}} type="number"
                          placeholder="e.g. 999"
                          defaultValue={plan?.price_per_month||''}
                          id={`price-${planName}`}/>
                      </div>
                      <div style={{marginBottom:'0.75rem'}}>
                        <div style={{fontSize:12,fontWeight:600,color:'#555',marginBottom:6}}>Features</div>
                        <div style={{maxHeight:200,overflowY:'auto'}}>
                          {features.map((feat,i)=>(
                            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                              padding:'5px 8px',background:'#f8f7f5',borderRadius:6,marginBottom:4,fontSize:13}}>
                              <span>{feat}</span>
                              <button style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',padding:2}}
                                onClick={async()=>{
                                  const newFeats = features.filter((_,fi)=>fi!==i);
                                  await adminFetch(plan?`/plans/${plan.id}`:`/plans`,{
                                    method:plan?'PATCH':'POST',
                                    body:JSON.stringify({name:planName,features:newFeats,price_per_month:plan?.price_per_month||0})
                                  });
                                  reload();
                                }}><X size={12}/></button>
                            </div>
                          ))}
                        </div>
                        <div style={{display:'flex',gap:6,marginTop:6}}>
                          <input style={{...inp,flex:1}} placeholder="Add feature..." id={`feat-${planName}`}/>
                          <button style={btn()} onClick={async()=>{
                            const el = document.getElementById(`feat-${planName}`);
                            if(!el.value.trim()) return;
                            const newFeats = [...features, el.value.trim()];
                            await adminFetch(plan?`/plans/${plan.id}`:`/plans`,{
                              method:plan?'PATCH':'POST',
                              body:JSON.stringify({name:planName,features:newFeats,price_per_month:plan?.price_per_month||0})
                            });
                            el.value=''; reload();
                          }}><Plus size={13}/></button>
                        </div>
                      </div>
                      <button style={{...btn(),width:'100%',justifyContent:'center'}}
                        onClick={async()=>{
                          const price = document.getElementById(`price-${planName}`).value;
                          await adminFetch(plan?`/plans/${plan.id}`:`/plans`,{
                            method:plan?'PATCH':'POST',
                            body:JSON.stringify({name:planName,price_per_month:parseFloat(price)||0,features})
                          });
                          reload(); showToast('Plan saved!');
                        }}>Save {planName.toUpperCase()} Plan</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Alert Definitions ── */}
        {tab==='alertdefs' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h1 style={{fontSize:'1.4rem',fontWeight:800}}>Alert Definitions</h1>
              <button style={btn()} onClick={()=>openModal('alertDef')}><Plus size={15}/>New Alert</button>
            </div>
            <div style={{background:'#f0f9ff',borderRadius:10,padding:'0.75rem 1rem',marginBottom:'1.5rem',fontSize:13,color:'#1A5F7A',border:'1px solid #bae6fd'}}>
              ℹ️ Alerts defined here appear in the dealer app's Alerts page. If WhatsApp is enabled, they are also sent to the station owner's WhatsApp.
            </div>
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f8f7f5'}}>
                  {['Alert Name','Description','Type','Severity','WhatsApp','Active','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',
                      fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {alertDefs.length===0 && (
                    <tr><td colSpan={7} style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>No alert definitions yet. Create one above.</td></tr>
                  )}
                  {alertDefs.map(a=>(
                    <tr key={a.id} style={{borderBottom:'1px solid #f0f0f0',opacity:a.is_active?1:0.6}}>
                      <td style={{padding:'11px 14px',fontWeight:600}}>{a.name}</td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'#666',maxWidth:200}}>{a.description||'—'}</td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,background:'#f3f4f6',fontFamily:'monospace'}}>{a.alert_type}</span>
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                          background:a.severity==='critical'?'#fee2e2':a.severity==='warning'?'#fef9c3':'#dbeafe',
                          color:a.severity==='critical'?'#991b1b':a.severity==='warning'?'#854d0e':'#1d4ed8'}}>
                          {a.severity}
                        </span>
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
                          <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('alertDef',{
                            id:a.id,name:a.name,description:a.description,alert_type:a.alert_type,
                            severity:a.severity,whatsapp_enabled:a.whatsapp_enabled,is_active:a.is_active
                          })}><Edit2 size={12}/>Edit</button>
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

        {/* ── Users & Roles (Station-wise) ── */}
        {tab==='stationusers' && (
          <div>
            <h1 style={{fontSize:'1.4rem',fontWeight:800,marginBottom:'1.5rem'}}>Users & Roles</h1>
            <div style={{display:'flex',gap:12,alignItems:'flex-end',marginBottom:'1.5rem',flexWrap:'wrap'}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4,color:'#555'}}>Select Petrol Bunk</label>
                <select style={{...inp,width:260}} value={selStation}
                  onChange={e=>{ setSelStation(e.target.value); loadStationUsers(e.target.value); }}>
                  <option value="">Select a petrol bunk...</option>
                  {stations.map(s=><option key={s.id} value={s.id}>{s.name} — {s.city||''}</option>)}
                </select>
              </div>
              {selStation && (
                <button style={btn()} onClick={()=>openModal('stationUser',{station_id:selStation})}>
                  <UserPlus size={14}/>Add User
                </button>
              )}
            </div>

            {!selStation && (
              <div style={{background:'#fff',borderRadius:12,border:'1px dashed #ddd',padding:'3rem',textAlign:'center',color:'#aaa'}}>
                Select a petrol bunk above to view and manage its users
              </div>
            )}

            {selStation && (
              <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'#f8f7f5'}}>
                    {['Name','Mobile','Email','Role','Status','Actions'].map(h=>(
                      <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',
                        fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {stationUsers.length===0 && (
                      <tr><td colSpan={6} style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>No users for this station yet</td></tr>
                    )}
                    {stationUsers.map(u=>(
                      <tr key={u.id} style={{borderBottom:'1px solid #f0f0f0',opacity:u.is_active?1:0.6}}>
                        <td style={{padding:'11px 14px',fontWeight:600}}>{u.name}</td>
                        <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:13}}>{(u.phone||'').replace('+91','')}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'#666'}}>{u.email||'—'}</td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,background:'#ede9fe',color:'#5b21b6',textTransform:'capitalize'}}>{u.role}</span>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                            background:u.is_active?'#dcfce7':'#fee2e2',color:u.is_active?'#15803d':'#991b1b'}}>
                            {u.is_active?'Active':'Inactive'}
                          </span>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{display:'flex',gap:5}}>
                            <button style={btn('#f0f9ff','#1A5F7A')} onClick={()=>openModal('editStationUser',{
                              id:u.id,name:u.name,email:u.email,role:u.role,
                              phone:(u.phone||'').replace('+91',''),is_active:u.is_active
                            })}><Edit2 size={12}/>Edit</button>
                            <button style={btn('#fff7ed','#9a3412')} onClick={()=>resetPassword(u.id)}><Key size={12}/>Reset PW</button>
                            <button style={btn('#fee2e2','#991b1b')} onClick={()=>adminFetch(`/station-users/${u.id}`,{method:'DELETE'}).then(()=>loadStationUsers(selStation))}>
                              Deactivate
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Modals ── */}

      {/* New/Edit Group */}
      {modal?.type==='group' && (
        <Modal title={form.id?'Edit Owner Group':'New Owner Group'} onClose={closeModal}>
          <Field label="Group Name" required>
            <input style={inp} placeholder="e.g. Venkataraman Enterprises"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <input style={inp} placeholder="Optional"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14,marginTop:4}}
            onClick={()=>save(form.id?`/groups/${form.id}`:`/groups`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Group'}</button>
        </Modal>
      )}

      {/* Add owner to group */}
      {modal?.type==='addMember' && (
        <Modal title={`Add Owner to: ${modal.data.group_name}`} onClose={closeModal}>
          <Field label="Select Owner" required>
            <select style={inp} value={form.user_id||''}
              onChange={e=>f('user_id',e.target.value)}>
              <option value="">Select owner...</option>
              {owners.map(o=>(
                <option key={o.id} value={o.id}>{o.name} — {(o.phone||'').replace('+91','')}</option>
              ))}
            </select>
          </Field>
          <Field label="Role in Group">
            <select style={inp} value={form.role||'member'} onChange={e=>f('role',e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>{ f('group_id',modal.data.group_id); save(`/groups/${modal.data.group_id}/members`).then(()=>loadGroupMembers(modal.data.group_id)); }}
            disabled={loading}>{loading?'Adding...':'Add to Group'}</button>
        </Modal>
      )}

      {/* New Owner */}
      {modal?.type==='owner' && (
        <Modal title="New Owner" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Rajesh Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="owner@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <Field label="Assign to Group">
            <select style={inp} value={form.group_id||''} onChange={e=>f('group_id',e.target.value||null)}>
              <option value="">No group yet</option>
              {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/owners')} disabled={loading}>{loading?'Creating...':'Create Owner'}</button>
        </Modal>
      )}

      {/* Edit Owner — now includes mobile */}
      {modal?.type==='editOwner' && (
        <Modal title="Edit Owner" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="New Password (leave blank to keep current)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/owners/${form.id}`,'PATCH')} disabled={loading}>
            {loading?'Saving...':'Save Changes'}
          </button>
        </Modal>
      )}

      {/* New/Edit Station */}
      {(modal?.type==='station'||modal?.type==='editStation') && (
        <Modal title={modal.type==='editStation'?'Edit Petrol Bunk':'New Petrol Bunk'} onClose={closeModal}>
          <Field label="Station Name" required>
            <input style={inp} placeholder="e.g. Anna Salai HPCL"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="State" required>
              <select style={inp} value={form.state||''} onChange={e=>f('state',e.target.value)}>
                <option value="">Select state...</option>
                {INDIAN_STATES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City" required>
              <select style={inp} value={form.city||''} onChange={e=>f('city',e.target.value)} disabled={!form.state}>
                <option value="">Select city...</option>
                {formCities.map(c=><option key={c} value={c}>{c}</option>)}
                <option value="__other__">Other</option>
              </select>
              {form.city==='__other__' && (
                <input style={{...inp,marginTop:6}} placeholder="Enter city"
                  onChange={e=>f('city',e.target.value)}/>
              )}
            </Field>
          </div>
          <Field label="Address">
            <input style={inp} placeholder="Street address"
              value={form.address||''} onChange={e=>f('address',e.target.value)}/>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Oil Company">
              <select style={inp} value={form.oil_company||''} onChange={e=>f('oil_company',e.target.value)}>
                <option value="">Select...</option>
                {['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="GSTN">
              <input style={inp} placeholder="33ABCDE1234F1Z5"
                value={form.gst_number||''} onChange={e=>f('gst_number',e.target.value.toUpperCase())}/>
            </Field>
          </div>
          <Field label={modal.type==='editStation'?'Change Owner':'Assign Owner'}>
            <select style={inp} value={form.owner_id||''} onChange={e=>f('owner_id',e.target.value)}>
              <option value="">Select owner...</option>
              {owners.map(o=><option key={o.id} value={o.id}>{o.name} ({(o.phone||'').replace('+91','')})</option>)}
            </select>
          </Field>
          <Field label={modal.type==='editStation'?'Change Owner Group':'Assign to Owner Group'}>
            <select style={inp} value={form.owner_group_id||''} onChange={e=>f('owner_group_id',e.target.value)}>
              <option value="">Individual (no group)</option>
              {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          {/* Plan & subscription for new stations */}
          {modal.type==='station' && <>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Field label="Plan">
                <select style={inp} value={form.plan||'pro'} onChange={e=>f('plan',e.target.value)}>
                  <option value="pro">PRO</option>
                  <option value="enterprise">ENTERPRISE</option>
                </select>
              </Field>
              <Field label="Status">
                <select style={inp} value={form.sub_status||'active'} onChange={e=>f('sub_status',e.target.value)}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>
            <Field label="Start Date">
              <input style={inp} type="date" value={form.start_date||todayIST()} onChange={e=>f('start_date',e.target.value)}/>
            </Field>
          </>}
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14,marginTop:4}}
            onClick={()=>save(modal.type==='editStation'?`/stations/${form.id}`:`/stations`,modal.type==='editStation'?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':modal.type==='editStation'?'Save Changes':'Create Petrol Bunk'}</button>
        </Modal>
      )}

      {/* Edit Station Subscription */}
      {modal?.type==='editSub' && (
        <Modal title={`Subscription — ${modal.data.name}`} onClose={closeModal}>
          <div style={{background:'#f8f7f5',borderRadius:8,padding:'0.75rem',marginBottom:'1rem',fontSize:13}}>
            <div style={{fontWeight:600,marginBottom:4}}>Current Subscription</div>
            <SubBadge plan={form.plan} status={form.status}/>
            {form.start_date && <div style={{marginTop:4,color:'#666'}}>Started: {form.start_date}</div>}
          </div>

          <Field label="Plan">
            <select style={inp} value={form.plan||'pro'} onChange={e=>f('plan',e.target.value)}>
              <option value="pro">PRO</option>
              <option value="enterprise">ENTERPRISE</option>
            </select>
          </Field>

          <Field label="Status">
            <div style={{display:'flex',gap:8}}>
              {['active','suspended','cancelled'].map(s=>(
                <button key={s} type="button"
                  style={{...btn(form.status===s?
                    s==='active'?'#16a34a':s==='suspended'?'#ca8a04':'#dc2626'
                    :'#f3f4f6',
                    form.status===s?'#fff':'#374151'),
                    flex:1,justifyContent:'center',textTransform:'capitalize'}}
                  onClick={()=>f('status',s)}>
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="End Date (optional — setting this creates next subscription line automatically)">
            <input style={inp} type="date" value={form.end_date||''}
              min={form.start_date||todayIST()}
              onChange={e=>f('end_date',e.target.value||null)}/>
            {form.end_date && (
              <div style={{fontSize:11,color:'#9333ea',marginTop:4}}>
                ⚡ A new subscription line will auto-start on {new Date(new Date(form.end_date).getTime()+86400000).toLocaleDateString('en-IN')}
              </div>
            )}
          </Field>

          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={async()=>{
              setLoading(true);
              // Get existing subscription ID
              const subs = await adminFetch(`/station-subscriptions/${form.station_id}`);
              const activeSub = Array.isArray(subs) ? subs.find(s=>!s.end_date) : null;
              let res;
              if (activeSub) {
                res = await adminFetch(`/station-subscriptions/${activeSub.id}`,{
                  method:'PATCH',body:JSON.stringify({plan:form.plan,status:form.status,end_date:form.end_date||null})
                });
              } else {
                res = await adminFetch(`/station-subscriptions`,{
                  method:'POST',body:JSON.stringify({
                    station_id:form.station_id,plan:form.plan,status:form.status,
                    start_date:form.start_date||todayIST(),end_date:form.end_date||null
                  })
                });
              }
              setLoading(false);
              if(res.error){ alert(res.error); return; }
              closeModal(); reload(); showToast('Subscription updated!');
            }}
            disabled={loading}>{loading?'Saving...':'Save Subscription'}
          </button>
        </Modal>
      )}

      {/* Alert Definition Modal */}
      {modal?.type==='alertDef' && (
        <Modal title={form.id?'Edit Alert Definition':'New Alert Definition'} onClose={closeModal}>
          <Field label="Alert Name" required>
            <input style={inp} placeholder="e.g. Low Stock Warning"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Description">
            <textarea style={{...inp,height:72,resize:'vertical'}}
              placeholder="When does this alert trigger?"
              value={form.description||''} onChange={e=>f('description',e.target.value)}/>
          </Field>
          <Field label="Alert Type" required>
            <select style={inp} value={form.alert_type||''} onChange={e=>f('alert_type',e.target.value)}>
              <option value="">Select type...</option>
              {['low_stock','cash_variance','shift_variance','credit_limit','delivery_delay',
                'nozzle_idle','attendance_missing','dipstick_overdue','custom'].map(t=>(
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Field label="Severity">
              <select style={inp} value={form.severity||'warning'} onChange={e=>f('severity',e.target.value)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Active">
              <select style={inp} value={form.is_active===false?'false':'true'} onChange={e=>f('is_active',e.target.value==='true')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'0.75rem',background:'#f0fdf4',
            borderRadius:8,border:'1px solid #bbf7d0',marginBottom:'1rem',cursor:'pointer'}}
            onClick={()=>f('whatsapp_enabled',!form.whatsapp_enabled)}>
            <div style={{color:form.whatsapp_enabled?'#16a34a':'#ccc',flexShrink:0}}>
              {form.whatsapp_enabled?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'#15803d'}}>Send via WhatsApp</div>
              <div style={{fontSize:12,color:'#555'}}>Alert will be sent to station owner's WhatsApp when triggered</div>
            </div>
          </div>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(form.id?`/alert-definitions/${form.id}`:`/alert-definitions`,form.id?'PATCH':'POST')}
            disabled={loading}>{loading?'Saving...':form.id?'Save Changes':'Create Alert'}</button>
        </Modal>
      )}

      {/* Add Station User Modal */}
      {modal?.type==='stationUser' && (
        <Modal title="Add User to Station" onClose={closeModal}>
          <Field label="Full Name" required>
            <input style={inp} placeholder="Ravi Kumar"
              value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)" required>
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} placeholder="9876543210" maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" placeholder="user@example.com"
              value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role" required>
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Password">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Default: Welcome@123"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save('/station-users').then(()=>loadStationUsers(form.station_id))}
            disabled={loading}>{loading?'Adding...':'Add User'}</button>
        </Modal>
      )}

      {/* Edit Station User Modal */}
      {modal?.type==='editStationUser' && (
        <Modal title="Edit User" onClose={closeModal}>
          <Field label="Full Name">
            <input style={inp} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
          </Field>
          <Field label="Mobile Number (10 digits)">
            <div style={{display:'flex',gap:8}}>
              <span style={{background:'#f5f5f5',padding:'9px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:14,color:'#666'}}>+91</span>
              <input style={{...inp,flex:1}} maxLength={10}
                value={form.phone||''} onChange={e=>f('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
            </div>
          </Field>
          <Field label="Email">
            <input style={inp} type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
          </Field>
          <Field label="Role">
            <select style={inp} value={form.role||'attendant'} onChange={e=>f('role',e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="New Password (leave blank to keep)">
            <PwField value={form.password||''} onChange={v=>f('password',v)} placeholder="Leave blank to keep"/>
          </Field>
          <button style={{...btn(),width:'100%',justifyContent:'center',height:42,fontSize:14}}
            onClick={()=>save(`/station-users/${form.id}`,'PATCH').then(()=>loadStationUsers(selStation))}
            disabled={loading}>{loading?'Saving...':'Save Changes'}</button>
        </Modal>
      )}

    </div>
  );
}
