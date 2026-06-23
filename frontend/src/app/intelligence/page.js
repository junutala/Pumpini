'use client';
// Owner INTELLIGENCE dashboard — the decision layer. Managers' Balanced Scorecard
// (outlet vs outlet), the credit-as-liability IRR simulator, money-on-the-table,
// and AI recommendations. Fed by the enriched /groups/:id/dashboard rollup.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Brain, LayoutDashboard, Calculator, Sparkles, AlertTriangle, CheckCircle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmtR = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtL = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const card = { background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14 };
const mini = { background: 'var(--surface-2,#f8fafc)', borderRadius: 10, padding: '12px 14px' };

export default function IntelligencePage() {
  const router = useRouter();
  const [groups, setGroups]   = useState([]);
  const [group, setGroup]     = useState(null);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [irr, setIrr]         = useState(12);
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const loadGroup = async (id) => {
    setLoading(true);
    try { setData(await api.get(`/groups/${id}/dashboard`)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  const loadGroups = useCallback(() => api.get('/groups/my').then(g => {
    setGroups(g); if (g.length >= 1) { setGroup(g[0]); loadGroup(g[0].id); }
  }), []);
  useEffect(() => { loadGroups(); }, [loadGroups]);
  useRefreshOnFocus(() => { if (group) loadGroup(group.id); });

  const st = data?.stations || [];

  // Scorecard colouring: pick best/worst per column.
  const ext = (key, lowerBetter) => {
    const vals = st.map(s => s[key]).filter(v => v != null);
    if (!vals.length) return {};
    const best = lowerBetter ? Math.min(...vals) : Math.max(...vals);
    const worst = lowerBetter ? Math.max(...vals) : Math.min(...vals);
    return { best, worst };
  };
  const cols = {
    credit_pct:        { ...ext('credit_pct', true),        lower: true },
    gross_margin_pct:  { ...ext('gross_margin_pct', false), lower: false },
    overdue_pct:       { ...ext('overdue_pct', true),       lower: true },
    wetstock_loss_pct: { ...ext('wetstock_loss_pct', true), lower: true },
  };
  const cellColor = (key, v) => {
    if (v == null || st.length < 2) return 'inherit';
    const c = cols[key];
    if (v === c.best) return '#27500a';
    if (v === c.worst) return '#a32d2d';
    return 'inherit';
  };

  // Credit-liability simulator (live on the IRR slider).
  const r = irr / 100;
  const sim = st.map(s => {
    const m = s.margin_frac, lag = s.collection_lag_days;
    if (m == null || m <= 0 || lag == null) return { ...s, na: true };
    const breakeven = (m / (1 - m)) * (365 / r);
    return { ...s, breakeven: Math.round(breakeven), underwater: lag > breakeven };
  });
  const underwater = sim.filter(s => s.underwater);
  const atRisk = underwater.reduce((a, s) => a + (s.outstanding || 0), 0);

  // Money on the table.
  const overdueTotal = st.reduce((a, s) => a + (s.overdue_90 || 0), 0);
  const idleCash = st.reduce((a, s) => a + (s.cash_undeposited || 0), 0);
  const shrinkLtrs = st.reduce((a, s) => a + Math.abs(s.wetstock_loss_ltrs || 0), 0);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('intel.pageTitle', 'Intelligence')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('intel.pageSubtitle', 'Decisions, not numbers')}</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => router.push('/group-dashboard')}><LayoutDashboard size={14} /> {tc('intel.operations', 'Operations')}</button>
      </div>

      {groups.length === 0 && <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>{tc('intel.noOwnerGroup', 'No owner group yet.')}</div>}
      {loading && <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>{tc('intel.loading', 'Loading…')}</div>}

      {data && !loading && st.length > 0 && (<>
        <div style={{ background: '#23272e', borderRadius: 14, padding: '16px 18px', color: '#f1efe8', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Brain size={19} color="#afa9ec" /><span style={{ fontSize: 17, fontWeight: 700 }}>{tc('intel.bunkIntelligence', '{n}-bunk intelligence').replace('{n}', st.length)}</span></div>
          <div style={{ fontSize: 12.5, color: '#b4b2a9', marginTop: 3 }}>{tc('intel.compareSimulateDecide', 'Compare, simulate, decide')}</div>
        </div>

        {/* Managers' balanced scorecard */}
        <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{tc('intel.scorecardTitle', "Managers' balanced scorecard")}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>{tc('intel.scorecardHint', 'Lower is better for credit %, overdue %, loss %. Higher is better for margin. Green = best, red = worst.')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 440 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{tc('intel.colOutlet', 'Outlet')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('intel.colCreditPct', 'Credit % of sales')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('intel.colGrossMargin', 'Gross margin')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('intel.colOverduePct', 'Overdue %')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('intel.colStockLoss', 'Stock loss')}</th>
                </tr>
              </thead>
              <tbody>
                {st.map(s => (
                  <tr key={s.id} style={{ borderTop: '0.5px solid var(--border,#e5e7eb)', textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: 8, fontWeight: 700 }}>{s.name}</td>
                    <td style={{ padding: 8, color: cellColor('credit_pct', s.credit_pct) }}>{s.credit_pct ?? '—'}%</td>
                    <td style={{ padding: 8, color: cellColor('gross_margin_pct', s.gross_margin_pct) }}>{s.gross_margin_pct != null ? s.gross_margin_pct + '%' : '—'}</td>
                    <td style={{ padding: 8, color: cellColor('overdue_pct', s.overdue_pct) }}>{s.overdue_pct ?? '—'}%</td>
                    <td style={{ padding: 8, color: cellColor('wetstock_loss_pct', s.wetstock_loss_pct) }}>{s.wetstock_loss_pct ?? '—'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Credit-liability simulator */}
        <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><Calculator size={18} color="#5b21b6" /><span style={{ fontSize: 14, fontWeight: 700 }}>{tc('intel.creditLiabilityTitle', 'When does credit become a liability?')}</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>{tc('intel.creditLiabilityHint', 'Break-even days = (margin ÷ (1−margin)) × (365 ÷ cost of capital). Past it, the locked procurement cash costs more than the sale earns.')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-2,#475569)', whiteSpace: 'nowrap' }}>{tc('intel.costOfCapital', 'Cost of capital')}</span>
            <input type="range" min="5" max="30" step="1" value={irr} onChange={e => setIrr(+e.target.value)} style={{ flex: 1 }} />
            <span style={{ fontSize: 15, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>{irr}%</span>
          </div>
          <div style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10, margin: '10px 0 14px', background: underwater.length ? '#fee2e2' : '#eaf3de', color: underwater.length ? '#991b1b' : '#27500a' }}>
            {underwater.length
              ? <><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {tc('intel.underwaterAlert', 'At {irr}% cost of capital, {n} {outlets} underwater — {amt} of credit is destroying value.').replace('{irr}', irr).replace('{n}', underwater.length).replace('{outlets}', underwater.length > 1 ? tc('intel.outletsPlural', 'outlets') : tc('intel.outletSingular', 'outlet')).replace('{amt}', fmtR(atRisk))}</>
              : <><CheckCircle size={14} style={{ verticalAlign: -2 }} /> {tc('intel.healthyAlert', "At {irr}% cost of capital, every outlet's credit terms still earn their keep.").replace('{irr}', irr)}</>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sim.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, background: s.underwater ? '#fee2e2' : 'var(--surface-2,#f8fafc)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, minWidth: 84 }}>{s.name}</span>
                {s.na
                  ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('intel.noCreditMarginData', 'no credit / margin data yet')}</span>
                  : <>
                    <span style={{ fontSize: 12, color: 'var(--text-2,#475569)' }}>{tc('intel.marginCollects', 'margin {m}% · collects {d}d').replace('{m}', (s.margin_frac * 100).toFixed(1)).replace('{d}', s.collection_lag_days)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2,#475569)' }}>{tc('intel.breakEvenDays', 'break-even {d}d').replace('{d}', s.breakeven)}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: s.underwater ? '#a32d2d' : '#eaf3de', color: s.underwater ? '#fff' : '#27500a' }}>{s.underwater ? tc('intel.underwater', 'underwater') : tc('intel.healthy', 'healthy')}</span>
                  </>}
              </div>
            ))}
          </div>
        </div>

        {/* Money on the table */}
        <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{tc('intel.moneyOnTable', 'Money on the table')}</div>
          <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
            <div style={mini}><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('intel.overdueCreditStuck', 'Overdue credit (stuck)')}</div><div style={{ fontSize: 19, fontWeight: 800, color: overdueTotal > 0 ? '#a32d2d' : 'inherit' }}>{fmtR(overdueTotal)}</div></div>
            <div style={mini}><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('intel.idleUndepositedCash', 'Idle undeposited cash')}</div><div style={{ fontSize: 19, fontWeight: 800 }}>{fmtR(idleCash)}</div></div>
            <div style={mini}><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('intel.stockLossMtd', 'Stock loss MTD')}</div><div style={{ fontSize: 19, fontWeight: 800, color: shrinkLtrs > 0 ? '#854f0b' : 'inherit' }}>{fmtL(shrinkLtrs)} L</div></div>
          </div>
        </div>

        {/* Recommendations */}
        <div style={{ background: '#ede9fe', borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><Sparkles size={18} color="#5b21b6" /><span style={{ fontSize: 14, fontWeight: 700, color: '#4c1d95' }}>{tc('intel.whatIdDo', "What I'd do")}</span></div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#3b0764', lineHeight: 1.7 }}>
            {underwater.length > 0 && <li>{tc('intel.recUnderwater', 'At {irr}% cost of capital, {names} {verb} value-destroying on credit — tighten terms or reprice.').replace('{irr}', irr).replace('{names}', underwater.map(s => s.name).join(', ')).replace('{verb}', underwater.length > 1 ? tc('intel.are', 'are') : tc('intel.is', 'is'))}</li>}
            {overdueTotal > 0 && <li>{tc('intel.recOverdue', '{amt} is stuck past 90 days — chase the oldest accounts first.').replace('{amt}', fmtR(overdueTotal))}</li>}
            {st.some(s => s.wetstock_beyond) && <li>{tc('intel.recWetstock', '{names} {verb} over wet-stock tolerance — surprise-dip the tanks.').replace('{names}', st.filter(s => s.wetstock_beyond).map(s => s.name).join(', ')).replace('{verb}', st.filter(s => s.wetstock_beyond).length > 1 ? tc('intel.are', 'are') : tc('intel.is', 'is'))}</li>}
            {underwater.length === 0 && overdueTotal === 0 && !st.some(s => s.wetstock_beyond) && <li>{tc('intel.recHealthy', 'Nothing pressing — the book is healthy at this cost of capital.')}</li>}
          </ul>
        </div>
      </>)}
    </AppShell>
  );
}
