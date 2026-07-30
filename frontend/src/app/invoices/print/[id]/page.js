'use client';
// Printed credit invoice — deliberately laid out to match the document the customer
// already receives from Tally, column for column:
//
//   Sl No. | Chln. Date | Slip No. | Vehicle No. | Description of Goods | HSN/SAC
//        | Quantity (Shipped | Billed) | Rate (Incl. of Tax) | Rate | per | Amount
//
// Why match it: the whole point is that switching to Pumpini shouldn't make the
// customer's paperwork look different. docs/credit-slip-invoicing.md §1.
//
// Fuel sits OUTSIDE GST (it attracts state VAT) and the pump rate is already
// all-inclusive, so there is no tax breakup on these lines — the rate column is
// labelled "Incl. of Tax" exactly as the original does. Lubes are a separate GST
// invoice function and out of scope here.
import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { Printer, ArrowLeft } from 'lucide-react';
import api from '../../../../lib/api';

const fmt  = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = n => Number(n || 0).toFixed(4);
// DD-MMM-YY, en-IN, Asia/Kolkata — never a raw ISO string, and never MM/DD.
const d = v => v ? new Date(v).toLocaleDateString('en-IN',
  { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-') : '';

export default function InvoicePrintPage() {
  const { id } = useParams();
  const qs = useSearchParams();
  const router = useRouter();
  const stationId = qs.get('station_id');

  const [inv, setInv] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!id || !stationId) return;
    api.get(`/invoices/${id}`, { params: { station_id: stationId } })
      .then(setInv)
      .catch(e => setErr(e.error || 'Could not load this invoice.'));
  }, [id, stationId]);

  if (err)  return <div style={{ padding: 32, fontFamily: 'system-ui' }}>{err}</div>;
  if (!inv) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>Loading…</div>;

  const items = Array.isArray(inv.line_items) ? inv.line_items : [];
  const th = { border: '1px solid #000', padding: '3px 5px', fontSize: 10.5, fontWeight: 700, textAlign: 'left' };
  const td = { border: '1px solid #000', padding: '3px 5px', fontSize: 10.5, verticalAlign: 'top' };
  const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };

  const outletAddr = [inv.outlet_address, inv.outlet_city, inv.outlet_state, inv.outlet_pincode]
    .filter(Boolean).join(', ');

  return (
    <>
      {/* Screen-only controls; the printed page carries nothing but the document. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .inv-wrap { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
                    max-width: 210mm; margin: 0 auto; padding: 10mm; }
        .inv-wrap table { width: 100%; border-collapse: collapse; }
      `}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, padding: 12, background: '#f1f5f9', alignItems: 'center' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <ArrowLeft size={15} />Back
        </button>
        <button onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Printer size={15} />Print
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Use your browser&apos;s print dialogue — choose Save as PDF to send it by email.
        </span>
      </div>

      <div className="inv-wrap">
        {/* e-Invoice fields sit on the original template but are blank there too. Fuel is
            outside GST, so whether IRN applies at all is a question for the CA — the
            slots are kept so the document matches. */}
        <table style={{ marginBottom: 6, border: 'none' }}>
          <tbody>
            <tr>
              <td style={{ border: 'none', fontSize: 10, width: '55%' }}>
                IRN&nbsp;:<br />Ack No.&nbsp;:<br />Ack Date&nbsp;:
              </td>
              <td style={{ border: 'none', fontSize: 10, textAlign: 'right', verticalAlign: 'top' }}>e-Invoice</td>
            </tr>
          </tbody>
        </table>

        <div style={{ textAlign: 'center', marginBottom: 2, fontSize: 13, fontWeight: 700 }}>INVOICE</div>
        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700 }}>{inv.outlet_name}</div>
        {inv.outlet_gstn && <div style={{ textAlign: 'center', fontSize: 10.5 }}>GSTIN/UIN: {inv.outlet_gstn}</div>}
        {outletAddr && <div style={{ textAlign: 'center', fontSize: 10.5 }}>{outletAddr}</div>}

        <table style={{ marginTop: 8, marginBottom: 0 }}>
          <tbody>
            <tr>
              <td style={{ ...td, width: '58%' }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Bill TO</div>
                <div>Customer: <strong>{inv.company_name || '—'}</strong></div>
                <div>Address: {inv.customer_address || ''}</div>
                <div>Tel No : {inv.customer_phone || ''}</div>
                <div>GSTIN : {inv.customer_gstn || inv.customer_gst_number || ''}</div>
              </td>
              <td style={td}>
                <div>Date&nbsp;&nbsp;&nbsp;&nbsp;: <strong>{d(inv.invoice_date)}</strong></div>
                <div>Inv No.&nbsp;: <strong>{inv.invoice_number}</strong></div>
                <div>Period&nbsp;&nbsp;: {inv.period_from ? `${d(inv.period_from)} TO ${d(inv.period_to)}` : '—'}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr>
              <th style={{ ...th, width: 26 }}>Sl<br />No.</th>
              <th style={{ ...th, width: 62 }}>Chln.<br />Date</th>
              <th style={{ ...th, width: 52 }}>Slip<br />No.</th>
              <th style={{ ...th, width: 78 }}>Vehicle No.</th>
              <th style={th}>Description of Goods</th>
              <th style={{ ...th, width: 52 }}>HSN/<br />SAC</th>
              <th style={{ ...th, width: 66, textAlign: 'right' }}>Quantity<br />Shipped</th>
              <th style={{ ...th, width: 66, textAlign: 'right' }}>Quantity<br />Billed</th>
              <th style={{ ...th, width: 56, textAlign: 'right' }}>Rate<br />(Incl. of Tax)</th>
              <th style={{ ...th, width: 48, textAlign: 'right' }}>Rate</th>
              <th style={{ ...th, width: 30 }}>per</th>
              <th style={{ ...th, width: 76, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i}>
                <td style={{ ...td, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{d(l.chln_date) || '—'}</td>
                <td style={{ ...td, fontWeight: 600 }}>{l.coupon_no ?? '—'}</td>
                <td style={td}>{l.vehicle_number || '—'}</td>
                <td style={{ ...td, textTransform: 'capitalize' }}>
                  {String(l.fuel_type || '').replace('_', ' ')}
                </td>
                <td style={td}></td>
                <td style={num}>{fmtQ(l.quantity_ltrs)} Ltrs</td>
                <td style={num}>{fmtQ(l.quantity_ltrs)} Ltrs</td>
                <td style={num}>{fmt(l.rate_per_ltr)}</td>
                <td style={num}>{fmt(l.rate_per_ltr)}</td>
                <td style={td}>Ltrs</td>
                <td style={{ ...num, fontWeight: 700 }}>{fmt(l.amount)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td style={{ ...td, textAlign: 'center' }} colSpan={12}>No line items on this invoice.</td></tr>
            )}
            <tr>
              <td style={{ ...td, borderTop: '2px solid #000' }} colSpan={11}>
                <strong>Total Value</strong>
              </td>
              <td style={{ ...num, borderTop: '2px solid #000', fontWeight: 700 }}>{fmt(inv.total_amount)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 6, fontSize: 10.5 }}>
          Amount chargeable (in words): <strong>{inWords(inv.total_amount)}</strong>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, fontSize: 10.5 }}>
          <div>E.&amp; O.E.</div>
          <div style={{ textAlign: 'right' }}>
            <div>for <strong>{inv.outlet_name}</strong></div>
            <div style={{ marginTop: 34 }}>Authorised Signatory</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 10.5 }}>
          This is a Computer Generated Invoice
        </div>
      </div>
    </>
  );
}

// Indian-system amount in words (lakh / crore, not million) — the original invoice
// spells the total out, and a rupee figure in words is what makes a bill legally
// unambiguous.
function inWords(amount) {
  const n = Math.floor(Math.abs(Number(amount) || 0));
  const paise = Math.round(((Number(amount) || 0) - n) * 100);
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const two = v => v < 20 ? ones[v] : `${tens[Math.floor(v / 10)]}${v % 10 ? ' ' + ones[v % 10] : ''}`;
  const three = v => {
    const h = Math.floor(v / 100), r = v % 100;
    return `${h ? ones[h] + ' Hundred' : ''}${h && r ? ' ' : ''}${r ? two(r) : ''}`;
  };

  if (n === 0) return `Rupees Zero${paise ? ` And ${two(paise)} Paise` : ''} Only`;

  const crore = Math.floor(n / 10000000);
  const lakh  = Math.floor((n % 10000000) / 100000);
  const thou  = Math.floor((n % 100000) / 1000);
  const rest  = n % 1000;

  const parts = [];
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh)  parts.push(`${three(lakh)} Lakh`);
  if (thou)  parts.push(`${three(thou)} Thousand`);
  if (rest)  parts.push(three(rest));

  return `Rupees ${parts.join(' ')}${paise ? ` And ${two(paise)} Paise` : ''} Only`;
}
