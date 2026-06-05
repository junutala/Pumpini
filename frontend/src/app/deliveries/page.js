'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, CheckCircle, Truck, Package } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt   = n => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits:2 });
const fmtL  = n => Number(n||0).toFixed(2);
const toIST = ts => ts ? new Date(ts).toLocaleString('en-IN',{
  timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
  year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
}) : '—';

const nowISTStr = () => new Date().toLocaleString('sv-SE',{timeZone:'Asia/Kolkata'}).slice(0,16);

const OIL_COMPANIES = ['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'];
const FUEL_TYPES    = ['petrol','diesel','cng','premium_petrol'];

export default function DeliveriesPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { station } = useAuth();
  const stationId = typeof station==='object'?station?.id:station;

  const [deliveries, setDeliveries] = useState([]);
  const [tanks,      setTanks]      = useState([]);
  const [shifts,     setShifts]     = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [saved,      setSaved]      = useState('');

  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

  const [form, setForm] = useState({
    dc_date:      today,
    received_at:  nowISTStr(),
    fuel_type:    'petrol',
    oil_company:  'HPCL',
    freight:      0,
  });

  const f = (field, val) => setForm(p => ({ ...p, [field]: val }));

  // Auto-calculate net volume
  const netVolume = () => {
    if (form.gross_volume_ltrs && form.density && form.temperature_c) {
      return (form.gross_volume_ltrs * form.density * (1 - 0.00090*(form.temperature_c - 15))).toFixed(2);
    }
    return form.gross_volume_ltrs || '';
  };

  // Auto-calculate total value
  const totalValue = () => {
    if (form.rate_per_ltr && form.gross_volume_ltrs) {
      return (parseFloat(form.rate_per_ltr) * parseFloat(form.gross_volume_ltrs) + parseFloat(form.freight||0)).toFixed(2);
    }
    return '';
  };

  const load = async () => {
    if (!stationId) return;
    const [d, t, s] = await Promise.all([
      api.get('/deliveries', { params: { station_id:stationId, limit:30 } }),
      api.get(`/dipstick/tanks/${stationId}`),
      api.get('/shifts', { params: { station_id:stationId, date:today } }),
    ]);
    setDeliveries(Array.isArray(d)?d:[]);
    setTanks(Array.isArray(t)?t:[]);
    setShifts(Array.isArray(s)?s:[]);
  };

  useEffect(() => { load(); }, [stationId]);
  useRefreshOnFocus(load);

  const handleSubmit = async e => {
    e.preventDefault(); setLoading(true);
    // Validate against tank capacity
    if (form.tank_id) {
      const tank = tanks.find(t=>t.id===form.tank_id);
      if (tank) {
        const available = parseFloat(tank.capacity_ltrs) - parseFloat(tank.current_stock);
        if (parseFloat(form.gross_volume_ltrs) > available) {
          alert(tc('deliv_page.exceeds','⚠ Delivery quantity ({q}L) exceeds available tank space ({a}L).').replace('{q}',form.gross_volume_ltrs).replace('{a}',available.toFixed(0))+'\n'+tc('deliv_page.tank_cap','Tank {n} capacity: {c}L, current stock: {s}L.').replace('{n}',tank.tank_number).replace('{c}',tank.capacity_ltrs).replace('{s}',tank.current_stock));
          setLoading(false);
          return;
        }
      }
    }
    try {
      const payload = {
        ...form,
        station_id:      stationId,
        received_at:     new Date(form.received_at).toISOString(),
        gross_volume_ltrs: parseFloat(form.gross_volume_ltrs),
        net_volume_ltrs:   parseFloat(netVolume())||parseFloat(form.gross_volume_ltrs),
        total_value:       parseFloat(totalValue())||null,
        temperature_c:     form.temperature_c ? parseFloat(form.temperature_c) : null,
        density:           form.density ? parseFloat(form.density) : null,
        rate_per_ltr:      form.rate_per_ltr ? parseFloat(form.rate_per_ltr) : null,
        freight:           parseFloat(form.freight||0),
      };
      await api.post('/deliveries', payload);
      setShowForm(false);
      setSaved(tc('deliv_page.delivery_recorded','Delivery recorded!'));
      setTimeout(()=>setSaved(''), 3000);
      load();
    } catch(err) { alert(err.error||tc('deliv_page.failed_record','Failed to record delivery')); }
    finally { setLoading(false); }
  };

  // Summary stats
  const todayDeliveries = deliveries.filter(d =>
    new Date(d.received_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}) === today
  );
  const todayVolume = todayDeliveries.reduce((s,d)=>s+parseFloat(d.gross_volume_ltrs||0),0);
  const todayValue  = todayDeliveries.reduce((s,d)=>s+parseFloat(d.total_value||0),0);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('deliv_page.title','Fuel Deliveries')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>{tc('deliv_page.subtitle','Record tanker deliveries & DC challans')}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {saved && <div className="badge badge-success"style={{padding:'6px 12px'}}>✓ {saved}</div>}
          <button className="btn btn-primary" onClick={()=>setShowForm(true)}>
            <Plus size={16}/>{tc('deliv_page.record_delivery','Record Delivery')}
          </button>
        </div>
      </div>

      {/* Today summary */}
      <div className="grid-3" style={{marginBottom:'1.5rem'}}>
        <div className="stat-card">
          <div className="stat-label">{tc('deliv_page.todays_deliveries',"Today's Deliveries")}</div>
          <div className="stat-value">{todayDeliveries.length}</div>
          <div className="stat-sub">{tc('deliv_page.tankers_received','tankers received')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('deliv_page.volume_today','Volume Received Today')}</div>
          <div className="stat-value" style={{color:'var(--petrol)'}}>{fmtL(todayVolume)} L</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{tc('deliv_page.value_today','Value Today')}</div>
          <div className="stat-value amount">{fmt(todayValue)}</div>
        </div>
      </div>

      {/* Deliveries table */}
      <div className="card">
        <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:14}}>{tc('deliv_page.delivery_register','Delivery Register')}</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('deliv_page.dc_number','DC Number')}</th>
                <th>{tc('deliv_page.received_ist','Received (IST)')}</th>
                <th>{tc('deliv_page.tanker_no','Tanker No.')}</th>
                <th>{tc('deliv_page.fuel','Fuel')}</th>
                <th>{tc('deliv_page.oil_co','Oil Co.')}</th>
                <th>{tc('deliv_page.depot','Depot')}</th>
                <th>{tc('deliv_page.gross_vol','Gross Vol (L)')}</th>
                <th>{tc('deliv_page.net_vol','Net Vol (L)')}</th>
                <th>{tc('deliv_page.rate_l','Rate/L')}</th>
                <th>{tc('deliv_page.total_value','Total Value')}</th>
                <th>{tc('deliv_page.tank','Tank')}</th>
                <th>{tc('deliv_page.verified','Verified')}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length===0 && (
                <tr><td colSpan={12} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>
                  <Truck size={28} style={{margin:'0 auto 8px',opacity:.3}}/>
                  <div>{tc('deliv_page.no_deliveries','No deliveries recorded yet')}</div>
                </td></tr>
              )}
              {deliveries.map(d=>(
                <tr key={d.id}>
                  <td style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:600}}>{d.dc_number||'—'}</td>
                  <td style={{fontSize:12,whiteSpace:'nowrap'}}>{toIST(d.received_at)}</td>
                  <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{d.tanker_number||'—'}</td>
                  <td><span className={`fuel-chip fuel-${d.fuel_type}`}>{d.fuel_type}</span></td>
                  <td><span className="badge badge-info" style={{fontSize:11}}>{d.oil_company||'—'}</span></td>
                  <td style={{fontSize:12,color:'var(--text-3)'}}>{d.depot_name||'—'}</td>
                  <td className="num">{fmtL(d.gross_volume_ltrs)}</td>
                  <td className="num">{fmtL(d.net_volume_ltrs)}</td>
                  <td className="num">{d.rate_per_ltr ? `₹${fmt(d.rate_per_ltr)}` : '—'}</td>
                  <td className="num">{d.total_value ? `₹${fmt(d.total_value)}` : '—'}</td>
                  <td>{tc('deliv_page.tank','Tank')} {d.tank_number||'—'}</td>
                  <td>
                    {d.verified_at
                      ? <span className="badge badge-success" style={{fontSize:11}}>{tc('deliv_page.verified_badge','✓ Verified')}</span>
                      : <button className="btn btn-secondary btn-sm" style={{fontSize:11}}
                          onClick={async()=>{await api.patch(`/deliveries/${d.id}/verify`);load();}}>
                          {tc('deliv_page.verify','Verify')}
                        </button>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Record Delivery */}
      {showForm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:100,overflowY:'auto',padding:'1.5rem 1rem'}}>
          <div className="card" style={{width:'100%',maxWidth:720}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>{tc('deliv_page.record_fuel_delivery','Record Fuel Delivery')}</div>
                <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{tc('deliv_page.enter_dc','Enter details from the Delivery Challan (DC)')}</div>
              </div>
              <button onClick={()=>setShowForm(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Section: Challan Details */}
              <div style={{fontSize:12,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'0.75rem',borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                {tc('deliv_page.challan_details','Challan Details')}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:'1rem'}}>
                <div>
                  <label className="label">{tc('deliv_page.dc_number','DC Number')}</label>
                  <input className="input" placeholder="DC/2026/04/12345"
                    onChange={e=>f('dc_number',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.dc_date','DC Date')}</label>
                  <input className="input" type="date" value={form.dc_date}
                    onChange={e=>f('dc_date',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.received_at','Received At (IST)')} *</label>
                  <input className="input" type="datetime-local" value={form.received_at}
                    onChange={e=>f('received_at',e.target.value)} required/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.oil_company','Oil Company')} *</label>
                  <select className="input" value={form.oil_company} onChange={e=>f('oil_company',e.target.value)}>
                    {OIL_COMPANIES.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.depot_terminal','Depot / Terminal Name')}</label>
                  <input className="input" placeholder="e.g. Madurai Terminal"
                    onChange={e=>f('depot_name',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.tanker_number','Tanker Number')}</label>
                  <input className="input" placeholder="TN58AB1234"
                    onChange={e=>f('tanker_number',e.target.value.toUpperCase())}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.compartment','Compartment No.')}</label>
                  <input className="input" placeholder="e.g. 1 or C1"
                    onChange={e=>f('compartment_no',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.seal_number','Seal Number')}</label>
                  <input className="input" placeholder="Security seal no."
                    onChange={e=>f('seal_number',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.batch_number','Batch Number')}</label>
                  <input className="input" placeholder="Quality batch ref."
                    onChange={e=>f('batch_number',e.target.value)}/>
                </div>
              </div>

              {/* Section: Product */}
              <div style={{fontSize:12,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'0.75rem',borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                {tc('deliv_page.product_details','Product Details')}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:'1rem'}}>
                <div>
                  <label className="label">{tc('deliv_page.fuel_type','Fuel Type')} *</label>
                  <select className="input" value={form.fuel_type} onChange={e=>f('fuel_type',e.target.value)} required>
                    {FUEL_TYPES.map(ft=><option key={ft} value={ft}>{ft}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.deliver_tank','Deliver to Tank')} *</label>
                  <select className="input" onChange={e=>f('tank_id',e.target.value)} required>
                    <option value="">{tc('deliv_page.select_tank','Select tank...')}</option>
                    {tanks.filter(t=>t.fuel_type===form.fuel_type).map(t=>(
                      <option key={t.id} value={t.id}>{tc('deliv_page.tank','Tank')} {t.tank_number} — {t.fuel_type} ({fmtL(t.current_stock)}L {tc('deliv_page.current','current')})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.during_shift','During Shift')}</label>
                  <select className="input" onChange={e=>f('shift_id',e.target.value)}>
                    <option value="">{tc('deliv_page.select_shift_opt','Select shift (optional)')}</option>
                    {shifts.map(s=><option key={s.id} value={s.id}>{tc('deliv_page.shift','Shift')} {s.shift_number} — {s.status}</option>)}
                  </select>
                </div>
              </div>

              {/* Section: Quantity */}
              <div style={{fontSize:12,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'0.75rem',borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                {tc('deliv_page.qty_quality','Quantity & Quality')}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10,marginBottom:'1rem'}}>
                <div>
                  <label className="label">{tc('deliv_page.gross_volume','Gross Volume (L)')} *</label>
                  <input className="input" type="number" step="0.01" placeholder="10250.00"
                    onChange={e=>f('gross_volume_ltrs',e.target.value)} required/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.temperature','Temperature (°C)')}</label>
                  <input className="input" type="number" step="0.1" placeholder="34.2"
                    onChange={e=>f('temperature_c',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.density','Density (kg/L)')}</label>
                  <input className="input" type="number" step="0.0001" placeholder="0.7358"
                    onChange={e=>f('density',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.net_15','Net Volume @ 15°C')}</label>
                  <input className="input" value={netVolume()} readOnly
                    style={{background:'var(--surface-2)',fontFamily:'var(--font-mono)',fontWeight:600}}/>
                  <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>{tc('deliv_page.auto_calc','Auto-calculated')}</div>
                </div>
              </div>

              {/* Section: Financial */}
              <div style={{fontSize:12,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'0.75rem',borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                {tc('deliv_page.financial_details','Financial Details')}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:'1.25rem'}}>
                <div>
                  <label className="label">{tc('deliv_page.rate_per_ltr','Rate per Litre (₹ ex-depot)')}</label>
                  <input className="input" type="number" step="0.01" placeholder="67.42"
                    onChange={e=>f('rate_per_ltr',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.freight','Freight (₹)')}</label>
                  <input className="input" type="number" step="0.01" placeholder="12400.00"
                    value={form.freight} onChange={e=>f('freight',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.total_value_rs','Total Value (₹)')}</label>
                  <input className="input" value={totalValue()} readOnly
                    style={{background:'var(--surface-2)',fontFamily:'var(--font-mono)',fontWeight:600}}/>
                  <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>{tc('deliv_page.auto_calc','Auto-calculated')}</div>
                </div>
              </div>

              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">{tc('deliv_page.notes','Notes')}</label>
                <textarea className="input" rows={2} placeholder={tc('deliv_page.notes_ph','Any observations about the delivery...')}
                  onChange={e=>f('notes',e.target.value)}/>
              </div>

              <button className="btn btn-primary btn-lg" type="submit"
                style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading ? tc('deliv_page.saving','Saving...') : tc('deliv_page.record_update','✓ Record Delivery & Update Tank Stock')}
              </button>
              <div style={{fontSize:12,color:'var(--text-3)',textAlign:'center',marginTop:8}}>
                {tc('deliv_page.stock_auto','Tank stock will be updated automatically on save')}
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
