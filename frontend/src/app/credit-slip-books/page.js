'use client';
// Coupon Books — the outlet's control record over requisition-coupon books issued
// to credit customers. The cheque-book model: issue a numbered range to a customer,
// then every coupon presented must fall inside a range issued here.
//
// Books are per OUTLET because the units print their own books, so the number
// sequence is unique per outlet. That is why a coupon number alone resolves to one
// book and therefore one customer — the name written on the coupon is a CHECK, not
// the key. Design + reasoning: docs/credit-slip-invoicing.md.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, BookMarked, Search, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import PhotoCapture from '../../components/shared/PhotoCapture';
import ArtifactImage from '../../components/shared/ArtifactImage';
import {
  getCreditSlipBooks, issueCreditSlipBook, updateCreditSlipBook,
  resolveCouponBook, getCorporates,
} from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

import { errText } from '../../lib/apiError';
const STATUS_BADGE = {
  active:    { cls: 'badge-success', label: 'Active' },
  exhausted: { cls: 'badge-gray',    label: 'Exhausted' },
  cancelled: { cls: 'badge-warning', label: 'Cancelled' },
  lost:      { cls: 'badge-danger',  label: 'Lost' },
};

const toIST = d => d ? new Date(d).toLocaleDateString('en-IN',
  { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function CreditSlipBooksPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [books, setBooks]         = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm]   = useState(false);
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState('');
  const [form, setForm]           = useState({});
  // Sample coupon photo — the slip format the parser reads and the dispute backup.
  // { base64, media_type } or null. slipSlot remounts PhotoCapture after a save.
  const [slip, setSlip]           = useState(null);
  const [slipSlot, setSlipSlot]   = useState(0);

  // Coupon lookup — "who does number 17702 belong to?" Answers from the register
  // rather than by hunting through paper.
  const [lookup, setLookup]       = useState('');
  const [lookupRes, setLookupRes] = useState(null);
  const [lookupErr, setLookupErr] = useState('');

  const load = async () => {
    if (!stationId) return;
    const [b, c] = await Promise.all([
      getCreditSlipBooks({ station_id: stationId }).catch(() => []),
      // station_id is REQUIRED here — the route 400s without it rather than returning
      // every outlet's customers. Do NOT swallow this failure: an empty dropdown looks
      // like "this outlet has no credit customers", which is a different problem and
      // sends you looking in the wrong place.
      getCorporates({ station_id: stationId }),
    ]);
    setBooks(Array.isArray(b) ? b : []);
    const list = (Array.isArray(c) ? c : []).filter(x => x.is_active !== false && x.link_active !== false);
    setCustomers(list);
    if (!list.length) {
      setErr(tc('slipbook.noCustomers', 'No active credit customers are linked to this outlet — add one under Credit Customers first.'));
    }
  };

  const safeLoad = () => load().catch(e =>
    setErr(e.error || tc('slipbook.errLoad', 'Could not load coupon books for this outlet.')));
  useEffect(() => { safeLoad(); }, [stationId]);
  useRefreshOnFocus(safeLoad);

  const openForm = () => { setForm({ issued_on: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }); setSlip(null); setErr(''); setShowForm(true); };
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Leaves this book will carry, shown live so a fat-fingered range is obvious
  // before saving (a 1001–11000 typo is 10,000 coupons, not 100).
  const leafCount = () => {
    const a = parseInt(form.series_start, 10), b = parseInt(form.series_end, 10);
    const from = Number.isFinite(parseInt(form.opening_leaf, 10)) ? parseInt(form.opening_leaf, 10) : a;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < from) return null;
    return b - from + 1;
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await issueCreditSlipBook({
        ...form, station_id: stationId,
        image_base64: slip?.base64 || undefined,
        media_type:   slip?.media_type || undefined,
      });
      setShowForm(false); setForm({}); setSlip(null); setSlipSlot(n => n + 1);
      safeLoad();
    } catch (e2) {
      setErr(errText(e2, tc('slipbook.errIssue', 'Could not issue the book.')));
    } finally { setBusy(false); }
  };

  const setStatus = async (book, status) => {
    setErr('');
    try { await updateCreditSlipBook(book.id, { station_id: stationId, status }); safeLoad(); }
    catch (e) { setErr(e.error || tc('slipbook.errUpdate', 'Could not update the book.')); }
  };

  const doLookup = async (e) => {
    e.preventDefault();
    setLookupRes(null); setLookupErr('');
    if (!lookup) return;
    try {
      setLookupRes(await resolveCouponBook({ station_id: stationId, leaf: lookup }));
    } catch (e2) {
      setLookupErr(e2.error || tc('slipbook.lookupNone', 'Not in any book issued at this outlet.'));
    }
  };

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{tc('slipbook.title', 'Coupon Books')}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: '1rem', maxWidth: 640 }}>
          {tc('slipbook.info', 'ℹ️ Record every requisition-coupon book handed to a credit customer, like a cheque book. A coupon can then only be accepted if its number falls inside a book issued here — and a number that was never presented shows up as unaccounted instead of being invisible.')}
        </div>
        <button className="btn btn-primary" onClick={openForm}>
          <Plus size={16} />{tc('slipbook.issue', 'Issue a book')}
        </button>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem', fontSize: 13 }}>{err}</div>}

      {/* Coupon lookup */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: '0.75rem' }}>{tc('slipbook.lookupTitle', 'Whose coupon is this?')}</div>
        <form onSubmit={doLookup} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ maxWidth: 200 }} type="number" placeholder={tc('slipbook.lookupPh', 'Coupon number, e.g. 17702')}
            value={lookup} onChange={e => { setLookup(e.target.value); setLookupRes(null); setLookupErr(''); }} />
          <button className="btn btn-secondary" type="submit"><Search size={15} />{tc('slipbook.lookupBtn', 'Look up')}</button>
        </form>
        {lookupRes && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            {tc('slipbook.lookupHit', 'Coupon {n} belongs to').replace('{n}', lookup)}{' '}
            <strong>{lookupRes.company_name}</strong>{' '}
            <span style={{ color: 'var(--text-3)' }}>
              ({tc('slipbook.book', 'book')} {lookupRes.series_start}–{lookupRes.series_end}
              {lookupRes.status !== 'active' ? `, ${lookupRes.status}` : ''})
            </span>
          </div>
        )}
        {lookupErr && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertTriangle size={14} />{lookupErr}
          </div>
        )}
      </div>

      {/* Register */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>{tc('slipbook.register', 'Books issued')}</div>
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('slipbook.customer', 'Credit customer')}</th>
                <th>{tc('slipbook.range', 'Coupon range')}</th>
                <th className="num">{tc('slipbook.leaves', 'Coupons')}</th>
                <th>{tc('slipbook.label', 'Book')}</th>
                <th>{tc('slipbook.issuedOn', 'Issued')}</th>
                <th>{tc('slipbook.issuedBy', 'Issued by')}</th>
                <th>{tc('slipbook.sample', 'Sample')}</th>
                <th>{tc('slipbook.status', 'Status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {books.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>
                  <BookMarked size={28} style={{ margin: '0 auto 8px', opacity: .3 }} />
                  <div>{tc('slipbook.none', 'No coupon books recorded yet for this outlet.')}</div>
                </td></tr>
              )}
              {books.map(b => {
                const badge = STATUS_BADGE[b.status] || STATUS_BADGE.active;
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.company_name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                      {b.series_start}–{b.series_end}
                      {b.opening_leaf != null && Number(b.opening_leaf) !== Number(b.series_start) && (
                        <span style={{ color: 'var(--text-3)', fontFamily: 'inherit' }}>
                          {' '}({tc('slipbook.from', 'from')} {b.opening_leaf})
                        </span>
                      )}
                    </td>
                    <td className="num">{b.leaves_expected}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{b.book_label || '—'}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{toIST(b.issued_on)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{b.issued_by_name || '—'}</td>
                    <td>
                      {/* The sample coupon kept as slip format + dispute backup. A
                          dash means none is on file for this book yet. */}
                      {b.sample_artifact_id
                        ? <ArtifactImage artifactId={b.sample_artifact_id} size={34}
                            label={tc('slipbook.sample', 'Sample')} />
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td><span className={`badge ${badge.cls}`} style={{ fontSize: 11 }}>{tc(`slipbook.st_${b.status}`, badge.label)}</span></td>
                    <td>
                      {/* A book's RANGE is never editable — it records paper physically
                          handed over. Wrong range: cancel it and issue the right one. */}
                      <select className="input" style={{ fontSize: 11, padding: '4px 6px' }}
                        value={b.status} onChange={e => setStatus(b, e.target.value)}>
                        <option value="active">{tc('slipbook.st_active', 'Active')}</option>
                        <option value="exhausted">{tc('slipbook.st_exhausted', 'Exhausted')}</option>
                        <option value="cancelled">{tc('slipbook.st_cancelled', 'Cancelled')}</option>
                        <option value="lost">{tc('slipbook.st_lost', 'Lost')}</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Issue a book */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>{tc('slipbook.issue', 'Issue a book')}</span>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={submit}>
              <div style={{ marginBottom: 10 }}>
                <label className="label">{tc('slipbook.customer', 'Credit customer')} *</label>
                <select className="input" required value={form.corporate_id || ''} onChange={e => f('corporate_id', e.target.value)}>
                  <option value="">{tc('slipbook.pickCustomer', 'Select customer…')}</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="label">{tc('slipbook.first', 'First coupon no.')} *</label>
                  <input className="input" type="number" required placeholder="1001"
                    value={form.series_start || ''} onChange={e => f('series_start', e.target.value)} />
                </div>
                <div>
                  <label className="label">{tc('slipbook.last', 'Last coupon no.')} *</label>
                  <input className="input" type="number" required placeholder="1100"
                    value={form.series_end || ''} onChange={e => f('series_end', e.target.value)} />
                </div>
                <div>
                  <label className="label">{tc('slipbook.opening', 'First unused no.')}</label>
                  <input className="input" type="number" placeholder={tc('slipbook.openingPh', 'if part-used')}
                    value={form.opening_leaf || ''} onChange={e => f('opening_leaf', e.target.value)} />
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
                    {tc('slipbook.openingHint', 'Leave blank unless the book was handed over part-used.')}
                  </div>
                </div>
                <div>
                  <label className="label">{tc('slipbook.issuedOn', 'Issued')}</label>
                  <input className="input" type="date" value={form.issued_on || ''} onChange={e => f('issued_on', e.target.value)} />
                </div>
                <div>
                  <label className="label">{tc('slipbook.label', 'Book')}</label>
                  <input className="input" placeholder={tc('slipbook.labelPh', 'optional')}
                    value={form.book_label || ''} onChange={e => f('book_label', e.target.value)} />
                </div>
                <div>
                  <label className="label">{tc('slipbook.leaves', 'Coupons')}</label>
                  <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {leafCount() ?? '—'}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="label">{tc('slipbook.notes', 'Notes')}</label>
                <input className="input" value={form.notes || ''} onChange={e => f('notes', e.target.value)} />
              </div>
              <div style={{ marginTop: 12 }}>
                <PhotoCapture
                  key={slipSlot}
                  label={tc('slipbook.photoSlip', 'Photograph a coupon from this book')}
                  retakeLabel={tc('setp.retakePhoto', 'Retake')}
                  hint={tc('slipbook.photoHint', 'Optional but recommended — kept as the slip format and the backup if a bill is ever disputed.')}
                  onCapture={setSlip}
                  disabled={busy}
                  removeLabel={tc('photo.remove', 'Remove')} />
              </div>
              {err && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy}
                style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem' }}>
                {busy ? tc('slipbook.saving', 'Saving…') : tc('slipbook.issueBtn', 'Issue book')}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
