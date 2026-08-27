'use client';
// Tally Prime export. Lists every financial touchpoint in plain English with the
// day's value, lets the owner map each to their Tally ledger name, then downloads
// a Tally-Prime-ready XML of the day's vouchers (Sales / Receipt / Contra).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Save } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

import { errText } from '../../lib/apiError';
const fmt = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function TallyPage() {
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [date, setDate]       = useState(todayIST());
  const [company, setCompany] = useState('');
  const [rows, setRows]       = useState([]);
  const [saving, setSaving]   = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    if (!stationId) return;
    const r = await api.get('/tally/touchpoints', { params: { station_id: stationId, date } }).catch(() => null);
    if (r) { setCompany(r.company_name || ''); setRows(r.touchpoints || []); }
  };
  useEffect(() => { load(); }, [stationId, date]);

  const setLedger = (key, v) => setRows(p => p.map(t => t.key === key ? { ...t, ledger_name: v } : t));

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/tally/map', {
        station_id: stationId,
        company_name: company,
        mappings: rows.map(t => ({ touchpoint_key: t.key, ledger_name: t.ledger_name })),
      });
    } catch (e) { alert(errText(e, tc('tallyp.failedToSave', 'Failed to save'))); }
    setSaving(false);
  };

  const download = async () => {
    setDownloading(true);
    try {
      await save(); // persist current mappings first
      const data = await api.get('/tally/export', { params: { station_id: stationId, date }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([data], { type: 'application/xml' }));
      const a = document.createElement('a');
      a.href = url; a.download = `tally-${date.replace(/-/g, '')}.xml`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      let msg = tc('tallyp.exportFailed', 'Export failed');
      try { const t = await e.response?.data?.text?.(); if (t) { const j = JSON.parse(t); msg = j.detail || j.error || msg; } }
      catch { msg = errText(e, msg); }
      alert(msg);
    }
    setDownloading(false);
  };

  const groups = [...new Set(rows.map(t => t.group))];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('tallyp.title', 'Tally Export')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('tallyp.subtitle', 'Map your Tally ledgers once, then download Tally-Prime XML for any day.')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input" type="date" style={{ width: 160 }} value={date} onChange={e => setDate(e.target.value)} />
          <button className="btn btn-primary" onClick={download} disabled={downloading}><Download size={15} />{downloading ? tc('tallyp.preparing', 'Preparing…') : tc('tallyp.downloadXml', 'Download XML')}</button>
        </div>
      </div>

      {/* Tally company */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label className="label">{tc('tallyp.companyNameLabel', 'Tally Company Name')} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{tc('tallyp.companyNameHint', '(must exactly match the company in Tally Prime)')}</span></label>
        <input className="input" style={{ maxWidth: 420 }} placeholder={tc('tallyp.companyNamePlaceholder', 'e.g. Sri Sai Filling Station')} value={company} onChange={e => setCompany(e.target.value)} />
      </div>

      {groups.map(g => (
        <div className="card" key={g} style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: '0.75rem' }}>{g}</div>
          <div className="table-wrap">
            <table className="dms-table">
              <thead>
                <tr>
                  <th>{tc('tallyp.thTouchpoint', 'Financial touchpoint')}</th>
                  <th style={{ textAlign: 'right' }}>{tc('tallyp.thValue', 'Value ({date})').replace('{date}', date)}</th>
                  <th>{tc('tallyp.thLedger', 'Your Tally ledger name')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter(t => t.group === g).map(t => (
                  <tr key={t.key} style={!t.inExport ? { opacity: 0.7 } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}{!t.inExport && <span style={{ fontSize: 10, color: '#d97706', marginLeft: 6, fontWeight: 700 }}>{tc('tallyp.soonBadge', 'SOON')}</span>}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.desc}</div>
                    </td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(t.value)}</td>
                    <td><input className="input" style={{ minWidth: 200 }} placeholder={tc('tallyp.ledgerPlaceholder', 'e.g. Petrol Sales A/c')} value={t.ledger_name || ''} onChange={e => setLedger(t.key, e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={save} disabled={saving}><Save size={15} />{saving ? tc('tallyp.saving', 'Saving…') : tc('tallyp.saveMapping', 'Save Mapping')}</button>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {tc('tallyp.soonNote', '“SOON” touchpoints are saved for later — the current export covers Sales, Receipts and Bank deposits (Contra), idempotent on re-import.')}
        </span>
      </div>
    </AppShell>
  );
}
