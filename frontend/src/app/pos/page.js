'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, CheckCircle, X, Mic, MicOff, Loader } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, getNozzles, getCurrentPrices, recordDispense } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const PAYMENT_MODES = [
  { id:'cash',   labelKey:'pos_page.cash',   fallback:'💵 Cash',   color:'#16a34a' },
  { id:'upi',    labelKey:'pos_page.upi',    fallback:'📱 UPI',    color:'#2563eb' },
  { id:'credit', labelKey:'pos_page.credit', fallback:'🏢 Credit', color:'#9333ea' },
  { id:'card',   labelKey:'pos_page.card',   fallback:'💳 Card',   color:'#ea580c' },
];

const fmt = n => Number(n||0).toFixed(2);

export default function POSPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { user, station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;

  const [shifts,setShifts]     = useState([]);
  const [nozzles,setNozzles]   = useState([]);
  const [prices,setPrices]     = useState([]);
  const [corps,setCorps]       = useState([]);
  const [activeShift,setActiveShift] = useState(null);

  // Geo-fence state
  const [geoStatus, setGeoStatus] = useState('checking'); // 'checking','ok','outside','disabled','error'
  const [geoDistance, setGeoDistance] = useState(null);

  // Voice POS state
  const [recording,  setRecording]  = useState(false);
  const [voiceStatus,setVoiceStatus] = useState(''); // 'recording','processing','done','error'
  const [mediaRec,   setMediaRec]   = useState(null);
  const [voiceHint,  setVoiceHint]  = useState('');

  // Form
  const [nozzle,setNozzle]         = useState('');
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
  const [todayTxns,setTodayTxns] = useState([]);

  useEffect(() => {
    if (!stationId) return;
    const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

    // Load all data in parallel
    Promise.all([
      getShifts({ station_id:stationId, date:today }),
      getNozzles(stationId),
      getCurrentPrices(stationId),
      api.get('/corporate', {params:{station_id:stationId}}),
    ]).then(([s, n, p, c]) => {
      setShifts(s);
      setNozzles(n);
      setPrices(p);
      setCorps(Array.isArray(c) ? c : []);
      const open = s.find(x => x.status === 'open');
      if (open) setActiveShift(open);
    }).catch(err => console.error('POS load error:', err));
  }, [stationId]);

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

    // Credit limit guard — block sales that exceed available credit
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
      setTodayTxns(p => [res, ...p].slice(0, 20));
      // Reset form
      setLitres(''); setAmount(''); setVehicle(''); setUpiRef(''); setSelectedCorp('');
    } catch (err) {
      alert(err.error || tc('pos_page.txn_failed','Transaction failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const selectedNozzle = nozzles.find(n => n.id === nozzle);


  // ── Geo-fence check ──────────────────────────────────────
  useEffect(() => {
    if (!stationId) return;
    // Load station geo settings
    api.get(`/stations/${stationId}/settings`).then(settings => {
      if (!settings.geo_fence_enabled || !settings.latitude || !settings.longitude) {
        setGeoStatus('disabled');
        return;
      }
      if (!navigator.geolocation) {
        setGeoStatus('error');
        return;
      }
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

  // Haversine distance formula (returns metres)
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
    if (recording) {
      // Stop recording
      if (mediaRec) mediaRec.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        setVoiceStatus('processing');
        setVoiceHint(tc('pos_page.voice_processing', 'Processing...'));

        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', blob, 'audio.webm');
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

          // Auto-fill POS form fields
          if (p.quantity)     setQty(p.quantity.toString());
          if (p.entry_type)   setEntryType(p.entry_type);
          if (p.payment_mode) setPayMode(p.payment_mode);

          // Auto-select nozzle:
          // 1. If fuel type spoken → find matching nozzle
          // 2. Else → keep last used nozzle (already restored on load)
          if (p.fuel_type && nozzles.length > 0) {
            const match = nozzles.find(n =>
              n.fuel_type?.toLowerCase().includes(p.fuel_type) ||
              p.fuel_type.includes(n.fuel_type?.toLowerCase())
            );
            if (match) setNozzle(match);
            // If no match found, keep current (last used) nozzle
          }
          // If no fuel type spoken at all, current nozzle stays selected

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

      // Auto-stop after 10 seconds
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 10000);

    } catch (err) {
      setVoiceStatus('error');
      setVoiceHint('Microphone access denied');
      setTimeout(() => { setVoiceStatus(''); setVoiceHint(''); }, 3000);
    }
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('pos_page.title','POS — Transaction Entry')}</h1>
          {activeShift
            ? <div style={{fontSize:13,color:'var(--success)'}}>● {tc('pos_page.shift_open','Shift {n} is open').replace('{n}',activeShift.shift_number)}</div>
            : <div style={{fontSize:13,color:'var(--danger)'}}>⚠ {tc('pos_page.no_shift','No open shift — contact manager')}</div>}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'420px 1fr',gap:'1.5rem'}}>

        {/* Entry Form */}
        <div>
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
                disabled={loading || !activeShift || !nozzle}>
                {loading ? tc('pos_page.recording','Recording...') : geoStatus==='outside' ? '🚫 Outside Station Boundary' : tc('pos_page.record_txn','✓ Record Transaction')}
              </button>

            </form>
          </div>
        </div>

        {/* Today's transactions */}
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14,
            display:'flex',alignItems:'center',gap:8}}>
            <div className="live-dot"/>
            {tc('pos_page.todays_txns',"Today's Transactions")}
          </div>
          {todayTxns.length === 0 && (
            <div style={{textAlign:'center',color:'var(--text-3)',padding:'3rem',fontSize:13}}>
              {tc('pos_page.no_txns','No transactions yet this session.')}<br/>
              {tc('pos_page.record_first','Record your first transaction on the left.')}
            </div>
          )}
          {todayTxns.length > 0 && (
            <div className="table-wrap">
              <table className="dms-table">
                <thead>
                  <tr>
                    <th>#</th><th>{tc('pos_page.nozzle','Nozzle')}</th><th>{tc('pos_page.qty','Qty')} (L)</th>
                    <th>{tc('pos_page.amount_label','Amount')}</th><th>{tc('pos_page.mode','Mode')}</th><th>{tc('common.vehicle','Vehicle')}</th><th>{tc('pos_page.time','Time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {todayTxns.map((tx, i) => (
                    <tr key={tx.id || i}>
                      <td className="num" style={{color:'var(--text-3)'}}>{tx.event_seq || i+1}</td>
                      <td>N{nozzles.find(n=>n.id===tx.nozzle_id)?.nozzle_number || '?'}</td>
                      <td className="num">{Number(tx.quantity_ltrs).toFixed(3)}</td>
                      <td className="num" style={{fontWeight:600}}>₹{fmt(tx.amount)}</td>
                      <td><span className="badge badge-gray">{tx.payment_mode}</span></td>
                      <td style={{fontSize:12}}>{tx.vehicle_number || '—'}</td>
                      <td style={{fontSize:12,color:'var(--text-3)'}}>
                        {new Date(tx.occurred_at||Date.now()).toLocaleTimeString('en-IN',{
                          timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:true
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
