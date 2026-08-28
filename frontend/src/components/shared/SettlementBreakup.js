'use client';
// THE SETTLEMENT BREAKUP — one form, both flows.
//
// The five ways a man hands money back: cash, card, UPI, credit slips, petty/skim.
// It was written into Shift Close, and Spoke 3's Attendant Dues needs exactly the
// same five. A second copy is precisely the drift the cardinal rule forbids — "reuse
// the field, reuse the form. Do NOT open a new route" — and copying a block and
// changing a label is the named tell for it.
//
// So this is the block, lifted out unchanged: the same five fields, the same order,
// the same five-up grid that stacks on a phone, the same tc() keys, so a manager who
// learns it at Shift Close already knows it in Attendant Dues.
//
// WHAT IT DELIBERATELY DOES NOT HAVE: a field for the outstanding. The figure a man
// owes is CALCULATED from his own readings and is never typed. That is the structural
// fix for the 25-Aug loss of Rs 1,25,275 across three settlements recorded with
// cash_actual = 0 — a manager cannot blank a liability that has no field.
import { useTranslation } from 'react-i18next';

export const BREAKUP_FIELDS = ['cash', 'card', 'upi', 'credit', 'petty'];

// The zero form, so both callers seed identically rather than each inventing a shape.
export const emptyBreakup = () => ({ cash: '', card: '', upi: '', credit: '', petty: '' });

// What he actually handed over. A settlement of nothing is not a settlement, and both
// callers ask this question the same way rather than each rolling its own sum.
export const breakupTotal = f =>
  BREAKUP_FIELDS.reduce((sum, k) => sum + (Number(f?.[k]) || 0), 0);

const inp = {
  width: '100%', padding: '7px 9px', border: '1.5px solid #e5e3de', borderRadius: 7,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff',
};

// value  — { cash, card, upi, credit, petty }
// onChange(key, value)
export default function SettlementBreakup({ value = {}, onChange, disabled = false }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  // The same keys Shift Close already uses, so the two screens cannot drift apart in
  // Telugu while agreeing in English.
  const LABELS = [
    ['cash',   `${tc('send.cash', 'Cash')} ₹`],
    ['card',   `${tc('send.card', 'Card')} ₹`],
    ['upi',    'UPI ₹'],
    ['credit', `${tc('send.credit', 'Credit')} ₹`],
    ['petty',  `${tc('send.pettySkim', 'Petty/Skim')} ₹`],
  ];

  return (
    <div className="stack-mobile"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginTop: 10 }}>
      {LABELS.map(([k, label]) => (
        <div key={k}>
          <label className="label">{label}</label>
          <input style={inp} type="number" step="0.01" disabled={disabled}
            value={value[k] || ''}
            onChange={e => onChange?.(k, e.target.value)} />
        </div>
      ))}
    </div>
  );
}
