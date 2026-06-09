'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import { login as apiLogin, getMe, logoutApi } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [station, setStation] = useState(null);

  useEffect(() => {
    const token = Cookies.get('token') || sessionStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    // Token exists — verify it with the backend
    getMe()
      .then(u => {
        setUser(u);
        const savedStation = localStorage.getItem('station');
        if (savedStation) {
          try { setStation(JSON.parse(savedStation)); } catch {}
        }
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

  return (
    <AuthContext.Provider value={{ user, loading, station, login, logout, switchStation }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) return {
    user: null, loading: true, station: null,
    login: async () => {}, logout: () => {}, switchStation: () => {}
  };
  return ctx;
};
