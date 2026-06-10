'use client';
// Auto-logout after a period of inactivity. Bunk terminals are shared, so a
// walked-away session shouldn't stay open. Only arms while a user is logged in;
// any real interaction (move/key/touch/scroll/click) resets the countdown.
// A short warning toast appears before the logout fires.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';

const IDLE_MS    = 20 * 60 * 1000; // log out after 20 min idle
const WARN_MS    = 60 * 1000;      // show warning 60s before logout

export default function IdleTimer() {
  const { user, logout } = useAuth();
  const idleRef = useRef(null);
  const warnRef = useRef(null);
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (!user) { setWarning(false); return; }

    const clear = () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (warnRef.current) clearTimeout(warnRef.current);
    };
    const reset = () => {
      clear();
      setWarning(false);
      warnRef.current = setTimeout(() => setWarning(true), IDLE_MS - WARN_MS);
      idleRef.current = setTimeout(() => { try { logout(); } catch {} }, IDLE_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const opts = { passive: true };
    events.forEach(e => window.addEventListener(e, reset, opts));
    reset();

    return () => {
      events.forEach(e => window.removeEventListener(e, reset, opts));
      clear();
    };
  }, [user, logout]);

  if (!user || !warning) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      background: '#1f2937', color: '#fff', padding: '12px 18px', borderRadius: 10,
      boxShadow: '0 10px 30px rgba(0,0,0,.3)', zIndex: 9999, fontSize: 13.5,
      display: 'flex', alignItems: 'center', gap: 12, maxWidth: '90vw',
    }}>
      <span>⚠️ You'll be logged out shortly due to inactivity.</span>
      <button onClick={() => setWarning(false)}
        style={{ background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 7,
          padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
        Stay signed in
      </button>
    </div>
  );
}
