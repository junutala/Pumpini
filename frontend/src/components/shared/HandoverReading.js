'use client';
// ONE READING BOX FOR A NOZZLE HANDOVER — used by Nozzle Events (assign / reassign)
// and by Attendant Close (his nozzles go back to the pool when he settles).
//
// Owner, 23-Sep-2026: "Why give two paths for the same function?" The two SCREENS are
// two different acts — handing a nozzle to someone, and sending a man home — but the
// reading that ends his account on a nozzle is the same reading either way. So it is
// captured here, once, and both screens embed it. A copy on each screen is how
// /pos-meter and /ocr-meter became two versions of one call.
//
// What it does, and nothing else:
//   * the reading, typed, or read off a photograph of the slip by the ONE reader
//     (POST /reconcile/parse-slips) — only the line for THIS nozzle is taken;
//   * the working behind it, from GET /spokes/handover-preview — two readings, the
//     litres, the rate, the rupees. Derived by spokeService; nothing is computed here;
//   * the reason box, only after the physics has refused the figure (a reading that
//     went DOWN, or rose faster than a pump can pour). Never a dropdown.
//
// It does not record anything. The screen that embeds it decides what the reading is
// FOR — a handover to a man, or a close — and calls POST /spokes/event itself.
import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import PhotoCapture from './PhotoCapture';
import EngineNotice from './EngineNotice';
import api from '../../lib/api';
import { nozName } from '../../lib/nozzle';
import { errText } from '../../lib/apiError';
import { useTranslation } from 'react-i18next';

const L = n => n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// value:    { reading, source, serial, no, reason }
// onChange: patch => void
// refused:  the physics sentence from the backend, or null
// onPreview:(preview|null) => void — so a screen closing several nozzles can show one
//           total built from these server-derived parts
// showBalance: the "already outstanding / after this handover" lines. Off where a
//           screen closes several nozzles at once and shows its own total instead.
export default function HandoverReading({
  stationId, nozzle, value = {}, onChange, refused = null, disabled = false,
  onPreview, showBalance = true,
}) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [pv, setPv]         = useState(null);
  const [engine, setEngine] = useState(null);
  const [reading, setReadingBusy] = useState(false);
  const [photoErr, setPhotoErr]   = useState('');

  // THE WORKING, debounced — it follows the keystrokes, and a request per digit is a
  // request per digit. Failure is silent: it is an explanation, and losing it must
  // never stop a reading being recorded.
  const r = value.reading;
  useEffect(() => {
    const num = Number(r);
    if (!stationId || !nozzle?.id || r === undefined || r === '' || !Number.isFinite(num)) {
      setPv(null); onPreview?.(null); return;
    }
    let dead = false;
    const timer = setTimeout(() => {
      api.get('/spokes/handover-preview', { params: { station_id: stationId, nozzle_id: nozzle.id, reading: num } })
        .then(res => { if (!dead) { setPv(res); onPreview?.(res); } })
        .catch(() => { if (!dead) { setPv(null); onPreview?.(null); } });
    }, 400);
    return () => { dead = true; clearTimeout(timer); };
  }, [stationId, nozzle?.id, r]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ONE PHOTOGRAPH OF THE SLIP, read by the ONE reader. Only the line for the nozzle
  // being closed is taken: a photograph of six slips must not move another account.
  const onSlip = async (cap) => {
    if (!cap) return;
    setReadingBusy(true); setPhotoErr(''); setEngine(null);
    try {
      const res = await api.post('/reconcile/parse-slips', {
        station_id: stationId, image_base64: cap.base64, media_type: cap.media_type,
      });
      setEngine({ engine: res?.engine ?? null, reason: res?.fallback_reason ?? null });
      let hit = null;
      for (const slip of (Array.isArray(res?.slips) ? res.slips : [])) {
        for (const ln of (slip.lines || [])) {
          if (ln.nozzle_id === nozzle.id && ln.legible && ln.cumulative_volume != null) {
            hit = { reading: String(ln.cumulative_volume), source: 'photo',
                    serial: slip.pump_serial || '', no: String(ln.slip_no ?? '') };
          }
        }
      }
      if (hit) onChange?.(hit);
      else setPhotoErr(`${nozName(nozzle)} — ${tc('spoke.notOnThisSlip', 'that photograph does not carry a readable line for this nozzle. Type the figure, or photograph its own slip.')}`);
    } catch (e) { setPhotoErr(errText(e, 'That photograph could not be read.')); }
    setReadingBusy(false);
  };

  const inputStyle = { width: '100%', padding: '7px 9px', border: '1.5px solid #e5e3de',
                       borderRadius: 7, fontSize: 13, boxSizing: 'border-box' };

  return (
    <div>
      <EngineNotice engine={engine?.engine} reason={engine?.reason} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}>
          <label className="label">{tc('spoke.newReading', 'Reading on the slip')}</label>
          <input type="number" step="0.001" inputMode="decimal" value={value.reading || ''}
            onChange={e => onChange?.({ reading: e.target.value, source: 'typed' })}
            disabled={disabled} style={inputStyle} />
        </div>
        <PhotoCapture onCapture={onSlip} disabled={disabled || reading}
          label={tc('spoke.photograph', 'Photograph the slip')} />
      </div>
      {photoErr && <div style={{ fontSize: 12, color: '#9a3412', marginTop: 6 }}>{photoErr}</div>}

      {/* THE MONEY, SHOWN BEFORE IT IS MOVED. He checks one line against the paper in
          ten seconds and after that he stops checking. */}
      {pv && pv.found && pv.closes && (
        <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 8,
                      background: 'var(--surface-2)', fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 5 }}>
            {tc('spoke.closing', 'Closing')} {pv.closes.name}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', display: 'flex',
                        justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>{L(pv.prev_reading)} → {L(pv.reading)}</span>
            <span>{L(pv.ltrs)} L{pv.price ? ` × ${money(pv.price)}` : ''}</span>
            <span style={{ fontWeight: 700 }}>{money(pv.value)}</span>
          </div>
          {pv.co_event && (
            <div style={{ color: 'var(--text-3)', marginTop: 5 }}>
              {tc('spoke.noMovement', 'Same reading as before — no fuel moved, so nothing is added.')}
            </div>
          )}
          {showBalance && (
            <div style={{ borderTop: '1px solid #e5e3de', marginTop: 7, paddingTop: 6, display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-3)' }}>{tc('spoke.alreadyOwed', 'Already outstanding')}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{money(pv.outstanding_before)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>{tc('spoke.afterHandover', 'After this handover')}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{money(pv.outstanding_after)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* A JUSTIFIED DRIFT, IN HIS OWN WORDS — only after the physics has refused. */}
      {refused && (
        <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 8,
                      background: '#fbeee4', color: '#9a3412', fontSize: 12.5, lineHeight: 1.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{refused}</span>
          </div>
          <input value={value.reason || ''} placeholder={tc('spoke.reasonPh', 'Say what happened, in your own words')}
            onChange={e => onChange?.({ reason: e.target.value })}
            style={{ ...inputStyle, marginTop: 8, border: '1.5px solid #f0c9a8', background: '#fff' }} />
        </div>
      )}
    </div>
  );
}
