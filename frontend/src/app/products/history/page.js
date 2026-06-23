'use client';
import { useState, useEffect } from 'react';
import { Printer, Download, Eye, X } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

export default function ProductsHistoryPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const stationId   = typeof station==='object' ? station?.id : station;
  const stationName = typeof station==='object' ? station?.name : '';

  const today = new Date().toISOString().slice(0,10);
  const [invoices,setInvoices] = useState([]);
  const [loading,setLoading]   = useState(true);
  const [from,setFrom]         = useState(today);
  const [to,setTo]             = useState(today);
  const [selected,setSelected] = useState(null);
  const [stationInfo,setStationInfo] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/products/invoices', { params:{ station_id:stationId, from, to } });
      setInvoices(Array.isArray(res)?res:[]);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const loadInvoice = async (id) => {
    try {
      const [inv, si] = await Promise.all([
        api.get(`/products/invoices/${id}`),
        api.get(`/stations/${stationId}/settings`),
      ]);
      setSelected(inv); setStationInfo(si||{});
    } catch(e) { alert(tc('lubehist.loadInvoiceFailed', 'Failed to load invoice')); }
  };

  useEffect(() => { if (stationId) load(); }, [stationId]);

  const fmt2 = n => Number(n||0).toFixed(2);
  const fmtCur = n => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

  const totals = invoices.reduce((a,i) => ({
    subtotal: a.subtotal + parseFloat(i.subtotal||0),
    cgst:     a.cgst     + parseFloat(i.total_cgst||0),
    sgst:     a.sgst     + parseFloat(i.total_sgst||0),
    grand:    a.grand    + parseFloat(i.grand_total||0),
  }), { subtotal:0, cgst:0, sgst:0, grand:0 });

  return (
    <AppShell>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:'1.5rem'}}>
        <div>
          <h1 className="page-title">{tc('lubehist.pageTitle', 'Products Sales History')}</h1>
          <p className="page-subtitle">{tc('lubehist.pageSubtitle', 'GST invoice register for lubes & products')}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',padding:'1rem 1.25rem',
        marginBottom:'1rem',display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
        <div>
          <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubehist.from', 'From')}</label>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)}
            style={{padding:'8px 12px',border:'1.5px solid #e5e3de',borderRadius:8,fontSize:14,outline:'none'}}/>
        </div>
        <div>
          <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubehist.to', 'To')}</label>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)}
            style={{padding:'8px 12px',border:'1.5px solid #e5e3de',borderRadius:8,fontSize:14,outline:'none'}}/>
        </div>
        <button onClick={load} style={{padding:'9px 20px',background:'#FF6B00',color:'#fff',border:'none',
          borderRadius:8,cursor:'pointer',fontWeight:700,fontSize:13}}>{tc('lubehist.apply', 'Apply')}</button>
      </div>

      {/* Summary cards */}
      {invoices.length > 0 && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1rem',marginBottom:'1rem'}}>
          {[
            [tc('lubehist.cardInvoices', 'Invoices'), invoices.length, '#1A5F7A'],
            [tc('lubehist.cardSubtotal', 'Subtotal'), fmtCur(totals.subtotal), '#16a34a'],
            [tc('lubehist.cardGst', 'GST (CGST+SGST)'), fmtCur(totals.cgst+totals.sgst), '#9333ea'],
            [tc('lubehist.cardGrandTotal', 'Grand Total'), fmtCur(totals.grand), '#FF6B00'],
          ].map(([l,v,c])=>(
            <div key={l} style={{background:'#fff',borderRadius:12,padding:'1rem',
              border:'1px solid #e5e3de',borderTop:`3px solid ${c}`}}>
              <div style={{fontSize:11,color:'#888',textTransform:'uppercase',marginBottom:4}}>{l}</div>
              <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Invoice list */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
        {loading ? (
          <div style={{textAlign:'center',padding:'3rem',color:'#aaa'}}>{tc('lubehist.loading', 'Loading...')}</div>
        ) : invoices.length===0 ? (
          <div style={{textAlign:'center',padding:'3rem',color:'#aaa'}}>{tc('lubehist.noInvoices', 'No invoices found for this period')}</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8f7f5'}}>
              {[tc('lubehist.thInvoiceNo','Invoice No'),tc('lubehist.thDate','Date'),tc('lubehist.thCustomer','Customer'),tc('lubehist.thItems','Items'),tc('lubehist.thPayment','Payment'),tc('lubehist.thSubtotal','Subtotal'),tc('lubehist.thGst','GST'),tc('lubehist.thTotal','Total'),''].map(h=>(
                <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,
                  fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {invoices.map(inv=>(
                <tr key={inv.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                  <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:12,fontWeight:600}}>{inv.invoice_number}</td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{new Date(inv.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{inv.customer_name}</td>
                  <td style={{padding:'11px 14px',fontSize:13,textAlign:'center'}}>{inv.item_count}</td>
                  <td style={{padding:'11px 14px'}}>
                    <span style={{padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,
                      background:'#f3f4f6',color:'#374151',textTransform:'uppercase'}}>{inv.payment_mode}</span>
                  </td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{fmtCur(inv.subtotal)}</td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{fmtCur(parseFloat(inv.total_cgst||0)+parseFloat(inv.total_sgst||0))}</td>
                  <td style={{padding:'11px 14px',fontWeight:700}}>{fmtCur(inv.grand_total)}</td>
                  <td style={{padding:'11px 14px'}}>
                    <button onClick={()=>loadInvoice(inv.id)}
                      style={{display:'flex',alignItems:'center',gap:4,padding:'4px 10px',background:'#f0f9ff',
                        color:'#1A5F7A',border:'none',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600}}>
                      <Eye size={12}/>{tc('lubehist.view', 'View')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invoice detail modal */}
      {selected && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',
          alignItems:'center',justifyContent:'center',zIndex:300,padding:'1rem',overflowY:'auto'}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:700,
            boxShadow:'0 20px 60px rgba(0,0,0,.4)',maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'1rem 1.5rem',borderBottom:'1px solid #e5e3de',position:'sticky',top:0,background:'#fff'}}>
              <span style={{fontWeight:700,fontSize:16}}>{selected.invoice_number}</span>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>window.print()}
                  style={{display:'flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#FF6B00',
                    color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13}}>
                  <Printer size={14}/>{tc('lubehist.print', 'Print')}
                </button>
                <button onClick={()=>setSelected(null)}
                  style={{padding:'8px 12px',background:'#f3f4f6',border:'none',borderRadius:8,cursor:'pointer'}}>
                  <X size={16}/>
                </button>
              </div>
            </div>

            <div id="invoice-print" style={{padding:'2rem',fontFamily:'Arial,sans-serif',fontSize:13}}>
              <div style={{textAlign:'center',marginBottom:'1.5rem',borderBottom:'2px solid #000',paddingBottom:'1rem'}}>
                <div style={{fontSize:20,fontWeight:800}}>{selected.station_name}</div>
                <div style={{fontSize:12,color:'#555'}}>{selected.address}</div>
                <div style={{fontSize:12,color:'#555'}}>{selected.city}{selected.state?`, ${selected.state}`:''}</div>
                {selected.gstn && <div style={{fontSize:12,fontWeight:600,marginTop:4}}>{tc('lubehist.gstinLabel', 'GSTIN')}: {selected.gstn}</div>}
              </div>
              <div style={{textAlign:'center',fontWeight:800,fontSize:16,marginBottom:'1rem',letterSpacing:2}}>{tc('lubehist.taxInvoice', 'TAX INVOICE')}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem',fontSize:12}}>
                <div>
                  <div><strong>{tc('lubehist.invoiceNoLabel', 'Invoice No')}:</strong> {selected.invoice_number}</div>
                  <div><strong>{tc('lubehist.dateLabel', 'Date')}:</strong> {new Date(selected.invoice_date).toLocaleDateString('en-IN')}</div>
                  <div><strong>{tc('lubehist.paymentLabel', 'Payment')}:</strong> {selected.payment_mode?.toUpperCase()}</div>
                </div>
                <div>
                  <div><strong>{tc('lubehist.billToLabel', 'Bill To')}:</strong> {selected.customer_name}</div>
                  {selected.customer_gstn && <div><strong>{tc('lubehist.gstnLabel', 'GSTN')}:</strong> {selected.customer_gstn}</div>}
                </div>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:'1rem'}}>
                <thead>
                  <tr style={{background:'#f3f4f6'}}>
                    {['#',tc('lubehist.colDescription','Description'),'HSN',tc('lubehist.colQty','Qty'),tc('lubehist.colUnit','Unit'),tc('lubehist.colRate','Rate'),tc('lubehist.colTaxable','Taxable'),'CGST','SGST',tc('lubehist.colTotal','Total')].map(h=>(
                      <th key={h} style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'left',fontWeight:700}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(selected.items||[]).map((item,i)=>(
                    <tr key={i}>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd'}}>{i+1}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',fontWeight:600}}>{item.product_name}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',fontFamily:'monospace',fontSize:11}}>{item.hsn_code||'—'}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>{item.quantity}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd'}}>{item.unit}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(item.unit_price)}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(item.taxable_amount)}</td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(item.cgst_amount)}<br/><span style={{fontSize:10,color:'#888'}}>({item.gst_rate/2}%)</span></td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(item.sgst_amount)}<br/><span style={{fontSize:10,color:'#888'}}>({item.gst_rate/2}%)</span></td>
                      <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right',fontWeight:700}}>₹{fmt2(item.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:'#f8f7f5',fontWeight:700}}>
                    <td colSpan={6} style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>{tc('lubehist.totalRow', 'TOTAL')}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(selected.subtotal)}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(selected.total_cgst)}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(selected.total_sgst)}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right',fontSize:15}}>₹{fmt2(selected.grand_total)}</td>
                  </tr>
                </tfoot>
              </table>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2rem',marginTop:'2rem',fontSize:11,color:'#666'}}>
                <div><div style={{fontWeight:700,color:'#000',marginBottom:4}}>{tc('lubehist.termsTitle', 'Terms & Conditions')}</div>
                  <div>{tc('lubehist.termsBody', 'Goods once sold will not be taken back.')}</div></div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:700,color:'#000',marginBottom:24}}>{tc('lubehist.forStation', 'For {name}').replace('{name}', selected.station_name)}</div>
                  <div>{tc('lubehist.authorisedSignatory', 'Authorised Signatory')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`@media print { body * { visibility: hidden; } #invoice-print, #invoice-print * { visibility: visible; } #invoice-print { position: fixed; top: 0; left: 0; width: 100%; } }`}</style>
    </AppShell>
  );
}
