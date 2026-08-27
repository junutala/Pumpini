'use client';
import { useState, useEffect } from 'react';
import { Plus, Package, X } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import BarcodeScanner from '../../../components/shared/BarcodeScanner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

import { errText } from '../../../lib/apiError';
const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #e5e3de',borderRadius:8,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

export default function ProductStockPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [receipts,setReceipts] = useState([]);
  const [products,setProducts] = useState([]);
  const [loading,setLoading]   = useState(true);
  const [modal,setModal]       = useState(false);
  const [form,setForm]         = useState({});
  const [saving,setSaving]     = useState(false);

  // Scan-to-receive state
  const [barcode,setBarcode] = useState('');
  const [matched,setMatched] = useState(null);  // product matched by barcode
  const [newCode,setNewCode] = useState(null);  // scanned code with no match
  const [newMode,setNewMode] = useState(null);  // 'link' | 'create'
  const [linkId,setLinkId]   = useState('');
  const [np,setNp]           = useState({});    // mini new-product form
  const [bcBusy,setBcBusy]   = useState(false);

  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  const resetScan = () => { setBarcode(''); setMatched(null); setNewCode(null); setNewMode(null); setLinkId(''); setNp({}); };

  const handleBarcode = async (code) => {
    const c = (code||'').trim();
    if (!c) return;
    setBarcode(c); setBcBusy(true); setNewCode(null); setMatched(null); setNewMode(null);
    try {
      const p = await api.get(`/products/barcode/${encodeURIComponent(c)}`, { params:{ station_id:stationId } });
      setMatched(p);
      setForm(prev => ({ ...prev, product_id: p.id }));
    } catch {
      setNewCode(c);                                   // no match → offer link / create
      setForm(prev => ({ ...prev, product_id: '' }));
    }
    setBcBusy(false);
  };

  const linkExisting = async () => {
    if (!linkId) return alert(tc('lubestk.pickProductToLink', 'Pick a product to link the barcode to'));
    setBcBusy(true);
    try {
      await api.patch(`/products/catalogue/${linkId}`, { barcode: newCode });
      const list = await api.get('/products/catalogue', { params:{ station_id:stationId } });
      const arr = Array.isArray(list)?list:[]; setProducts(arr);
      setMatched(arr.find(x=>x.id===linkId) || { id:linkId, name:'(linked)', barcode:newCode });
      setForm(prev => ({ ...prev, product_id: linkId }));
      setNewCode(null); setNewMode(null); setLinkId('');
    } catch(e) { alert(errText(e, tc('lubestk.couldNotLinkBarcode', 'Could not link barcode'))); }
    setBcBusy(false);
  };

  const createNew = async () => {
    if (!np.name || !np.selling_price) return alert(tc('lubestk.nameAndPriceRequired', 'Name and selling price are required'));
    setBcBusy(true);
    try {
      const res = await api.post('/products/catalogue', {
        station_id: stationId, name: np.name, selling_price: np.selling_price,
        gst_rate: np.gst_rate ?? 18, hsn_code: np.hsn_code||null,
        barcode: newCode, require_barcode: true, unit: 'piece',
      });
      const list = await api.get('/products/catalogue', { params:{ station_id:stationId } });
      setProducts(Array.isArray(list)?list:[]);
      setMatched(res);
      setForm(prev => ({ ...prev, product_id: res.id }));
      setNewCode(null); setNewMode(null); setNp({});
    } catch(e) { alert(errText(e, tc('lubestk.couldNotCreateProduct', 'Could not create product'))); }
    setBcBusy(false);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [r,p] = await Promise.all([
        api.get('/products/stock',     { params:{ station_id:stationId } }),
        api.get('/products/catalogue', { params:{ station_id:stationId } }),
      ]);
      setReceipts(Array.isArray(r)?r:[]); setProducts(Array.isArray(p)?p:[]);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { if (stationId) load(); }, [stationId]);

  const save = async () => {
    if (!form.product_id || !form.quantity) return alert(tc('lubestk.productAndQtyRequired', 'Product and quantity required'));
    setSaving(true);
    try {
      await api.post('/products/stock', { ...form, station_id: stationId });
      setModal(false); setForm({}); resetScan(); load();
    } catch(e) { alert(errText(e, tc('lubestk.saveFailed', 'Save failed'))); }
    setSaving(false);
  };

  const selectedProduct = products.find(p => p.id === form.product_id);

  return (
    <AppShell>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:'1.5rem'}}>
        <div>
          <h1 className="page-title">{tc('lubestk.stockManagement', 'Stock Management')}</h1>
          <p className="page-subtitle">{tc('lubestk.stockSubtitle', 'Receive and track product inventory')}</p>
        </div>
        <button onClick={()=>{ setForm({ station_id:stationId, location:'shop' }); resetScan(); setModal(true); }}
          style={{display:'flex',alignItems:'center',gap:6,padding:'10px 18px',
            background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
          <Plus size={16}/> {tc('lubestk.receiveStock', 'Receive Stock')}
        </button>
      </div>

      {/* Current stock levels */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden',marginBottom:'1.5rem'}}>
        <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',fontSize:15}}>
          {tc('lubestk.currentStockLevels', 'Current Stock Levels')}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:1,background:'#e5e3de'}}>
          {products.map(p=>(
            <div key={p.id} style={{background:'#fff',padding:'1rem'}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{p.name}</div>
              <div style={{fontSize:11,color:'#888',marginBottom:6}}>{p.brand||'—'}</div>
              <div style={{fontSize:20,fontWeight:800,
                color: p.current_stock<=p.min_stock_level?'#dc2626':
                       p.current_stock<=p.min_stock_level*2?'#d97706':'#16a34a'}}>
                {Number(p.current_stock).toFixed(1)}
                <span style={{fontSize:12,fontWeight:400,color:'#888',marginLeft:4}}>{p.unit}s</span>
              </div>
              {(p.bay_stock != null || p.shop_stock != null) && (
                <div style={{fontSize:11,color:'#888',marginTop:3,display:'flex',gap:10}}>
                  <span>🛢 {tc('lubestk.bay', 'Bay')}: <strong style={{color:'#444'}}>{Number(p.bay_stock||0).toFixed(1)}</strong></span>
                  <span>🏪 {tc('lubestk.shop', 'Shop')}: <strong style={{color:'#444'}}>{Number(p.shop_stock||0).toFixed(1)}</strong></span>
                </div>
              )}
              {p.current_stock <= p.min_stock_level && (
                <div style={{fontSize:10,color:'#dc2626',fontWeight:600,marginTop:2}}>⚠ {tc('lubestk.lowStock', 'LOW STOCK')}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Receipt history */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
        <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',fontSize:15}}>
          {tc('lubestk.stockReceiptHistory', 'Stock Receipt History')}
        </div>
        {loading ? (
          <div style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>{tc('lubestk.loading', 'Loading...')}</div>
        ) : receipts.length===0 ? (
          <div style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>{tc('lubestk.noReceipts', 'No stock receipts yet')}</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8f7f5'}}>
              {[['date','Date'],['product','Product'],['location','Location'],['quantity','Quantity'],['buyingPrice','Buying Price'],['sellingPrice','Selling Price'],['notes','Notes']].map(([k,h])=>(
                <th key={k} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,
                  fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{tc('lubestk.col_'+k, h)}</th>
              ))}
            </tr></thead>
            <tbody>
              {receipts.map(r=>(
                <tr key={r.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                  <td style={{padding:'11px 14px',fontSize:13}}>{new Date(r.received_at).toLocaleDateString('en-IN')}</td>
                  <td style={{padding:'11px 14px',fontWeight:600}}>{r.product_name}</td>
                  <td style={{padding:'11px 14px',fontSize:12.5}}>{r.location==='bay'?'🛢 '+tc('lubestk.bay', 'Bay'):'🏪 '+tc('lubestk.shop', 'Shop')}</td>
                  <td style={{padding:'11px 14px',fontWeight:600,color:'#16a34a'}}>+{Number(r.quantity).toFixed(1)} {r.unit}s</td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{r.buying_price ? `₹${Number(r.buying_price).toFixed(2)}` : '—'}</td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{r.selling_price ? `₹${Number(r.selling_price).toFixed(2)}` : '—'}</td>
                  <td style={{padding:'11px 14px',fontSize:13,color:'#666'}}>{r.notes||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Receive Stock Modal */}
      {modal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',
          alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem'}}>
          <div style={{background:'#fff',borderRadius:16,padding:'1.75rem',width:'100%',maxWidth:480,
            boxShadow:'0 20px 60px rgba(0,0,0,.3)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h2 style={{fontWeight:700,fontSize:16,margin:0}}>{tc('lubestk.receiveStock', 'Receive Stock')}</h2>
              <button onClick={()=>setModal(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            {/* Scan to receive */}
            <div style={{marginBottom:'0.85rem'}}>
              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.scanBarcode', 'Scan barcode')}</label>
              <div style={{display:'flex',gap:6}}>
                <input style={{...inp,flex:1}} placeholder={tc('lubestk.scanOrType', 'Scan or type barcode')}
                  value={barcode} onChange={e=>setBarcode(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); handleBarcode(barcode); } }}/>
                <BarcodeScanner label="" onScan={handleBarcode}/>
              </div>
              {bcBusy && <div style={{fontSize:12,color:'#888',marginTop:4}}>{tc('lubestk.lookingUp', 'Looking up…')}</div>}
            </div>

            {matched && (
              <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'0.6rem 0.75rem',
                marginBottom:'0.85rem',fontSize:13,color:'#15803d'}}>
                ✓ {tc('lubestk.matched', 'Matched')}: <strong>{matched.name}</strong>{matched.brand?` (${matched.brand})`:''}
              </div>
            )}

            {newCode && (
              <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:8,padding:'0.75rem',marginBottom:'0.85rem'}}>
                <div style={{fontSize:13,color:'#9a3412',marginBottom:8}}>
                  {tc('lubestk.barcodeLabelInline', 'Barcode')} <strong>{newCode}</strong> {tc('lubestk.notLinkedYet', 'isn’t linked to any product yet.')}
                </div>
                <div style={{display:'flex',gap:8,marginBottom:newMode?10:0}}>
                  <button type="button" onClick={()=>setNewMode('link')}
                    style={{flex:1,padding:'8px',borderRadius:7,border:'1px solid #fdba74',cursor:'pointer',
                      background:newMode==='link'?'#FF6B00':'#fff',color:newMode==='link'?'#fff':'#9a3412',fontWeight:600,fontSize:12.5}}>
                    {tc('lubestk.linkToExisting', 'Link to existing')}
                  </button>
                  <button type="button" onClick={()=>setNewMode('create')}
                    style={{flex:1,padding:'8px',borderRadius:7,border:'1px solid #fdba74',cursor:'pointer',
                      background:newMode==='create'?'#FF6B00':'#fff',color:newMode==='create'?'#fff':'#9a3412',fontWeight:600,fontSize:12.5}}>
                    {tc('lubestk.createNew', 'Create new')}
                  </button>
                </div>

                {newMode==='link' && (
                  <div style={{display:'flex',gap:6}}>
                    <select style={{...inp,flex:1}} value={linkId} onChange={e=>setLinkId(e.target.value)}>
                      <option value="">{tc('lubestk.selectAProduct', 'Select a product…')}</option>
                      {products.filter(p=>!p.barcode).map(p=>(
                        <option key={p.id} value={p.id}>{p.name}{p.brand?` (${p.brand})`:''}</option>
                      ))}
                    </select>
                    <button type="button" onClick={linkExisting} disabled={bcBusy}
                      style={{padding:'0 14px',background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13}}>{tc('lubestk.link', 'Link')}</button>
                  </div>
                )}

                {newMode==='create' && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <input style={{...inp,gridColumn:'1/-1'}} placeholder={tc('lubestk.productNameReq', 'Product name *')} value={np.name||''} onChange={e=>setNp(s=>({...s,name:e.target.value}))}/>
                    <input style={inp} type="number" step="0.01" placeholder={tc('lubestk.sellingPriceReq', 'Selling price ₹ *')} value={np.selling_price||''} onChange={e=>setNp(s=>({...s,selling_price:e.target.value}))}/>
                    <select style={inp} value={np.gst_rate??18} onChange={e=>setNp(s=>({...s,gst_rate:parseFloat(e.target.value)}))}>
                      {[0,5,12,18,28].map(r=><option key={r} value={r}>{r}% {tc('lubestk.gst', 'GST')}</option>)}
                    </select>
                    <button type="button" onClick={createNew} disabled={bcBusy}
                      style={{gridColumn:'1/-1',padding:'9px',background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13}}>
                      {tc('lubestk.createAndSelect', 'Create & select')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Or pick manually — for loose / non-barcoded items */}
            <div style={{marginBottom:'0.85rem'}}>
              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.productReq', 'Product *')}{' '}
                <span style={{fontWeight:400,color:'#888'}}>{tc('lubestk.pickByNameNote', '(or pick by name — loose / non-barcoded items)')}</span>
              </label>
              <select style={inp} value={form.product_id||''}
                onChange={e=>{ f('product_id',e.target.value); setMatched(products.find(p=>p.id===e.target.value)||null); setNewCode(null); }}>
                <option value="">{tc('lubestk.selectProduct', 'Select product...')}</option>
                {products.map(p=><option key={p.id} value={p.id}>{p.name} {p.brand?`(${p.brand})`:''} — {tc('lubestk.stockColon', 'Stock')}: {Number(p.current_stock).toFixed(1)}</option>)}
              </select>
            </div>

            {selectedProduct && (
              <div style={{background:'#f0f9ff',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.85rem',fontSize:12,color:'#1A5F7A'}}>
                {tc('lubestk.currentStock', 'Current stock')}: <strong>{Number(selectedProduct.current_stock).toFixed(1)} {selectedProduct.unit}s</strong>
                {' · '}{tc('lubestk.currentSellingPrice', 'Current selling price')}: <strong>₹{Number(selectedProduct.selling_price).toFixed(2)}</strong>
              </div>
            )}

            {/* Location: where this stock physically goes */}
            <div style={{marginBottom:'0.85rem'}}>
              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.stockLocation', 'Stock location')}</label>
              <div style={{display:'flex',gap:8}}>
                {[['shop','🏪 '+tc('lubestk.shop', 'Shop')],['bay','🛢 '+tc('lubestk.bayForecourt', 'Bay / Forecourt')]].map(([id,label])=>(
                  <button key={id} type="button" onClick={()=>f('location',id)}
                    style={{flex:1,padding:'9px',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13,
                      border:'1.5px solid '+((form.location||'shop')===id?'#FF6B00':'#e5e3de'),
                      background:(form.location||'shop')===id?'#fff7ed':'#fff',
                      color:(form.location||'shop')===id?'#9a3412':'#444'}}>{label}</button>
                ))}
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.quantityReceived', 'Quantity Received *')}</label>
                <input style={inp} type="number" step="0.1" placeholder="0"
                  value={form.quantity||''} onChange={e=>f('quantity',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.buyingPriceLabel', 'Buying Price (₹)')}</label>
                <input style={inp} type="number" step="0.01" placeholder={tc('lubestk.optionalUpdatesCost', 'Optional — updates cost price')}
                  value={form.buying_price||''} onChange={e=>f('buying_price',e.target.value)}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.updateSellingPrice', 'Update Selling Price (₹)')}</label>
                <input style={inp} type="number" step="0.01"
                  placeholder={selectedProduct ? tc('lubestk.currentPricePh', 'Current: ₹{p}').replace('{p}', Number(selectedProduct.selling_price).toFixed(2)) : tc('lubestk.optional', 'Optional')}
                  value={form.selling_price||''} onChange={e=>f('selling_price',e.target.value)}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubestk.notes', 'Notes')}</label>
                <input style={inp} placeholder={tc('lubestk.notesPh', 'e.g. Supplier: Castrol India, Invoice: CI/2026/001')}
                  value={form.notes||''} onChange={e=>f('notes',e.target.value)}/>
              </div>
            </div>

            <button onClick={save} disabled={saving} style={{width:'100%',marginTop:'1.5rem',height:44,
              background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
              {saving?tc('lubestk.saving', 'Saving...'):tc('lubestk.recordReceipt', 'Record Stock Receipt')}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
