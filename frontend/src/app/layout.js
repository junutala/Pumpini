import './globals.css';
import { AuthProvider } from '../lib/auth';
import { PermissionProvider } from '../hooks/usePermissions';

export const metadata = {
  title: 'Pumpini — Control Every Drop',
  description: 'Petrol Station Management System',
  manifest: '/manifest.json',
  themeColor: '#e07b0c',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true"/>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
      </head>
      <body>
        <AuthProvider>
          <PermissionProvider>
            {children}
          </PermissionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
