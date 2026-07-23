// Product analytics (PostHog) — central config.
//
// One PostHog project (EU cloud) serves BOTH Pumpini and VAWE; every event is
// tagged with `app` (here: "pumpini") so the two products are filtered apart in
// the dashboard. The project token is a write-only public key, safe to ship to
// the browser; it is read from the environment so any environment WITHOUT the
// var (staging, local) is a clean no-op — nothing is captured.
//
// Owner's pick (2026-07-23): only these pages are measured — the three
// dashboards (tracked separately) and the shift open/close flows. The public
// landing page (/) and all auth pages are deliberately untracked.

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
export const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

export const TRACKED_PATHS = [
  '/dashboard', // outlet cockpit
  '/group-dashboard', // owner group rollup
  '/credit-dashboard', // credit
  '/shift-start',
  '/shift-end',
];

export function isTrackedPath(pathname) {
  if (!pathname) return false;
  return TRACKED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

// PostHog autocapture (automatic click tracking) matches these regexes against
// the full URL. Anchored so "/dashboard" does NOT also match "/group-dashboard"
// or "/credit-dashboard" — each tracked page, and only it, enables clicks.
export const AUTOCAPTURE_URL_ALLOWLIST = TRACKED_PATHS.map(
  (p) => `${p.replace(/\//g, '\\/')}(\\/|\\?|#|$)`,
);
