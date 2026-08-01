'use client';
// Credit Coupons — capture a filled-in requisition coupon as a credit sale.
//
// The coupon is the AUTHORITY binding the customer; the book issued to that customer
// binds the outlet. So the coupon number decides which customer this belongs to — the
// name written on the slip is only a cross-check.
//
// Nothing auto-commits. The scan pre-fills, validation previews the customer and the
// rate that will apply, and the MANAGER confirms every figure. The coupon is
// handwritten, so the manager is the check, not the machine (owner call). Manual entry
// works standalone — the photo is only an accelerator.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ScanLine, AlertTriangle, CheckCircle, Ticket } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { parseCoupon, validateCoupon, captureCoupon, getCoupons } from '../../lib/api';
import ArtifactImage from '../../components/shared/ArtifactImage';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const FUELS = ['petrol', 'diesel', 'premium_petrol'];
const fmt  = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtL = n => Number(n || 0).toFixed(2);
const toIST = d => d ? new Date(d).toLocaleDateString('en-IN',
  { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function CreditCouponsPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [rows, setRows]     = useState([]);
  const [form, setForm]     = useState({});
  const [scanning, setScan] = useState(false);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [saved, setSaved]   = useState('');
  const [check, setCheck]   = useState(null);   // validate() preview
  const [scanNotes, setNotes] = useState('');
  // The photographed coupon, held from the scan until the manager confirms, then
  // saved WITH the sale. The coupon carries the customer's signature and seal and
  // is what the outlet produces when a bill is disputed months later — the first
  // cut of this screen read it and threw it away, leaving the invoice line with
  // nothing behind it. Keeping the raw OCR beside it means a later dispute can see
  // both what the machine read and what was committed, which is the only way to
  // tell a mis-scan from a mis-key.
  const [scanImg, setScanImg] = useState(null); // { base64, media_type, preview, ocr }

  const load = async () => {
    if (!stationId) return;
    setRows(await getCoupons({ station_id: stationId }).catch(() => []));
  };
  useEffect(() => { load(); }, [stationId]);
  useRefreshOnFocus(load);

  const f = (k, v) => { setForm(p => ({ ...p, [k]: v })); setCheck(null); setErr(''); };

  const blank = () => ({ coupon_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), fuel_type: 'diesel' });
  useEffect(() => { setForm(blank()); }, []);

  // ── Scan (optional accelerator) ─────────────────────────────────────
  const toB64 = (file) => new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      // Handwriting sits right at the OCR legibility edge, so keep it large.
      const max = 2600, scale = Math.min(1, max / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      resolve({ base64: c.toDataURL('image/jpeg', 0.92).split(',')[1], media_type: 'image/jpeg' });
    };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

  const onScan = async (file) => {
    if (!file) return;
    setScan(true); setErr(''); setNotes(''); setCheck(null); setScanImg(null);
    try {
      const { base64, media_type } = await toB64(file);
      const r = await parseCoupon({ station_id: stationId, file_base64: base64, media_type });
      setScanImg({ base64, media_type, preview: `data:${media_type};base64,${base64}`, ocr: r });
      // Faithful reproduction: whatever the coupon says goes in the boxes. One product
      // per coupon in practice — take whichever line carries litres.
      const fuel = r.diesel_ltrs != null ? 'diesel' : (r.petrol_ltrs != null ? 'petrol' : null);
      const qty  = r.diesel_ltrs != null ? r.diesel_ltrs : r.petrol_ltrs;
      setForm(p => ({
        ...p,
        coupon_no:      r.coupon_no != null ? String(r.coupon_no) : '',
        coupon_date:    r.coupon_date || p.coupon_date,
        vehicle_number: r.vehicle_number || '',
        customer_hint:  r.customer_name || '',
        fuel_type:      fuel || p.fuel_type,
        quantity_ltrs:  qty != null ? String(qty) : '',
      }));
      const bits = [];
      if (r.confidence === 'low') bits.push(tc('coupon.lowConf', 'The handwriting was hard to read — check every figure.'));
      if (r.notes) bits.push(r.notes);
      if (r.has_signature === false) bits.push(tc('coupon.noSig', 'No signature visible on the coupon.'));
      if (r.has_seal === false) bits.push(tc('coupon.noSeal', 'No office seal visible on the coupon.'));
      setNotes(bits.join(' · '));
    } catch (e) {
      setErr(e.error || tc('coupon.scanFail', 'Could not read the coupon — enter the details manually.'));
    } finally { setScan(false); }
  };

  // ── Validate before committing ──────────────────────────────────────
  const doCheck = async () => {
    setErr(''); setCheck(null);
    try {
      setCheck(await validateCoupon({
        station_id: stationId, coupon_no: form.coupon_no, coupon_date: form.coupon_date,
        fuel_type: form.fuel_type, customer_hint: form.customer_hint,
      }));
    } catch (e) { setErr(e.error || tc('coupon.checkFail', 'Could not check this coupon.')); }
  };

  const amount = () => {
    const q = parseFloat(form.quantity_ltrs), r = check?.rate?.price;
    return (Number.isFinite(q) && Number.isFinite(r)) ? +(q * r).toFixed(2) : null;
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      // The image rides along in the same request as the sale, so both commit in
      // one transaction — a stored coupon image always has a sale behind it.
      const ev = await captureCoupon({
        ...form,
        station_id: stationId,
        file_base64: scanImg?.base64 || null,
        media_type:  scanImg?.media_type || null,
        ocr:         scanImg?.ocr || null,
      });
      setSaved(tc('coupon.savedMsg', 'Coupon {n} recorded — ₹{a}.')
        .replace('{n}', form.coupon_no).replace('{a}', fmt(ev.amount))
        + (ev.artifact_id ? ' ' + tc('coupon.imageStored', 'Coupon image stored.') : ''));
      setForm(blank()); setCheck(null); setNotes(''); setScanImg(null);
      load();
    } catch (e2) {
      setErr(e2.error || tc('coupon.saveFail', 'Could not record the coupon.'));
    } finally { setBusy(false); }
  };

  const canSave = form.coupon_no && form.coupon_date && form.fuel_type
    && parseFloat(form.quantity_ltrs) > 0 && check && !check.already_recorded;

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{tc('coupon.title', 'Credit Coupons')}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: '1rem', maxWidth: 660 }}>
          {tc('coupon.info', 'ℹ️ Record each filled-in requisition coupon. The coupon number decides which credit customer it belongs to, and the amount is worked out from that day\'s selling price at this outlet and stored on the sale. Photograph the coupon to save typing — then check every figure before you confirm.')}
        </div>
      </div>

      {saved && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--success)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <CheckCircle size={16} style={{ color: 'var(--success)' }} />{saved}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.5rem', maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{tc('coupon.capture', 'Capture a coupon')}</span>
          <label className="btn btn-secondary" style={{ cursor: scanning ? 'wait' : 'pointer' }}>
            <ScanLine size={15} />
            {scanning ? tc('coupon.reading', 'Reading coupon…') : tc('coupon.scan', 'Scan coupon')}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={scanning}
              onChange={e => { onScan(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>

        {scanNotes && (
          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10, display: 'flex', gap: 6 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{scanNotes}
          </div>
        )}

        {/* What will be filed against this sale. Shown so the manager can see the
            coupon is legible BEFORE committing — a blurred photo is worth catching
            now, not when a customer disputes the bill. */}
        {scanImg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scanImg.preview} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid #86efac' }} />
            <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>
              {tc('coupon.willStore', 'This photo will be stored with the sale as proof.')}
            </div>
            <button type="button" onClick={() => setScanImg(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#166534', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
              {tc('coupon.dropImage', 'Do not store')}
            </button>
          </div>
        )}

        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            <div>
              <label className="label">{tc('coupon.no', 'Coupon no.')} *</label>
              <input className="input" type="number" required value={form.coupon_no || ''}
                onChange={e => f('coupon_no', e.target.value)} onBlur={doCheck} placeholder="17702" />
            </div>
            <div>
              <label className="label">{tc('coupon.date', 'Coupon date')} *</label>
              <input className="input" type="date" required value={form.coupon_date || ''}
                onChange={e => f('coupon_date', e.target.value)} onBlur={doCheck} />
            </div>
            <div>
              <label className="label">{tc('coupon.product', 'Product')} *</label>
              <select className="input" value={form.fuel_type || 'diesel'}
                onChange={e => f('fuel_type', e.target.value)} onBlur={doCheck}>
                {FUELS.map(x => <option key={x} value={x}>{t(`fuel_types.${x}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{tc('coupon.qty', 'Litres')} *</label>
              <input className="input" type="number" step="0.01" required value={form.quantity_ltrs || ''}
                onChange={e => f('quantity_ltrs', e.target.value)} placeholder="25" />
            </div>
            <div>
              <label className="label">{tc('coupon.vehicle', 'Vehicle no.')}</label>
              <input className="input" value={form.vehicle_number || ''}
                onChange={e => f('vehicle_number', e.target.value)} placeholder="TS05FQ0975" />
            </div>
            <div>
              <label className="label">{tc('coupon.hint', 'Name on coupon')}</label>
              <input className="input" value={form.customer_hint || ''}
                onChange={e => f('customer_hint', e.target.value)} placeholder="GVPR" />
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
                {tc('coupon.hintNote', 'Cross-check only — the number decides the customer.')}
              </div>
            </div>
          </div>

          {/* Preview: who it resolves to, the rate applied and why, and any warnings.
              This is where the manager sees the working before committing. */}
          {check && (
            <div style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 13 }}>
              <div>
                <strong>{check.book.company_name}</strong>
                <span style={{ color: 'var(--text-3)' }}>
                  {' '}({tc('coupon.book', 'book')} {check.book.series_start}–{check.book.series_end})
                </span>
              </div>
              <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {fmtL(form.quantity_ltrs || 0)} L × ₹{fmt(check.rate.price)}
                {amount() != null && <> = <strong>₹{fmt(amount())}</strong></>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                {tc('coupon.rateAsAt', 'Rate in force on {d} at this outlet (set {e}).')
                  .replace('{d}', toIST(form.coupon_date))
                  .replace('{e}', toIST(check.rate.effective_from))}
              </div>
              {check.already_recorded && (
                <div style={{ marginTop: 6, color: 'var(--danger)', display: 'flex', gap: 6 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  {check.already_invoiced
                    ? tc('coupon.dupInvoiced', 'Already recorded AND invoiced. It cannot be captured again.')
                    : tc('coupon.dup', 'Already recorded. It cannot be captured again.')}
                </div>
              )}
              {(check.warnings || []).map((w, i) => (
                <div key={i} style={{ marginTop: 6, color: 'var(--warning)', display: 'flex', gap: 6 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{w}
                </div>
              ))}
            </div>
          )}

          {err && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" type="button" onClick={doCheck}>
              {tc('coupon.check', 'Check coupon')}
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !canSave}>
              {busy ? tc('coupon.saving', 'Saving…') : tc('coupon.confirm', 'Confirm & record')}
            </button>
          </div>
          {!check && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              {tc('coupon.checkFirst', 'Check the coupon first — it confirms the customer and the rate before anything is saved.')}
            </div>
          )}
        </form>
      </div>

      {/* Captured coupons — the pool a credit invoice draws from */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>{tc('coupon.recent', 'Captured coupons')}</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('coupon.image', 'Coupon')}</th>
                <th>{tc('coupon.no', 'Coupon no.')}</th>
                <th>{tc('coupon.date', 'Coupon date')}</th>
                <th>{tc('coupon.customer', 'Customer')}</th>
                <th>{tc('coupon.vehicle', 'Vehicle no.')}</th>
                <th>{tc('coupon.product', 'Product')}</th>
                <th className="num">{tc('coupon.qty', 'Litres')}</th>
                <th className="num">{tc('coupon.rate', 'Rate')}</th>
                <th className="num">{tc('coupon.amount', 'Amount')}</th>
                <th>{tc('coupon.invoiced', 'Invoiced')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>
                  <Ticket size={28} style={{ margin: '0 auto 8px', opacity: .3 }} />
                  <div>{tc('coupon.none', 'No coupons captured yet.')}</div>
                </td></tr>
              )}
              {rows.map(r => (
                <tr key={r.id}>
                  {/* Coupons captured before the image was stored show a placeholder —
                      the sale is still perfectly valid, it just has no photo behind it. */}
                  <td><ArtifactImage artifactId={r.artifact_id} size={38}
                        label={`${tc('coupon.no', 'Coupon no.')} ${r.coupon_no}`} /></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12.5 }}>{r.coupon_no}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{toIST(r.occurred_at)}</td>
                  <td style={{ fontSize: 12.5 }}>{r.company_name || '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.vehicle_number || '—'}</td>
                  <td><span className={`fuel-chip fuel-${r.fuel_type}`}>{t(`fuel_types.${r.fuel_type}`)}</span></td>
                  <td className="num">{fmtL(r.quantity_ltrs)}</td>
                  <td className="num">₹{fmt(r.rate_per_ltr)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>₹{fmt(r.amount)}</td>
                  <td>
                    {r.is_invoiced
                      ? <span className="badge badge-success" style={{ fontSize: 11 }}>{tc('coupon.yes', 'Invoiced')}</span>
                      : <span className="badge badge-gray" style={{ fontSize: 11 }}>{tc('coupon.pending', 'Pending')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
