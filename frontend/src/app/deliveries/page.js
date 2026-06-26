'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, CheckCircle, Truck, Package, Camera, Upload, ScanLine, Paperclip } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { pdfToPng } from '../../lib/pdfToPng';

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

  // ── Invoice scanning (photo / PDF → pre-filled fields, user verifies) ──
  const [scanning,  setScanning]  = useState(false);
  const [scanErr,   setScanErr]   = useState('');
  const [items,     setItems]     = useState([]);   // parsed line-items
  const [activeItem,setActiveItem]= useState(0);
  const [recorded,  setRecorded]  = useState([]);   // indices already saved
  const [scanMeta,  setScanMeta]  = useState(null); // confidence/notes
  const [scanFile,  setScanFile]  = useState(null); // {base64,media_type} — attached on save
  const [invoiceId, setInvoiceId] = useState(null); // shared across an invoice's compartments
  const [viewDoc,   setViewDoc]   = useState(null); // {media_type,url} for the viewer

  const openInvoice = async (deliveryId) => {
    try {
      const r = await api.get(`/deliveries/${deliveryId}/invoice`);
      const bytes = Uint8Array.from(atob(r.file_base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.media_type }));
      setViewDoc({ media_type: r.media_type, url });
    } catch (err) { alert(err.error || tc('deliv_page.invoice_fail','Could not load the invoice.')); }
  };
  const closeViewer = () => { if (viewDoc?.url) URL.revokeObjectURL(viewDoc.url); setViewDoc(null); };

  const OIL_MAP = { IOC:'IOC', 'INDIAN OIL':'IOC', IOCL:'IOC', HPCL:'HPCL', BPCL:'BPCL', ESSAR:'Essar', SHELL:'Shell', RELIANCE:'Reliance', NAYARA:'Nayara' };

  const blankForm = () => ({ dc_date: today, received_at: nowISTStr(), fuel_type:'petrol', oil_company:'HPCL', freight:0 });

  const openForm = () => {
    setForm(blankForm());
    setItems([]); setRecorded([]); setActiveItem(0); setScanMeta(null); setScanErr('');
    setScanFile(null); setInvoiceId(null);
    setShowForm(true);
  };

  // Read a file as base64; downscale photos client-side so mobile uploads stay small.
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      const r = new FileReader();
      r.onload  = () => resolve({ base64: String(r.result).split(',')[1], media_type: 'application/pdf' });
      r.onerror = reject; r.readAsDataURL(file);
      return;
    }
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      // Crisper than before (2600px / q0.92): smudged HPCL phone photos sit right
      // at the OCR legibility edge, so don't degrade them more than necessary.
      const max = 2600, scale = Math.min(1, max / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      resolve({ base64: c.toDataURL('image/jpeg', 0.92).split(',')[1], media_type: 'image/jpeg' });
    };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

  const selectItem = (i, list = items) => {
    const it = list[i]; if (!it) return;
    setActiveItem(i);
    const match = tanks.filter(t => t.fuel_type === it.fuel_type);
    // Rate is the all-inclusive cost per litre = full value ÷ litres (owner rule),
    // derived deterministically from the total so it never depends on OCR division.
    const vol = it.gross_volume_ltrs != null ? Number(it.gross_volume_ltrs) : null;
    const tot = it.total_value != null ? Number(it.total_value) : null;
    const rate = (tot && vol) ? +(tot / vol).toFixed(2) : (it.rate_per_ltr != null ? Number(it.rate_per_ltr) : null);
    setForm(p => ({
      ...p,
      fuel_type:         it.fuel_type || p.fuel_type,
      tank_id:           match.length === 1 ? match[0].id : '',
      gross_volume_ltrs: it.gross_volume_ltrs != null ? String(it.gross_volume_ltrs) : '',
      density:           it.density != null ? String(it.density) : '',
      rate_per_ltr:      rate != null ? String(rate) : '',
      total_value:       it.total_value != null ? String(it.total_value) : '',
      compartment_no:    it.compartment_no || '',
      notes:             [it.product_name && `Product: ${it.product_name}`, it.sample_no && `Sample ${it.sample_no}`].filter(Boolean).join(' · '),
    }));
  };

  const applyParsed = (res) => {
    const its = Array.isArray(res.items) ? res.items : [];
    setItems(its); setRecorded([]); setActiveItem(0);
    setScanMeta({ confidence: res.confidence, notes: res.notes });
    setForm(p => ({
      ...p,
      dc_number:     res.dc_number   || p.dc_number,
      dc_date:       res.dc_date     || p.dc_date,
      received_at:   res.received_at ? String(res.received_at).slice(0,16) : p.received_at,
      oil_company:   OIL_MAP[String(res.oil_company||'').toUpperCase()] || p.oil_company,
      depot_name:    res.depot_name    || p.depot_name,
      tanker_number: res.tanker_number || p.tanker_number,
      seal_number:   res.seal_number   || p.seal_number,
    }));
    if (its.length) selectItem(0, its);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const ok = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
    if (!ok.includes(file.type)) { setScanErr(tc('deliv_page.bad_file','Upload a photo (JPG/PNG) or a PDF.')); return; }
    setScanErr(''); setScanning(true);
    try {
      const { base64, media_type } = await fileToBase64(file);
      setScanFile({ base64, media_type }); setInvoiceId(null);   // keep ORIGINAL (PDF/photo) to attach on save
      // The model reads image-based PDFs reliably as a PNG but flakily as a raw
      // PDF, so rasterise page 1 to a PNG just for OCR. The stored record keeps
      // the original PDF above; only the scan payload becomes the PNG.
      let scanB64 = base64, scanType = media_type;
      if (media_type === 'application/pdf') {
        try { const png = await pdfToPng(base64); scanB64 = png.base64; scanType = png.media_type; }
        catch { /* conversion failed — fall back to sending the PDF as-is */ }
      }
      // The first scan is occasionally flaky — one silent retry before we give up.
      let res;
      try { res = await api.post('/deliveries/parse-invoice', { station_id: stationId, file_base64: scanB64, media_type: scanType }); }
      catch (e1) { res = await api.post('/deliveries/parse-invoice', { station_id: stationId, file_base64: scanB64, media_type: scanType }); }
      applyParsed(res);
    } catch (err) {
      setScanErr(err.error || tc('deliv_page.scan_fail','Could not read the invoice — enter the details manually.'));
    } finally { setScanning(false); }
  };

  // Auto-calculate net volume
  const netVolume = () => {
    if (form.gross_volume_ltrs && form.density && form.temperature_c) {
      return (form.gross_volume_ltrs * form.density * (1 - 0.00090*(form.temperature_c - 15))).toFixed(2);
    }
    return form.gross_volume_ltrs || '';
  };

  // Total value = the invoice's "Total for material" (incl. taxes) when scanned or
  // typed; otherwise a gross × rate + freight estimate (pre-tax) as a fallback.
  const computedTotal = () => (form.rate_per_ltr && form.gross_volume_ltrs)
    ? (parseFloat(form.rate_per_ltr) * parseFloat(form.gross_volume_ltrs) + parseFloat(form.freight || 0)).toFixed(2)
    : '';
  const totalValue = () => (form.total_value !== '' && form.total_value != null) ? String(form.total_value) : computedTotal();

  // Multi-product invoice progress — drives the save button + banner so the user
  // always knows whether a press records a NEW product or would be a re-submit.
  const totalItems     = items.length;
  const doneItems      = recorded.length;
  const isMultiProduct = totalItems > 1;
  const remainingAfter = items.map((_, i) => i).filter(i => i !== activeItem && !recorded.includes(i)).length;
  const currentItemNo  = Math.min(doneItems + 1, totalItems);

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
      // Attach the scanned invoice: first compartment uploads the file, the rest
      // reuse the returned invoice_id so they share one stored record.
      if (invoiceId) payload.invoice_id = invoiceId;
      else if (scanFile) { payload.invoice_base64 = scanFile.base64; payload.invoice_media_type = scanFile.media_type; }

      const created = await api.post('/deliveries', payload);
      if (created?.invoice_id && !invoiceId) setInvoiceId(created.invoice_id);

      // Multi-product invoice: keep the modal open and tee up the next compartment.
      const stillLeft = items.map((_,i)=>i).filter(i => i!==activeItem && !recorded.includes(i));
      if (items.length && stillLeft.length) {
        setRecorded(r => [...r, activeItem]);
        selectItem(stillLeft[0]);
        setSaved(tc('deliv_page.saved_next','Saved — now review the next product from this invoice.'));
        setTimeout(()=>setSaved(''), 4000);
        setLoading(false);
        load();
        return;
      }

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
          <button className="btn btn-primary" onClick={openForm}>
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
                  <td style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:600}}>
                    {d.dc_number||'—'}
                    {d.invoice_id && (
                      <button type="button" title={tc('deliv_page.view_invoice','View scanned invoice')}
                        onClick={()=>openInvoice(d.id)}
                        style={{marginLeft:6,background:'none',border:'none',cursor:'pointer',padding:0,verticalAlign:'middle'}}>
                        <Paperclip size={13} style={{color:'var(--brand)'}}/>
                      </button>
                    )}
                  </td>
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
              {/* Scan invoice / DC — photo or PDF → pre-fill, user verifies */}
              <div style={{border:'1px dashed var(--border)',borderRadius:8,padding:'0.85rem',marginBottom:'1.1rem',background:'var(--surface-2)'}}
                onDragOver={e=>e.preventDefault()}
                onDrop={e=>{e.preventDefault(); handleFile(e.dataTransfer.files?.[0]);}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <ScanLine size={18} style={{color:'var(--brand)',flexShrink:0}}/>
                  <div style={{flex:1,minWidth:150}}>
                    <div style={{fontWeight:600,fontSize:13}}>{tc('deliv_page.scan_title','Scan the invoice / DC')}</div>
                    <div style={{fontSize:11,color:'var(--text-3)'}}>{tc('deliv_page.scan_sub','Photo or PDF — we pre-fill the fields for you to verify.')}</div>
                  </div>
                  <label className="btn btn-secondary btn-sm" style={{cursor:'pointer'}}>
                    <Camera size={14}/>{tc('deliv_page.take_photo','Take photo')}
                    <input type="file" accept="image/*" capture="environment" hidden onChange={e=>handleFile(e.target.files?.[0])}/>
                  </label>
                  <label className="btn btn-secondary btn-sm" style={{cursor:'pointer'}}>
                    <Upload size={14}/>{tc('deliv_page.upload','Upload')}
                    <input type="file" accept="image/*,application/pdf" hidden onChange={e=>handleFile(e.target.files?.[0])}/>
                  </label>
                </div>
                {scanning && <div style={{fontSize:12,color:'var(--brand)',marginTop:8}}>⏳ {tc('deliv_page.reading','Reading the invoice…')}</div>}
                {scanErr  && <div style={{fontSize:12,color:'var(--danger)',marginTop:8}}>{scanErr}</div>}
                {items.length>0 && (
                  <div style={{marginTop:10}}>
                    <div style={{fontSize:11,color:'var(--text-3)',marginBottom:4}}>
                      {tc('deliv_page.detected','Detected products — pick one to record:')}
                      {scanMeta?.confidence && <span> · {tc('deliv_page.confidence','confidence')}: <b>{scanMeta.confidence}</b></span>}
                    </div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {items.map((it,i)=>(
                        <button type="button" key={i} onClick={()=>selectItem(i)}
                          className={`badge ${i===activeItem?'badge-info':'badge-gray'}`}
                          style={{cursor:'pointer',opacity:recorded.includes(i)?0.45:1,padding:'4px 8px'}}>
                          {recorded.includes(i)?'✓ ':''}{it.fuel_type} · {fmtL(it.gross_volume_ltrs)}L
                        </button>
                      ))}
                    </div>
                    <div style={{fontSize:11,color:'var(--warning)',marginTop:8}}>
                      ⚠ {tc('deliv_page.verify_warn','Auto-filled from the scan — verify every field against the paper before you confirm.')}
                    </div>
                  </div>
                )}
              </div>

              {/* Section: Challan Details */}
              <div style={{fontSize:12,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'0.75rem',borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                {tc('deliv_page.challan_details','Challan Details')}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:'1rem'}}>
                <div>
                  <label className="label">{tc('deliv_page.dc_number','DC Number')}</label>
                  <input className="input" placeholder="DC/2026/04/12345" value={form.dc_number||''}
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
                  <input className="input" placeholder="e.g. Madurai Terminal" value={form.depot_name||''}
                    onChange={e=>f('depot_name',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.tanker_number','Tanker Number')}</label>
                  <input className="input" placeholder="TN58AB1234" value={form.tanker_number||''}
                    onChange={e=>f('tanker_number',e.target.value.toUpperCase())}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.compartment','Compartment No.')}</label>
                  <input className="input" placeholder="e.g. 1 or C1" value={form.compartment_no||''}
                    onChange={e=>f('compartment_no',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.seal_number','Seal Number')}</label>
                  <input className="input" placeholder="Security seal no." value={form.seal_number||''}
                    onChange={e=>f('seal_number',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.batch_number','Batch Number')}</label>
                  <input className="input" placeholder="Quality batch ref." value={form.batch_number||''}
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
                  <select className="input" value={form.tank_id||''} onChange={e=>f('tank_id',e.target.value)} required>
                    <option value="">{tc('deliv_page.select_tank','Select tank...')}</option>
                    {tanks.filter(t=>t.fuel_type===form.fuel_type).map(t=>(
                      <option key={t.id} value={t.id}>{tc('deliv_page.tank','Tank')} {t.tank_number} — {t.fuel_type} ({fmtL(t.current_stock)}L {tc('deliv_page.current','current')})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.during_shift','During Shift')}</label>
                  <select className="input" value={form.shift_id||''} onChange={e=>f('shift_id',e.target.value)}>
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
                  <input className="input" type="number" step="0.01" placeholder="10250.00" value={form.gross_volume_ltrs||''}
                    onChange={e=>f('gross_volume_ltrs',e.target.value)} required/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.temperature','Temperature (°C)')}</label>
                  <input className="input" type="number" step="0.1" placeholder="34.2" value={form.temperature_c||''}
                    onChange={e=>f('temperature_c',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.density','Density (kg/L)')}</label>
                  <input className="input" type="number" step="0.0001" placeholder="0.7358" value={form.density||''}
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
                  <input className="input" type="number" step="0.01" placeholder="67.42" value={form.rate_per_ltr||''}
                    onChange={e=>f('rate_per_ltr',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.freight','Freight (₹)')}</label>
                  <input className="input" type="number" step="0.01" placeholder="12400.00"
                    value={form.freight} onChange={e=>f('freight',e.target.value)}/>
                </div>
                <div>
                  <label className="label">{tc('deliv_page.total_value_rs','Total Value (₹)')}</label>
                  <input className="input" type="number" step="0.01" value={form.total_value ?? ''}
                    placeholder={computedTotal() || '0.00'}
                    onChange={e=>f('total_value', e.target.value)}
                    style={{fontFamily:'var(--font-mono)',fontWeight:600}}/>
                  <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>{tc('deliv_page.total_hint','"Total for material" incl. taxes — from the invoice, editable')}</div>
                </div>
              </div>

              <div style={{marginBottom:'1.25rem'}}>
                <label className="label">{tc('deliv_page.notes','Notes')}</label>
                <textarea className="input" rows={2} placeholder={tc('deliv_page.notes_ph','Any observations about the delivery...')}
                  value={form.notes||''} onChange={e=>f('notes',e.target.value)}/>
              </div>

              {isMultiProduct && (
                <div style={{fontSize:12.5,marginBottom:8,padding:'8px 10px',borderRadius:8,
                             background:'#fef3c7',color:'#92400e',fontWeight:600}}>
                  {doneItems>0 && <>✓ {doneItems} of {totalItems} products saved · </>}
                  Now recording <b>product {currentItemNo} of {totalItems}</b>: {form.fuel_type} · {fmtL(form.gross_volume_ltrs)}L
                  {remainingAfter>0 ? ' — another product follows after this.' : ' — this is the last product.'}
                </div>
              )}
              <button className="btn btn-primary btn-lg" type="submit"
                style={{width:'100%',justifyContent:'center'}} disabled={loading}>
                {loading ? tc('deliv_page.saving','Saving...')
                  : remainingAfter>0
                    ? `✓ Record this product → ${remainingAfter} more to go`
                    : isMultiProduct
                      ? '✓ Record last product & finish'
                      : tc('deliv_page.record_update','✓ Record Delivery & Update Tank Stock')}
              </button>
              <div style={{fontSize:12,color:'var(--text-3)',textAlign:'center',marginTop:8}}>
                {tc('deliv_page.stock_auto','Tank stock will be updated automatically on save')}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice viewer */}
      {viewDoc && (
        <div onClick={closeViewer} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:120,padding:'1.5rem'}}>
          <div className="card" style={{width:760,maxWidth:'92vw',maxHeight:'92vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontWeight:600,fontSize:14}}>{tc('deliv_page.scanned_invoice','Scanned Invoice')}</div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <a className="btn btn-secondary btn-sm" href={viewDoc.url}
                   download={viewDoc.media_type==='application/pdf'?'invoice.pdf':'invoice.jpg'}>
                  {tc('deliv_page.download','Download')}
                </a>
                <button onClick={closeViewer} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
              </div>
            </div>
            <div style={{flex:1,overflow:'auto',background:'var(--surface-2)',borderRadius:6}}>
              {viewDoc.media_type==='application/pdf'
                ? <iframe title="invoice" src={viewDoc.url} style={{width:'100%',height:'78vh',border:'none'}}/>
                : <img alt="invoice" src={viewDoc.url} style={{width:'100%',height:'auto',display:'block'}}/>}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
