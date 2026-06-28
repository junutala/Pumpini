'use client';
// Keeps a device on the latest build automatically. The bundle bakes in the
// build id it was compiled from (NEXT_PUBLIC_BUILD_ID); we poll /build-version
// for the build id that's actually deployed right now. When they differ, a newer
// version is live, so we show a brief "Updating…" notice and refresh the page —
// no button to tap, but never a mystery reload.
//
// Safety: this app is used for live data entry, so we never reload while a field
// is focused (mid-typing). We wait until the user isn't actively entering data,
// then show the notice and refresh.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const POLL_MS = 5 * 60 * 1000;   // re-check for a new deploy every 5 min
const RETRY_MS = 15 * 1000;      // if mid-typing, re-check for idle every 15s
const NOTICE_MS = 1500;          // how long the "Updating…" notice shows first

// True while the user is actively in a form control — don't reload out from
// under them.
function isEntering() {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function AppUpdater() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const pending = useRef(false);
  const [updating, setUpdating] = useState(false);

  const reloadWhenIdle = useCallback(() => {
    if (isEntering()) { setTimeout(reloadWhenIdle, RETRY_MS); return; }
    setUpdating(true);                                      // show the notice…
    setTimeout(() => window.location.reload(), NOTICE_MS);  // …then refresh
  }, []);

  const check = useCallback(async () => {
    // 'dev' = a local build with no deploy id; nothing meaningful to compare.
    if (BUILD === 'dev' || pending.current) return;
    try {
      const res = await fetch('/build-version', { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = await res.json();
      if (build && build !== 'dev' && build !== BUILD) {
        pending.current = true;        // a newer build is live
        reloadWhenIdle();
      }
    } catch { /* offline / transient — ignore and retry on the next tick */ }
  }, [reloadWhenIdle]);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [check]);

  if (!updating) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(15,25,35,.55)', backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: '#0F1923', color: '#fff', borderRadius: 12,
        padding: '16px 22px', fontSize: 14, fontWeight: 600,
        boxShadow: '0 8px 30px rgba(0,0,0,.35)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{
          width: 16, height: 16, border: '2px solid rgba(255,255,255,.3)',
          borderTopColor: '#FF6B00', borderRadius: '50%', display: 'inline-block',
          animation: 'pmnSpin .8s linear infinite',
        }} />
        {tc('update.updating', 'Updating Pumpini to the latest version…')}
      </div>
      <style>{'@keyframes pmnSpin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
