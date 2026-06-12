'use client';
// Owner-only dashboard tile: the day's gross fuel earnings on top (revenue −
// weighted-average landed purchase cost from Deliveries), with the live
// per-nozzle dispense feed underneath. Updates on every dispense socket event
// and polls as a fallback so the numbers stay live even if the socket drops.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import api from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';

const POLL_MS = 60000;
const FUEL_COLORS = { petrol: '#3b82f6', diesel: '#f59e0b', cng: '#10b981', premium_petrol: '#8b5cf6' };
const PAYMENT_COLORS = { cash: '#16a34a', upi: '#2563eb', credit: '#9333ea', card: '#ea580c' };

const fmt  = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtL = n => Number(n || 0).toFixed(2);
const toIST = ts => new Date(ts).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
});

export default function EarningsMarginTile({ stationId, maxRows = 10 }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [margin, setMargin] = useState(null);
  const [events, setEvents] = useState([]);
  const [flash, setFlash]   = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const { on } = useSocket(stationId, null);

  const load = useCallback(async () => {
    if (!stationId) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [m, ev, inv] = await Promise.all([
      api.get('/dashboard/margin', { params: { station_id: stationId, date: today } }).catch(() => null),
      api.get('/dispense', { params: { station_id: stationId, date_from: today, date_to: today + 'T23:59:59', limit: maxRows } }).catch(() => []),
      api.get('/products/invoices', { params: { station_id: stationId, from: today, to: today } }).catch(() => []),
    ]);
    if (m) { setMargin(m); setUpdatedAt(new Date()); }
    // One feed for everything sold today: POS dispenses, manager shift totals
    // (source='manager') and dry-stock invoices, newest first.
    const fuel = (Array.isArray(ev) ? ev : []).map(r => ({ ...r, kind: 'fuel', at: r.occurred_at }));
    const lube = (Array.isArray(inv) ? inv : []).map(r => ({
      id: `inv-${r.id}`, kind: 'lube', at: r.created_at, payment_mode: r.payment_mode,
      amount: r.grand_total, item_count: r.item_count, invoice_number: r.invoice_number,
    }));
    setEvents([...fuel, ...lube].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, maxRows));
  }, [stationId, maxRows]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => on('dispense:new', ev => {
    setEvents(prev => [{ ...ev, kind: 'fuel', at: ev.occurred_at }, ...prev].slice(0, maxRows));
    setFlash(ev.id);
    setTimeout(() => setFlash(null), 2000);
    load(); // refresh margin block with the new sale included
  }), [on, load]);

  if (!margin) return null;
  const dry = margin.dry || null;
  const showDry = dry && (dry.invoice_count > 0 || dry.revenue !== 0);
  const hasMargin = margin.totals.margin !== 0 || margin.fuels.some(f => f.margin != null) || showDry;
  const cols = Math.max(margin.fuels.length + (showDry ? 1 : 0), 1);

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {/* ── Top block: earnings/margin ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={15} /> {tc('margin_tile.title', 'Earnings — Today')}
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>
            · {tc('margin_tile.subtitle', 'fuel vs weighted-avg delivery cost · dry stock vs buying price')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {updatedAt && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {tc('margin_tile.last_updated', 'Last updated')} {toIST(updatedAt)}
            </span>
          )}
          <Link href="/live" style={{ fontSize: 12, color: 'var(--brand)', textDecoration: 'none', fontWeight: 600 }}>
            {tc('margin_tile.view_all', 'View all →')}
          </Link>
        </div>
      </div>

      <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: `minmax(160px,auto) repeat(${cols}, 1fr)`, gap: 10, marginBottom: '1rem' }}>
        <div style={{ borderRight: '1px solid var(--border)', paddingRight: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {tc('margin_tile.gross_earnings', 'Gross earnings')}
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: hasMargin && margin.totals.margin < 0 ? 'var(--danger)' : 'var(--success)' }}>
            {hasMargin ? `₹${fmt(margin.totals.margin)}` : '—'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            {tc('margin_tile.on_revenue', 'on revenue')} ₹{fmt(margin.totals.revenue)} · {fmt(margin.totals.litres)} L
            {showDry && <> · {tc('margin_tile.fuel', 'Fuel')} ₹{fmt(margin.totals.fuel_margin)} + {tc('margin_tile.dry', 'Dry stock')} ₹{fmt(margin.totals.dry_margin)}</>}
          </div>
        </div>

        {margin.fuels.map(f => (
          <div key={f.fuel_type}>
            <span className={`fuel-chip fuel-${f.fuel_type}`} style={{ marginBottom: 4 }}>
              {t(`fuel_types.${f.fuel_type}`) === `fuel_types.${f.fuel_type}` ? f.fuel_type : t(`fuel_types.${f.fuel_type}`)}
            </span>
            {f.margin != null ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 800, color: f.margin < 0 ? 'var(--danger)' : 'var(--text-1)' }}>
                  ₹{fmt(f.margin)}
                  <span style={{ fontSize: 11, fontWeight: 600, color: f.margin_per_ltr < 0 ? 'var(--danger)' : 'var(--success)', marginLeft: 6 }}>
                    {f.margin_per_ltr != null ? `₹${f.margin_per_ltr.toFixed(2)}/L` : ''}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {tc('margin_tile.sell', 'Sell')} ₹{f.sell_rate_avg?.toFixed(2)} − {tc('margin_tile.cost', 'Cost')} ₹{f.wac?.toFixed(2)} · {fmt(f.litres)} L
                  {f.wac_source === 'latest' && <span title={tc('margin_tile.stale_cost', 'No delivery in 45 days — using last known purchase rate')}> ⚠</span>}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--warning)', fontWeight: 600, marginTop: 2 }}>
                {tc('margin_tile.no_cost', 'No purchase rate — add it when recording Deliveries')}
              </div>
            )}
          </div>
        ))}
        {showDry && (
          <div>
            <span className="fuel-chip fuel-lubes" style={{ marginBottom: 4 }}>
              {tc('margin_tile.dry', 'Dry stock')}
            </span>
            <div style={{ fontSize: 17, fontWeight: 800, color: dry.margin < 0 ? 'var(--danger)' : 'var(--text-1)' }}>
              ₹{fmt(dry.margin)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              ₹{fmt(dry.revenue)} · {fmt(dry.units)} {tc('margin_tile.items', 'items')} · {dry.invoice_count} {tc('margin_tile.invoices', 'invoices')}
            </div>
            {dry.uncosted_lines > 0 && (
              <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                {tc('margin_tile.dry_uncosted', 'Some items have no buying price — set it in Catalogue')}
              </div>
            )}
          </div>
        )}
        {margin.fuels.length === 0 && !showDry && (
          <div style={{ color: 'var(--text-3)', fontSize: 13, alignSelf: 'center' }}>
            {tc('margin_tile.no_sales', 'No fuel sales yet today')}
          </div>
        )}
      </div>

      {/* ── Live nozzle feed ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, marginBottom: 6, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div className="live-dot" /> {tc('margin_tile.live_feed', 'Live nozzle feed')}
      </div>
      {events.length === 0 && (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-3)', fontSize: 13 }}>
          {tc('margin_tile.no_events', 'No dispenses yet today')}
        </div>
      )}
      {events.map((ev, i) => (
        <div key={ev.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '7px 0',
          borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none',
          background: flash === ev.id ? '#fff3e0' : 'transparent',
          transition: 'background .5s', borderRadius: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{toIST(ev.at)}</span>
            <span className={`fuel-chip fuel-${ev.kind === 'lube' ? 'lubes' : ev.fuel_type}`}>
              {ev.kind === 'lube'
                ? tc('margin_tile.dry', 'Dry stock')
                : (t(`fuel_types.${ev.fuel_type}`) === `fuel_types.${ev.fuel_type}` ? ev.fuel_type : t(`fuel_types.${ev.fuel_type}`))}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '1px 8px', borderRadius: 10, color: '#fff', background: PAYMENT_COLORS[ev.payment_mode] || '#888', textTransform: 'capitalize' }}>
              {t(`dispense.${ev.payment_mode}`) === `dispense.${ev.payment_mode}` ? ev.payment_mode : t(`dispense.${ev.payment_mode}`)}
            </span>
            {ev.kind === 'lube' ? (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {ev.invoice_number} · {ev.item_count} {tc('margin_tile.items', 'items')}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>{fmtL(ev.quantity_ltrs)} L</span>
            )}
            {ev.source === 'manager' && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                {tc('margin_tile.shift_total', 'Shift total')}{ev.attendant_name ? ` · ${ev.attendant_name}` : ''}
              </span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0, color: 'var(--brand)' }}>
            ₹{fmt(ev.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}
