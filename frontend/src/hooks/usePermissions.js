'use client';
import { useState, useEffect, createContext, useContext } from 'react';
import api from '../lib/api';
import { useAuth } from '../lib/auth';

const PermContext = createContext({ permissions: [], can: () => false, loading: true });

export function PermissionProvider({ children }) {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !stationId) {
      // Owner gets everything
      if (user?.role === 'owner') {
        setPermissions(['ALL']);
      }
      setLoading(false);
      return;
    }
    api.get(`/templates/user-permissions?user_id=${user.id}&station_id=${stationId}`)
      .then(res => setPermissions(res.permissions || []))
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false));
  }, [user?.id, stationId]);

  const can = (module) => {
    if (!user) return false;
    if (user.role === 'owner') return true;
    if (permissions.includes('ALL')) return true;
    return permissions.includes(module);
  };

  return (
    <PermContext.Provider value={{ permissions, can, loading }}>
      {children}
    </PermContext.Provider>
  );
}

export const usePermissions = () => useContext(PermContext);
