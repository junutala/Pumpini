// src/lib/vcard.js
//
// One tap -> a contact in the phone's address book.
//
// A vCard is the only format every phone imports without an account, an app or a
// permission: Android hands a .vcf to Contacts, iOS opens its "Add Contact"
// sheet. No backend, no API, nothing to keep in sync.
//
// Built as a Blob rather than a `data:` URI because Android Chrome refuses
// top-level data: navigations, which is exactly the tap this is.

/** vCard 3.0 escaping: backslash, comma, semicolon, newline. An outlet called
 *  "Uma service station , Arcot road" carries a comma, and an unescaped one ends
 *  the field early — the contact imports with half a name and nobody notices. */
const esc = (v) => String(v ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\;');

/**
 * @param {object} c        { name, phone } — the contact
 * @param {object} [lead]   { station_name, lat, lng } for the org and the pin
 */
export function buildVCard(c, lead = {}) {
  const name   = (c?.name || '').trim() || (lead?.station_name || '').trim() || 'Pumpini lead';
  const phone  = (c?.phone || '').trim();
  const outlet = (lead?.station_name || '').trim();

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // N is structured (last;first;…). The whole thing goes in the surname slot
    // deliberately: "Satish - Manager" is not a first/last name and splitting it
    // on a space would file him under "-".
    `N:${esc(name)};;;;`,
    `FN:${esc(name)}`,
  ];
  if (outlet) lines.push(`ORG:${esc(outlet)}`);
  if (phone)  lines.push(`TEL;TYPE=CELL:${esc(phone)}`);
  if (lead?.lat != null && lead?.lng != null) {
    lines.push(`GEO:${lead.lat};${lead.lng}`);
    lines.push(`URL:https://www.google.com/maps?q=${lead.lat}\\,${lead.lng}`);
  }
  lines.push(`NOTE:${esc('Pumpini lead' + (outlet ? ` — ${outlet}` : ''))}`);
  lines.push('END:VCARD');

  // CRLF: the spec requires it, and some Android importers reject bare LF.
  return lines.join('\r\n') + '\r\n';
}

/** A filename a person can recognise in their downloads tray. */
export const vcardFilename = (c, lead = {}) => {
  const base = (c?.name || lead?.station_name || 'contact')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'contact';
  return `${base}.vcf`;
};

/** Hand the vCard to the phone. Returns false if the browser blocked it, so the
 *  caller can say so rather than leaving a button that appears to do nothing. */
export function saveContact(c, lead = {}) {
  try {
    const blob = new Blob([buildVCard(c, lead)], { type: 'text/vcard;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = vcardFilename(c, lead);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a delay: revoking immediately can cancel the download on some
    // Android builds before it has actually been read.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
