'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import { login as apiLogin, getMe } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [station, setStation] = useState(null);

  useEffect(() => {
    const token = Cookies.get('token') || localStorage.getItem('token');
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
        localStorage.removeItem('token');
        localStorage.removeItem('station');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (phone, password) => {
    const res = await apiLogin({ phone, password });
    // Save token to both cookie and localStorage
    Cookies.set('token', res.token, {
      expires: 1,
      sameSite: 'lax',
      secure: window.location.protocol === 'https:',
    });
    localStorage.setItem('token', res.token);
    setUser(res.user);
    if (res.user.stations?.length) {
      const s = res.user.stations[0];
      setStation(s);
      localStorage.setItem('station', JSON.stringify(s));
    }
    return res;
  };

  const logout = () => {
    Cookies.remove('token');
    localStorage.removeItem('token');
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
