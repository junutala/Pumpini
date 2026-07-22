'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, Bell } from 'lucide-react';
import Sidebar from './Sidebar';
import FloatingChat from './FloatingChat';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../hooks/usePermissions';
import { useTranslation } from 'react-i18next';

export default function AppShell({ children }) {
  const { user, loading } = useAuth();
  const { can, loading: permLoading } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const { i18n } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Pumpini Lite: a user whose effective access is the SO tile only (a `lite`
  // outlet — Effective ∩ ['vawe.proof']) never loads the paid app. Bounce them to
  // the clean single-tile /lite page. "Free is FREE" — no empty dashboard.
  useEffect(() => {
    if (!permLoading && can('vawe.proof') && !can('dashboard.view') && pathname !== '/lite') {
      router.replace('/lite');
    }
  }, [permLoading, can, pathname, router]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    // The language chosen at login/landing (persisted by i18next in localStorage)
    // takes precedence. Only fall back to the user's saved profile language when
    // no explicit choice has been made yet in this browser.
    if (user?.language && typeof window !== 'undefined') {
      const explicit = window.localStorage.getItem('i18nextLng');
      if (!explicit) i18n.changeLanguage(user.language);
    }
  }, [user, loading]);

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100dvh',background:'#0F1923'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:28,fontWeight:900,marginBottom:16}}>
          <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
        </div>
        <div style={{width:32,height:32,border:'3px solid rgba(255,255,255,.1)',borderTopColor:'#FF6B00',borderRadius:'50%',animation:'spin .7s linear infinite',margin:'0 auto'}}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  if (!user) return null;

  return (
    <>
      {/* Single sidebar — handles both desktop (sticky) and mobile (fixed+overlay) */}
      <div style={{display:'flex',minHeight:'100dvh',background:'var(--bg)'}}>
        
        {/* Sidebar — always rendered once */}
        <Sidebar open={sidebarOpen} onClose={()=>setSidebarOpen(false)}/>

        {/* Main content */}
        <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

          {/* Mobile top bar — hidden on desktop via CSS */}
          <header className="mobile-topbar" style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'0 1rem', height:52, background:'#0F1923',
            position:'sticky', top:0, zIndex:30, flexShrink:0,
          }}>
            <button onClick={()=>setSidebarOpen(true)}
              style={{background:'none',border:'none',cursor:'pointer',padding:6,color:'rgba(255,255,255,.7)'}}>
              <Menu size={22}/>
            </button>
            <span style={{fontWeight:900,fontSize:18}}>
              <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
            </span>
            <button style={{background:'none',border:'none',cursor:'pointer',padding:6,color:'rgba(255,255,255,.5)'}}>
              <Bell size={20}/>
            </button>
          </header>

          <main style={{flex:1,padding:'1.5rem',overflow:'auto'}}>
            {children}
          </main>
        </div>
      </div>

      <FloatingChat/>

      <style>{`
        /* Desktop: sidebar is sticky in normal flow */
        @media (min-width: 769px) {
          .mobile-topbar { display: none !important; }
          .sidebar-overlay { display: none !important; }
        }

        /* Mobile: sidebar slides in as overlay */
        @media (max-width: 768px) {
          .sidebar {
            position: fixed !important;
            left: -240px !important;
            top: 0 !important;
            z-index: 50 !important;
            height: 100dvh !important;
            transition: left .25s ease !important;
          }
          .sidebar.open {
            left: 0 !important;
          }
          .sidebar-overlay {
            position: fixed !important;
            inset: 0 !important;
            background: rgba(0,0,0,.5) !important;
            z-index: 40 !important;
            display: none !important;
          }
          .sidebar-overlay.open {
            display: block !important;
          }
        }
      `}</style>
    </>
  );
}
