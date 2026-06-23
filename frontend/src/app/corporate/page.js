'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Edit2, Link2, AlertTriangle, Building2 } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { displayMobile } from '../../lib/india';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});

function DuplicateWarning({ warnings, onForce, onLink, t }) {
  if (!warnings?.length) return null;
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const isError = warnings.some(w=>w.level==='error');
  return (
    <div style={{background:isError?'#fee2e2':'#fef9c3',border:`1px solid ${isError?'#fca5a5':'#fde047'}`,borderRadius:8,padding:'0.75rem',marginBottom:'1rem'}}>
      <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
        <AlertTriangle size={16} color={isError?'#dc2626':'#ca8a04'} style={{flexShrink:0,marginTop:1}}/>
        <div style={{flex:1}}>
          {warnings.map((w,i)=>(
            <div key={i} style={{marginBottom:6}}>
              <div style={{fontWeight:600,fontSize:13,color:isError?'#991b1b':'#854d0e'}}>
                {w.type==='gstn'?tc('corp_page.dup_gstn','⚠ Same GSTN already exists in system'):tc('corp_page.dup_phone','⚠ Same phone number already used')}
              </div>
              {(w.matches||[]).map(m=>(
                <div key={m.id} style={{fontSize:12,color:'#666',marginTop:3,display:'flex',alignItems:'center',gap:8}}>
                  → <strong>{m.company_name}</strong> at {m.station_name}
                  <button style={{fontSize:11,padding:'2px 10px',background:'#dbeafe',border:'1px solid #93c5fd',borderRadius:4,cursor:'pointer'}}
                    onClick={()=>onLink(m)}>
                    {tc('corp_page.link_instead','Link to this instead')}
                  </button>
                </div>
              ))}
            </div>
          ))}
          {isError && (
            <button style={{marginTop:4,fontSize:12,padding:'4px 12px',background:'#fff',border:'1px solid #dc2626',color:'#dc2626',borderRadius:6,cursor:'pointer',fontWeight:600}}
              onClick={onForce}>
              {tc('corp_page.create_anyway','Create anyway (confirmed different company)')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CorporatePage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;
  const router = useRouter();
  if (typeof window === 'undefined') return null;

  const [corps,      setCorps]      = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [links,      setLinks]      = useState([]);
  const [drivers,    setDrivers]    = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [stations,   setStations]   = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [showDriver, setShowDriver] = useState(false);
  const [showLink,   setShowLink]   = useState(false);
  const [showMerge,  setShowMerge]  = useState(null);
  const [editCorp,   setEditCorp]   = useState(null);
  const [form,       setForm]       = useState({});
  const [driverForm, setDriverForm] = useState({});
  const [linkForm,   setLinkForm]   = useState({});
  const [warnings,   setWarnings]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [checkTimer, setCheckTimer] = useState(null);

  const f  = (k,v) => setForm(p=>({...p,[k]:v}));
  const fd = (k,v) => setDriverForm(p=>({...p,[k]:v}));
  const fl = (k,v) => setLinkForm(p=>({...p,[k]:v}));

  const [corpUsers, setCorpUsers] = useState([]);

  const load = useCallback(async() => {
    if (!stationId) return;
    const [c,dups,sts,cu] = await Promise.all([
      api.get('/corporate',{params:{station_id:stationId}}).catch(()=>[]),
      api.get('/corporate/duplicates').catch(()=>[]),
      api.get('/stations').catch(()=>[]),
      api.get(`/users?station_id=${stationId}&role=corporate`).catch(()=>[]),
    ]);
    setCorps(Array.isArray(c)?c:[]);
    setDuplicates(Array.isArray(dups)?dups:[]);
    setStations(Array.isArray(sts)?sts:[]);
    setCorpUsers(Array.isArray(cu)?cu:[]);
  },[stationId]);

  const loadDetail = async(corp) => {
    setSelected(corp);
    const [l,d] = await Promise.all([
      api.get(`/corporate/${corp.id}/links`).catch(()=>[]),
      api.get(`/corporate/${corp.id}/drivers`).catch(()=>[]),
    ]);
    setLinks(Array.isArray(l)?l:[]);
    setDrivers(Array.isArray(d)?d:[]);
  };

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ if(selected) loadDetail(selected); },[selected?.id]);
  useRefreshOnFocus(load);
  
  const triggerDupCheck = (gstn,phone) => {
    if(checkTimer) clearTimeout(checkTimer);
    const t = setTimeout(async() => {
      if(!gstn&&!phone){ setWarnings([]); return; }
      const res = await api.post('/corporate/check-duplicate',{
        gstn, phone, exclude_id:editCorp?.id||null
      }).catch(()=>({warnings:[]}));
      setWarnings(res.warnings||[]);
    },600);
    setCheckTimer(t);
  };

  const openAdd = () => {
    setEditCorp(null);
    setForm({payment_terms:30,credit_limit:'',station_id:stationId});
    setWarnings([]);
    setShowForm(true);
  };

  const openEdit = (corp) => {
    setEditCorp(corp);
    setForm({
      company_name:   corp.company_name,
      contact_person: corp.contact_person||'',
      contact_phone:  displayMobile(corp.contact_phone),
      email:          corp.email||'',
      gst_number:     corp.gst_number||corp.gstn||'',
      pan:            corp.pan||'',
      address:        corp.address||'',
    });
    setWarnings([]);
    setShowForm(true);
  };

  const saveCorp = async(e, forceCreate=false) => {
    e?.preventDefault(); setLoading(true);
    try {
      const payload = {
        ...form,
        gstn: form.gst_number,
        contact_phone: form.contact_phone ? `+91${form.contact_phone.replace(/\D/g,'').slice(-10)}` : null,
        force_create: forceCreate,
      };
      if(editCorp) await api.patch(`/corporate/${editCorp.id}`,payload);
      else         await api.post('/corporate',payload);
      setShowForm(false); setEditCorp(null); setForm({}); setWarnings([]);
      load();
    } catch(err) {
      if(err.warnings) setWarnings(err.warnings);
      else alert(err.error||'Failed');
    } finally { setLoading(false); }
  };

  const saveLink = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post(`/corporate/${selected.id}/links`,linkForm);
      setShowLink(false); setLinkForm({});
      loadDetail(selected);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const saveDriver = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload = { ...driverForm,
        phone: driverForm.phone ? `+91${driverForm.phone.replace(/\D/g,'').slice(-10)}` : null };
      await api.post(`/corporate/${selected.id}/drivers`,payload);
      setShowDriver(false); setDriverForm({});
      loadDetail(selected);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const handleMerge = async(masterId,dupId) => {
    if(!confirm(tc('corp_page.merge_confirm','Merge accounts? All transactions and drivers will move to the master. Cannot be undone.'))) return;
    await api.post('/corporate/merge',{master_id:masterId,duplicate_id:dupId});
    setShowMerge(null); load();
  };

  const dismissDup = async(id) => {
    await api.patch(`/corporate/duplicates/${id}/dismiss`); load();
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('corp_page.title','Credit Customers')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>{tc('corp_page.subtitle','Corporate accounts · independent limits per station')}</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={16}/>{tc('corp_page.add_customer','Add Credit Customer')}</button>
      </div>

      {/* Duplicate alerts */}
      {duplicates.length>0 && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'0.75rem 1rem',marginBottom:'1.5rem'}}>
          <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
            <AlertTriangle size={16} color="#ea580c"/>
            <span style={{fontWeight:600,fontSize:14,color:'#9a3412'}}>{duplicates.length} {tc('corp_page.dup_detected','potential duplicate(s) detected')}</span>
          </div>
          {duplicates.map(dup=>(
            <div key={dup.id} style={{display:'flex',gap:8,alignItems:'center',fontSize:13,padding:'6px 0',borderTop:'1px solid #fed7aa'}}>
              <div style={{flex:1}}>
                <strong>{dup.corp1_name}</strong>{' '}and{' '}<strong>{dup.corp2_name}</strong>
                {dup.match_type==='gstn' ? ` — ${tc('corp_page.same_gstn','same GSTN')}: ${dup.corp1_gstn}` : ` — ${tc('corp_page.same_phone','same phone')}: ${dup.corp1_phone}`}
              </div>
              <button className="btn btn-primary btn-sm" style={{background:'#ea580c',borderColor:'#ea580c'}}
                onClick={()=>setShowMerge(dup)}>{tc('corp_page.merge','Merge')}</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>dismissDup(dup.id)}>{tc('corp_page.dismiss','Dismiss')}</button>
            </div>
          ))}
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:selected?'340px 1fr':'1fr',gap:'1.5rem'}}>
        {/* List */}
        <div>
          {corps.length===0 && (
            <div className="card" style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>
              {tc('corp_page.no_customers','No credit customers for this station yet.')}
            </div>
          )}
          {corps.map(corp=>{
            const pct = corp.credit_limit>0 ? Math.round((corp.current_outstanding/corp.credit_limit)*100) : 0;
            return (
              <div key={corp.id} className="card" style={{marginBottom:'0.75rem',cursor:'pointer',
                borderLeft:`3px solid ${pct>80?'var(--danger)':pct>60?'var(--warning)':'var(--border)'}`,
                borderColor:selected?.id===corp.id?'var(--brand)':'var(--border)'}}
                onClick={()=>loadDetail(corp)}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:14}}>{corp.company_name}</div>
                    <div style={{fontSize:11,color:'var(--text-3)',marginTop:1}}>
                      {corp.contact_person && `${corp.contact_person} · `}{displayMobile(corp.contact_phone)}
                    </div>
                    {corp.gst_number && <div style={{fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>GSTN: {corp.gst_number}</div>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:10,color:'var(--text-3)'}}>{tc('corp_page.outstanding','Outstanding')}</div>
                    <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:14,
                      color:pct>80?'var(--danger)':pct>60?'var(--warning)':'var(--text-1)'}}>
                      ₹{fmt(corp.current_outstanding)}
                    </div>
                  </div>
                </div>
                <div className="tank-bar">
                  <div className="tank-bar-fill" style={{width:`${Math.min(100,pct)}%`,
                    background:pct>80?'var(--danger)':pct>60?'var(--warning)':'var(--brand)'}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-3)',marginTop:2}}>
                  <span>₹{fmt(corp.current_outstanding)} {tc('corp_page.used','used')}</span>
                  <span>{tc('corp_page.limit','Limit')}: ₹{fmt(corp.credit_limit)}</span>
                </div>
                <button className="btn btn-secondary btn-sm" style={{marginTop:8}}
                  onClick={e=>{e.stopPropagation();openEdit(corp);}}>
                  <Edit2 size={11}/>{tc('common.edit','Edit')}
                </button>
              </div>
            );
          })}
        </div>

        {/* Detail */}
        {selected && (
          <div>
            <div className="card" style={{marginBottom:'1rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1rem'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:16}}>{selected.company_name}</div>
                  {selected.gst_number && <div style={{fontSize:12,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>GSTN: {selected.gst_number}</div>}
                  <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{selected.contact_person} · {displayMobile(selected.contact_phone)}</div>
                </div>
                <button style={{background:'none',border:'none',cursor:'pointer'}} onClick={()=>setSelected(null)}><X size={18}/></button>
              </div>
              <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>{tc('corp_page.station_limits','Station-wise Credit Limits')}</div>
              {links.length===0 && <div style={{fontSize:12,color:'var(--text-3)',marginBottom:8}}>{tc('corp_page.not_linked','Not linked to any station yet.')}</div>}
              {links.map(lnk=>{
                const lpct = lnk.credit_limit>0 ? Math.round((lnk.current_outstanding/lnk.credit_limit)*100) : 0;
                return (
                  <div key={lnk.id} style={{background:'var(--surface-2)',borderRadius:8,padding:'0.75rem',marginBottom:6}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>{lnk.station_name}</div>
                        <div style={{fontSize:11,color:'var(--text-3)'}}>{lnk.city}, {lnk.state} · {lnk.payment_terms} {tc('corp_page.day_terms','day terms')}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:lpct>80?'var(--danger)':'var(--text-1)'}}>₹{fmt(lnk.current_outstanding)}</div>
                        <div style={{fontSize:10,color:'var(--text-3)'}}>{tc('corp_page.of','of')} ₹{fmt(lnk.credit_limit)}</div>
                      </div>
                    </div>
                    <div className="tank-bar" style={{height:4}}>
                      <div className="tank-bar-fill" style={{width:`${Math.min(100,lpct)}%`,height:4,
                        background:lpct>80?'var(--danger)':lpct>60?'var(--warning)':'var(--brand)'}}/>
                    </div>
                  </div>
                );
              })}
              <div style={{display:'flex',gap:8,marginTop:8}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setShowLink(true)}><Link2 size={12}/>{tc('corp_page.link_station','Link to Another Station')}</button>
                <button className="btn btn-primary btn-sm" onClick={()=>setShowDriver(true)}><Plus size={12}/>{tc('corp_page.add_vehicle','Add Vehicle')}</button>
                <button className="btn btn-secondary btn-sm"
                  onClick={()=>router.push(`/credit-dashboard?corp_id=${selected.id}`)}>
                  👁 {tc('corp_page.view_dashboard','View Dashboard')}
                </button>
              </div>
            </div>
            <div className="card">
              <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>{tc('corp_page.vehicles_drivers','Vehicles & Drivers')} ({drivers.length})</div>
              {drivers.length===0 && <div style={{color:'var(--text-3)',fontSize:13}}>{tc('corp_page.no_vehicles','No vehicles registered.')}</div>}
              {drivers.length>0 && (
                <div className="table-wrap">
                  <table className="dms-table">
                    <thead><tr><th>{tc('common.vehicle','Vehicle')}</th><th>{tc('common.driver','Driver')}</th><th>{tc('common.mobile','Phone')}</th><th>{tc('common.status','Status')}</th></tr></thead>
                    <tbody>
                      {drivers.map(d=>(
                        <tr key={d.id}>
                          <td style={{fontFamily:'var(--font-mono)',fontWeight:600}}>{d.vehicle_number}</td>
                          <td>{d.driver_name||'—'}</td>
                          <td style={{fontSize:12}}>{displayMobile(d.phone)}</td>
                          <td><span className={`badge ${d.is_active?'badge-success':'badge-gray'}`}>{d.is_active?tc('common.active','Active'):tc('common.inactive','Inactive')}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add/Edit */}
      {showForm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100,padding:'1rem',overflowY:'auto'}}>
          <div className="card" style={{width:'100%',maxWidth:500}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>{editCorp?tc('corp_page.edit_customer','Edit Credit Customer'):tc('corp_page.add_customer','Add Credit Customer')}</span>
              <button onClick={()=>{setShowForm(false);setWarnings([]);}} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <DuplicateWarning t={t} warnings={warnings}
              onForce={()=>saveCorp(null,true)}
              onLink={(match)=>{
                api.post(`/corporate/${match.id}/links`,{station_id:stationId,credit_limit:form.credit_limit||0,payment_terms:form.payment_terms||30})
                  .then(()=>{ setShowForm(false); load(); });
              }}/>
            <form onSubmit={saveCorp}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="label">{tc('corp_page.company_name','Company Name')} *</label>
                  <input className="input" required value={form.company_name||''} onChange={e=>f('company_name',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('corp_page.gstin','GSTIN')}</label>
                  <input className="input" placeholder="33ABCDE1234F1Z5" maxLength={15} value={form.gst_number||''}
                    onChange={e=>{ const v=e.target.value.toUpperCase(); f('gst_number',v); triggerDupCheck(v,form.contact_phone); }}/>
                </div>
                <div>
                  <label className="label">{tc('corp_page.pan','PAN')}</label>
                  <input className="input" placeholder="ABCDE1234F" maxLength={10} value={form.pan||''} onChange={e=>f('pan',e.target.value.toUpperCase())}/>
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="label">{tc('corp_page.contact_person','Contact Person (Corporate User) — optional')}</label>
                  <select className="input" value={form.contact_person_id||''} 
                    onChange={e=>{
                      const u = corpUsers.find(u=>u.id===e.target.value);
                      f('contact_person_id', e.target.value);
                      if(u) {
                        f('contact_person', u.name);
                        // Auto-fill phone if empty
                        if(!form.contact_phone && u.phone) {
                          f('contact_phone', u.phone.replace('+91',''));
                        }
                        // Trigger dup check with phone
                        triggerDupCheck(form.gst_number, u.phone);
                      }
                    }}>
                    <option value="">{tc('corp_page.select_corp_user','Select corporate user...')}</option>
                    {corpUsers.map(u=>(
                      <option key={u.id} value={u.id}>{u.name} — {u.phone?.replace('+91','')}</option>
                    ))}
                  </select>
                  {corpUsers.length===0 && (
                    <div style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
                      {tc('corp_page.no_corp_users','No Corporate-role users yet — leave this blank for now. You can link one later (by editing the customer) when you set up their portal login.')}
                    </div>
                  )}
                  <div style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
                    {tc('corp_page.corp_user_hint','Optional. Link a Corporate-role user to give this customer a portal login later. If selected, their phone auto-fills and is used for duplicate detection.')}
                  </div>
                </div>
                <div>
                  <label className="label">{tc('corp_page.contact_mobile','Contact Mobile')}</label>
                  <div style={{display:'flex',border:'1.5px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
                    <div style={{padding:'9px 8px',background:'var(--surface-2)',fontSize:12,color:'var(--text-3)',borderRight:'1px solid var(--border)'}}>+91</div>
                    <input className="input" style={{border:'none',flex:1}} maxLength={10} placeholder="9876543210"
                      value={form.contact_phone||''}
                      onChange={e=>{ const v=e.target.value.replace(/\D/g,'').slice(0,10); f('contact_phone',v); triggerDupCheck(form.gst_number,v.length===10?`+91${v}`:''); }}/>
                  </div>
                </div>
                <div>
                  <label className="label">{tc('common.email','Email')}</label>
                  <input className="input" type="email" value={form.email||''} onChange={e=>f('email',e.target.value)}/>
                </div>
                {!editCorp && <>
                  <div>
                    <label className="label">{tc('corp_page.credit_limit_station','Credit Limit for this Station (₹)')} *</label>
                    <input className="input" type="number" min="0" required value={form.credit_limit||''} onChange={e=>f('credit_limit',parseFloat(e.target.value))}/>
                  </div>
                  <div>
                    <label className="label">{tc('corp_page.payment_terms','Payment Terms (days)')}</label>
                    <input className="input" type="number" min="0" max="365" value={form.payment_terms||30} onChange={e=>f('payment_terms',parseInt(e.target.value))}/>
                  </div>
                </>}
                <div style={{gridColumn:'1/-1'}}>
                  <label className="label">{tc('common.address','Address')}</label>
                  <textarea className="input" rows={2} value={form.address||''} onChange={e=>f('address',e.target.value)}/>
                </div>
              </div>
              <button className="btn btn-primary" type="submit"
                style={{width:'100%',justifyContent:'center',marginTop:'1rem'}}
                disabled={loading||warnings.some(w=>w.level==='error')}>
                {loading?tc('common.saving','Saving...'):(editCorp?tc('common.save_changes','Save Changes'):tc('corp_page.add_customer','Add Credit Customer'))}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Link to Station */}
      {showLink && selected && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:420}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <div><div style={{fontWeight:700}}>{tc('corp_page.link_to_station','Link to Station')}</div><div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{selected.company_name}</div></div>
              <button onClick={()=>setShowLink(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <form onSubmit={saveLink}>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">{tc('corp_page.station','Station')} *</label>
                <select className="input" required onChange={e=>fl('station_id',e.target.value)}>
                  <option value="">{tc('corp_page.select_station','Select station...')}</option>
                  {stations.filter(s=>!links.find(l=>l.station_id===s.id)).map(s=>(
                    <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
                  ))}
                </select>
              </div>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">{tc('corp_page.credit_limit_station','Credit Limit for this Station (₹)')} *</label>
                <input className="input" type="number" min="0" required value={linkForm.credit_limit||''} onChange={e=>fl('credit_limit',parseFloat(e.target.value))}/>
              </div>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">{tc('corp_page.payment_terms','Payment Terms (days)')}</label>
                <input className="input" type="number" min="0" max="365" value={linkForm.payment_terms||30} onChange={e=>fl('payment_terms',parseInt(e.target.value))}/>
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading?tc('corp_page.linking','Linking...'):tc('corp_page.link_to_station','Link to Station')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Driver */}
      {showDriver && selected && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:400}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700}}>{tc('corp_page.add_vehicle_driver','Add Vehicle / Driver')}</span>
              <button onClick={()=>setShowDriver(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <form onSubmit={saveDriver}>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">{tc('corp_page.vehicle_number','Vehicle Number')} *</label>
                <input className="input" placeholder="TN09AB1234" required
                  value={driverForm.vehicle_number||''}
                  onChange={e=>fd('vehicle_number',e.target.value.toUpperCase())}
                  style={{textTransform:'uppercase',letterSpacing:'.05em'}}/>
              </div>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">{tc('corp_page.driver_name','Driver Name')}</label>
                <input className="input" value={driverForm.driver_name||''} onChange={e=>fd('driver_name',e.target.value)}/>
              </div>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">{tc('corp_page.driver_mobile','Driver Mobile')}</label>
                <div style={{display:'flex',border:'1.5px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
                  <div style={{padding:'9px 8px',background:'var(--surface-2)',fontSize:12,color:'var(--text-3)',borderRight:'1px solid var(--border)'}}>+91</div>
                  <input className="input" style={{border:'none',flex:1}} maxLength={10} placeholder="9876543210"
                    value={driverForm.phone||''} onChange={e=>fd('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/>
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading?tc('corp_page.adding','Adding...'):tc('corp_page.add_vehicle_driver','Add Vehicle / Driver')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Merge */}
      {showMerge && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div className="card" style={{width:480}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <span style={{fontWeight:700,fontSize:16}}>{tc('corp_page.merge_accounts','Merge Duplicate Accounts')}</span>
              <button onClick={()=>setShowMerge(null)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <div style={{background:'#fff7ed',borderRadius:8,padding:'0.75rem',marginBottom:'1.25rem',fontSize:13,color:'#9a3412'}}>
              <strong>{tc('corp_page.merge_match','Match:')}</strong> {showMerge.match_type==='gstn'?`${tc('corp_page.same_gstn','same GSTN')}: ${showMerge.corp1_gstn}`:`${tc('corp_page.same_phone','same phone')}: ${showMerge.corp1_phone}`}<br/>
              {tc('corp_page.merge_select','Select which account to keep as master. All transactions, drivers and links from the other account will be moved across.')}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1.5rem'}}>
              {[
                {id:showMerge.corp1_id, name:showMerge.corp1_name},
                {id:showMerge.corp2_id, name:showMerge.corp2_name},
              ].map((corp,i)=>(
                <div key={corp.id} style={{background:'var(--surface-2)',borderRadius:8,padding:'1rem',textAlign:'center'}}>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:8}}>{corp.name}</div>
                  <button className="btn btn-primary" style={{width:'100%',justifyContent:'center'}}
                    onClick={()=>handleMerge(corp.id, i===0?showMerge.corp2_id:showMerge.corp1_id)}>
                    {tc('corp_page.keep_master','Keep as Master')}
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" style={{width:'100%',justifyContent:'center'}}
              onClick={()=>dismissDup(showMerge.id)}>
              {tc('corp_page.different_companies','These are different companies — Dismiss')}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
