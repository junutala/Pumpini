'use client';
// THE LINES OF A PRINTED PRODUCT INVOICE — one table, used by the receipt that opens
// after a sale (Products POS) and by the reprint (Products → History). It was two
// copies of the same table; both had to change for MRP pricing, which is how two
// copies become two invoices.
//
// Owner, 04-Oct-2026: "Ensure that the MRP is the amount that is printed and charged
// to the customer. So, the base price + GST should be equal to mrp." So the MRP and
// the discount are printed, and Taxable + CGST + SGST adds up to the Total on every
// line. Invoices raised before 04-Oct carry no MRP (GST was added on top then) and
// print a dash in those two columns rather than a figure we would have to invent.
import { useTranslation } from 'react-i18next';

const fmt2 = n => Number(n || 0).toFixed(2);
const cell = { padding: '6px 8px', border: '1px solid #ddd' };
const num  = { ...cell, textAlign: 'right' };

export default function ProductInvoiceTable({ invoice }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const items = invoice?.items || [];
  const has = v => v !== null && v !== undefined && v !== '';
  const anyDiscount = items.some(i => Number(i.discount_amount) > 0);
  const heads = [
    ['colNum', '#'], ['colDesc', 'Description'], ['colHsn', 'HSN'], ['colQty', 'Qty'],
    ['colMrp', 'MRP'], ...(anyDiscount ? [['colDiscount', 'Discount']] : []),
    ['colTaxable', 'Taxable'], ['colCgst', 'CGST'], ['colSgst', 'SGST'], ['colTotal', 'Total'],
  ];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem', fontSize: 12 }}>
      <thead>
        <tr style={{ background: '#f3f4f6' }}>
          {heads.map(([k, en]) => (
            <th key={k} style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>{tc('lubepos.' + k, en)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.id || i}>
            <td style={cell}>{i + 1}</td>
            <td style={{ ...cell, fontWeight: 600 }}>{it.product_name}</td>
            <td style={{ ...cell, fontFamily: 'monospace', fontSize: 11 }}>{it.hsn_code || '—'}</td>
            <td style={num}>{Number(it.quantity)} {it.unit || ''}</td>
            <td style={num}>{has(it.mrp) ? `₹${fmt2(it.mrp)}` : '—'}</td>
            {anyDiscount && <td style={num}>{Number(it.discount_amount) > 0 ? `−₹${fmt2(it.discount_amount)}` : '—'}</td>}
            <td style={num}>₹{fmt2(it.taxable_amount)}</td>
            <td style={num}>₹{fmt2(it.cgst_amount)}<br /><span style={{ fontSize: 10, color: '#888' }}>({Number(it.gst_rate) / 2}%)</span></td>
            <td style={num}>₹{fmt2(it.sgst_amount)}<br /><span style={{ fontSize: 10, color: '#888' }}>({Number(it.gst_rate) / 2}%)</span></td>
            <td style={{ ...num, fontWeight: 700 }}>₹{fmt2(it.total_amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ background: '#f8f7f5', fontWeight: 700 }}>
          <td colSpan={heads.length - 4} style={{ ...cell, textAlign: 'right' }}>{tc('lubepos.totalRow', 'TOTAL')}</td>
          <td style={num}>₹{fmt2(invoice?.subtotal)}</td>
          <td style={num}>₹{fmt2(invoice?.total_cgst)}</td>
          <td style={num}>₹{fmt2(invoice?.total_sgst)}</td>
          <td style={{ ...num, fontSize: 15 }}>₹{fmt2(invoice?.grand_total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
