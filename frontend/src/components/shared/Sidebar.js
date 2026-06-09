'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../hooks/usePermissions';
import {
  LayoutDashboard, RefreshCw, Fuel, Building2, Users, Calendar,
  Gauge, Bell, BarChart2, Settings, LogOut, Zap, ShoppingCart,
  Globe, FileText, Activity, Layers, Truck, CreditCard, Receipt,
  Menu, Package, MessageSquare, CheckSquare
} from 'lucide-react';

const NAV_GROUPS = [
  {
    label: 'Dashboard',
    items: [
      { key:'group',      href:'/group-dashboard', icon:Globe,          perm:null,            roles:['owner'] },
      { key:'dashboard',  href:'/dashboard',       icon:LayoutDashboard,perm:null },
      { key:'live',       href:'/live',            icon:Activity,       perm:'dispense.view' },
      { key:'alerts',     href:'/alerts',          icon:Bell,           perm:'alerts.view' },
    ]
  },
  {
    label: 'Transactions',
    items: [
      { key:'pos',        href:'/pos',             icon:ShoppingCart,   perm:'dispense.entry' },
      { key:'reconcile',  href:'/reconcile',       icon:CheckSquare,    perm:'reconcile.manage' },
    ]
  },
  {
    label: 'Manage',
    items: [
      { key:'shifts',     href:'/shifts',          icon:RefreshCw,      perm:'shifts.view' },
      { key:'attendance', href:'/attendance',      icon:Calendar,       perm:'attendance.view' },
      { key:'dipstick',   href:'/dipstick',        icon:Gauge,          perm:'dipstick.view' },
      { key:'deliveries', href:'/deliveries',      icon:Truck,          perm:'shifts.manage' },
      { key:'invoices',   href:'/invoices',        icon:FileText,       perm:'invoice.generate' },
      { key:'receipts',   href:'/receipts',        icon:Receipt,        perm:'invoice.generate' },
      { key:'dispense',   href:'/dispense',        icon:Fuel,           perm:'reconcile.manage' },
      { key:'reports',    href:'/reports',         icon:BarChart2,      perm:'reports.view' },
      { key:'products',   href:'/products/catalogue', icon:Package,      perm:'shifts.manage', label:'Products' },
    ]
  },
  {
    label: 'Masters',
    items: [
      { key:'corporate',  href:'/corporate',       icon:Building2,      perm:'corporate.view' },
      { key:'creditdash', href:'/credit-dashboard',icon:CreditCard,     perm:null, roles:['corporate'] },
    ]
  },
  {
    label: 'Assistant',
    items: [
      { key:'aichat',     href:'/ai-chat',         icon:MessageSquare,  perm:null },
    ]
  },
  {
    label: 'Settings',
    items: [
      { key:'settings',   href:'/settings',        icon:Settings,       perm:'settings.manage' },
    ]
  },
];

const NAV_LABELS = {
  dashboard:'Bunk View',   live:'Live Events',      pos:'POS Entry',
  shifts:'Shifts',          dispense:'Dispense Log', attendance:'Attendance',
  dipstick:'Dipstick',      deliveries:'Deliveries', corporate:'Credit Customers',
  group:'Group View',       reports:'Reports',       alerts:'Alerts',
  invoices:'GST Invoices',  receipts:'Credit Receipts', settings:'Settings',
  creditdash:'Credit Dashboard',
  products:'Products (Lubes)',
  reconcile:'Reconciliation',
  aichat:'AI Assistant',
};

const GROUP_KEYS = {
  Dashboard:'grp_dashboard', Transactions:'grp_transactions',
  Manage:'grp_manage', Masters:'grp_masters', Assistant:'grp_assistant', Settings:'grp_settings'
};

export default function Sidebar({ open, onClose }) {
  const { user, logout, station } = useAuth();
  const { can }    = usePermissions();
  const { t }      = useTranslation();
  const pathname   = usePathname();

  const navLabel = (key) => {
    const translated = t(`nav.${key}`);
    return translated === `nav.${key}` ? (NAV_LABELS[key] || key) : translated;
  };

  const groupLabel = (label) => {
    const key = GROUP_KEYS[label];
    if (!key) return label;
    const tr = t(`nav.${key}`);
    return tr === `nav.${key}` ? label : tr;
  };

  const isVisible = (item) => {
    if (item.roles && !item.roles.includes(user?.role)) return false;
    if (item.perm  && !can(item.perm) && user?.role !== 'owner') return false;
    return true;
  };

  return (
    <>
      <div className={`sidebar-overlay ${open?'open':''}`} onClick={onClose}/>

      <aside style={{
        width: 220,
        background: '#0F1923',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100dvh',
        overflowY: 'auto',
        flexShrink: 0,
      }} className={`sidebar ${open?'open':''}`}>

        {/* Logo */}
        <div style={{padding:'1.1rem 1rem 0.9rem',borderBottom:'1px solid rgba(255,255,255,.07)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:32,height:32,background:'#FF6B00',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Zap size={17} color="#fff" fill="#fff"/>
            </div>
            <div>
              <div style={{fontWeight:900,fontSize:18,lineHeight:1,letterSpacing:'-.02em'}}>
                <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
              </div>
              {station && (
                <div style={{fontSize:10,color:'rgba(255,255,255,.35)',marginTop:2,lineHeight:1,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {typeof station==='object'?station.name:station}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Nav groups */}
        <nav style={{flex:1,padding:'0.5rem 0',overflowY:'auto'}}>
          {NAV_GROUPS.map(group => {
            const visible = group.items.filter(isVisible);
            if (!visible.length) return null;
            return (
              <div key={group.label} style={{marginBottom:'0.25rem'}}>
                <div style={{
                  fontSize:10,fontWeight:700,letterSpacing:'.1em',textTransform:'uppercase',
                  color:'rgba(255,255,255,.25)',padding:'10px 16px 4px',
                }}>
                  {groupLabel(group.label)}
                </div>
                {visible.map(item => {
                  const Icon   = item.icon;
                  const active = pathname === item.href || pathname.startsWith(item.href+'/');
                  return (
                    <Link key={item.key} href={item.href}
                      onClick={onClose}
                      style={{
                        display:'flex', alignItems:'center', gap:9,
                        padding:'8px 16px',
                        background: active ? 'rgba(255,107,0,.15)' : 'transparent',
                        color: active ? '#FF6B00' : 'rgba(255,255,255,.6)',
                        fontSize:13, fontWeight: active ? 600 : 400,
                        textDecoration:'none',
                        borderLeft: active ? '3px solid #FF6B00' : '3px solid transparent',
                        transition:'all .15s',
                      }}
                      onMouseEnter={e=>{ if(!active) { e.currentTarget.style.background='rgba(255,255,255,.05)'; e.currentTarget.style.color='rgba(255,255,255,.85)'; }}}
                      onMouseLeave={e=>{ if(!active) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(255,255,255,.6)'; }}}>
                      <Icon size={15}/>
                      {navLabel(item.key)}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        {user && (
          <div style={{borderTop:'1px solid rgba(255,255,255,.07)',padding:'0.85rem 1rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(255,107,0,.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:'#FF6B00'}}>{(user.name||'?')[0].toUpperCase()}</span>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,.85)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.name}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,.35)',textTransform:'capitalize'}}>{user.role}</div>
              </div>
            </div>
            <button onClick={logout} style={{
              width:'100%',background:'rgba(255,255,255,.07)',border:'none',
              color:'rgba(255,255,255,.5)',borderRadius:7,padding:'7px 10px',
              cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:6,
            }}>
              <LogOut size={12}/>{t('nav.logout') === 'nav.logout' ? 'Logout' : t('nav.logout')}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
