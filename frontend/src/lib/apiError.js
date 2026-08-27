// THE ONE WAY TO TURN A FAILED REQUEST INTO A SENTENCE A MANAGER CAN READ.
//
// TWO BUGS LIVED HERE, AND BOTH REACHED THE FORECOURT.
//
// 1. THE SHAPE. `lib/api.js` rejects with `err.response?.data || err` — it has
//    ALREADY unwrapped the axios error. So in a catch block `e` IS the payload
//    ({error, message, ...}) and `e.response.data` is undefined. Forty-nine call
//    sites across the app read `e.response?.data` anyway, so the server's actual
//    sentence was discarded every single time and the code fell through to
//    whatever came next.
//
// 2. THE CODE. What came next was usually `e.error` — a MACHINE string. On
//    27-Aug-2026 End Shift showed a manager, in a red box, the words:
//
//        missing_closing_dip
//
//    The backend had sent, in the very same response: "Closing dip missing for
//    Tank 1, Tank 2. Every tank must be read before this shift can close."
//
// So: prefer `message`. Accept `error` only when it reads like prose. Never show
// a snake_case identifier to a human — if that is all we have, say the plain
// fallback instead, because "Could not close the shift" tells him more than
// `missing_closing_dip` does.

// A machine code: snake_case or SCREAMING_CASE, no spaces. e.g. missing_closing_dip,
// active_pos, 42703, ERR_BAD_REQUEST.
function isMachineCode(v) {
  return typeof v === 'string' && v.length > 0 && !/\s/.test(v);
}

// The payload, whichever shape it arrives in. Handles the unwrapped reject, a raw
// axios error, and a plain Error.
export function errPayload(e) {
  if (!e) return {};
  if (e.response && e.response.data && typeof e.response.data === 'object') return e.response.data;
  if (typeof e === 'object') return e;
  return {};
}

// The sentence to show. `fallback` is used when the server gave us nothing a human
// can read — pass a tc() string so it translates.
export function errText(e, fallback = 'Something went wrong. Please try again.') {
  const d = errPayload(e);
  if (typeof d.message === 'string' && d.message.trim()) return d.message;
  if (typeof d.error === 'string' && d.error.trim() && !isMachineCode(d.error)) return d.error;
  if (typeof e === 'string' && e.trim() && !isMachineCode(e)) return e;
  return fallback;
}

// The machine code, for BRANCHING on — never for display. This is what lets a
// screen react to 'missing_closing_dip' by reopening the dip dialog.
export function errCode(e) {
  const d = errPayload(e);
  return isMachineCode(d.error) ? d.error : null;
}
