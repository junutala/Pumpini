'use client';
// Manager bunk cockpit. Reused by the owner's Operational dashboard per outlet
// (pass stationId + embedded). Blind-drop: today's money is the REVEALED portion
// (the feed masks open-shift sales for non-owners); a chip flags sealed live shifts.
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Fuel, Lock, Bell, AlertTriangle, CheckCircle, Landmark, FileText,
  Droplets, ArrowRight, Sparkles, Clock, ChevronRight, Flame } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getOwnerDashboard } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../../hooks/useSocket';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmtR = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtL = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const cap  = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lvlColor = pct => (pct < 20 ? '#dc2626' : pct < 40 ? '#d97706' : '#16a34a');
// Days-of-cover urgency: <2d red, <4d amber, else green.
const dayColor = d => (d == null ? '#64748b' : d < 2 ? '#dc2626' : d < 4 ? '#d97706' : '#16a34a');
// Litres-by-fuel swatch: petrol→green, diesel→amber, CNG→blue, premium→red; else grey.
const FUEL_COLORS = { petrol: '#16a34a', diesel: '#d97706', cng: '#2563eb', power: '#dc2626', premium: '#dc2626' };
const fuelColor = ft => { const k = (ft || '').toLowerCase(); return FUEL_COLORS[Object.keys(FUEL_COLORS).find(c => k.includes(c))] || '#64748b'; };
const card = { background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14 };
const mini = { background: 'var(--surface-2,#f8fafc)', borderRadius: 10, padding: '12px 14px' };

export default function DashboardPage({ stationId: stationIdProp, embedded = false } = {}) {
  const router = useRouter();
  const { user, station, loading: authLoading } = useAuth();
  const stationId = stationIdProp || (typeof station === 'object' ? station?.id : station);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const Wrapper = embedded ? Fragment : AppShell;

  const [data, setData]       = useState(null);
  const [deposit, setDeposit] = useState(null);
  const [loading, setLoading] = useState(true);
  const { on } = useSocket(stationId, null);
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      const [d, dp] = await Promise.all([
        getOwnerDashboard(stationId, today),
        api.get('/cash-deposits', { params: { station_id: stationId } }).then(r => r?.status || null).catch(() => null),
      ]);
      setData(d); setDeposit(dp || null);
    } catch (e) { console.error('Dashboard load error:', e); }
    finally { setLoading(false); }
  }, [stationId, today]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => on('dispense:new', () => load()), [on, load]);
  useRefreshOnFocus(load);

  // Don't flash "No station" while auth is still restoring the session (e.g. just
  // after a biometric login) — wait for it to resolve first.
  if (authLoading && !stationIdProp) return <Wrapper><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{tc('bunk.loading', 'Loading…')}</div></Wrapper>;
  if (!stationId) return <Wrapper><div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>{tc('bunk.noStation', 'No station assigned. Contact your administrator.')}</div></Wrapper>;
  if (loading)    return <Wrapper><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{tc('bunk.loading', 'Loading…')}</div></Wrapper>;

  const d = data || {};
  const sales = d.sales || [];
  const totalSales = sales.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const totalLtrs  = sales.reduce((s, r) => s + parseFloat(r.total_ltrs || 0), 0);
  // Litres split by fuel type (sales rows are grouped by fuel_type + payment_mode).
  const ltrsByFuel = {};
  sales.forEach(r => { const ft = r.fuel_type || tc('bunk.otherFuel', 'Other'); ltrsByFuel[ft] = (ltrsByFuel[ft] || 0) + parseFloat(r.total_ltrs || 0); });
  const fuelLtrs = Object.entries(ltrsByFuel).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const isOwnerView = user?.role === 'owner';   // margin is owner-only
  const salesMasked = !!d.sales_masked;
  const shifts = d.shifts || [];
  const openShifts = shifts.filter(s => s.status === 'open');
  const closedShifts = shifts.filter(s => s.status === 'closed');
  const margin = d.margin;
  const cover = d.cover || [];
  const recv = d.receivables || { to_invoice: 0, outstanding: 0, overdue_90: 0 };
  const settlements = d.settlements || [];   // all operators settled today
  const setTot = settlements.reduce((t, s) => ({
    cash: t.cash + Number(s.cash_actual || 0), upi: t.upi + Number(s.upi_total || 0),
    card: t.card + Number(s.card_total || 0), credit: t.credit + Number(s.credit_total || 0),
    petty: t.petty + Number(s.petty_cash || 0), total: t.total + Number(s.total_sales || 0),
  }), { cash: 0, upi: 0, card: 0, credit: 0, petty: 0, total: 0 });
  const wet = d.wetstock_mtd;
  const brief = d.ai_briefing || [];
  const unread = (d.alerts || []).filter(a => !a.acknowledged_at);

  const cashAwaiting   = Number(deposit?.awaiting || 0);
  const depositAge     = Number(deposit?.age_days || 0);
  const creditToInvoice = Number(recv.to_invoice || 0);
  const lowTank = cover.filter(c => c.days != null && c.days < 2).sort((a, b) => a.days - b.days)[0];

  const PAY = { cash: '#16a34a', upi: '#2563eb', card: '#ea580c', credit: '#9333ea' };
  const payTotals = ['cash', 'upi', 'card', 'credit'].map(m => ({ m, v: sales.filter(r => r.payment_mode === m).reduce((s, r) => s + parseFloat(r.total_amount || 0), 0) }));
  const payTotal = payTotals.reduce((s, p) => s + p.v, 0);

  const actions = [];
  if (cashAwaiting > 0) actions.push({ k: 'cash', Icon: Landmark, bg: '#fee2e2', fg: '#991b1b', label: tc('bunk.cashToDeposit', 'Cash to deposit'), value: fmtR(cashAwaiting), sub: depositAge > 0 ? tc('bunk.oldestDaysBankingDue', 'oldest {n} day{s} · banking due').replace('{n}', depositAge).replace('{s}', depositAge > 1 ? 's' : '') : tc('bunk.bankingDue', 'banking due'), subColor: 'var(--danger,#dc2626)', cta: tc('bunk.recordDeposit', 'Record deposit'), href: '/deposits' });
  if (creditToInvoice > 0) actions.push({ k: 'credit', Icon: FileText, bg: '#ede9fe', fg: '#5b21b6', label: tc('bunk.creditToInvoice', 'Credit to invoice'), value: fmtR(creditToInvoice), sub: tc('bunk.bookedAtShiftClose', 'booked at shift close'), subColor: 'var(--text-3)', cta: tc('bunk.raiseInvoices', 'Raise invoices'), href: '/invoices' });
  if (lowTank) actions.push({ k: 'tank', Icon: Droplets, bg: '#fef3c7', fg: '#92400e', label: tc('bunk.fuelRunningLow', '{fuel} running low').replace('{fuel}', cap(lowTank.fuel_type)), value: `${lowTank.fill_pct ?? '—'}% · ~${lowTank.days}d`, sub: tc('bunk.tankReorderWindow', 'tank {n} · reorder window').replace('{n}', lowTank.tank_number), subColor: 'var(--warning,#d97706)', cta: tc('bunk.planOrder', 'Plan order'), href: '/deliveries' });
  if (wet?.beyond_tolerance) actions.push({ k: 'wet', Icon: AlertTriangle, bg: '#fee2e2', fg: '#991b1b', label: tc('bunk.wetStockVariance', 'Wet-stock variance'), value: `${fmtL(wet.variance_ltrs)} L`, sub: tc('bunk.beyondToleranceMonth', 'beyond tolerance this month'), subColor: 'var(--danger,#dc2626)', cta: tc('bunk.reconcile', 'Reconcile'), href: '/stock-reco' });

  const needCount = actions.length + unread.length;
  const aiLines = brief.length ? brief : [tc('bunk.aiNothingFlagged', 'Nothing flagged — running clean.')];

  return (
    <Wrapper>
      {/* Hero */}
      <div style={{ background: '#23272e', borderRadius: 14, padding: '16px 18px', color: '#f1efe8', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Fuel size={19} color="#fac775" />
              <span style={{ fontSize: 17, fontWeight: 700 }}>{tc('bunk.bunkCockpit', 'Bunk cockpit')}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#b4b2a9', marginTop: 3 }}>{new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {closedShifts.length > 0 && <span style={{ fontSize: 12, background: '#173404', color: '#c0dd97', padding: '3px 10px', borderRadius: 99 }}><CheckCircle size={12} style={{ verticalAlign: -2 }} /> {tc('bunk.nClosed', '{n} closed').replace('{n}', closedShifts.length)}</span>}
              {openShifts.length > 0 && <span style={{ fontSize: 12, background: '#444441', color: '#d3d1c7', padding: '3px 10px', borderRadius: 99 }}>{salesMasked ? <><Lock size={12} style={{ verticalAlign: -2 }} /> {tc('bunk.nLiveSealed', '{n} live · sealed').replace('{n}', openShifts.length)}</> : <>{tc('bunk.nLive', '{n} live').replace('{n}', openShifts.length)}</>}</span>}
              {shifts.length === 0 && <span style={{ fontSize: 12, background: '#444441', color: '#d3d1c7', padding: '3px 10px', borderRadius: 99 }}>{tc('bunk.noShiftOpen', 'no shift open')}</span>}
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 99, whiteSpace: 'nowrap', background: needCount ? '#633806' : '#173404', color: needCount ? '#fac775' : '#c0dd97' }}>
            {needCount ? <><Bell size={13} style={{ verticalAlign: -2 }} /> {tc('bunk.nNeedYou', '{n} need you').replace('{n}', needCount)}</> : <><CheckCircle size={13} style={{ verticalAlign: -2 }} /> {tc('bunk.allClear', 'all clear')}</>}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #5f5e5a' }}>
          <Sparkles size={15} color="#afa9ec" style={{ marginTop: 2, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: '#d3d1c7', lineHeight: 1.5 }}>{aiLines.slice(0, 2).join(' ')}</span>
        </div>
      </div>

      {/* Needs you */}
      {actions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{tc('bunk.needsYou', 'Needs you')}</div>
          <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
            {actions.map(a => (
              <div key={a.k} style={{ ...card, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: a.bg, color: a.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><a.Icon size={17} /></span>
                  <span style={{ fontSize: 13, color: 'var(--text-2,#475569)' }}>{a.label}</span>
                </div>
                <div style={{ fontSize: 21, fontWeight: 800 }}>{a.value}</div>
                <div style={{ fontSize: 12, color: a.subColor, margin: '2px 0 10px' }}>{a.sub}</div>
                <button onClick={() => router.push(a.href)} style={{ width: '100%', height: 38, background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{a.cta} <ArrowRight size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's money */}
      <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{tc('bunk.todaysMoney', "Today's money")}</span>
          {salesMasked && openShifts.length > 0 && <span style={{ fontSize: 12, background: 'var(--surface-2,#f1f5f9)', color: 'var(--text-2,#475569)', padding: '4px 10px', borderRadius: 99 }}><Lock size={12} style={{ verticalAlign: -2 }} /> {tc('bunk.liveShiftsSealedReveals', '{n} live shift sealed — reveals at close').replace('{n}', openShifts.length)}</span>}
        </div>
        <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: payTotal > 0 ? 12 : 0 }}>
          <div style={mini}><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('bunk.sales', 'Sales')}{salesMasked && closedShifts.length ? tc('bunk.closedSuffix', ' (closed)') : ''}</div><div style={{ fontSize: 21, fontWeight: 800 }}>{fmtR(totalSales)}</div></div>
          {isOwnerView && <div style={{ ...mini, background: '#eaf3de' }}><div style={{ fontSize: 12, color: '#3b6d11' }}>{tc('bunk.margin', 'Margin')}</div><div style={{ fontSize: 21, fontWeight: 800, color: '#27500a' }}>{margin?.amount != null ? fmtR(margin.amount) : '—'}</div>{margin?.pct != null && <div style={{ fontSize: 12, color: '#3b6d11' }}>{tc('bunk.pctSellMinusBuy', '{n}% · sell − buy').replace('{n}', margin.pct)}</div>}</div>}
          <div style={mini}>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('bunk.litres', 'Litres')}</div>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{fmtL(totalLtrs)} L</div>
            {fuelLtrs.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {fuelLtrs.map(([ft, v]) => (
                  <div key={ft} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-2,#475569)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: fuelColor(ft), flexShrink: 0 }} />{cap(ft)}</span>
                    <span style={{ fontWeight: 700 }}>{fmtL(v)} L</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {payTotal > 0 && <>
          <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden' }}>
            {payTotals.filter(p => p.v > 0).map(p => <div key={p.m} style={{ width: `${(p.v / payTotal) * 100}%`, background: PAY[p.m] }} />)}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2,#475569)' }}>
            {payTotals.filter(p => p.v > 0).map(p => <span key={p.m}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PAY[p.m] }} /> {cap(p.m)} {Math.round((p.v / payTotal) * 100)}%</span>)}
          </div>
        </>}
      </div>

      {/* Latest shift settlement — every operator of the most recently closed shift */}
      {settlements.length > 0 && (
        <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {tc('bunk.latestShiftSettlement', 'Latest shift settlement')}{settlements[0]?.shift_number ? tc('bunk.shiftNumberSuffix', ' — Shift {n}').replace('{n}', settlements[0].shift_number) : ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('bunk.operatorsClosed', '{n} operator{s} closed').replace('{n}', settlements.length).replace('{s}', settlements.length > 1 ? 's' : '')}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 540 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.operator', 'Operator')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.cash', 'Cash')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.upi', 'UPI')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.card', 'Card')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.credit', 'Credit')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.petty', 'Petty')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.total', 'Total')}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.variance', 'Variance')}</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s, i) => {
                  const v = Number(s.variance || 0);
                  return (
                    <tr key={i} style={{ borderTop: '0.5px solid var(--border,#e5e7eb)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: 8 }}><strong>{s.attendant_name}</strong>{s.shift_number != null && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · S{s.shift_number}</span>}</td>
                      <td style={{ padding: 8 }}>{fmtR(s.cash_actual)}</td>
                      <td style={{ padding: 8 }}>{fmtR(s.upi_total)}</td>
                      <td style={{ padding: 8 }}>{fmtR(s.card_total)}</td>
                      <td style={{ padding: 8 }}>{fmtR(s.credit_total)}</td>
                      <td style={{ padding: 8 }}>{fmtR(s.petty_cash)}</td>
                      <td style={{ padding: 8, fontWeight: 700 }}>{fmtR(s.total_sales)}</td>
                      <td style={{ padding: 8, fontWeight: 700, color: Math.abs(v) <= 50 ? '#27500a' : '#a32d2d' }}>{v >= 0 ? '+' : ''}{fmtR(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {settlements.length > 1 && (
                <tfoot>
                  <tr style={{ borderTop: '1.5px solid var(--border,#e5e7eb)', textAlign: 'right', fontWeight: 700 }}>
                    <td style={{ textAlign: 'left', padding: 8 }}>{tc('bunk.total', 'Total')}</td>
                    <td style={{ padding: 8 }}>{fmtR(setTot.cash)}</td>
                    <td style={{ padding: 8 }}>{fmtR(setTot.upi)}</td>
                    <td style={{ padding: 8 }}>{fmtR(setTot.card)}</td>
                    <td style={{ padding: 8 }}>{fmtR(setTot.credit)}</td>
                    <td style={{ padding: 8 }}>{fmtR(setTot.petty)}</td>
                    <td style={{ padding: 8 }}>{fmtR(setTot.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Credit receivables */}
      <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{tc('bunk.creditReceivables', 'Credit receivables')}</div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120, ...mini, background: '#ede9fe' }}><div style={{ fontSize: 12, color: '#5b21b6' }}>{tc('bunk.toInvoice', 'To invoice')}</div><div style={{ fontSize: 18, fontWeight: 800, color: '#4c1d95' }}>{fmtR(recv.to_invoice)}</div></div>
          <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)' }}><ArrowRight size={16} /></div>
          <div style={{ flex: 1, minWidth: 120, ...mini }}><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('bunk.outstanding', 'Outstanding')}</div><div style={{ fontSize: 18, fontWeight: 800 }}>{fmtR(recv.outstanding)}</div></div>
          <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)' }}><ArrowRight size={16} /></div>
          <div style={{ flex: 1, minWidth: 120, ...mini, background: recv.overdue_90 > 0 ? '#fee2e2' : 'var(--surface-2,#f8fafc)' }}><div style={{ fontSize: 12, color: recv.overdue_90 > 0 ? '#991b1b' : 'var(--text-3)' }}>{tc('bunk.overdue90', 'Overdue 90+')}</div><div style={{ fontSize: 18, fontWeight: 800, color: recv.overdue_90 > 0 ? '#7f1d1d' : 'inherit' }}>{fmtR(recv.overdue_90)}</div></div>
        </div>
      </div>

      {/* Fuel health */}
      <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{tc('bunk.fuelHealth', 'Fuel health')}</span>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{tc('bunk.daysOfCoverHint', 'Days of cover · based on last 7 days’ sale')}</div>
          </div>
          {wet && <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, background: wet.beyond_tolerance ? '#fee2e2' : '#eaf3de', color: wet.beyond_tolerance ? '#991b1b' : '#27500a' }}>{wet.beyond_tolerance ? <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> : <CheckCircle size={12} style={{ verticalAlign: -2 }} />} {tc('bunk.stockVarianceMtd', 'Stock variance MTD {n} L').replace('{n}', fmtL(wet.variance_ltrs))}{wet.beyond_tolerance ? tc('bunk.overTolerance', ' · over tolerance') : tc('bunk.withinTolerance', ' · within tolerance')}</span>}
        </div>
        {cover.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{tc('bunk.noTanksConfigured', 'No tanks configured.')}</div> : (
          <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(125px,1fr))', gap: 12 }}>
            {cover.map(t => {
              const isGas = (t.fuel_type || '').toLowerCase() === 'cng';
              const pct = Number(t.fill_pct || 0);
              const hasDays = t.days != null;
              // Bar + headline colour by days-of-cover urgency (falls back to fill level
              // when there's no cover figure, e.g. a tank with no recent sales).
              const col = isGas ? '#94a3b8' : (hasDays ? dayColor(t.days) : lvlColor(pct));
              return (
                <div key={t.tank_number} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  {isGas
                    ? <div style={{ width: 32, height: 60, border: '1.5px solid #94a3b8', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Flame size={18} color="#94a3b8" /></div>
                    : <div style={{ width: 32, height: 60, border: `1.5px solid ${col}`, borderRadius: 5, position: 'relative', overflow: 'hidden', flexShrink: 0 }}><div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${Math.min(100, pct)}%`, background: col }} /></div>}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{tc('bunk.tankN', 'Tank {n}').replace('{n}', t.tank_number)} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{t.fuel_type}</span></div>
                    {isGas
                      ? <><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-3)' }}>{tc('bunk.byKg', 'by kg')}</div><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{tc('bunk.gasNoDip', 'gas · no dip')}</div></>
                      : <><div style={{ fontSize: 18, fontWeight: 800, color: col }}>{hasDays ? tc('bunk.daysCover', '~{n} days').replace('{n}', t.days) : '—'}</div><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{tc('bunk.pctFull', '{n}% full').replace('{n}', pct)}{hasDays ? '' : tc('bunk.noRecentSale', ' · no recent sale')}</div></>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI briefing */}
      <div style={{ background: '#ede9fe', borderRadius: 14, padding: '14px 16px', marginBottom: embedded ? 0 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Sparkles size={18} color="#5b21b6" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#4c1d95' }}>{tc('bunk.aiBriefing', 'AI briefing')}</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#3b0764', lineHeight: 1.7 }}>
          {aiLines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>
    </Wrapper>
  );
}
