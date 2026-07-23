'use client';
// Manager bunk cockpit. Reused by the owner's Operational dashboard per outlet
// (pass stationId + embedded). Blind-drop: today's money is the REVEALED portion
// (the feed masks open-shift sales for non-owners); a chip flags sealed live shifts.
import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Fuel, Lock, Bell, AlertTriangle, CheckCircle, Landmark, FileText,
  Droplets, ArrowRight, Sparkles, Clock, ChevronRight, Flame } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import SoInstructionsTile from '../../components/shared/SoInstructionsTile';
import DataHealthCard from '../../components/shared/DataHealthCard';
import { getOwnerDashboard } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../../hooks/useSocket';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmtR = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtL = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtTime = t => t ? new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const fmtDay  = t => t ? new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '';
// DD MMM YYYY (house rule) for the MTD coverage-window label.
const fmtFull = t => t ? new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '';
// Per-shift tile palette: 1 morning=warm, 2 day=blue, 3 night=indigo (cycles for >3).
const SHIFT_THEME = { 1: { bg: '#fff7ed', fg: '#9a3412', bar: '#ea580c' }, 2: { bg: '#eff6ff', fg: '#1e40af', bar: '#2563eb' }, 3: { bg: '#eef2ff', fg: '#3730a3', bar: '#4f46e5' } };
const fmtDip = ts => { try { return new Date(ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }); } catch { return ''; } };
const cap  = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// CNG is sold by weight (kg); every other fuel by volume (litres).
const unitFor = ft => ((ft || '').toLowerCase() === 'cng' ? 'kg' : 'L');
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

  const [data, setData]       = useState(null);     // live cockpit — always TODAY
  const [viewData, setViewData] = useState(null);   // settlement + MTD — follows the picked trade day
  const [deposit, setDeposit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate]       = useState(today);   // settlement/MTD day picker (decoupled from live cockpit)
  const userPickedDate = useRef(false);            // stop auto-defaulting once the user drives the picker
  const initedDate     = useRef(false);
  const { on } = useSocket(stationId, null);
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  // Live cockpit (hero, Needs-you, receivables, fuel health, briefing) is ALWAYS
  // today — decoupled from the settlement/MTD day picker below, so browsing a past
  // settlement day never blanks the live nudges.
  const loadLive = useCallback(async () => {
    if (!stationId) return;
    try {
      const [d, dp] = await Promise.all([
        getOwnerDashboard(stationId, today),
        api.get('/cash-deposits', { params: { station_id: stationId } }).then(r => r?.status || null).catch(() => null),
      ]);
      setData(d); setDeposit(dp || null);
      // First load only: default the picker to the last settled trade day so the
      // settlement tile + MTD show real data instead of an empty running "today"
      // (settlement lags the live day). Never override a user-driven picker.
      if (!initedDate.current && !userPickedDate.current) {
        initedDate.current = true;
        if (d?.last_trade_date && d.last_trade_date < today) setDate(d.last_trade_date);
      }
    } catch (e) { console.error('Dashboard live load error:', e); }
    finally { setLoading(false); }
  }, [stationId, today]);

  useEffect(() => { loadLive(); }, [loadLive]);
  useEffect(() => on('dispense:new', () => loadLive()), [on, loadLive]);
  useRefreshOnFocus(loadLive);

  // Settlement + MTD follow the picked trade day. When it's today, mirror the live
  // fetch (no duplicate request); otherwise fetch that specific day's data.
  useEffect(() => {
    if (!stationId) return;
    if (date === today) { if (data) setViewData(data); return; }
    let cancelled = false;
    getOwnerDashboard(stationId, date).then(v => { if (!cancelled) setViewData(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, [stationId, date, today, data]);

  // Operators never see the dashboard — bounce them to their settlement screen
  // (covers the root '/' redirect and any direct URL, not just the login form).
  useEffect(() => { if (user?.role === 'attendant' && !embedded) router.replace('/settlement'); }, [user, embedded, router]);
  if (user?.role === 'attendant' && !embedded) return <Wrapper><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{tc('bunk.redirecting', 'Redirecting…')}</div></Wrapper>;

  // Don't flash "No station" while auth is still restoring the session (e.g. just
  // after a biometric login) — wait for it to resolve first.
  if (authLoading && !stationIdProp) return <Wrapper><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{tc('bunk.loading', 'Loading…')}</div></Wrapper>;
  if (!stationId) return <Wrapper><div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>{tc('bunk.noStation', 'No station assigned. Contact your administrator.')}</div></Wrapper>;
  if (loading)    return <Wrapper><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{tc('bunk.loading', 'Loading…')}</div></Wrapper>;

  const d = data || {};
  // Settlement + MTD read from the picked-day fetch; live cockpit reads from `d`.
  const dv = viewData || data || {};
  const sales = d.sales || [];
  const salesByShift = d.sales_by_shift;   // per-shift tiles; undefined on older backend
  const viewIsToday = date === today;      // is the settlement/MTD picker on today?
  // MTD tiles (T2): month-to-picked-date vs last month's same window. The window
  // runs from the 1st of the picked month to the picked (last settled) day — shown
  // explicitly so "MTD" is never mistaken for "up to today".
  const mtdFrom = date.slice(0, 8) + '01';
  const mtdRangeLabel = tc('bunk.mtdRange', 'From {from} to {to}').replace('{from}', fmtFull(mtdFrom)).replace('{to}', fmtFull(date));
  const mtd = dv.mtd || { current: { amount: 0, by_fuel: {} }, last_month: { amount: 0, by_fuel: {} } };
  const mtdFuels   = Object.entries(mtd.current.by_fuel || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const mtdQtyCur  = Object.values(mtd.current.by_fuel || {}).reduce((s, v) => s + v, 0);
  const mtdQtyLast = Object.values(mtd.last_month.by_fuel || {}).reduce((s, v) => s + v, 0);
  const pctDelta   = (cur, last) => (last > 0 ? ((cur - last) / last) * 100 : null);
  const deltaChip  = (cur, last) => { const dd = pctDelta(cur, last); return dd == null ? null : <span style={{ color: dd >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{dd >= 0 ? '▲' : '▼'} {Math.abs(dd).toFixed(0)}%</span>; };
  const settlementFuel = dv.settlement_fuel || [];   // per-operator fuel qty + target revenue (T3/T4)
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
  const margin = dv.margin;   // owner-only day margin, shown in the MTD amount tile — follows the picked day
  const cover = d.cover || [];
  const recv = d.receivables || { to_invoice: 0, outstanding: 0, overdue_90: 0 };
  const settlements = dv.settlements || [];   // operators settled on the picked day
  const setTot = settlements.reduce((t, s) => ({
    cash: t.cash + Number(s.cash_actual || 0), upi: t.upi + Number(s.upi_total || 0),
    card: t.card + Number(s.card_total || 0), credit: t.credit + Number(s.credit_total || 0),
    petty: t.petty + Number(s.petty_cash || 0), total: t.total + Number(s.total_sales || 0),
  }), { cash: 0, upi: 0, card: 0, credit: 0, petty: 0, total: 0 });
  // T3/T4 settlement rows: per-operator payments (settlements) + fuel qty/target (settlement_fuel).
  const fuelByOp = {};
  settlementFuel.forEach(f => { (fuelByOp[f.attendant_id] = fuelByOp[f.attendant_id] || []).push(f); });
  const settleRows = settlements.map(s => {
    const fuels = fuelByOp[s.attendant_id] || [];
    const target = fuels.reduce((a, f) => a + (f.target_revenue || 0), 0);   // Σ qty × rate
    // Accounted = every money column incl. PETTY (cash taken out of the drawer for
    // expenses still has to be accounted). Variance = accounted − target ≈ 0 when clean.
    const total = Number(s.cash_actual || 0) + Number(s.upi_total || 0) + Number(s.card_total || 0) + Number(s.credit_total || 0) + Number(s.petty_cash || 0);
    return { ...s, fuels, target, total, revVar: +(total - target).toFixed(2) };
  });
  const totQtyByFuel = {};
  settlementFuel.forEach(f => { totQtyByFuel[f.fuel_type] = (totQtyByFuel[f.fuel_type] || 0) + Number(f.litres || 0); });
  const stepDate = (n) => { userPickedDate.current = true; const dt = new Date(date + 'T00:00:00'); dt.setDate(dt.getDate() + n); const s2 = dt.toLocaleDateString('en-CA'); if (s2 <= today) setDate(s2); };
  const wetLast = d.wetstock_last;   // last closed shift's live per-tank reconciliation (dated)
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

      {/* SO Instructions — VAWE operational tasks (manager acts, owner read-only) */}
      <SoInstructionsTile stationId={stationId} />

      {/* Data health — read-only tripwire for out-of-sync data entry (dips/shifts) */}
      <DataHealthCard stationId={stationId} />

      {/* Needs you — live 'now' actions; only when viewing today */}
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

      {/* MTD tiles (T2) — month-to-date quantity (by fuel) + amount, vs last month's
          same window. Follows the viewed date. */}
      <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{tc('bunk.mtdQuantity', 'MTD quantity')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>{mtdRangeLabel}</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{fmtL(mtdQtyCur)} L</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: mtdFuels.length ? 8 : 0 }}>{tc('bunk.lastMonth', 'last month')} {fmtL(mtdQtyLast)} L {deltaChip(mtdQtyCur, mtdQtyLast)}</div>
          {mtdFuels.map(([ft, v]) => (
            <div key={ft} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-2,#475569)', marginTop: 3 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: fuelColor(ft) }} />{cap(ft)}</span>
              <span style={{ fontWeight: 700 }}>{fmtL(v)} {unitFor(ft)}</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{tc('bunk.mtdAmount', 'MTD amount')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>{mtdRangeLabel}</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{fmtR(mtd.current.amount)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('bunk.lastMonth', 'last month')} {fmtR(mtd.last_month.amount)} {deltaChip(mtd.current.amount, mtd.last_month.amount)}</div>
          {isOwnerView && margin?.amount != null && <div style={{ fontSize: 12.5, color: '#3b6d11', marginTop: 8, fontWeight: 700 }}>{tc('bunk.marginDay', 'Margin (day)')}: {fmtR(margin.amount)}{margin.pct != null ? ` · ${margin.pct}%` : ''}</div>}
        </div>
      </div>

      {/* Shift settlement (T3/T4) — date-navigable; per-operator fuel qty + target-vs-actual revenue variance */}
      <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{tc('bunk.shiftSettlement', 'Shift settlement')}
            {!viewIsToday && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)', marginLeft: 8 }}>{tc('bunk.lastSettledDay', 'last settled day')}</span>}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => stepDate(-1)} title={tc('bunk.prevDay', 'Previous day')} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border,#e5e7eb)', background: '#fff', cursor: 'pointer', fontSize: 12 }}>◀</button>
            <input type="date" value={date} max={today} onChange={e => { userPickedDate.current = true; setDate(e.target.value); }} style={{ padding: '5px 9px', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, fontSize: 12.5 }} />
            <button onClick={() => stepDate(1)} disabled={date >= today} title={tc('bunk.nextDay', 'Next day')} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border,#e5e7eb)', background: '#fff', cursor: date >= today ? 'default' : 'pointer', opacity: date >= today ? .4 : 1, fontSize: 12 }}>▶</button>
          </div>
        </div>
        {settleRows.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: '1.5rem' }}>{tc('bunk.noSettlement', 'No settled operators for this day.')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 660 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.operator', 'Operator')}</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{tc('bunk.fuelQty', 'Fuel · Qty')}</th>
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
                {settleRows.map((s, i) => (
                  <tr key={i} style={{ borderTop: '0.5px solid var(--border,#e5e7eb)', textAlign: 'right', verticalAlign: 'top' }}>
                    <td style={{ textAlign: 'left', padding: 8 }}><strong>{s.attendant_name}</strong>{s.shift_number != null && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · S{s.shift_number}</span>}</td>
                    <td style={{ textAlign: 'left', padding: 8 }}>
                      {s.fuels.length === 0 ? <span style={{ color: 'var(--text-3)' }}>—</span> : s.fuels.map((f, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: fuelColor(f.fuel_type) }} />{cap(f.fuel_type)} · {fmtL(f.litres)} {unitFor(f.fuel_type)}</div>
                      ))}
                    </td>
                    <td style={{ padding: 8 }}>{fmtR(s.cash_actual)}</td>
                    <td style={{ padding: 8 }}>{fmtR(s.upi_total)}</td>
                    <td style={{ padding: 8 }}>{fmtR(s.card_total)}</td>
                    <td style={{ padding: 8 }}>{fmtR(s.credit_total)}</td>
                    <td style={{ padding: 8 }}>{fmtR(s.petty_cash)}</td>
                    <td style={{ padding: 8, fontWeight: 700 }}>{fmtR(s.total)}<div style={{ fontSize: 10.5, color: 'var(--brand,#e07b0c)', fontWeight: 700 }}>{tc('bunk.target', 'target')} {fmtR(s.target)}</div></td>
                    <td style={{ padding: 8, fontWeight: 700, color: Math.abs(s.revVar) <= 50 ? '#27500a' : '#a32d2d' }}>{s.revVar >= 0 ? '+' : ''}{fmtR(s.revVar)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1.5px solid var(--border,#e5e7eb)', textAlign: 'right', fontWeight: 700 }}>
                  <td style={{ textAlign: 'left', padding: 8 }}>{tc('bunk.total', 'Total')}</td>
                  <td style={{ textAlign: 'left', padding: 8, fontWeight: 400, fontSize: 12 }}>{Object.entries(totQtyByFuel).filter(([, v]) => v > 0).map(([ft, v]) => <div key={ft}>{cap(ft)} · {fmtL(v)} {unitFor(ft)}</div>)}</td>
                  <td style={{ padding: 8 }}>{fmtR(setTot.cash)}</td>
                  <td style={{ padding: 8 }}>{fmtR(setTot.upi)}</td>
                  <td style={{ padding: 8 }}>{fmtR(setTot.card)}</td>
                  <td style={{ padding: 8 }}>{fmtR(setTot.credit)}</td>
                  <td style={{ padding: 8 }}>{fmtR(setTot.petty)}</td>
                  <td style={{ padding: 8 }}>{fmtR(setTot.cash + setTot.upi + setTot.card + setTot.credit + setTot.petty)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Live 'now' status (receivables · fuel health · AI briefing). These are
          current station status (not per-date), so they always render — the hero
          note already tells the viewer live status reflects today, not the past
          date being viewed. Previously gated to today, which made the tiles vanish
          on a past date and read as a broken scroll. */}
      {(<>
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
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{tc('bunk.daysOfCoverHint', 'Days of cover (7-day avg sale) · stock as of last dip')}</div>
          </div>
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
                      : <><div style={{ fontSize: 18, fontWeight: 800, color: col }}>{hasDays ? tc('bunk.daysCover', '~{n} days').replace('{n}', t.days) : '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.litres != null ? tc('bunk.stockLFull', '{l} L · {n}% full').replace('{l}', fmtL(t.litres)).replace('{n}', pct) : tc('bunk.pctFull', '{n}% full').replace('{n}', pct)}{hasDays ? '' : tc('bunk.noRecentSale', ' · no recent sale')}</div>
                          {t.as_of && <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{tc('bunk.stockAsOf', 'stock as of {d}').replace('{d}', fmtDip(t.as_of))}</div>}</>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Wet-stock reconciliation — the last reconciled day, with the full math
          spelled out so the variance is transparent (not a mystery month total). */}
      {wetLast && (
        <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{tc('bunk.wetStockReco', 'Wet-stock reconciliation')}</span>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: wetLast.beyond_tolerance ? '#fee2e2' : '#eaf3de', color: wetLast.beyond_tolerance ? '#991b1b' : '#27500a' }}>{wetLast.beyond_tolerance ? <><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {tc('bunk.overTolerance2', 'over tolerance')}</> : <><CheckCircle size={12} style={{ verticalAlign: -2 }} /> {tc('bunk.withinTolerance2', 'within tolerance')}</>}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand,#e07b0c)', marginBottom: 12 }}>{fmtFull(wetLast.date)}{wetLast.shift_number != null ? <span style={{ fontWeight: 400, color: 'var(--text-3)' }}> · {tc('bunk.shiftN', 'Shift {n}').replace('{n}', wetLast.shift_number)}</span> : ''}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {wetLast.tanks.map((t, i) => (
              <div key={i} style={{ background: t.beyond ? '#fef2f2' : 'var(--surface-2,#f8fafc)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: fuelColor(t.fuel_type) }} />{tc('bunk.tankN', 'Tank {n}').replace('{n}', t.tank_number)} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{cap(t.fuel_type)}</span></span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: t.beyond ? '#dc2626' : (t.variance < 0 ? '#b45309' : '#16a34a') }}>{t.variance > 0 ? '+' : ''}{fmtL(t.variance)} {unitFor(t.fuel_type)} <span style={{ fontSize: 11, fontWeight: 700 }}>({t.variance_pct}%)</span></span>
                </div>
                {/* The full equation, spelled out */}
                <div style={{ fontSize: 12, color: 'var(--text-2,#475569)', display: 'flex', flexWrap: 'wrap', gap: '2px 5px', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700 }}>{fmtL(t.opening)}</span><span style={{ color: 'var(--text-3)' }}>{tc('bunk.recoOpening', 'opening')}</span>
                  <span style={{ color: '#16a34a' }}>+ {fmtL(t.deliveries)}</span><span style={{ color: 'var(--text-3)' }}>{tc('bunk.recoDeliv', 'deliv')}</span>
                  <span>− {fmtL(t.sales)}</span><span style={{ color: 'var(--text-3)' }}>{tc('bunk.recoSales', 'sales')}</span>
                  <span style={{ fontWeight: 700 }}>= {fmtL(t.book)}</span><span style={{ color: 'var(--text-3)' }}>{tc('bunk.recoBook', 'book')}</span>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  <span style={{ fontWeight: 700 }}>{tc('bunk.recoDip', 'dip')} {fmtL(t.dip)}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>{tc('bunk.recoFormulaNote', 'Variance = dip − book, where book = opening + deliveries − sales.')}</div>
        </div>
      )}

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
      </>)}
    </Wrapper>
  );
}
