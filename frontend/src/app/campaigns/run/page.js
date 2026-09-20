'use client';
//
// Campaign Run — issuing a gift at the pump.
//
// Phone first: this is used standing at a dispenser, one-handed, in sunlight.
//
// THE SESSION IS THE SPINE. Opening it creates a draft row with a deadline the
// SERVER holds — a twenty-minute limit counted in the browser is counted by a
// clock the attendant owns. Everything captured hangs off that row, so the slip,
// the plate and the handover cannot be assembled from three different moments.
//
// THREE CAPTURES, and the weaker the machine reading, the stronger the human
// proof required:
//   slip     — what was filled. Photographed always where the outlet is strict.
//   plate    — WHICH car. READ, never typed, while the camera can manage it.
//   handover — that it was actually given. Optional after an OCR'd plate,
//              MANDATORY after a typed one, and the database refuses the row
//              without it (gi_manual_needs_handover).
//
// The screen never decides eligibility. It asks the server, which asks the tier
// ladder, and the unique index settles double-awards at the write.
import { useState, useEffect, useRef } from 'react';
import { Gift, Camera, Loader, Check, X, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import Banner from '../../../components/shared/Banner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText, errCode } from '../../../lib/apiError';

const inp = {width:'100%',padding:'11px 13px',border:'1.5px solid #e5e3de',borderRadius:9,
  fontSize:15,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

const readB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read image'));
  r.readAsDataURL(file);
});

const num = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const mmss = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
};

export default function CampaignRunPage() {
  if (typeof window === 'undefined') return null;
  const { station, user } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const fuelLabel = id => ({
    petrol: tc('crun.petrol','Petrol'), diesel: tc('crun.diesel','Diesel'),
    cng: tc('crun.cng','CNG'), premium_petrol: tc('crun.premium','Premium'),
  }[id] || id);
  const REASONS = [
    ['out_of_stock',   tc('crun.rOut','Out of stock')],
    ['driver_refused', tc('crun.rRefused','Driver refused it')],
    ['damaged',        tc('crun.rDamaged','Damaged piece')],
    ['other',          tc('crun.rOther','Something else')],
  ];

  const [live, setLive]       = useState(null);   // { campaign, within_hours, slip_ocr_required, … }
  const [issue, setIssue]     = useState(null);   // the draft row
  const [step, setStep]       = useState(1);
  const [left, setLeft]       = useState(0);      // ms remaining on the session
  const [busy, setBusy]       = useState('');
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [done, setDone]       = useState(null);   // the settled row

  // step 1
  const [fill, setFill]       = useState({ fuel_type:'diesel', litres:'', bill_no:'' });
  const [slipShot, setSlipShot] = useState(null); // { file_base64, media_type }
  // step 2
  const [tries, setTries]     = useState(0);
  const [plate, setPlate]     = useState(null);   // { plate, legible, notes }
  const [plateShot, setPlateShot] = useState(null);
  const [typedPlate, setTypedPlate] = useState('');
  const [manualMode, setManualMode] = useState(false);
  // step 3
  const [award, setAward]     = useState(null);   // { tier, already }
  const [handover, setHandover] = useState(null);
  const [consent, setConsent] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason]   = useState('out_of_stock');
  const [reasonNote, setReasonNote] = useState('');

  const say = (m, good) => { if (good) { setOk(m); setErr(''); } else { setErr(m); setOk(''); } };
  const tick = useRef(null);

  useEffect(() => {
    if (!stationId) return;
    (async () => {
      try { setLive(await api.get('/campaigns/live/running', { params:{ station_id: stationId } })); }
      catch (e) { say(errText(e, tc('crun.loadFailed','Could not check for a running campaign.')), false); }
    })();
  }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The countdown reads the SERVER's expires_at. It is a display of the deadline,
  // never the deadline itself — the server refuses a dead session whatever this says.
  useEffect(() => {
    clearInterval(tick.current);
    if (!issue?.expires_at) return;
    const upd = () => setLeft(new Date(issue.expires_at).getTime() - Date.now());
    upd();
    tick.current = setInterval(upd, 1000);
    return () => clearInterval(tick.current);
  }, [issue?.expires_at]);

  const reset = () => {
    setIssue(null); setStep(1); setDone(null);
    setFill({ fuel_type:'diesel', litres:'', bill_no:'' }); setSlipShot(null);
    setTries(0); setPlate(null); setPlateShot(null); setTypedPlate(''); setManualMode(false);
    setAward(null); setHandover(null); setConsent(false);
    setRefusing(false); setReason('out_of_stock'); setReasonNote('');
    setErr(''); setOk('');
  };

  const start = async () => {
    setBusy('start'); setErr(''); setOk('');
    try {
      const s = await api.post('/campaigns/issues', { station_id: stationId });
      setIssue(s); setStep(1);
    } catch (e) { say(errText(e, tc('crun.startFailed','Could not start a gift session.')), false); }
    setBusy('');
  };

  const shoot = async (file, setter) => {
    if (!file) return null;
    const file_base64 = await readB64(file);
    const shot = { file_base64, media_type: file.type || 'image/jpeg' };
    setter(shot);
    return shot;
  };

  const saveFill = async () => {
    setBusy('fill'); setErr('');
    try {
      const r = await api.post(`/campaigns/issues/${issue.id}/fill`, {
        ...fill,
        litres: Number(fill.litres),
        slip_image: slipShot?.file_base64 || undefined,
        media_type: slipShot?.media_type || undefined,
      });
      setIssue(r); setStep(2);
    } catch (e) { say(errText(e, tc('crun.fillFailed','Could not record the fill.')), false); }
    setBusy('');
  };

  // Read the plate. Writes nothing on a failure, so a bad read cannot half-fill
  // the row — the attendant simply retakes.
  const shootPlate = async (file) => {
    const shot = await shoot(file, setPlateShot);
    if (!shot) return;
    setBusy('plate'); setErr('');
    try {
      const r = await api.post('/campaigns/issues/plate-read', { ...shot, station_id: stationId });
      setPlate(r);
      setTries(n => n + 1);
      if (!r.legible) say(r.notes || tc('crun.plateUnread','Could not read the plate. Move closer and hold still.'), false);
    } catch (e) { setTries(n => n + 1); say(errText(e, tc('crun.plateFailed','Could not read the plate.')), false); }
    setBusy('');
  };

  const savePlate = async () => {
    const value = manualMode ? typedPlate : plate?.plate;
    setBusy('plate'); setErr('');
    try {
      const r = await api.post(`/campaigns/issues/${issue.id}/plate`, {
        vehicle_number: value,
        plate_source: manualMode ? 'manual' : 'ocr',
        plate_image: plateShot?.file_base64 || undefined,
        media_type: plateShot?.media_type || undefined,
      });
      setIssue(r);
      const p = await api.get(`/campaigns/issues/${issue.id}/preview`);
      setAward(p); setStep(3);
    } catch (e) { say(errText(e, tc('crun.plateSaveFailed','Could not record the plate.')), false); }
    setBusy('');
  };

  const settle = async (status) => {
    setBusy('settle'); setErr('');
    try {
      const r = await api.post(`/campaigns/issues/${issue.id}/settle`, {
        status,
        reason: status === 'not_issued' ? reason : undefined,
        reason_note: status === 'not_issued' ? (reasonNote || undefined) : undefined,
        handover_image: handover?.file_base64 || undefined,
        media_type: handover?.media_type || undefined,
        promo_consent: consent,
      });
      setDone(r);
    } catch (e) {
      const c = errCode(e);
      say(errText(e, tc('crun.settleFailed','Could not settle the gift.')), false);
      // Out of stock is not a failure to retry — it is the refusal itself, and
      // the entitlement survives it, so offer the refusal rather than the button.
      if (c === 'out_of_stock') { setRefusing(true); setReason('out_of_stock'); }
    }
    setBusy('');
  };

  const manualAllowed = tries >= (live?.max_plate_tries ?? 4);
  const needHandover  = manualMode;                    // typed plate ⇒ proof required
  const canIssue = award?.tier && !busy && (!needHandover || !!handover);

  // ── render ────────────────────────────────────────────────────────────────
  const Chip = ({ n, label, active, past }) => (
    <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 11px',borderRadius:999,
      background: active ? '#e07b0c' : past ? '#dcfce7' : '#f3f2ef',
      color: active ? '#fff' : past ? '#166534' : '#7a7773', fontSize:12.5, fontWeight: active?700:500}}>
      {past ? <Check size={13}/> : <span>{n}</span>}{label}
    </div>
  );

  return (
    <AppShell>
      <div style={{padding:'18px 16px',maxWidth:560,margin:'0 auto'}}>

        <h1 style={{margin:'0 0 4px',fontSize:21,fontWeight:700,letterSpacing:'-0.3px'}}>
          {tc('crun.title','Issue a Gift')}
        </h1>
        {live?.campaign && (
          <p style={{margin:'0 0 14px',fontSize:13,color:'#4a4845'}}>{live.campaign.name}</p>
        )}

        <Banner tone="error">{err}</Banner>
        <Banner tone="ok">{ok}</Banner>

        {/* NOTHING RUNNING */}
        {live && !live.campaign && (
          <div style={{padding:26,textAlign:'center',background:'#fff',border:'1px solid #e5e3de',borderRadius:12}}>
            <Gift size={22} style={{color:'#c9c6bf',marginBottom:8}}/>
            <div style={{fontSize:13.5,fontWeight:600,marginBottom:4}}>{tc('crun.none','No campaign is running today')}</div>
            <div style={{fontSize:12.5,color:'#4a4845',lineHeight:1.5}}>
              {tc('crun.noneBody','A campaign has to be started on Promotions → Gift Campaigns, and today must fall inside its dates.')}
            </div>
          </div>
        )}

        {live?.campaign && !live.within_hours && !issue && (
          <div style={{display:'flex',gap:9,padding:'12px 14px',background:'#fff8ed',border:'1px solid #e8c89a',borderRadius:10,marginBottom:14,alignItems:'flex-start'}}>
            <Clock size={16} style={{flexShrink:0,marginTop:1,color:'#9a4607'}}/>
            <span style={{fontSize:12.5,color:'#4a4845',lineHeight:1.45}}>
              {tc('crun.outsideHours','This campaign runs between {a} and {b}. Gifts cannot be issued outside those hours.')
                .replace('{a}', String(live.campaign.hours_from||'').slice(0,5))
                .replace('{b}', String(live.campaign.hours_to||'').slice(0,5))}
            </span>
          </div>
        )}

        {/* START */}
        {live?.campaign && live.within_hours && !issue && (
          <>
            <div style={{display:'flex',gap:9,padding:'12px 14px',background:'#f3f2ef',borderRadius:10,marginBottom:14,alignItems:'flex-start'}}>
              <Clock size={16} style={{flexShrink:0,marginTop:1,color:'#4a4845'}}/>
              <span style={{fontSize:12.5,color:'#4a4845',lineHeight:1.45}}>
                {tc('crun.sessionNote','Start the session before the fill. It stays open for {n} minutes, which is about how long a tank takes — so the slip, the plate and the handover all belong to one moment.')
                  .replace('{n}', live.session_minutes ?? 20)}
              </span>
            </div>
            <button type="button" onClick={start} disabled={busy==='start'}
              style={{width:'100%',padding:15,borderRadius:10,border:'none',background:'#e07b0c',color:'#fff',
                fontWeight:700,fontSize:16,fontFamily:'inherit',cursor:'pointer'}}>
              {busy==='start' ? tc('crun.starting','Starting…') : tc('crun.start','Start a gift session')}
            </button>
          </>
        )}

        {/* SETTLED */}
        {done && (
          <div style={{textAlign:'center',background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:22}}>
            {done.status === 'issued' ? (
              <>
                <Check size={40} style={{color:'#16a34a'}}/>
                <div style={{fontWeight:800,fontSize:18,margin:'8px 0 4px'}}>{tc('crun.issued','Gift issued')}</div>
                <div style={{fontSize:13,color:'#4a4845',marginBottom:16}}>
                  {num(done.quantity)} · {done.vehicle_number}
                </div>
              </>
            ) : (
              <>
                <X size={40} style={{color:'#7a7773'}}/>
                <div style={{fontWeight:800,fontSize:18,margin:'8px 0 4px'}}>{tc('crun.notIssued','Recorded as not issued')}</div>
                <div style={{fontSize:13,color:'#4a4845',marginBottom:16}}>
                  {(REASONS.find(r=>r[0]===done.reason)||[])[1] || done.reason}
                </div>
              </>
            )}
            <button type="button" onClick={reset}
              style={{width:'100%',padding:13,borderRadius:10,border:'none',background:'#e07b0c',color:'#fff',fontWeight:700,fontSize:15,fontFamily:'inherit',cursor:'pointer'}}>
              {tc('crun.next','Next customer')}
            </button>
          </div>
        )}

        {/* THE SESSION */}
        {issue && !done && (
          <>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
              <Chip n={1} label={tc('crun.s1','Fill')}     active={step===1} past={step>1}/>
              <Chip n={2} label={tc('crun.s2','Plate')}    active={step===2} past={step>2}/>
              <Chip n={3} label={tc('crun.s3','Gift')}     active={step===3} past={false}/>
              <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:999,
                fontFamily:'DM Mono, monospace',fontSize:12,fontWeight:700,
                background: left < 3*60*1000 ? '#fee2e2' : '#f5b840',
                color: left < 3*60*1000 ? '#991b1b' : '#1a1916'}}>
                <Clock size={12}/>{mmss(left)}
              </span>
            </div>

            {left <= 0 && (
              <div style={{display:'flex',gap:9,padding:'11px 13px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:9,marginBottom:12,alignItems:'flex-start'}}>
                <AlertTriangle size={15} style={{flexShrink:0,marginTop:1,color:'#991b1b'}}/>
                <span style={{fontSize:12.5,color:'#4a4845',lineHeight:1.45}}>
                  {tc('crun.expired','This session has run out. Start a new one — everything you captured is kept.')}
                </span>
              </div>
            )}

            {/* STEP 1 — THE FILL */}
            {step===1 && (
              <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:15}}>
                <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>{tc('crun.fillTitle','What was filled')}</div>

                {live?.slip_ocr_required && (
                  <>
                    <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:9,padding:'13px',
                      borderRadius:10,border:'1.5px dashed '+(slipShot?'#16a34a':'#c9c6bf'),
                      background: slipShot?'#f0f7f2':'#f8f7f5', cursor:'pointer', marginBottom:6}}>
                      {slipShot ? <Check size={17} style={{color:'#16a34a'}}/> : <Camera size={17} style={{color:'#4a4845'}}/>}
                      <span style={{fontSize:13.5,fontWeight:600,color:'#1a1916'}}>
                        {slipShot ? tc('crun.slipTaken','Slip photographed — tap to retake') : tc('crun.slipShoot','Photograph the nozzle sales slip')}
                      </span>
                      <input type="file" accept="image/*" capture="environment" style={{display:'none'}}
                        onChange={e=>{ shoot(e.target.files?.[0], setSlipShot); e.target.value=''; }}/>
                    </label>
                    <div style={{fontSize:11.5,color:'#4a4845',lineHeight:1.45,marginBottom:12}}>
                      {tc('crun.slipWhy','The slip is kept as evidence and its bill number stops the same receipt earning a gift twice. Read the figures off it below — automatic reading arrives once we have sample slips.')}
                    </div>
                  </>
                )}

                {!live?.slip_ocr_required && (
                  <div style={{display:'flex',gap:9,padding:'11px 13px',background:'#fff8ed',border:'1px solid #e8c89a',borderRadius:9,marginBottom:12,alignItems:'flex-start'}}>
                    <AlertTriangle size={15} style={{flexShrink:0,marginTop:1,color:'#9a4607'}}/>
                    <span style={{fontSize:12,color:'#4a4845',lineHeight:1.45}}>
                      {tc('crun.noSlipWarn','This outlet does not require the slip. The quantity below is typed and unverified — the plate still proves which vehicle, never how much.')}
                    </span>
                  </div>
                )}

                <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:12}}>
                  {['diesel','petrol','premium_petrol','cng'].map(f=>(
                    <button key={f} type="button" onClick={()=>setFill(p=>({...p,fuel_type:f}))}
                      style={{padding:'9px 15px',borderRadius:999,cursor:'pointer',fontSize:13.5,fontFamily:'inherit',
                        fontWeight:fill.fuel_type===f?700:400,
                        border:'2px solid '+(fill.fuel_type===f?'#e07b0c':'#e5e3de'),background:'#fff',color:'#1a1916'}}>
                      {fuelLabel(f)}
                    </button>
                  ))}
                </div>

                <label htmlFor="f-l" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('crun.litres','LITRES DISPENSED')}</label>
                <input id="f-l" type="number" inputMode="decimal" step="0.01" style={{...inp,marginBottom:12,fontSize:20,fontFamily:'DM Mono, monospace'}}
                  value={fill.litres} onChange={e=>setFill(p=>({...p,litres:e.target.value}))}/>

                {live?.slip_ocr_required && (
                  <>
                    <label htmlFor="f-b" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('crun.billNo','BILL NUMBER ON THE SLIP')}</label>
                    <input id="f-b" style={{...inp,marginBottom:14}} value={fill.bill_no}
                      onChange={e=>setFill(p=>({...p,bill_no:e.target.value}))}/>
                  </>
                )}

                <button type="button" onClick={saveFill}
                  disabled={busy==='fill' || !fill.litres || left<=0 || (live?.slip_ocr_required && (!slipShot || !fill.bill_no))}
                  style={{width:'100%',padding:14,borderRadius:10,border:'none',fontWeight:700,fontSize:15.5,fontFamily:'inherit',color:'#fff',
                    background:(busy==='fill'||!fill.litres||left<=0||(live?.slip_ocr_required&&(!slipShot||!fill.bill_no)))?'#c9c6bf':'#e07b0c',
                    cursor:'pointer'}}>
                  {busy==='fill' ? tc('crun.saving','Saving…') : tc('crun.next2','Next — the number plate')}
                </button>
              </div>
            )}

            {/* STEP 2 — THE PLATE */}
            {step===2 && (
              <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:15}}>
                <div style={{fontWeight:700,fontSize:15,marginBottom:3}}>{tc('crun.plateTitle','Number plate')}</div>
                <div style={{fontSize:12.5,color:'#4a4845',lineHeight:1.45,marginBottom:12}}>
                  {tc('crun.plateWhy','Fill the frame with the plate. Nobody types the number — it is read from the photograph, because a number a man can retype is a number he can change.')}
                </div>

                <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:9,padding:'13px',
                  borderRadius:10,border:'1.5px dashed '+(plate?.legible?'#16a34a':'#c9c6bf'),
                  background: plate?.legible?'#f0f7f2':'#f8f7f5', cursor:'pointer', marginBottom:12}}>
                  {busy==='plate' ? <Loader size={17}/> : plate?.legible ? <Check size={17} style={{color:'#16a34a'}}/> : <Camera size={17} style={{color:'#4a4845'}}/>}
                  <span style={{fontSize:13.5,fontWeight:600}}>
                    {busy==='plate' ? tc('crun.reading','Reading…')
                      : plate ? tc('crun.retake','Retake the photo') : tc('crun.plateShoot','Photograph the plate')}
                  </span>
                  <input type="file" accept="image/*" capture="environment" style={{display:'none'}} disabled={busy==='plate'}
                    onChange={e=>{ shootPlate(e.target.files?.[0]); e.target.value=''; }}/>
                </label>

                {tries > 0 && (
                  <div style={{fontSize:11.5,color:'#4a4845',marginBottom:10,textAlign:'center'}}>
                    {tc('crun.attempt','Attempt {n} of {m}').replace('{n}', tries).replace('{m}', live?.max_plate_tries ?? 4)}
                  </div>
                )}

                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#4a4845',letterSpacing:'0.4px',marginBottom:5}}>{tc('crun.vehicleNo','VEHICLE NUMBER')}</div>
                  {manualMode ? (
                    <input style={{...inp,fontFamily:'DM Mono, monospace',fontSize:18,letterSpacing:1}}
                      value={typedPlate} autoCapitalize="characters"
                      placeholder="TS05FQ0975"
                      onChange={e=>setTypedPlate(e.target.value)}/>
                  ) : (
                    <div style={{padding:'12px 13px',background:'#f3f2ef',border:'1px solid #e5e3de',borderRadius:9,
                      fontFamily:'DM Mono, monospace',fontSize:18,letterSpacing:1,
                      color: plate?.plate ? '#1a1916' : '#a8a5a0'}}>
                      {plate?.plate || '— — — —'}
                    </div>
                  )}
                </div>

                {manualMode && (
                  <div style={{display:'flex',gap:9,padding:'11px 13px',background:'#fff8ed',border:'1px solid #e8c89a',borderRadius:9,marginBottom:12,alignItems:'flex-start'}}>
                    <AlertTriangle size={15} style={{flexShrink:0,marginTop:1,color:'#9a4607'}}/>
                    <span style={{fontSize:12,color:'#4a4845',lineHeight:1.45}}>
                      {tc('crun.manualWarn','A typed plate needs the handover photograph at the next step. The gift cannot be saved without it.')}
                    </span>
                  </div>
                )}

                {!manualMode && manualAllowed && (
                  <button type="button" onClick={()=>setManualMode(true)}
                    style={{width:'100%',padding:11,borderRadius:9,border:'1px solid #c9c6bf',background:'#fff',
                      fontWeight:500,fontSize:13.5,fontFamily:'inherit',color:'#4a4845',cursor:'pointer',marginBottom:10}}>
                    <RefreshCw size={13} style={{verticalAlign:'-2px',marginRight:6}}/>
                    {tc('crun.typeInstead','Plate is worn or smudged — type it instead')}
                  </button>
                )}

                <button type="button" onClick={savePlate}
                  disabled={busy==='plate' || left<=0 || (manualMode ? !typedPlate : !plate?.legible)}
                  style={{width:'100%',padding:14,borderRadius:10,border:'none',fontWeight:700,fontSize:15.5,fontFamily:'inherit',color:'#fff',
                    background:(busy==='plate'||left<=0||(manualMode?!typedPlate:!plate?.legible))?'#c9c6bf':'#e07b0c',cursor:'pointer'}}>
                  {tc('crun.next3','Next — the gift')}
                </button>
              </div>
            )}

            {/* STEP 3 — THE GIFT */}
            {step===3 && (
              <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:15}}>

                {/* THE WORKING. A figure a manager cannot audit is a figure he will
                    not trust, so the derivation is shown, not just the answer. */}
                <div style={{background:'#f8f7f5',borderRadius:9,padding:'12px 13px',marginBottom:13}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.4px',marginBottom:8}}>
                    {tc('crun.working','HOW THIS WAS WORKED OUT')}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontFamily:'DM Mono, monospace',fontSize:15,letterSpacing:1,fontWeight:500}}>{issue.vehicle_number}</span>
                    <span style={{padding:'1px 6px',fontSize:9.5,fontWeight:700,color:'#4a4845',background:'#fff',border:'1px solid #e5e3de',borderRadius:4}}>
                      {issue.plate_source === 'manual' ? tc('crun.typed','TYPED') : tc('crun.fromPlate','FROM PLATE')}
                    </span>
                  </div>
                  <div style={{display:'flex',alignItems:'baseline',gap:8,fontSize:13}}>
                    <span style={{flexGrow:1,color:'#1a1916'}}>{fuelLabel(issue.fuel_type)}{issue.bill_no ? ` · ${tc('crun.bill','slip')} ${issue.bill_no}` : ''}</span>
                    <span style={{fontFamily:'DM Mono, monospace',fontSize:15,fontWeight:500}}>{num(issue.litres)} L</span>
                  </div>
                  {award?.tier && (
                    <div style={{display:'flex',alignItems:'baseline',gap:8,fontSize:12.5,color:'#4a4845',marginTop:5,paddingLeft:2}}>
                      <span style={{flexGrow:1}}>{tc('crun.tierRow','Tier — fill at least')}</span>
                      <span style={{fontFamily:'DM Mono, monospace'}}>{num(award.tier.min_litres)} L</span>
                    </div>
                  )}
                </div>

                {!award?.tier ? (
                  <div style={{padding:'14px',textAlign:'center',background:'#f3f2ef',borderRadius:9,marginBottom:13}}>
                    <div style={{fontSize:13.5,fontWeight:600,marginBottom:3}}>{tc('crun.noTier','This fill does not reach any tier')}</div>
                    <div style={{fontSize:12,color:'#4a4845'}}>{tc('crun.noTierBody','Nothing to give. Record it as not issued if you want the visit on the report.')}</div>
                  </div>
                ) : award.already ? (
                  <div style={{display:'flex',gap:9,padding:'12px 13px',background:'#fff8ed',border:'1px solid #e8c89a',borderRadius:9,marginBottom:13,alignItems:'flex-start'}}>
                    <AlertTriangle size={15} style={{flexShrink:0,marginTop:1,color:'#9a4607'}}/>
                    <span style={{fontSize:12.5,color:'#4a4845',lineHeight:1.45}}>
                      {tc('crun.already','This vehicle has already had this tier in this campaign, so it cannot be given again.')}
                    </span>
                  </div>
                ) : (
                  <div style={{background:'#fff8ed',border:'2px solid #e07b0c',borderRadius:11,padding:14,marginBottom:13,display:'flex',alignItems:'center',gap:12}}>
                    <div style={{width:42,height:42,flexShrink:0,borderRadius:9,background:'#e07b0c',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <Gift size={21} style={{color:'#fff'}}/>
                    </div>
                    <div style={{flexGrow:1,minWidth:0}}>
                      <div style={{fontSize:10.5,fontWeight:700,color:'#9a4607',letterSpacing:'0.5px'}}>{tc('crun.eligible','ELIGIBLE GIFT')}</div>
                      <div style={{fontSize:16.5,fontWeight:700,color:'#1a1916'}}>{award.tier.product_name}</div>
                      <div style={{fontSize:12,color:'#4a4845'}}>
                        {tc('crun.giveN','give {q} {u}').replace('{q}', num(award.tier.quantity)).replace('{u}', award.tier.unit||'')}
                        {' · '}{tc('crun.leftN','{n} left').replace('{n}', num(award.tier.gift_stock))}
                      </div>
                    </div>
                  </div>
                )}

                {/* HANDOVER — optional after an OCR'd plate, required after a typed one */}
                <label style={{display:'flex',alignItems:'center',gap:10,padding:'11px 13px',
                  borderRadius:9,border:'1.5px dashed '+(handover?'#16a34a':needHandover?'#e8c89a':'#c9c6bf'),
                  background: handover?'#f0f7f2':needHandover?'#fff8ed':'#f8f7f5',cursor:'pointer',marginBottom:10}}>
                  {handover ? <Check size={16} style={{color:'#16a34a'}}/> : <Camera size={16} style={{color:'#4a4845'}}/>}
                  <span style={{fontSize:13,fontWeight:600,flexGrow:1}}>
                    {handover ? tc('crun.handoverTaken','Handover photographed')
                      : needHandover ? tc('crun.handoverReq','Photograph the driver with the gift — required')
                      : tc('crun.handoverOpt','Photograph the driver with the gift — optional')}
                  </span>
                  <input type="file" accept="image/*" capture="environment" style={{display:'none'}}
                    onChange={e=>{ shoot(e.target.files?.[0], setHandover); e.target.value=''; }}/>
                </label>

                {handover && (
                  <label style={{display:'flex',alignItems:'flex-start',gap:9,padding:'10px 12px',background:'#f8f7f5',borderRadius:8,marginBottom:12,cursor:'pointer'}}>
                    <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}
                      style={{width:16,height:16,accentColor:'#e07b0c',flexShrink:0,marginTop:1}}/>
                    <span style={{fontSize:11.5,color:'#4a4845',lineHeight:1.45}}>
                      {tc('crun.consent','Customer agreed we may use this photo to promote the outlet. Leave it off and the photo is kept as delivery proof only.')}
                    </span>
                  </label>
                )}

                {!refusing ? (
                  <>
                    {award?.tier && !award.already && (
                      <button type="button" onClick={()=>settle('issued')} disabled={!canIssue || left<=0}
                        style={{width:'100%',padding:15,borderRadius:10,border:'none',fontWeight:700,fontSize:16,fontFamily:'inherit',color:'#fff',
                          background:(!canIssue||left<=0)?'#c9c6bf':'#16a34a',cursor:'pointer',marginBottom:9}}>
                        {busy==='settle' ? tc('crun.saving','Saving…') : tc('crun.issue','Issued')}
                      </button>
                    )}
                    <button type="button" onClick={()=>setRefusing(true)}
                      style={{width:'100%',padding:13,borderRadius:10,border:'1px solid #c9c6bf',background:'#fff',
                        fontWeight:500,fontSize:14,fontFamily:'inherit',color:'#4a4845',cursor:'pointer'}}>
                      {tc('crun.notIssuedBtn','Not issued')}
                    </button>
                  </>
                ) : (
                  <div>
                    <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{tc('crun.whyNot','Why was it not issued?')}</div>
                    <div style={{fontSize:11.5,color:'#4a4845',lineHeight:1.45,marginBottom:10}}>
                      {tc('crun.whyNotBody','Everything you captured is saved either way, and an out-of-stock refusal does not use up the driver’s entitlement — he can claim it next visit.')}
                    </div>
                    {REASONS.map(([id,label])=>(
                      <label key={id} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 13px',marginBottom:7,
                        background:'#fff',borderRadius:9,cursor:'pointer',
                        border:'2px solid '+(reason===id?'#e07b0c':'#e5e3de')}}>
                        <input type="radio" name="reason" checked={reason===id} onChange={()=>setReason(id)}
                          style={{width:16,height:16,accentColor:'#e07b0c'}}/>
                        <span style={{fontSize:14,fontWeight:reason===id?700:400}}>{label}</span>
                      </label>
                    ))}
                    <input style={{...inp,marginTop:5,marginBottom:12}} value={reasonNote}
                      placeholder={tc('crun.notePh','Anything to add — optional')}
                      onChange={e=>setReasonNote(e.target.value)}/>
                    <button type="button" onClick={()=>settle('not_issued')} disabled={busy==='settle'||left<=0}
                      style={{width:'100%',padding:14,borderRadius:10,border:'none',background:'#1a1916',color:'#fff',
                        fontWeight:700,fontSize:15,fontFamily:'inherit',cursor:'pointer'}}>
                      {tc('crun.recordClose','Record and close')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <button type="button" onClick={reset}
              style={{width:'100%',marginTop:12,padding:11,background:'none',border:'none',color:'#7a7773',fontSize:13,fontFamily:'inherit',cursor:'pointer'}}>
              {tc('crun.abandon','Abandon this session')}
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}
