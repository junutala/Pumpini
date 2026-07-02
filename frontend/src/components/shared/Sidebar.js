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
  Menu, Package, CheckSquare, RotateCcw, Wallet, ShieldAlert, Droplet, Banknote, Calculator,
  Thermometer, Hourglass, PlayCircle, StopCircle, UserPlus
} from 'lucide-react';

// Build id of the running bundle — shown in the footer so a device's version is
// verifiable at a glance (handy right before a demo).
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

const NAV_GROUPS = [
  {
    label: 'Dashboard',
    items: [
      { key:'group',      href:'/group-dashboard', icon:Globe,          perm:'group.view',   roles:['owner'] },
      { key:'dashboard',  href:'/dashboard',       icon:LayoutDashboard,perm:null },
      { key:'live',       href:'/live',            icon:Activity,       perm:'dispense.view' },
      { key:'alerts',     href:'/alerts',          icon:Bell,           perm:'alerts.view' },
    ]
  },
  {
    label: 'Shift',
    items: [
      { key:'startshift', href:'/shift-start',     icon:PlayCircle,     perm:'shifts.view' },
      { key:'pos',        href:'/pos',             icon:ShoppingCart,   perm:'dispense.entry' },
      { key:'endshift',   href:'/shift-end',       icon:StopCircle,     perm:'shifts.view' },
      { key:'settlement', href:'/settlement',      icon:Receipt,        perm:null, roles:['attendant'] },
    ]
  },
  {
    label: 'Stock',
    items: [
      { key:'deliveries', href:'/deliveries',      icon:Truck,          perm:'deliveries.view' },
      { key:'dipstick',   href:'/dipstick',        icon:Gauge,          perm:'dipstick.view' },
      { key:'density',    href:'/density-register',icon:Thermometer,    perm:'dipstick.view' },
      { key:'stockreco',  href:'/stock-reco',      icon:Droplet,        perm:'stock.reconcile' },
    ]
  },
  {
    label: 'Credit',
    items: [
      { key:'invoices',   href:'/invoices',        icon:FileText,       perm:'invoice.generate' },
      { key:'receipts',   href:'/receipts',        icon:Receipt,        perm:'invoice.generate' },
      { key:'creditnotes',href:'/credit-notes',    icon:RotateCcw,      perm:'invoice.generate' },
    ]
  },
  {
    label: 'Cash',
    items: [
      { key:'pettycash',  href:'/petty-cash',      icon:Wallet,         perm:'pettycash.manage' },
      { key:'deposits',   href:'/deposits',        icon:Banknote,       perm:'deposits.manage' },
      { key:'cashintegrity', href:'/cash-integrity', icon:ShieldAlert,  perm:'cash.integrity', roles:['owner'] },
    ]
  },
  {
    label: 'Reports',
    items: [
      { key:'dispense',   href:'/dispense',        icon:Fuel,           perm:'reconcile.manage' },
      { key:'reports',    href:'/reports',         icon:BarChart2,      perm:'reports.view' },
      { key:'credit_reports', href:'/reports/credit', icon:Hourglass,   perm:'reports.view', roles:['owner','manager'] },
      { key:'tally',      href:'/tally',           icon:Calculator,     perm:'tally.export' },
    ]
  },
  {
    label: 'Lubes',
    items: [
      { key:'lube_catalogue', href:'/products/catalogue', icon:Package,      perm:'lubes.manage' },
      { key:'lube_stock',     href:'/products/stock',     icon:Layers,       perm:'lubes.manage' },
      { key:'lube_pos',       href:'/products/pos',       icon:ShoppingCart, perm:'lubes.manage' },
      { key:'lube_invoices',  href:'/products/history',   icon:Receipt,      perm:'lubes.manage' },
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
    label: 'Admin',
    items: [
      { key:'addattendant',   href:'/add-attendant', icon:UserPlus, perm:'attendant.add' },
      { key:'users',          href:'/users',     icon:Users,       perm:'users.manage',     roles:['owner'] },
      { key:'responsibilities',href:'/templates',icon:ShieldAlert, perm:'users.manage',     roles:['owner'] },
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
  invoices:'Credit Invoices',  receipts:'Credit Receipts', settings:'Settings',
  creditnotes:'Credit Notes',
  pettycash:'Petty Cash',
  deposits:'Bank Deposits',
  tally:'Tally Export',
  cashintegrity:'Cash Integrity',
  stockreco:'Stock Reco',
  density:'Density Register',
  credit_reports:'Credit Reports',
  creditdash:'Credit Dashboard',
  lube_catalogue:'Catalogue', lube_stock:'Stock',
  lube_pos:'Lube POS',        lube_invoices:'GST Invoices',
  reconcile:'Reconciliation',
  users:'Users',             responsibilities:'Responsibilities',
  addattendant:'Add Attendant',
  startshift:'Start Shift',  endshift:'End Shift',  pos:'POS',
};

// Group header key is derived as nav.grp_<label> (e.g. Shift -> nav.grp_shift),
// so every group translates as long as the key exists in the locale files.

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
    const key = `nav.grp_${label.toLowerCase()}`;
    const tr = t(key);
    return tr === key ? label : tr;
  };

  const isVisible = (item) => {
    if (item.roles && !item.roles.includes(user?.role)) return false;
    // Operators are locked to their own settlement screen — hide every nav item
    // (incl. perm:null ones like Bunk View) that isn't explicitly tagged for them.
    if (user?.role === 'attendant' && !(item.roles || []).includes('attendant')) return false;
    // Owner is now gated by can() too — but can() returns true via the 'ALL'
    // sentinel until a plan is configured, so nothing hides until then.
    if (item.perm  && !can(item.perm)) return false;
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
            <div style={{marginTop:8,fontSize:9,color:'rgba(255,255,255,.2)',textAlign:'center',letterSpacing:'.04em'}}>
              v{BUILD}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
