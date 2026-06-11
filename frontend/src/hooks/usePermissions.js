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
    if (user.role === 'owner') setPermissions(['ALL']); // optimistic; fetch refines (gated plan)
    api.get(`/templates/user-permissions?user_id=${user.id}&station_id=${stationId}`)
      .then(res => setPermissions(res.permissions || (user.role === 'owner' ? ['ALL'] : [])))
      .catch(() => setPermissions(user.role === 'owner' ? ['ALL'] : []))
      .finally(() => setLoading(false));
  }, [user?.id, stationId]);

  const can = (module) => {
    if (!user) return false;
    // 'ALL' is the fail-open sentinel (no plan configured). Once a plan is
    // configured, even the owner is capped to the plan's modules.
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
