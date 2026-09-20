'use client';
//
// Stock Transfer — move dry stock between the three locations.
//
// Pumpini has always recorded WHERE stock was received and WHERE it was sold, but
// never that it MOVED. So a carton received into the store and sold at the
// forecourt drove bay_stock negative in silence. This screen closes that, and the
// same act parks promotional stock in the gift store, where the counter cannot
// sell it out from under a running campaign.
//
// The writer is backend services/stockService — this screen only asks. The source
// balance is shown BEFORE the quantity box on purpose: a manager should see he has
// 46 litres before he types 60, not after the server refuses him.
import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Package, Loader } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText } from '../../../lib/apiError';

const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #e5e3de',borderRadius:8,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

const fmtQty = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const fmtWhen = ts => ts ? new Date(ts).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
}) : '';

export default function StockTransferPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  // Labels live here rather than in the service: 'bay' is the wire value and has
  // been since the products module shipped; "Forecourt" is what a manager calls it.
  const LOCATIONS = [
    { id: 'shop', label: tc('xfer.shop', 'Store') },
    { id: 'bay',  label: tc('xfer.bay',  'Forecourt') },
    { id: 'gift', label: tc('xfer.gift', 'Gift store') },
  ];
  const locLabel = id => LOCATIONS.find(l => l.id === id)?.label || id;

  const [rows, setRows]         = useState([]);
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');
  const [ok, setOk]             = useState('');
  const [form, setForm]         = useState({ product_id: '', from_location: 'shop', to_location: 'bay', quantity: '', notes: '' });

  const f = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErr(''); setOk(''); };

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const [stk, hist] = await Promise.all([
        api.get('/products/stock-by-location', { params: { station_id: stationId } }),
        api.get('/products/transfers',         { params: { station_id: stationId } }),
      ]);
      setRows(Array.isArray(stk) ? stk : []);
      setHistory(Array.isArray(hist) ? hist : []);
    } catch (e) {
      setErr(errText(e, tc('xfer.loadFailed', 'Could not load stock.')));
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [stationId]);

  const picked = useMemo(
    () => rows.find(r => r.id === form.product_id) || null,
    [rows, form.product_id]
  );

  // What the SOURCE holds — the number the manager needs before he types.
  const available = picked ? Number(picked[form.from_location] ?? 0) : null;
  const qty = Number(form.quantity);
  const overdrawn = picked && Number.isFinite(qty) && qty > 0 && qty > available;
  const sameLoc = form.from_location === form.to_location;

  const canSubmit = !!picked && !sameLoc && Number.isFinite(qty) && qty > 0 && !overdrawn && !saving;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setErr(''); setOk('');
    try {
      await api.post('/products/transfers', {
        station_id: stationId,
        product_id: form.product_id,
        from_location: form.from_location,
        to_location: form.to_location,
        quantity: qty,
        notes: form.notes || null,
      });
      setOk(tc('xfer.moved', 'Moved {q} {u} of {p} from {f} to {t}.')
        .replace('{q}', fmtQty(qty)).replace('{u}', picked.unit || '')
        .replace('{p}', picked.name).replace('{f}', locLabel(form.from_location))
        .replace('{t}', locLabel(form.to_location)));
      setForm(p => ({ ...p, quantity: '', notes: '' }));
      await load();
    } catch (e2) {
      setErr(errText(e2, tc('xfer.failed', 'Could not move the stock.')));
    }
    setSaving(false);
  };

  return (
    <AppShell>
      <div style={{ padding: '20px 16px', maxWidth: 880, margin: '0 auto' }}>

        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px' }}>
          {tc('xfer.title', 'Stock Transfer')}
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#4a4845', lineHeight: 1.5 }}>
          {tc('xfer.sub', 'Move stock between the store, the forecourt and the gift store. The total you hold does not change — only where it sits.')}
        </p>

        <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e3de', borderRadius: 12, padding: 16, marginBottom: 22 }}>

          <label htmlFor="xfer-product" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#4a4845', letterSpacing: '0.3px', marginBottom: 5 }}>
            {tc('xfer.product', 'PRODUCT')}
          </label>
          <select id="xfer-product" style={{ ...inp, marginBottom: 14 }}
                  value={form.product_id} onChange={e => f('product_id', e.target.value)}>
            <option value="">{tc('xfer.pickProduct', 'Choose a product…')}</option>
            {rows.map(r => (
              <option key={r.id} value={r.id}>{r.name}{r.unit ? ` (${r.unit})` : ''}</option>
            ))}
          </select>

          {picked && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {LOCATIONS.map(l => (
                <div key={l.id} style={{
                  flexGrow: 1, padding: '9px 11px', borderRadius: 8, textAlign: 'center',
                  background: l.id === form.from_location ? '#fff8ed' : '#f8f7f5',
                  border: `1px solid ${l.id === form.from_location ? '#e8c89a' : '#e5e3de'}`,
                }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#4a4845', letterSpacing: '0.3px' }}>
                    {l.label.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 500, color: '#1a1916', fontFamily: 'DM Mono, monospace' }}>
                    {fmtQty(picked[l.id])}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
            <div style={{ flexGrow: 1 }}>
              <label htmlFor="xfer-from" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#4a4845', letterSpacing: '0.3px', marginBottom: 5 }}>
                {tc('xfer.from', 'FROM')}
              </label>
              <select id="xfer-from" style={inp} value={form.from_location} onChange={e => f('from_location', e.target.value)}>
                {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <ArrowRight size={17} style={{ color: '#7a7773', marginBottom: 11, flexShrink: 0 }} aria-hidden="true" />
            <div style={{ flexGrow: 1 }}>
              <label htmlFor="xfer-to" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#4a4845', letterSpacing: '0.3px', marginBottom: 5 }}>
                {tc('xfer.to', 'TO')}
              </label>
              <select id="xfer-to" style={inp} value={form.to_location} onChange={e => f('to_location', e.target.value)}>
                {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          </div>

          {sameLoc && (
            <div style={{ fontSize: 12.5, color: '#dc2626', marginBottom: 12 }}>
              {tc('xfer.sameLoc', 'Choose two different locations.')}
            </div>
          )}

          <label htmlFor="xfer-qty" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#4a4845', letterSpacing: '0.3px', marginBottom: 5 }}>
            {tc('xfer.qty', 'QUANTITY')}
            {picked && (
              <span style={{ fontWeight: 400, color: '#4a4845', marginLeft: 6 }}>
                {tc('xfer.availableIn', '— {n} {u} in {loc}')
                  .replace('{n}', fmtQty(available)).replace('{u}', picked.unit || '')
                  .replace('{loc}', locLabel(form.from_location))}
              </span>
            )}
          </label>
          <input id="xfer-qty" type="number" step="0.001" min="0" style={{
            ...inp, marginBottom: overdrawn ? 6 : 14,
            borderColor: overdrawn ? '#dc2626' : '#e5e3de',
          }} value={form.quantity} onChange={e => f('quantity', e.target.value)} />

          {overdrawn && (
            <div style={{ fontSize: 12.5, color: '#dc2626', marginBottom: 12 }}>
              {tc('xfer.overdrawn', 'Only {n} {u} in {loc}. You cannot move more than is there.')
                .replace('{n}', fmtQty(available)).replace('{u}', picked.unit || '')
                .replace('{loc}', locLabel(form.from_location))}
            </div>
          )}

          <label htmlFor="xfer-notes" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#4a4845', letterSpacing: '0.3px', marginBottom: 5 }}>
            {tc('xfer.notes', 'NOTE — OPTIONAL')}
          </label>
          <input id="xfer-notes" type="text" style={{ ...inp, marginBottom: 16 }}
                 placeholder={tc('xfer.notesHint', 'Why it moved')}
                 value={form.notes} onChange={e => f('notes', e.target.value)} />

          {err && <div style={{ padding: '10px 12px', background: '#fdf2f2', border: '1px solid #e9b8b8', borderRadius: 8, fontSize: 13, color: '#1a1916', marginBottom: 12 }}>{err}</div>}
          {ok  && <div style={{ padding: '10px 12px', background: '#f0f7f2', border: '1px solid #b7dcc4', borderRadius: 8, fontSize: 13, color: '#1a1916', marginBottom: 12 }}>{ok}</div>}

          <button type="submit" disabled={!canSubmit} style={{
            width: '100%', padding: 13, fontSize: 15, fontWeight: 700, borderRadius: 9,
            border: 'none', fontFamily: 'inherit',
            color: canSubmit ? '#fff' : '#7a7773',
            background: canSubmit ? '#e07b0c' : '#f3f2ef',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}>
            {saving ? tc('xfer.moving', 'Moving…') : tc('xfer.move', 'Move stock')}
          </button>
        </form>

        <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>
          {tc('xfer.recent', 'Recent movements')}
        </h2>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4a4845', fontSize: 13 }}>
            <Loader size={15} aria-hidden="true" />{tc('xfer.loading', 'Loading…')}
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: 26, textAlign: 'center', background: '#fff', border: '1px solid #e5e3de', borderRadius: 12, color: '#4a4845', fontSize: 13 }}>
            <Package size={20} style={{ marginBottom: 7, color: '#c9c6bf' }} aria-hidden="true" />
            <div>{tc('xfer.none', 'Nothing has been moved yet.')}</div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e5e3de', borderRadius: 12, overflow: 'hidden' }}>
            {history.map((h, i) => (
              <div key={h.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                borderTop: i === 0 ? 'none' : '1px solid #f3f2ef',
              }}>
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: '#1a1916' }}>{h.product_name}</div>
                  <div style={{ fontSize: 11.5, color: '#4a4845' }}>
                    {locLabel(h.from_location)} → {locLabel(h.to_location)}
                    {h.moved_by_name ? ` · ${h.moved_by_name}` : ''} · {fmtWhen(h.moved_at)}
                    {h.notes ? ` · ${h.notes}` : ''}
                  </div>
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500, color: '#1a1916', flexShrink: 0 }}>
                  {fmtQty(h.quantity)}{h.unit ? ` ${h.unit}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
