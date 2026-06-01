'use client';
import { useState, useEffect } from 'react';
import { Plus, Package, X } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #e5e3de',borderRadius:8,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

export default function ProductStockPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station==='object' ? station?.id : station;

  const [receipts,setReceipts] = useState([]);
  const [products,setProducts] = useState([]);
  const [loading,setLoading]   = useState(true);
  const [modal,setModal]       = useState(false);
  const [form,setForm]         = useState({});
  const [saving,setSaving]     = useState(false);

  const f = (k,v) => setForm(p=>({...p,[k]:v}));

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
    if (!form.product_id || !form.quantity) return alert('Product and quantity required');
    setSaving(true);
    try {
      await api.post('/products/stock', { ...form, station_id: stationId });
      setModal(false); setForm({}); load();
    } catch(e) { alert(e.response?.data?.error || 'Save failed'); }
    setSaving(false);
  };

  const selectedProduct = products.find(p => p.id === form.product_id);

  return (
    <AppShell>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:'1.5rem'}}>
        <div>
          <h1 className="page-title">Stock Management</h1>
          <p className="page-subtitle">Receive and track product inventory</p>
        </div>
        <button onClick={()=>{ setForm({ station_id:stationId }); setModal(true); }}
          style={{display:'flex',alignItems:'center',gap:6,padding:'10px 18px',
            background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
          <Plus size={16}/> Receive Stock
        </button>
      </div>

      {/* Current stock levels */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden',marginBottom:'1.5rem'}}>
        <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',fontSize:15}}>
          Current Stock Levels
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
              {p.current_stock <= p.min_stock_level && (
                <div style={{fontSize:10,color:'#dc2626',fontWeight:600,marginTop:2}}>⚠ LOW STOCK</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Receipt history */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
        <div style={{padding:'1rem 1.25rem',fontWeight:700,borderBottom:'1px solid #e5e3de',fontSize:15}}>
          Stock Receipt History
        </div>
        {loading ? (
          <div style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>Loading...</div>
        ) : receipts.length===0 ? (
          <div style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>No stock receipts yet</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8f7f5'}}>
              {['Date','Product','Quantity','Buying Price','Selling Price','Notes'].map(h=>(
                <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#666',fontWeight:600,
                  fontSize:11,textTransform:'uppercase',borderBottom:'1px solid #e5e3de'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {receipts.map(r=>(
                <tr key={r.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                  <td style={{padding:'11px 14px',fontSize:13}}>{new Date(r.received_at).toLocaleDateString('en-IN')}</td>
                  <td style={{padding:'11px 14px',fontWeight:600}}>{r.product_name}</td>
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
              <h2 style={{fontWeight:700,fontSize:16,margin:0}}>Receive Stock</h2>
              <button onClick={()=>setModal(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            <div style={{marginBottom:'0.85rem'}}>
              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Product *</label>
              <select style={inp} value={form.product_id||''} onChange={e=>f('product_id',e.target.value)}>
                <option value="">Select product...</option>
                {products.map(p=><option key={p.id} value={p.id}>{p.name} {p.brand?`(${p.brand})`:''} — Stock: {Number(p.current_stock).toFixed(1)}</option>)}
              </select>
            </div>

            {selectedProduct && (
              <div style={{background:'#f0f9ff',borderRadius:8,padding:'0.5rem 0.75rem',marginBottom:'0.85rem',fontSize:12,color:'#1A5F7A'}}>
                Current stock: <strong>{Number(selectedProduct.current_stock).toFixed(1)} {selectedProduct.unit}s</strong>
                {' · '}Current selling price: <strong>₹{Number(selectedProduct.selling_price).toFixed(2)}</strong>
              </div>
            )}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Quantity Received *</label>
                <input style={inp} type="number" step="0.1" placeholder="0"
                  value={form.quantity||''} onChange={e=>f('quantity',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Buying Price (₹)</label>
                <input style={inp} type="number" step="0.01" placeholder="Optional — updates cost price"
                  value={form.buying_price||''} onChange={e=>f('buying_price',e.target.value)}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Update Selling Price (₹)</label>
                <input style={inp} type="number" step="0.01"
                  placeholder={selectedProduct ? `Current: ₹${Number(selectedProduct.selling_price).toFixed(2)}` : 'Optional'}
                  value={form.selling_price||''} onChange={e=>f('selling_price',e.target.value)}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Notes</label>
                <input style={inp} placeholder="e.g. Supplier: Castrol India, Invoice: CI/2026/001"
                  value={form.notes||''} onChange={e=>f('notes',e.target.value)}/>
              </div>
            </div>

            <button onClick={save} disabled={saving} style={{width:'100%',marginTop:'1.5rem',height:44,
              background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
              {saving?'Saving...':'Record Stock Receipt'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
