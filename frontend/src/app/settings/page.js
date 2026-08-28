'use client';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useState, useEffect } from 'react';
import { Save, Plus, X, Building2, IndianRupee, Wifi,
  Gauge, RefreshCw, Edit2, Trash2, CheckCircle, AlertCircle, MapPin,
  ChevronDown, ChevronRight, Landmark } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import PhotoCapture from '../../components/shared/PhotoCapture';
import ArtifactImage from '../../components/shared/ArtifactImage';
import { getCurrentPrices, setPrice, getNozzles, getRfidTags, addRfidTag, getCalibrationCharts,
  getPumps, createPump, updatePump, deletePump, parsePumpSlip } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { INDIAN_STATES, getCities, displayMobile } from '../../lib/india';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useTranslation } from 'react-i18next';
import { nozName } from '../../lib/nozzle';
import { dipToVolume } from '../../lib/calibration';

import { errText } from '../../lib/apiError';
const FUEL_TYPES = [
  {value:'petrol',         label:'Petrol (MS)'},
  {value:'diesel',         label:'Diesel (HSD)'},
  {value:'premium_petrol', label:'Premium Petrol'},
  {value:'cng',            label:'CNG'},
  {value:'lubes',          label:'Lubes / Additives'},
];
const OIL_COS = ['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'];
const nowIST  = () => new Date().toLocaleString('sv-SE',{timeZone:'Asia/Kolkata'}).slice(0,16);
const fuelLabel = (v) => FUEL_TYPES.find(f=>f.value===v)?.label || v;

// Touch-target + font floor for the Pumps & Nozzles controls. The global `.input`
// is 38px tall at 14px, which is below the 44px target and below the 16px at which
// mobile browsers stop zooming the page on focus — so these screens size their own
// controls rather than inheriting.
const CTRL = {
  width:'100%', height:44, padding:'0 10px', fontSize:16,
  fontFamily:'var(--font-body)', color:'var(--text-1)',
  background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8,
};
const CTRL_NUM = { ...CTRL, fontVariantNumeric:'tabular-nums' };
const MICRO_LABEL = { fontSize:11, color:'var(--text-3)', display:'block', marginBottom:3 };



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
    {id:'pumps',   label:tc('setp.tabPumps', '3. Pumps & Nozzles'),  icon:null},
    {id:'prices',  label:tc('setp.tabPrices', '4. Fuel Prices'),     icon:<IndianRupee size={14}/>},
    {id:'rfid',    label:tc('setp.tabRfid', '5. RFID Tags'),         icon:<Wifi size={14}/>},
    {id:'shifts',  label:tc('setp.tabShifts', '6. Shift Timings'),   icon:<RefreshCw size={14}/>},
    {id:'geofence',label:tc('setp.tabGeofence', '7. Geo-Fencing'),   icon:<MapPin size={14}/>},
    {id:'accounts',label:tc('setp.tabAccounts', '8. Accounting'),    icon:<Landmark size={14}/>},
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
      {tab==='pumps' && (
        <PumpsTab stationId={stationId} nozzles={nozzles} tanks={tanks}
          reload={load} showToast={showToast} askConfirm={askConfirm}/>
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
      {tab==='accounts' && (
        <AccountsTab stationId={stationId}/>
      )}
    </AppShell>
  );
}

// ── Accounting Tab ─────────────────────────────────────────
// The single on/off switch for the OPTIONAL Accounts module. Written through the
// EXISTING settings endpoint — no route of its own (cardinal rule), mirroring the
// self-settlement toggle. Owner-only: an accounts on/off decision is the owner's,
// so a non-owner with settings access sees the state but can't flip it.
function AccountsTab({ stationId }) {
  const { station, user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = stationId || (typeof station==='object'?station?.id:station);
  const [on,setOn]     = useState(false);
  const [busy,setBusy] = useState(false);
  const isOwner = user?.role === 'owner';

  useEffect(()=>{
    if(!sid) return;
    api.get(`/stations/${sid}/settings`).then(s=>setOn(!!s?.accounts_enabled)).catch(()=>{});
  },[sid]);

  const toggle = async () => {
    if (!isOwner) return;
    setBusy(true);
    try {
      const r = await api.post(`/stations/${sid}/settings`, { accounts_enabled: !on });
      setOn(!!r?.accounts_enabled);
    } catch(e){ alert(errText(e, tc('setp.couldNotChangeMode', 'Could not change mode'))); }
    setBusy(false);
  };

  return (
    <div style={{maxWidth:560}}>
      <div className="card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{paddingRight:12}}>
            <div style={{fontWeight:700,fontSize:15}}>{tc('setp.accountsEnable', 'Accounts module')}</div>
            <div style={{fontSize:13,color:'#666',marginTop:2}}>
              {tc('setp.accountsEnableDesc', 'When ON, this outlet gets a bookkeeping layer — profit/loss, balance sheet and a finance dashboard, built from what Pumpini already records. When OFF, none of it shows and operations are unaffected. Switch it on one outlet at a time.')}
            </div>
            {!isOwner && (
              <div style={{fontSize:12,color:'var(--text-3)',marginTop:6}}>
                {tc('setp.accountsOwnerOnly', 'Only the outlet owner can switch this on or off.')}
              </div>
            )}
          </div>
          <button onClick={toggle} disabled={busy || !isOwner}
            style={{background:'none',border:'none',cursor:(busy||!isOwner)?'not-allowed':'pointer',padding:0,flexShrink:0,opacity:isOwner?1:0.5}}>
            <div style={{width:52,height:28,borderRadius:14,position:'relative',
              background: on ? '#16a34a' : '#e5e3de', transition:'all .2s'}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#fff',position:'absolute',top:3,
                left: on ? 27 : 3, transition:'all .2s',boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
            </div>
          </button>
        </div>
      </div>
    </div>
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
      invoice_fy:     info.invoice_fy||'',
      invoice_seq:    info.invoice_seq||'',
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
        {/* Credit-invoice numbering — per OUTLET, because each unit prints and numbers
            its own documents. Format is PREFIX/FY/SEQ so it reads like the series the
            customer already receives (e.g. BS/2026-2027/32). The number is allocated
            SERVER-SIDE inside the invoice transaction, so this screen only sets where
            the series starts. */}
        <div style={{marginBottom:'0.75rem',fontSize:12,fontWeight:700,color:'var(--text-3)',
                     textTransform:'uppercase',letterSpacing:'.06em'}}>
          {tc('setp.invoiceNumbering', 'Credit invoice numbering')}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:'0.5rem'}}>
          <div>
            <label className="label">{tc('setp.invoicePrefix', 'Prefix')}</label>
            <input className="input" placeholder="BS" maxLength={10} value={form.invoice_prefix||''}
              onChange={e=>f('invoice_prefix',e.target.value.toUpperCase())}/>
          </div>
          <div>
            <label className="label">{tc('setp.invoiceFy', 'Financial year')}</label>
            <input className="input" placeholder="2026-2027" maxLength={9} value={form.invoice_fy||''}
              onChange={e=>f('invoice_fy',e.target.value)}/>
          </div>
          <div>
            <label className="label">{tc('setp.invoiceSeq', 'Next number')}</label>
            <input className="input" type="number" min={1} placeholder="32" value={form.invoice_seq||''}
              onChange={e=>f('invoice_seq',e.target.value)}/>
          </div>
        </div>
        <div style={{fontSize:11,color:'var(--text-3)',marginBottom:'1.25rem'}}>
          {form.invoice_fy
            ? tc('setp.invoiceNumHint', 'Next invoice will be {n}. "Next number" is used once and then advances on its own; the series restarts at 1 each financial year.')
                .replace('{n}', `${form.invoice_prefix||'INV'}/${form.invoice_fy}/${form.invoice_seq||1}`)
            : tc('setp.invoiceNumLegacy', 'Leave Financial year BLANK to keep this outlet\u2019s current numbering unchanged. Fill it in only for an outlet that should use the PREFIX/YEAR/NUMBER series — set "Next number" to continue a series your accounts package was already running.')}
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
  const [charts,setCharts] = useState([]);  // sizes already on file, named AAcm × BBcm
  // Entering a size not yet on file. The sheet's own word decides radius vs diameter.
  const [newSize,setNewSize] = useState(false);
  const [dimIs,setDimIs]     = useState('radius');
  const [dimVal,setDimVal]   = useState('');
  const [lenVal,setLenVal]   = useState('');
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  // What the backend stores is always the DIAMETER.
  const diameterCm = dimVal === '' ? null
    : (dimIs === 'radius' ? Number(dimVal) * 2 : Number(dimVal));
  const shellL = (diameterCm > 0 && Number(lenVal) > 0)
    ? dipToVolume(diameterCm, Number(lenVal), diameterCm) : null;

  const resetSize = () => { setNewSize(false); setDimIs('radius'); setDimVal(''); setLenVal(''); };

  useEffect(()=>{ getCalibrationCharts().then(c=>setCharts(Array.isArray(c)?c:[])).catch(()=>setCharts([])); },[]);

  const save = async(e) => {
    e.preventDefault(); setLoading(true);
    try {
      // Dimensions go to the ONE writer, which finds an existing row of that size or
      // creates it. Never a nominal capacity.
      const payload = newSize
        ? { ...form, diameter_cm: diameterCm, length_cm: Number(lenVal) || null }
        : form;
      if(editTank) await api.patch(`/stations/${stationId}/tanks/${editTank.id}`,payload);
      else         await api.post(`/stations/${stationId}/tanks`,payload);
      setForm(empty); setEdit(null); resetSize();
      // A new size must appear in the list straight away, or the next tank at this
      // outlet gets typed in again and a duplicate row is what we were avoiding.
      getCalibrationCharts().then(c=>setCharts(Array.isArray(c)?c:[])).catch(()=>{});
      reload();
    } catch(err){ alert(err.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  const del = (id) => askConfirm(
    tc('setp.confirmDeleteTank', 'Delete this tank? All linked nozzle assignments will also be removed. This cannot be undone.'),
    async()=>{ await api.delete(`/stations/${stationId}/tanks/${id}`); reload(); }
  );

  const startEdit = (t) => {
    setEdit(t);
    resetSize();
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
          {/* A TANK IS ITS DIMENSIONS. Owner-set 25-Aug-2026: "we will call the tank
              as AAcm X BBcm". The nominal-size dropdown (15KL / 16KL / 22KL) is gone
              — two tanks called "16 KL" were 1,255 L apart, and reading Sri Balaji's
              petrol off the wrong one over-stated it by 726 L for weeks. Pick a size
              already on file, or type the dimensions off the calibration sheet. */}
          <div style={{marginBottom:'1.25rem'}}>
            <label className="label">{tc('setp.tankSize', 'Tank Size (diameter × length) *')}</label>
            <select className="input" value={newSize ? '__new' : (form.calibration_chart_id||'')}
              onChange={e=>{
                const v = e.target.value;
                if (v === '__new') { setNewSize(true); f('calibration_chart_id', null); }
                else { setNewSize(false); f('calibration_chart_id', v || null); }
              }}>
              <option value="">{tc('setp.calibNone', '— Not set (enter litres by hand at every dip) —')}</option>
              {charts.map(c=>(
                <option key={c.id} value={c.id}>
                  {c.name} · {Number(c.capacity_ltrs||0).toLocaleString('en-IN')} L
                  {c.tanks_using ? ` · ${c.tanks_using} ${c.tanks_using===1?'tank':'tanks'}` : ''}
                </option>
              ))}
              <option value="__new">{tc('setp.calibNew', '+ New size — enter the dimensions')}</option>
            </select>

            {newSize && (
              <div style={{marginTop:8,padding:10,border:'1px solid var(--border)',borderRadius:8,background:'var(--bg-2)'}}>
                {/* HP prints the RADIUS; we store the DIAMETER. Getting this backwards
                    doubles or halves the tank, so the sheet's own word is asked for
                    rather than assumed. See docs/reference/README.md. */}
                <div style={{display:'flex',gap:6,marginBottom:6}}>
                  <select className="input" style={{flex:'0 0 108px'}} value={dimIs}
                    onChange={e=>setDimIs(e.target.value)}>
                    <option value="radius">{tc('setp.radius', 'Radius')}</option>
                    <option value="diameter">{tc('setp.diameter', 'Diameter')}</option>
                  </select>
                  <input className="input" type="number" step="0.1" min="1" style={{flex:1}}
                    placeholder={tc('setp.egRadius', 'e.g. 101')} value={dimVal}
                    onChange={e=>setDimVal(e.target.value)}/>
                  <span style={{alignSelf:'center',fontSize:12,color:'var(--text-3)'}}>cm</span>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <span style={{flex:'0 0 108px',alignSelf:'center',fontSize:13}}>{tc('setp.length', 'Length')}</span>
                  <input className="input" type="number" step="0.1" min="1" style={{flex:1}}
                    placeholder={tc('setp.egLength', 'e.g. 500')} value={lenVal}
                    onChange={e=>setLenVal(e.target.value)}/>
                  <span style={{alignSelf:'center',fontSize:12,color:'var(--text-3)'}}>cm</span>
                </div>
                {/* The shell volume, shown live. It must match the LAST ROW of the
                    calibration sheet. If it does not, the sheet is not this tank's
                    sheet — which is exactly what went unnoticed at Sri Balaji. */}
                {shellL != null && (
                  <div style={{marginTop:8,fontSize:12}}>
                    <strong>{Number(shellL).toLocaleString('en-IN',{maximumFractionDigits:0})} L</strong>
                    {' '}{tc('setp.shellHint', 'full. Check this against the LAST row of the calibration sheet — if it disagrees, that sheet belongs to a different tank.')}
                  </div>
                )}
              </div>
            )}

            <div style={{fontSize:11,color:'var(--text-3)',marginTop:4}}>
              {tc('setp.calibHint2', 'Converts dip → litres at shift open/close. Enter the dimensions from the OMC calibration sheet, not the tank’s nominal size — two tanks both called "16 KL" can differ by over 1,000 litres.')}
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" type="submit" style={{flex:1,justifyContent:'center'}} disabled={loading}>
              {loading?tc('setp.saving', 'Saving...'):(editTank?tc('setp.updateTank', 'Update Tank'):tc('setp.addTank', 'Add Tank'))}
            </button>
            {editTank && (
              <button className="btn btn-secondary" type="button"
                onClick={()=>{ setEdit(null); setForm(empty); resetSize(); }}>{tc('setp.cancel', 'Cancel')}</button>
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
              <thead><tr><th>{tc('setp.thTankNum', 'Tank #')}</th><th>{tc('setp.thFuel', 'Fuel')}</th><th>{tc('setp.thCapacity', 'Capacity')}</th><th>{tc('setp.thSize', 'Size (D × L)')}</th><th>{tc('setp.thCurrentStock', 'Current Stock')}</th><th>{tc('setp.thFillPct', 'Fill %')}</th><th>{tc('setp.thActions', 'Actions')}</th></tr></thead>
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
          💡 {tc('setp.nextNozzlesPre', 'Next: Go to')} <strong>{tc('setp.tabPumps', '3. Pumps & Nozzles')}</strong> {tc('setp.nextPumpsPost', 'tab to define each pump and link its nozzles to a tank')}
        </div>
      </div>
    </div>
  );
}

// ── Pumps & Nozzles Tab ────────────────────────────────────
// A PUMP IS A MACHINE: a number, a serial, a model and the slip it prints. It has
// NO fuel and NO tank — one unit routinely dispenses several grades from several
// tanks (2 HSD + 1 MS + 1 Super is ordinary), so fuel and tank belong to the
// NOZZLE. Attaching either to the pump would force an outlet to split one physical
// unit into four fictional ones.
//
// This tab replaces the old standalone Nozzles tab. The whole point of the merge is
// that a nozzle is added FROM INSIDE its pump card, so there is no "which pump?"
// dropdown to get wrong — the pump is the context. Do not reintroduce that field.
//
// Everything here rides owner-run DDL (`pumps`, `nozzles.pump_id`,
// `nozzles.slip_nozzle_no`), which lands AFTER this code deploys. So: a failing
// pumps read degrades to an empty state, and a nozzle with no `pump_id` simply
// reads as unassigned — which is also exactly the state every existing nozzle is
// in on the day the migration runs.
function PumpsTab({ stationId, nozzles, tanks, reload, showToast, askConfirm }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [pumps,   setPumps]   = useState([]);
  const [loose,   setLoose]   = useState(null);   // server's unassigned list; null → not answered
  const [pumpsUp, setPumpsUp] = useState(true);   // false → endpoint/table not there yet
  const [booting, setBooting] = useState(true);
  const [open,    setOpen]    = useState({});     // pump id → explicit expand/collapse
  const [addFor,  setAddFor]  = useState(null);   // pump id currently showing the new-nozzle row
  const [showUnassigned, setShowUnassigned] = useState(false);

  const loadPumps = async () => {
    if (!stationId) { setBooting(false); return; }
    try {
      // The endpoint answers { pumps, unassigned } — the loose nozzles ride along in
      // the same payload precisely so this screen can show them at the top without a
      // second call. A bare array is tolerated in case that shape is ever flattened.
      const r = await getPumps(stationId);
      setPumps(Array.isArray(r) ? r : (Array.isArray(r?.pumps) ? r.pumps : []));
      setLoose(Array.isArray(r?.unassigned) ? r.unassigned : null);
      setPumpsUp(true);
    } catch {
      // 404/500 before the DDL runs. Not an error the owner can act on — show the
      // empty state and keep the nozzles below editable.
      setPumps([]); setLoose(null); setPumpsUp(false);
    } finally { setBooting(false); }
  };

  useEffect(() => { loadPumps(); }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => { await loadPumps(); reload(); };

  const livePumps = pumps.filter(p => !p.end_date);
  // The server nests each pump's LIVE nozzles, so that list is the authority on what
  // hangs off a machine — not a client-side filter that would also have to know about
  // end-dating.
  const nozzlesOf = (p) => (Array.isArray(p.nozzles) ? p.nozzles : []);

  // Membership comes from the server's `unassigned`, but the rows are re-joined to the
  // full nozzle list so the inline editor has every column (the summary rows carry
  // only id/number/fuel/tank). When the pumps read failed there is nothing to join
  // to, so fall back to deriving it — which before the DDL correctly reads as
  // "nothing is on a pump yet".
  const byId = new Map(nozzles.map(n => [n.id, n]));
  const unassigned = (loose !== null)
    ? loose.map(n => byId.get(n.id) || n)
    : nozzles.filter(n => !n.pump_id && !n.end_date && n.is_active !== false);

  const isOpen = (p) => (open[p.id] !== undefined ? open[p.id] : nozzlesOf(p).length === 0);

  // Pull an existing loose nozzle onto this pump. Assignment is driven FROM the
  // pump, which is what lets the unassigned banner count down without ever asking
  // "which pump?" from the nozzle's side.
  const assignTo = async (nozzle, pump) => {
    try {
      await api.patch(`/stations/${stationId}/nozzles/${nozzle.id}`, { pump_id: pump.id });
      showToast(tc('setp.toastNozzleMoved', 'Nozzle moved to this pump'));
      refresh();
    } catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); }
  };

  const delNozzle = (n) => askConfirm(
    tc('setp.confirmDeleteNozzle', 'Delete this nozzle? Historical transaction data will be preserved.'),
    async () => { try { await api.delete(`/stations/${stationId}/nozzles/${n.id}`); } catch { /* already gone */ } refresh(); }
  );

  // ONE action, because the server owns the decision: a pump that never carried a
  // nozzle is deleted outright, one that has history is end-dated instead, and one
  // that still has LIVE nozzles is refused with a 409 telling the owner to move them
  // first. Splitting that into a "delete" and a "retire" button on this side would be
  // the screen second-guessing the writer — and the retire path would sail straight
  // past the guard that protects the meter history.
  const removePump = (p) => askConfirm(
    tc('setp.confirmRemovePump', 'Retire this pump? A pump that has ever been used is kept in history with today’s date, so every past meter reading still points at the machine it was taken on.'),
    async () => {
      try {
        const r = await deletePump(stationId, p.id);
        showToast(r?.retired ? tc('setp.toastPumpRetired', 'Pump retired')
                             : tc('setp.toastPumpDeleted', 'Pump deleted'));
        refresh();
      } catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); }   // 409 message lands here
    }
  );

  return (
    <div style={{maxWidth:1000}}>
      {/* The inline nozzle row is a grid on a desktop and a stack on a phone. It has
          to be a stylesheet, not an inline style: inline styles cannot carry a media
          query, and this row MUST NOT overflow sideways on a forecourt handset. */}
      <style>{`
        .pn-row { display:grid; grid-template-columns:96px minmax(0,1.1fr) minmax(0,1.1fr) 104px 48px;
                  gap:10px; align-items:end; padding:10px 0; border-top:1px solid var(--border); }
        @media (max-width: 600px) {
          .pn-row { grid-template-columns:1fr; align-items:stretch; gap:8px;
                    border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:10px; }
        }
      `}</style>

      {/* 1 ── Nozzles with no pump. A to-do list that counts down to zero, and it
              disappears the moment it hits zero. Every nozzle that existed before
              pumps did starts here. */}
      {unassigned.length > 0 && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:12,
          padding:'1rem 1.15rem',marginBottom:'1.25rem'}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
            <AlertCircle size={18} color="var(--warning)" style={{marginTop:2,flexShrink:0}}/>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontWeight:800,fontSize:15,color:'#9a3412'}}>
                {tc('setp.unassignedTitle', 'Not on a pump yet ({n})').replace('{n}', unassigned.length)}
              </div>
              <div style={{fontSize:13,color:'#9a3412',marginTop:3}}>
                {tc('setp.unassignedDesc', 'Open a pump below and use “Move a nozzle here”. This list should end up empty.')}
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:10}}>
                {unassigned.map(n => (
                  <span key={n.id} style={{display:'inline-flex',alignItems:'center',gap:6,
                    padding:'6px 11px',borderRadius:999,background:'#fff',border:'1px solid #fed7aa',
                    fontSize:13,fontWeight:600,color:'#9a3412',fontVariantNumeric:'tabular-nums'}}>
                    {nozName(n)} · {fuelLabel(n.fuel_type)}
                  </span>
                ))}
              </div>
              <button type="button" onClick={()=>setShowUnassigned(v=>!v)}
                style={{marginTop:10,minHeight:44,padding:'0 14px',background:'#fff',
                  border:'1px solid #fed7aa',borderRadius:8,cursor:'pointer',
                  fontSize:14,fontWeight:700,color:'#9a3412'}}>
                {showUnassigned ? tc('setp.hideDetails', 'Hide details')
                                : tc('setp.editThese', 'Edit these nozzles')}
              </button>
            </div>
          </div>
          {/* Kept editable so nothing is lost while the nozzles are still loose —
              including on an outlet where the pumps endpoint is not live yet. */}
          {showUnassigned && (
            <div style={{marginTop:12,background:'#fff',borderRadius:10,border:'1px solid #fed7aa',padding:'4px 12px'}}>
              {unassigned.map(n => (
                <NozzleRow key={n.id} stationId={stationId} nozzle={n} tanks={tanks}
                  tc={tc} onChanged={refresh} onDelete={()=>delNozzle(n)}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2 ── The pumps */}
      {booting && (
        <div style={{color:'var(--text-3)',fontSize:14,padding:'1.5rem 0'}}>
          {tc('setp.loadingPumps', 'Loading pumps…')}
        </div>
      )}

      {/* The catch above cannot tell a not-yet-migrated database from a backend
          that is still deploying or briefly down — both arrive as one rejected
          promise. So say what is TRUE (we could not load them) and offer the
          action that fixes the common case, instead of asserting a per-outlet
          feature switch that does not exist. The first wording sent two people
          hunting for a setting that was never there. */}
      {!booting && !pumpsUp && (
        <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,
          padding:'0.85rem 1rem',marginBottom:'1.25rem',fontSize:13,color:'#92400e',
          display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{flex:1,minWidth:220}}>
            {tc('setp.pumpsLoadFailed', 'Could not load pumps just now. If the app was updated in the last few minutes, give it a moment and try again.')}
          </span>
          <button onClick={loadPumps}
            style={{minHeight:44,padding:'0 18px',background:'#92400e',color:'#fff',border:'none',
              borderRadius:9,fontWeight:700,fontSize:14,cursor:'pointer'}}>
            {tc('setp.retry', 'Try again')}
          </button>
        </div>
      )}

      {!booting && pumpsUp && livePumps.length === 0 && (
        <div style={{color:'var(--text-3)',fontSize:14,padding:'1.5rem',textAlign:'center',
          border:'1px dashed var(--border)',borderRadius:12,marginBottom:'1.25rem'}}>
          {tc('setp.noPumps', 'No pumps yet. Add your first pump below — then add its nozzles inside it.')}
        </div>
      )}

      {livePumps.map(p => {
        const mine = nozzlesOf(p);
        const expanded = isOpen(p);
        return (
          <div key={p.id} className="card" style={{marginBottom:'1rem',padding:0,overflow:'hidden'}}>
            {/* Collapsed summary — the resting state once a pump is configured. The
                slip thumbnail sits OUTSIDE the toggle button: it opens its own
                full-size overlay, and a control that expands the card on the way to
                zooming an image is a control that does two things at once. */}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'0 14px 0 0'}}>
              <button type="button" onClick={()=>setOpen(o=>({...o,[p.id]:!expanded}))}
                aria-expanded={expanded}
                style={{flex:1,minWidth:0,minHeight:60,display:'flex',alignItems:'center',gap:12,
                  padding:'12px 14px',background:'none',border:'none',cursor:'pointer',textAlign:'left'}}>
                {expanded ? <ChevronDown size={18} color="var(--text-3)"/> : <ChevronRight size={18} color="var(--text-3)"/>}
                {/* A pump is named by its SERIAL — the identity it prints on every slip
                    and the half that starts each of its nozzles' names. `pump_number` is
                    our own forecourt index: it stays as the unique key and stays on the
                    edit form, but it no longer fronts the card, because nobody outside
                    this codebase can verify it. A pump with no serial recorded says so
                    plainly rather than showing a number in its place. */}
                <span style={{minWidth:0,flex:1}}>
                  <span style={{display:'block',fontWeight:800,fontSize:14,color:'var(--text-1)',
                    fontVariantNumeric:'tabular-nums',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {p.serial || tc('setp.pumpNoSerial', 'No serial recorded')}
                    {p.model && <span style={{fontWeight:400,color:'var(--text-3)'}}> · {p.model}</span>}
                  </span>
                  <span style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:5}}>
                    {p.slip_artifact_id && (
                      <span style={{fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:999,
                        background:'#dcfce7',color:'#15803d'}}>{tc('setp.slipOnFile', 'Slip on file')}</span>
                    )}
                    <span style={{fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:999,
                      background:mine.length?'var(--surface-2)':'#fee2e2',
                      color:mine.length?'var(--text-2)':'#b91c1c',fontVariantNumeric:'tabular-nums'}}>
                      {tc('setp.nNozzles', '{n} nozzles').replace('{n}', mine.length)}
                    </span>
                    {p.is_active === false && (
                      <span style={{fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:999,
                        background:'var(--surface-2)',color:'var(--text-3)'}}>{tc('setp.inactive', 'Inactive')}</span>
                    )}
                  </span>
                </span>
              </button>
              {p.slip_artifact_id && <ArtifactImage artifactId={p.slip_artifact_id} size={40}
                label={tc('setp.slipOnFile', 'Slip on file')}/>}
            </div>

            {expanded && (
              <div style={{padding:'0 14px 14px',borderTop:'1px solid var(--border)'}}>
                <PumpDetails stationId={stationId} pump={p} tc={tc} onChanged={refresh}/>

                {/* 3 ── Inline nozzle rows. Editing happens right here. */}
                <div style={{fontWeight:700,fontSize:13,color:'var(--text-2)',margin:'14px 0 2px'}}>
                  {tc('setp.nozzlesOnPump', 'Nozzles on this pump')}
                </div>
                {mine.length === 0 && (
                  <div style={{color:'var(--text-3)',fontSize:13,padding:'12px 0'}}>
                    {tc('setp.noNozzlesOnPump', 'No nozzles on this pump yet.')}
                  </div>
                )}
                {mine.map(n => (
                  <NozzleRow key={n.id} stationId={stationId} nozzle={n} tanks={tanks}
                    tc={tc} onChanged={refresh} onDelete={()=>delNozzle(n)}/>
                ))}

                {/* 4 ── Add a nozzle INSIDE the pump. No "which pump?" field: the
                        card you are in IS the answer. */}
                {addFor === p.id ? (
                  <NewNozzleRow stationId={stationId} pump={p} tanks={tanks} tc={tc}
                    onCancel={()=>setAddFor(null)}
                    onAdded={()=>{ setAddFor(null); showToast(tc('setp.toastNozzleAdded', 'Nozzle added')); refresh(); }}/>
                ) : (
                  <button type="button" onClick={()=>setAddFor(p.id)}
                    style={{marginTop:10,minHeight:44,padding:'0 16px',width:'100%',
                      background:'var(--brand-light)',border:'1.5px dashed var(--brand)',
                      borderRadius:9,cursor:'pointer',color:'var(--brand-dark)',
                      fontWeight:700,fontSize:14,display:'flex',alignItems:'center',
                      justifyContent:'center',gap:6}}>
                    <Plus size={15}/>{tc('setp.addNozzleHere', 'Add nozzle')}
                  </button>
                )}

                {/* Loose nozzles can be pulled in from here — same principle, the
                    pump is the context. */}
                {unassigned.length > 0 && (
                  <div style={{marginTop:14,paddingTop:12,borderTop:'1px dashed var(--border)'}}>
                    <div style={{fontSize:12,color:'var(--text-3)',marginBottom:7}}>
                      {tc('setp.moveHere', 'Move a nozzle here:')}
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                      {unassigned.map(n => (
                        <button key={n.id} type="button" onClick={()=>assignTo(n, p)}
                          style={{minHeight:44,padding:'0 13px',borderRadius:999,cursor:'pointer',
                            background:'#fff',border:'1px solid #fed7aa',color:'#9a3412',
                            fontSize:14,fontWeight:700,fontVariantNumeric:'tabular-nums',
                            display:'inline-flex',alignItems:'center',gap:6}}>
                          <Plus size={14}/>{nozName(n)} · {fuelLabel(n.fuel_type)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{marginTop:16,paddingTop:12,borderTop:'1px solid var(--border)',
                  display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button type="button" onClick={()=>removePump(p)}
                    style={{minHeight:44,padding:'0 16px',background:'#fff',border:'1px solid #fecaca',
                      borderRadius:9,cursor:'pointer',color:'#b91c1c',fontWeight:700,fontSize:14,
                      display:'inline-flex',alignItems:'center',gap:6}}>
                    <Trash2 size={14}/>{tc('setp.retirePump', 'Retire pump')}
                  </button>
                  {mine.length > 0 && (
                    <div style={{fontSize:11.5,color:'var(--text-3)',alignSelf:'center',flex:1,minWidth:180}}>
                      {tc('setp.retireNeedsEmpty', 'Move or delete its nozzles first — a pump is not retired out from under live meters.')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 5 ── Add a pump */}
      <AddPumpForm stationId={stationId} tc={tc}
        onAdded={()=>{ showToast(tc('setp.toastPumpAdded', 'Pump added!')); refresh(); }}/>

      <div style={{fontSize:11,color:'var(--text-3)',marginTop:'0.75rem'}}>
        💡 {tc('setp.nextNozzlesPre', 'Next: Go to')} <strong>{tc('setp.tabPrices', '4. Fuel Prices')}</strong> {tc('setp.nextPricesPost', 'to set current prices')}
      </div>
    </div>
  );
}

// Pump identity, editable in place. Saved on blur so there is no second "save"
// button competing with the card's own actions.
function PumpDetails({ stationId, pump, tc, onChanged }) {
  const [d, setD] = useState({ pump_number:'', serial:'', model:'' });
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState('');
  const [slipSlot, setSlipSlot] = useState(0);

  useEffect(() => {
    setD({ pump_number: pump.pump_number || '', serial: pump.serial || '', model: pump.model || '' });
  }, [pump.id, pump.pump_number, pump.serial, pump.model]);

  const commit = async (key) => {
    const was = pump[key] || '';
    const now = d[key] || '';
    if (was === now) return;
    if (key === 'pump_number' && !now.trim()) { setD(p=>({...p, pump_number: pump.pump_number || ''})); return; }
    setBusy(true);
    try { await updatePump(stationId, pump.id, { [key]: now.trim() || null }); onChanged(); }
    catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); setD(p=>({...p,[key]:was})); }
    finally { setBusy(false); }
  };

  // Fix a serial on an EXISTING pump by photographing its slip — the same reader the
  // Add-pump form uses (parse-pump-slip). Typing a serial off a thermal printout is
  // the step most likely to be got wrong, and a mis-typed serial silently breaks every
  // future slip match on that machine. Read → prefilled → saved, then shown so the
  // owner verifies it against the paper. Model fills only when it is currently blank,
  // so a scan never overwrites a model the owner has already set by hand.
  const onSlip = async (img) => {
    setReadMsg('');
    if (!img?.base64) return;
    setReading(true);
    try {
      const r = await parsePumpSlip(stationId, { file_base64: img.base64, media_type: img.media_type });
      const got = []; const patch = {};
      if (r?.pump_serial) { patch.serial = r.pump_serial; got.push(tc('setp.gotSerial', 'serial')); }
      if (r?.model && !d.model) { patch.model = r.model; got.push(tc('setp.gotModel', 'model')); }
      if (Object.keys(patch).length) {
        setD(p => ({ ...p, ...patch }));
        try { await updatePump(stationId, pump.id, patch); onChanged(); }
        catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); }
      }
      setReadMsg(got.length
        ? tc('setp.readOk', 'Read the {x} off the slip — check them against the paper.').replace('{x}', got.join(' and '))
        : tc('setp.readNothing', 'Could not find a serial on that slip — type it from the paper.'));
    } catch (e) {
      setReadMsg(e?.error || tc('setp.readFailed', 'Could not read that slip — type the serial and model from it.'));
    } finally { setReading(false); setSlipSlot(n => n + 1); }
  };

  return (
    <div style={{ paddingTop:12 }}>
      <div style={{ marginBottom:12 }}>
        <PhotoCapture
          key={slipSlot}
          label={tc('setp.scanSerial', 'Scan a slip to read the serial')}
          retakeLabel={tc('setp.retakePhoto', 'Retake')}
          hint={tc('setp.scanSerialHint', 'Reads the serial (and model) off the slip and saves it — check it against the paper below.')}
          onCapture={onSlip}
          disabled={busy || reading}
          removeLabel={tc('photo.remove', 'Remove')}/>
        {reading && <div style={{fontSize:12.5,color:'var(--text-3)',marginTop:8}}>{tc('setp.readingSlip', 'Reading the slip…')}</div>}
        {!reading && readMsg && <div style={{fontSize:12.5,color:'#b45309',marginTop:8}}>{readMsg}</div>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',
        gap:10}}>
      <div>
        <label style={MICRO_LABEL}>{tc('setp.pumpNumber', 'Pump number')}</label>
        <input style={CTRL_NUM} type="text" inputMode="decimal" maxLength={16} disabled={busy}
          value={d.pump_number} onChange={e=>setD(p=>({...p,pump_number:e.target.value}))}
          onBlur={()=>commit('pump_number')}/>
      </div>
      <div>
        <label style={MICRO_LABEL}>{tc('setp.pumpSerial', 'Serial number')}</label>
        <input style={CTRL_NUM} type="text" maxLength={40} disabled={busy}
          placeholder={tc('setp.egSerial', 'e.g. 15BC1412V')}
          value={d.serial} onChange={e=>setD(p=>({...p,serial:e.target.value.toUpperCase()}))}
          onBlur={()=>commit('serial')}/>
      </div>
      <div>
        <label style={MICRO_LABEL}>{tc('setp.pumpModel', 'Model')}</label>
        <input style={CTRL} type="text" maxLength={60} disabled={busy}
          placeholder={tc('setp.egModel', 'e.g. Gilbarco SK700')}
          value={d.model} onChange={e=>setD(p=>({...p,model:e.target.value}))}
          onBlur={()=>commit('model')}/>
      </div>
      </div>
    </div>
  );
}

// One nozzle, edited in place. Selects save on change; text fields save on blur —
// so a serial typed a character at a time is not thirty PATCHes.
function NozzleRow({ stationId, nozzle, tanks, tc, onChanged, onDelete }) {
  const [d, setD] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setD({
      nozzle_number:  nozzle.nozzle_number || '',
      fuel_type:      nozzle.fuel_type || 'petrol',
      tank_id:        nozzle.tank_id || '',
      is_active:      nozzle.is_active !== false,
    });
  }, [nozzle.id, nozzle.nozzle_number, nozzle.fuel_type, nozzle.tank_id, nozzle.is_active]);

  const save = async (patch) => {
    const next = { ...d, ...patch };
    setD(next);
    setBusy(true);
    try {
      await api.patch(`/stations/${stationId}/nozzles/${nozzle.id}`, {
        nozzle_number:  next.nozzle_number,
        fuel_type:      next.fuel_type,
        tank_id:        next.tank_id || null,
        is_active:      next.is_active,
      });
      onChanged();
    } catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); }
    finally { setBusy(false); }
  };

  // Only same-fuel tanks are offerable, but a tank already linked stays listed even
  // if the fuel was changed — otherwise the row would silently show "no tank" for a
  // nozzle that plainly has one.
  const tankOpts = tanks.filter(t => t.fuel_type === d.fuel_type || t.id === d.tank_id);

  return (
    <>
    {/* The name this nozzle carries on every other screen and in every export —
        <pump serial>.<nozzle number>, exactly as its slip prints it. Shown here,
        read-only, so Settings is where the convention can be CHECKED against the
        paper rather than a place it quietly diverges. */}
    <div style={{fontSize:12.5,fontWeight:800,color:'var(--brand-dark)',
      fontVariantNumeric:'tabular-nums',margin:'10px 0 2px'}}>
      {nozName(nozzle)}
    </div>
    <div className="pn-row">
      <div>
        <label style={MICRO_LABEL}>{tc('setp.thNozzleNumInternal', 'Internal #')}</label>
        {/* Free text, not a number: outlets label nozzles 5.1, 5.2, 5.3 (pump.nozzle)
            and nothing does arithmetic on the value. This is OUR key — it orders the
            lists and it supplies the printed nozzle number when slip_nozzle_no is
            unset. It is not what any screen shows; the name above is. */}
        <input style={CTRL_NUM} type="text" inputMode="decimal" maxLength={8} disabled={busy}
          value={d.nozzle_number || ''}
          onChange={e=>setD(p=>({...p,nozzle_number:e.target.value}))}
          onBlur={()=>{ if ((d.nozzle_number||'') !== (nozzle.nozzle_number||'')) save({}); }}/>
      </div>
      <div>
        <label style={MICRO_LABEL}>{tc('setp.thFuelType', 'Fuel Type')}</label>
        <select style={CTRL} disabled={busy} value={d.fuel_type || 'petrol'}
          onChange={e=>save({ fuel_type:e.target.value })}>
          {FUEL_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
        </select>
      </div>
      <div>
        <label style={MICRO_LABEL}>{tc('setp.thLinkedTank', 'Linked Tank')}</label>
        <select style={CTRL} disabled={busy} value={d.tank_id || ''}
          onChange={e=>save({ tank_id:e.target.value })}>
          <option value="">{tc('setp.selectTank', 'Select tank...')}</option>
          {tankOpts.map(t => (
            <option key={t.id} value={t.id}>
              {tc('setp.tankLabel', 'Tank {n}').replace('{n}', t.tank_number)} — {fuelLabel(t.fuel_type)}
            </option>
          ))}
        </select>
      </div>
      {/* NO "slip no." FIELD. The slip prints the pump's SERIAL and a plain nozzle
          number, and the serial is already on the pump. So the name is derived —
          serial + printed nozzle number (nozzle "1" on serial M1832105 IS
          M1832105.1) — by pumpService, the one writer. Where slip_nozzle_no is unset
          the suffix of the internal number supplies it. Asking the manager to re-key
          what we can concatenate was a field with no answer. */}
      <div>
        <label style={MICRO_LABEL}>{tc('setp.thStatus', 'Status')}</label>
        <button type="button" disabled={busy} onClick={()=>save({ is_active: !d.is_active })}
          style={{width:'100%',height:44,borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:700,
            border:'1px solid ' + (d.is_active ? '#bbf7d0' : 'var(--border)'),
            background:  d.is_active ? '#dcfce7' : 'var(--surface-2)',
            color:       d.is_active ? '#15803d' : 'var(--text-3)'}}>
          {d.is_active ? tc('setp.active', 'Active') : tc('setp.inactive', 'Inactive')}
        </button>
      </div>
      <div>
        <button type="button" onClick={onDelete} disabled={busy}
          aria-label={tc('setp.deleteNozzle', 'Delete nozzle')}
          title={tc('setp.deleteNozzle', 'Delete nozzle')}
          style={{width:'100%',minWidth:44,height:44,borderRadius:8,cursor:'pointer',
            background:'#fff',border:'1px solid #fecaca',color:'#b91c1c',
            display:'flex',alignItems:'center',justifyContent:'center'}}>
          <Trash2 size={16}/>
        </button>
      </div>
    </div>
    </>
  );
}

// The add-a-nozzle row. Same shape as an existing row so the eye does not have to
// re-learn it, and deliberately WITHOUT a pump field — the caller supplies it.
function NewNozzleRow({ stationId, pump, tanks, tc, onAdded, onCancel }) {
  const [d, setD] = useState({ nozzle_number:'', fuel_type:'petrol', tank_id:'' });
  const [busy, setBusy] = useState(false);
  const f = (k,v) => setD(p=>({...p,[k]:v}));
  const tankOpts = tanks.filter(t => t.fuel_type === d.fuel_type);

  const add = async () => {
    if (!String(d.nozzle_number || '').trim()) return alert(tc('setp.nozzleNumberRequired', 'Enter a nozzle number'));
    setBusy(true);
    try {
      await api.post(`/stations/${stationId}/nozzles`, {
        nozzle_number:  String(d.nozzle_number).trim(),
        fuel_type:      d.fuel_type,
        tank_id:        d.tank_id || null,
        pump_id:        pump.id,
      });
      onAdded();
    } catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{marginTop:10,background:'var(--surface-2)',borderRadius:10,padding:'4px 12px 12px'}}>
      <div className="pn-row">
        <div>
          {/* OUR key, not a display name. Once saved, this nozzle is shown everywhere
              as <this pump's serial>.<its nozzle number> — see NozzleRow above. */}
          <label style={MICRO_LABEL}>{tc('setp.thNozzleNumInternal', 'Internal #')}</label>
          <input style={CTRL_NUM} type="text" inputMode="decimal" maxLength={8} autoFocus
            placeholder={tc('setp.egNozzle', 'e.g. 1 or 5.1')}
            value={d.nozzle_number} onChange={e=>f('nozzle_number', e.target.value)}/>
        </div>
        <div>
          <label style={MICRO_LABEL}>{tc('setp.thFuelType', 'Fuel Type')}</label>
          <select style={CTRL} value={d.fuel_type} onChange={e=>setD(p=>({...p,fuel_type:e.target.value,tank_id:''}))}>
            {FUEL_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
          </select>
        </div>
        <div>
          <label style={MICRO_LABEL}>{tc('setp.thLinkedTank', 'Linked Tank')}</label>
          <select style={CTRL} value={d.tank_id} onChange={e=>f('tank_id', e.target.value)}>
            <option value="">{tc('setp.selectTank', 'Select tank...')}</option>
            {tankOpts.map(t => (
              <option key={t.id} value={t.id}>
                {tc('setp.tankLabel', 'Tank {n}').replace('{n}', t.tank_number)} — {fuelLabel(t.fuel_type)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {tankOpts.length === 0 && (
        <div style={{fontSize:12,color:'var(--warning)',marginTop:2}}>
          ⚠ {tc('setp.noFuelTank', 'No {fuel} tank found. Add a tank first.').replace('{fuel}', fuelLabel(d.fuel_type))}
        </div>
      )}
      {/* The buttons sit on their own line rather than in the row's last columns:
          the confirm is this area's single primary and must not be clipped by a
          44px-wide cell when the label is a long Telugu string. */}
      <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
        <button type="button" onClick={add} disabled={busy}
          style={{minHeight:44,padding:'0 22px',borderRadius:8,border:'none',
            cursor:busy?'wait':'pointer',background:'#FF6B00',color:'#fff',
            fontWeight:700,fontSize:15}}>
          {busy ? tc('setp.saving', 'Saving...') : tc('setp.addNozzle', 'Add Nozzle')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          style={{minHeight:44,padding:'0 18px',borderRadius:8,cursor:'pointer',
            background:'#fff',border:'1px solid var(--border)',color:'var(--text-2)',
            fontWeight:700,fontSize:15,display:'inline-flex',alignItems:'center',gap:6}}>
          <X size={15}/>{tc('setp.cancel', 'Cancel')}
        </button>
      </div>
    </div>
  );
}

// Add a pump. The slip photograph comes first because it is where the serial is
// read from — but it is OPTIONAL, and so is the serial: a CNG dispenser prints no
// slip at all and must still be definable. Serial and model are plain fields here;
// there is no pump-slip parser to fill them in, so the photograph is kept as the
// evidence and the two are typed.
function AddPumpForm({ stationId, tc, onAdded }) {
  const [f, setF] = useState({ pump_number:'', serial:'', model:'' });
  const [slip, setSlip] = useState(null);   // { base64, media_type }
  // Bumped after a successful save so PhotoCapture REMOUNTS. Clearing `slip` alone
  // leaves the previous pump's thumbnail on screen, which reads as "not saved yet"
  // and invites a second press.
  const [slipSlot, setSlipSlot] = useState(0);
  // A pump with genuinely no printout — CNG dispensers do not print one, and Kamala
  // has one. Requiring a photo outright would make that pump undefinable, so the
  // gate is "photograph it OR say it has none", never "photograph it".
  const [noSlip, setNoSlip] = useState(false);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState('');

  // Photographing the slip READS it. Typing a serial off a thermal printout is the
  // step most likely to be got wrong, and a mistyped serial breaks every future scan
  // on that machine silently — the match just never fires and nobody knows why.
  // Prefilled, never auto-committed: the owner still sees and confirms both fields,
  // because the label varies by make ("PUMP SERIAL NUMBER" on one, "Pump SNo" on
  // another) and a mis-read is worth catching here rather than months later.
  const onSlip = async (img) => {
    setSlip(img); setReadMsg('');
    if (!img?.base64) return;
    setReading(true);
    try {
      const r = await parsePumpSlip(stationId, { file_base64: img.base64, media_type: img.media_type });
      const got = [];
      if (r?.pump_serial) { set('serial', r.pump_serial); got.push(tc('setp.gotSerial', 'serial')); }
      if (r?.model)       { set('model',  r.model);       got.push(tc('setp.gotModel', 'model')); }
      // Some layouts print the pump's own number (FP. ID / FIP No.). Offered as a
      // default only — the outlet calls its pumps whatever is painted on them, and
      // that is the name the staff use.
      if (r?.pump_id && !f.pump_number) set('pump_number', r.pump_id);
      setReadMsg(got.length
        ? tc('setp.readOk', 'Read the {x} off the slip — check them against the paper.').replace('{x}', got.join(' and '))
        : tc('setp.readNothing', 'Could not find a serial on that slip — type it from the paper.'));
    } catch (e) {
      setReadMsg(e?.error || tc('setp.readFailed', 'Could not read that slip — type the serial and model from it.'));
    } finally { setReading(false); }
  };
  const [busy, setBusy] = useState(false);
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  // A pump needs a number, and evidence of which machine it is — a slip photo, or
  // an explicit statement that it prints none.
  const canSave = !!f.pump_number.trim() && (!!slip || noSlip);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.pump_number.trim()) return alert(tc('setp.pumpNumberRequired', 'Enter the pump number'));
    setBusy(true);
    try {
      // The photograph travels WITH the create, the way every other artifact in
      // Pumpini is written — by the flow that produced it, in one call; there is no
      // separate upload endpoint to hold it against.
      //
      // pumpService stores it against the pump and links slip_artifact_id back, so
      // the picture that identified the machine is kept as evidence rather than
      // being read once and thrown away — the same gap that left coupons and gauge
      // screens unevidenced for months. Best-effort server-side: a pump still saves
      // when the camera or the store fails, and a CNG unit has no slip at all.
      await createPump(stationId, {
        pump_number: f.pump_number.trim(),
        serial:      f.serial.trim() || null,
        model:       f.model.trim()  || null,
        image_base64: slip?.base64 || undefined,
        media_type:   slip?.media_type || undefined,
      });
      setF({ pump_number:'', serial:'', model:'' });
      setSlip(null); setNoSlip(false); setReadMsg('');
      setSlipSlot(n => n + 1);   // remount, so the thumbnail actually disappears
      onAdded();
    } catch (err) { alert(err?.error || tc('setp.failed', 'Failed')); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="card" style={{marginTop:'0.5rem'}}>
      <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{tc('setp.addPumpTitle', 'Add a pump')}</div>
      <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:14}}>
        {tc('setp.addPumpDesc', 'A pump is the machine. Its fuels and tanks belong to its nozzles, which you add inside the pump once it exists. Serial and slip are OPTIONAL — a CNG dispenser prints no slip and can still be added.')}
      </div>

      <div style={{marginBottom:14}}>
        <PhotoCapture
          key={slipSlot}
          label={tc('setp.photographSlip', 'Photograph a slip from this pump')}
          retakeLabel={tc('setp.retakePhoto', 'Retake')}
          hint={tc('setp.slipHint2', 'Optional. We read the serial and model off the photo — check them below before saving.')}
          onCapture={onSlip}
          disabled={busy || reading || noSlip}
          removeLabel={tc('photo.remove', 'Remove')}/>
        <label style={{display:'inline-flex',alignItems:'center',gap:8,minHeight:44,
          fontSize:13,color:'var(--text-2)',cursor:'pointer',marginTop:4}}>
          <input type="checkbox" checked={noSlip} disabled={busy || reading}
            onChange={e=>{ setNoSlip(e.target.checked); if (e.target.checked) { setSlip(null); setReadMsg(''); setSlipSlot(n=>n+1); } }}/>
          {tc('setp.noSlipPrinted', 'This pump prints no slip (CNG)')}
        </label>
        {reading && <div style={{fontSize:12.5,color:'var(--text-3)',marginTop:8}}>
          {tc('setp.readingSlip', 'Reading the slip…')}
        </div>}
        {!reading && readMsg && <div style={{fontSize:12.5,color:'#b45309',marginTop:8}}>{readMsg}</div>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:14}}>
        <div>
          <label style={MICRO_LABEL}>{tc('setp.pumpNumberRequiredLabel', 'Pump number *')}</label>
          <input style={CTRL_NUM} type="text" inputMode="decimal" maxLength={16} required
            placeholder={tc('setp.egOne', 'e.g. 1')}
            value={f.pump_number} onChange={e=>set('pump_number', e.target.value)}/>
        </div>
        <div>
          <label style={MICRO_LABEL}>{tc('setp.pumpSerial', 'Serial number')}</label>
          <input style={CTRL_NUM} type="text" maxLength={40}
            placeholder={tc('setp.egSerial', 'e.g. 15BC1412V')}
            value={f.serial} onChange={e=>set('serial', e.target.value.toUpperCase())}/>
        </div>
        <div>
          <label style={MICRO_LABEL}>{tc('setp.pumpModel', 'Model')}</label>
          <input style={CTRL} type="text" maxLength={60}
            placeholder={tc('setp.egModel', 'e.g. Gilbarco SK700')}
            value={f.model} onChange={e=>set('model', e.target.value)}/>
        </div>
      </div>

      {/* GATED ON EVIDENCE, with one honest exception. The slip is what identifies
          the machine, so saving a pump without one produces a record that can never
          match a scan — better to stop it here than to leave a dead pump in the
          list. But a CNG dispenser prints nothing at all, so the gate is
          "photograph it OR declare it has none", never "photograph it". */}
      <button type="submit" disabled={busy || reading || !canSave}
        title={canSave ? undefined : tc('setp.needSlipTitle', 'Photograph a slip, or tick "prints no slip"')}
        style={{minHeight:48,padding:'0 26px',
          background:(busy||reading||!canSave)?'#cbd5e1':'#FF6B00',color:'#fff',border:'none',
          borderRadius:10,cursor:(busy||reading||!canSave)?'not-allowed':'pointer',fontWeight:700,fontSize:15}}>
        {busy ? tc('setp.saving', 'Saving...') : tc('setp.addPumpBtn', 'Add Pump')}
      </button>
      {!canSave && !busy && !reading && (
        <div style={{fontSize:12.5,color:'var(--text-3)',marginTop:8}}>
          {tc('setp.needSlipHint', 'Photograph a slip from this pump, or tick "prints no slip" above.')}
        </div>
      )}
    </form>
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
  const { station, user, refreshStationFlags } = useAuth();
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
  // Who closes an operator's line at this outlet. Both paths are permanent; this is
  // the outlet saying which one it runs, so the expectation is set rather than left
  // to whoever opens a screen first. Defaults ON — every existing outlet keeps the
  // behaviour it has today.
  const [selfSettle,setSelfSettle] = useState(true);
  const [selfBusy,setSelfBusy] = useState(false);
  // The hub-and-spokes MIGRATION FLAG. Off is the default and stays the default —
  // Kamala, Highway and Adhoc are working outlets and nothing here reaches them until
  // the owner flips this on one outlet at a time.
  const [hubSpokes,setHubSpokes] = useState(false);
  const [hubBusy,setHubBusy] = useState(false);
  // What still stands between this outlet and the switch, read from the SAME endpoint
  // the backend gate uses so the screen and the refusal cannot disagree.
  const [commReady, setCommReady] = useState(null);
  const isOwner = user?.role === 'owner';

  useEffect(()=>{
    if(!sid) return;
    api.get(`/shifts/definitions/${sid}`).then(d=>{ if(d?.length) setDefs(d); }).catch(()=>{});
    api.get(`/stations/${sid}/settings`).then(s=>{
      setMgrMode(!!s?.manager_blind_drop);
      setSelfSettle(s?.self_settlement_enabled !== false);
      setHubSpokes(!!s?.hub_spokes_migration_enabled);
      // Read through the SAME endpoint the gate uses, so the screen and the refusal
      // cannot disagree about what is missing.
      api.get(`/stations/${sid}/commissioning`).then(setCommReady).catch(() => setCommReady(null));
    }).catch(()=>{});
  },[sid]);

  const toggleMode = async () => {
    setModeBusy(true);
    try {
      const r = await api.patch(`/stations/${sid}/blind-drop-mode`, { manager_blind_drop: !mgrMode });
      setMgrMode(!!r?.manager_blind_drop);
    } catch(e){ alert(errText(e, tc('setp.couldNotChangeMode', 'Could not change mode'))); }
    setModeBusy(false);
  };

  const toggleSelfSettle = async () => {
    setSelfBusy(true);
    try {
      const r = await api.post(`/stations/${sid}/settings`, { self_settlement_enabled: !selfSettle });
      setSelfSettle(r?.self_settlement_enabled !== false);
    } catch(e){ alert(errText(e, tc('setp.couldNotChangeMode', 'Could not change mode'))); }
    setSelfBusy(false);
  };

  // Written through the EXISTING settings endpoint — no route of its own. The backend
  // refuses the flip while any shift is open at this outlet and answers with a sentence
  // naming the shift; errText() surfaces it as-is.
  const toggleHubSpokes = async () => {
    setHubBusy(true);
    try {
      const r = await api.post(`/stations/${sid}/settings`, { hub_spokes_migration_enabled: !hubSpokes });
      setHubSpokes(!!r?.hub_spokes_migration_enabled);
      api.get(`/stations/${sid}/commissioning`).then(setCommReady).catch(() => {});
      // TELL THE SIDEBAR. The flag is read once in AuthProvider (the sidebar remounts
      // on every navigation, so reading it there would cost a fetch per screen), and
      // that read keys on the STATION — which does not change when the switch is
      // flipped. Without this the new sidebar only appeared after a page reload.
      refreshStationFlags?.();
    } catch(e){ alert(errText(e, tc('setp.couldNotChangeMode', 'Could not change mode'))); }
    setHubBusy(false);
  };

  const save = async() => {
    setLoading(true);
    try { await api.post('/shifts/definitions',{station_id:sid,shifts:defs}); onSaved(); }
    catch(e){ alert(e.error||tc('setp.failed', 'Failed')); }
    finally{ setLoading(false); }
  };

  return (
    <div style={{maxWidth:560}}>
    {/* The hub-and-spokes MIGRATION FLAG (owner only). A switch that is meant to be
        deleted once every outlet has moved — presented as a migration, not a feature,
        so nobody mistakes it for a permanent setting. */}
    {isOwner && (
      <div className="card" style={{marginBottom:'1rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{paddingRight:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{fontWeight:700,fontSize:15}}>{tc('setp.hubSpokes', 'Hub-and-spokes flow')}</div>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',padding:'2px 6px',
                borderRadius:4,background:'#fdf0e3',color:'#b45309'}}>
                {tc('setp.hubSpokesBadge', 'MIGRATION')}
              </span>
            </div>
            <div style={{fontSize:13,color:'#666',marginTop:2}}>
              {tc('setp.hubSpokesDesc', 'When ON, this outlet stops working shift-by-shift. Shift Open and Shift Close leave the sidebar and the three spokes take their place — Tank Recon, Nozzle Events and Attendant Dues. One outlet at a time; every other outlet is untouched.')}
            </div>
            <div style={{fontSize:12,color:'var(--text-3)',marginTop:6}}>
              {tc('setp.hubSpokesUntouched', 'It does not touch history, credit, cash, petty cash or margins. It cannot be flipped while a shift is open here — close it first. To roll back, switch it off: the old sidebar and the old flow come straight back, and any recons taken meanwhile stay on file.')}
            </div>
            {/* THE THIRD REFUSAL, SAID BEFORE HE TAPS. The backend gates switching ON
                until every nozzle has been commissioned from a real slip, because the
                new flow matches money on <serial>.<printed no> and a guessed printed
                number puts one man's litres on another man's account. Showing the count
                here means he learns what is missing without meeting a 409 first. */}
            {!hubSpokes && commReady && !commReady.ready && (
              <div style={{fontSize:12,marginTop:8,padding:'8px 10px',borderRadius:7,
                background:'#fbeee4',color:'#9a3412'}}>
                {commReady.spokes_ready
                  ? `${commReady.missing} ${tc('setp.hubSpokesNotComm', 'of')} ${commReady.total} ${tc('setp.hubSpokesNotComm2', 'nozzles have not been commissioned from a slip yet, so the switch is held.')}`
                  : tc('setp.hubSpokesNoTables', 'The hub-and-spokes tables are not in this database yet.')}
                {' '}
                <a href="/settings/commissioning" style={{color:'#9a3412',fontWeight:700}}>
                  {tc('setp.hubSpokesGoComm', 'Commission them →')}
                </a>
              </div>
            )}
          </div>
          <button onClick={toggleHubSpokes} disabled={hubBusy}
            style={{background:'none',border:'none',cursor:hubBusy?'wait':'pointer',padding:0,flexShrink:0}}>
            <div style={{width:52,height:28,borderRadius:14,position:'relative',
              background: hubSpokes ? '#16a34a' : '#e5e3de', transition:'all .2s'}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#fff',position:'absolute',top:3,
                left: hubSpokes ? 27 : 3, transition:'all .2s',boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
            </div>
          </button>
        </div>
      </div>
    )}

    {/* Who closes an operator's line at this outlet (owner only) */}
    {isOwner && (
      <div className="card" style={{marginBottom:'1rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{paddingRight:12}}>
            <div style={{fontWeight:700,fontSize:15}}>{tc('setp.selfSettle', 'Operators settle their own line')}</div>
            <div style={{fontSize:13,color:'#666',marginTop:2}}>
              {tc('setp.selfSettleDesc', 'When ON, an operator closes his own line from the Settlement screen. When OFF, only the manager settles him at Shift Close, and an operator who opens Settlement is told so. Manager-led close works either way — this only decides whether the operator may do it himself.')}
            </div>
          </div>
          <button onClick={toggleSelfSettle} disabled={selfBusy}
            style={{background:'none',border:'none',cursor:selfBusy?'wait':'pointer',padding:0,flexShrink:0}}>
            <div style={{width:52,height:28,borderRadius:14,position:'relative',
              background: selfSettle ? '#16a34a' : '#e5e3de', transition:'all .2s'}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#fff',position:'absolute',top:3,
                left: selfSettle ? 27 : 3, transition:'all .2s',boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
            </div>
          </button>
        </div>
      </div>
    )}

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
