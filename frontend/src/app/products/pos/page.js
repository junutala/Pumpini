'use client';
import { useState, useEffect, useRef } from 'react';
import { Scan, Plus, Minus, Trash2, Printer, X, Camera, CameraOff } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import BarcodeScanner from '../../../components/shared/BarcodeScanner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const PAYMENT_MODES = [
  { id:'cash',   label:'💵 Cash',   color:'#16a34a' },
  { id:'upi',    label:'📱 UPI',    color:'#2563eb' },
  { id:'card',   label:'💳 Card',   color:'#ea580c' },
  { id:'credit', label:'🏢 Credit', color:'#9333ea' },
];

const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #e5e3de',borderRadius:8,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

export default function ProductsPOSPage() {
  if (typeof window === 'undefined') return null;
  const { user, station } = useAuth();
  const stationId   = typeof station==='object' ? station?.id : station;
  const stationName = typeof station==='object' ? station?.name : '';

  const [products,setProducts]   = useState([]);
  const [corps,setCorps]         = useState([]);
  const [cart,setCart]           = useState([]);
  const [payMode,setPayMode]     = useState('cash');
  const [custType,setCustType]   = useState('cash');
  const [custId,setCustId]       = useState('');
  const [custName,setCustName]   = useState('Cash Customer');
  const [barcodeInput,setBarcodeInput] = useState('');
  const [scanning,setScanning]   = useState(false);
  const [stationInfo,setStationInfo] = useState({});
  const [invoice,setInvoice]     = useState(null);
  const [saving,setSaving]       = useState(false);
  const barcodeRef = useRef(null);
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);

  useEffect(() => {
    if (!stationId) return;
    Promise.all([
      api.get('/products/catalogue', { params:{ station_id:stationId } }),
      api.get('/corporate', { params:{ station_id:stationId } }),
      api.get(`/stations/${stationId}/settings`),
    ]).then(([p,c,s]) => {
      setProducts(Array.isArray(p)?p:[]);
      setCorps(Array.isArray(c)?c:[]);
      setStationInfo(s||{});
    }).catch(console.error);
  }, [stationId]);

  // Barcode scanner via camera
  const startScanning = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setScanning(true);

      // Load zxing from CDN
      if (!window.ZXing) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/@zxing/browser@0.1.4/esm/index.min.js';
          script.type = 'module';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      // Use native browser BarcodeDetector API as primary, zxing as fallback
      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({ formats: ['ean_13','ean_8','code_128','qr_code','code_39'] });
        const detect = async () => {
          if (!videoRef.current || !streamRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              addByBarcode(barcodes[0].rawValue);
              stopScanning();
              return;
            }
          } catch(e) {}
          if (streamRef.current) requestAnimationFrame(detect);
        };
        requestAnimationFrame(detect);
      } else {
        alert('Barcode scanner not supported on this browser. Please type the barcode manually.');
        stopScanning();
      }
    } catch(e) {
      alert('Camera access denied or not available. Type barcode manually.');
    }
  };

  const stopScanning = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const addByBarcode = async (code) => {
    setBarcodeInput(code);
    try {
      const product = await api.get(`/products/barcode/${code}`, { params:{ station_id:stationId } });
      addToCart(product);
      setBarcodeInput('');
      barcodeRef.current?.focus();
    } catch(e) {
      alert(`Barcode ${code} not found in catalogue`);
      setBarcodeInput('');
    }
  };

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product_id === product.id);
      if (existing) {
        return prev.map(i => i.product_id===product.id ? {...i, quantity: i.quantity+1} : i);
      }
      return [...prev, {
        product_id:   product.id,
        product_name: product.name,
        hsn_code:     product.hsn_code,
        unit:         product.unit,
        unit_price:   parseFloat(product.selling_price),
        gst_rate:     parseFloat(product.gst_rate),
        quantity:     1,
        max_stock:    parseFloat(product.current_stock),
      }];
    });
  };

  const updateQty = (productId, delta) => {
    setCart(prev => prev
      .map(i => i.product_id===productId ? {...i, quantity: Math.max(0.1, i.quantity+delta)} : i)
      .filter(i => i.quantity > 0)
    );
  };

  const removeItem = (productId) => setCart(prev => prev.filter(i => i.product_id !== productId));

  // Calculate totals
  const calcItem = (item) => {
    const taxable = item.quantity * item.unit_price;
    const cgst    = parseFloat((taxable * item.gst_rate / 200).toFixed(2));
    const sgst    = parseFloat((taxable * item.gst_rate / 200).toFixed(2));
    return { taxable, cgst, sgst, total: taxable + cgst + sgst };
  };

  const totals = cart.reduce((acc, item) => {
    const c = calcItem(item);
    return { subtotal: acc.subtotal+c.taxable, cgst: acc.cgst+c.cgst, sgst: acc.sgst+c.sgst, grand: acc.grand+c.total };
  }, { subtotal:0, cgst:0, sgst:0, grand:0 });

  const checkout = async () => {
    if (cart.length===0) return alert('Cart is empty');
    if (custType==='credit' && !custId) return alert('Please select a credit customer');
    setSaving(true);
    try {
      const res = await api.post('/products/invoices', {
        station_id:    stationId,
        customer_type: custType,
        customer_id:   custId||null,
        customer_name: custType==='credit' ? corps.find(c=>c.id===custId)?.company_name : custName,
        payment_mode:  payMode,
        items:         cart,
      });
      setInvoice(res);
      setCart([]);
      setCustType('cash'); setCustId(''); setCustName('Cash Customer');
      setPayMode('cash');
    } catch(e) { alert(e.response?.data?.error || 'Sale failed'); }
    setSaving(false);
  };

  const fmt2 = n => Number(n||0).toFixed(2);
  const fmtCur = n => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

  return (
    <AppShell>
      <h1 className="page-title" style={{marginBottom:'1.5rem'}}>Products POS</h1>

      <div style={{display:'grid',gridTemplateColumns:'1fr 380px',gap:'1.5rem',alignItems:'start'}}>

        {/* Left — product selection */}
        <div>
          {/* Barcode input */}
          <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',padding:'1.25rem',marginBottom:'1rem'}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:'0.75rem'}}>Scan / Search Product</div>
            <div style={{display:'flex',gap:8}}>
              <input ref={barcodeRef} style={{...inp,flex:1}} placeholder="Scan barcode or type product name..."
                value={barcodeInput}
                onChange={e=>setBarcodeInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter' && barcodeInput.trim()) addByBarcode(barcodeInput.trim()); }}/>
              <BarcodeScanner onScan={addByBarcode} label="Camera"/>
            </div>
          </div>

          {/* Product grid */}
          <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',padding:'1.25rem'}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:'0.75rem'}}>All Products</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
              {products.map(p=>(
                <button key={p.id} onClick={()=>addToCart(p)}
                  disabled={p.current_stock <= 0}
                  style={{padding:'0.75rem',background: p.current_stock<=0?'#f8f7f5':'#fff',
                    border:`1.5px solid ${p.current_stock<=0?'#e5e3de':'#FF6B00'}`,
                    borderRadius:10,cursor:p.current_stock<=0?'not-allowed':'pointer',textAlign:'left',
                    opacity:p.current_stock<=0?0.5:1,transition:'all .15s'}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{p.name}</div>
                  <div style={{fontSize:11,color:'#888',marginBottom:6}}>{p.brand||''}</div>
                  <div style={{fontWeight:800,fontSize:15,color:'#FF6B00'}}>{fmtCur(p.selling_price)}</div>
                  <div style={{fontSize:10,color: p.current_stock<=p.min_stock_level?'#dc2626':'#888',marginTop:2}}>
                    Stock: {Number(p.current_stock).toFixed(1)} {p.unit}s
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right — cart & checkout */}
        <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',padding:'1.25rem',position:'sticky',top:'1rem'}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>
            Cart {cart.length>0 && <span style={{background:'#FF6B00',color:'#fff',borderRadius:99,padding:'1px 7px',fontSize:12,marginLeft:6}}>{cart.length}</span>}
          </div>

          {cart.length===0 ? (
            <div style={{textAlign:'center',padding:'2rem',color:'#aaa',fontSize:13}}>
              Scan or click a product to add
            </div>
          ) : (
            <>
              {cart.map(item => {
                const c = calcItem(item);
                return (
                  <div key={item.product_id} style={{borderBottom:'1px solid #f0f0f0',paddingBottom:'0.75rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.product_name}</div>
                        <div style={{fontSize:11,color:'#888'}}>₹{fmt2(item.unit_price)} × {item.quantity} {item.unit}s</div>
                        <div style={{fontSize:11,color:'#888'}}>GST {item.gst_rate}%: ₹{fmt2(c.cgst+c.sgst)}</div>
                      </div>
                      <div style={{textAlign:'right',marginLeft:8}}>
                        <div style={{fontWeight:700,fontSize:14}}>₹{fmt2(c.total)}</div>
                        <div style={{display:'flex',alignItems:'center',gap:4,marginTop:4}}>
                          <button onClick={()=>updateQty(item.product_id,-1)} style={{width:22,height:22,background:'#f3f4f6',border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Minus size={12}/></button>
                          <span style={{minWidth:20,textAlign:'center',fontSize:13,fontWeight:600}}>{item.quantity}</span>
                          <button onClick={()=>updateQty(item.product_id,1)} style={{width:22,height:22,background:'#f3f4f6',border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Plus size={12}/></button>
                          <button onClick={()=>removeItem(item.product_id)} style={{width:22,height:22,background:'#fee2e2',border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',marginLeft:2}}><Trash2 size={11} color="#dc2626"/></button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Totals */}
              <div style={{background:'#f8f7f5',borderRadius:8,padding:'0.75rem',marginBottom:'0.75rem',fontSize:13}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#666'}}>Subtotal</span><span>{fmtCur(totals.subtotal)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#666'}}>CGST</span><span>{fmtCur(totals.cgst)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#666'}}>SGST</span><span>{fmtCur(totals.sgst)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,fontSize:15,borderTop:'1px solid #e5e3de',paddingTop:6,marginTop:3}}>
                  <span>Total</span><span style={{color:'#FF6B00'}}>{fmtCur(totals.grand)}</span>
                </div>
              </div>

              {/* Customer */}
              <div style={{marginBottom:'0.75rem'}}>
                <div style={{display:'flex',gap:6,marginBottom:6}}>
                  {[{id:'cash',l:'Cash'},{id:'credit',l:'Credit'}].map(c=>(
                    <button key={c.id} onClick={()=>setCustType(c.id)}
                      style={{flex:1,padding:'6px',background:custType===c.id?'#FF6B00':'#f3f4f6',
                        color:custType===c.id?'#fff':'#555',border:'none',borderRadius:7,cursor:'pointer',fontWeight:600,fontSize:12}}>
                      {c.l}
                    </button>
                  ))}
                </div>
                {custType==='credit' && (
                  <select style={inp} value={custId} onChange={e=>setCustId(e.target.value)}>
                    <option value="">Select customer...</option>
                    {corps.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                )}
              </div>

              {/* Payment mode */}
              <div style={{marginBottom:'0.75rem'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                  {PAYMENT_MODES.filter(m=>custType==='credit'?m.id!=='credit':true).map(m=>(
                    <button key={m.id} onClick={()=>setPayMode(m.id)}
                      style={{padding:'8px',background:payMode===m.id?m.color:'#f3f4f6',
                        color:payMode===m.id?'#fff':'#555',border:'none',borderRadius:8,
                        cursor:'pointer',fontWeight:600,fontSize:12}}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={checkout} disabled={saving}
                style={{width:'100%',height:46,background:'#FF6B00',color:'#fff',border:'none',
                  borderRadius:10,cursor:'pointer',fontWeight:800,fontSize:15}}>
                {saving ? 'Processing...' : `Bill ${fmtCur(totals.grand)}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* GST Invoice Modal */}
      {invoice && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',
          alignItems:'center',justifyContent:'center',zIndex:300,padding:'1rem',overflowY:'auto'}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:680,
            boxShadow:'0 20px 60px rgba(0,0,0,.4)',maxHeight:'90vh',overflowY:'auto'}}>

            {/* Actions */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'1rem 1.5rem',borderBottom:'1px solid #e5e3de',position:'sticky',top:0,background:'#fff',zIndex:1}}>
              <span style={{fontWeight:700,fontSize:16}}>GST Invoice — {invoice.invoice_number}</span>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>window.print()}
                  style={{display:'flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#FF6B00',
                    color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13}}>
                  <Printer size={14}/>Print
                </button>
                <button onClick={()=>setInvoice(null)}
                  style={{padding:'8px 16px',background:'#f3f4f6',color:'#555',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13}}>
                  Close
                </button>
              </div>
            </div>

            {/* Invoice content — printable */}
            <div id="invoice-print" style={{padding:'2rem',fontFamily:'Arial,sans-serif',fontSize:13}}>

              {/* Header */}
              <div style={{textAlign:'center',marginBottom:'1.5rem',borderBottom:'2px solid #000',paddingBottom:'1rem'}}>
                <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>{stationName}</div>
                <div style={{fontSize:12,color:'#555'}}>{stationInfo.address || ''}</div>
                <div style={{fontSize:12,color:'#555'}}>{stationInfo.city || ''}{stationInfo.state?`, ${stationInfo.state}`:''}</div>
                {stationInfo.gstn && <div style={{fontSize:12,fontWeight:600,marginTop:4}}>GSTIN: {stationInfo.gstn}</div>}
              </div>

              <div style={{textAlign:'center',fontWeight:800,fontSize:16,marginBottom:'1rem',letterSpacing:2}}>
                TAX INVOICE
              </div>

              {/* Invoice details */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem',fontSize:12}}>
                <div>
                  <div><strong>Invoice No:</strong> {invoice.invoice_number}</div>
                  <div><strong>Date:</strong> {new Date(invoice.created_at).toLocaleDateString('en-IN')}</div>
                  <div><strong>Payment:</strong> {invoice.payment_mode?.toUpperCase()}</div>
                </div>
                <div>
                  <div><strong>Bill To:</strong> {invoice.customer_name}</div>
                  {invoice.customer_gstn && <div><strong>GSTN:</strong> {invoice.customer_gstn}</div>}
                </div>
              </div>

              {/* Items table */}
              <table style={{width:'100%',borderCollapse:'collapse',marginBottom:'1rem',fontSize:12}}>
                <thead>
                  <tr style={{background:'#f3f4f6'}}>
                    {['#','Description','HSN','Qty','Unit','Rate','Taxable','CGST','SGST','Total'].map(h=>(
                      <th key={h} style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'left',fontWeight:700}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(invoice.items||[]).map((item,i)=>(
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
                    <td colSpan={6} style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>TOTAL</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(invoice.subtotal)}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(invoice.total_cgst)}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right'}}>₹{fmt2(invoice.total_sgst)}</td>
                    <td style={{padding:'6px 8px',border:'1px solid #ddd',textAlign:'right',fontSize:15}}>₹{fmt2(invoice.grand_total)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Amount in words */}
              <div style={{fontSize:12,marginBottom:'1rem',background:'#f8f7f5',padding:'0.5rem 0.75rem',borderRadius:6}}>
                <strong>Grand Total: ₹{fmt2(invoice.grand_total)}</strong>
              </div>

              {/* Footer */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2rem',marginTop:'2rem',fontSize:11,color:'#666'}}>
                <div>
                  <div style={{fontWeight:700,color:'#000',marginBottom:4}}>Terms & Conditions</div>
                  <div>Goods once sold will not be taken back.</div>
                  <div>Subject to local jurisdiction.</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:700,color:'#000',marginBottom:24}}>For {stationName}</div>
                  <div>Authorised Signatory</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print, #invoice-print * { visibility: visible; }
          #invoice-print { position: fixed; top: 0; left: 0; width: 100%; }
        }
      `}</style>
    </AppShell>
  );
}
