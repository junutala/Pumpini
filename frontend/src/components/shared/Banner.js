// THE ONE BANNER. A message on a scan screen has a TONE, and the colour must match
// it — because a manager reads the colour, not the sentence.
//
// Why this exists (owner, 27-Aug-2026, watching a successful scan): Shift Start and
// Shift End each had a single `err` state rendered in a hard-coded red box, so a
// clean "Filled 2 nozzle(s)" was painted in exactly the same alarm red as a failure.
// His words: "the wrong coloured alert is the killer... nobody reads it but thinks
// the data has not been recorded." A success shown as an error teaches people the
// system is broken, which is precisely how the slip scan lost its audience.
//
// Three tones, and nothing else. If a message does not need the manager to DO
// something, it is 'ok'.
const TONES = {
  ok:    { bg: '#dcfce7', fg: '#166534', bd: '#bbf7d0' },
  warn:  { bg: '#fdf6ec', fg: '#8a6d1f', bd: '#f0dcbc' },
  error: { bg: '#fee2e2', fg: '#991b1b', bd: '#fecaca' },
};

export default function Banner({ tone = 'error', children }) {
  if (!children) return null;
  const t = TONES[tone] || TONES.error;
  return (
    <div style={{
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12,
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <span aria-hidden style={{ fontWeight: 700, lineHeight: '1.35' }}>
        {tone === 'ok' ? '✓' : tone === 'warn' ? '⚠' : '✕'}
      </span>
      <span style={{ lineHeight: '1.45' }}>{children}</span>
    </div>
  );
}
