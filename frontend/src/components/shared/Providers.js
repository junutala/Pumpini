'use client';
import { AuthProvider } from '../../lib/auth';
import { PermissionProvider } from '../../hooks/usePermissions';
import '../../i18n';

export default function Providers({ children }) {
  return (
    <AuthProvider>
      <PermissionProvider>
        {children}
      </PermissionProvider>
    </AuthProvider>
  );
}
