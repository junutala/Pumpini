'use client';
// THE DISCOUNT ON ONE PRODUCT LINE — % or ₹ — and the alert when it takes the line
// below what the outlet paid. Embedded by both sale screens (Products POS and the bay
// Lube Sale), so a change here reaches both.
//
// Owner, 04-Oct-2026: "Give an option to enter discount in % and amount ... if the
// discount given will lead to an MRP that is less than purchase price, give an alert,
// but let the transaction continue." So the warning never disables anything.
//
// value:    { discount_mode: 'pct' | 'amt', discount_value }
// priced:   the line as priced by lib/productPricing (for the warning and errors)
import { useTranslation } from 'react-i18next';

const rs = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LineDiscount({ value = {}, priced, onChange }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const mode = value.discount_mode === 'amt' ? 'amt' : 'pct';
  const tab = (m, label) => (
    <button type="button" onClick={() => onChange?.({ discount_mode: m })}
      style={{ border: 'none', padding: '0 8px', height: 26, cursor: 'pointer', fontSize: 12, fontWeight: 700,
        background: mode === m ? '#FF6B00' : '#f3f4f6', color: mode === m ? '#fff' : '#555' }}>{label}</button>
  );
  return (
    <div style={{ marginTop: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#888' }}>{tc('lubepos.discount', 'Discount')}</span>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e3de' }}>
          {tab('pct', '%')}{tab('amt', '₹')}
        </div>
        <input type="number" inputMode="decimal" min="0" step="0.01"
          value={value.discount_value ?? ''} placeholder="0"
          onChange={e => onChange?.({ discount_value: e.target.value })}
          style={{ width: 72, height: 26, padding: '0 6px', border: '1px solid #e5e3de', borderRadius: 6, fontSize: 12 }} />
        {priced && !priced.error && priced.discount_amount > 0 && (
          <span style={{ fontSize: 11, color: '#888' }}>−{rs(priced.discount_amount)}</span>
        )}
      </div>
      {priced?.error && (
        <div style={{ fontSize: 11, color: '#991b1b', marginTop: 3 }}>{priced.error}</div>
      )}
      {priced && !priced.error && priced.below_cost && (
        <div style={{ fontSize: 11, color: '#b45309', marginTop: 3, fontWeight: 600 }}>
          {tc('lubepos.belowCost', 'Below purchase price — {net} each, bought at {buy}')
            .replace('{net}', rs(priced.net_unit)).replace('{buy}', rs(priced.buying_price))}
        </div>
      )}
    </div>
  );
}
