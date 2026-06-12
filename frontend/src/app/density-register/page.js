'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Thermometer } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getDensityRegister } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const fmtD = n => (n == null ? '—' : Number(n).toFixed(4));
const fmtVar = n => {
  if (n == null) return '—';
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(4)}`;
};

export default function DensityRegisterPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { station } = useAuth();
  if (typeof window === 'undefined') return null;
  const stationId = typeof station === 'object' ? station?.id : station;

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo]     = useState(today);
  const [data, setData]         = useState(null);
  const [tankFilter, setTankFilter] = useState('');

  const load = async () => {
    if (!stationId) return;
    try {
      const d = await getDensityRegister({ station_id: stationId, date_from: dateFrom, date_to: dateTo });
      setData(d);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, [stationId, dateFrom, dateTo]);
  useRefreshOnFocus(load);

  const rows = (data?.rows || []).filter(r => !tankFilter || String(r.tank_number) === tankFilter);
  const tankNumbers = [...new Set((data?.rows || []).map(r => r.tank_number))].sort((a, b) => a - b);

  const STATUS = {
    ok:          { label: tc('density_page.ok', 'OK'),                  cls: 'badge-success' },
    out_of_band: { label: tc('density_page.out_of_band', 'Out of band'), cls: 'badge-danger' },
    drift:       { label: tc('density_page.drift', 'Differs from invoice'), cls: 'badge-warning' },
    no_band:     { label: '—',                                          cls: 'badge-gray' },
  };

  const sourceLabel = (r) =>
    r.source === 'delivery'
      ? tc('density_page.source_delivery', 'Tanker decant')
      : `${tc('density_page.source_dip', 'Dip')} · ${tc(`dip_page.${r.reading_type}`, r.reading_type || '')}`;

  const exportCsv = () => {
    const headers = ['Date/Time', 'Tank', 'Fuel', 'Source', 'Observed (kg/L)', 'Temp (°C)', 'At 15°C (kg/L)', 'Invoice density', 'Challan', 'Variation', 'Status', 'Recorded by'];
    const body = rows.map(r => [
      new Date(r.observed_at).toLocaleString('en-IN'),
      r.tank_number, r.fuel_type, r.source === 'delivery' ? `delivery ${r.challan_number || ''}` : `dip ${r.reading_type || ''}`,
      fmtD(r.density), r.temperature_c ?? '', fmtD(r.density_at_15),
      fmtD(r.reference_density), r.reference_challan || r.challan_number || '',
      fmtVar(r.variation), r.status, r.recorded_by_name || '',
    ]);
    const csv = [headers, ...body].map(row => row.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `density-register-${dateFrom}-${dateTo}.csv`; a.click();
  };

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{tc('nav.density', 'Density Register')}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: '1rem', maxWidth: 640 }}>
          {tc('density_page.info', 'ℹ️ Every density observation — shift dips and tanker decants — corrected to 15°C and checked against the fuel’s normal band and the last delivery’s invoice density. Entries come from the shift open/close wizards, the Dipstick page and Deliveries.')}
        </div>
        {rows.length > 0 && (
          <button className="btn btn-secondary" onClick={exportCsv}><Download size={15} /> {tc('density_page.export', 'Export CSV')}</button>
        )}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="label">{tc('density_page.from', 'From')}</label>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 160 }} />
          </div>
          <div>
            <label className="label">{tc('density_page.to', 'To')}</label>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 160 }} />
          </div>
          <div>
            <label className="label">{tc('dip_page.tank', 'Tank')}</label>
            <select className="input" value={tankFilter} onChange={e => setTankFilter(e.target.value)} style={{ width: 140 }}>
              <option value="">{tc('density_page.all_tanks', 'All tanks')}</option>
              {tankNumbers.map(n => <option key={n} value={n}>{tc('dip_page.tank', 'Tank')} {n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary */}
      {data && (
        <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
          <div className="stat-card">
            <div className="stat-label">{tc('density_page.readings', 'Density entries')}</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>{data.summary.total}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{tc('density_page.out_of_band', 'Out of band')}</div>
            <div className="stat-value" style={{ fontSize: '1.25rem', color: data.summary.out_of_band ? 'var(--danger)' : 'var(--success)' }}>{data.summary.out_of_band}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{tc('density_page.drift', 'Differs from invoice')}</div>
            <div className="stat-value" style={{ fontSize: '1.25rem', color: data.summary.drift ? 'var(--warning)' : 'var(--success)' }}>{data.summary.drift}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{tc('density_page.last_entry', 'Last entry')}</div>
            <div className="stat-value" style={{ fontSize: '1rem' }}>
              {data.rows[0] ? new Date(data.rows[0].observed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Register table */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Thermometer size={15} /> {tc('density_page.register', 'Register')}
        </div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('density_page.date', 'Date/Time')}</th>
                <th>{tc('dip_page.tank', 'Tank')}</th>
                <th>{tc('dip_page.fuel', 'Fuel')}</th>
                <th>{tc('density_page.source', 'Source')}</th>
                <th>{tc('density_page.observed', 'Observed (kg/L)')}</th>
                <th>{tc('dip_page.temp_c', 'Temp (°C)')}</th>
                <th>{tc('density_page.at15', 'At 15°C')}</th>
                <th>{tc('density_page.invoice_ref', 'Invoice density')}</th>
                <th>{tc('density_page.variation', 'Variation')}</th>
                <th>{tc('density_page.status', 'Status')}</th>
                <th>{tc('dip_page.recorded_by', 'Recorded By')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>
                  {tc('density_page.no_rows', 'No density entries in this range. Density is captured in the shift open/close dips, the Dipstick page and tanker Deliveries.')}
                </td></tr>
              )}
              {rows.map(r => {
                const st = STATUS[r.status] || STATUS.no_band;
                const flagged = r.status === 'out_of_band' || r.status === 'drift';
                return (
                  <tr key={`${r.source}-${r.id}`} style={flagged ? { background: r.status === 'out_of_band' ? 'rgba(239,68,68,.06)' : 'rgba(245,158,11,.06)' } : undefined}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(r.observed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{tc('dip_page.tank', 'Tank')} {r.tank_number}</td>
                    <td><span className={`fuel-chip fuel-${r.fuel_type}`}>{t(`fuel_types.${r.fuel_type}`)}</span></td>
                    <td style={{ fontSize: 12 }}>{sourceLabel(r)}{r.source === 'delivery' && r.challan_number ? ` · ${r.challan_number}` : ''}</td>
                    <td className="num">{fmtD(r.density)}</td>
                    <td className="num">{r.temperature_c ?? '—'}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtD(r.density_at_15)}</td>
                    <td className="num">{fmtD(r.reference_density)}{r.reference_challan ? <span style={{ fontSize: 10, color: 'var(--text-3)' }}> ({r.reference_challan})</span> : null}</td>
                    <td className="num" style={flagged ? { color: r.status === 'out_of_band' ? 'var(--danger)' : 'var(--warning)', fontWeight: 600 } : undefined}>{fmtVar(r.variation)}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td style={{ fontSize: 12 }}>{r.recorded_by_name || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: '0.75rem', lineHeight: 1.6 }}>
          {tc('density_page.legend_bands', 'Normal bands at 15°C: petrol 0.720–0.775 kg/L, diesel 0.820–0.860 kg/L.')}{' '}
          {tc('density_page.legend_tolerance', 'Variation vs invoice beyond ±0.0030 kg/L is flagged — repeated drift can indicate adulteration or a wrong decant.')}
        </div>
      </div>
    </AppShell>
  );
}
