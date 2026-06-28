'use client';
import { AuthProvider } from '../../lib/auth';
import { PermissionProvider } from '../../hooks/usePermissions';
import IdleTimer from './IdleTimer';
import AppUpdater from './AppUpdater';
import '../../i18n';

export default function Providers({ children }) {
  return (
    <AuthProvider>
      <PermissionProvider>
        <IdleTimer />
        <AppUpdater />
        {children}
      </PermissionProvider>
    </AuthProvider>
  );
}
