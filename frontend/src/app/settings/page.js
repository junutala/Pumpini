'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Plus, X, Building2, IndianRupee, Wifi, Globe } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getCurrentPrices, setPrice, getNozzles, getRfidTags, addRfidTag } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { LANGUAGES } from '../../i18n';

const FUEL_TYPES = ['petrol','diesel','cng','premium_petrol','lubes'];

// IST now for default effective_from
const nowIST = () => new Date().toLocaleString('sv-SE',{timeZone:'Asia/Kolkata'}).slice(0,16);

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { station }  = useAuth();
  const stationId    = typeof station==='object'?station?.id:station;

  const [tab,setTab]         = useState('station');
  const [prices,setPrices]   = useState([]);
  const [nozzles,setNozzles] = useState([]);
  const [rfidTags,setRfidTags] = useState([]);
  const [stationSettings,setStationSettings] = useState({});
  const [saved,setSaved]     = useState('');
  const [loading,setLoading] = useState(false);

  const [priceForm,setPriceForm]   = useState({fuel_type:'petrol',price:'',effective_from:nowIST()});
  const [rfidForm,setRfidForm]     = useState({tag_uid:''});
  const [nozzleForm,setNozzleForm] = useState({nozzle_number:'',fuel_type:'petrol'});

  const load = async() => {
    if(!stationId) return;
    const [p,n,r] = await Promise.all([getCurrentPrices(stationId),getNozzles(stationId),getRfidTags(stationId)]);
    setPrices(p); setNozzles(n); setRfidTags(r);
    // Load station settings
    try {
      const s = await api.get(`/stations/${stationId}/settings`);
      setStationSettings(s||{});
    } catch(e) { /* no settings yet */ }
  };
  useEffect(()=>{ load(); },[stationId]);

  const saveStation = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post(`/stations/${stationId}/settings`, stationSettings);
      setSaved('Station details saved!');
      setTimeout(()=>setSaved(''),3000);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const savePrice = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      // Convert IST input to UTC for storage
      const effectiveUTC = new Date(priceForm.effective_from).toISOString();
      await setPrice({...priceForm,station_id:stationId,effective_from:effectiveUTC});
      setSaved('Price saved!'); load();
      setTimeout(()=>setSaved(''),3000);
    } catch(err){ alert(err.error||'Failed'); }
    finally{ setLoading(false); }
  };

  const saveRfid = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await addRfidTag({tag_uid:rfidForm.tag_uid,station_id:stationId});
      setRfidForm({tag_uid:''}); load();
    } catch(err){ alert(err.error||'Tag already exists'); }
    finally{ setLoading(false); }
  };

  const toIST = ts => ts ? new Date(ts).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';

  const TABS = [
    {id:'station', label:'Station Details',  icon:<Building2 size={14}/>},
    {id:'prices',  label:'Fuel Prices',      icon:<IndianRupee size={14}/>},
    {id:'rfid',    label:'RFID Tags',        icon:<Wifi size={14}/>},
    {id:'nozzles', label:'Nozzles',          icon:null},
    {id:'language',label:'Language',         icon:<Globe size={14}/>},
  ];

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        {saved && <div className="badge badge-success" style={{padding:'6px 12px',fontSize:13}}>✓ {saved}</div>}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:'1.5rem',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
        {TABS.map(tb=>(
          <button key={tb.id} onClick={()=>setTab(tb.id)}
            style={{background:'none',border:'none',cursor:'pointer',padding:'8px 16px',display:'flex',alignItems:'center',gap:6,
              fontWeight:tab===tb.id?600:400,color:tab===tb.id?'var(--brand)':'var(--text-2)',
              borderBottom:`2px solid ${tab===tb.id?'var(--brand)':'transparent'}`,marginBottom:-1,fontSize:14}}>
            {tb.icon}{tb.label}
          </button>
        ))}
      </div>

      {/* Station Details */}
      {tab==='station' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem'}}>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem'}}>Station & Legal Details</div>
            <form onSubmit={saveStation}>
              {[
                ['gstn','GSTN Number','e.g. 33ABCDE1234F1Z5'],
                ['pan','PAN Number','e.g. ABCDE1234F'],
                ['tan','TAN Number','e.g. CHEN12345A'],
                ['address','Address','Street address'],
                ['city','City','e.g. Chennai'],
                ['state','State','e.g. Tamil Nadu'],
                ['pincode','Pincode','e.g. 600001'],
              ].map(([f,l,ph])=>(
                <div key={f} style={{marginBottom:'0.75rem'}}>
                  <label className="label">{l}</label>
                  <input className="input" placeholder={ph} value={stationSettings[f]||''}
                    onChange={e=>setStationSettings(p=>({...p,[f]:e.target.value}))}/>
                </div>
              ))}
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                <Save size={14}/> Save Station Details
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem'}}>Alert & Notification Settings</div>
            <div style={{marginBottom:'0.75rem'}}>
              <label className="label">Owner WhatsApp Number</label>
              <input className="input" placeholder="+91 98765 43210" value={stationSettings.owner_whatsapp||''}
                onChange={e=>setStationSettings(p=>({...p,owner_whatsapp:e.target.value}))}/>
              <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>Variance and stock alerts will be sent here</div>
            </div>
            <div style={{marginBottom:'0.75rem'}}>
              <label className="label">Owner Email</label>
              <input className="input" type="email" placeholder="owner@example.com" value={stationSettings.owner_email||''}
                onChange={e=>setStationSettings(p=>({...p,owner_email:e.target.value}))}/>
            </div>
            <div style={{marginBottom:'0.75rem'}}>
              <label className="label">Cash Variance Alert Threshold (₹)</label>
              <input className="input" type="number" placeholder="50" value={stationSettings.variance_threshold||50}
                onChange={e=>setStationSettings(p=>({...p,variance_threshold:e.target.value}))}/>
              <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>Alert sent if cash variance exceeds this amount</div>
            </div>
            <div style={{marginBottom:'1.25rem'}}>
              <label className="label">GST Invoice Prefix</label>
              <input className="input" placeholder="INV" value={stationSettings.invoice_prefix||'INV'}
                onChange={e=>setStationSettings(p=>({...p,invoice_prefix:e.target.value}))}/>
              <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>Invoice numbers will be INV-001, INV-002 etc.</div>
            </div>
            <button className="btn btn-primary" style={{width:'100%',justifyContent:'center'}} disabled={loading}
              onClick={saveStation}>
              <Save size={14}/> Save Alert Settings
            </button>
          </div>
        </div>
      )}

      {/* Fuel Prices */}
      {tab==='prices' && (
        <div style={{display:'grid',gridTemplateColumns:'360px 1fr',gap:'1.5rem'}}>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem'}}>Set New Price</div>
            <form onSubmit={savePrice}>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">Fuel Type</label>
                <select className="input" value={priceForm.fuel_type} onChange={e=>setPriceForm(p=>({...p,fuel_type:e.target.value}))}>
                  {FUEL_TYPES.map(f=><option key={f} value={f}>{t(`fuel_types.${f}`)||f}</option>)}
                </select>
              </div>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">Price per Litre (₹)</label>
                <input className="input" type="number" step="0.01" placeholder="e.g. 105.50" required
                  value={priceForm.price} onChange={e=>setPriceForm(p=>({...p,price:e.target.value}))}/>
              </div>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">Effective From (Date & Time — IST)</label>
                <input className="input" type="datetime-local" value={priceForm.effective_from}
                  onChange={e=>setPriceForm(p=>({...p,effective_from:e.target.value}))} required/>
                <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>
                  ⚠️ All sales after this date & time will use the new price
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                <Save size={14}/> Save Price
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem'}}>Current Prices</div>
            {prices.length===0&&<div style={{color:'var(--text-3)',fontSize:13}}>No prices set yet</div>}
            {prices.map(p=>(
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0',borderBottom:'1px solid var(--border)'}}>
                <span className={`fuel-chip fuel-${p.fuel_type}`}>{t(`fuel_types.${p.fuel_type}`)||p.fuel_type}</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:20}}>₹{Number(p.price).toFixed(2)}<span style={{fontSize:12,color:'var(--text-3)',fontWeight:400}}>/L</span></div>
                  <div style={{fontSize:11,color:'var(--text-3)'}}>Effective from: {toIST(p.effective_from)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RFID Tags */}
      {tab==='rfid' && (
        <div style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:'1.5rem'}}>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem'}}>Register RFID Tag</div>
            <form onSubmit={saveRfid}>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">Tag UID</label>
                <input className="input" placeholder="Scan or enter UID..." required value={rfidForm.tag_uid}
                  onChange={e=>setRfidForm({tag_uid:e.target.value})}/>
                <div style={{fontSize:12,color:'var(--text-3)',marginTop:4}}>Scan the RFID card to auto-populate</div>
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                <Plus size={14}/> Register Tag
              </button>
            </form>
          </div>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'0.75rem'}}>Registered Tags ({rfidTags.length})</div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead><tr><th>Tag UID</th><th>Assigned To</th><th>Status</th></tr></thead>
                <tbody>
                  {rfidTags.map(r=>(
                    <tr key={r.id}>
                      <td className="num" style={{fontSize:13}}>{r.tag_uid}</td>
                      <td>{r.attendant_name||<span style={{color:'var(--text-3)'}}>Unassigned</span>}</td>
                      <td><span className={`badge ${r.is_active?'badge-success':'badge-gray'}`}>{r.is_active?'Active':'Inactive'}</span></td>
                    </tr>
                  ))}
                  {rfidTags.length===0&&<tr><td colSpan={3} style={{textAlign:'center',color:'var(--text-3)'}}>No tags registered</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Nozzles */}
      {tab==='nozzles' && (
        <div style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:'1.5rem'}}>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'1rem'}}>Add Nozzle</div>
            <form onSubmit={async e=>{
              e.preventDefault(); setLoading(true);
              try { await api.post('/stations/'+stationId+'/nozzles',{...nozzleForm,station_id:stationId}); load(); }
              catch(err){ alert(err.error||'Failed'); }
              finally{ setLoading(false); }
            }}>
              <div style={{marginBottom:'0.75rem'}}>
                <label className="label">Nozzle Number</label>
                <input className="input" type="number" min="1" placeholder="e.g. 1" required
                  value={nozzleForm.nozzle_number} onChange={e=>setNozzleForm(p=>({...p,nozzle_number:e.target.value}))}/>
              </div>
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">Fuel Type</label>
                <select className="input" value={nozzleForm.fuel_type} onChange={e=>setNozzleForm(p=>({...p,fuel_type:e.target.value}))}>
                  {FUEL_TYPES.map(f=><option key={f} value={f}>{t(`fuel_types.${f}`)||f}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                <Plus size={14}/> Add Nozzle
              </button>
            </form>
          </div>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:'0.75rem'}}>Configured Nozzles</div>
            <div className="table-wrap">
              <table className="dms-table">
                <thead><tr><th>Nozzle #</th><th>Fuel Type</th><th>Tank</th><th>Status</th></tr></thead>
                <tbody>
                  {nozzles.map(n=>(
                    <tr key={n.id}>
                      <td><strong>N{n.nozzle_number}</strong></td>
                      <td><span className={`fuel-chip fuel-${n.fuel_type}`}>{t(`fuel_types.${n.fuel_type}`)||n.fuel_type}</span></td>
                      <td>{n.tank_number?`Tank ${n.tank_number}`:<span style={{color:'var(--text-3)'}}>—</span>}</td>
                      <td><span className={`badge ${n.is_active?'badge-success':'badge-gray'}`}>{n.is_active?'Active':'Inactive'}</span></td>
                    </tr>
                  ))}
                  {nozzles.length===0&&<tr><td colSpan={4} style={{textAlign:'center',color:'var(--text-3)'}}>No nozzles configured</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Language */}
      {tab==='language' && (
        <div className="card" style={{maxWidth:400}}>
          <div style={{fontWeight:600,marginBottom:'1rem'}}>Preferred Language</div>
          <p style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>Choose the language for this device. Attendants can set their own language from their login.</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {LANGUAGES.map(l=>(
              <button key={l.code}
                className={`btn ${i18n.language===l.code?'btn-primary':'btn-secondary'}`}
                style={{justifyContent:'center',flexDirection:'column',height:'auto',padding:'12px'}}
                onClick={()=>{ i18n.changeLanguage(l.code); localStorage.setItem('i18nextLng',l.code); }}>
                <div style={{fontSize:18}}>{l.native}</div>
                <div style={{fontSize:11,opacity:.8}}>{l.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
