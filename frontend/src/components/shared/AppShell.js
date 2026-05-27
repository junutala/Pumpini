'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Bell } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';

export default function AppShell({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { i18n } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (user?.language) i18n.changeLanguage(user.language);
  }, [user, loading]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Mobile top bar */}
        <header style={{
          display: 'none', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1rem', height: 52,
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, zIndex: 30,
        }} className="mobile-header">
          <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
            <Menu size={22} color="var(--text-1)" />
          </button>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Petrol DMS</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
            <Bell size={20} color="var(--text-2)" />
          </button>
        </header>

        <main style={{ flex: 1, padding: '1.5rem', maxWidth: '100%', overflow: 'auto' }}>
          {children}
        </main>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .mobile-header { display: flex !important; }
          main { padding: 1rem !important; }
        }
      `}</style>
    </div>
  );
}
