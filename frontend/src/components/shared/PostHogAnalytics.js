'use client';

// Mounts once (in the root layout) and drives PostHog:
//  - initialises the SDK only when a key is configured (else a clean no-op, so
//    the public landing page and any env without the var send nothing);
//  - tags every event with app:"pumpini";
//  - sends a pageview on every route change, but ONLY for allowlisted pages
//    (the three dashboards + shift open/close).
// Autocapture (click tracking) is limited to the same pages via the SDK's
// url_allowlist (see lib/analytics). The landing page at "/" is never tracked
// because it is not in the allowlist.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import {
  POSTHOG_KEY,
  POSTHOG_HOST,
  isTrackedPath,
  AUTOCAPTURE_URL_ALLOWLIST,
} from '../../lib/analytics';

let initialized = false;

export default function PostHogAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (initialized || !POSTHOG_KEY) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false, // sent manually below, allowlisted
      capture_pageleave: true,
      autocapture: { url_allowlist: AUTOCAPTURE_URL_ALLOWLIST },
      person_profiles: 'identified_only',
    });
    posthog.register({ app: 'pumpini' });
    initialized = true;
  }, []);

  useEffect(() => {
    if (!initialized || !POSTHOG_KEY) return;
    if (isTrackedPath(pathname)) {
      posthog.capture('$pageview');
    }
  }, [pathname]);

  return null;
}
