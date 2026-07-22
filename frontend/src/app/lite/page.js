'use client';
// Pumpini Lite — the free, SO-tile-only home for a `lite` outlet's staff.
// Deliberately ONE clean tile: no dashboard, no sidebar, no empty zeros
// ("Free is FREE"). The manager sees the SO's instruction, sets a commit date,
// and uploads proof; an escalated owner sees it here too. The very same
// SoInstructionsTile the paid app uses — so the upgrade path is seamless.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../hooks/usePermissions';
import SoInstructionsTile from '../../components/shared/SoInstructionsTile';

export default function LitePage() {
  const router = useRouter();
  const { user, station, logout, loading: authLoading } = useAuth();
  const { can, loading: permLoading } = usePermissions();
  const stationId = typeof station === 'object' ? station?.id : station;
  const stationName = typeof station === 'object' ? station?.name : station;

  // Not logged in → login. A full-app user who lands here → their real home.
  useEffect(() => { if (!authLoading && !user) router.replace('/login'); }, [authLoading, user, router]);
  useEffect(() => { if (!permLoading && can('dashboard.view')) router.replace('/'); }, [permLoading, can, router]);

  if (authLoading || !user) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100dvh', background:'#0F1923' }}>
        <div style={{ fontSize:26, fontWeight:900 }}>
          <span style={{ color:'#FF6B00' }}>pump</span><span style={{ color:'#4DC3E8' }}>ini</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg,#f8fafc)' }}>
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0.85rem 1.1rem', background:'#0F1923', color:'#fff',
        position:'sticky', top:0, zIndex:10,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          <div style={{ width:30, height:30, background:'#FF6B00', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Zap size={16} color="#fff" fill="#fff" />
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:900, fontSize:17, lineHeight:1, letterSpacing:'-.02em' }}>
              <span style={{ color:'#FF6B00' }}>pump</span><span style={{ color:'#4DC3E8' }}>ini</span>
            </div>
            {stationName && (
              <div style={{ fontSize:10.5, color:'rgba(255,255,255,.4)', marginTop:2, lineHeight:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:180 }}>
                {stationName}
              </div>
            )}
          </div>
        </div>
        <button onClick={logout} style={{ background:'none', border:'none', color:'rgba(255,255,255,.6)', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <LogOut size={15} /> Logout
        </button>
      </header>

      <main style={{ maxWidth:680, margin:'0 auto', padding:'1.25rem 1rem' }}>
        {stationId
          ? <SoInstructionsTile stationId={stationId} standalone />
          : <div style={{ textAlign:'center', color:'var(--text-3,#94a3b8)', padding:'3rem 1rem' }}>No outlet linked to your account yet.</div>}
      </main>
    </div>
  );
}
