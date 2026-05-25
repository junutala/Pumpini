'use client';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Droplets, AlertTriangle, Users, RefreshCw, Bell } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getOwnerDashboard, getManagerDashboard, getAttendantDashboard } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';

const PAYMENT_COLORS = { cash: '#16a34a', upi: '#2563eb', credit: '#9333ea', card: '#ea580c' };
const FUEL_COLORS    = { petrol: '#3b82f6', diesel: '#f59e0b', cng: '#10b981', premium_petrol: '#8b5cf6' };

function fmt(n)  { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function fmtL(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 }); }

export default function DashboardPage() {
  const { t }             = useTranslation();
  const { user, station } = useAuth();
  const stationId         = typeof station === 'object' ? station?.id : station;
  const today             = new Date().toISOString().slice(0, 10);

  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const { on }            = useSocket(stationId, null);

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      let d;
      if (user.role === 'owner' || user.role === 'manager') {
        d = await getOwnerDashboard(stationId, today);
      }
      setData(d);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [stationId, today]);

  useEffect(() => { load(); }, [load]);

  // Real-time refresh on new dispense event
  useEffect(() => on('dispense:new', () => load()), [on, load]);

  if (!stationId) return (
    <AppShell>
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ color: 'var(--text-3)' }}>No station assigned. Contact your owner to be assigned to a station.</p>
      </div>
    </AppShell>
  );

  if (loading) return <AppShell><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{t('loading')}</div></AppShell>;

  // Aggregate totals
  const sales = data?.sales || [];
  const totalSales = sales.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const totalLtrs  = sales.reduce((s, r) => s + parseFloat(r.total_ltrs || 0), 0);
  const totalTxns  = sales.reduce((s, r) => s + parseInt(r.txn_count || 0), 0);

  // Payment mode chart data
  const paymentData = ['cash','upi','credit','card'].map(mode => ({
    name: t(`dispense.${mode}`),
    value: sales.filter(r => r.payment_mode === mode).reduce((s,r) => s + parseFloat(r.total_amount||0), 0),
    fill: PAYMENT_COLORS[mode],
  })).filter(d => d.value > 0);

  // Fuel type chart data
  const fuelData = [...new Set(sales.map(r => r.fuel_type))].map(ft => ({
    name: t(`fuel_types.${ft}`) || ft,
    litres: sales.filter(r => r.fuel_type === ft).reduce((s,r) => s + parseFloat(r.total_ltrs||0), 0),
    amount: sales.filter(r => r.fuel_type === ft).reduce((s,r) => s + parseFloat(r.total_amount||0), 0),
    fill: FUEL_COLORS[ft] || '#888',
  }));

  const unreadAlerts = (data?.alerts || []).filter(a => !a.acknowledged_at);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.dashboard')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadAlerts.length > 0 && (
            <div className="badge badge-danger" style={{ padding: '6px 10px', fontSize: 13 }}>
              <Bell size={13} /> {unreadAlerts.length} {t('alert.unread')}
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-label">{t('dashboard.today_sales')}</div>
          <div className="stat-value amount">{fmt(totalSales)}</div>
          <div className="stat-sub">{totalTxns} transactions</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('dashboard.total_litres')}</div>
          <div className="stat-value" style={{ color: 'var(--petrol)' }}>{fmtL(totalLtrs)} L</div>
          <div className="stat-sub">{fuelData.map(f => f.name).join(', ')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('dashboard.open_shifts')}</div>
          <div className="stat-value" style={{ color: 'var(--brand)' }}>{(data?.shifts || []).filter(s => s.status === 'open').length}</div>
          <div className="stat-sub">{(data?.shifts || []).length} total today</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('dashboard.alerts')}</div>
          <div className="stat-value" style={{ color: unreadAlerts.length ? 'var(--danger)' : 'var(--success)' }}>
            {unreadAlerts.length}
          </div>
          <div className="stat-sub">unacknowledged</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Sales by fuel chart */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: 14 }}>Sales by Fuel Type</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={fuelData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `₹${fmt(v)}`} />
              <Bar dataKey="amount" radius={[4,4,0,0]}>
                {fuelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Payment mode pie */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: 14 }}>{t('dashboard.by_payment')}</div>
          {paymentData.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={paymentData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {paymentData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip formatter={(v) => `₹${fmt(v)}`} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: 'center', color: 'var(--text-3)', paddingTop: 40 }}>No sales yet today</div>}
        </div>
      </div>

      {/* Tank levels */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: 14 }}>{t('dashboard.tank_levels')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
          {(data?.stock || []).map(tank => (
            <div key={tank.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>Tank {tank.tank_number}</span>
                <span className={`fuel-chip fuel-${tank.fuel_type}`}>{t(`fuel_types.${tank.fuel_type}`)}</span>
              </div>
              <div className="tank-bar">
                <div className="tank-bar-fill" style={{
                  width: `${Math.min(100, tank.fill_pct || 0)}%`,
                  background: tank.fill_pct < 20 ? 'var(--danger)' : tank.fill_pct < 40 ? 'var(--warning)' : FUEL_COLORS[tank.fuel_type] || 'var(--brand)'
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>
                <span>{fmtL(tank.current_stock)} L</span>
                <span>{tank.fill_pct || 0}%</span>
              </div>
            </div>
          ))}
          {!(data?.stock || []).length && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>No tanks configured</span>}
        </div>
      </div>

      {/* Variances + Alerts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Cash variances */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>{t('dashboard.variances')}</div>
          {(data?.variances || []).length ? (
            data.variances.map(v => (
              <div key={v.id} className="alert-banner danger" style={{ marginBottom: 8 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>{v.attendant_name}</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    Expected ₹{fmt(v.cash_expected)} · Got ₹{fmt(v.cash_actual)} · Diff ₹{fmt(Math.abs(v.variance))}
                  </div>
                </div>
              </div>
            ))
          ) : <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No variances today ✓</div>}
        </div>

        {/* Alerts */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>{t('alert.title')}</div>
          {unreadAlerts.length ? (
            unreadAlerts.slice(0, 5).map(a => (
              <div key={a.id} className={`alert-banner ${a.severity === 'critical' ? 'danger' : 'warning'}`} style={{ marginBottom: 8 }}>
                <Bell size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 13 }}>{a.message}</div>
              </div>
            ))
          ) : <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No unread alerts ✓</div>}
        </div>
      </div>
    </AppShell>
  );
}
