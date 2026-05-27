'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, CheckCircle, X } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getShifts, getNozzles, getCurrentPrices, recordDispense } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const PAYMENT_MODES = [
  { id:'cash',   label:'💵 Cash',   color:'#16a34a' },
  { id:'upi',    label:'📱 UPI',    color:'#2563eb' },
  { id:'credit', label:'🏢 Credit', color:'#9333ea' },
  { id:'card',   label:'💳 Card',   color:'#ea580c' },
];

const fmt = n => Number(n||0).toFixed(2);

export default function POSPage() {
  const { t } = useTranslation();
  const { user, station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [shifts,setShifts]     = useState([]);
  const [nozzles,setNozzles]   = useState([]);
  const [prices,setPrices]     = useState([]);
  const [activeShift,setActiveShift] = useState(null);

  // Form state
  const [nozzle,setNozzle]       = useState('');
  const [entryMode,setEntryMode] = useState('litres'); // 'litres' or 'amount'
  const [litres,setLitres]       = useState('');
  const [amount,setAmount]       = useState('');
  const [payMode,setPayMode]     = useState('cash');
  const [vehicle,setVehicle]     = useState('');
  const [upiRef,setUpiRef]       = useState('');
  const [showQR,setShowQR]       = useState(false);

  // Success state
  const [lastTxn,setLastTxn]   = useState(null);
  const [loading,setLoading]   = useState(false);
  const [todayTxns,setTodayTxns] = useState([]);

  useEffect(()=>{
    if(!stationId) return;
    Promise.all([
      getShifts({station_id:stationId,date:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})}),
      getNozzles(stationId),
      getCurrentPrices(stationId),
    ]).then(([s,n,p])=>{
      setShifts(s); setNozzles(n); setPrices(p);
      const open = s.find(x=>x.status==='open');
      if(open) setActiveShift(open);
    });
  },[stationId]);

  const getPrice = (nozzleId) => {
    const n = nozzles.find(x=>x.id===nozzleId);
    if(!n) return 0;
    const p = prices.find(x=>x.fuel_type===n.fuel_type);
    return p ? parseFloat(p.price) : 0;
  };

  const getFuelType = (nozzleId) => {
    const n = nozzles.find(x=>x.id===nozzleId);
    return n?.fuel_type||'';
  };

  // Calculate the other field
  const price = getPrice(nozzle);
  const calcAmount = litres && price ? (parseFloat(litres)*price).toFixed(2) : '';
  const calcLitres = amount && price ? (parseFloat(amount)/price).toFixed(3) : '';

  const handleSubmit = async(e) => {
    e.preventDefault();
    if(!activeShift) return alert('No open shift found. Please open a shift first.');
    if(!nozzle) return alert('Please select a nozzle');
    const qty = entryMode==='litres' ? parseFloat(litres) : parseFloat(calcLitres);
    if(!qty||qty<=0) return alert('Enter valid quantity');
    setLoading(true);
    try {
      const res = await recordDispense({
        station_id:stationId,
        shift_id:activeShift.id,
        rfid_tag_uid:'MANUAL',
        nozzle_id:nozzle,
        quantity_ltrs:qty,
        payment_mode:payMode,
        upi_ref:upiRef||null,
        vehicle_number:vehicle||null,
      });
      setLastTxn({ ...res, fuel_type:getFuelType(nozzle), price, qty });
      setTodayTxns(p=>[res,...p].slice(0,10));
      // Reset form
      setLitres(''); setAmount(''); setVehicle(''); setUpiRef('');
    } catch(err){ alert(err.error||'Transaction failed. Please try again.'); }
    finally{ setLoading(false); }
  };

  const selectedNozzle = nozzles.find(n=>n.id===nozzle);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">POS — Transaction Entry</h1>
          {activeShift
            ? <div style={{fontSize:13,color:'var(--success)'}}>● Shift {activeShift.shift_number} is open</div>
            : <div style={{fontSize:13,color:'var(--danger)'}}>⚠ No open shift — contact manager</div>}
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
                <div style={{fontWeight:600}}>Transaction Recorded! ✓</div>
                <div style={{fontSize:13}}>
                  {Number(lastTxn.qty).toFixed(2)} L · ₹{fmt(lastTxn.amount)} · {lastTxn.payment_mode}
                </div>
              </div>
              <button onClick={()=>setLastTxn(null)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={16}/></button>
            </div>
          )}

          <div className="card">
            <form onSubmit={handleSubmit}>
              {/* Nozzle selector */}
              <div style={{marginBottom:'1rem'}}>
                <label className="label">Select Nozzle</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
                  {nozzles.filter(n=>n.is_active).map(n=>(
                    <button key={n.id} type="button"
                      className={`btn ${nozzle===n.id?'btn-primary':'btn-secondary'}`}
                      style={{flexDirection:'column',height:'auto',padding:'10px 6px',fontSize:12,gap:2}}
                      onClick={()=>setNozzle(n.id)}>
                      <span style={{fontWeight:700}}>N{n.nozzle_number}</span>
                      <span style={{fontSize:10,opacity:.8,textTransform:'capitalize'}}>{n.fuel_type}</span>
                      {prices.find(p=>p.fuel_type===n.fuel_type) && (
                        <span style={{fontSize:10,opacity:.7}}>₹{getPrice(n.id)}/L</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Entry mode */}
              {nozzle && (
                <>
                  <div style={{marginBottom:'1rem'}}>
                    <label className="label">Enter by</label>
                    <div style={{display:'flex',gap:8}}>
                      <button type="button"
                        className={`btn ${entryMode==='litres'?'btn-primary':'btn-secondary'}`}
                        style={{flex:1,justifyContent:'center'}}
                        onClick={()=>setEntryMode('litres')}>Litres</button>
                      <button type="button"
                        className={`btn ${entryMode==='amount'?'btn-primary':'btn-secondary'}`}
                        style={{flex:1,justifyContent:'center'}}
                        onClick={()=>setEntryMode('amount')}>Amount (₹)</button>
                    </div>
                  </div>

                  {entryMode==='litres'?(
                    <div style={{marginBottom:'1rem'}}>
                      <label className="label">Quantity (Litres)</label>
                      <input className="input input-lg" type="number" step="0.001" min="0.001"
                        placeholder="e.g. 10.000" value={litres} onChange={e=>setLitres(e.target.value)} required/>
                      {litres && price>0 && (
                        <div style={{marginTop:6,fontSize:13,color:'var(--text-2)'}}>
                          Amount: <strong>₹{calcAmount}</strong>
                        </div>
                      )}
                    </div>
                  ):(
                    <div style={{marginBottom:'1rem'}}>
                      <label className="label">Amount (₹)</label>
                      <input className="input input-lg" type="number" step="0.01" min="1"
                        placeholder="e.g. 500.00" value={amount} onChange={e=>setAmount(e.target.value)} required/>
                      {amount && price>0 && (
                        <div style={{marginTop:6,fontSize:13,color:'var(--text-2)'}}>
                          Litres: <strong>{calcLitres} L</strong>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Payment mode */}
              <div style={{marginBottom:'1rem'}}>
                <label className="label">Payment Mode</label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                  {PAYMENT_MODES.map(pm=>(
                    <button key={pm.id} type="button"
                      className={`btn ${payMode===pm.id?'btn-primary':'btn-secondary'}`}
                      style={{justifyContent:'center',fontWeight:payMode===pm.id?700:500,
                        ...(payMode===pm.id?{background:pm.color,borderColor:pm.color}:{})}}
                      onClick={()=>setPayMode(pm.id)}>
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* UPI ref if UPI selected */}
              {payMode==='upi' && (
                <div style={{marginBottom:'1rem'}}>
                  <label className="label">UPI Reference / Transaction ID</label>
                  <input className="input" placeholder="e.g. UPI123456789" value={upiRef} onChange={e=>setUpiRef(e.target.value)}/>
                </div>
              )}

              {/* Vehicle number */}
              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">Vehicle Number (optional)</label>
                <input className="input" placeholder="e.g. TN09AB1234" value={vehicle}
                  onChange={e=>setVehicle(e.target.value.toUpperCase())}
                  style={{textTransform:'uppercase',letterSpacing:'0.05em'}}/>
              </div>

              {/* Summary box */}
              {nozzle && (litres||amount) && (
                <div style={{background:'var(--surface-2)',borderRadius:10,padding:'1rem',marginBottom:'1rem'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:14}}>
                    <div><span style={{color:'var(--text-3)'}}>Fuel: </span><strong style={{textTransform:'capitalize'}}>{getFuelType(nozzle)}</strong></div>
                    <div><span style={{color:'var(--text-3)'}}>Rate: </span><strong>₹{price}/L</strong></div>
                    <div><span style={{color:'var(--text-3)'}}>Qty: </span><strong>{entryMode==='litres'?Number(litres).toFixed(3):calcLitres} L</strong></div>
                    <div><span style={{color:'var(--text-3)'}}>Amount: </span><strong style={{color:'var(--brand)',fontSize:16}}>₹{entryMode==='litres'?calcAmount:Number(amount).toFixed(2)}</strong></div>
                  </div>
                </div>
              )}

              <button className="btn btn-primary btn-lg" type="submit"
                style={{width:'100%',justifyContent:'center'}} disabled={loading||!activeShift||!nozzle}>
                {loading?'Recording...':`✓ Record Transaction`}
              </button>
            </form>
          </div>
        </div>

        {/* Today's transactions */}
        <div className="card">
          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14,display:'flex',alignItems:'center',gap:8}}>
            <div className="live-dot"/>
            Today's Transactions
          </div>
          {todayTxns.length===0 && (
            <div style={{textAlign:'center',color:'var(--text-3)',padding:'3rem',fontSize:13}}>
              No transactions yet this session.<br/>Record your first transaction on the left.
            </div>
          )}
          <div className="table-wrap">
            {todayTxns.length>0 && (
              <table className="dms-table">
                <thead>
                  <tr><th>#</th><th>Nozzle</th><th>Qty (L)</th><th>Amount</th><th>Mode</th><th>Vehicle</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {todayTxns.map((tx,i)=>(
                    <tr key={tx.id}>
                      <td className="num" style={{color:'var(--text-3)'}}>{tx.event_seq||i+1}</td>
                      <td>N{nozzles.find(n=>n.id===tx.nozzle_id)?.nozzle_number||'?'}</td>
                      <td className="num">{Number(tx.quantity_ltrs).toFixed(3)}</td>
                      <td className="num" style={{fontWeight:600}}>₹{fmt(tx.amount)}</td>
                      <td><span className="badge badge-gray">{tx.payment_mode}</span></td>
                      <td style={{fontSize:12}}>{tx.vehicle_number||'—'}</td>
                      <td style={{fontSize:12,color:'var(--text-3)'}}>
                        {new Date(tx.occurred_at||Date.now()).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
