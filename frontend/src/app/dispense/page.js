'use client';
// NOZZLE HISTORY — one nozzle, its readings down the days.
//
// Owner, 23-Sep-2026: "we store the nozzle slips.... and its a crime not to let the
// users see the historic data."
//
// WHAT USED TO BE HERE, AND WHY IT IS GONE. This route rendered a page titled
// "Shift Reconciliation" under Reports → Reconciliation: a third settlement form
// beside /reconcile/manager and /reconcile/self-settle. It had never produced a
// single row in production — 1,098 settlements across all seven outlets, every one
// of them mode='manager' — and it could not have:
//
//   * it asked for `date: today`, so SBR's shifts filed under 21/22-Sep showed
//     "No shifts today" while two were running;
//   * its submit posted to POST /api/reconcile, which refuses anybody but the
//     attendant himself (403) — and this is a manager screen (reconcile.manage);
//   * it summed dispense_events for the "sales so far", and all 5,084 of those
//     across the real outlets are source='manager', synthesised AT shift close —
//     so before settling, every figure it showed was zero;
//   * it rendered blind-dropped money as a measurement: /dashboard/manager returns
//     sales: null with sales_hidden, and the page printed ₹0;
//   * and its variance dropdown was the canned reason code the owner ruled out on
//     25-Aug ("a canned reason code becomes a reflex").
//
// So this is a NET REDUCTION: a dead settlement route closed, and the nozzle history
// put in its place. No new page was added anywhere.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, RotateCcw, X, ImageOff } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import ArtifactImage from '../../components/shared/ArtifactImage';
import DateRangePicker from '../../components/shared/DateRangePicker';
import api, { getNozzleHistory } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { nozName } from '../../lib/nozzle';

const toIST   = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fmtQty  = n => (n == null ? '—' : Number(n).toFixed(3));
const fmtRead = n => (n == null ? null : Number(n).toFixed(3));

// DD MMM YYYY, HH:MM — en-IN / Asia/Kolkata, never a raw ISO stamp (house facts).
const stamp = ts => ts
  ? new Date(ts).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true })
  : '—';

// The day a shift was FILED under, read from the plain YYYY-MM-DD rather than parsed
// into a Date — constructing one and formatting it in another zone is how a date
// drifts by a day.
const filedLabel = (d) => {
  const k = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
  const [y, m, day] = k.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12))
    .toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
};

export default function NozzleHistoryPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const today = toIST(new Date());
  const weekAgo = toIST(new Date(Date.now() - 6 * 86400000));

  const [nozzles,  setNozzles]  = useState([]);
  const [nozzleId, setNozzleId] = useState('');
  const [from,     setFrom]     = useState(weekAgo);
  const [to,       setTo]       = useState(today);
  const [rows,     setRows]     = useState(null);   // null = not run yet
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (!stationId) return;
    api.get(`/stations/${stationId}/nozzles`)
      .then(n => setNozzles(Array.isArray(n) ? n : []))
      .catch(() => setNozzles([]));
  }, [stationId]);

  const run = useCallback(async () => {
    if (!stationId || !nozzleId) return;
    setLoading(true); setError('');
    try {
      const r = await getNozzleHistory({ station_id: stationId, nozzle_id: nozzleId, date_from: from, date_to: to });
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(e?.error || tc('nozhist.failed', 'Could not load the history.'));
      setRows([]);
    } finally { setLoading(false); }
  }, [stationId, nozzleId, from, to]);   // eslint-disable-line react-hooks/exhaustive-deps

  // RESET puts the form back to where it opened and clears the result, so the next
  // search starts from nothing rather than from a half-changed filter.
  const reset = () => {
    setNozzleId(''); setFrom(weekAgo); setTo(today);
    setRows(null); setError('');
  };

  // CLOSE dismisses the result and leaves the filters as they are — the manager has
  // looked at one nozzle and wants the table out of the way, not his search undone.
  const close = () => { setRows(null); setError(''); };

  const chosen = nozzles.find(n => n.id === nozzleId) || null;

  // Litres over the whole range, from the legs that actually closed. Quantity only:
  // the owner asked for Qty, and a litre figure carries no blind-drop question the
  // way a rupee figure would.
  const totalQty = (rows || []).reduce((s, r) => s + (r.qty_ltrs == null ? 0 : Number(r.qty_ltrs)), 0);
  const closedLegs = (rows || []).filter(r => r.qty_ltrs != null).length;
  const slipCount = (rows || []).reduce(
    (s, r) => s + (r.opening_photo_id ? 1 : 0) + (r.closing_photo_id ? 1 : 0), 0);

  const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
               textTransform: 'uppercase', letterSpacing: '.03em', padding: '8px 10px', whiteSpace: 'nowrap' };
  const td = { padding: '10px', borderTop: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };
  const mono = { ...td, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('nozhist.title', 'Nozzle History')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {tc('nozhist.subtitle', 'Every reading this nozzle has carried, and the slip behind it.')}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240 }}>
            <label className="label">{tc('nozhist.nozzle', 'Nozzle')}</label>
            {/* The LOV. Names come from pumpService through nozName() — the one
                writer — so this list reads exactly as the slip and every other
                screen does. Nothing is built here. */}
            <select className="input" value={nozzleId} onChange={e => setNozzleId(e.target.value)}>
              <option value="">{tc('nozhist.pickNozzle', 'Select a nozzle…')}</option>
              {nozzles.map(n => (
                <option key={n.id} value={n.id}>{nozName(n)} · {n.fuel_type}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{tc('nozhist.dates', 'Dates')}</label>
            <DateRangePicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
          </div>

          <button className="btn btn-primary" onClick={run} disabled={!nozzleId || loading}>
            <Search size={15} /> {loading ? tc('nozhist.loading', 'Loading…') : tc('nozhist.show', 'Show History')}
          </button>

          {/* The two CTAs the owner asked for, 23-Sep-2026. */}
          <button className="btn btn-secondary" onClick={reset} disabled={loading}>
            <RotateCcw size={15} /> {tc('nozhist.reset', 'Reset')}
          </button>
          <button className="btn btn-secondary" onClick={close} disabled={loading || rows === null}>
            <X size={15} /> {tc('nozhist.close', 'Close')}
          </button>
        </div>

        {error && <div className="alert-banner danger" style={{ marginTop: '1rem' }}>{error}</div>}
      </div>

      {/* Results */}
      {rows !== null && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        gap: 12, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {chosen ? nozName(chosen) : tc('nozhist.title', 'Nozzle History')}
                {chosen?.fuel_type && <span style={{ fontWeight: 400, color: 'var(--text-3)' }}> · {chosen.fuel_type}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {tc('nozhist.rangeLine', '{n} reading(s) · {from} to {to}')
                  .replace('{n}', rows.length)
                  .replace('{from}', filedLabel(from)).replace('{to}', filedLabel(to))}
              </div>
            </div>
            {closedLegs > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {tc('nozhist.rangeTotal', 'Total dispensed ({n} closed)').replace('{n}', closedLegs)}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 18 }}>
                  {totalQty.toFixed(3)} L
                </div>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem', fontSize: 13 }}>
              {tc('nozhist.noRows', 'No readings for this nozzle in that range.')}
            </div>
          ) : (
            <>
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>{tc('nozhist.colDate', 'Date')}</th>
                      <th style={th}>{tc('nozhist.colAttendant', 'Attendant')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{tc('nozhist.colOpening', 'Opening Reading')}</th>
                      <th style={th}>{tc('nozhist.colSlip', 'Slip')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{tc('nozhist.colClosing', 'Closing Reading')}</th>
                      <th style={th}>{tc('nozhist.colSlip', 'Slip')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{tc('nozhist.colQty', 'Total Sale (Qty)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const filed = String(r.filed_under || '').slice(0, 10);
                      const legDay = toIST(new Date(r.assigned_at));
                      const open = fmtRead(r.opening_reading);
                      const close = fmtRead(r.closing_reading);
                      return (
                        <tr key={r.leg_id}>
                          <td style={td}>
                            <div style={{ whiteSpace: 'nowrap' }}>{stamp(r.assigned_at)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                              {tc('nozhist.shiftN', 'Shift {n}').replace('{n}', r.shift_number)}
                              {/* The filed-under label, ONLY when it disagrees with the
                                  day the leg was actually created. shifts.date is typed
                                  by the manager; saying so where it differs is how the
                                  three real outlets get to spot it. */}
                              {filed && filed !== legDay && (
                                <span style={{ color: '#b45309', fontWeight: 600 }}>
                                  {' · '}{tc('nozhist.filedUnder', 'filed {d}').replace('{d}', filedLabel(filed))}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={td}>{r.attendant_name || '—'}</td>
                          <td style={{ ...mono, textAlign: 'right' }}>{open ?? '—'}</td>
                          <td style={td}>
                            {r.opening_photo_id
                              ? <ArtifactImage artifactId={r.opening_photo_id} source="meter" size={40}
                                  alt={tc('nozhist.openingSlipAlt', 'Opening slip')}
                                  label={`${chosen ? nozName(chosen) : ''} ${open || ''}`.trim()} />
                              : <NoSlip title={tc('nozhist.noSlip', 'No slip was captured for this reading')} />}
                          </td>
                          <td style={{ ...mono, textAlign: 'right' }}>
                            {close ?? <em style={{ color: '#b45309', fontStyle: 'normal', fontFamily: 'inherit' }}>
                              {tc('nozhist.stillOpen', 'open')}</em>}
                          </td>
                          <td style={td}>
                            {r.closing_photo_id
                              ? <ArtifactImage artifactId={r.closing_photo_id} source="meter" size={40}
                                  alt={tc('nozhist.closingSlipAlt', 'Closing slip')}
                                  label={`${chosen ? nozName(chosen) : ''} ${close || ''}`.trim()} />
                              : <NoSlip title={tc('nozhist.noSlip', 'No slip was captured for this reading')} />}
                          </td>
                          <td style={{ ...mono, textAlign: 'right', fontWeight: 700 }}>
                            {r.qty_ltrs == null ? '—' : `${fmtQty(r.qty_ltrs)} L`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* SAY WHY THE SLIP COLUMN IS EMPTY, rather than leaving a column of
                  dashes to be read as a fault. A slip is shown only when a meter
                  photograph's OCR'd number EQUALS the reading it sits beside — an
                  unmatched photo is left out rather than guessed at. Most outlets
                  have never captured one at all. */}
              {slipCount === 0 && (
                <div style={{ marginTop: '0.9rem', fontSize: 12, color: 'var(--text-3)',
                              background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                  {tc('nozhist.noSlipsNote',
                      'No slip photographs are stored against these readings. A slip appears here only when a meter photograph was captured and its reading matches.')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function NoSlip({ title }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 40, height: 40, borderRadius: 8, background: 'var(--surface-2)', color: '#cbd5e1' }}>
      <ImageOff size={16} />
    </span>
  );
}
