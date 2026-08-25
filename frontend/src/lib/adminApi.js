// src/lib/adminApi.js
//
// ONE client for the superadmin API. Two screens talk to it — the /admin console
// and the owner's side of pumpini.in/lead — and they must not grow two copies of
// the token handling (CLAUDE.md: reuse the form, do not open a new route).
//
// Both share the `admin_token` key, so signing in on either screen signs you in
// on the other. The token is the same 12-hour superadmin JWT; there is no second
// credential store and no second login endpoint.

export const ADMIN_TOKEN_KEY = 'admin_token';

export const getAdminToken = () => {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
};

/**
 * True only for something that is actually a usable superadmin JWT: three
 * segments, a decodable payload, the superadmin claim, and an expiry still
 * ahead of us.
 *
 * This exists because on 25-Aug the owner's session died about a second after
 * every page load — the burst of requests on load all returned 200, and every
 * request after it came back "Invalid token", twice, including within seconds of
 * a fresh login. The server was proven to sign valid tokens and accept its own
 * renewals, so something between there and the next request was putting a value
 * into storage that jwt.verify would not take.
 *
 * Rather than guess which link in the chain, refuse to STORE anything that is
 * not a usable token. A renewal that arrives mangled is then skipped and the
 * working token survives — a missed renewal costs nothing, a poisoned one costs
 * the session.
 */
const usableToken = (token) => {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (!t || t.split('.').length !== 3) return false;
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p?.isSuperAdmin === true && typeof p.exp === 'number' && p.exp > Date.now() / 1000;
  } catch { return false; }
};

export const setAdminToken = (token) => {
  if (!usableToken(token)) return false;
  try { localStorage.setItem(ADMIN_TOKEN_KEY, token.trim()); return true; } catch { return false; }
};

/** The stored token, but only if it is still usable — an expired or corrupted
 *  one is treated as absent so the screen asks for a sign-in instead of firing
 *  requests that will all come back 401. */
export const hasValidAdminToken = () => usableToken(getAdminToken());

export const clearAdminToken = () => {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* private mode */ }
};

/**
 * Superadmin fetch.
 *
 * NEVER resolves to a value a caller could mistake for "there is nothing here".
 * It used to return null on any failure, and every list screen did
 * `data?.items || []` — so a dropped signal, a mid-deploy blip or a rejected
 * session all rendered as an empty log. That is indistinguishable from real
 * emptiness, and on 25-Aug it read as a day of lost work.
 *
 * Failures now come back as `{ error }`. Callers must check it.
 */
export const adminFetch = (url, opts = {}) =>
  fetch(`/api/superadmin${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAdminToken()}`,
      ...(opts.headers || {}),
    },
  }).then(async r => {
    // Sliding session: the server hands back a fresh token once an hour of use.
    // setAdminToken REFUSES anything that is not a usable JWT, so a mangled
    // renewal is skipped rather than destroying a working session.
    const renewed = r.headers.get('X-Renewed-Token');
    if (renewed) setAdminToken(renewed);

    // A rejected session must announce itself. Returning null here would let the
    // caller render "nothing logged against this lead" — which is exactly how the
    // owner came to believe a day of interactions had been lost when the rows
    // were sitting safely in the database the whole time.
    if (r.status === 401 || r.status === 403) {
      clearAdminToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pumpini:admin-signed-out'));
      }
      return { error: 'SESSION_EXPIRED' };
    }

    let body = null, parsed = true;
    try { body = await r.json(); } catch { parsed = false; }

    // Any other failure is a FAILURE, never an empty result.
    if (!r.ok) return { error: body?.error || `Request failed (${r.status})` };

    // A 200 whose body will not parse is a failure too — an HTML error page from
    // a proxy mid-deploy looks exactly like this, and returning null here would
    // put us straight back to rendering it as "nothing here".
    if (!parsed || body === null) return { error: 'BAD_RESPONSE' };
    return body;
  }).catch(() => ({ error: 'NETWORK' }));

/**
 * Sign in with EITHER the email or the mobile number — one endpoint, one store.
 * Returns { ok, error }, and stores the token itself on success.
 */
export const adminLogin = async (identifier, password) => {
  try {
    const res  = await fetch('/api/superadmin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) return { ok: false, error: data.error || 'Invalid credentials' };
    setAdminToken(data.token);
    return { ok: true, admin: data.admin };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check the signal.' };
  }
};
