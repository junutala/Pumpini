'use client';
// Credit Invoices — control-total model. Credit is captured at the pump but never
// tagged to a customer; at shift close the credit lump is booked into a single
// station suspense ("Credit pending invoicing"). Here the manager raises a credit
// invoice per customer (vehicle / fuel / qty / rate keyed from the chits) and the
// control total simply DEPRECIATES by the invoice amount — no rate reconciliation.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, FileText, ChevronRight, ArrowLeft, Ticket, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import AppShell from '../../components/shared/AppShell';
import api, { getPricesAsAt } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

import { errText } from '../../lib/apiError';
const fmt   = n => Number(n||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });
const inp   = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const FUELS = ['petrol','diesel'];
// A line is either keyed by hand (the original control-total flow, for outlets with no
// coupon books) or loaded FROM A CAPTURED COUPON. A coupon line carries the sale's id,
// which is what lets the invoice mark it billed — manual lines have no id, which is why
// raising an invoice never marked anything before coupons existed.
const emptyLine = () => ({ vehicle:'', fuel:'diesel', qty:'', rate:'', id:null, coupon_no:null, chln_date:null });
const lineAmt  = l => (parseFloat(l.qty)||0) * (parseFloat(l.rate)||0);

export default function InvoicesPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [corps,    setCorps]    = useState([]);
  const [settings, setSettings] = useState(null);
  const [pending,  setPending]  = useState({ pending:0, booked:0, invoiced:0 });
  const [recent,   setRecent]   = useState([]);

  const [corp,    setCorp]    = useState('');
  const [invNo,   setInvNo]   = useState('');
  const [invDate, setInvDate] = useState(today());
  const [lines,   setLines]   = useState([emptyLine()]);
  const [busy,    setBusy]    = useState(false);
  const [from,    setFrom]    = useState('');    // period for pulling unbilled coupons
  const [to,      setTo]      = useState('');
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [couponMode, setCouponMode] = useState(false);   // lines came from coupons
  // Rate in force per fuel at this outlet as at the invoice date — used to DEFAULT a
  // manual line's rate. Only ever fills a BLANK rate box: whatever the manager types
  // wins, because they may be honouring a rate that differed on the day.
  const [rateMap, setRateMap] = useState({});
  const [msg,     setMsg]     = useState(null);   // { ok, text }

  const load = useCallback(async () => {
    if (!stationId) return;
    const [c, s, p, r] = await Promise.all([
      api.get('/corporate', { params:{ station_id: stationId } }).catch(()=>[]),
      api.get(`/stations/${stationId}/settings`).catch(()=>null),
      api.get('/invoices/credit-pending', { params:{ station_id: stationId } }).catch(()=>({ pending:0 })),
      api.get('/invoices', { params:{ station_id: stationId } }).catch(()=>[]),
    ]);
    setCorps(Array.isArray(c)?c:[]);
    setSettings(s);
    setPending(p || { pending:0 });
    setRecent(Array.isArray(r) ? r.slice(0, 8) : []);
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  // Re-read on invoice-date change too: a back-dated invoice should default to the rate
  // that applied THEN, not today's.
  useEffect(() => {
    if (!stationId || !invDate) return;
    getPricesAsAt(stationId, invDate)
      .then(rows => setRateMap(Object.fromEntries(
        (Array.isArray(rows) ? rows : []).map(r => [r.fuel_type, Number(r.price)]))))
      .catch(() => setRateMap({}));
  }, [stationId, invDate]);

  // Seed the opening blank line once rates are known. Coupon lines carry their own
  // stored rate and must never be touched by this.
  useEffect(() => {
    if (couponMode) return;
    setLines(ls => ls.map(l => (
      (l.rate === '' || l.rate == null) && rateMap[l.fuel] != null
        ? { ...l, rate: String(rateMap[l.fuel]) } : l
    )));
  }, [rateMap, couponMode]);
  useRefreshOnFocus(load);

  // The invoice number is allocated SERVER-SIDE inside the invoice transaction — see
  // services/invoiceNumberService. This is only a PREVIEW of what will be used, and it
  // mirrors the same opt-in rule so the screen never shows a shape the server wouldn't
  // produce.
  //
  // The FY series (PREFIX/FY/SEQ) applies only when the outlet has a Financial year set
  // in Settings. Blank keeps this outlet's existing format, so a live series does not
  // change shape under a customer who is already receiving it.
  //
  // It used to be BUILT here and posted, which was wrong twice: two managers running
  // month-end together would compute the SAME number off one stale invoice_seq read,
  // and the embedded date was the GENERATION date, not the invoice date.
  useEffect(() => {
    const prefix = settings?.invoice_prefix || 'INV';
    const fy     = settings?.invoice_fy || '';
    const seq    = settings?.invoice_seq || 1;
    if (fy) { setInvNo(`${prefix}/${fy}/${seq}`); return; }
    const stamp = today().replace(/-/g, '');
    setInvNo(`${prefix}-${stamp}-${String(seq).padStart(4, '0')}`);
  }, [settings]);

  const total   = lines.reduce((s,l) => s + lineAmt(l), 0);
  const willGoNegative = total > Number(pending.pending || 0) + 0.005;

  const setLine = (i,k,v) => setLines(ls => ls.map((l,idx) => idx===i ? { ...l, [k]:v } : l));
  // A new manual line starts at the outlet's rate for its fuel. Editable — the box is
  // a normal input, so typing over it just works.
  const addLine = () => setLines(ls => [...ls, { ...emptyLine(), rate: rateMap.diesel != null ? String(rateMap.diesel) : '' }]);
  // Changing the fuel re-defaults the rate, but never clobbers a figure the manager
  // typed: we only overwrite when the box is empty or still holds the OLD fuel's default.
  const onFuelChange = (i, fuel) => setLines(ls => ls.map((l, idx) => {
    if (idx !== i) return l;
    const wasDefault = l.rate === '' || l.rate == null
      || (rateMap[l.fuel] != null && Number(l.rate) === Number(rateMap[l.fuel]));
    const rate = wasDefault && rateMap[fuel] != null ? String(rateMap[fuel]) : l.rate;
    return { ...l, fuel, rate };
  }));

  const delLine = (i) => setLines(ls => ls.length>1 ? ls.filter((_,idx)=>idx!==i) : [emptyLine()]);

  // Pull this customer's UNBILLED coupons for the period. Each becomes an invoice line
  // with its stored rate and amount — never recomputed, so the invoice reproduces
  // exactly what was captured even if prices have moved since.
  const loadCoupons = async () => {
    if (!corp) return setMsg({ ok:false, text:tc('invp.errPickCustomer', 'Pick a credit customer first.') });
    setLoadingCoupons(true); setMsg(null);
    try {
      const rows = await api.get('/coupons', {
        params: { station_id: stationId, corporate_id: corp, from: from || undefined,
                  to: to || undefined, uninvoiced: true },
      });
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        setMsg({ ok:false, text:tc('invp.noCoupons', 'No unbilled coupons for this customer in that period.') });
        setLoadingCoupons(false); return;
      }
      setLines(list.map(r => ({
        id:        r.id,
        coupon_no: r.coupon_no,
        chln_date: String(r.occurred_at).slice(0,10),
        vehicle:   r.vehicle_number || '',
        fuel:      r.fuel_type,
        qty:       String(r.quantity_ltrs),
        rate:      String(r.rate_per_ltr),
      })));
      setCouponMode(true);
      setMsg({ ok:true, text:tc('invp.loadedCoupons', 'Loaded {n} unbilled coupon(s). Check them, then generate.')
        .replace('{n}', list.length) });
    } catch (e) {
      setMsg({ ok:false, text: e.error || tc('invp.errCoupons', 'Could not load coupons.') });
    }
    setLoadingCoupons(false);
  };

  // Earliest / latest challan date among the loaded lines — used when the period boxes
  // were left blank so the printed invoice still states its coverage.
  const couponPeriod = () => {
    const ds = lines.map(l => l.chln_date).filter(Boolean).sort();
    return { from: ds[0] || null, to: ds[ds.length - 1] || null };
  };

  const generate = async () => {
    if (!corp) return setMsg({ ok:false, text:tc('invp.errPickCustomer', 'Pick a credit customer first.') });
    const valid = lines.filter(l => lineAmt(l) > 0);
    if (!valid.length) return setMsg({ ok:false, text:tc('invp.errAddLine', 'Add at least one line with quantity and rate.') });
    setBusy(true); setMsg(null);
    try {
      const t = +total.toFixed(2);
      const line_items = valid.map(l => ({
        // id is what marks the coupon billed server-side (null for a manual line).
        id:             l.id || undefined,
        coupon_no:      l.coupon_no ?? undefined,
        chln_date:      l.chln_date ?? undefined,
        vehicle_number: l.vehicle?.trim() || null,
        fuel_type:      l.fuel,
        quantity_ltrs:  parseFloat(l.qty)  || 0,
        rate_per_ltr:   parseFloat(l.rate) || 0,
        amount:         +lineAmt(l).toFixed(2),
      }));
      await api.post('/invoices', {
        station_id:   stationId,
        corporate_id: corp,
        // No invoice_number — the server allocates it inside the transaction.
        invoice_date: invDate,
        // Period appears on the printed document ("1-Jun-26 TO 30-Jun-26"). When lines
        // came from coupons, derive it from the coupons themselves if the boxes were
        // left blank, so the invoice always states the range it actually covers.
        period_from:  from || couponPeriod().from || null,
        period_to:    to   || couponPeriod().to   || null,
        subtotal:     t,
        cgst_rate: 0, sgst_rate: 0, cgst_amount: 0, sgst_amount: 0,
        total_amount: t,
        line_items,
        is_opening_balance: false,   // opening balances are seeded by superadmin now
      });
      const name = corps.find(c=>c.id===corp)?.company_name || tc('invp.customerFallback', 'customer');
      const suffix = tc('invp.successReduced', ' Control total reduced.');
      setMsg({ ok:true, text: tc('invp.successInvoice', '✓ Invoice {invNo} raised for {name} — ₹{amt}.')
        .replace('{invNo}', invNo).replace('{name}', name).replace('{amt}', fmt(t)) + suffix });
      setLines([emptyLine()]); setCorp(''); setCouponMode(false);
      load();
    } catch (e) {
      setMsg({ ok:false, text: errText(e, tc('invp.errGeneric', 'Could not raise the invoice.')) });
    }
    setBusy(false);
  };

  return (
    <AppShell>
      {/* Breadcrumb */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('invp.dashboard', 'Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('invp.creditInvoices', 'Credit Invoices')}</span>
      </div>

      {/* Control total */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',
        background:'#0f172a',color:'#fff',borderRadius:14,padding:'1rem 1.25rem',marginBottom:'1.25rem'}}>
        <div>
          <div style={{fontSize:12,opacity:.7,textTransform:'uppercase',letterSpacing:'.05em'}}>{tc('invp.creditPending', 'Credit pending invoicing')}</div>
          <div style={{fontSize:30,fontWeight:800,lineHeight:1.1,marginTop:2}}>₹{fmt(pending.pending)}</div>
          <div style={{fontSize:11.5,opacity:.6,marginTop:3}}>{tc('invp.creditPendingHint', 'Credit booked at shift close, not yet invoiced to customers. Raise invoices below until this clears.')}</div>
        </div>
        <div style={{textAlign:'right',fontSize:12,opacity:.75,lineHeight:1.7}}>
          <div>{tc('invp.booked', 'Booked')}: ₹{fmt(pending.booked)}</div>
          <div>{tc('invp.invoiced', 'Invoiced')}: ₹{fmt(pending.invoiced)}</div>
        </div>
      </div>

      {msg && (
        <div style={{borderRadius:10,padding:'10px 12px',fontSize:13,marginBottom:12,
          background: msg.ok ? '#dcfce7' : '#fee2e2', color: msg.ok ? '#166534' : '#991b1b'}}>
          {msg.text}
        </div>
      )}

      {/* Raise an invoice */}
      <div className="card" style={{marginBottom:'1.25rem'}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:'0.9rem'}}>{tc('invp.raiseInvoice', 'Raise a credit invoice')}</div>

        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 220px 160px',gap:12,marginBottom:'1rem'}}>
          <div>
            <label className="label">{tc('invp.creditCustomer', 'Credit customer *')}</label>
            <select style={inp} value={corp} onChange={e=>setCorp(e.target.value)}>
              <option value="">{tc('invp.selectCustomer', 'Select customer…')}</option>
              {corps.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{tc('invp.invoiceNo', 'Invoice no.')}</label>
            <input style={inp} value={invNo} onChange={e=>setInvNo(e.target.value)} />
          </div>
          <div>
            <label className="label">{tc('invp.date', 'Date')}</label>
            <input style={inp} type="date" value={invDate} onChange={e=>setInvDate(e.target.value)} />
          </div>
        </div>

        {/* Pull unbilled coupons for this customer + period. Optional: an outlet with no
            coupon books keys lines by hand exactly as before. */}
        <div style={{display:'flex',gap:8,alignItems:'flex-end',flexWrap:'wrap',marginBottom:'0.9rem',
                     padding:'0.75rem',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10}}>
          <div>
            <label className="label" style={{fontSize:11}}>{tc('invp.periodFrom', 'Period from')}</label>
            <input style={{...inp,padding:'7px 9px',width:150}} type="date" value={from} onChange={e=>setFrom(e.target.value)}/>
          </div>
          <div>
            <label className="label" style={{fontSize:11}}>{tc('invp.periodTo', 'Period to')}</label>
            <input style={{...inp,padding:'7px 9px',width:150}} type="date" value={to} onChange={e=>setTo(e.target.value)}/>
          </div>
          <button onClick={loadCoupons} disabled={loadingCoupons}
            style={{display:'inline-flex',alignItems:'center',gap:6,background:'#0f172a',color:'#fff',
                    border:'none',borderRadius:8,padding:'9px 14px',fontSize:13,fontWeight:700,
                    cursor:loadingCoupons?'wait':'pointer'}}>
            <Ticket size={15}/>{loadingCoupons ? tc('invp.loadingCoupons', 'Loading…') : tc('invp.loadCoupons', 'Load unbilled coupons')}
          </button>
          <div style={{fontSize:11,color:'var(--text-3)',flex:'1 1 220px'}}>
            {couponMode
              ? tc('invp.couponModeNote', 'Lines are from captured coupons — each carries the rate stored when it was captured. Generating will mark them billed.')
              : tc('invp.couponHint', 'Leave the dates blank for every unbilled coupon, or set a month.')}
          </div>
        </div>

        {/* Lines */}
        <div className="table-wrap">
          <table className="dms-table" style={{minWidth:640}}>
            <thead>
              <tr>
                {/* INDENT, not slip. The credit customer brings a filled-in INDENT and
                    its number is the indent number (owner, 30-Aug-2026, after speaking
                    to the outlet). "Slip" already means the pump's printed ETOT slip
                    everywhere else in this system, so the two were colliding on one
                    word — this is the customer's document, and it has its own name. */}
                <th style={{width:110}}>{tc('invp.indentNo', 'Indent No.')}</th>
                <th style={{width:120}}>{tc('invp.indentDate', 'Indent Date')}</th>
                <th style={{width:'22%'}}>{tc('invp.vehicleNo', 'Vehicle No.')}</th>
                <th style={{width:120}}>{tc('invp.fuel', 'Fuel')}</th>
                <th style={{width:110,textAlign:'right'}}>{tc('invp.qtyL', 'Qty (L)')}</th>
                <th style={{width:110,textAlign:'right'}}>{tc('invp.rateL', 'Rate ₹/L')}</th>
                <th style={{width:130,textAlign:'right'}}>{tc('invp.amount', 'Amount')}</th>
                <th style={{width:40}}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l,i) => (
                <tr key={i}>
                  {/* TYPEABLE, because most lines are typed. These used to be
                      read-only text, filled only when the line came from a recorded
                      coupon — so a manually entered line printed a dash in both
                      columns and the owner's customer got an invoice that did not say
                      which indent it billed. The indent is in the manager's hand; let
                      him enter it. A line loaded from a record arrives pre-filled and
                      stays correctable. */}
                  <td><input style={{...inp,padding:'7px 9px',fontFamily:'var(--font-mono)'}}
                        placeholder={tc('invp.indentPlaceholder', 'e.g. 1042')}
                        value={l.coupon_no ?? ''}
                        onChange={e=>setLine(i,'coupon_no',e.target.value.trim() || null)} /></td>
                  <td><input type="date" style={{...inp,padding:'7px 9px'}}
                        value={l.chln_date ?? ''}
                        onChange={e=>setLine(i,'chln_date',e.target.value || null)} /></td>
                  <td><input style={{...inp,padding:'7px 9px'}} placeholder={tc('invp.vehiclePlaceholder', 'e.g. TN09AB1234')} value={l.vehicle} onChange={e=>setLine(i,'vehicle',e.target.value.toUpperCase())} /></td>
                  <td>
                    <select style={{...inp,padding:'7px 9px'}} value={l.fuel} onChange={e=>onFuelChange(i, e.target.value)}>
                      {FUELS.map(f => <option key={f} value={f}>{f[0].toUpperCase()+f.slice(1)}</option>)}
                    </select>
                  </td>
                  <td><input style={{...inp,padding:'7px 9px',textAlign:'right'}} type="number" step="0.001" min="0" placeholder="0" value={l.qty} onChange={e=>setLine(i,'qty',e.target.value)} /></td>
                  <td><input style={{...inp,padding:'7px 9px',textAlign:'right'}} type="number" step="0.01" min="0" placeholder="0.00" value={l.rate} onChange={e=>setLine(i,'rate',e.target.value)} /></td>
                  <td className="num" style={{fontWeight:700}}>₹{fmt(lineAmt(l))}</td>
                  <td>
                    <button onClick={()=>delLine(i)} title={tc('invp.remove', 'Remove')} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}><Trash2 size={15}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button onClick={addLine} style={{marginTop:10,display:'inline-flex',alignItems:'center',gap:5,background:'#f1f5f9',border:'1px solid #e2e8f0',borderRadius:8,padding:'7px 12px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
          <Plus size={14}/> {tc('invp.addLine', 'Add line')}
        </button>

        {/* Total + generate */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid #eef0f2'}}>
          <div>
            <span style={{fontSize:13,color:'var(--text-3)'}}>{tc('invp.invoiceTotal', 'Invoice total')}</span>
            <div style={{fontSize:24,fontWeight:800}}>₹{fmt(total)}</div>
            {willGoNegative && total>0 && (
              <div style={{fontSize:11.5,color:'#b45309',marginTop:2}}>{tc('invp.exceedsWarning', '⚠ Exceeds the pending control total — allowed, but it will push the balance below zero.')}</div>
            )}
          </div>
          <button onClick={generate} disabled={busy}
            style={{height:48,padding:'0 24px',background: busy?'#94a3b8':'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:busy?'default':'pointer',display:'inline-flex',alignItems:'center',gap:8}}>
            <FileText size={17}/>{busy ? tc('invp.raising', 'Raising…') : tc('invp.generateInvoice', 'Generate Invoice')}
          </button>
        </div>
      </div>

      {/* Recent invoices */}
      <div className="card">
        <div style={{fontWeight:700,fontSize:14,marginBottom:'0.75rem'}}>{tc('invp.recentInvoices', 'Recent credit invoices')}</div>
        {recent.length === 0 ? (
          <div style={{color:'var(--text-3)',fontSize:13}}>{tc('invp.noInvoices', 'No credit invoices raised yet.')}</div>
        ) : (
          <div className="table-wrap">
            <table className="dms-table">
              <thead><tr><th>{tc('invp.invoiceNoCol', 'Invoice No.')}</th><th>{tc('invp.customer', 'Customer')}</th><th>{tc('invp.date', 'Date')}</th><th style={{textAlign:'right'}}>{tc('invp.amount', 'Amount')}</th><th></th></tr></thead>
              <tbody>
                {recent.map(iv => (
                  <tr key={iv.id}>
                    <td><strong>{iv.invoice_number}</strong></td>
                    <td>{iv.company_name}</td>
                    <td>{iv.invoice_date ? String(iv.invoice_date).slice(0,10) : '—'}</td>
                    <td className="num">₹{fmt(iv.total_amount)}</td>
                    <td>
                      <button onClick={()=>router.push(`/invoices/print/${iv.id}?station_id=${stationId}`)}
                        title={tc('invp.print', 'Print')}
                        style={{background:'none',border:'none',cursor:'pointer',color:'var(--brand)',display:'inline-flex',alignItems:'center',gap:4,fontSize:12.5}}>
                        <Printer size={14}/>{tc('invp.print', 'Print')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
