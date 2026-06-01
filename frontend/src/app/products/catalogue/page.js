'use client';
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Package, AlertTriangle, X } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

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
    if (!form.name || !form.selling_price) return alert('Name and selling price are required');
    setSaving(true);
    try {
      if (form.id) {
        await api.patch(`/products/catalogue/${form.id}`, form);
      } else {
        await api.post('/products/catalogue', { ...form, station_id: stationId });
      }
      setModal(null); setForm({}); load();
    } catch(e) { alert(e.response?.data?.error || 'Save failed'); }
    setSaving(false);
  };

  const deactivate = async (id) => {
    if (!confirm('Remove this product?')) return;
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
          <h1 className="page-title">Product Catalogue</h1>
          <p className="page-subtitle">Manage lubes, oils and ancillary products</p>
        </div>
        <button onClick={openAdd} style={{display:'flex',alignItems:'center',gap:6,padding:'10px 18px',
          background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
          <Plus size={16}/> Add Product
        </button>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'0.75rem 1rem',
          marginBottom:'1rem',display:'flex',alignItems:'center',gap:8,fontSize:13,color:'#9a3412'}}>
          <AlertTriangle size={16}/>
          <strong>{lowStock.length} product{lowStock.length>1?'s':''} low on stock:</strong>
          {lowStock.map(p=>p.name).join(', ')}
        </div>
      )}

      {/* Search */}
      <div style={{marginBottom:'1rem'}}>
        <input style={{...inp,maxWidth:320}} placeholder="Search by name, brand or barcode..."
          value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {/* Products table */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e5e3de',overflow:'hidden'}}>
        {loading ? (
          <div style={{textAlign:'center',padding:'3rem',color:'#aaa'}}>Loading...</div>
        ) : filtered.length===0 ? (
          <div style={{textAlign:'center',padding:'3rem',color:'#aaa'}}>
            <Package size={40} style={{marginBottom:8,opacity:.3}}/><br/>
            No products yet. Add your first product above.
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8f7f5'}}>
              {['Product','Brand','Barcode','HSN','Unit','Sell Price','GST%','Stock','Min Stock','Actions'].map(h=>(
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
                        <Edit2 size={12}/>Edit</button>
                      <button onClick={()=>deactivate(p.id)} style={{padding:'4px 10px',background:'#fee2e2',color:'#991b1b',
                        border:'none',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                        <Trash2 size={12}/>Remove</button>
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
              <h2 style={{fontWeight:700,fontSize:16,margin:0}}>{form.id?'Edit Product':'Add Product'}</h2>
              <button onClick={()=>setModal(null)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18}/></button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Product Name *</label>
                <input style={inp} placeholder="e.g. Castrol GTX 10W30 1L" value={form.name||''} onChange={e=>f('name',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Brand</label>
                <input style={inp} placeholder="e.g. Castrol" value={form.brand||''} onChange={e=>f('brand',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Barcode</label>
                <input style={inp} placeholder="Scan or type barcode" value={form.barcode||''} onChange={e=>f('barcode',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>HSN Code</label>
                <select style={inp} value={form.hsn_code||''} onChange={e=>f('hsn_code',e.target.value)}>
                  <option value="">Select HSN...</option>
                  {HSN_COMMON.map(h=><option key={h.code} value={h.code}>{h.code} — {h.desc}</option>)}
                  <option value="custom">Other (type manually)</option>
                </select>
                {form.hsn_code==='custom' && (
                  <input style={{...inp,marginTop:6}} placeholder="Enter HSN code" onChange={e=>f('hsn_code',e.target.value)}/>
                )}
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Unit</label>
                <select style={inp} value={form.unit||'piece'} onChange={e=>f('unit',e.target.value)}>
                  {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Selling Price (₹) *</label>
                <input style={inp} type="number" step="0.01" placeholder="0.00"
                  value={form.selling_price||''} onChange={e=>f('selling_price',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Buying Price (₹)</label>
                <input style={inp} type="number" step="0.01" placeholder="0.00"
                  value={form.buying_price||''} onChange={e=>f('buying_price',e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>GST Rate</label>
                <select style={inp} value={form.gst_rate||18} onChange={e=>f('gst_rate',parseFloat(e.target.value))}>
                  {GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Min Stock Level</label>
                <input style={inp} type="number" placeholder="5"
                  value={form.min_stock_level||''} onChange={e=>f('min_stock_level',e.target.value)}/>
              </div>
            </div>

            <button onClick={save} disabled={saving} style={{width:'100%',marginTop:'1.5rem',height:44,
              background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',
              fontWeight:700,fontSize:14}}>
              {saving?'Saving...':form.id?'Save Changes':'Add Product'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
