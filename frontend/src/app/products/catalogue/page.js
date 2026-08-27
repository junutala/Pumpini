'use client';
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Package, AlertTriangle, X } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import BarcodeScanner from '../../../components/shared/BarcodeScanner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

import { errText } from '../../../lib/apiError';
const GST_RATES = [0, 5, 12, 18, 28];
const UNITS     = ['piece','litre','kg','pack','box','set'];
const HSN_COMMON = [
  { code:'27101990', desc:'Lubricating oils' },
  { code:'34031900', desc:'Lubricating preparations' },
  { code:'38190090', desc:'Hydraulic brake fluids' },
  { code:'38200000', desc:'Anti-freeze preparations' },
  { code:'84099900', desc:'Engine parts/accessories' },
  { code:'87141090', desc:'Vehicle accessories' },
];

const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #e5e3de',borderRadius:8,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

export default function ProductCataloguePage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;

  const [products,setProducts] = useState([]);
  const [loading,setLoading]   = useState(true);
  const [modal,setModal]       = useState(null);
  const [form,setForm]         = useState({});
  const [saving,setSaving]     = useState(false);
  const [search,setSearch]     = useState('');

  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/products/catalogue', { params:{ station_id:stationId } });
      setProducts(Array.isArray(res) ? res : []);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { if (stationId) load(); }, [stationId]);

  const openAdd  = () => { setForm({ gst_rate:18, unit:'piece', min_stock_level:5, station_id:stationId }); setModal('form'); };
  const openEdit = (p) => { setForm({...p}); setModal('form'); };

  const save = async () => {
    if (!form.name || !form.selling_price) return alert(tc('lubecat.nameAndPriceRequired', 'Name and selling price are required'));
    setSaving(true);
    try {
      if (form.id) {
        await api.patch(`/products/catalogue/${form.id}`, form);
      } else {
        await api.post('/products/catalogue', { ...form, station_id: stationId });
      }
      setModal(null); setForm({}); load();
    } catch(e) { alert(errText(e, tc('lubecat.saveFailed', 'Save failed'))); }
    setSaving(false);
  };

  const deactivate = async (id) => {
    if (!confirm(tc('lubecat.removeProductConfirm', 'Remove this product?'))) return;
    await api.delete(`/products/catalogue/${id}`);
    load();
  };

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.barcode||'').includes(search) ||
    (p.brand||'').toLowerCase().includes(search.toLowerCase())
  );

  const lowStock = products.filter(p => p.current_stock <= p.min_stock_level);

  return (
    <AppShell>
      <div className="page-header" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:'1.5rem'}}>
        <div>
          <h1 className="page-title">{tc('lubecat.pageTitle', 'Product Catalogue')}</h1>
          <p className="page-subtitle">{tc('lubecat.pageSubtitle', 'Manage lubes, oils and ancillary products')}</p>
        </div>
        <button onClick={openAdd} style={{display:'flex',alignItems:'center',gap:6,padding:'10px 18px',
          background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
          <Plus size={16}/> {tc('lubecat.addProduct', 'Add Product')}
        </button>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'0.75rem 1rem',
          marginBottom:'1rem',display:'flex',alignItems:'center',gap:8,fontSize:13,color:'#9a3412'}}>
          <AlertTriangle size={16}/>
          <strong>{(lowStock.length>1
            ? tc('lubecat.lowStockAlertPlural', '{n} products low on stock:')
            : tc('lubecat.lowStockAlert', '{n} product low on stock:')).replace('{n}', lowStock.length)}</strong>
          {lowStock.map(p=>p.name).join(', ')}
        </div>
      )}

      {/* Search */}
      <div style={{marginBottom:'1rem'}}>
        <input style={{...inp,maxWidth:320}} placeholder={tc('lubecat.searchPlaceholder', 'Search by name, brand or barcode...')}
          value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {/* Products table */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
        {loading ? (
          <div style={{textAlign:'center',padding:'3rem',color:'#aaa'}}>{tc('lubecat.loading', 'Loading...')}</div>
        ) : filtered.length===0 ? (
          <div style={{textAlign:'center',padding:'3rem',color:'#aaa'}}>
            <Package size={40} style={{marginBottom:8,opacity:.3}}/><br/>
            {tc('lubecat.noProducts', 'No products yet. Add your first product above.')}
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8f7f5'}}>
              {[
                tc('lubecat.colProduct','Product'),
                tc('lubecat.colBrand','Brand'),
                tc('lubecat.colBarcode','Barcode'),
                tc('lubecat.colHsn','HSN'),
                tc('lubecat.colUnit','Unit'),
                tc('lubecat.colSellPrice','Sell Price'),
                tc('lubecat.colGst','GST%'),
                tc('lubecat.colStock','Stock'),
                tc('lubecat.colMinStock','Min Stock'),
                tc('lubecat.colActions','Actions'),
              ].map(h=>(
                <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,
                  fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(p=>(
                <tr key={p.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                  <td style={{padding:'11px 14px',fontWeight:600}}>{p.name}</td>
                  <td style={{padding:'11px 14px',fontSize:13,color:'#555'}}>{p.brand||'—'}</td>
                  <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:12}}>{p.barcode||'—'}</td>
                  <td style={{padding:'11px 14px',fontFamily:'monospace',fontSize:12}}>{p.hsn_code||'—'}</td>
                  <td style={{padding:'11px 14px',fontSize:13}}>{p.unit}</td>
                  <td style={{padding:'11px 14px',fontWeight:600}}>₹{Number(p.selling_price).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                  <td style={{padding:'11px 14px'}}>{p.gst_rate}%</td>
                  <td style={{padding:'11px 14px'}}>
                    <span style={{fontWeight:600,
                      color: p.current_stock <= p.min_stock_level ? '#dc2626' :
                             p.current_stock <= p.min_stock_level*2 ? '#d97706' : '#16a34a'}}>
                      {Number(p.current_stock).toFixed(1)}
                    </span>
                  </td>
                  <td style={{padding:'11px 14px',fontSize:13,color:'#888'}}>{p.min_stock_level}</td>
                  <td style={{padding:'11px 14px'}}>
                    <div style={{display:'flex',gap:5}}>
                      <button onClick={()=>openEdit(p)} style={{padding:'4px 10px',background:'#f0f9ff',color:'#1A5F7A',
                        border:'none',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                        <Edit2 size={12}/>{tc('lubecat.edit', 'Edit')}</button>
                      <button onClick={()=>deactivate(p.id)} style={{padding:'4px 10px',background:'#fee2e2',color:'#991b1b',
                        border:'none',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                        <Trash2 size={12}/>{tc('lubecat.remove', 'Remove')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modal==='form' && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',
          alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem',overflowY:'auto'}}>
          <div style={{background:'#fff',borderRadius:16,padding:'1.75rem',width:'100%',maxWidth:560,
            boxShadow:'0 20px 60px rgba(0,0,0,.3)',maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <h2 style={{fontWeight:700,fontSize:16,margin:0}}>{form.id?tc('lubecat.editProduct','Edit Product'):tc('lubecat.addProduct','Add Product')}</h2>
              <button onClick={()=>setModal(null)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelProductName', 'Product Name *')}</label>
                <input style={inp} placeholder={tc('lubecat.phProductName', 'e.g. Castrol GTX 10W30 1L')} value={form.name||''} onChange={e=>f('name',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelBrand', 'Brand')}</label>
                <input style={inp} placeholder={tc('lubecat.phBrand', 'e.g. Castrol')} value={form.brand||''} onChange={e=>f('brand',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelBarcode', 'Barcode')}</label>
                <div style={{display:'flex',gap:6}}>
                  <input style={{...inp,flex:1}} placeholder={tc('lubecat.phBarcode', 'Scan or type barcode')} value={form.barcode||''} onChange={e=>f('barcode',e.target.value)}/>
                  <BarcodeScanner label="" onScan={code=>f('barcode',code)}/>
                </div>
              </div>
              <div style={{gridColumn:'1/-1',display:'flex',alignItems:'flex-start',gap:8,
                background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,padding:'10px 12px'}}>
                <input type="checkbox" id="reqbc" checked={!!form.require_barcode}
                  onChange={e=>f('require_barcode',e.target.checked)} style={{width:16,height:16,marginTop:2,flexShrink:0}}/>
                <label htmlFor="reqbc" style={{fontSize:12.5,cursor:'pointer',lineHeight:1.5,color:'#334155'}}>
                  <b>{tc('lubecat.requireBarcodeBold', 'Require barcode')}</b> {tc('lubecat.requireBarcodeDesc', '— block receiving & selling until a barcode is tied to this product. Leave off for loose items (oil by weight, cotton waste) sold by name.')}
                </label>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelHsnCode', 'HSN Code')}</label>
                <select style={inp} value={form.hsn_code||''} onChange={e=>f('hsn_code',e.target.value)}>
                  <option value="">{tc('lubecat.selectHsn', 'Select HSN...')}</option>
                  {HSN_COMMON.map(h=><option key={h.code} value={h.code}>{h.code} — {h.desc}</option>)}
                  <option value="custom">{tc('lubecat.hsnOther', 'Other (type manually)')}</option>
                </select>
                {form.hsn_code==='custom' && (
                  <input style={{...inp,marginTop:6}} placeholder={tc('lubecat.phEnterHsn', 'Enter HSN code')} onChange={e=>f('hsn_code',e.target.value)}/>
                )}
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelUnit', 'Unit')}</label>
                <select style={inp} value={form.unit||'piece'} onChange={e=>f('unit',e.target.value)}>
                  {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelSellingPrice', 'Selling Price (₹) *')}</label>
                <input style={inp} type="number" step="0.01" placeholder="0.00"
                  value={form.selling_price||''} onChange={e=>f('selling_price',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelBuyingPrice', 'Buying Price (₹)')}</label>
                <input style={inp} type="number" step="0.01" placeholder="0.00"
                  value={form.buying_price||''} onChange={e=>f('buying_price',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelGstRate', 'GST Rate')}</label>
                <select style={inp} value={form.gst_rate||18} onChange={e=>f('gst_rate',parseFloat(e.target.value))}>
                  {GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>{tc('lubecat.labelMinStockLevel', 'Min Stock Level')}</label>
                <input style={inp} type="number" placeholder="5"
                  value={form.min_stock_level||''} onChange={e=>f('min_stock_level',e.target.value)}/>
              </div>
            </div>

            <button onClick={save} disabled={saving} style={{width:'100%',marginTop:'1.5rem',height:44,
              background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',
              fontWeight:700,fontSize:14}}>
              {saving?tc('lubecat.saving','Saving...'):form.id?tc('lubecat.saveChanges','Save Changes'):tc('lubecat.addProduct','Add Product')}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
