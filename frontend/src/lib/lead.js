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

/**
 * Every contact on this lead that can actually be RUNG, in the order they were
 * learned — the manager who let you in first, the owner who turned up later.
 *
 * Outside an outlet you want whichever number answers, so the diary shows all of
 * them and the choice is made on the doorstep (owner, 23-Aug-2026: "the diary
 * should show both contacts. with the option to call either of them").
 *
 * Two rules earn their place:
 *   - A contact with no dialable number is DROPPED. A name with nothing to ring
 *     is not a way to reach anyone, and it would render as a tap that does
 *     nothing — the 6855 failure in a new costume.
 *   - A lead with no contact rows falls back to its own name/phone. Transitional,
 *     for rows the lead_contacts backfill has not reached; it disappears the
 *     moment a real row exists.
 */
export const callableContacts = (lead) => {
  const rows = Array.isArray(lead?.contacts) ? lead.contacts.filter(c => phoneHref(c)) : [];
  if (rows.length) return rows;
  return phoneHref(lead) ? [{ id: null, name: lead.name, phone: lead.phone }] : [];
};
