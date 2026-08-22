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

export const setAdminToken = (token) => {
  try { localStorage.setItem(ADMIN_TOKEN_KEY, token); } catch { /* private mode */ }
};

export const clearAdminToken = () => {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* private mode */ }
};

/**
 * Superadmin fetch. Resolves to null on a non-JSON or 5xx reply (e.g. mid-deploy)
 * rather than throwing — every caller already treats null as "no data", and a
 * throw here would blank a whole screen during a Railway restart.
 */
export const adminFetch = (url, opts = {}) =>
  fetch(`/api/superadmin${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAdminToken()}`,
      ...(opts.headers || {}),
    },
  }).then(r => r.json()).catch(() => null);

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
