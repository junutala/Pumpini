'use client';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useState, useEffect } from 'react';
import { Save, Plus, X, Building2, IndianRupee, Wifi,
  Gauge, RefreshCw, Edit2, Trash2, CheckCircle, AlertCircle, MapPin } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getCurrentPrices, setPrice, getNozzles, getRfidTags, addRfidTag, getCalibrationCharts } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { INDIAN_STATES, getCities, displayMobile } from '../../lib/india';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useTranslation } from 'react-i18next';

const FUEL_TYPES = [
  {value:'petrol',         label:'Petrol (MS)'},
  {value:'diesel',         label:'Diesel (HSD)'},
  {value:'premium_petrol', label:'Premium Petrol'},
  {value:'cng',            label:'CNG'},
  {value:'lubes',          label:'Lubes / Additives'},
];
const OIL_COS = ['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'];
const nowIST  = () => new Date().toLocaleString('sv-SE',{timeZone:'Asia/Kolkata'}).slice(0,16);



// ── Main Settings Page ─────────────────────────────────────

// ── Geo-Fencing Tab ───────────────────────────────────────
function GeoFenceTab({ stationId }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [settings, setSettings] = useState({});
  const [saving,   setSaving]   = useState(false);
  const [locating, setLocating] = useState(false);
  const [toast,    setToast]    = useState('');

  useEffect(() => {
    if (!stationId) return;
    api.get(`/stations/${stationId}/settings`)
      .then(d => setSettings(d||{}))
      .catch(console.error);
  }, [stationId]);

  const upd = (k,v) => setSettings(p=>({...p,[k]:v}));

  const useMyLocation = () => {
    if (!navigator.geolocation) return alert(tc('setp.geoNotSupported', 'Geolocation not supported by this browser'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        upd('latitude',  parseFloat(pos.coords.latitude.toFixed(7)));
        upd('longitude', parseFloat(pos.coords.longitude.toFixed(7)));
        setLocating(false);
      },
      err => { alert(tc('setp.couldNotGetLocation', 'Could not get location: {msg}').replace('{msg}', err.message)); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const save = async () => {
    if (!settings.latitude || !settings.longitude) {
      return alert(tc('setp.setGpsFirst', 'Please set GPS coordinates first'));
    }
    setSaving(true);
    try {
      await api.post(`/stations/${stationId}/settings`, {
        latitude:          settings.latitude,
        longitude:         settings.longitude,
        geo_fence_radius:  settings.geo_fence_radius || 500,
        geo_fence_enabled: settings.geo_fence_enabled || false,
      });
      setToast(tc('setp.geoSaved', 'Geo-fence settings saved!'));
      setTimeout(() => setToast(''), 3000);
    } catch(e) { alert(tc('setp.saveFailed', 'Save failed')); }
    setSaving(false);
  };

  const RADIUS_OPTIONS = [100, 200, 500, 1000, 2000];
  const radius = settings.geo_fence_radius || 500;

  return (
    <div>
      {toast && (
        <div style={{background:'#dcfce7',color:'#15803d',padding:'10px 16px',borderRadius:8,
          marginBottom:'1rem',fontWeight:600,fontSize:13}}>
          ✓ {toast}
        </div>
      )}

      <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:10,
        padding:'0.75rem 1rem',marginBottom:'1.5rem',fontSize:13,color:'#1A5F7A'}}>
        📍 {tc('setp.geoIntro', 'Geo-fencing restricts POS access to staff physically present at the petrol station. Staff outside the defined radius will see a warning and cannot record transactions.')}
      </div>

      {/* Enable toggle */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid var(--border)',
        padding:'1.25rem',marginBottom:'1rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{tc('setp.enableGeo', 'Enable Geo-Fencing')}</div>
            <div style={{fontSize:13,color:'#666',marginTop:2}}>
              {tc('setp.enableGeoDesc', 'Block POS access for staff outside station boundary')}
            </div>
          </div>
          <button onClick={() => upd('geo_fence_enabled', !settings.geo_fence_enabled)}
            style={{background:'none',border:'none',cursor:'pointer',padding:0}}>
            <div style={{width:52,height:28,borderRadius:14,position:'relative',
              background: settings.geo_fence_enabled ? '#16a34a' : '#e5e3de',
              transition:'all .2s'}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#fff',
                position:'absolute',top:3,
                left: settings.geo_fence_enabled ? 27 : 3,
                transition:'all .2s',boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
            </div>
          </button>
        </div>
      </div>

      {/* GPS Coordinates */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid var(--border)',
        padding:'1.25rem',marginBottom:'1rem'}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:'1rem'}}>{tc('setp.gpsCoords', 'Station GPS Coordinates')}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div>
            <label className="label">{tc('setp.latitude', 'Latitude')}</label>
            <input className="input" type="number" step="0.0000001"
              placeholder={tc('setp.latPlaceholder', 'e.g. 17.3850')} value={settings.latitude||''}
              onChange={e=>upd('latitude', parseFloat(e.target.value))}/>
          </div>
          <div>
            <label className="label">{tc('setp.longitude', 'Longitude')}</label>
            <input className="input" type="number" step="0.0000001"
              placeholder={tc('setp.lngPlaceholder', 'e.g. 78.4867')} value={settings.longitude||''}
              onChange={e=>upd('longitude', parseFloat(e.target.value))}/>
          </div>
        </div>
        <button onClick={useMyLocation} disabled={locating}
          style={{display:'flex',alignItems:'center',gap:8,padding:'10px 18px',
            background:'#1A5F7A',color:'#fff',border:'none',borderRadius:8,
            cursor:'pointer',fontWeight:600,fontSize:13}}>
          <MapPin size={15}/>
          {locating ? tc('setp.gettingLocation', 'Getting location...') : tc('setp.useMyLocation', '📍 Use My Current Location')}
        </button>
        <div style={{fontSize:12,color:'#888',marginTop:8}}>
          {tc('setp.gpsHint', 'Open this settings page on a device at the petrol station, then click above to auto-fill coordinates.')}
        </div>
      </div>

      {/* Radius selector */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid var(--border)',
        padding:'1.25rem',marginBottom:'1.5rem'}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('setp.allowedRadius', 'Allowed Radius')}</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {RADIUS_OPTIONS.map(r => (
            <button key={r} onClick={() => upd('geo_fence_radius', r)}
              style={{padding:'8px 16px',border:'1.5px solid',borderRadius:8,cursor:'pointer',
                fontWeight:600,fontSize:13,
                borderColor: radius===r ? '#FF6B00' : '#e5e3de',
                background:  radius===r ? '#fff7ed' : '#fff',
                color:       radius===r ? '#FF6B00' : '#555'}}>
              {r < 1000 ? `${r}m` : `${r/1000}km`}
            </button>
          ))}
        </div>
        <div style={{fontSize:12,color:'#888',marginTop:8}}>
          {tc('setp.radiusHint', 'Recommended: 500m for most stations. Use 200m for tight urban locations.')}
        </div>
      </div>

      {/* Map preview */}
      {settings.latitude && settings.longitude && (
        <div style={{background:'#fff',borderRadius:12,border:'1px solid var(--border)',
          padding:'1.25rem',marginBottom:'1.5rem'}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('setp.locationPreview', 'Location Preview')}</div>
          <a href={`https://www.google.com/maps?q=${settings.latitude},${settings.longitude}`}
            target="_blank" rel="noopener noreferrer"
            style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',
              background:'#f0f9ff',color:'#1A5F7A',borderRadius:8,textDecoration:'none',
              fontWeight:600,fontSize:13,border:'1px solid #bae6fd'}}>
            <MapPin size={14}/> {tc('setp.viewOnMaps', 'View on Google Maps')}
          </a>
          <div style={{fontSize:12,color:'#888',marginTop:8}}>
            {tc('setp.coordsLabel', 'Coordinates')}: {settings.latitude}, {settings.longitude} · {tc('setp.radiusLabel', 'Radius')}: {radius}m
          </div>
        </div>
      )}

      <button onClick={save} disabled={saving}
        style={{padding:'12px 28px',background:'#FF6B00',color:'#fff',border:'none',
          borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
        {saving ? tc('setp.saving', 'Saving...') : tc('setp.saveGeoBtn', 'Save Geo-Fence Settings')}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, station, switchStation } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const stationId = typeof station==='object' ? station?.id : station;
  if (typeof window === 'undefined') return null;
  const stationName = typeof station==='object' ? station?.name : '';
  const [groupStations, setGroupStations] = useState([]);

  // Load all stations in user's group for switching
  useEffect(()=>{
    if (!user?.group_id) return;
    api.get('/stations',{params:{group_id:user.group_id}})
      .then(res=>setGroupStations(Array.isArray(res)?res:[]))
      .catch(()=>{});
  },[user]);

  // Sequential setup order — matches correct setup flow
  const TABS = [
    {id:'station', label:tc('setp.tabStation', '1. Station Details'), icon:<Building2 size={14}/>},
    {id:'tanks',   label:tc('setp.tabTanks', '2. Tanks'),            icon:<Gauge size={14}/>},
    {id:'nozzles', label:tc('setp.tabNozzles', '3. Nozzles'),        icon:null},
    {id:'prices',  label:tc('setp.tabPrices', '4. Fuel Prices'),     icon:<IndianRupee size={14}/>},
    {id:'rfid',    label:tc('setp.tabRfid', '5. RFID Tags'),         icon:<Wifi size={14}/>},
    {id:'shifts',  label:tc('setp.tabShifts', '6. Shift Timings'),   icon:<RefreshCw size={14}/>},
    {id:'geofence',label:tc('setp.tabGeofence', '7. Geo-Fencing'),   icon:<MapPin size={14}/>},
  ];

  const [tab,   setTab]   = useState('station');
  const [tanks, setTanks] = useState([]);
  const [nozzles,setNozzles] = useState([]);
  const [prices, setPrices]  = useState([]);
  const [rfid,   setRfid]    = useState([]);
  const [stationInfo, setStationInfo] = useState({});
  const [confirm, setConfirm] = useState(null); // {message, onConfirm}
  const [toast,   setToast]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const askConfirm = (message, onConfirm) => setConfirm({ message, onConfirm });

  const load = async () => {
    if (!stationId) return;
    const [p,n,r,t,si] = await Promise.all([
      getCurrentPrices(stationId),
      getNozzles(stationId),
      getRfidTags(stationId),
      api.get(`/stations/${stationId}/tanks`).catch(()=>[]),
      api.get(`/stations/${stationId}/settings`).catch(()=>({})),
    ]);
    setPrices(Array.isArray(p)?p:[]);
    setNozzles(Array.isArray(n)?n:[]);
    setRfid(Array.isArray(r)?r:[]);
    setTanks(Array.isArray(t)?t:[]);
    setStationInfo(si||{});
  };

  useEffect(()=>{ load(); },[stationId]);
  useRefreshOnFocus(load);

  return (
    <AppShell>
      {/* Toast */}
      {toast && (
        <div style={{position:'fixed',top:20,right:20,background:'#16a34a',color:'#fff',
          padding:'10px 18px',borderRadius:10,zIndex:400,display:'flex',
          alignItems:'center',gap:8,boxShadow:'0 4px 20px rgba(0,0,0,.2)'}}>
          <CheckCircle size={16}/>{toast}
        </div>
      )}

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog message={confirm.message}
          onConfirm={()=>{ confirm.onConfirm(); setConfirm(null); }}
          onCancel={()=>setConfirm(null)}/>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('setp.settings', 'Settings')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>
            {tc('setp.settingsSubtitle', 'Follow the numbered tabs in order for initial setup')}
          </div>
        </div>
      </div>

      {/* Station name header */}
      <div style={{marginBottom:'1.5rem',padding:'1rem 1.25rem',background:'#fff',borderRadius:12,border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:11,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>{tc('setp.currentlyConfiguring', 'Currently Configuring')}</div>
          <div style={{fontSize:20,fontWeight:800,color:'var(--text-1)'}}>{stationName || tc('setp.yourStation', 'Your Station')}</div>
        </div>
        {groupStations.length > 1 && (
          <div>
            <label style={{fontSize:12,color:'var(--text-3)',display:'block',marginBottom:4}}>{tc('setp.switchBunk', 'Switch Bunk')}</label>
            <select className="input" style={{width:220}}
              value={stationId||''}
              onChange={e=>{
                const s = groupStations.find(st=>st.id===e.target.value);
                if(s) switchStation(s);
              }}>
              {groupStations.map(st=>(
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Setup order banner for new stations */}
      {tanks.length===0 && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,
          padding:'0.75rem 1rem',marginBottom:'1.5rem',fontSize:13,color:'#9a3412',
          display:'flex',alignItems:'flex-start',gap:10}}>
          <AlertCircle size={16} style={{marginTop:1,flexShrink:0}}/>
          <div>
            <strong>{tc('setp.setupOrderTitle', 'New station setup order:')}</strong>{' '}
            {tc('setp.setupOrderSteps', 'Station Details → Tanks → Nozzles → Fuel Prices → RFID Tags → Shift Timings')}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:'flex',gap:4,borderBottom:'1px solid var(--border)',
        marginBottom:'1.5rem',overflowX:'auto',flexWrap:'nowrap'}}>
        {TABS.map(tb=>(
          <button key={tb.id} onClick={()=>setTab(tb.id)} style={{
            display:'flex',alignItems:'center',gap:6,
            padding:'10px 14px',background:'none',border:'none',cursor:'pointer',
            fontWeight:tab===tb.id?700:400,
            color:tab===tb.id?'var(--brand)':'var(--text-2)',
            borderBottom:`2px solid ${tab===tb.id?'var(--brand)':'transparent'}`,
            marginBottom:-1,fontSize:13,whiteSpace:'nowrap',
          }}>
            {tb.icon}{tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab==='station' && (
        <StationTab stationId={stationId} info={stationInfo}
          onSaved={()=>{ load(); showToast(tc('setp.toastStationSaved', 'Station details saved!')); }} askConfirm={askConfirm}/>
      )}
      {tab==='tanks' && (
        <TanksTab stationId={stationId} tanks={tanks}
          reload={()=>{ load(); showToast(tc('setp.toastTanksUpdated', 'Tanks updated!')); }} askConfirm={askConfirm}/>
      )}
      {tab==='nozzles' && (
        <NozzlesTab stationId={stationId} nozzles={nozzles} tanks={tanks}
          reload={()=>{ load(); showToast(tc('setp.toastNozzlesUpdated', 'Nozzles updated!')); }} askConfirm={askConfirm}/>
      )}
      {tab==='prices' && (
        <PricesTab stationId={stationId} prices={prices}
          reload={()=>{ load(); showToast(tc('setp.toastPriceUpdated', 'Price updated!')); }}/>
      )}
      {tab==='geofence' && (
        <GeoFenceTab stationId={stationId} />
      )}

      {tab==='rfid' && (
        <RfidTab stationId={stationId} tags={rfid}
          reload={()=>{ load(); showToast(tc('setp.toastRfidSaved', 'RFID tag saved!')); }} askConfirm={askConfirm}/>
      )}
      {tab==='shifts' && (
        <ShiftsTab stationId={stationId}
          onSaved={()=>showToast(tc('setp.toastShiftsSaved', 'Shift timings saved!'))}/>
      )}
    </AppShell>
  );
}

// ── Station Details Tab ────────────────────────────────────
function StationTab({ stationId, info, onSaved, askConfirm }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [form,setForm]     = useState({});
  const [loading,setLoading] = useState(false);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const cities = getCities(form.state||info?.state||'');

  useEffect(()=>{
    if(info) setForm({
      name:           info.name||'',
      address:        info.address||'',
      state:          info.state||'',
      city:           info.city||'',
      pincode:        info.pincode||'',
      oil_company:    info.oil_company||'',
      gstn:           info.gstn||'',
      pan:            info.pan||'',
      owner_whatsapp: info.owner_whatsapp ? info.owner_whatsapp.replace('+91','') : '',
      invoice_prefix: info.invoice_prefix||'INV',
    });
  },[info?.name]);

  const save = () => {
    askConfirm(tc('setp.confirmSaveStation', 'Save station details? This will update the station name and address across the system.'), async()=>{
      setLoading(true);
      try {
        await api.patch(`/stations/${stationId}/settings`, {
          ...form,
          owner_whatsapp: form.owner_whatsapp ? `+91${form.owner_whatsapp.replace(/\D/g,'').slice(-10)}` : null,
        });
        onSaved();
      } catch(e){ alert(e.error||tc('setp.failed', 'Failed')); }
      finally{ setLoading(false); }
    });
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.5rem',maxWidth:800}}>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'1rem'}}>{tc('setp.stationInfo', 'Station Information')}</div>
        <div style={{marginBottom:'0.75rem'}}>
          <label className="label">{tc('setp.stationName', 'Station Name *')}</label>
          <input className="input" value={form.name||''} onChange={e=>f('name',e.target.value)}/>
        </div>
        <div style={{marginBottom:'0.75rem'}}>
          <label className="label">{tc('setp.address', 'Address')}</label>
          <textarea className="input" rows={2} value={form.address||''} onChange={e=>f('address',e.target.value)}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:'0.75rem'}}>
          <div>
            <label className="label">{tc('setp.state', 'State *')}</label>
            <select className="input" value={form.state||''} onChange={e=>f('state',e.target.value)}>
              <option value="">{tc('setp.selectState', 'Select state...')}</option>
              {INDIAN_STATES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{tc('setp.city', 'City *')}</label>
            <select className="input" value={form.city||''} onChange={e=>f('city',e.target.value)} disabled={!form.state}>
              <option value="">{tc('setp.selectCity', 'Select city...')}</option>
              {cities.map(c=><option key={c} value={c}>{c}</option>)}
              <option value="__other__">{tc('setp.otherCity', 'Other (type below)')}</option>
            </select>
            {form.city==='__other__' && (
              <input className="input" style={{marginTop:6}} placeholder={tc('setp.enterCityName', 'Enter city name')}
                onChange={e=>f('city',e.target.value)}/>
            )}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:'0.75rem'}}>
          <div>
            <label className="label">{tc('setp.pincode', 'Pincode')}</label>
            <input className="input" maxLength={6} value={form.pincode||''} onChange={e=>f('pincode',e.target.value.replace(/\D/g,'').slice(0,6))}/>
          </div>
          <div>
            <label className="label">{tc('setp.oilCompany', 'Oil Company')}</label>
            <select className="input" value={form.oil_company||''} onChange={e=>f('oil_company',e.target.value)}>
              <option value="">{tc('setp.selectGeneric', 'Select...')}</option>
              {OIL_COS.map(o=><option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{fontWeight:600,marginBottom:'1rem'}}>{tc('setp.taxContact', 'Tax & Contact')}</div>
        <div style={{marginBottom:'0.75rem'}}>
          <label className="label">{tc('setp.gstin', 'GSTIN')}</label>
          <input className="input" placeholder="33ABCDE1234F1Z5" value={form.gstn||''}
            onChange={e=>f('gstn',e.target.value.toUpperCase())} maxLength={15}/>
        </div>
        <div style={{marginBottom:'0.75rem'}}>
          <label className="label">{tc('setp.pan', 'PAN')}</label>
          <input className="input" placeholder="ABCDE1234F" value={form.pan||''}
            onChange={e=>f('pan',e.target.value.toUpperCase())} maxLength={10}/>
        </div>
        <div style={{marginBottom:'0.75rem'}}>
          <label className="label">{tc('setp.ownerWhatsapp', 'Owner WhatsApp (10 digits)')}</label>
          <div style={{display:'flex',alignItems:'center',border:'1.5px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
            <div style={{padding:'9px 10px',background:'var(--surface-2)',fontSize:13,color:'var(--text-3)',borderRight:'1px solid var(--border)'}}>🇮🇳 +91</div>
            <input className="input" style={{border:'none',flex:1}} maxLength={10}
              placeholder="9876543210" value={form.owner_whatsapp||''}
              onChange={e=>f('owner_whatsapp',e.target.value.replace(/\D/g,'').slice(0,10))}/>
          </div>
        </div>
        <div style={{marginBottom:'1.25rem'}}>
          <label className="label">{tc('setp.invoicePrefix', 'Invoice Number Prefix')}</label>
          <input className="input" placeholder="INV" maxLength={10} value={form.invoice_prefix||'INV'}
            onChange={e=>f('invoice_prefix',e.target.value.toUpperCase())}/>
          <div style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
            {tc('setp.invoicePrefixHint', 'e.g. "INV" → INV-20260527-0001')}
          </div>
        </div>
        <button className="btn btn-primary" style={{width:'100%',justifyContent:'center'}}
          onClick={save} disabled={loading}>
          {loading?tc('setp.saving', 'Saving...'):tc('setp.saveStationBtn', 'Save Station Details')}
        </button>
      </div>
    </div>
  );
}

// ── Tanks Tab ──────────────────────────────────────────────
function TanksTab({ stationId, tanks, reload, askConfirm }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const empty = {fuel_type:'petrol'};
  const [form,setForm]     = useState(empty);
  const [editTank,setEdit] = useState(null);
  const [loading,setLoading] = useState(false);
  const [charts,setCharts] = useState([]);  // calibration library (15KL / 20KL …)
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  useEffect(()=>{ getCalibrationCharts().then(c=>setCharts(Array.isArray(c)?c:[])).catch(()=>setCharts([])); },[]);

  const save = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      if(editTank) await api.patch(`/stations/${stationId}/tanks/${editTank.id}`,form);
      else         await api.post(`/stations/${stationId}/tanks`,form);
      setForm(empty); setEdit(null); reload();
    } catch(err){ alert(err.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  const del = (id) => askConfirm(
    tc('setp.confirmDeleteTank', 'Delete this tank? All linked nozzle assignments will also be removed. This cannot be undone.'),
    async()=>{ await api.delete(`/stations/${stationId}/tanks/${id}`); reload(); }
  );

  const startEdit = (t) => {
    setEdit(t);
    setForm({ tank_number:t.tank_number, fuel_type:t.fuel_type,
      capacity_ltrs:t.capacity_ltrs, calibration_chart_id:t.calibration_chart_id||'' });
  };

  return (
    <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:'1.5rem'}}>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'1rem'}}>{editTank?tc('setp.editTank', 'Edit Tank {n}').replace('{n}', editTank.tank_number):tc('setp.addNewTank', 'Add New Tank')}</div>
        <form onSubmit={save}>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.tankNumber', 'Tank Number *')}</label>
            <input className="input" type="number" min="1" max="20" required
              placeholder={tc('setp.egOne', 'e.g. 1')} value={form.tank_number||''}
              onChange={e=>f('tank_number',parseInt(e.target.value))}/>
          </div>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.fuelType', 'Fuel Type *')}</label>
            <select className="input" value={form.fuel_type} onChange={e=>{
              const v = e.target.value;
              // CNG has no litre capacity — stamp a sentinel and hide the field. (Revisit in housekeeping.)
              setForm(p=>({ ...p, fuel_type:v, capacity_ltrs: v==='cng' ? 0 : (p.fuel_type==='cng' ? undefined : p.capacity_ltrs) }));
            }} required>
              {FUEL_TYPES.map(ft=><option key={ft.value} value={ft.value}>{ft.label}</option>)}
            </select>
          </div>
          {form.fuel_type!=='cng' && (
            <div style={{marginBottom:'0.75rem'}}>
              <label className="label">{tc('setp.capacityLitres', 'Capacity (Litres) *')}</label>
              <input className="input" type="number" step="100" min="0" required
                placeholder={tc('setp.egCapacity', 'e.g. 20000')} value={form.capacity_ltrs||''}
                onChange={e=>f('capacity_ltrs',parseFloat(e.target.value))}/>
            </div>
          )}
          <div style={{marginBottom:'1.25rem'}}>
            <label className="label">{tc('setp.tankCalibration', 'Tank Calibration (size)')}</label>
            <select className="input" value={form.calibration_chart_id||''}
              onChange={e=>f('calibration_chart_id', e.target.value || null)}>
              <option value="">{tc('setp.calibNone', '— None (enter volume manually at dip) —')}</option>
              {charts.map(c=>(
                <option key={c.id} value={c.id}>{c.name} · {Number(c.capacity_ltrs||0).toLocaleString('en-IN')} L</option>
              ))}
            </select>
            <div style={{fontSize:11,color:'var(--text-3)',marginTop:2}}>
              {tc('setp.calibHint', 'Converts dip → litres automatically at shift open/close. Live stock & density come from dip readings, not here.')}
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" type="submit" style={{flex:1,justifyContent:'center'}} disabled={loading}>
              {loading?tc('setp.saving', 'Saving...'):(editTank?tc('setp.updateTank', 'Update Tank'):tc('setp.addTank', 'Add Tank'))}
            </button>
            {editTank && (
              <button className="btn btn-secondary" type="button"
                onClick={()=>{ setEdit(null); setForm(empty); }}>{tc('setp.cancel', 'Cancel')}</button>
            )}
          </div>
        </form>
      </div>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'0.75rem'}}>{tc('setp.configuredTanks', 'Configured Tanks ({n})').replace('{n}', tanks.length)}</div>
        {tanks.length===0 && (
          <div style={{color:'var(--text-3)',fontSize:13,padding:'2rem',textAlign:'center'}}>
            {tc('setp.noTanks', 'No tanks yet. Add your first tank on the left.')}
          </div>
        )}
        {tanks.length>0 && (
          <div className="table-wrap">
            <table className="dms-table">
              <thead><tr><th>{tc('setp.thTankNum', 'Tank #')}</th><th>{tc('setp.thFuel', 'Fuel')}</th><th>{tc('setp.thCapacity', 'Capacity')}</th><th>{tc('setp.thCalibration', 'Calibration')}</th><th>{tc('setp.thCurrentStock', 'Current Stock')}</th><th>{tc('setp.thFillPct', 'Fill %')}</th><th>{tc('setp.thActions', 'Actions')}</th></tr></thead>
              <tbody>
                {tanks.map(t=>{
                  const pct = t.capacity_ltrs>0 ? Math.round((t.current_stock/t.capacity_ltrs)*100) : 0;
                  return (
                    <tr key={t.id}>
                      <td><strong>{tc('setp.tankLabel', 'Tank {n}').replace('{n}', t.tank_number)}</strong></td>
                      <td><span className={`fuel-chip fuel-${t.fuel_type}`}>{FUEL_TYPES.find(f=>f.value===t.fuel_type)?.label||t.fuel_type}</span></td>
                      <td className="num">{t.fuel_type==='cng' ? <span style={{color:'var(--text-3)'}}>—</span> : `${Number(t.capacity_ltrs).toLocaleString('en-IN')} L`}</td>
                      <td style={{fontSize:12}}>{t.chart_name || (charts.find(c=>c.id===t.calibration_chart_id)?.name) || <span style={{color:'var(--text-3)'}}>—</span>}</td>
                      <td className="num">{Number(t.current_stock).toLocaleString('en-IN',{maximumFractionDigits:1})} L</td>
                      <td>
                        {t.fuel_type==='cng' ? <span style={{color:'var(--text-3)'}}>—</span> : (
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <div className="tank-bar" style={{width:60}}>
                            <div className="tank-bar-fill" style={{width:`${Math.min(100,pct)}%`,
                              background:pct<20?'var(--danger)':pct<40?'var(--warning)':'var(--success)'}}/>
                          </div>
                          <span style={{fontSize:12,fontFamily:'var(--font-mono)'}}>{pct}%</span>
                        </div>
                        )}
                      </td>
                      <td>
                        <div style={{display:'flex',gap:6}}>
                          <button className="btn btn-secondary btn-sm" onClick={()=>startEdit(t)}><Edit2 size={12}/>{tc('setp.edit', 'Edit')}</button>
                          <button className="btn btn-danger btn-sm" onClick={()=>del(t.id)}><Trash2 size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{fontSize:11,color:'var(--text-3)',marginTop:'0.75rem'}}>
          💡 {tc('setp.nextNozzlesPre', 'Next: Go to')} <strong>{tc('setp.tabNozzles', '3. Nozzles')}</strong> {tc('setp.nextNozzlesPost', 'tab to link each nozzle to a tank')}
        </div>
      </div>
    </div>
  );
}

// ── Nozzles Tab ────────────────────────────────────────────
function NozzlesTab({ stationId, nozzles, tanks, reload, askConfirm }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const empty = {fuel_type:'petrol',is_active:true};
  const [form,setForm]     = useState(empty);
  const [editNozzle,setEdit] = useState(null);
  const [loading,setLoading] = useState(false);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  const save = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      if(editNozzle) {
        await api.patch(`/stations/${stationId}/nozzles/${editNozzle.id}`,form);
      } else {
        await api.post(`/stations/${stationId}/nozzles`,form);
      }
      setForm(empty); setEdit(null); reload();
    } catch(err){ alert(err.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  const del = (id) => askConfirm(
    tc('setp.confirmDeleteNozzle', 'Delete this nozzle? Historical transaction data will be preserved.'),
    async()=>{ await api.delete(`/stations/${stationId}/nozzles/${id}`).catch(()=>{}); reload(); }
  );

  const startEdit = (n) => {
    setEdit(n);
    setForm({ nozzle_number:n.nozzle_number, fuel_type:n.fuel_type,
      tank_id:n.tank_id||'', is_active:n.is_active });
  };

  const linkedTanks = tanks.filter(t=>t.fuel_type===form.fuel_type);

  return (
    <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:'1.5rem'}}>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'1rem'}}>{editNozzle?tc('setp.editNozzle', 'Edit Nozzle {n}').replace('{n}', editNozzle.nozzle_number):tc('setp.addNewNozzle', 'Add New Nozzle')}</div>
        <form onSubmit={save}>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.nozzleNumber', 'Nozzle Number *')}</label>
            {/* Text, not number: lets a pump's nozzles be labelled 5.1, 5.2, 5.3, 5.4
                (pump.nozzle) — the value is a free label, nothing does arithmetic on it. */}
            <input className="input" type="text" required maxLength={8}
              placeholder={tc('setp.egNozzle', 'e.g. 1 or 5.1')} value={form.nozzle_number||''}
              onChange={e=>f('nozzle_number', e.target.value.trim())}/>
          </div>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.fuelType', 'Fuel Type *')}</label>
            <select className="input" value={form.fuel_type} onChange={e=>f('fuel_type',e.target.value)} required>
              {FUEL_TYPES.map(ft=><option key={ft.value} value={ft.value}>{ft.label}</option>)}
            </select>
          </div>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.linkToTank', 'Link to Tank')}</label>
            <select className="input" value={form.tank_id||''} onChange={e=>f('tank_id',e.target.value||null)}>
              <option value="">{tc('setp.selectTank', 'Select tank...')}</option>
              {linkedTanks.map(t=>(
                <option key={t.id} value={t.id}>{tc('setp.tankLabel', 'Tank {n}').replace('{n}', t.tank_number)} — {t.fuel_type}</option>
              ))}
            </select>
            {linkedTanks.length===0 && form.fuel_type && (
              <div style={{fontSize:11,color:'var(--warning)',marginTop:3}}>
                ⚠ {tc('setp.noFuelTank', 'No {fuel} tank found. Add a tank first.').replace('{fuel}', form.fuel_type)}
              </div>
            )}
          </div>
          <div style={{marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:8}}>
            <input type="checkbox" id="active" checked={form.is_active||false}
              onChange={e=>f('is_active',e.target.checked)}/>
            <label htmlFor="active" style={{fontSize:13,cursor:'pointer'}}>{tc('setp.nozzleIsActive', 'Nozzle is active')}</label>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" type="submit" style={{flex:1,justifyContent:'center'}} disabled={loading}>
              {loading?tc('setp.saving', 'Saving...'):(editNozzle?tc('setp.updateNozzle', 'Update Nozzle'):tc('setp.addNozzle', 'Add Nozzle'))}
            </button>
            {editNozzle && (
              <button className="btn btn-secondary" type="button"
                onClick={()=>{ setEdit(null); setForm(empty); }}>{tc('setp.cancel', 'Cancel')}</button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <div style={{fontWeight:600,marginBottom:'0.75rem'}}>{tc('setp.configuredNozzles', 'Configured Nozzles ({n})').replace('{n}', nozzles.length)}</div>
        {nozzles.length===0 && (
          <div style={{color:'var(--text-3)',fontSize:13,padding:'2rem',textAlign:'center'}}>
            {tc('setp.noNozzles', 'No nozzles yet. Add tanks first, then add nozzles.')}
          </div>
        )}
        {nozzles.length>0 && (
          <div className="table-wrap">
            <table className="dms-table">
              <thead><tr><th>{tc('setp.thNozzleNum', 'Nozzle #')}</th><th>{tc('setp.thFuelType', 'Fuel Type')}</th><th>{tc('setp.thLinkedTank', 'Linked Tank')}</th><th>{tc('setp.thStatus', 'Status')}</th><th>{tc('setp.thActions', 'Actions')}</th></tr></thead>
              <tbody>
                {nozzles.map(n=>(
                  <tr key={n.id}>
                    <td><strong>{tc('setp.nozzleLabel', 'Nozzle {n}').replace('{n}', n.nozzle_number)}</strong></td>
                    <td><span className={`fuel-chip fuel-${n.fuel_type}`}>{FUEL_TYPES.find(f=>f.value===n.fuel_type)?.label||n.fuel_type}</span></td>
                    <td>{n.tank_id ? tc('setp.tankLabel', 'Tank {n}').replace('{n}', n.tank_number||'—') : <span style={{color:'var(--danger)',fontSize:12}}>⚠ {tc('setp.noTankLinked', 'No tank linked')}</span>}</td>
                    <td><span className={`badge ${n.is_active?'badge-success':'badge-gray'}`}>{n.is_active?tc('setp.active', 'Active'):tc('setp.inactive', 'Inactive')}</span></td>
                    <td>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-secondary btn-sm" onClick={()=>startEdit(n)}><Edit2 size={12}/>{tc('setp.edit', 'Edit')}</button>
                        <button className="btn btn-danger btn-sm" onClick={()=>del(n.id)}><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{fontSize:11,color:'var(--text-3)',marginTop:'0.75rem'}}>
          💡 {tc('setp.nextNozzlesPre', 'Next: Go to')} <strong>{tc('setp.tabPrices', '4. Fuel Prices')}</strong> {tc('setp.nextPricesPost', 'to set current prices')}
        </div>
      </div>
    </div>
  );
}

// ── Fuel Prices Tab ────────────────────────────────────────
function PricesTab({ stationId, prices, reload }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [form,setForm]     = useState({fuel_type:'petrol',price:'',effective_from:nowIST()});
  const [loading,setLoading] = useState(false);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  const save = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await setPrice({ station_id:stationId, ...form,
        effective_from: new Date(form.effective_from).toISOString() });
      setForm(p=>({...p,price:'',effective_from:nowIST()}));
      reload();
    } catch(err){ alert(err.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  return (
    <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:'1.5rem'}}>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'1rem'}}>{tc('setp.setFuelPrice', 'Set Fuel Price')}</div>
        <form onSubmit={save}>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.fuelType', 'Fuel Type *')}</label>
            <select className="input" value={form.fuel_type} onChange={e=>f('fuel_type',e.target.value)}>
              {FUEL_TYPES.map(ft=><option key={ft.value} value={ft.value}>{ft.label}</option>)}
            </select>
          </div>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.pricePerUnit', 'Price per {unit} (₹) *').replace('{unit}', form.fuel_type==='cng'?tc('setp.unitKg', 'kg'):tc('setp.unitLitre', 'Litre'))}</label>
            <input className="input input-lg" type="number" step="0.01" min="0" required
              placeholder={tc('setp.egPrice', 'e.g. 105.50')} value={form.price}
              onChange={e=>f('price',e.target.value)}/>
          </div>
          <div style={{marginBottom:'1.25rem'}}>
            <label className="label">{tc('setp.effectiveFrom', 'Effective From (IST) *')}</label>
            <input className="input" type="datetime-local" value={form.effective_from}
              onChange={e=>f('effective_from',e.target.value)} required/>
          </div>
          <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
            {loading?tc('setp.saving', 'Saving...'):tc('setp.setPriceBtn', 'Set Price')}
          </button>
        </form>
      </div>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'0.75rem'}}>{tc('setp.currentPrices', 'Current Prices')}</div>
        {prices.length===0 && <div style={{color:'var(--text-3)',fontSize:13}}>{tc('setp.noPrices', 'No prices set yet')}</div>}
        {prices.map(p=>(
          <div key={p.id} style={{display:'flex',justifyContent:'space-between',
            alignItems:'center',padding:'12px 0',borderBottom:'1px solid var(--border)'}}>
            <div>
              <span className={`fuel-chip fuel-${p.fuel_type}`}>{FUEL_TYPES.find(f=>f.value===p.fuel_type)?.label||p.fuel_type}</span>
              <div style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
                {tc('setp.since', 'Since')}: {new Date(p.effective_from).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true})}
              </div>
            </div>
            <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:20}}>
              ₹{Number(p.price).toFixed(2)}<span style={{fontSize:12,color:'var(--text-3)'}}>/{p.fuel_type==='cng'?'kg':'L'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── RFID Tags Tab ──────────────────────────────────────────
function RfidTab({ stationId, tags, reload, askConfirm }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [form,setForm]     = useState({tag_uid:'',label:''});
  const [loading,setLoading] = useState(false);

  const save = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      await addRfidTag({ station_id:stationId, ...form });
      setForm({tag_uid:'',label:''});
      reload();
    } catch(err){ alert(err.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  const toggleTag = (id,active) => askConfirm(
    active ? tc('setp.confirmDeactivateTag', 'Deactivate this RFID tag?') : tc('setp.confirmActivateTag', 'Activate this RFID tag?'),
    async()=>{ await api.patch(`/rfid/${id}`,{is_active:!active}); reload(); }
  );

  return (
    <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:'1.5rem'}}>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'1rem'}}>{tc('setp.registerRfid', 'Register RFID Tag')}</div>
        <form onSubmit={save}>
          <div style={{marginBottom:'0.75rem'}}>
            <label className="label">{tc('setp.tagUid', 'Tag UID *')}</label>
            <input className="input" placeholder={tc('setp.tagUidPlaceholder', 'e.g. E2003411B9A09C21')} required
              value={form.tag_uid} onChange={e=>setForm(p=>({...p,tag_uid:e.target.value.toUpperCase()}))}/>
          </div>
          <div style={{marginBottom:'1.25rem'}}>
            <label className="label">{tc('setp.labelAttendant', 'Label / Attendant Name')}</label>
            <input className="input" placeholder={tc('setp.labelPlaceholder', "e.g. Arjun's card")}
              value={form.label} onChange={e=>setForm(p=>({...p,label:e.target.value}))}/>
          </div>
          <button className="btn btn-primary" type="submit" style={{width:'100%',justifyContent:'center'}} disabled={loading}>
            {loading?tc('setp.saving', 'Saving...'):tc('setp.registerTagBtn', 'Register Tag')}
          </button>
        </form>
      </div>
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'0.75rem'}}>{tc('setp.registeredTags', 'Registered Tags ({n})').replace('{n}', tags.length)}</div>
        {tags.length===0 && <div style={{color:'var(--text-3)',fontSize:13}}>{tc('setp.noTags', 'No RFID tags registered yet')}</div>}
        <div className="table-wrap">
          {tags.length>0 && (
            <table className="dms-table">
              <thead><tr><th>{tc('setp.thTagUid', 'Tag UID')}</th><th>{tc('setp.thLabel', 'Label')}</th><th>{tc('setp.thStatus', 'Status')}</th><th>{tc('setp.thActions', 'Actions')}</th></tr></thead>
              <tbody>
                {tags.map(t=>(
                  <tr key={t.id}>
                    <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{t.tag_uid}</td>
                    <td>{t.label||'—'}</td>
                    <td><span className={`badge ${t.is_active?'badge-success':'badge-gray'}`}>{t.is_active?tc('setp.active', 'Active'):tc('setp.inactive', 'Inactive')}</span></td>
                    <td>
                      <button className={`btn btn-sm ${t.is_active?'btn-danger':'btn-secondary'}`}
                        onClick={()=>toggleTag(t.id,t.is_active)}>
                        {t.is_active?tc('setp.deactivate', 'Deactivate'):tc('setp.activate', 'Activate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shift Timings Tab ──────────────────────────────────────
function ShiftsTab({ stationId, onSaved }) {
  const { station, user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = stationId || (typeof station==='object'?station?.id:station);
  const [defs,setDefs]     = useState([
    {shift_number:1,name:'Morning',  start_time:'06:00',end_time:'14:00'},
    {shift_number:2,name:'Afternoon',start_time:'14:00',end_time:'22:00'},
    {shift_number:3,name:'Night',    start_time:'22:00',end_time:'06:00'},
  ]);
  const [loading,setLoading] = useState(false);
  const [mgrMode,setMgrMode] = useState(false);   // manager-driven blind drop
  const [modeBusy,setModeBusy] = useState(false);
  const isOwner = user?.role === 'owner';

  useEffect(()=>{
    if(!sid) return;
    api.get(`/shifts/definitions/${sid}`).then(d=>{ if(d?.length) setDefs(d); }).catch(()=>{});
    api.get(`/stations/${sid}/settings`).then(s=>setMgrMode(!!s?.manager_blind_drop)).catch(()=>{});
  },[sid]);

  const toggleMode = async () => {
    setModeBusy(true);
    try {
      const r = await api.patch(`/stations/${sid}/blind-drop-mode`, { manager_blind_drop: !mgrMode });
      setMgrMode(!!r?.manager_blind_drop);
    } catch(e){ alert(e.response?.data?.error || e.error || tc('setp.couldNotChangeMode', 'Could not change mode')); }
    setModeBusy(false);
  };

  const save = async() => {
    setLoading(true);
    try { await api.post('/shifts/definitions',{station_id:sid,shifts:defs}); onSaved(); }
    catch(e){ alert(e.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  return (
    <div style={{maxWidth:560}}>
    {/* Blind-drop reconciliation mode (owner only) */}
    {isOwner && (
      <div className="card" style={{marginBottom:'1rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{paddingRight:12}}>
            <div style={{fontWeight:700,fontSize:15}}>{tc('setp.mgrBlindDrop', 'Manager-driven blind drop')}</div>
            <div style={{fontSize:13,color:'#666',marginTop:2}}>
              {tc('setp.mgrBlindDropDesc', 'When ON, operators don’t use POS during the shift. The manager opens with cash + meter reading and reconciles each operator at shift end from the meter. When OFF, the standard POS blind drop applies. (Can’t change while a shift is open.)')}
            </div>
          </div>
          <button onClick={toggleMode} disabled={modeBusy}
            style={{background:'none',border:'none',cursor:modeBusy?'wait':'pointer',padding:0,flexShrink:0}}>
            <div style={{width:52,height:28,borderRadius:14,position:'relative',
              background: mgrMode ? '#16a34a' : '#e5e3de', transition:'all .2s'}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#fff',position:'absolute',top:3,
                left: mgrMode ? 27 : 3, transition:'all .2s',boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
            </div>
          </button>
        </div>
      </div>
    )}

    <div className="card">
      <div style={{fontWeight:600,marginBottom:'0.5rem'}}>{tc('setp.shiftTimings', 'Shift Timings')}</div>
      <div style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>
        {tc('setp.shiftTimingsDesc', 'Define start and end times for each shift. These appear when opening shifts.')}
      </div>
      {defs.map((d,i)=>(
        <div key={d.shift_number} style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 1fr',gap:10,marginBottom:'0.75rem',alignItems:'end'}}>
          <div style={{fontSize:13,fontWeight:600,paddingBottom:6,color:'var(--text-2)'}}>{tc('setp.shiftLabel', 'Shift {n}').replace('{n}', d.shift_number)}</div>
          <div>
            <label className="label">{tc('setp.shiftName', 'Name')}</label>
            <input className="input" value={d.name} onChange={e=>setDefs(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
          </div>
          <div>
            <label className="label">{tc('setp.shiftStart', 'Start')}</label>
            <input className="input" type="time" value={d.start_time} onChange={e=>setDefs(p=>p.map((x,j)=>j===i?{...x,start_time:e.target.value}:x))}/>
          </div>
          <div>
            <label className="label">{tc('setp.shiftEnd', 'End')}</label>
            <input className="input" type="time" value={d.end_time} onChange={e=>setDefs(p=>p.map((x,j)=>j===i?{...x,end_time:e.target.value}:x))}/>
          </div>
        </div>
      ))}
      <button className="btn btn-primary" style={{marginTop:'0.5rem',width:'100%',justifyContent:'center'}} onClick={save} disabled={loading}>
        {loading?tc('setp.saving', 'Saving...'):tc('setp.saveShiftBtn', 'Save Shift Timings')}
      </button>
    </div>
    </div>
  );
}

// ── Language Tab removed ───────────────────────────────────
// Language selection now lives only on the landing page and the login form.
