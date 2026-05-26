'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../hooks/usePermissions';
import {
  LayoutDashboard, RefreshCw, Fuel, Building2, Users, Calendar,
  Gauge, Bell, BarChart2, Settings, LogOut, Zap, ShoppingCart,
  Globe, Shield
} from 'lucide-react';

const NAV_ITEMS = [
  { key:'dashboard',  href:'/dashboard',       icon:LayoutDashboard, perm:null,               roles:null },
  { key:'group',      href:'/group-dashboard', icon:Globe,           perm:null,               roles:['owner'] },
  { key:'shifts',     href:'/shifts',          icon:RefreshCw,       perm:'shifts.view',      roles:null },
  { key:'pos',        href:'/pos',             icon:ShoppingCart,    perm:'dispense.entry',   roles:null },
  { key:'dispense',   href:'/dispense',        icon:Fuel,            perm:'reconcile.manage', roles:null },
  { key:'corporate',  href:'/corporate',       icon:Building2,       perm:'corporate.view',   roles:null },
  { key:'attendance', href:'/attendance',      icon:Calendar,        perm:'attendance.view',  roles:null },
  { key:'dipstick',   href:'/dipstick',        icon:Gauge,           perm:'dipstick.view',    roles:null },
  { key:'users',      href:'/users',           icon:Users,           perm:'users.manage',     roles:null },
  { key:'alerts',     href:'/alerts',          icon:Bell,            perm:'alerts.view',      roles:null },
  { key:'reports',    href:'/reports',         icon:BarChart2,       perm:'reports.view',     roles:null },
  { key:'settings',   href:'/settings',        icon:Settings,        perm:'settings.manage',  roles:null },
  { key:'admin',      href:'/admin',           icon:Shield,          perm:null,               roles:['superadmin'] },
];

const NAV_LABELS = {
  dashboard:'Dashboard', group:'Group View', shifts:'Shifts',
  pos:'POS Entry', dispense:'Reconciliation', corporate:'Corporate',
  attendance:'Attendance', dipstick:'Dipstick', users:'Users',
  alerts:'Alerts', reports:'Reports', settings:'Settings', admin:'Admin Panel'
};

export default function Sidebar({ open, onClose }) {
  const { i18n } = useTranslation();
  const { user, logout, station } = useAuth();
  const { can } = usePermissions();
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter(item => {
    if (item.roles && !item.roles.includes(user?.role)) return false;
    if (item.perm && !can(item.perm) && user?.role !== 'owner') return false;
    return true;
  });

  return (
    <>
      <div className={`sidebar-overlay ${open?'open':''}`} onClick={onClose}/>
      <aside className={`sidebar ${open?'open':''}`}>
        {/* Logo */}
        <div style={{padding:'1rem 1.25rem 0.75rem',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:34,height:34,background:'var(--brand)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Zap size={18} color="#fff" fill="#fff"/>
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:16,lineHeight:1.2}}>
                  <span style={{color:'var(--brand)'}}>pump</span><span style={{color:'var(--teal,#1a5f7a)'}}>ini</span>
                </div>
                {station && <div style={{fontSize:11,color:'var(--text-3)',marginTop:1}}>{typeof station==='object'?station.name:station}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{flex:1,padding:'0.5rem 0',overflowY:'auto'}}>
          {visible.map(item=>{
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.key} href={item.href}
                className={`nav-link ${active?'active':''}`} onClick={onClose}>
                <Icon size={17}/>
                {NAV_LABELS[item.key]}
              </Link>
            );
          })}
        </nav>

        {/* User info + logout */}
        {user && (
          <div style={{borderTop:'1px solid var(--border)',padding:'0.75rem 1rem'}}>
            <div style={{fontSize:13,fontWeight:500,color:'var(--text-1)',marginBottom:2}}>{user.name}</div>
            <div style={{fontSize:12,color:'var(--text-3)',marginBottom:10,textTransform:'capitalize'}}>{user.role}</div>
            <button className="btn btn-secondary" style={{width:'100%',justifyContent:'center'}} onClick={logout}>
              <LogOut size={14}/>Logout
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
