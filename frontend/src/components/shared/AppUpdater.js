'use client';
// Pulls a device off a stale build. The bundle bakes in the build id it was
// compiled from (NEXT_PUBLIC_BUILD_ID); we poll /build-version for the build id
// that's actually deployed right now. When they differ, a newer version is live,
// so we surface a one-tap "Update now".
//
// We PROMPT rather than auto-reload on purpose: this app is used for live data
// entry, and a silent reload would discard a half-filled form. The owner can flip
// this to auto-reload later if preferred.
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const POLL_MS = 5 * 60 * 1000;

export default function AppUpdater() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [ready, setReady] = useState(false);

  const check = useCallback(async () => {
    // 'dev' = a local build with no deploy id; nothing meaningful to compare.
    if (BUILD === 'dev' || ready) return;
    try {
      const res = await fetch('/build-version', { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = await res.json();
      if (build && build !== 'dev' && build !== BUILD) setReady(true);
    } catch { /* offline / transient — ignore and retry on the next tick */ }
  }, [ready]);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [check]);

  if (!ready) return null;

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, flexWrap: 'wrap',
      padding: '10px 16px', background: '#0F1923', color: '#fff',
      boxShadow: '0 -2px 12px rgba(0,0,0,.25)', fontSize: 14,
    }}>
      <span>{tc('update.banner', 'A new version of Pumpini is available.')}</span>
      <button onClick={() => window.location.reload()} style={{
        background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 8,
        padding: '7px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
      }}>
        {tc('update.action', 'Update now')}
      </button>
    </div>
  );
}
