'use client';
// A DATE FIELD THAT SAYS, IN WORDS, WHICH DATE IT HOLDS.
//
// A native <input type="date"> renders in the BROWSER'S locale, and a page cannot
// change that — no CSS, no attribute, no JavaScript. On an en-US phone it shows
// MM/DD/YYYY however Indian the rest of the app is, and CLAUDE.md's rule ("India is
// DD/MM — never MM/DD") cannot be enforced on the control itself.
//
// So this does the two things that ARE possible, and between them they would have
// caught the 30-Aug-2026 coupon that was entered as 08/30/2024:
//
//   1. ECHO IT. The chosen date is written out underneath as "30 Aug 2024" — day,
//      month name, four-digit year. A wrong year is then unmissable, and a month/day
//      swap is impossible to misread because the month is a WORD.
//   2. BOUND IT. min/max stop an absurd year being picked at all. A coupon dated two
//      years ago is not a typo the manager should be able to make.
//
// The native input is kept rather than replaced: on a phone it opens the OS date
// picker, which is far better than anything hand-rolled.
export default function DateField({ value, onChange, min, max, required, className = 'input', ...rest }) {
  // Parsed from the parts, never through new Date(str) — 'YYYY-MM-DD' is read as UTC
  // midnight, which in IST can render as the day before.
  let pretty = null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (m) {
    const [, y, mo, d] = m;
    pretty = new Date(+y, +mo - 1, +d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }
  return (
    <>
      <input {...rest} className={className} type="date" required={required}
             value={value || ''} min={min} max={max}
             onChange={onChange} />
      {pretty && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{pretty}</div>
      )}
    </>
  );
}
