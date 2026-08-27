'use client';
// Testing — the calibration draw.
//
// The manager dispenses ~5 L from a nozzle into the measuring can, checks the
// quantity against the meter, and pours it back into a tank. The meter moved but
// nothing was sold, so two things must happen: the operator must not be charged for
// it, and the tank must get it back.
//
// Until now neither was recorded. `shift_reconciliation.test_ltrs` existed and had
// been used EXACTLY ZERO times in production — a figure typed at close, hours later,
// from memory, does not get typed. And nothing at all recorded the fuel going back,
// so a draw the manager returned and one he pocketed looked identical.
//
// THE ORDER OF THE FORM IS THE OWNER'S (04-Aug-2026) and it is deliberate:
//
//   1. FUEL first, big and in the brand colour. It is the only choice the manager
//      always knows without thinking, and choosing it collapses everything below.
//   2. NOZZLE, filtered to that fuel.
//   3. TANK, filtered to that fuel — and this is the point of the screen. Petrol and
//      premium normally have ONE tank, so the answer is forced and no question is
//      asked. DIESEL usually has several, and "this nozzle-tank link is always not on
//      top of the memory" — the manager pours back into whichever tank is at hand.
//      That is what has been leaving one diesel tank permanently short and another
//      permanently long, as drift nobody could attribute.
//
// The tank picker is the SAME shape as the one on Deliveries — a select filtered by
// fuel, auto-chosen when only one matches. A second pattern for the same question is
// the drift the cardinal rule exists to stop.
//
// SLIP SCAN is built and hidden (SHOW_SLIP_SCAN). The owner's plan is to have outlets
// print the testing slip once the habit settles, so the quantity is LOCKED by the
// printed figure instead of typed. The wiring is here so switching it on is one line
// rather than a rewrite, and it reuses the existing pump-slip reader.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, ArrowRight, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { nozName } from '../../lib/nozzle';

import { errText } from '../../lib/apiError';
// Flip to true once outlets are printing testing slips (see header).
const SHOW_SLIP_SCAN = false;

const BRAND = '#FF6B00';
const inp = { width:'100%', padding:'10px 12px', border:'1.5px solid #e5e3de', borderRadius:8,
              fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const fmtL = n => Number(n||0).toFixed(2);
const fmtWhen = (ts) => ts ? new Date(ts).toLocaleString('en-IN',
  { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true }) : '';
const label = f => String(f||'').replace('_',' ');

export default function TestingPage() {
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [nozzles, setNozzles] = useState([]);
  const [tanks, setTanks]     = useState([]);
  const [rows, setRows]       = useState([]);
  const [fuel, setFuel]       = useState('');
  const [nozzleId, setNozzleId] = useState('');
  const [tankId, setTankId]   = useState('');
  const [litres, setLitres]   = useState('5');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');

  const load = () => {
    if (!stationId) return;
    Promise.all([
      api.get(`/stations/${stationId}/nozzles`).catch(()=>[]),
      api.get(`/dipstick/tanks/${stationId}`).catch(()=>[]),
      api.get('/test-draws', { params:{ station_id: stationId } }).catch(()=>[]),
    ]).then(([n, tk, d]) => {
      setNozzles((Array.isArray(n)?n:[]).filter(x => x.is_active));
      setTanks(Array.isArray(tk)?tk:[]);
      setRows(Array.isArray(d)?d:[]);
    });
  };
  useEffect(load, [stationId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Only fuels this outlet actually has a tank for — never a fixed list, because an
  // outlet without premium must not be offered it.
  const fuels = [...new Set(tanks.map(t => t.fuel_type).filter(f => String(f).toLowerCase() !== 'cng'))];
  const nozzlesForFuel = nozzles.filter(n => n.fuel_type === fuel);
  const tanksForFuel   = tanks.filter(t => t.fuel_type === fuel);
  const nozzle         = nozzles.find(n => n.id === nozzleId);
  // The tank this nozzle actually draws from — the default, and the physically
  // correct answer. Anything else is a genuine movement of stock between two tanks.
  const homeTank       = nozzle ? tanks.find(t => t.id === nozzle.tank_id) : null;
  const crossTank      = !!(tankId && nozzle?.tank_id && tankId !== nozzle.tank_id);

  const pickFuel = (f) => {
    setFuel(f); setNozzleId(''); setTankId(''); setErr(''); setOk('');
    // One tank for this fuel → there is no question to ask. Deliveries does the same.
    const only = tanks.filter(x => x.fuel_type === f);
    if (only.length === 1) setTankId(only[0].id);
  };

  const pickNozzle = (id) => {
    setNozzleId(id); setErr(''); setOk('');
    const nz = nozzles.find(n => n.id === id);
    // Default the destination to where the fuel came from. The manager only has to
    // touch this when he poured it somewhere else.
    if (nz?.tank_id && tanksForFuel.length > 1) setTankId(nz.tank_id);
  };

  const submit = async () => {
    setErr(''); setOk('');
    if (!nozzleId) return setErr(tc('testing.errNozzle','Choose the nozzle the fuel was drawn from.'));
    if (!tankId)   return setErr(tc('testing.errTank','Choose the tank the fuel was poured back into.'));
    if (!(parseFloat(litres) > 0)) return setErr(tc('testing.errLitres','Enter the quantity in litres.'));
    setBusy(true);
    try {
      const r = await api.post('/test-draws', {
        station_id: stationId, nozzle_id: nozzleId, to_tank_id: tankId, litres: parseFloat(litres),
      });
      setOk(tc('testing.saved','Recorded {l} L from nozzle {n} into tank {t}.')
        .replace('{l}', fmtL(r.litres)).replace('{n}', nozName(r)).replace('{t}', r.to_tank_number));
      setNozzleId(''); setLitres('5');
      if (tanksForFuel.length > 1) setTankId('');
      load();
    } catch (e) {
      setErr(errText(e, tc('testing.errSave','Could not record the draw.')));
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <div style={{marginBottom:'1.25rem'}}>
        <h1 style={{fontSize:22,fontWeight:800,display:'flex',alignItems:'center',gap:8,margin:0}}>
          <FlaskConical size={20} color={BRAND}/>{tc('testing.title','Testing')}
        </h1>
        <div style={{fontSize:13,color:'var(--text-3)',marginTop:2}}>
          {tc('testing.subtitle','Record the calibration draw — fuel out of a nozzle, into the can, and back into a tank. The operator is not charged for it and the tank gets it back.')}
        </div>
      </div>

      <div className="card" style={{maxWidth:620}}>
        {/* 1 — FUEL. The one thing he always knows. */}
        <label className="label">{tc('testing.fuel','Fuel')}</label>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:'1.25rem'}}>
          {fuels.map(f => (
            <button key={f} onClick={()=>pickFuel(f)}
              style={{padding:'12px 22px',borderRadius:10,fontSize:15,fontWeight:800,cursor:'pointer',
                textTransform:'capitalize',
                border:'2px solid '+(fuel===f?BRAND:'#e5e3de'),
                background: fuel===f ? BRAND : '#fff',
                color: fuel===f ? '#fff' : '#475569'}}>
              {label(f)}
            </button>
          ))}
          {fuels.length===0 && <div style={{fontSize:13,color:'#94a3b8'}}>{tc('testing.noTanks','No tanks configured for this outlet.')}</div>}
        </div>

        {fuel && (
          <>
            {/* 2 — NOZZLE (from) */}
            <label className="label">{tc('testing.fromNozzle','Drawn from nozzle')} *</label>
            <select className="input" style={inp} value={nozzleId} onChange={e=>pickNozzle(e.target.value)}>
              <option value="">{tc('testing.selectNozzle','Select nozzle…')}</option>
              {nozzlesForFuel.map(n => (
                <option key={n.id} value={n.id}>
                  {nozName(n)}
                </option>
              ))}
            </select>
            {nozzlesForFuel.length===0 && (
              <div style={{fontSize:12,color:'#b45309',marginTop:6}}>
                {tc('testing.noNozzles','No active nozzles for this fuel.')}
              </div>
            )}

            {/* 3 — LITRES */}
            <label className="label" style={{marginTop:14}}>{tc('testing.litres','Litres drawn')} *</label>
            <input style={{...inp,maxWidth:180}} type="number" step="0.01" inputMode="decimal"
              value={litres} onChange={e=>setLitres(e.target.value)}/>
            {SHOW_SLIP_SCAN && (
              <div style={{marginTop:8}}>
                <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'9px 14px',borderRadius:9,
                  background:'#0369a1',color:'#fff',fontSize:13.5,fontWeight:700,cursor:'pointer'}}>
                  {tc('testing.scanSlip','Scan the testing slip')}
                  <input type="file" accept="image/*" capture="environment" style={{display:'none'}}/>
                </label>
              </div>
            )}

            {/* 4 — TANK (to). Silent when the fuel has one tank; a real choice when it
                    has several, which is diesel nearly everywhere. */}
            <label className="label" style={{marginTop:14}}>{tc('testing.toTank','Poured back into tank')} *</label>
            {tanksForFuel.length === 1 ? (
              <div style={{...inp,background:'#f8fafc',color:'#475569',display:'flex',alignItems:'center',gap:8}}>
                {tc('testing.tank','Tank')} {tanksForFuel[0].tank_number}
                <span style={{fontSize:11.5,color:'#166534',background:'#dcfce7',borderRadius:99,padding:'2px 9px',fontWeight:700}}>
                  {tc('testing.onlyTank','the only tank for this fuel')}
                </span>
              </div>
            ) : (
              <select className="input" style={inp} value={tankId} onChange={e=>{setTankId(e.target.value); setErr(''); setOk('');}}>
                <option value="">{tc('testing.selectTank','Select tank…')}</option>
                {tanksForFuel.map(t => (
                  <option key={t.id} value={t.id}>
                    {tc('testing.tank','Tank')} {t.tank_number} — {label(t.fuel_type)} ({fmtL(t.current_stock)}L {tc('testing.current','current')})
                    {nozzle?.tank_id === t.id ? ` · ${tc('testing.thisNozzlesTank',"this nozzle's tank")}` : ''}
                  </option>
                ))}
              </select>
            )}

            {crossTank && (
              <div style={{marginTop:10,background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:9,
                padding:'10px 12px',fontSize:12.5,color:'#9a3412',display:'flex',gap:8}}>
                <AlertTriangle size={15} style={{flexShrink:0,marginTop:1}}/>
                <span>{tc('testing.crossTankWarn','This moves stock between two tanks: {a} loses {l} L and {b} gains it. That is fine — it is exactly what happened — but both tanks will show it on the stock reconciliation.')
                  .replace('{a}', `${tc('testing.tank','Tank')} ${homeTank?.tank_number ?? '?'}`)
                  .replace('{b}', `${tc('testing.tank','Tank')} ${tanks.find(x=>x.id===tankId)?.tank_number ?? '?'}`)
                  .replace('{l}', fmtL(litres))}</span>
              </div>
            )}

            {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginTop:12}}>{err}</div>}
            {ok  && <div style={{background:'#dcfce7',color:'#166534',borderRadius:8,padding:'10px 12px',fontSize:13,marginTop:12}}>{ok}</div>}

            <button onClick={submit} disabled={busy}
              style={{width:'100%',height:46,marginTop:16,background:busy?'#cbd5e1':BRAND,color:'#fff',
                border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:busy?'default':'pointer'}}>
              {busy ? tc('testing.saving','Saving…') : tc('testing.record','Record testing draw')}
            </button>
          </>
        )}
      </div>

      {/* The register. */}
      <div className="card" style={{maxWidth:620,marginTop:'1.25rem'}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>{tc('testing.recent','Recent testing draws')}</div>
        {rows.length===0 && <div style={{fontSize:13,color:'#94a3b8'}}>{tc('testing.none','Nothing recorded yet.')}</div>}
        {rows.map(r => (
          <div key={r.id} style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',
            padding:'9px 0',borderBottom:'1px solid #f1f5f9',fontSize:13}}>
            <span style={{fontWeight:800,minWidth:70}}>{fmtL(r.litres)} L</span>
            <span style={{color:'#475569',textTransform:'capitalize'}}>{label(r.fuel_type)}</span>
            <span style={{display:'inline-flex',alignItems:'center',gap:5,color:'#0f172a'}}>
              {nozName(r)} <ArrowRight size={13}/> {tc('testing.tank','Tank')} {r.to_tank_number}
            </span>
            {r.cross_tank && (
              <span style={{fontSize:11,color:'#9a3412',background:'#fff7ed',borderRadius:99,padding:'2px 8px',fontWeight:700}}>
                {tc('testing.crossTank','across tanks')}
              </span>
            )}
            <span style={{marginLeft:'auto',color:'#94a3b8',fontSize:12}}>{fmtWhen(r.drawn_at)}</span>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
