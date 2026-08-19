'use client';
// Operator self-settlement screen. The operator reads their own shift: enters (or
// scans) each nozzle's closing meter, sees the amount due, splits it across Cash /
// Cash Adj / UPI / Card / Petty / Credit (itemised per customer), confirms, and
// prints a slip to drop with the cash. Posts to /reconcile/self-settle — which is
// hard-scoped to the logged-in operator's own line. Reuses the POS geofence.
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const fmtR = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtL = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const unitFor = ft => ((ft || '').toLowerCase() === 'cng' ? 'kg' : 'L');
const fmtDT = t => t ? new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
// Fresh device position (resolves to null if unavailable/denied — the server then
// blocks the settle when the outlet has geofencing on).
const getPos = () => new Promise(res => {
  if (!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition(
    p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => res(null),
    { enableHighAccuracy: true, timeout: 8000 });
});

const PAY_FIELDS = [
  ['cash', 'Cash'], ['cash_adj', 'Cash Adj'], ['upi_total', 'UPI'],
  ['card_total', 'Card'], ['petty_cash', 'Petty'],
];

export default function SettlementPage() {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const router = useRouter();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [loading, setLoading] = useState(true);
  const [shift, setShift]     = useState(null);
  const [outlet, setOutlet]   = useState('');
  const [noz, setNoz]         = useState([]);   // {nozzle_id, nozzle_number, fuel_type, opening_reading, closing, test}
  const [rates, setRates]     = useState({});
  const [corps, setCorps]     = useState([]);
  const [pay, setPay]         = useState({ cash: '', cash_adj: '', upi_total: '', card_total: '', petty_cash: '' });
  const [credit, setCredit]   = useState([{ corporate_id: '', amount: '' }]);
  const [geo, setGeo]         = useState('checking');
  const [geoDist, setGeoDist] = useState(null);   // metres from the outlet (for the off-site message)
  const [busy, setBusy]       = useState(false);
  const [done, setDone]       = useState(null);
  const [scanNz, setScanNz]   = useState('');

  useEffect(() => { if (stationId) load(); /* eslint-disable-next-line */ }, [stationId]);

  async function load() {
    setLoading(true);
    try {
      const active = await api.get('/shifts/active', { params: { station_id: stationId } });
      if (!active) { setShift(null); setLoading(false); return; }
      setShift(active);
      const [full, pr, cs, st, sm] = await Promise.all([
        api.get(`/shifts/${active.id}`).catch(() => null),
        api.get(`/prices/${stationId}/current`).catch(() => []),
        api.get('/corporate', { params: { station_id: stationId } }).catch(() => []),
        api.get(`/stations/${stationId}/settings`).catch(() => ({})),
        // The closing meters the manager may have scanned off the composite slip photo.
        // Empty (or no draft yet) → the boxes start blank, exactly as before.
        api.get('/reconcile/scan-meters', { params: { shift_id: active.id } }).catch(() => []),
      ]);
      const mine = (full?.attendants || []).find(a => a.attendant_id === user.id);
      // Pre-fill each of MY nozzles' closing from the manager's scan draft, still fully
      // editable. The self-settle still sends whatever is in the box — the draft is a
      // convenience, not the record.
      const draft = {}; (Array.isArray(sm) ? sm : []).forEach(d => { if (d.closing_volume != null) draft[d.nozzle_id] = d.closing_volume; });
      setNoz((mine?.nozzles || []).map(n => ({
        ...n,
        closing: draft[n.nozzle_id] != null ? String(draft[n.nozzle_id]) : '',
        fromScan: draft[n.nozzle_id] != null,
        test: '',
      })));
      const rm = {}; (Array.isArray(pr) ? pr : []).forEach(p => { rm[p.fuel_type] = Number(p.price); }); setRates(rm);
      setCorps(Array.isArray(cs) ? cs : []);
      setOutlet((typeof station === 'object' ? station?.name : '') || st?.name || '');
      // geofence — same rule as POS
      if (!st?.geo_fence_enabled || !st?.latitude || !st?.longitude) setGeo('disabled');
      else if (!navigator.geolocation) setGeo('error');
      else navigator.geolocation.getCurrentPosition(
        p => {
          const d = getDistance(p.coords.latitude, p.coords.longitude, parseFloat(st.latitude), parseFloat(st.longitude));
          setGeoDist(Math.round(d));
          setGeo(d <= (st.geo_fence_radius || 500) ? 'ok' : 'outside');
        },
        () => setGeo('error'), { enableHighAccuracy: true, timeout: 8000 });
    } catch { /* leave shift null */ }
    setLoading(false);
  }

  const setN = (i, k, v) => setNoz(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const litresFor = n => Math.max(0, (parseFloat(n.closing) || 0) - (parseFloat(n.opening_reading) || 0) - (parseFloat(n.test) || 0));
  const amountDue = useMemo(() => +noz.reduce((s, n) => s + litresFor(n) * (rates[n.fuel_type] || 0), 0).toFixed(2), [noz, rates]);
  const creditTotal = useMemo(() => credit.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0), [credit]);
  const entered = useMemo(() => PAY_FIELDS.reduce((s, [k]) => s + (parseFloat(pay[k]) || 0), 0) + creditTotal, [pay, creditTotal]);
  const remaining = +(amountDue - entered).toFixed(2);

  async function scan(i, file) {
    if (!file) return;
    setScanNz(noz[i].nozzle_id);
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api.post('/reconcile/pos-meter', { shift_id: shift.id, nozzle_id: noz[i].nozzle_id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      const reading = r?.reading ?? r?.closing_reading ?? r?.value;
      if (reading != null && reading !== '') setN(i, 'closing', String(reading));
      else alert(r?.notes || tc('settle.scanFail', 'Could not read the meter — enter it manually.'));
    } catch (e) { alert(e.error || tc('settle.scanFail', 'Could not read the meter — enter it manually.')); }
    setScanNz('');
  }

  async function confirm() {
    if (geo === 'outside') { alert(tc('settle.offsite', 'You are outside the outlet — settlement is allowed on-site only.')); return; }
    if (!noz.length) { alert(tc('settle.noNoz', 'No nozzles are assigned to you.')); return; }
    if (noz.some(n => !(parseFloat(n.closing) >= 0))) { alert(tc('settle.needClosing', 'Enter the closing meter for every nozzle.')); return; }
    if (noz.some(n => parseFloat(n.closing) < parseFloat(n.opening_reading || 0))) { alert(tc('settle.badClosing', 'Closing meter cannot be less than the opening.')); return; }
    const credit_lines = credit.filter(l => l.corporate_id && parseFloat(l.amount) > 0)
      .map(l => ({ corporate_id: l.corporate_id, amount: parseFloat(l.amount) }));
    setBusy(true);
    try {
      // Fresh device location at the moment of settling — the server enforces the
      // geofence (if the outlet has it on) against these coords.
      const pos = await getPos();
      const res = await api.post('/reconcile/self-settle', {
        shift_id: shift.id,
        closings: noz.map(n => ({ nozzle_id: n.nozzle_id, closing_reading: parseFloat(n.closing), test_ltrs: parseFloat(n.test) || 0 })),
        cash: parseFloat(pay.cash) || 0, cash_adj: parseFloat(pay.cash_adj) || 0,
        upi_total: parseFloat(pay.upi_total) || 0, card_total: parseFloat(pay.card_total) || 0,
        petty_cash: parseFloat(pay.petty_cash) || 0, credit_lines,
        lat: pos?.lat, lng: pos?.lng,
      });
      setDone({
        res, when: new Date().toISOString(), operator: user.name, outlet, shift,
        lines: noz.map(n => ({ ...n, litres: litresFor(n), rate: rates[n.fuel_type] || 0, amount: +(litresFor(n) * (rates[n.fuel_type] || 0)).toFixed(2) })),
        pay, credit: credit.filter(l => l.corporate_id && parseFloat(l.amount) > 0)
          .map(l => ({ name: corps.find(c => c.id === l.corporate_id)?.company_name || '—', amount: parseFloat(l.amount) })),
        amount_due: res.amount_due ?? amountDue, variance: res.variance,
      });
    } catch (e) { alert(e.error || tc('settle.failed', 'Could not settle — try again.')); }
    setBusy(false);
  }

  if (loading) return <AppShell><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)' }}>{tc('settle.loading', 'Loading…')}</div></AppShell>;

  if (done) return <SettlementSlip d={done} onClose={() => router.push('/dashboard')} tc={tc} />;

  if (!shift) return (
    <AppShell><div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-3)' }}>
      {tc('settle.noShift', 'You have no open shift assigned. Start your shift first, then settle here at close.')}
    </div></AppShell>
  );

  // Fail-closed geofence: the form only renders when we POSITIVELY know you're
  // on-site (geo 'ok') or the outlet has no fence ('disabled'). Off-site, location
  // still resolving, or location unavailable/denied all block the whole screen —
  // not just the Confirm button. (The server also re-checks at settle time.)
  if (geo === 'checking') return (
    <AppShell><div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-3)' }}>
      {tc('settle.locating', 'Getting your location…')}
    </div></AppShell>
  );
  if (geo === 'outside' || geo === 'error') return (
    <AppShell><div style={{ maxWidth: 460, margin: '2rem auto', textAlign: 'center', padding: '2rem 1.25rem', background: '#fee2e2', borderRadius: 14, color: '#991b1b' }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>📍</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>{tc('settle.mustBeOnsite', 'You must be at the outlet to settle')}</div>
      <div style={{ fontSize: 13.5 }}>
        {geo === 'outside'
          ? tc('settle.offBy', 'You appear to be {d} m away. Move to {outlet} and reopen this screen.').replace('{d}', geoDist ?? '—').replace('{outlet}', outlet || 'the outlet')
          : tc('settle.needLocation', 'Turn on location for this app and reopen — settlement is allowed on-site only.')}
      </div>
      <button onClick={load} style={{ marginTop: 16, height: 42, padding: '0 20px', borderRadius: 10, border: 'none', background: '#991b1b', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{tc('settle.recheck', 'Re-check location')}</button>
    </div></AppShell>
  );

  const label = { fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, display: 'block' };
  const inp = { width: '100%', padding: '10px 12px', border: '1px solid var(--border,#e5e7eb)', borderRadius: 9, fontSize: 15 };
  const card = { background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14, padding: '14px 16px', marginBottom: 12 };

  return (
    <AppShell>
      <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 90 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{tc('settle.title', 'Shift settlement')}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 12 }}>{outlet} · {user?.name} · {tc('settle.shift', 'Shift')} {shift.shift_number}</div>

        {geo === 'outside' && <div style={{ ...card, background: '#fee2e2', color: '#991b1b', fontWeight: 600, fontSize: 13 }}>{tc('settle.offsiteBanner', 'You appear to be off-site. Settlement is allowed at the outlet only.')}</div>}

        {/* Nozzle meters */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{tc('settle.meters', 'Closing meters')}</div>
          {noz.map((n, i) => (
            <div key={n.nozzle_id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < noz.length - 1 ? '0.5px solid var(--border,#eee)' : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tc('settle.nozzle', 'Nozzle')} {n.nozzle_number} · {n.fuel_type} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {tc('settle.opening', 'opening')} {fmtL(n.opening_reading)}</span>
                {n.fromScan && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#0f766e', background: '#ccfbf1', borderRadius: 99, padding: '1px 7px', fontWeight: 700 }}>{tc('settle.fromScan', "manager's scan — check")}</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 8, alignItems: 'center' }}>
                <input style={inp} type="number" inputMode="decimal" placeholder={tc('settle.closing', 'Closing meter')} value={n.closing} onChange={e => setN(i, 'closing', e.target.value)} />
                <input style={inp} type="number" inputMode="decimal" placeholder={tc('settle.test', 'Test L')} value={n.test} onChange={e => setN(i, 'test', e.target.value)} />
                <label style={{ ...inp, width: 'auto', cursor: 'pointer', textAlign: 'center', color: 'var(--brand,#e07b0c)', fontWeight: 600 }}>
                  {scanNz === n.nozzle_id ? '…' : tc('settle.scan', 'Scan')}
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => scan(i, e.target.files?.[0])} />
                </label>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>{fmtL(litresFor(n))} {unitFor(n.fuel_type)} × {fmtR(rates[n.fuel_type] || 0)} = <b>{fmtR(litresFor(n) * (rates[n.fuel_type] || 0))}</b></div>
            </div>
          ))}
        </div>

        {/* Amount due */}
        <div style={{ ...card, background: remaining === 0 ? '#dcfce7' : '#fff7ed', border: 'none', textAlign: 'center' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)' }}>{tc('settle.amountDue', 'Amount due')}</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: remaining === 0 ? '#166534' : '#c2410c' }}>{fmtR(amountDue)}</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: remaining === 0 ? '#166534' : (remaining > 0 ? '#c2410c' : '#a32d2d') }}>
            {remaining === 0 ? tc('settle.balanced', 'Balanced') : `${tc('settle.remaining', 'Remaining')} ${fmtR(remaining)}`}
          </div>
        </div>

        {/* Payments */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{tc('settle.settlement', 'Settlement')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {PAY_FIELDS.map(([k, lbl]) => (
              <div key={k}>
                <label style={label}>{tc('settle.' + k, lbl)}</label>
                <input style={inp} type="number" inputMode="decimal" placeholder="0" value={pay[k]} onChange={e => setPay(p => ({ ...p, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>{tc('settle.adjHint', 'Cash + Cash Adj is recorded as the cash you accounted for.')}</div>
        </div>

        {/* Credit customers */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{tc('settle.credit', 'Credit customers')}</div>
          {credit.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select style={inp} value={l.corporate_id} onChange={e => setCredit(p => p.map((x, j) => j === i ? { ...x, corporate_id: e.target.value } : x))}>
                <option value="">{tc('settle.pickCustomer', 'Select customer…')}</option>
                {corps.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              <input style={inp} type="number" inputMode="decimal" placeholder={tc('settle.amount', 'Amount')} value={l.amount} onChange={e => setCredit(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              <button type="button" onClick={() => setCredit(p => p.length > 1 ? p.filter((_, j) => j !== i) : [{ corporate_id: '', amount: '' }])} style={{ height: 40, borderRadius: 9, border: '1px solid var(--border,#e5e7eb)', background: '#fff', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() => setCredit(p => [...p, { corporate_id: '', amount: '' }])} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--brand,#e07b0c)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ {tc('settle.addCustomer', 'Add customer')}</button>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>{tc('settle.creditInvoiceHint', 'Each line auto-generates a credit invoice for that customer.')}</div>
        </div>
      </div>

      {/* Sticky confirm */}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg,#fff)', borderTop: '0.5px solid var(--border,#e5e7eb)', padding: '12px 16px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={confirm} disabled={busy || geo === 'outside'} style={{ width: '100%', maxWidth: 560, height: 48, borderRadius: 12, border: 'none', background: busy || geo === 'outside' ? '#cbd5e1' : 'var(--brand,#e07b0c)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? tc('settle.saving', 'Settling…') : tc('settle.confirm', 'Confirm & print slip')}
        </button>
      </div>
    </AppShell>
  );
}

// ── Printable slip — one attendant per page (A4 now; reflows to a 58/80mm thermal
// roll via the same print CSS later). Prints only .slip on window.print(). ──
function SettlementSlip({ d, onClose, tc }) {
  const totalPaid = (parseFloat(d.pay.cash) || 0) + (parseFloat(d.pay.cash_adj) || 0) + (parseFloat(d.pay.upi_total) || 0) + (parseFloat(d.pay.card_total) || 0) + (parseFloat(d.pay.petty_cash) || 0) + d.credit.reduce((s, c) => s + c.amount, 0);
  const row = { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' };
  return (
    <AppShell>
      <style>{`@media print{body *{visibility:hidden}.slip,.slip *{visibility:visible}.slip{position:absolute;left:0;top:0;width:100%}.noprint{display:none}}`}</style>
      <div className="slip" style={{ maxWidth: 480, margin: '0 auto', background: '#fff', padding: 18, fontFamily: 'monospace' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 16 }}>{d.outlet || 'Pumpini'}</div>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#555', marginBottom: 10 }}>{tc('settle.slipTitle', 'Shift Settlement')}</div>
        <div style={row}><span>{tc('settle.operator', 'Operator')}</span><b>{d.operator}</b></div>
        <div style={row}><span>{tc('settle.printed', 'Printed')}</span><span>{fmtDT(d.when)}</span></div>
        <div style={row}><span>{tc('settle.shiftStart', 'Shift start')}</span><span>{fmtDT(d.shift.start_time)}</span></div>
        <div style={row}><span>{tc('settle.shiftEnd', 'Shift end')}</span><span>{fmtDT(d.when)}</span></div>
        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
        {d.lines.map((n, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{tc('settle.nozzle', 'Nozzle')} {n.nozzle_number} · {n.fuel_type}</div>
            <div style={row}><span>{tc('settle.opening', 'Opening')} / {tc('settle.closing', 'Closing')}</span><span>{fmtL(n.opening_reading)} → {fmtL(n.closing)}</span></div>
            <div style={row}><span>{fmtL(n.litres)} {unitFor(n.fuel_type)} × {fmtR(n.rate)}</span><b>{fmtR(n.amount)}</b></div>
          </div>
        ))}
        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
        <div style={{ ...row, fontSize: 15 }}><b>{tc('settle.totalSales', 'Total sales')}</b><b>{fmtR(d.amount_due)}</b></div>
        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
        <div style={row}><span>{tc('settle.cash', 'Cash')}</span><span>{fmtR(d.pay.cash)}</span></div>
        <div style={row}><span>{tc('settle.cash_adj', 'Cash Adj')}</span><span>{fmtR(d.pay.cash_adj)}</span></div>
        <div style={row}><span>{tc('settle.upi_total', 'UPI')}</span><span>{fmtR(d.pay.upi_total)}</span></div>
        <div style={row}><span>{tc('settle.card_total', 'Card')}</span><span>{fmtR(d.pay.card_total)}</span></div>
        <div style={row}><span>{tc('settle.petty_cash', 'Petty')}</span><span>{fmtR(d.pay.petty_cash)}</span></div>
        {d.credit.map((c, i) => <div key={i} style={row}><span>{tc('settle.creditLbl', 'Credit')} · {c.name}</span><span>{fmtR(c.amount)}</span></div>)}
        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
        <div style={row}><span>{tc('settle.totalSettled', 'Total settled')}</span><b>{fmtR(totalPaid)}</b></div>
        <div style={{ ...row, color: Math.abs(d.variance) <= 1 ? '#166534' : '#a32d2d' }}><b>{tc('settle.variance', 'Variance')}</b><b>{d.variance >= 0 ? '+' : ''}{fmtR(d.variance)}</b></div>
      </div>
      <div className="noprint" style={{ maxWidth: 480, margin: '14px auto', display: 'flex', gap: 10 }}>
        <button onClick={() => window.print()} style={{ flex: 1, height: 46, borderRadius: 10, border: 'none', background: 'var(--brand,#e07b0c)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>{tc('settle.print', 'Print slip')}</button>
        <button onClick={onClose} style={{ flex: 1, height: 46, borderRadius: 10, border: '1px solid var(--border,#e5e7eb)', background: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{tc('settle.doneBtn', 'Done')}</button>
      </div>
    </AppShell>
  );
}
