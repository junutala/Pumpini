// frontend/src/lib/nozzle.js
//
// THE name of a nozzle, on the screen side. One helper, used by every page that
// shows one — Shift Open, Shift Close, the operator's own settlement, POS, the
// cockpit, Live, Reports, Test draws, Data health and Settings.
//
// The name itself is computed ONCE, in the backend (`pumpService.nozzleNameExpr`),
// and arrives as `nozzle_name`: `<pump serial>.<nozzle number>` — M1832105.1, the
// identity the nozzle's own slip prints. Nothing here invents a name; this is the
// read side of that single writer, and the ONLY reason it exists is the fallback
// below.
//
// FALLBACK, and why it must stay: Vercel and Railway deploy independently, so a
// frontend build can be live for a few minutes against a backend that does not yet
// send `nozzle_name`. Falling back to the stored number keeps the screen readable
// during that window instead of rendering "undefined" over a live forecourt. It is
// not a second naming convention — it is the old one, showing only until the field
// arrives.
export function nozName(n) {
  if (!n) return '';
  return String(n.nozzle_name ?? n.nozzle_number ?? '');
}
