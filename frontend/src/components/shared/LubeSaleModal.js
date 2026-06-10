'use client';
// Bay lube sale — opened from the wet POS. Scan/pick a lube, take payment
// (cash/UPI/card/credit), and write a product invoice tagged with the current
// shift + attendant so the cash rolls into that attendant's blind-drop.
// Self-contained: does NOT touch the fuel/voice flow.
import { useState, useEffect } from 'react';
import { X, Plus, Minus, Trash2, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import BarcodeScanner from './BarcodeScanner';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8,
  fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const PAY = [['cash','💵 Cash'], ['upi','📱 UPI'], ['card','💳 Card'], ['credit','🏢 Credit']];

export default function LubeSaleModal({ stationId, shiftId, attendantId, corps = [], onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [cart,     setCart]     = useState([]);
  const [barcode,  setBarcode]  = useState('');
  const [payMode,  setPayMode]  = useState('cash');
  const [custId,   setCustId]   = useState('');
  const [saving,   setSaving]   = useState(false);
  const [done,     setDone]     = useState(null);
  const [err,      setErr]      = useState('');

  useEffect(() => {
    if (!stationId) return;
    api.get('/products/catalogue', { params: { station_id: stationId } })
      .then(p => setProducts(Array.isArray(p) ? p : [])).catch(() => {});
  }, [stationId]);

  const addProduct = (p) => {
    if (!p) return;
    setCart(prev => {
      const ex = prev.find(i => i.product_id === p.id);
      if (ex) return prev.map(i => i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: p.id, product_name: p.name, hsn_code: p.hsn_code, unit: p.unit,
        unit_price: parseFloat(p.selling_price), gst_rate: parseFloat(p.gst_rate), quantity: 1 }];
    });
  };

  const addByBarcode = async (code) => {
    const c = (code || '').trim(); if (!c) return;
    try {
      const p = await api.get(`/products/barcode/${encodeURIComponent(c)}`, { params: { station_id: stationId } });
      addProduct(p); setBarcode('');
    } catch { setErr(`Barcode ${c} not found`); setTimeout(() => setErr(''), 2500); setBarcode(''); }
  };

  const setQty = (pid, d) => setCart(prev =>
    prev.map(i => i.product_id === pid ? { ...i, quantity: Math.max(0.1, i.quantity + d) } : i).filter(i => i.quantity > 0));
  const removeItem = (pid) => setCart(prev => prev.filter(i => i.product_id !== pid));

  const lineTotal = (it) => it.quantity * it.unit_price * (1 + it.gst_rate / 100);
  const grand = cart.reduce((s, it) => s + lineTotal(it), 0);

  const checkout = async () => {
    if (!cart.length) return;
    if (payMode === 'credit' && !custId) { setErr('Select a credit customer'); return; }
    setSaving(true); setErr('');
    try {
      const res = await api.post('/products/invoices', {
        station_id:    stationId,
        shift_id:      shiftId,
        attendant_id:  attendantId,
        customer_type: payMode === 'credit' ? 'credit' : 'cash',
        customer_id:   payMode === 'credit' ? custId : null,
        customer_name: payMode === 'credit' ? (corps.find(c => c.id === custId)?.company_name) : 'Walk-in',
        payment_mode:  payMode,
        items:         cart,
      });
      setDone(res);
      onDone && onDone(res);
    } catch (e) { setErr(e.response?.data?.error || e.error || 'Sale failed'); }
    setSaving(false);
  };

  const reset = () => { setCart([]); setBarcode(''); setPayMode('cash'); setCustId(''); setDone(null); setErr(''); };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:300, display:'flex',
      alignItems:'center', justifyContent:'center', padding:'1rem', overflowY:'auto' }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'1.5rem', width:'100%', maxWidth:440,
        boxShadow:'0 20px 60px rgba(0,0,0,.35)', maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
          <h2 style={{ fontWeight:800, fontSize:17, margin:0 }}>🛒 Lube Sale</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer' }}><X size={18}/></button>
        </div>

        {done ? (
          <div style={{ textAlign:'center', padding:'1rem 0' }}>
            <CheckCircle size={44} color="#16a34a" style={{ margin:'0 auto 0.75rem' }}/>
            <div style={{ fontSize:18, fontWeight:800 }}>Sale complete</div>
            <div style={{ fontSize:13, color:'#666', margin:'4px 0 2px' }}>Invoice {done.invoice_number}</div>
            <div style={{ fontSize:22, fontWeight:900, color:'#16a34a', marginBottom:'1.25rem' }}>
              ₹{Number(done.grand_total).toLocaleString('en-IN', { minimumFractionDigits:2 })}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={reset} style={{ flex:1, height:44, background:'#FF6B00', color:'#fff', border:'none',
                borderRadius:10, fontWeight:700, cursor:'pointer' }}>New Lube Sale</button>
              <button onClick={onClose} style={{ flex:1, height:44, background:'#f1f5f9', color:'#334155', border:'none',
                borderRadius:10, fontWeight:700, cursor:'pointer' }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Scan / pick */}
            <div style={{ display:'flex', gap:6, marginBottom:8 }}>
              <input style={{ ...inp, flex:1 }} placeholder="Scan or type barcode" value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addByBarcode(barcode); } }}/>
              <BarcodeScanner label="" onScan={addByBarcode}/>
            </div>
            {/* Tap a product to add (no scan needed) */}
            {products.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12, maxHeight:170, overflowY:'auto' }}>
                {products.map(p => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    style={{ padding:'7px 11px', borderRadius:8, border:'1px solid #e5e7eb', background:'#fff',
                      cursor:'pointer', fontSize:12.5, textAlign:'left', lineHeight:1.3 }}>
                    <span style={{ fontWeight:600 }}>{p.name}</span>
                    <span style={{ color:'#16a34a', marginLeft:6 }}>₹{Number(p.selling_price).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Cart */}
            {cart.length === 0 ? (
              <div style={{ textAlign:'center', color:'#aaa', fontSize:13, padding:'1rem 0' }}>Scan or add a product</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
                {cart.map(it => (
                  <div key={it.product_id} style={{ display:'flex', alignItems:'center', gap:8,
                    background:'#f8fafc', borderRadius:8, padding:'7px 10px' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.product_name}</div>
                      <div style={{ fontSize:11, color:'#888' }}>₹{it.unit_price.toFixed(2)} · {it.gst_rate}% GST</div>
                    </div>
                    <button onClick={() => setQty(it.product_id, -1)} style={{ border:'none', background:'#e2e8f0', borderRadius:6, width:24, height:24, cursor:'pointer' }}><Minus size={13}/></button>
                    <span style={{ fontSize:13, fontWeight:700, minWidth:24, textAlign:'center' }}>{it.quantity}</span>
                    <button onClick={() => setQty(it.product_id, 1)} style={{ border:'none', background:'#e2e8f0', borderRadius:6, width:24, height:24, cursor:'pointer' }}><Plus size={13}/></button>
                    <span style={{ fontSize:13, fontWeight:700, minWidth:64, textAlign:'right' }}>₹{lineTotal(it).toFixed(2)}</span>
                    <button onClick={() => removeItem(it.product_id)} style={{ border:'none', background:'none', cursor:'pointer', color:'#dc2626' }}><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>
            )}

            {/* Payment */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
              {PAY.map(([id, label]) => (
                <button key={id} onClick={() => setPayMode(id)}
                  style={{ padding:'9px', borderRadius:8, border:'1.5px solid ' + (payMode === id ? '#FF6B00' : '#e5e7eb'),
                    background: payMode === id ? '#fff7ed' : '#fff', color: payMode === id ? '#9a3412' : '#334155',
                    fontWeight:600, fontSize:13, cursor:'pointer' }}>{label}</button>
              ))}
            </div>
            {payMode === 'credit' && (
              <select style={{ ...inp, marginBottom:8 }} value={custId} onChange={e => setCustId(e.target.value)}>
                <option value="">Select credit customer…</option>
                {corps.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            )}

            {err && <div style={{ background:'#fee2e2', color:'#991b1b', borderRadius:8, padding:'8px 12px', fontSize:13, marginBottom:8 }}>{err}</div>}

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'4px 0 12px' }}>
              <span style={{ fontSize:14, color:'#555' }}>Total (incl. GST)</span>
              <span style={{ fontSize:22, fontWeight:900 }}>₹{grand.toLocaleString('en-IN', { minimumFractionDigits:2 })}</span>
            </div>
            <button onClick={checkout} disabled={saving || !cart.length}
              style={{ width:'100%', height:48, background: cart.length ? '#16a34a' : '#cbd5e1', color:'#fff',
                border:'none', borderRadius:10, fontWeight:800, fontSize:15, cursor: cart.length ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Processing…' : 'Complete Sale'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
