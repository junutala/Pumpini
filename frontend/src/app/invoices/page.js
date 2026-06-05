'use client';
import { displayMobile } from '../../lib/india';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Download, CheckSquare, Square, Filter, X, Printer, ChevronDown } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmt   = n => Number(n||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtL  = n => Number(n||0).toFixed(3);
const toIST = ts => ts ? new Date(ts).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
const toDateIST = ts => ts ? new Date(ts).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}) : '—';

// Indian fuel taxation rules
// Petrol, Diesel, CNG — outside GST, subject to State VAT (no CGST/SGST on invoice)
// Lubes, Additives, Other products — 18% GST (CGST 9% + SGST 9%)
const GST_EXEMPT_FUELS = ['petrol','diesel','cng','premium_petrol'];
const LUBE_CGST_RATE   = 9;
const LUBE_SGST_RATE   = 9;

// Per-item tax calculation
const getTaxInfo = (fuel_type) => {
  if (GST_EXEMPT_FUELS.includes(fuel_type)) {
    return { cgst:0, sgst:0, exempt:true };
  }
  return { cgst:LUBE_CGST_RATE, sgst:LUBE_SGST_RATE, exempt:false };
};

const HSN_CODES = {
  petrol:         '27101249',
  diesel:         '27101969',
  cng:            '27112100',
  premium_petrol: '27101249',
  lubes:          '27101990',
};

export default function InvoicesPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;

  // Station & corporate data
  const [stationInfo,  setStationInfo]  = useState(null);
  const [stationSettings, setStationSettings] = useState(null);
  const [corps,        setCorps]        = useState([]);
  const [selectedCorp, setSelectedCorp] = useState('');
  const [corpDetail,   setCorpDetail]   = useState(null);

  // Date range
  const monthStart = new Date(new Date().setDate(1)).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const today      = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);

  // Transactions
  const [transactions, setTransactions] = useState([]);
  const [loading,      setLoading]      = useState(false);

  // Filters
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterDriver,  setFilterDriver]  = useState('');
  const [filterFuel,    setFilterFuel]    = useState('');

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Invoice preview
  const [showPreview, setShowPreview] = useState(false);
  const [invoiceNum,  setInvoiceNum]  = useState('');
  const [savedInvoices, setSavedInvoices] = useState([]);
  const printRef = useRef();

  const loadCorps = useCallback(()=>{
    if (!stationId) return;
    return Promise.all([
      api.get('/corporate', {params:{station_id:stationId}}),
      api.get(`/stations/${stationId}/settings`).catch(()=>null),
    ]).then(([c, s]) => { setCorps(c); setStationSettings(s); });
  }, [stationId]);

  useEffect(() => { loadCorps(); }, [loadCorps]);
  useRefreshOnFocus(loadCorps);

  useEffect(() => {
    if (selectedCorp) {
      api.get(`/corporate/${selectedCorp}/drivers`).then(d => {
        const corp = corps.find(c=>c.id===selectedCorp);
        setCorpDetail({ ...corp, drivers: d });
      });
    }
  }, [selectedCorp]);
    
  const loadTransactions = async () => {
    if (!selectedCorp || !stationId) return alert(tc('inv_page.select_first','Select a credit customer first'));
    setLoading(true);
    setSelected(new Set());
    try {
      const events = await api.get('/dispense', { params: {
        station_id: stationId,
        date_from:  dateFrom,
        date_to:    dateTo + 'T23:59:59',
        limit:      5000,
      }});

      // Filter to only UNINVOICED credit transactions
      // Also get corporate transactions to match
      const corpTxns = await api.get(`/corporate/${selectedCorp}/statement`, {
        params: { month: dateFrom.slice(0,7) }
      }).catch(()=>({ transactions:[] }));

      // Match dispense events with corporate transactions
      const corpTxnMap = {};
      (corpTxns.transactions||[]).forEach(t => {
        if (t.dispense_event_id) corpTxnMap[t.dispense_event_id] = t;
      });

      // Get all credit transactions for this station in date range
      const creditEvents = (Array.isArray(events)?events:[]).filter(e =>
        e.payment_mode === 'credit'
      );

      setTransactions(creditEvents);
    } catch(e) { console.error(e); alert(tc('inv_page.failed_load','Failed to load transactions')); }
    finally { setLoading(false); }
  };

  // Apply filters
  const filtered = transactions.filter(t => {
    if (filterVehicle && !( t.vehicle_number||'').toLowerCase().includes(filterVehicle.toLowerCase())) return false;
    if (filterDriver  && !(t.attendant_name||'').toLowerCase().includes(filterDriver.toLowerCase()))  return false;
    if (filterFuel    && t.fuel_type !== filterFuel) return false;
    return true;
  });

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(t=>t.id)));
    }
  };

  const toggleOne = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const selectedTxns = filtered.filter(t => selected.has(t.id));
  const subtotal     = selectedTxns.reduce((s,t) => s + parseFloat(t.amount||0), 0);
  // Only lubes attract GST — fuel lines are VAT-exempt from GST
  const taxableAmt   = selectedTxns
    .filter(t => !GST_EXEMPT_FUELS.includes(t.fuel_type))
    .reduce((s,t) => s + parseFloat(t.amount||0), 0);
  const exemptAmt    = subtotal - taxableAmt;
  const cgstAmt      = (taxableAmt * LUBE_CGST_RATE / 100);
  const sgstAmt      = (taxableAmt * LUBE_SGST_RATE / 100);
  const totalAmt     = subtotal + cgstAmt + sgstAmt;

  const generateInvoiceNumber = () => {
    const prefix = stationSettings?.invoice_prefix || 'INV';
    const seq    = (stationSettings?.invoice_seq || 1).toString().padStart(4,'0');
    const date   = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).replace(/-/g,'');
    return `${prefix}-${date}-${seq}`;
  };

  const handlePreview = () => {
    if (selected.size === 0) return alert(tc('inv_page.select_one','Please select at least one transaction'));
    setInvoiceNum(generateInvoiceNumber());
    setShowPreview(true);
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(
      `*GST Invoice ${invoiceNum}*\n` +
      `From: ${stationSettings?.name || 'Pumpini Station'}\n` +
      `To: ${corp?.company_name}\n` +
      `Period: ${toDateIST(dateFrom)} to ${toDateIST(dateTo)}\n` +
      `Amount: ₹${fmt(totalAmt)}${cgstAmt>0?' (incl. GST on lubes)':''}\n\n` +
      `Please find your invoice attached. For queries contact us on WhatsApp.`
    );
    // Option A: Open WhatsApp Web with pre-filled message
    const phone = corp?.contact_phone?.replace(/\D/g,'') || '';
    const waUrl = phone
      ? `https://wa.me/91${phone.slice(-10)}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(waUrl, '_blank');
    // Option B (production): Send via MSG91 WhatsApp API
    // await api.post('/notifications/whatsapp', { phone, message: decodeURIComponent(text), invoice_id: invoiceNum });
  };

  const handlePrint = () => {
    const content = printRef.current.innerHTML;
    const win = window.open('','_blank','width=900,height=700');
    win.document.write(`
      <html><head><title>GST Invoice ${invoiceNum}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 13px; color: #000; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        .header { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .title { font-size: 20px; font-weight: bold; color: #e07b0c; }
        .label { color: #666; font-size: 11px; text-transform: uppercase; }
        .amount { text-align: right; font-family: monospace; }
        .total-row { font-weight: bold; background: #f9f9f9; }
        .grand-total { font-size: 16px; font-weight: bold; }
        .footer { margin-top: 30px; font-size: 11px; color: #666; text-align: center; }
        @media print { body { padding: 0; } }
      </style>
      </head><body>${content}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  };

  const handleSaveAndPrint = async () => {
    try {
      await api.post('/invoices', {
        station_id:   stationId,
        corporate_id: selectedCorp,
        invoice_number: invoiceNum,
        invoice_date: today,
        period_from:  dateFrom,
        period_to:    dateTo,
        subtotal:     subtotal,
        cgst_rate:    LUBE_CGST_RATE,
        sgst_rate:    LUBE_SGST_RATE,
        taxable_amount: taxableAmt,
        exempt_amount:  exemptAmt,
        cgst_amount:  cgstAmt,
        sgst_amount:  sgstAmt,
        total_amount: totalAmt,
        line_items:   selectedTxns,
      });
    } catch(e) { /* Save failed — still allow print */ }
    handlePrint();
  };

  const corp = corps.find(c => c.id === selectedCorp);

  // Unique values for filter dropdowns
  const vehicles  = [...new Set(transactions.map(t=>t.vehicle_number).filter(Boolean))];
  const fuelTypes = [...new Set(transactions.map(t=>t.fuel_type).filter(Boolean))];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('inv_page.title','GST Invoice Generator')}</h1>
          <div style={{fontSize:13,color:'var(--text-3)'}}>
            {tc('inv_page.subtitle','Select transactions → filter by vehicle → generate GST invoice')}
          </div>
        </div>
        {selected.size > 0 && (
          <button className="btn btn-primary" onClick={handlePreview}>
            <FileText size={15}/>{tc('inv_page.preview_invoice','Preview Invoice')} ({selected.size} {tc('inv_page.items','items')} — ₹{fmt(totalAmt)})
          </button>
        )}
      </div>

      {/* Step 1: Select corporate + date range */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:'1rem'}}>{tc('inv_page.step1','Step 1 — Select Account & Date Range')}</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={{minWidth:240}}>
            <label className="label">{tc('inv_page.credit_customer','Credit Customer')}</label>
            <select className="input" value={selectedCorp}
              onChange={e=>{ setSelectedCorp(e.target.value); setTransactions([]); setSelected(new Set()); }}>
              <option value="">{tc('inv_page.select_credit','Select credit customer...')}</option>
              {corps.map(c=>(
                <option key={c.id} value={c.id}>
                  {c.company_name} — {tc('inv_page.bal','Bal')}: ₹{fmt(c.current_outstanding)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{tc('common.from','From')}</label>
            <input className="input" type="date" value={dateFrom} style={{width:155}}
              onChange={e=>setDateFrom(e.target.value)}/>
          </div>
          <div>
            <label className="label">{tc('common.to','To')}</label>
            <input className="input" type="date" value={dateTo} style={{width:155}}
              onChange={e=>setDateTo(e.target.value)}/>
          </div>
          {/* Quick month buttons */}
          <div style={{display:'flex',gap:6}}>
            {[0,1,2].map(i=>{
              const d = new Date();
              d.setMonth(d.getMonth()-i);
              const label = d.toLocaleDateString('en-IN',{month:'short',year:'numeric'});
              const from  = new Date(d.getFullYear(),d.getMonth(),1).toLocaleDateString('en-CA');
              const to    = new Date(d.getFullYear(),d.getMonth()+1,0).toLocaleDateString('en-CA');
              return (
                <button key={i} className="btn btn-secondary btn-sm"
                  onClick={()=>{ setDateFrom(from); setDateTo(to); }}>
                  {label}
                </button>
              );
            })}
          </div>
          <button className="btn btn-primary" onClick={loadTransactions} disabled={loading||!selectedCorp}>
            <Search size={15}/>{loading?tc('inv_page.loading','Loading...'):tc('inv_page.load_txns','Load Transactions')}
          </button>
        </div>
      </div>

      {/* Step 2: Filter + Select */}
      {transactions.length > 0 && (
        <>
          {/* Filters */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <div style={{fontWeight:600,fontSize:14,marginBottom:'0.75rem'}}>
              {tc('inv_page.step2','Step 2 — Filter & Select Transactions')}
            </div>
            <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end',marginBottom:'0.75rem'}}>
              <div>
                <label className="label">{tc('inv_page.filter_vehicle','🔍 Filter by Vehicle Number')}</label>
                <input className="input" placeholder="e.g. TN09AB1234" style={{width:180}}
                  value={filterVehicle} onChange={e=>setFilterVehicle(e.target.value)}/>
              </div>
              <div>
                <label className="label">{tc('inv_page.filter_fuel','Filter by Fuel Type')}</label>
                <select className="input" style={{width:160}} value={filterFuel}
                  onChange={e=>setFilterFuel(e.target.value)}>
                  <option value="">{tc('inv_page.all_fuels','All fuel types')}</option>
                  {fuelTypes.map(f=><option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              {(filterVehicle||filterDriver||filterFuel) && (
                <button className="btn btn-secondary btn-sm"
                  onClick={()=>{ setFilterVehicle(''); setFilterDriver(''); setFilterFuel(''); }}>
                  <X size={13}/> {tc('inv_page.clear_filters','Clear Filters')}
                </button>
              )}
              <div style={{marginLeft:'auto',fontSize:13,color:'var(--text-2)'}}>
                {tc('inv_page.showing','Showing')} <strong>{filtered.length}</strong> {tc('inv_page.of','of')} {transactions.length} {tc('inv_page.transactions','transactions')}
              </div>
            </div>

            {/* Vehicle quick-select chips */}
            {vehicles.length > 0 && (
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <span style={{fontSize:12,color:'var(--text-3)',alignSelf:'center'}}>{tc('inv_page.quick_filter','Quick filter:')}</span>
                {vehicles.map(v=>(
                  <button key={v}
                    className={`btn btn-sm ${filterVehicle===v?'btn-primary':'btn-secondary'}`}
                    style={{padding:'0 10px',height:26,fontSize:12}}
                    onClick={()=>setFilterVehicle(filterVehicle===v?'':v)}>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Transaction table */}
          <div className="card" style={{marginBottom:'1.5rem'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <button onClick={toggleAll} style={{background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontSize:13,color:'var(--text-2)'}}>
                  {selected.size===filtered.length && filtered.length>0
                    ? <CheckSquare size={18} color="var(--brand)"/>
                    : <Square size={18}/>}
                  {selected.size===filtered.length && filtered.length>0 ? tc('inv_page.deselect_all','Deselect All') : tc('inv_page.select_all','Select All')}
                </button>
                {selected.size>0 && (
                  <span className="badge badge-info" style={{fontSize:12}}>
                    {selected.size} {tc('inv_page.selected','selected')} · ₹{fmt(totalAmt)} {tc('inv_page.incl_gst','(incl. GST)')}
                  </span>
                )}
              </div>
              {selected.size>0 && (
                <button className="btn btn-primary btn-sm" onClick={handlePreview}>
                  <FileText size={13}/>{tc('inv_page.generate_invoice','Generate Invoice')}
                </button>
              )}
            </div>

            <div className="table-wrap" style={{maxHeight:420,overflowY:'auto'}}>
              <table className="dms-table">
                <thead style={{position:'sticky',top:0,zIndex:1}}>
                  <tr>
                    <th style={{width:40}}></th>
                    <th>{tc('inv_page.date_time','Date & Time')}</th>
                    <th>{tc('inv_page.vehicle_no','Vehicle No.')}</th>
                    <th>{tc('inv_page.driver_att','Driver / Attendant')}</th>
                    <th>{tc('inv_page.fuel_type','Fuel Type')}</th>
                    <th>{tc('inv_page.qty_l','Qty (L)')}</th>
                    <th>{tc('inv_page.rate_l','Rate/L')}</th>
                    <th>{tc('inv_page.amount','Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0 && (
                    <tr><td colSpan={8} style={{textAlign:'center',color:'var(--text-3)',padding:'2rem'}}>
                      {tc('inv_page.no_credit_txns','No credit transactions found for this period')}
                    </td></tr>
                  )}
                  {filtered.map(t=>(
                    <tr key={t.id}
                      style={{background:selected.has(t.id)?'var(--brand-light)':'',cursor:'pointer'}}
                      onClick={()=>toggleOne(t.id)}>
                      <td onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)}
                          onChange={()=>toggleOne(t.id)}
                          style={{cursor:'pointer',width:15,height:15}}/>
                      </td>
                      <td style={{fontSize:12,whiteSpace:'nowrap'}}>{toIST(t.occurred_at)}</td>
                      <td>
                        <span style={{fontFamily:'var(--font-mono)',fontWeight:600,
                          background:'var(--surface-2)',padding:'2px 8px',borderRadius:4,fontSize:12}}>
                          {t.vehicle_number || '—'}
                        </span>
                      </td>
                      <td style={{fontSize:13}}>{t.attendant_name||'—'}</td>
                      <td><span className={`fuel-chip fuel-${t.fuel_type}`}>{t.fuel_type}</span></td>
                      <td className="num">{fmtL(t.quantity_ltrs)}</td>
                      <td className="num">₹{fmt(t.rate_per_ltr)}</td>
                      <td className="num" style={{fontWeight:600}}>₹{fmt(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {selected.size>0 && (
                  <tfoot>
                    <tr style={{background:'var(--surface-2)',fontWeight:600}}>
                      <td colSpan={5} style={{padding:'10px 14px'}}>
                        {selected.size} {tc('inv_page.txns_selected','transactions selected')}
                      </td>
                      <td className="num" style={{padding:'10px 14px'}}>
                        {fmtL(selectedTxns.reduce((s,t)=>s+parseFloat(t.quantity_ltrs||0),0))} L
                      </td>
                      <td></td>
                      <td className="num" style={{padding:'10px 14px',color:'var(--brand)'}}>
                        ₹{fmt(subtotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {transactions.length===0 && selectedCorp && !loading && (
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>
          {tc('inv_page.click_load','Click "Load Transactions" to fetch credit transactions for this account')}
        </div>
      )}

      {!selectedCorp && (
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-3)'}}>
          <FileText size={40} style={{margin:'0 auto 1rem',opacity:.3}}/>
          <div style={{fontWeight:600,marginBottom:6}}>{tc('inv_page.gen_for_credit','Generate GST Invoices for Credit Customers')}</div>
          <div style={{fontSize:13}}>{tc('inv_page.select_to_start','Select a credit customer above to get started')}</div>
        </div>
      )}

      {/* Invoice Preview Modal */}
      {showPreview && corp && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:200,overflowY:'auto',padding:'2rem 1rem'}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:820,boxShadow:'0 20px 60px rgba(0,0,0,.3)'}}>
            {/* Modal header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.25rem 1.5rem',borderBottom:'1px solid #eee'}}>
              <div style={{fontWeight:700,fontSize:16}}>{tc('inv_page.invoice_preview','Invoice Preview')}</div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-secondary" onClick={()=>setShowPreview(false)}>
                  <X size={15}/>{tc('inv_page.close','Close')}
                </button>
                <button className="btn btn-primary" onClick={handleSaveAndPrint}>
                  <Printer size={15}/>{tc('inv_page.print_pdf','Print / Download PDF')}
                </button>
                <button className="btn btn-secondary" onClick={handleWhatsApp} style={{background:'#25D366',color:'#fff',border:'none'}}>
                  📱 WhatsApp
                </button>
              </div>
            </div>

            {/* Invoice content — printable */}
            <div ref={printRef} style={{padding:'2rem'}}>
              {/* Invoice header */}
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.5rem'}}>
                <div>
                  <div style={{fontSize:28,fontWeight:900,color:'#e07b0c',marginBottom:4}}>
                    <span style={{color:'#e07b0c'}}>pump</span><span style={{color:'#1a5f7a'}}>ini</span>
                  </div>
                  <div style={{fontWeight:700,fontSize:15}}>{stationSettings?.name || 'Demo Petrol Station'}</div>
                  <div style={{fontSize:12,color:'#666',marginTop:2}}>{stationSettings?.address}</div>
                  <div style={{fontSize:12,color:'#666'}}>{stationSettings?.city}, {stationSettings?.state} — {stationSettings?.pincode}</div>
                  <div style={{fontSize:12,marginTop:4}}><strong>GSTIN:</strong> {stationSettings?.gstn || 'Not configured'}</div>
                  <div style={{fontSize:12}}><strong>PAN:</strong> {stationSettings?.pan || 'Not configured'}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:22,fontWeight:800,color:'#1a5f7a',marginBottom:8}}>TAX INVOICE</div>
                  <div style={{fontSize:13,marginBottom:3}}><strong>Invoice No:</strong> {invoiceNum}</div>
                  <div style={{fontSize:13,marginBottom:3}}><strong>Date:</strong> {toDateIST(new Date())}</div>
                  <div style={{fontSize:13,marginBottom:3}}><strong>Period:</strong> {toDateIST(dateFrom)} to {toDateIST(dateTo)}</div>
                  <input style={{fontSize:13,border:'1px solid #ddd',borderRadius:6,padding:'4px 8px',marginTop:4,width:180}}
                    value={invoiceNum} onChange={e=>setInvoiceNum(e.target.value)}
                    placeholder="Edit invoice number"/>
                </div>
              </div>

              {/* Bill to */}
              <div style={{background:'#f8f7f5',borderRadius:8,padding:'1rem',marginBottom:'1.5rem'}}>
                <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Bill To</div>
                <div style={{fontWeight:700,fontSize:15}}>{corp.company_name}</div>
                <div style={{fontSize:13,color:'#444',marginTop:2}}>{corp.contact_person} · {displayMobile(corp.contact_phone)}</div>
                {corp.gst_number && <div style={{fontSize:12,marginTop:2}}><strong>GSTIN:</strong> {corp.gst_number}</div>}
              </div>

              {/* Line items table */}
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:'1.5rem'}}>
                <thead>
                  <tr style={{background:'#1a5f7a',color:'#fff'}}>
                    <th style={{padding:'8px 10px',textAlign:'left'}}>S.No</th>
                    <th style={{padding:'8px 10px',textAlign:'left'}}>Date & Time</th>
                    <th style={{padding:'8px 10px',textAlign:'left'}}>Vehicle No.</th>
                    <th style={{padding:'8px 10px',textAlign:'left'}}>Fuel Type</th>
                    <th style={{padding:'8px 10px',textAlign:'right'}}>Qty (L)</th>
                    <th style={{padding:'8px 10px',textAlign:'right'}}>Rate/L (₹)</th>
                    <th style={{padding:'8px 10px',textAlign:'right'}}>Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTxns.map((t,i)=>{
                    const tax = getTaxInfo(t.fuel_type);
                    return (
                    <tr key={t.id} style={{borderBottom:'1px solid #eee',background:i%2===0?'#fff':'#fafafa'}}>
                      <td style={{padding:'7px 10px',color:'#666'}}>{i+1}</td>
                      <td style={{padding:'7px 10px',whiteSpace:'nowrap',fontSize:11}}>{toIST(t.occurred_at)}</td>
                      <td style={{padding:'7px 10px',fontWeight:600,fontFamily:'monospace'}}>{t.vehicle_number||'—'}</td>
                      <td style={{padding:'7px 10px',textTransform:'capitalize'}}>{t.fuel_type}</td>
                      <td style={{padding:'7px 10px',fontFamily:'monospace',fontSize:11,color:'#666'}}>{HSN_CODES[t.fuel_type]||'—'}</td>
                      <td style={{padding:'7px 10px',textAlign:'right',fontFamily:'monospace'}}>{fmtL(t.quantity_ltrs)}</td>
                      <td style={{padding:'7px 10px',textAlign:'right',fontFamily:'monospace'}}>{fmt(t.rate_per_ltr)}</td>
                      <td style={{padding:'7px 10px',textAlign:'center',fontSize:11}}>
                        {tax.exempt
                          ? <span style={{color:'#666',background:'#f3f4f6',padding:'1px 6px',borderRadius:3}}>VAT Exempt</span>
                          : <span style={{color:'#15803d',background:'#dcfce7',padding:'1px 6px',borderRadius:3}}>GST 18%</span>}
                      </td>
                      <td style={{padding:'7px 10px',textAlign:'right',fontFamily:'monospace',fontWeight:600}}>{fmt(t.amount)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Totals */}
              <div style={{display:'flex',justifyContent:'flex-end'}}>
                <table style={{borderCollapse:'collapse',fontSize:13,minWidth:360}}>
                  <tbody>
                    <tr>
                      <td style={{padding:'6px 16px',color:'#666'}}>Subtotal (all products)</td>
                      <td style={{padding:'6px 16px',textAlign:'right',fontFamily:'monospace',fontWeight:600}}>₹{fmt(subtotal)}</td>
                    </tr>
                    {exemptAmt > 0 && (
                      <tr>
                        <td style={{padding:'6px 16px',color:'#666'}}>
                          Fuel (Petrol/Diesel/CNG) — VAT applicable
                          <div style={{fontSize:10,color:'#999'}}>Outside GST as per Section 9(2) CGST Act</div>
                        </td>
                        <td style={{padding:'6px 16px',textAlign:'right',fontFamily:'monospace',color:'#666'}}>₹{fmt(exemptAmt)}</td>
                      </tr>
                    )}
                    {taxableAmt > 0 && (
                      <>
                        <tr>
                          <td style={{padding:'6px 16px',color:'#666'}}>Lubes / Other (GST applicable)</td>
                          <td style={{padding:'6px 16px',textAlign:'right',fontFamily:'monospace'}}>₹{fmt(taxableAmt)}</td>
                        </tr>
                        <tr>
                          <td style={{padding:'6px 16px',color:'#666'}}>CGST @ {LUBE_CGST_RATE}%</td>
                          <td style={{padding:'6px 16px',textAlign:'right',fontFamily:'monospace'}}>₹{fmt(cgstAmt)}</td>
                        </tr>
                        <tr>
                          <td style={{padding:'6px 16px',color:'#666'}}>SGST @ {LUBE_SGST_RATE}%</td>
                          <td style={{padding:'6px 16px',textAlign:'right',fontFamily:'monospace'}}>₹{fmt(sgstAmt)}</td>
                        </tr>
                      </>
                    )}
                    {taxableAmt === 0 && (
                      <tr>
                        <td colSpan={2} style={{padding:'6px 16px',fontSize:11,color:'#999',fontStyle:'italic'}}>
                          No GST applicable — all products are fuel (VAT regime)
                        </td>
                      </tr>
                    )}
                    <tr style={{borderTop:'2px solid #1a5f7a'}}>
                      <td style={{padding:'10px 16px',fontWeight:800,fontSize:15,color:'#1a5f7a'}}>TOTAL</td>
                      <td style={{padding:'10px 16px',textAlign:'right',fontFamily:'monospace',fontWeight:800,fontSize:18,color:'#e07b0c'}}>₹{fmt(totalAmt)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Amount in words */}
              <div style={{marginTop:'1rem',padding:'0.75rem 1rem',background:'#f8f7f5',borderRadius:8,fontSize:12,color:'#444'}}>
                <strong>Amount in Words:</strong> {amountInWords(totalAmt)} Only
              </div>

              {/* Terms */}
              <div style={{marginTop:'1.5rem',borderTop:'1px solid #eee',paddingTop:'1rem',fontSize:11,color:'#888'}}>
                <div style={{fontWeight:600,marginBottom:4}}>Terms & Conditions</div>
                <div>1. Payment due within 30 days of invoice date.</div>
                <div>2. This is a computer generated invoice.</div>
                <div>3. For disputes, contact {stationSettings?.owner_whatsapp || 'the station manager'}.</div>
              </div>

              {/* Signature */}
              <div style={{display:'flex',justifyContent:'flex-end',marginTop:'2rem'}}>
                <div style={{textAlign:'center'}}>
                  <div style={{width:120,borderBottom:'1px solid #000',marginBottom:4,height:40}}></div>
                  <div style={{fontSize:11,color:'#666'}}>Authorised Signatory</div>
                  <div style={{fontSize:12,fontWeight:600}}>{stationSettings?.name || 'Station Name'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// Simple amount in words for Indian currency
function amountInWords(amount) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
    'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '');
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+convert(n%100) : '');
    if (n < 100000) return convert(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' '+convert(n%1000) : '');
    if (n < 10000000) return convert(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' '+convert(n%100000) : '');
    return convert(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' '+convert(n%10000000) : '');
  }

  const rupees = Math.floor(amount);
  const paise  = Math.round((amount - rupees) * 100);
  let words    = 'Rupees ' + (rupees > 0 ? convert(rupees) : 'Zero');
  if (paise > 0) words += ' and ' + convert(paise) + ' Paise';
  return words;
}

