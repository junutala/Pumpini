// src/lib/lead.js
//
// How a lead is NAMED and CALLED, in one place.
//
// Both were assumed for months: every lead had an owner and a mobile, because
// every lead came from a form that demanded them. The refusal CTAs broke that on
// 22-Aug — "Selvan service station, Arcot Road" has no owner and no number,
// which is the whole point of it — and the screens were not revisited. The
// result was a card with a blank title and a `tel:null` link that opened the
// dialer with rubbish.
//
// So neither question gets answered inline again.

/** What to call this lead. The owner if we learned one; otherwise the outlet off
 *  the board, which for a refused or unattended visit is all there is. Null when
 *  genuinely nothing is known — the caller decides how to show that. */
export const leadTitle = (l) => {
  const owner  = (l?.name || '').trim();
  const outlet = (l?.station_name || '').trim();
  return owner || outlet || null;
};

/** True when this lead has a number worth dialling. `tel:` with anything else —
 *  null, undefined, '' — produces a link that LOOKS live and opens the dialer
 *  with garbage, which is worse than no link at all. */
export const hasPhone = (l) => !!(l?.phone && String(l.phone).trim());

/** A `tel:` href, or null when there is nothing to dial. Strips spaces, dashes
 *  and brackets: a dialer takes them, but they are also where a stray character
 *  hides. Keeps a leading + for an international number. */
export const phoneHref = (l) => {
  if (!hasPhone(l)) return null;
  const raw = String(l.phone).trim();
  const cleaned = (raw.startsWith('+') ? '+' : '') + raw.replace(/[^0-9]/g, '');
  return cleaned.replace(/^\+?$/, '') ? `tel:${cleaned}` : null;
};

/** Show the outlet on its own line only when it is NOT already the title —
 *  otherwise a lead with no owner prints its own name twice. */
export const outletSubtitle = (l) => {
  const owner  = (l?.name || '').trim();
  const outlet = (l?.station_name || '').trim();
  return owner && outlet ? outlet : null;
};
