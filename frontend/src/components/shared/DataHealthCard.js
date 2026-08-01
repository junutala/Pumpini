'use client';

// Data-health tripwire — the compact "Data health" indicator.
//
// READ-ONLY. Surfaces out-of-sync data-entry flags computed by the backend
// (services/dataHealthService.js) from existing shifts/dips/tanks. Green when
// clean ("All data current"); otherwise a count + an expandable list of the
// specific flags (which outlet/tank, how many days). No money, no masking.
//
//   <DataHealthCard stationId={id} />        → one outlet (manager dashboard /
//                                               owner's embedded cockpit).
//   <GroupDataHealthCard groupId={id} />     → owner rollup across all outlets
//                                               (Group View).
//
// All manager/owner-facing strings go through tc() with Telugu in te.json.

import { useState, useEffect } from 'react';
import { ShieldCheck, AlertTriangle, ChevronDown, ChevronRight, Droplets, Clock, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getStationDataHealth, getGroupDataHealth } from '../../lib/api';

const card = { background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14 };
const IST = { timeZone: 'Asia/Kolkata' };
const fmtDay = (d) => { try { return new Date((d && d.length <= 10 ? d + 'T00:00:00' : d)).toLocaleDateString('en-IN', { ...IST, day: '2-digit', month: 'short' }); } catch { return d || ''; } };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const ICON = { missing_dip: Droplets, overdue_physical_dip: Gauge, stale_open_shift: Clock, late_close: Clock, handover_mismatch: AlertTriangle, unverified_meter_entry: AlertTriangle };

// Human-readable line for a single flag. tc = translate helper (key, fallback).
function flagText(f, tc) {
  const tank = (n, ft) => tc('dh.tankFuel', 'Tank {n} · {fuel}').replace('{n}', n).replace('{fuel}', cap(ft || ''));
  switch (f.type) {
    case 'missing_dip':
      return f.days == null
        ? tc('dh.missingDipNever', '{t} — no dip on record').replace('{t}', tank(f.tank_number, f.fuel_type))
        : tc('dh.missingDip', '{t} — no dip in {d} day(s)').replace('{t}', tank(f.tank_number, f.fuel_type)).replace('{d}', f.days);
    case 'overdue_physical_dip':
      return f.days == null
        ? tc('dh.physNever', '{t} — no physical dip on record').replace('{t}', tank(f.tank_number, f.fuel_type))
        : tc('dh.physOverdue', '{t} — physical dip overdue ({d} days)').replace('{t}', tank(f.tank_number, f.fuel_type)).replace('{d}', f.days);
    case 'stale_open_shift':
      return f.count > 1
        ? tc('dh.staleOpenN', '{n} shifts still open past their day').replace('{n}', f.count)
        : tc('dh.staleOpen1', '1 shift still open past its day (since {d})').replace('{d}', fmtDay(f.oldest_date));
    case 'late_close':
      return tc('dh.lateClose', '{n} shift(s) closed late — batch entry').replace('{n}', f.count);
    case 'handover_mismatch':
      return tc('dh.handover', '{t} — handover gap {v} L ({from} → {to})')
        .replace('{t}', tank(f.tank_number, f.fuel_type))
        .replace('{v}', f.diff_ltrs != null ? (f.diff_ltrs > 0 ? '+' : '') + f.diff_ltrs : '?')
        .replace('{from}', fmtDay(f.prev_date))
        .replace('{to}', fmtDay(f.date));
    // Worded as an OBSERVATION, never an accusation. What the system actually
    // knows is that the figure has no evidence behind it — a broken camera and a
    // dishonest entry produce the same flag, and only the owner can tell which by
    // asking. Saying more than we know would burn the owner's trust the first
    // time it was a faulty scanner.
    case 'unverified_meter_entry':
      return tc('dh.unverifiedMeter', 'Nozzle {n} · {fuel} — {p}% of {c} closing meters entered as whole litres; the pump slip prints decimals, so these were typed, not scanned')
        .replace('{n}', f.nozzle_number)
        .replace('{fuel}', cap(f.fuel_type || ''))
        .replace('{p}', f.pct_whole != null ? f.pct_whole : '?')
        .replace('{c}', f.readings);
    default:
      return f.type;
  }
}

function FlagList({ flags, tc }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      {flags.map((f, i) => {
        const I = ICON[f.type] || AlertTriangle;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-2,#475569)' }}>
            <I size={15} color="#d97706" style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{flagText(f, tc)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Shared shell: clean (green) vs flagged (amber) header with an expandable body.
function Shell({ title, clean, count, cleanText, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const canExpand = !clean;
  return (
    <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
      <div
        onClick={() => canExpand && setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: canExpand ? 'pointer' : 'default' }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: clean ? '#eaf3de' : '#fef3c7', color: clean ? '#27500a' : '#92400e', flexShrink: 0 }}>
          {clean ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: clean ? '#3b6d11' : 'var(--warning,#d97706)', marginTop: 1 }}>
            {clean ? cleanText : count}
          </div>
        </div>
        {canExpand && (open ? <ChevronDown size={18} color="var(--text-3)" /> : <ChevronRight size={18} color="var(--text-3)" />)}
      </div>
      {canExpand && open && children}
    </div>
  );
}

// ── Per-station card (manager dashboard / owner embedded cockpit) ───────────
export default function DataHealthCard({ stationId }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    getStationDataHealth(stationId).then(d => { if (!cancelled) setData(d); }).catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [stationId]);

  // Additive tile — if the read fails or hasn't loaded, render nothing (never
  // break the dashboard).
  if (err || !data) return null;
  const clean = data.count === 0;
  return (
    <Shell
      title={tc('dh.title', 'Data health')}
      clean={clean}
      cleanText={tc('dh.allCurrent', 'All data current')}
      count={tc('dh.nFlags', '{n} to check').replace('{n}', data.count)}
    >
      <FlagList flags={data.flags} tc={tc} />
    </Shell>
  );
}

// ── Owner rollup card (Group View) ──────────────────────────────────────────
export function GroupDataHealthCard({ groupId }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    getGroupDataHealth(groupId).then(d => { if (!cancelled) setData(d); }).catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [groupId]);

  if (err || !data) return null;
  const clean = data.total === 0;
  const flagged = (data.stations || []).filter(s => s.count > 0);
  return (
    <Shell
      title={tc('dh.title', 'Data health')}
      clean={clean}
      cleanText={tc('dh.allCurrentGroup', 'All outlets current')}
      count={tc('dh.nAcrossOutlets', '{n} to check across {o} outlet(s)').replace('{n}', data.total).replace('{o}', flagged.length)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {flagged.map(s => (
          <div key={s.station_id}>
            <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706' }} />
              {s.name}
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>
                {tc('dh.nFlags', '{n} to check').replace('{n}', s.count)}
              </span>
            </div>
            <div style={{ paddingLeft: 16 }}>
              <FlagList flags={s.flags} tc={tc} />
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
