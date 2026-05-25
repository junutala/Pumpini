'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import {
  LayoutDashboard, RefreshCw, Fuel, Building2, Users, Calendar,
  Gauge, Bell, BarChart2, Settings, LogOut, X, Zap
} from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard',  href: '/dashboard',   icon: LayoutDashboard, roles: ['owner','manager','attendant','corporate'] },
  { key: 'shifts',     href: '/shifts',       icon: RefreshCw,       roles: ['owner','manager','attendant'] },
  { key: 'dispense',   href: '/dispense',     icon: Fuel,            roles: ['owner','manager','attendant'] },
  { key: 'corporate',  href: '/corporate',    icon: Building2,       roles: ['owner','manager','corporate'] },
  { key: 'attendance', href: '/attendance',   icon: Calendar,        roles: ['owner','manager'] },
  { key: 'dipstick',   href: '/dipstick',     icon: Gauge,           roles: ['owner','manager','attendant'] },
  { key: 'users',      href: '/users',        icon: Users,           roles: ['owner','manager'] },
  { key: 'alerts',     href: '/alerts',       icon: Bell,            roles: ['owner','manager'] },
  { key: 'reports',    href: '/reports',      icon: BarChart2,       roles: ['owner','manager'] },
  { key: 'settings',   href: '/settings',     icon: Settings,        roles: ['owner','manager'] },
];

export default function Sidebar({ open, onClose }) {
  const { t, i18n } = useTranslation();
  const { user, logout, station } = useAuth();
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter(item => !user || item.roles.includes(user.role));

  return (
    <>
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {/* Logo */}
        <div style={{ padding: '1rem 1.25rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, background: 'var(--brand)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={18} color="#fff" fill="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>Petrol DMS</div>
                {station && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{typeof station === 'object' ? station.name : station}</div>}
              </div>
            </div>
            <button onClick={onClose} style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} className="md:hidden">
              <X size={18} color="var(--text-3)" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0.5rem 0', overflowY: 'auto' }}>
          {visible.map(item => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.key} href={item.href} className={`nav-link ${active ? 'active' : ''}`} onClick={onClose}>
                <Icon size={17} />
                {t(`nav.${item.key}`)}
              </Link>
            );
          })}
        </nav>

        {/* User + Logout */}
        {user && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1rem' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>{user.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>{t(`roles.${user.role}`)}</div>
            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={logout}>
              <LogOut size={14} />{t('logout')}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
