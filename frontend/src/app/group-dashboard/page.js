'use client';
// Owner OPERATIONAL dashboard. Global = the rollup of all bunks; picking an outlet
// renders that bunk's manager cockpit unmasked (DashboardPage embedded). A link
// hops to the Intelligence dashboard (the analytics/decision layer).
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { RefreshCw, Building2, Bell, CheckCircle, AlertTriangle, Clock, UserX,
  Landmark, TrendingUp, TrendingDown, ChevronRight, Brain } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import DashboardPage from '../dashboard/page';
import GroupProductTiles from './GroupProductTiles';

const fmtR = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtL = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
// Coverage-date labels (house rule: en-IN · Asia/Kolkata).
const fmtFull = t => t ? new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fmtDay  = t => t ? new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '';
const card = { background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14 };
const mini = { background: 'var(--surface-2,#f8fafc)', borderRadius: 10, padding: '12px 14px' };
const health = o => (o.wetstock_beyond || o.overdue_90 > 0) ? '#dc2626' : (o.cash_undeposited > 5000 ? '#d97706' : '#16a34a');
const EXC_ICON = { cash: Clock, wetstock: AlertTriangle, overdue: UserX };

export default function GroupDashboardPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { station, switchStation } = useAuth();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [groups, setGroups]               = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedOutlet, setSelectedOutlet] = useState(null);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);

  const stationId = typeof station === 'object' ? station?.id : station;

  // Drilling into an outlet here repoints the GLOBAL station so the sidebar
  // switcher and every back-office screen (petty cash, deposits, credit…) follow
  // what you're looking at — otherwise you could view Highway but post to Kamala.
  const pickOutlet = (s) => {
    setSelectedOutlet(s?.id || null);
    if (s?.id) switchStation({ id: s.id, name: s.name });
  };

  // Reverse sync: when the sidebar switcher changes the station WHILE you're
  // already drilled into a single outlet, follow it. (Left on "All bunks" — the
  // rollup — a sidebar change is harmless, so we don't yank you off the rollup.)
  useEffect(() => {
    if (stationId && selectedOutlet && selectedOutlet !== stationId) setSelectedOutlet(stationId);
  }, [stationId]);

  const loadGroup = async (id) => {
    setLoading(true);
    // as_of=settled → each outlet's sales/margin/litres reflect its last settled
    // trade day, not the empty running "today" (Intelligence keeps today's default).
    try { setData(await api.get(`/groups/${id}/dashboard?as_of=settled`)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  const loadGroups = useCallback(() => api.get('/groups/my').then(g => {
    setGroups(g); if (g.length === 1) { setSelectedGroup(g[0]); loadGroup(g[0].id); }
  }), []);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useRefreshOnFocus(() => { if (selectedGroup) loadGroup(selectedGroup.id); });

  const st  = data?.stations || [];
  const tt  = data?.totals || {};
  const exc = data?.exceptions || [];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tc('gdash.operations', 'Operations')}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('gdash.bunksAtGlance', 'Your bunks at a glance · drill into any one')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => router.push('/intelligence')}><Brain size={14} /> {tc('gdash.intelligence', 'Intelligence')}</button>
          {selectedGroup && <button className="btn btn-secondary btn-sm" onClick={() => loadGroup(selectedGroup.id)}><RefreshCw size={14} /></button>}
        </div>
      </div>

      {groups.length > 1 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: '1rem', flexWrap: 'wrap' }}>
          {groups.map(g => (
            <button key={g.id} className={`btn ${selectedGroup?.id === g.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setSelectedGroup(g); setSelectedOutlet(null); loadGroup(g.id); }}><Building2 size={14} />{g.name}</button>
          ))}
        </div>
      )}

      {groups.length === 0 && <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>{tc('gdash.noGroup', 'You are not part of any owner group yet. Contact the administrator.')}</div>}
      {loading && <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>{tc('gdash.loading', 'Loading…')}</div>}

      {/* Outlet picker pills */}
      {data && !loading && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setSelectedOutlet(null)} style={{ padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1.5px solid ' + (!selectedOutlet ? '#23272e' : '#e5e7eb'), background: !selectedOutlet ? '#23272e' : '#fff', color: !selectedOutlet ? '#fff' : 'var(--text-2,#475569)' }}>{tc('gdash.allBunks', 'All bunks')}</button>
          {st.map(s => (
            <button key={s.id} onClick={() => pickOutlet(s)} style={{ padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1.5px solid ' + (selectedOutlet === s.id ? '#23272e' : '#e5e7eb'), background: selectedOutlet === s.id ? '#23272e' : '#fff', color: selectedOutlet === s.id ? '#fff' : 'var(--text-2,#475569)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: health(s) }} /> {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Single outlet → the same product tiles as the rollup, scoped to that bunk,
          so Group View stays one consistent language. The full manager cockpit
          lives in Bunk View (pick the outlet from the sidebar). Falls back to the
          embedded cockpit only if the per-product payload is missing. */}
      {data && !loading && selectedOutlet && (() => {
        const s = st.find(x => x.id === selectedOutlet);
        const hasFuel = s?.by_fuel && (s.by_fuel.day?.length || s.by_fuel.mtd?.length);
        return hasFuel
          ? <GroupProductTiles key={selectedOutlet} stations={[s]} asOfDate={data.as_of_date} asOfUniform={data.as_of_uniform} />
          : <DashboardPage key={selectedOutlet} stationId={selectedOutlet} embedded />;
      })()}

      {/* Global rollup */}
      {data && !loading && !selectedOutlet && (
        <>
          <div style={{ background: '#23272e', borderRadius: 14, padding: '16px 18px', color: '#f1efe8', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Building2 size={19} color="#fac775" /><span style={{ fontSize: 17, fontWeight: 700 }}>{tc('gdash.bunksLive', '{n} bunks · live').replace('{n}', st.length)}</span></div>
                <div style={{ fontSize: 12.5, color: '#b4b2a9', marginTop: 3 }}>{tc('gdash.sumOfOutlets', 'Sum of your outlets')} · {data.as_of_date ? fmtFull(data.as_of_date) : new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}{data.as_of_uniform === false ? ` · ${tc('gdash.latestPerBunk', 'latest settled day per bunk')}` : ''}</div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 99, background: exc.length ? '#633806' : '#173404', color: exc.length ? '#fac775' : '#c0dd97' }}>{exc.length ? <><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {tc('gdash.needYou', '{n} need you').replace('{n}', exc.length)}</> : <><CheckCircle size={13} style={{ verticalAlign: -2 }} /> {tc('gdash.allClear', 'all clear')}</>}</span>
            </div>
          </div>

          {/* Sales by outlet & product — Day / Month-to-date tiles + margin variance.
              Falls back to the plain totals row if the backend hasn't shipped the
              per-product payload yet (e.g. mid-deploy). */}
          {st.some(s => s.by_fuel && (s.by_fuel.day?.length || s.by_fuel.mtd?.length)) ? (
            <GroupProductTiles stations={st} asOfDate={data.as_of_date} asOfUniform={data.as_of_uniform} />
          ) : (
            <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 14 }}>
              <div style={mini}>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('gdash.sales', 'Sales')}</div>
                <div style={{ fontSize: 21, fontWeight: 800 }}>{fmtR(tt.total_sales)}</div>
                {tt.vs_yesterday_pct != null && <div style={{ fontSize: 12, color: tt.vs_yesterday_pct >= 0 ? '#3b6d11' : '#b91c1c' }}>{tt.vs_yesterday_pct >= 0 ? <TrendingUp size={12} style={{ verticalAlign: -2 }} /> : <TrendingDown size={12} style={{ verticalAlign: -2 }} />} {tt.vs_yesterday_pct >= 0 ? '+' : ''}{tt.vs_yesterday_pct}{tc('gdash.vsYest', '% vs yest.')}</div>}
              </div>
              <div style={{ ...mini, background: '#eaf3de' }}>
                <div style={{ fontSize: 12, color: '#3b6d11' }}>{tc('gdash.margin', 'Margin')}</div>
                <div style={{ fontSize: 21, fontWeight: 800, color: '#27500a' }}>{fmtR(tt.total_margin)}</div>
                {tt.group_margin_pct != null && <div style={{ fontSize: 12, color: '#3b6d11' }}>{tt.group_margin_pct}{tc('gdash.blended', '% blended')}</div>}
              </div>
              <div style={mini}><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('gdash.litres', 'Litres')}</div><div style={{ fontSize: 21, fontWeight: 800 }}>{fmtL(tt.total_litres)} L</div></div>
            </div>
          )}

          <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginBottom: 14 }}>
            <div style={{ ...card, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ width: 28, height: 28, borderRadius: 7, background: '#fee2e2', color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Landmark size={16} /></span><span style={{ fontSize: 13, color: 'var(--text-2,#475569)' }}>{tc('gdash.cashUndeposited', 'Cash undeposited')}</span></div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtR(tt.cash_undeposited)}</div>
            </div>
            <div style={{ ...card, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ width: 28, height: 28, borderRadius: 7, background: '#ede9fe', color: '#5b21b6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserX size={16} /></span><span style={{ fontSize: 13, color: 'var(--text-2,#475569)' }}>{tc('gdash.creditReceivables', 'Credit receivables')}</span></div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtR(tt.receivables_outstanding)}</div>
              {tt.overdue_90 > 0 && <div style={{ fontSize: 12, color: 'var(--danger,#dc2626)', marginTop: 2 }}>{fmtR(tt.overdue_90)} {tc('gdash.overdue90', 'overdue 90+')}</div>}
            </div>
          </div>

          <div style={{ ...card, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{tc('gdash.outlets', 'Outlets')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {st.map(s => (
                <div key={s.id} onClick={() => pickOutlet(s)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--surface-2,#f8fafc)', borderRadius: 10, flexWrap: 'wrap', cursor: 'pointer' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: health(s), flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, minWidth: 90 }}>{s.name}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2,#475569)' }}>{fmtR(s.sales)} · <span style={{ color: '#3b6d11' }}>{s.gross_margin_pct != null ? s.gross_margin_pct + '%' : '—'}</span></span>
                  {s.metric_date && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDay(s.metric_date)}</span>}
                  {s.wetstock_beyond && <span style={{ fontSize: 12, background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 99 }}>{tc('gdash.stockLoss', 'stock loss')}</span>}
                  {s.overdue_90 > 0 && <span style={{ fontSize: 12, background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 99 }}>{fmtR(s.overdue_90)} {tc('gdash.overdue', 'overdue')}</span>}
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('gdash.cash', 'cash')} {fmtR(s.cash_undeposited)}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}><ChevronRight size={16} /></span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>{tc('gdash.tapOutletHint', 'Tap an outlet to open its full cockpit (live, unmasked).')}</div>
          </div>

          {exc.length > 0 && (
            <div style={{ ...card, padding: '14px 16px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{tc('gdash.exceptions', 'Exceptions')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                {exc.map((e, i) => { const I = EXC_ICON[e.type] || AlertTriangle; return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><I size={16} color={e.type === 'cash' ? '#d97706' : '#dc2626'} /><span>{e.text}</span></div>
                ); })}
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
