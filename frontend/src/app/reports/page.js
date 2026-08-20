'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Download, Search } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { nozName } from '../../lib/nozzle';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function ReportsPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo]     = useState(today);
  const [report, setReport]     = useState(null);
  const [loading, setLoading]   = useState(false);

  const loadReport = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const events = await api.get('/dispense', {
        params: { station_id: stationId, date_from: dateFrom, date_to: dateTo + 'T23:59:59', limit: 5000 }
      });
      const rows = Array.isArray(events) ? events : [];

      // Aggregate by date
      const byDate = {};
      rows.forEach(r => {
        const d = new Date(r.occurred_at).toISOString().slice(0, 10);
        if (!byDate[d]) byDate[d] = { date: d, amount: 0, litres: 0, txns: 0, cash: 0, upi: 0, credit: 0 };
        byDate[d].amount  += parseFloat(r.amount || 0);
        byDate[d].litres  += parseFloat(r.quantity_ltrs || 0);
        byDate[d].txns    += 1;
        byDate[d][r.payment_mode] = (byDate[d][r.payment_mode] || 0) + parseFloat(r.amount || 0);
      });

      const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
      const totals = {
        amount: rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0),
        litres: rows.reduce((s, r) => s + parseFloat(r.quantity_ltrs || 0), 0),
        txns: rows.length,
        cash: rows.filter(r => r.payment_mode === 'cash').reduce((s, r) => s + parseFloat(r.amount || 0), 0),
        upi: rows.filter(r => r.payment_mode === 'upi').reduce((s, r) => s + parseFloat(r.amount || 0), 0),
        credit: rows.filter(r => r.payment_mode === 'credit').reduce((s, r) => s + parseFloat(r.amount || 0), 0),
      };

      // By fuel type
      const byFuel = {};
      rows.forEach(r => {
        if (!byFuel[r.fuel_type]) byFuel[r.fuel_type] = { fuel_type: r.fuel_type, amount: 0, litres: 0 };
        byFuel[r.fuel_type].amount += parseFloat(r.amount || 0);
        byFuel[r.fuel_type].litres += parseFloat(r.quantity_ltrs || 0);
      });

      setReport({ daily, totals, byFuel: Object.values(byFuel), rows });
    } catch (err) { console.error(err); alert(tc('repp.failedLoadReport', 'Failed to load report')); }
    finally { setLoading(false); }
  };

  const exportCsv = () => {
    if (!report) return;
    const headers = [
      tc('repp.csvDateTime', 'Date/Time'),
      tc('repp.csvAttendant', 'Attendant'),
      tc('repp.csvNozzle', 'Nozzle'),
      tc('repp.csvFuel', 'Fuel'),
      tc('repp.csvQtyL', 'Qty(L)'),
      tc('repp.csvRate', 'Rate'),
      tc('repp.csvAmount', 'Amount'),
      tc('repp.csvPayment', 'Payment'),
      tc('repp.csvVehicle', 'Vehicle'),
    ];
    const rows = report.rows.map(r => [
      new Date(r.occurred_at).toLocaleString('en-IN'),
      r.attendant_name || '', nozName(r), r.fuel_type || '',
      r.quantity_ltrs, r.rate_per_ltr, r.amount, r.payment_mode, r.vehicle_number || ''
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `petrol-dms-report-${dateFrom}-${dateTo}.csv`; a.click();
  };

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('nav.reports')}</h1>
        {report && (
          <button className="btn btn-secondary" onClick={exportCsv}><Download size={15} /> {tc('repp.exportCsv', 'Export CSV')}</button>
        )}
      </div>

      {/* Date range filter */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="label">{tc('repp.from', 'From')}</label>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 160 }} />
          </div>
          <div>
            <label className="label">{tc('repp.to', 'To')}</label>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 160 }} />
          </div>
          <button className="btn btn-primary" onClick={loadReport} disabled={loading}>
            <Search size={15} /> {loading ? tc('repp.loading', 'Loading...') : tc('repp.generateReport', 'Generate Report')}
          </button>
        </div>
      </div>

      {report && (
        <>
          {report.rows.some(r => r.sales_hidden) && (
            <div className="alert-banner info" style={{ marginBottom: '1.5rem' }}>
              🔒 {tc('repp.openShiftHidden', 'Sales from open shifts are hidden until those shifts close — the totals below exclude them.')}
            </div>
          )}
          {/* Totals */}
          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            {[
              [tc('repp.totalRevenue', 'Total Revenue'), `₹${fmt(report.totals.amount)}`, null],
              [tc('repp.totalLitres', 'Total Litres'), `${fmt(report.totals.litres)} L`, null],
              [tc('repp.transactions', 'Transactions'), fmt(report.totals.txns), null],
              [tc('repp.cashCollected', 'Cash Collected'), `₹${fmt(report.totals.cash)}`, 'var(--success)'],
            ].map(([label, val, color]) => (
              <div key={label} className="stat-card">
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: '1.25rem', ...(color ? { color } : {}) }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Daily sales chart */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: 14 }}>{tc('repp.dailySales', 'Daily Sales (₹)')}</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={report.daily} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => `₹${fmt(v)}`} labelFormatter={d => new Date(d).toLocaleDateString('en-IN')} />
                <Line type="monotone" dataKey="amount" stroke="var(--brand)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            {/* By fuel */}
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>{tc('repp.byFuelType', 'By Fuel Type')}</div>
              {report.byFuel.map(f => (
                <div key={f.fuel_type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className={`fuel-chip fuel-${f.fuel_type}`}>{t(`fuel_types.${f.fuel_type}`)}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{fmt(f.amount)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmt(f.litres)} L</div>
                  </div>
                </div>
              ))}
            </div>

            {/* By payment */}
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>{tc('repp.byPaymentMode', 'By Payment Mode')}</div>
              {[['cash',tc('repp.cash', 'Cash'),'var(--success)'],['upi','UPI','var(--info)'],['credit',tc('repp.credit', 'Credit'),'var(--warning)'],['card',tc('repp.card', 'Card'),'var(--brand)']].map(([mode,label,color]) => (
                <div key={mode} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color }}>₹{fmt(report.totals[mode])}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Raw events table */}
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>
              {tc('repp.transactionLog', 'Transaction Log ({n} records)').replace('{n}', report.rows.length)}
              {report.rows.length === 5000 && <span style={{ fontSize: 12, color: 'var(--warning)', marginLeft: 8 }}>⚠ {tc('repp.showingFirst5000', 'Showing first 5000 — narrow date range for complete data')}</span>}
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <div className="table-wrap">
                <table className="dms-table">
                  <thead>
                    <tr><th>{tc('repp.thDateTime', 'Date/Time')}</th><th>{tc('repp.thAttendant', 'Attendant')}</th><th>{tc('repp.thFuel', 'Fuel')}</th><th>{tc('repp.thQtyL', 'Qty (L)')}</th><th>{tc('repp.thAmount', 'Amount')}</th><th>{tc('repp.thMode', 'Mode')}</th><th>{tc('repp.thVehicle', 'Vehicle')}</th></tr>
                  </thead>
                  <tbody>
                    {report.rows.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(r.occurred_at).toLocaleString('en-IN')}</td>
                        <td>{r.attendant_name}</td>
                        <td><span className={`fuel-chip fuel-${r.fuel_type}`}>{r.fuel_type}</span></td>
                        <td className="num">{r.sales_hidden ? '—' : Number(r.quantity_ltrs).toFixed(2)}</td>
                        <td className="num">{r.sales_hidden ? <span style={{color:'var(--text-3)',fontSize:11}}>🔒 {tc('repp.hidden', 'Hidden')}</span> : `₹${fmt(r.amount)}`}</td>
                        <td><span className="badge badge-gray">{r.payment_mode}</span></td>
                        <td style={{ fontSize: 12 }}>{r.vehicle_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {!report && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>
          {tc('repp.selectDateRange', 'Select a date range and click Generate Report')}
        </div>
      )}
    </AppShell>
  );
}
