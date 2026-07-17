'use client';
// Group sales by outlet & product — two period tiles (Day / Month-to-date) with a
// shared Quantity·Amount·Margin toggle, a blended-margin dial, a product donut, an
// outlet×product stacked bar, a "force data entry" nudge for products missing a
// delivery rate, and a margin-variance-by-product analysis. Reads each station's
// `by_fuel` payload from /groups/:id/dashboard; renders nothing if that's absent
// (e.g. an older backend), so the rest of the rollup is unaffected.
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

const PRODUCTS = {
  petrol:         { label: 'Petrol',  color: '#2a78d6', order: 1 },
  diesel:         { label: 'Diesel',  color: '#008300', order: 2 },
  premium_petrol: { label: 'Premium', color: '#d1518a', order: 3 },
  cng:            { label: 'CNG',      color: '#c98a00', order: 4 },
};
const meta = ft => PRODUCTS[ft] || { label: String(ft).replace(/_/g, ' '), color: '#8a867f', order: 9 };

const fmtR = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
const fmtL = n => Math.round(+n || 0).toLocaleString('en-IN') + ' L';
const compactR = n => { n = +n || 0; return n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : '₹' + Math.round(n).toLocaleString('en-IN'); };
const compactL = n => Math.round(+n || 0).toLocaleString('en-IN') + ' L';

const MEASURES = {
  qty: { label: 'Sale Quantity', fmt: fmtL, compact: compactL },
  amt: { label: 'Sale Amount',   fmt: fmtR, compact: compactR },
  mgn: { label: 'Margin',        fmt: fmtR, compact: compactR },
};
const val = (r, m) => !r ? 0 : m === 'qty' ? r.l : m === 'amt' ? r.amt : (r.buy == null ? 0 : r.l * (r.sell - r.buy));

const DIAL_MAX_PCT = 4, DIAL_SPAN = 0.75;
function dialPath() {
  const cx = 75, cy = 75, r = 62, p = d => [cx + r * Math.sin(d * Math.PI / 180), cy - r * Math.cos(d * Math.PI / 180)];
  const [x0, y0] = p(-135), [x1, y1] = p(135);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
const DONUT_C = 2 * Math.PI * 46;

export default function GroupProductTiles({ stations, asOfDate, asOfUniform }) {
  const router = useRouter();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [measure, setMeasure] = useState('amt');

  const outlets = useMemo(() => (stations || []).map(s => {
    const price = {}; (s.by_fuel?.price || []).forEach(p => { price[p.fuel_type] = p; });
    const mk = arr => { const m = {}; (arr || []).forEach(r => { const pr = price[r.fuel_type] || {}; m[r.fuel_type] = { l: +r.litres || 0, amt: +r.amount || 0, sell: pr.sell == null ? null : +pr.sell, buy: pr.buy == null ? null : +pr.buy }; }); return m; };
    return {
      name: s.name,
      short: (s.name || '').replace(/ Filling Station| Petrol Bunk| Bunk/i, '').trim() || s.name,
      health: (s.wetstock_beyond || s.overdue_90 > 0) ? '#dc2626' : (s.cash_undeposited > 5000 ? '#d97706' : '#16a34a'),
      day: mk(s.by_fuel?.day), mtd: mk(s.by_fuel?.mtd),
    };
  }), [stations]);

  const hasData = outlets.some(o => Object.keys(o.day).length || Object.keys(o.mtd).length);
  if (!hasData) return null;

  const M = MEASURES[measure];
  const productsIn = period => { const set = new Set(); outlets.forEach(o => Object.keys(o[period]).forEach(k => set.add(k))); return [...set].sort((a, b) => meta(a).order - meta(b).order); };
  const outletTotal = (o, period) => Object.keys(o[period]).reduce((s, k) => s + val(o[period][k], measure), 0);
  const productTotal = (period, k) => outlets.reduce((s, o) => s + val(o[period][k], measure), 0);
  const groupTotal = period => outlets.reduce((s, o) => s + outletTotal(o, period), 0);
  const groupMargin = period => outlets.reduce((s, o) => s + Object.keys(o[period]).reduce((ss, k) => { const r = o[period][k]; return ss + (r.buy == null ? 0 : r.l * (r.sell - r.buy)); }, 0), 0);
  const marginBearingSales = period => outlets.reduce((s, o) => s + Object.keys(o[period]).reduce((ss, k) => { const r = o[period][k]; return ss + (r.buy == null ? 0 : r.amt); }, 0), 0);
  const blended = period => { const b = marginBearingSales(period); return b > 0 ? groupMargin(period) / b * 100 : 0; };
  const untracked = period => { const m = {}; outlets.forEach(o => Object.keys(o[period]).forEach(k => { const r = o[period][k]; if (r.buy == null && r.amt > 0) { (m[k] = m[k] || { key: k, label: meta(k).label, sales: 0 }).sales += r.amt; } })); return Object.values(m).sort((a, b) => b.sales - a.sales); };

  const surface = 'var(--surface,#fff)';
  const mini = { background: 'var(--surface-2,#f8fafc)', borderRadius: 10 };

  const Tile = ({ period, eyebrow, name, stamp, accent }) => {
    const products = productsIn(period);
    const gTotal = groupTotal(period);
    const mp = blended(period);
    const ut = untracked(period);
    const maxOutlet = Math.max(1, ...outlets.map(o => outletTotal(o, period)));
    let acc = 0;

    return (
      <div style={{ background: surface, border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 16, padding: '16px 16px 18px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: accent }}>{eyebrow}</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 5 }}>{name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{stamp}</div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', background: 'var(--surface-2,#f8fafc)', border: '1px dashed var(--border-strong,#c9c6bf)', padding: '4px 9px', borderRadius: 99, maxWidth: 120, textAlign: 'right', lineHeight: 1.3 }}>
            {tc('gprod.noPrior', 'no prior month')}
          </span>
        </div>

        {/* hero: dial + number */}
        <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr', gap: 14, alignItems: 'center', paddingBottom: 14, borderBottom: '1px solid var(--border,#eee)', marginBottom: 14 }}>
          <div style={{ position: 'relative', width: 128, height: 110 }}>
            <svg viewBox="0 0 150 150" style={{ width: 128, height: 128, display: 'block' }} aria-hidden="true">
              <path d={dialPath()} fill="none" stroke="var(--surface-2,#eee)" strokeWidth="12" strokeLinecap="round" />
              <path d={dialPath()} pathLength="100" fill="none" stroke={accent} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={`${(Math.min(100, mp / DIAL_MAX_PCT * 100) * DIAL_SPAN).toFixed(2)} 100`}
                style={{ transition: 'stroke-dasharray .8s cubic-bezier(.22,1,.36,1)' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, bottom: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1 }}>{mp.toFixed(2)}%</div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)', marginTop: 3 }}>{tc('gprod.blendedMargin', 'blended margin')}</div>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'center', fontSize: 10, color: 'var(--text-3)' }}>{fmtR(groupMargin(period))} {tc('gprod.earned', 'earned')}</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>{tc('gprod.m_' + measure, M.label)}{measure === 'qty' ? ' (L)' : ''}</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05 }}>{M.compact(gTotal)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2,#475569)', marginTop: 2 }}>
              {measure === 'mgn'
                ? `${M.fmt(gTotal)} · ${mp.toFixed(2)}% ${tc('gprod.blended', 'blended')}`
                : (outlets.length > 1 ? `${M.fmt(gTotal)} · ${outlets.length} ${tc('gprod.outlets', 'outlets')}` : M.fmt(gTotal))}
            </div>
          </div>
        </div>

        {/* data-entry nudge */}
        {ut.length > 0 && (
          <div className="gpt-datagap" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--brand-light,#fff8ed)', border: '1px solid #f2c789', borderRadius: 11, padding: '10px 12px', marginBottom: 14 }}>
            <AlertTriangle size={19} color="var(--brand,#e07b0c)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.4, color: 'var(--text-2,#475569)' }}>
              <b style={{ display: 'block', color: 'var(--text-1)', fontSize: 12.5 }}>{tc('gprod.notTracked', 'Margin not tracked on {n} products').replace('{n}', ut.length)}</b>
              {ut.map(u => `${u.label} ${compactR(u.sales)}`).join(' · ')} — {tc('gprod.noRate', 'no delivery rate on file, booking ₹0 margin.')}
            </div>
            <button onClick={() => router.push('/deliveries')} style={{ whiteSpace: 'nowrap', background: 'var(--brand,#e07b0c)', color: '#fff', border: 0, borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
              {tc('gprod.enterRate', 'Enter delivery rate →')}
            </button>
          </div>
        )}

        {/* by product: donut + legend */}
        <SecLabel>{tc('gprod.byProduct', 'By product')}</SecLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '104px 1fr', gap: 16, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ position: 'relative', width: 104, height: 104 }}>
            <svg viewBox="0 0 116 116" style={{ width: 104, height: 104, transform: 'rotate(-90deg)' }}>
              {products.map(k => {
                const v = productTotal(period, k);
                const frac = gTotal > 0 ? v / gTotal : 0;
                const len = frac * DONUT_C, gap = len > 4 ? 1.5 : 0;
                const dash = `${Math.max(0, len - gap).toFixed(2)} ${(DONUT_C - Math.max(0, len - gap)).toFixed(2)}`;
                const off = -acc; acc += len;
                return <circle key={k} cx="58" cy="58" r="46" fill="none" stroke={meta(k).color} strokeWidth="15" strokeDasharray={dash} strokeDashoffset={off.toFixed(2)} style={{ transition: 'stroke-dasharray .8s, stroke-dashoffset .8s' }} />;
              })}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-.02em' }}>{M.compact(gTotal)}</div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)' }}>{tc('gprod.group', 'group')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {products.map(k => {
              const v = productTotal(period, k);
              const frac = gTotal > 0 ? v / gTotal : 0;
              const isUntracked = measure === 'mgn' && v === 0 && outlets.some(o => o[period][k] && o[period][k].buy == null);
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 9, alignItems: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: meta(k).color, flexShrink: 0 }} />{meta(k).label}
                  </span>
                  <span style={{ height: 6, borderRadius: 4, background: 'var(--surface-2,#eee)', overflow: 'hidden', minWidth: 30 }}>
                    <span style={{ display: 'block', height: '100%', width: `${(frac * 100).toFixed(1)}%`, background: meta(k).color, borderRadius: 4, transition: 'width .7s cubic-bezier(.22,1,.36,1)' }} />
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, textAlign: 'right', minWidth: 74 }}>
                    {isUntracked ? <em style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700 }}>{tc('gprod.untracked', 'not tracked')}</em>
                      : <>{M.compact(v)} <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700 }}>{(frac * 100).toFixed(0)}%</span></>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* by outlet stacked by product — only meaningful across multiple outlets */}
        {outlets.length > 1 && (
          <>
            <SecLabel>{tc('gprod.byOutlet', 'By outlet')} <span style={{ fontWeight: 600, color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>{tc('gprod.stacked', 'stacked by product')}</span></SecLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {outlets.map(o => {
                const ot = outletTotal(o, period);
                const scale = ot > 0 ? ot / maxOutlet : 0;
                return (
                  <div key={o.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: o.health }} />{o.short}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 800 }}>{M.compact(ot)} <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)' }}>{gTotal > 0 ? (ot / gTotal * 100).toFixed(0) : 0}%</span></span>
                    </div>
                    <div style={{ height: 18, borderRadius: 6, background: 'var(--surface-2,#eee)', display: 'flex', gap: 2, overflow: 'hidden' }}>
                      {Object.keys(o[period]).sort((a, b) => meta(a).order - meta(b).order).map(k => {
                        const v = val(o[period][k], measure);
                        const w = ot > 0 ? (v / ot) * scale * 100 : 0;
                        return <div key={k} title={`${o.short} · ${meta(k).label}: ${M.fmt(v)}`} style={{ width: `${w.toFixed(2)}%`, background: meta(k).color, transition: 'width .7s cubic-bezier(.22,1,.36,1)' }} />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── margin variance (MTD, tracked products) ──
  const varianceProducts = ['diesel', 'petrol'].filter(k => outlets.some(o => o.mtd[k] && o.mtd[k].buy != null));
  const PRICE_MAX = 132;
  const utMtd = untracked('mtd');

  return (
    <div className="gpt">
      <style>{`
        .gpt-tiles{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
        @media(max-width:820px){.gpt-tiles{grid-template-columns:1fr}}
        .gpt-varGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:720px){.gpt-varGrid{grid-template-columns:1fr}}
        .gpt-toggle button:focus-visible{outline:2px solid var(--brand,#e07b0c);outline-offset:2px}
        @media(max-width:460px){.gpt-datagap{flex-wrap:wrap}.gpt-datagap>button{width:100%}}
      `}</style>

      {/* measure toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-2,#475569)' }}>{outlets.length > 1 ? tc('gprod.heading', 'Sales by outlet & product') : tc('gprod.headingOne', 'Sales by product')}</div>
        <div className="gpt-toggle" style={{ display: 'inline-flex', background: 'var(--surface-2,#f8fafc)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 10, padding: 3, gap: 2 }}>
          {Object.keys(MEASURES).map(m => (
            <button key={m} onClick={() => setMeasure(m)} aria-pressed={measure === m} style={{
              border: 0, background: measure === m ? 'var(--brand,#e07b0c)' : 'transparent', color: measure === m ? '#fff' : 'var(--text-2,#475569)',
              fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
            }}>{tc('gprod.m_' + m, MEASURES[m].label)}</button>
          ))}
        </div>
      </div>

      <div className="gpt-tiles">
        <Tile period="day" eyebrow={tc('gprod.day', 'Day · last shift close')} name={asOfDate ? new Date(asOfDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }) : tc('gprod.day', 'Day')} stamp={`${tc('gprod.settled', 'Settled')}${asOfUniform === false ? ' · ' + tc('gprod.perBunk', 'latest per bunk') : ''}`} accent="#e07b0c" />
        <Tile period="mtd" eyebrow={tc('gprod.mtd', 'Month to date · through close')} name={tc('gprod.thisMonth', 'This month')} stamp={asOfDate ? `${tc('gprod.through', 'Through')} ${new Date(asOfDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}` : ''} accent="#2a78d6" />
      </div>

      {/* margin variance — needs at least two outlets to compare */}
      {outlets.length > 1 && varianceProducts.length > 0 && (
        <div style={{ background: surface, border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 16, padding: '18px 18px 16px', position: 'relative', overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,#008300,#2a78d6)' }} />
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em' }}>{tc('gprod.varTitle', 'Why margins differ — same product, different outlet')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '3px 0 16px' }}>{tc('gprod.varSub', 'Margin/L = pump price − delivery rate. Grey = cost; coloured = what you keep. Month-to-date.')}</div>
          <div className="gpt-varGrid">
            {varianceProducts.map(sku => {
              const rows = outlets.map(o => { const r = o.mtd[sku]; return r && r.buy != null ? { short: o.short, health: o.health, sell: r.sell, buy: r.buy, mgn: r.sell - r.buy } : null; }).filter(Boolean).sort((a, b) => b.mgn - a.mgn);
              if (!rows.length) return null;
              const best = rows[0], worst = rows[rows.length - 1];
              const spread = best.mgn - worst.mgn, sellGap = best.sell - worst.sell, buyGap = best.buy - worst.buy;
              const driver = Math.abs(sellGap) >= Math.abs(buyGap)
                ? tc('gprod.driverSell', '{b} sells ₹{sg}/L higher than {w} (₹{bs} vs ₹{ws}) — the gap is pump-price led, not cheaper buying (buy differs only ₹{bg}/L).')
                : tc('gprod.driverBuy', '{b} buys ₹{bg}/L cheaper than {w} — a purchase-cost advantage.');
              const takeaway = driver.replace('{b}', best.short).replace('{w}', worst.short).replace('{sg}', Math.abs(sellGap).toFixed(2)).replace('{bs}', best.sell.toFixed(2)).replace('{ws}', worst.sell.toFixed(2)).replace('{bg}', Math.abs(buyGap).toFixed(2));
              return (
                <div key={sku} style={{ border: '1px solid var(--border,#e5e7eb)', borderRadius: 12, padding: '14px 14px 12px', background: 'var(--surface-2,#f8fafc)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 4, background: meta(sku).color }} />
                    <span style={{ fontSize: 14, fontWeight: 800 }}>{meta(sku).label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--text-2,#475569)', background: surface, border: '1px solid var(--border,#e5e7eb)', padding: '3px 8px', borderRadius: 99 }}>{tc('gprod.spread', 'spread')} ₹{spread.toFixed(2)}/L</span>
                  </div>
                  {rows.map(r => (
                    <div key={r.short} style={{ marginBottom: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.health }} />{r.short}
                          {r === best && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 99, background: '#e7f3dc', color: '#2f7d18' }}>{tc('gprod.best', 'best')}</span>}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: r === best ? '#2f7d18' : 'var(--text-1)' }}>₹{r.mgn.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700 }}>/L</span></span>
                      </div>
                      <div style={{ height: 15, borderRadius: 5, background: 'var(--surface-2,#eee)', display: 'flex', overflow: 'hidden', border: '0.5px solid var(--border,#e5e7eb)' }}>
                        <div style={{ width: `${(r.buy / PRICE_MAX * 100).toFixed(2)}%`, background: 'rgba(120,120,120,.3)' }} />
                        <div style={{ width: `${((r.sell - r.buy) / PRICE_MAX * 100).toFixed(2)}%`, background: meta(sku).color }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', fontWeight: 700, marginTop: 3 }}>
                        <span>{tc('gprod.buy', 'buy')} ₹{r.buy.toFixed(2)}</span><span>{tc('gprod.sell', 'sell')} ₹{r.sell.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-2,#475569)', background: surface, border: '1px solid var(--border,#e5e7eb)', borderLeft: '3px solid var(--brand,#e07b0c)', borderRadius: 8, padding: '8px 10px' }}>{takeaway}</div>
                </div>
              );
            })}
          </div>
          {utMtd.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-3)', display: 'flex', gap: 7, alignItems: 'flex-start', lineHeight: 1.5 }}>
              <AlertTriangle size={14} color="var(--brand,#e07b0c)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{tc('gprod.varUntracked', '{list} are missing here — no delivery rate on file, so their margin can\'t be computed. The blended % already excludes them; enter their delivery rates to bring them into the margin picture.').replace('{list}', utMtd.map(u => u.label).join(' & '))}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecLabel({ children }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 11px', display: 'flex', alignItems: 'center', gap: 8 }}>
      {children}<span style={{ flex: 1, height: 1, background: 'var(--border,#eee)' }} />
    </div>
  );
}
