'use client';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, X, Mic, MicOff, Loader, Lock, LogOut } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, getNozzles, getCurrentPrices, recordDispense, getReco, submitReco } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';

const PAYMENT_MODES = [
  { id:'cash',   labelKey:'pos_page.cash',   fallback:'💵 Cash',   color:'#16a34a' },
  { id:'upi',    labelKey:'pos_page.upi',    fallback:'📱 UPI',    color:'#2563eb' },
  { id:'credit', labelKey:'pos_page.credit', fallback:'🏢 Credit', color:'#9333ea' },
  { id:'card',   labelKey:'pos_page.card',   fallback:'💳 Card',   color:'#ea580c' },
];

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

const fmt = n => Number(n||0).toFixed(2);

export default function POSPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;
  const { on } = useSocket(stationId, null);

  const [shifts,setShifts]     = useState([]);
  const [nozzles,setNozzles]   = useState([]);
  const [prices,setPrices]     = useState([]);
  const [corps,setCorps]       = useState([]);
  const [activeShift,setActiveShift] = useState(null);
  // null = loading, false = no shift, shift object = active
  const [shiftLoaded, setShiftLoaded] = useState(false);

  // Geo-fence state
  const [geoStatus, setGeoStatus] = useState('checking');
  const [geoDistance, setGeoDistance] = useState(null);

  // Voice POS state
  const [recording,  setRecording]  = useState(false);
  const [voiceStatus,setVoiceStatus] = useState('');
  const [mediaRec,   setMediaRec]   = useState(null);
  const [voiceHint,  setVoiceHint]  = useState('');

  // Form
  const [nozzle,setNozzleRaw]        = useState('');
  const setNozzle = (id) => {
    setNozzleRaw(id);
    if (id && stationId) localStorage.setItem('lastNozzle_' + stationId, id);
  };
  const [entryMode,setEntryMode]   = useState('litres');
  const [litres,setLitres]         = useState('');
  const [amount,setAmount]         = useState('');
  const [payMode,setPayMode]       = useState('cash');
  const [vehicle,setVehicle]       = useState('');
  const [upiRef,setUpiRef]         = useState('');
  const [selectedCorp,setSelectedCorp] = useState('');

  // Results
  const [lastTxn,setLastTxn]   = useState(null);
  const [loading,setLoading]   = useState(false);

  // Shift End flow
  // posPhase: 'pos' | 'confirm-end' | 'denomination' | 'locked'
  const [posPhase, setPosPhase]       = useState('pos');
  const [denoms, setDenoms]           = useState({});
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submittedCash, setSubmittedCash] = useState(null);
  const [shiftEndedAt, setShiftEndedAt]   = useState(null);

  const denomTotal = DENOMS.reduce((sum, d) => sum + (parseInt(denoms[d] || 0) * d), 0);

  useEffect(() => {
    if (!stationId) return;
    const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
    Promise.all([
      getShifts({ station_id:stationId, date:today }),
      getNozzles(stationId),
      getCurrentPrices(stationId),
      api.get('/corporate', {params:{station_id:stationId}}),
    ]).then(([s, n, p, c]) => {
      setShifts(s);
      setNozzles(n);
      const last = localStorage.getItem('lastNozzle_' + stationId);
      if (last && n.find(nz => nz.id === last)) setNozzleRaw(last);
      setPrices(p);
      setCorps(Array.isArray(c) ? c : []);
      const open = s.find(x => x.status === 'open');
      setActiveShift(open || null);
      setShiftLoaded(true);
    }).catch(err => { console.error('POS load error:', err); setShiftLoaded(true); });
  }, [stationId]);

  // Real-time: lock POS immediately when manager closes the shift
  useEffect(() => {
    if (!stationId) return;
    return on('shift:closed', (closedShift) => {
      if (closedShift.station_id === stationId) {
        setActiveShift(null);
        setShiftLoaded(true);
        setPosPhase('pos'); // reset any denomination flow
      }
    });
  }, [stationId, on]);

  // Check if this attendant already submitted reconciliation for the active shift
  useEffect(() => {
    if (!activeShift || !user?.id) return;
    getReco(activeShift.id).then(recs => {
      const mine = Array.isArray(recs) && recs.find(r => r.attendant_id === user.id);
      if (mine) {
        setSubmittedCash(parseFloat(mine.cash_actual));
        setShiftEndedAt(mine.reconciled_at || null);
        setPosPhase('locked');
      }
    }).catch(() => {});
  }, [activeShift, user]);

  const getPrice = (nozzleId) => {
    const n = nozzles.find(x => x.id === nozzleId);
    if (!n) return 0;
    const p = prices.find(x => x.fuel_type === n.fuel_type);
    return p ? parseFloat(p.price) : 0;
  };

  const getFuelType = (nozzleId) => {
    const n = nozzles.find(x => x.id === nozzleId);
    return n?.fuel_type || '';
  };

  const price      = getPrice(nozzle);
  const calcAmount = litres && price ? (parseFloat(litres) * price).toFixed(2) : '';
  const calcLitres = amount && price ? (parseFloat(amount) / price).toFixed(3) : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeShift) return alert(tc('pos_page.no_open_shift','No open shift found. Please open a shift first.'));
    if (!nozzle)      return alert(tc('pos_page.select_nozzle_alert','Please select a nozzle'));
    if (payMode === 'credit' && !selectedCorp) return alert(tc('pos_page.select_credit_alert','Please select a credit customer'));

    const qty = entryMode === 'litres' ? parseFloat(litres) : parseFloat(calcLitres);
    if (!qty || qty <= 0) return alert(tc('pos_page.valid_qty','Enter valid quantity'));

    if (payMode === 'credit') {
      const corp = corps.find(c => c.id === selectedCorp);
      if (corp) {
        const available  = Number(corp.credit_limit || 0) - Number(corp.current_outstanding || 0);
        const saleAmount = qty * Number(price || 0);
        if (saleAmount > available) {
          return alert(
            `${tc('pos_page.credit_exceeded','Credit limit exceeded.')}\n\n${tc('pos_page.avail_credit','Available credit')}: ₹${available.toLocaleString('en-IN',{maximumFractionDigits:2})}\n${tc('pos_page.this_sale','This sale')}: ₹${saleAmount.toLocaleString('en-IN',{maximumFractionDigits:2})}\n\n${tc('pos_page.reduce_qty','Reduce the quantity or collect a payment first.')}`
          );
        }
      }
    }

    setLoading(true);
    try {
      const res = await recordDispense({
        station_id:    stationId,
        shift_id:      activeShift.id,
        rfid_tag_uid:  'MANUAL',
        nozzle_id:     nozzle,
        quantity_ltrs: qty,
        payment_mode:  payMode,
        upi_ref:       upiRef || null,
        vehicle_number:vehicle || null,
        corporate_id:  payMode === 'credit' ? selectedCorp : undefined,
      });
      setLastTxn({ ...res, fuel_type:getFuelType(nozzle), price, qty });
      setLitres(''); setAmount(''); setVehicle(''); setUpiRef(''); setSelectedCorp('');
    } catch (err) {
      alert(err.error || tc('pos_page.txn_failed','Transaction failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleShiftEndSubmit = async () => {
    if (!activeShift || !user?.id) return;
    setSubmitLoading(true);
    try {
      // Save denomination breakdown
      const denomPayload = { shift_id: activeShift.id, attendant_id: user.id };
      DENOMS.forEach(d => { denomPayload[`note_${d}`] = parseInt(denoms[d] || 0); });
      await api.post('/reconcile/denomination', denomPayload);

      // Submit blind drop (cash_actual = denomination total)
      await submitReco({
        shift_id:     activeShift.id,
        attendant_id: user.id,
        cash_actual:  denomTotal,
        remarks:      '',
      });

      setSubmittedCash(denomTotal);
      setShiftEndedAt(new Date().toISOString());
      setPosPhase('locked');
    } catch (err) {
      alert(err.error || 'Submission failed. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const selectedNozzle = nozzles.find(n => n.id === nozzle);

  // ── Geo-fence check ──────────────────────────────────────
  useEffect(() => {
    if (!stationId) return;
    api.get(`/stations/${stationId}/settings`).then(settings => {
      if (!settings.geo_fence_enabled || !settings.latitude || !settings.longitude) {
        setGeoStatus('disabled');
        return;
      }
      if (!navigator.geolocation) { setGeoStatus('error'); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const dist = getDistance(
            pos.coords.latitude, pos.coords.longitude,
            parseFloat(settings.latitude), parseFloat(settings.longitude)
          );
          setGeoDistance(Math.round(dist));
          setGeoStatus(dist <= (settings.geo_fence_radius || 500) ? 'ok' : 'outside');
        },
        () => setGeoStatus('error'),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }).catch(() => setGeoStatus('disabled'));
  }, [stationId]);

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 +
      Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  // ── Voice POS Handler ──────────────────────────────────
  const startVoiceEntry = async () => {
    if (recording) { if (mediaRec) mediaRec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const mimeType = [
        'audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus',
        'audio/ogg','audio/mp4','',
      ].find(m => m === '' || MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        setVoiceStatus('processing');
        setVoiceHint(tc('pos_page.voice_processing', 'Processing...'));
        try {
          const mType = rec.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mType });
          const ext = mType.includes('ogg') ? 'ogg' : mType.includes('mp4') ? 'mp4' : 'webm';
          const formData = new FormData();
          formData.append('audio', blob, `audio.${ext}`);
          formData.append('language', localStorage.getItem('i18nextLng') || 'te');
          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            body: formData,
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          const p = data.parsed;
          setVoiceHint(`"${data.transcript}"`);
          setVoiceStatus('done');
          if (p.quantity) {
            if (p.entry_type === 'amount') { setEntryMode('amount'); setAmount(p.quantity.toString()); }
            else { setEntryMode('litres'); setLitres(p.quantity.toString()); }
          }
          if (p.payment_mode) setPayMode(p.payment_mode);
          if (p.fuel_type && nozzles.length > 0) {
            const match = nozzles.find(n =>
              n.fuel_type?.toLowerCase().includes(p.fuel_type) ||
              p.fuel_type.includes(n.fuel_type?.toLowerCase())
            );
            if (match) setNozzle(match.id);
          }
          setTimeout(() => { setVoiceStatus(''); setVoiceHint(''); }, 4000);
        } catch (err) {
          setVoiceStatus('error');
          setVoiceHint(err.message || 'Transcription failed');
          setTimeout(() => { setVoiceStatus(''); setVoiceHint(''); }, 3000);
        }
      };
      rec.start();
      setMediaRec(rec);
      setRecording(true);
      setVoiceStatus('recording');
      setVoiceHint(tc('pos_page.voice_listening', 'Listening... speak now'));
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 10000);
    } catch (err) {
      setVoiceStatus('error');
      setVoiceHint('Mic: ' + (err.message || 'Access denied'));
      setTimeout(() => { setVoiceStatus(''); setVoiceHint(''); }, 3000);
    }
  };

  // ── PHASE: Locked ────────────────────────────────────────
  if (posPhase === 'locked') {
    return (
      <AppShell>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'60vh',gap:'1.5rem',textAlign:'center'}}>
          <div style={{width:80,height:80,background:'#f1f5f9',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Lock size={36} color="#64748b"/>
          </div>
          <div>
            <h2 style={{fontSize:22,fontWeight:700,margin:'0 0 8px'}}>Shift Ended</h2>
            <p style={{color:'var(--text-2)',margin:0,fontSize:15}}>
              Your POS has been locked. Cash submission is complete.
            </p>
          </div>
          {submittedCash !== null && (
            <div style={{background:'#f0fdf4',border:'1px solid #86efac',borderRadius:12,padding:'1.25rem 2rem'}}>
              <div style={{fontSize:13,color:'#15803d',fontWeight:600,marginBottom:4}}>Cash Submitted</div>
              <div style={{fontSize:32,fontWeight:900,color:'#166534'}}>
                ₹{Number(submittedCash).toLocaleString('en-IN', {minimumFractionDigits:2})}
              </div>
            </div>
          )}
          <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'1rem 1.5rem',maxWidth:360,fontSize:14,color:'#9a3412'}}>
            <strong>Next step:</strong> Please bring the cash to your manager for confirmation.
          </div>
          {shiftEndedAt && (
            <div style={{fontSize:12,color:'var(--text-3)'}}>
              Submitted at {new Date(shiftEndedAt).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true})}
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // ── PHASE: Denomination entry ────────────────────────────
  if (posPhase === 'denomination') {
    return (
      <AppShell>
        <div style={{maxWidth:500,margin:'0 auto'}}>
          <div className="page-header">
            <div>
              <h1 className="page-title">End Shift — Cash Handover</h1>
              <p style={{margin:0,fontSize:13,color:'var(--text-2)'}}>
                Count the notes you have and enter the quantity of each denomination.
              </p>
            </div>
          </div>

          <div className="card">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)'}}>
                  <th style={{textAlign:'left',padding:'8px 0',fontSize:12,color:'var(--text-3)',fontWeight:600}}>Note</th>
                  <th style={{textAlign:'center',padding:'8px 0',fontSize:12,color:'var(--text-3)',fontWeight:600}}>Quantity</th>
                  <th style={{textAlign:'right',padding:'8px 0',fontSize:12,color:'var(--text-3)',fontWeight:600}}>Value</th>
                </tr>
              </thead>
              <tbody>
                {DENOMS.map(d => {
                  const qty = parseInt(denoms[d] || 0);
                  const val = qty * d;
                  return (
                    <tr key={d} style={{borderBottom:'1px solid var(--border-light,#f1f5f9)'}}>
                      <td style={{padding:'10px 0',fontWeight:700,fontSize:15}}>₹{d}</td>
                      <td style={{padding:'10px 8px',textAlign:'center'}}>
                        <input
                          type="number" min="0" step="1" placeholder="0"
                          value={denoms[d] || ''}
                          onChange={e => setDenoms(prev => ({...prev, [d]: e.target.value}))}
                          style={{width:80,textAlign:'center',padding:'6px 8px',
                            border:'1px solid var(--border)',borderRadius:6,fontSize:14,
                            fontWeight:600}}
                        />
                      </td>
                      <td style={{padding:'10px 0',textAlign:'right',fontSize:14,color: val > 0 ? 'var(--text-1)' : 'var(--text-3)'}}>
                        {val > 0 ? `₹${val.toLocaleString('en-IN')}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{borderTop:'2px solid var(--border)'}}>
                  <td colSpan={2} style={{padding:'12px 0',fontWeight:700,fontSize:15}}>Total Cash</td>
                  <td style={{padding:'12px 0',textAlign:'right',fontWeight:900,fontSize:20,color:'var(--brand)'}}>
                    ₹{denomTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div style={{display:'flex',gap:10,marginTop:'1.5rem'}}>
              <button className="btn btn-secondary" style={{flex:1,justifyContent:'center'}}
                onClick={() => setPosPhase('pos')} disabled={submitLoading}>
                ← Cancel
              </button>
              <button className="btn btn-primary" style={{flex:2,justifyContent:'center',background:'#dc2626',borderColor:'#dc2626'}}
                onClick={handleShiftEndSubmit}
                disabled={submitLoading || denomTotal <= 0}>
                {submitLoading
                  ? <><Loader size={15} style={{animation:'spin 1s linear infinite'}}/> Submitting...</>
                  : `Submit ₹${denomTotal.toLocaleString('en-IN')} & End Shift`}
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── PHASE: Confirm-end modal ─────────────────────────────
  if (posPhase === 'confirm-end') {
    return (
      <AppShell>
        <div style={{maxWidth:440,margin:'4rem auto',textAlign:'center'}}>
          <div className="card" style={{padding:'2rem'}}>
            <div style={{width:64,height:64,background:'#fef2f2',borderRadius:'50%',
              display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 1.25rem'}}>
              <LogOut size={28} color="#dc2626"/>
            </div>
            <h2 style={{fontSize:20,fontWeight:700,margin:'0 0 10px'}}>End Your Shift?</h2>
            <p style={{color:'var(--text-2)',fontSize:14,margin:'0 0 1.5rem',lineHeight:1.6}}>
              You will <strong>not be able to record any more sales</strong> after this.
              You will then count and submit your cash collection to the manager.
            </p>
            {activeShift && (
              <div style={{background:'var(--surface-2)',borderRadius:8,padding:'0.75rem',
                marginBottom:'1.5rem',fontSize:13,color:'var(--text-2)'}}>
                Shift {activeShift.shift_number} · Started {new Date(activeShift.start_time)
                  .toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true})}
              </div>
            )}
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-secondary" style={{flex:1,justifyContent:'center'}}
                onClick={() => setPosPhase('pos')}>
                Cancel
              </button>
              <button className="btn btn-primary"
                style={{flex:1,justifyContent:'center',background:'#dc2626',borderColor:'#dc2626'}}
                onClick={() => setPosPhase('denomination')}>
                Yes, End Shift
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── PHASE: No active shift → locked screen ───────────────
  if (shiftLoaded && !activeShift) {
    return (
      <AppShell>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
          minHeight:'60vh',textAlign:'center',padding:'2rem'}}>
          <div style={{width:72,height:72,borderRadius:'50%',background:'#fee2e2',
            display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'1.5rem'}}>
            <Lock size={32} color="#dc2626"/>
          </div>
          <h2 style={{margin:'0 0 8px',fontSize:20,fontWeight:800,color:'var(--text-1)'}}>
            POS Locked
          </h2>
          <p style={{margin:'0 0 1.5rem',fontSize:14,color:'var(--text-2)',maxWidth:320,lineHeight:1.6}}>
            No shift is currently open at this station. Ask your manager to open a shift before you can record transactions.
          </p>
          <button className="btn btn-primary" onClick={() => {
            setShiftLoaded(false);
            if (!stationId) return;
            const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
            getShifts({ station_id:stationId, date:today }).then(s => {
              const open = s.find(x => x.status === 'open');
              setActiveShift(open || null);
              setShiftLoaded(true);
            }).catch(() => setShiftLoaded(true));
          }}>
            🔄 Check Again
          </button>
        </div>
      </AppShell>
    );
  }

  // ── PHASE: Main POS ──────────────────────────────────────
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('pos_page.title','POS — Transaction Entry')}</h1>
          {activeShift
            ? <div style={{fontSize:13,color:'var(--success)'}}>● {tc('pos_page.shift_open','Shift {n} is open').replace('{n}',activeShift.shift_number)}</div>
            : <div style={{fontSize:13,color:'var(--danger)'}}>⚠ {tc('pos_page.no_shift','No open shift — contact manager')}</div>}
        </div>
        {activeShift && (
          <button
            className="btn"
            style={{background:'#dc2626',color:'#fff',border:'none',display:'flex',alignItems:'center',gap:6,fontWeight:700}}
            onClick={() => setPosPhase('confirm-end')}>
            <LogOut size={15}/> End Shift
          </button>
        )}
      </div>

      <div style={{maxWidth:520}}>

        {/* Geo-fence banners */}
        {geoStatus === 'outside' && (
          <div style={{background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:10,
            padding:'0.75rem 1rem',marginBottom:'1rem',fontSize:13,color:'#991b1b',
            display:'flex',alignItems:'flex-start',gap:10}}>
            <span style={{fontSize:20}}>🚫</span>
            <div>
              <div style={{fontWeight:700}}>Outside Station Boundary</div>
              <div>You are {geoDistance}m from the station. POS is restricted to within the allowed radius.</div>
            </div>
          </div>
        )}
        {geoStatus === 'error' && (
          <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,
            padding:'0.75rem 1rem',marginBottom:'1rem',fontSize:13,color:'#9a3412',
            display:'flex',alignItems:'center',gap:8}}>
            <span>⚠️</span> Location access denied. Please enable location to use POS.
          </div>
        )}
        {geoStatus === 'ok' && (
          <div style={{background:'#dcfce7',border:'1px solid #86efac',borderRadius:10,
            padding:'0.5rem 1rem',marginBottom:'0.75rem',fontSize:12,color:'#15803d',
            display:'flex',alignItems:'center',gap:6}}>
            <span>📍</span> Location verified — {geoDistance}m from station ✓
          </div>
        )}

        {/* Voice Entry Button */}
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:'0.75rem'}}>
          <button type="button" onClick={startVoiceEntry}
            style={{display:'flex',alignItems:'center',gap:8,padding:'10px 20px',
              borderRadius:12,border:'none',cursor:'pointer',fontWeight:700,fontSize:14,
              background: recording ? '#dc2626' : voiceStatus==='done' ? '#16a34a' : '#FF6B00',
              color:'#fff',
              boxShadow: recording ? '0 0 0 4px rgba(220,38,38,.25)' : '0 2px 8px rgba(255,107,0,.3)',
              transition:'all .2s'}}>
            {recording
              ? <><MicOff size={17}/> {tc('pos_page.voice_stop','Stop')}</>
              : voiceStatus==='processing'
              ? <><Loader size={17} style={{animation:'spin 1s linear infinite'}}/> {tc('pos_page.voice_processing','Processing...')}</>
              : <><Mic size={17}/> {tc('pos_page.voice_entry','🎙 Voice Entry')}</>}
          </button>
          {voiceHint && (
            <div style={{fontSize:13,padding:'6px 12px',borderRadius:8,flex:1,
              background: voiceStatus==='error'?'#fee2e2':voiceStatus==='done'?'#dcfce7':'#fff7ed',
              color: voiceStatus==='error'?'#991b1b':voiceStatus==='done'?'#15803d':'#9a3412',
              border:'1px solid',
              borderColor: voiceStatus==='error'?'#fca5a5':voiceStatus==='done'?'#86efac':'#fed7aa'}}>
              {voiceHint}
            </div>
          )}
        </div>

        {/* Success flash */}
        {lastTxn && (
          <div className="alert-banner success" style={{marginBottom:'1rem',position:'relative'}}>
            <CheckCircle size={18}/>
            <div style={{flex:1}}>
              <div style={{fontWeight:600}}>{tc('pos_page.txn_recorded','Transaction Recorded ✓')}</div>
              <div style={{fontSize:13}}>
                {Number(lastTxn.qty).toFixed(2)} L · ₹{fmt(lastTxn.amount)} · {lastTxn.payment_mode}
              </div>
            </div>
            <button onClick={()=>setLastTxn(null)}
              style={{background:'none',border:'none',cursor:'pointer'}}><X size={16}/></button>
          </div>
        )}

        <div className="card">
          <form onSubmit={handleSubmit}>

            {/* Nozzle selector */}
            <div style={{marginBottom:'1rem'}}>
              <label className="label">{tc('pos_page.select_nozzle','Select Nozzle')}</label>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
                {nozzles.filter(n=>n.is_active).map(n=>(
                  <button key={n.id} type="button"
                    className={`btn ${nozzle===n.id?'btn-primary':'btn-secondary'}`}
                    style={{flexDirection:'column',height:'auto',padding:'10px 6px',fontSize:12,gap:2}}
                    onClick={()=>setNozzle(n.id)}>
                    <span style={{fontWeight:700}}>N{n.nozzle_number}</span>
                    <span style={{fontSize:10,opacity:.8,textTransform:'capitalize'}}>{n.fuel_type}</span>
                    {getPrice(n.id) > 0 && (
                      <span style={{fontSize:10,opacity:.7}}>₹{getPrice(n.id)}/L</span>
                    )}
                  </button>
                ))}
                {nozzles.length === 0 && (
                  <div style={{gridColumn:'1/-1',color:'var(--text-3)',fontSize:13,padding:'0.5rem'}}>
                    {tc('pos_page.no_nozzles','No nozzles configured')}
                  </div>
                )}
              </div>
            </div>

            {/* Entry mode + quantity */}
            {nozzle && (
              <>
                <div style={{marginBottom:'1rem'}}>
                  <label className="label">{tc('pos_page.enter_by','Enter by')}</label>
                  <div style={{display:'flex',gap:8}}>
                    <button type="button"
                      className={`btn ${entryMode==='litres'?'btn-primary':'btn-secondary'}`}
                      style={{flex:1,justifyContent:'center'}}
                      onClick={()=>setEntryMode('litres')}>{tc('pos_page.litres','Litres')}</button>
                    <button type="button"
                      className={`btn ${entryMode==='amount'?'btn-primary':'btn-secondary'}`}
                      style={{flex:1,justifyContent:'center'}}
                      onClick={()=>setEntryMode('amount')}>{tc('pos_page.amount_rs','Amount (₹)')}</button>
                  </div>
                </div>

                {entryMode === 'litres' ? (
                  <div style={{marginBottom:'1rem'}}>
                    <label className="label">{tc('pos_page.quantity_litres','Quantity (Litres)')}</label>
                    <input className="input input-lg" type="number" step="0.001" min="0.001"
                      placeholder="e.g. 10.000" value={litres}
                      onChange={e=>setLitres(e.target.value)} required/>
                    {litres && price > 0 && (
                      <div style={{marginTop:6,fontSize:13,color:'var(--text-2)'}}>
                        {tc('pos_page.amount_label','Amount')}: <strong>₹{calcAmount}</strong>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{marginBottom:'1rem'}}>
                    <label className="label">{tc('pos_page.amount_rs','Amount (₹)')}</label>
                    <input className="input input-lg" type="number" step="0.01" min="1"
                      placeholder="e.g. 500.00" value={amount}
                      onChange={e=>setAmount(e.target.value)} required/>
                    {amount && price > 0 && (
                      <div style={{marginTop:6,fontSize:13,color:'var(--text-2)'}}>
                        {tc('pos_page.litres_label','Litres')}: <strong>{calcLitres} L</strong>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Payment mode */}
            <div style={{marginBottom:'1rem'}}>
              <label className="label">{tc('pos_page.payment_mode','Payment Mode')}</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {PAYMENT_MODES.map(pm=>(
                  <button key={pm.id} type="button"
                    className={`btn ${payMode===pm.id?'btn-primary':'btn-secondary'}`}
                    style={{
                      justifyContent:'center',
                      fontWeight: payMode===pm.id ? 700 : 500,
                      ...(payMode===pm.id ? { background:pm.color, borderColor:pm.color } : {}),
                    }}
                    onClick={()=>setPayMode(pm.id)}>
                    {tc(pm.labelKey,pm.fallback)}
                  </button>
                ))}
              </div>
            </div>

            {/* Credit customer selector */}
            {payMode === 'credit' && (
              <div style={{marginBottom:'1rem'}}>
                <label className="label">{tc('pos_page.credit_customer','Credit Customer')} *</label>
                <select className="input" required
                  value={selectedCorp} onChange={e=>setSelectedCorp(e.target.value)}>
                  <option value="">{tc('pos_page.select_credit_customer','Select credit customer...')}</option>
                  {corps.map(c=>(
                    <option key={c.id} value={c.id}>
                      {c.company_name} — {tc('pos_page.available','Available')}: ₹{Number(
                        (c.credit_limit||0) - (c.current_outstanding||0)
                      ).toLocaleString('en-IN',{maximumFractionDigits:0})}
                    </option>
                  ))}
                </select>
                {selectedCorp && corps.find(c=>c.id===selectedCorp) && (
                  <div style={{fontSize:12,marginTop:4,color:'var(--text-2)'}}>
                    {tc('pos_page.outstanding','Outstanding')}: ₹{Number(corps.find(c=>c.id===selectedCorp)?.current_outstanding||0)
                      .toLocaleString('en-IN')} /
                    {tc('pos_page.limit','Limit')}: ₹{Number(corps.find(c=>c.id===selectedCorp)?.credit_limit||0)
                      .toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            )}

            {/* UPI reference */}
            {payMode === 'upi' && (
              <div style={{marginBottom:'1rem'}}>
                <label className="label">{tc('pos_page.upi_ref','UPI Reference / Transaction ID')}</label>
                <input className="input" placeholder="e.g. UPI123456789"
                  value={upiRef} onChange={e=>setUpiRef(e.target.value)}/>
              </div>
            )}

            {/* Vehicle number */}
            <div style={{marginBottom:'1.25rem'}}>
              <label className="label">{tc('pos_page.vehicle_optional','Vehicle Number (optional)')}</label>
              <input className="input" placeholder="e.g. TN09AB1234"
                value={vehicle}
                onChange={e=>setVehicle(e.target.value.toUpperCase())}
                style={{textTransform:'uppercase',letterSpacing:'0.05em'}}/>
            </div>

            {/* Summary */}
            {nozzle && (litres || amount) && (
              <div style={{background:'var(--surface-2)',borderRadius:10,padding:'1rem',marginBottom:'1rem'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:14}}>
                  <div><span style={{color:'var(--text-3)'}}>{tc('pos_page.fuel','Fuel')}: </span>
                    <strong style={{textTransform:'capitalize'}}>{getFuelType(nozzle)}</strong></div>
                  <div><span style={{color:'var(--text-3)'}}>{tc('pos_page.rate','Rate')}: </span>
                    <strong>₹{price}/L</strong></div>
                  <div><span style={{color:'var(--text-3)'}}>{tc('pos_page.qty','Qty')}: </span>
                    <strong>{entryMode==='litres'
                      ? Number(litres).toFixed(3)
                      : calcLitres} L</strong></div>
                  <div><span style={{color:'var(--text-3)'}}>{tc('pos_page.amount_label','Amount')}: </span>
                    <strong style={{color:'var(--brand)',fontSize:16}}>
                      ₹{entryMode==='litres' ? calcAmount : Number(amount).toFixed(2)}
                    </strong></div>
                </div>
              </div>
            )}

            <button className="btn btn-primary btn-lg" type="submit"
              style={{width:'100%',justifyContent:'center'}}
              disabled={loading || !activeShift || !nozzle || geoStatus==='outside'}>
              {loading ? tc('pos_page.recording','Recording...') : geoStatus==='outside' ? '🚫 Outside Station Boundary' : tc('pos_page.record_txn','✓ Record Transaction')}
            </button>

          </form>
        </div>
      </div>
    </AppShell>
  );
}
