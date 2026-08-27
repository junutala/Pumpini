'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import api, { login as apiLogin, getMe, logoutApi } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [station, setStation] = useState(null);
  // The shift the user is currently closing — kept global so a >24h-open banner
  // and (later) AI chat can reference it app-wide.
  const [activeShift, setActiveShiftState] = useState(null);

  // WHICH FLOW THIS OUTLET RUNS — the hub-and-spokes MIGRATION FLAG, read once here
  // rather than in the Sidebar. Each page mounts its own AppShell, so the sidebar
  // remounts on every navigation and reading it there would cost one settings fetch
  // per screen on a forecourt phone. This provider mounts once at the root.
  //
  // Defaults FALSE and fails to FALSE: an outlet whose settings cannot be read runs
  // the flow it runs today. The flag never turns an outlet ON by accident.
  const [hubSpokesFlow, setHubSpokesFlow] = useState(false);
  const stationId = typeof station === 'object' ? station?.id : station;
  useEffect(() => {
    if (!stationId) { setHubSpokesFlow(false); return; }
    let cancelled = false;
    api.get(`/stations/${stationId}/settings`)
      .then(s => { if (!cancelled) setHubSpokesFlow(!!s?.hub_spokes_migration_enabled); })
      .catch(() => { if (!cancelled) setHubSpokesFlow(false); });
    return () => { cancelled = true; };
  }, [stationId]);

  useEffect(() => {
    const token = Cookies.get('token') || sessionStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    // Token exists — verify it with the backend
    getMe()
      .then(u => {
        setUser(u);
        // Prefer the stations the server just returned (always correct, with the
        // name) — this restores station context after a biometric login or a
        // reload even when logout cleared the localStorage cache.
        if (Array.isArray(u.stations) && u.stations.length) {
          setStation(u.stations[0]);
          localStorage.setItem('station', JSON.stringify(u.stations[0]));
        } else {
          const savedStation = localStorage.getItem('station');
          if (savedStation) {
            // Tolerate both a JSON object (password login) and a bare id string
            // (older biometric path wrote user.station_id raw → JSON.parse threw).
            try { setStation(JSON.parse(savedStation)); }
            catch { setStation(savedStation); }
          }
        }
        const savedShift = localStorage.getItem('activeShift');
        if (savedShift) { try { setActiveShiftState(JSON.parse(savedShift)); } catch {} }
      })
      .catch(() => {
        // Token invalid — clear everything
        Cookies.remove('token');
        sessionStorage.removeItem('token');
        localStorage.removeItem('station');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (phone, password) => {
    const res = await apiLogin({ phone, password });
    // Session-only: session cookie (no `expires`) + sessionStorage, both cleared
    // when the browser session ends. No persistence across full browser close.
    Cookies.set('token', res.token, {
      sameSite: 'lax',
      secure: window.location.protocol === 'https:',
    });
    sessionStorage.setItem('token', res.token);
    setUser(res.user);
    if (res.user.stations?.length) {
      const s = res.user.stations[0];
      setStation(s);
      localStorage.setItem('station', JSON.stringify(s));
    }
    return res;
  };

  const logout = async () => {
    // Best-effort server-side revocation (kills this token everywhere) — the
    // request interceptor still has the token at this point.
    try { await logoutApi(); } catch {}
    Cookies.remove('token');
    sessionStorage.removeItem('token');
    localStorage.removeItem('station');
    setUser(null);
    setStation(null);
    window.location.href = '/login';
  };

  const switchStation = (s) => {
    setStation(s);
    localStorage.setItem('station', JSON.stringify(s));
  };

  const setActiveShift = (s) => {
    setActiveShiftState(s);
    if (s) localStorage.setItem('activeShift', JSON.stringify(s));
    else localStorage.removeItem('activeShift');
  };

  return (
    <AuthContext.Provider value={{ user, loading, station, activeShift, setActiveShift, login, logout, switchStation, hubSpokesFlow }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) return {
    user: null, loading: true, station: null, activeShift: null,
    setActiveShift: () => {}, login: async () => {}, logout: () => {}, switchStation: () => {},
    hubSpokesFlow: false,
  };
  return ctx;
};
