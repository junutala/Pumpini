'use client';

// frontend/src/hooks/useRefreshOnFocus.js
//
// Non-destructive recovery for "stale screen after the tab was idle".
// When the tab has been hidden for a while and becomes visible again, or when
// the network comes back online, this re-runs your page's data fetch. It
// REFRESHES DATA — it never calls window.location.reload(), so SPA state and
// any open forms are preserved.
//
// Usage in a page:
//   const load = useCallback(async () => { ... }, [stationId]);
//   useEffect(() => { if (authLoading) return; load(); }, [authLoading, load]);
//   useRefreshOnFocus(load);                 // refetch on wake / reconnect
//
// Options:
//   enabled  – set false to pause (e.g. while a modal is open). Default true.
//   staleMs  – only refetch if the tab was hidden at least this long.
//              Default 30000 (30s) so quick tab-switches don't spam the API.

import { useEffect, useRef } from 'react';

export function useRefreshOnFocus(refetch, { enabled = true, staleMs = 30000 } = {}) {
  // Keep the latest refetch without re-binding listeners every render.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const hiddenAtRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      // Became visible — refetch only if it was hidden long enough.
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : Infinity;
      hiddenAtRef.current = null;
      if (hiddenFor >= staleMs) {
        Promise.resolve(refetchRef.current?.()).catch(() => {});
      }
    };

    const onOnline = () => {
      Promise.resolve(refetchRef.current?.()).catch(() => {});
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, staleMs]);
}

export default useRefreshOnFocus;
