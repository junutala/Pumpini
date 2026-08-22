'use client';
// pumpini.in/lead — the cold-capture tool for field staff.
//
// A temp resource walks a highway, gets an owner's mobile at the counter, speaks
// what was said, saves, and moves to the next outlet. Their whole day is this one
// screen repeated, so it stays a single scrolling column with nothing to navigate.
//
// TWO DOORS, ONE URL:
//
//   • A temp signs in with a mobile number entered twice and gets the capture
//     form ONLY. Write-only, which is precisely what makes an any-mobile gate
//     harmless — the credential guards nothing but the ability to add.
//   • The owner signs in with a mobile OR email plus a REAL password, against
//     the existing `superadmins` store, and gets everything: every temp's leads,
//     the rail, the full history, and the same capture form.
//
// Why not a "leadadmin" user type: a third credential store is the drift the
// cardinal rule bans, and mobile+mobile on a browse-everything screen would make
// a phone number — which is not a secret — the password to the whole pipeline.
//
// The mobile that signed in is stored as `captured_by`: self-declared, never a
// verified identity, and no code downstream may read it as proof of one. It also
// scopes the duplicate check — a temp re-visiting an outlet they already filed
// adds an interaction to that lead instead of creating a second one.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Loader2, Check, RefreshCw, LogOut, AlertTriangle, Plus, List, Shield } from 'lucide-react';
// The SAME control the owner uses on /admin to log a visit. One implementation,
// two screens (CLAUDE.md: reuse the form, do not open a new route).
import InteractionRecorder from '../../components/shared/InteractionRecorder';
// The owner's side. Both are REUSED, not re-implemented: the rail is the very
// component the /admin Leads tab renders, and the client is the one superadmin
// client — so a lead worked here and a lead worked on /admin are the same lead
// through the same writer.
import LeadRail from '../../components/admin/LeadRail';
import { adminFetch, adminLogin, getAdminToken, clearAdminToken } from '../../lib/adminApi';

const AGENT_KEY = 'pumpini_lead_agent';
// Mirrors the /admin pipeline exactly — the rail renders the same badges on both
// screens, so a status means the same thing wherever it is read.
const LEAD_STATUS = [
  ['new',       'New',       '#dbeafe', '#1d4ed8'],
  ['contacted', 'Contacted', '#fef9c3', '#854d0e'],
  ['trial',     'Trial Set', '#ede9fe', '#5b21b6'],
  ['converted', 'Converted', '#dcfce7', '#15803d'],
  ['lost',      'Lost',      '#fee2e2', '#991b1b'],
];
const ORANGE    = '#FF6B00';

// House rule: en-IN + Asia/Kolkata, never a raw ISO timestamp, never MM/DD.
const fmtDateTime = (d) => new Date(d).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(0, 10);

const card = {
  background: '#fff', borderRadius: 14, border: '1px solid #e5e3de',
  padding: '1.1rem', marginBottom: '0.9rem',
};
const label = {
  display: 'block', fontSize: 11.5, fontWeight: 700, color: '#666',
  textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 7,
};
const input = {
  width: '100%', padding: '12px 13px', border: '1.5px solid #ddd', borderRadius: 9,
  fontSize: 16, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  background: '#fff',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function LeadPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [agent, setAgent] = useState(null);    // temp: the mobile that signed in
  const [owner, setOwner] = useState(null);    // owner: the decoded superadmin JWT
  const [ready, setReady] = useState(false);   // storage read done (SSR guard)
  const [view, setView]   = useState('new');   // owner only: 'new' | 'list'

  useEffect(() => {
    // An owner session wins: if a valid superadmin token is present there is no
    // reason to show the lesser door, even if a temp mobile is also remembered
    // on this device.
    const token = getAdminToken();
    if (token) {
      try {
        const p = JSON.parse(atob(token.split('.')[1]));
        if (p.isSuperAdmin && p.exp > Date.now() / 1000) setOwner(p);
        else clearAdminToken();
      } catch { clearAdminToken(); }
    }
    try { setAgent(localStorage.getItem(AGENT_KEY)); } catch { /* private mode */ }
    setReady(true);
  }, []);

  const signInTemp = (mobile) => {
    try { localStorage.setItem(AGENT_KEY, mobile); } catch { /* ignore */ }
    setAgent(mobile);
  };

  const signOut = () => {
    try { localStorage.removeItem(AGENT_KEY); } catch { /* ignore */ }
    clearAdminToken();
    setAgent(null);
    setOwner(null);
    setView('new');
  };

  if (!ready) return null;   // avoid a flash of the gate for a signed-in user

  const who = owner ? (owner.name || owner.email) : agent;

  const tab = (id, icon, text) => (
    <button onClick={() => setView(id)} style={{
      flex: 1, height: 40, border: 'none', borderRadius: 9, cursor: 'pointer',
      fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      background: view === id ? '#1a1a1a' : 'transparent',
      color: view === id ? '#fff' : '#666',
    }}>{icon}{text}</button>
  );

  return (
    <div style={{ minHeight: '100dvh', background: '#faf9f7', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a' }}>
      <header style={{
        background: ORANGE, color: '#fff', padding: '0.85rem 1rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-.01em' }}>
          Pumpini <span style={{ fontWeight: 500, opacity: .9 }}>{tc('lead.leads', 'Leads')}</span>
        </div>
        {who && (
          <button onClick={signOut} style={{
            background: 'rgba(255,255,255,.18)', color: '#fff', border: 'none', borderRadius: 7,
            padding: '6px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
            maxWidth: '60%',
          }}>
            {owner && <Shield size={12} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
            <LogOut size={13} style={{ flexShrink: 0 }} />
          </button>
        )}
      </header>

      <main style={{ maxWidth: 620, margin: '0 auto', padding: '1rem' }}>
        {owner ? (
          <>
            {/* The owner gets both: file a lead himself, or work the pipeline. */}
            <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #e5e3de',
                          borderRadius: 11, padding: 4, marginBottom: '0.9rem' }}>
              {tab('new',  <Plus size={15} />, tc('lead.tabNew', 'New Lead'))}
              {tab('list', <List size={15} />, tc('lead.tabAll', 'All Leads'))}
            </div>
            {view === 'new'
              ? <LeadForm agent={owner.name || owner.email} tc={tc} onSaved={() => setView('list')} />
              : <OwnerLeads tc={tc} />}
          </>
        ) : agent ? (
          <LeadForm agent={agent} tc={tc} />
        ) : (
          <Gate onSignInTemp={signInTemp} onSignInOwner={setOwner} tc={tc} />
        )}
      </main>

      <style jsx global>{`
        .spin { animation: leadspin 1s linear infinite; }
        @keyframes leadspin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── Gate: two doors ──────────────────────────────────────────────────────────
// Staff: a mobile number twice, for a screen that can only add.
// Owner: mobile OR email plus a real password, against the one `superadmins`
// store — the same credential and the same endpoint as the /admin console, so
// signing in here signs you in there.
function Gate({ onSignInTemp, onSignInOwner, tc }) {
  const [door, setDoor] = useState('staff');   // 'staff' | 'owner'

  const [mobile, setMobile]   = useState('');
  const [confirm, setConfirm] = useState('');

  const [ident, setIdent]     = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]       = useState(false);

  const [err, setErr] = useState('');

  const submitStaff = (e) => {
    e.preventDefault();
    if (mobile.length !== 10) return setErr(tc('lead.errMobile10', 'Enter a 10-digit mobile number.'));
    if (mobile !== confirm)   return setErr(tc('lead.errMobileMatch', 'The two numbers do not match.'));
    setErr('');
    onSignInTemp(mobile);
  };

  const submitOwner = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const res = await adminLogin(ident.trim(), password);
    setBusy(false);
    if (!res.ok) return setErr(res.error || tc('lead.errCredentials', 'Invalid credentials.'));
    // Decode the token we were just given rather than round-tripping for a
    // profile — it is the same JWT /admin reads.
    try {
      const p = JSON.parse(atob(getAdminToken().split('.')[1]));
      onSignInOwner(p);
    } catch {
      setErr(tc('lead.errCredentials', 'Invalid credentials.'));
    }
  };

  const doorTab = (id, text) => (
    <button type="button" onClick={() => { setDoor(id); setErr(''); }} style={{
      flex: 1, height: 38, border: 'none', borderRadius: 8, cursor: 'pointer',
      fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
      background: door === id ? '#1a1a1a' : 'transparent',
      color: door === id ? '#fff' : '#666',
    }}>{text}</button>
  );

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #e5e3de',
                    borderRadius: 10, padding: 4, marginBottom: '0.9rem' }}>
        {doorTab('staff', tc('lead.doorStaff', 'Field staff'))}
        {doorTab('owner', tc('lead.doorOwner', 'Owner'))}
      </div>

      {door === 'staff' ? (
        <form onSubmit={submitStaff} style={card}>
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 4px' }}>{tc('lead.signInTitle', 'Sign in')}</h1>
          <p style={{ fontSize: 13.5, color: '#666', margin: '0 0 1.1rem', lineHeight: 1.5 }}>
            {tc('lead.signInHint', 'Enter your mobile number twice. It is recorded against every lead you file.')}
          </p>

          <label style={label}>{tc('lead.yourMobile', 'Your mobile number')}</label>
          <input style={{ ...input, marginBottom: 12 }} value={mobile} inputMode="numeric" autoComplete="tel"
                 placeholder="9876543210" onChange={e => setMobile(tenDigits(e.target.value))} />

          <label style={label}>{tc('lead.confirmMobile', 'Confirm mobile number')}</label>
          <input style={input} value={confirm} inputMode="numeric" autoComplete="off"
                 placeholder="9876543210" onChange={e => setConfirm(tenDigits(e.target.value))} />

          {err && <p style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{err}</p>}

          <button type="submit" style={{
            width: '100%', marginTop: 16, height: 48, background: ORANGE, color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 15.5, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>{tc('lead.continue', 'Continue')}</button>
        </form>
      ) : (
        <form onSubmit={submitOwner} style={card}>
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 4px',
                       display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Shield size={17} color={ORANGE} />{tc('lead.ownerSignIn', 'Owner sign-in')}
          </h1>
          <p style={{ fontSize: 13.5, color: '#666', margin: '0 0 1.1rem', lineHeight: 1.5 }}>
            {tc('lead.ownerSignInHint', 'Your Pumpini admin email or mobile, and your password. This shows every lead your staff have filed.')}
          </p>

          <label style={label}>{tc('lead.emailOrMobile', 'Email or mobile')}</label>
          <input style={{ ...input, marginBottom: 12 }} value={ident} type="text" autoComplete="username"
                 placeholder="admin@pumpini.in" onChange={e => setIdent(e.target.value)} />

          <label style={label}>{tc('lead.password', 'Password')}</label>
          <input style={input} value={password} type="password" autoComplete="current-password"
                 onChange={e => setPassword(e.target.value)} />

          {err && <p style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{err}</p>}

          <button type="submit" disabled={busy || !ident.trim() || !password} style={{
            width: '100%', marginTop: 16, height: 48, fontFamily: 'inherit',
            background: busy || !ident.trim() || !password ? '#e5e3de' : ORANGE,
            color: busy || !ident.trim() || !password ? '#999' : '#fff',
            border: 'none', borderRadius: 10, fontSize: 15.5, fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            {busy ? <><Loader2 size={17} className="spin" />{tc('lead.signingIn', 'Signing in…')}</>
                  : tc('lead.signIn', 'Sign in')}
          </button>
        </form>
      )}
    </div>
  );
}

// ── Owner: the whole pipeline, through the same rail /admin renders ──────────
function OwnerLeads({ tc }) {
  const [leads, setLeads] = useState(null);   // null = still loading
  const [err, setErr]     = useState('');

  const load = useCallback(async () => {
    setErr('');
    const r = await adminFetch('/leads');
    if (!Array.isArray(r)) {
      setLeads([]);
      setErr(tc('lead.loadFailed', 'Could not load the leads. Pull to refresh, or sign in again.'));
      return;
    }
    setLeads(r);
  }, [tc]);

  useEffect(() => { load(); }, [load]);

  if (leads === null) {
    return <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 14 }}>
      <Loader2 size={16} className="spin" />{tc('lead.loadingLeads', 'Loading leads…')}
    </div>;
  }

  if (err) {
    return <div style={{ ...card, textAlign: 'center', padding: '2rem 1.1rem' }}>
      <p style={{ fontSize: 14, color: '#991b1b', margin: 0, lineHeight: 1.6 }}>{err}</p>
      <button onClick={load} style={{
        marginTop: 14, background: 'none', border: 'none', color: ORANGE, fontSize: 13,
        fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
      }}>{tc('lead.retry', 'Try again')}</button>
    </div>;
  }

  return <LeadRail leads={leads} statuses={LEAD_STATUS} adminFetch={adminFetch} tc={tc} onChanged={load} />;
}

// ── The capture form ─────────────────────────────────────────────────────────
function LeadForm({ agent, tc, onSaved }) {
  const [phone, setPhone]             = useState('');
  const [name, setName]               = useState('');
  const [interaction, setInteraction] = useState('');
  const [now, setNow]                 = useState(() => new Date());

  // 'idle' | 'locating' | 'ok' | 'denied' | 'unsupported' | 'error'
  const [geo, setGeo] = useState({ state: 'idle', lat: null, lng: null, acc: null });

  const [recBusy, setRecBusy] = useState(false);   // mic open or transcript in flight

  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState('');
  const [saveErr, setSaveErr] = useState('');

  // Live clock. What is STORED is the server's created_at; this is only what the
  // temp sees, so a half-minute tick is plenty.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return setGeo({ state: 'unsupported', lat: null, lng: null, acc: null });
    setGeo(g => ({ ...g, state: 'locating' }));
    navigator.geolocation.getCurrentPosition(
      pos => setGeo({ state: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      err => setGeo({ state: err.code === err.PERMISSION_DENIED ? 'denied' : 'error', lat: null, lng: null, acc: null }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  }, []);

  useEffect(() => { locate(); }, [locate]);

  const canSave = phone.length === 10 && name.trim().length > 0 && !saving && !recBusy;

  const save = async () => {
    setSaveErr('');
    setSaving(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'direct',
          name: name.trim(),
          phone,
          message: interaction.trim() || null,
          captured_by: agent,
          // Never partial coordinates — either the fix we got, or nothing.
          lat: geo.state === 'ok' ? geo.lat : null,
          lng: geo.state === 'ok' ? geo.lng : null,
          location_accuracy: geo.state === 'ok' ? geo.acc : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `Could not save (${res.status})`);

      setSaved(data.reused
        ? tc('lead.savedAppended', 'You had already filed this number — the note was added to that lead.')
        : tc('lead.savedOk', 'Lead saved.'));
      setPhone(''); setName(''); setInteraction('');
      locate();                                  // next outlet, next fix
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { setSaved(''); onSaved?.(); }, 2500);
    } catch (e) {
      setSaveErr(e?.message || tc('lead.saveFailed', 'Could not save. Check the signal and try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {saved && (
        <div style={{
          ...card, background: '#dcfce7', border: '1px solid #86efac', color: '#15803d',
          display: 'flex', alignItems: 'flex-start', gap: 9, fontWeight: 600, fontSize: 14, lineHeight: 1.5,
        }}>
          <Check size={18} style={{ flexShrink: 0, marginTop: 1 }} />{saved}
        </div>
      )}

      {/* Mobile number — the one field that must be right, so it gets the room. */}
      <div style={card}>
        <label style={label}>{tc('lead.mobileNumber', 'Mobile Number')}</label>
        <input
          value={phone}
          onChange={e => setPhone(tenDigits(e.target.value))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000000000"
          style={{
            width: '100%', border: 'none',
            borderBottom: `2.5px solid ${phone.length === 10 ? '#86efac' : '#e5e3de'}`,
            outline: 'none', background: 'transparent', boxSizing: 'border-box',
            fontSize: 'clamp(30px, 9vw, 44px)', fontWeight: 800, letterSpacing: '.06em',
            padding: '4px 0 8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums',
            color: '#1a1a1a', fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={card}>
        <label style={label}>{tc('lead.ownerName', 'Owner Name')}</label>
        <input style={input} value={name} onChange={e => setName(e.target.value)}
               placeholder={tc('lead.ownerNamePlaceholder', 'Full name')} autoComplete="off" />
      </div>

      {/* Location */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ ...label, marginBottom: 0 }}>{tc('lead.location', 'Location')}</span>
          <button onClick={locate} disabled={geo.state === 'locating'} style={{
            background: 'none', border: 'none', color: ORANGE, fontSize: 12.5, fontWeight: 700,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
            fontFamily: 'inherit',
          }}>
            <RefreshCw size={12} className={geo.state === 'locating' ? 'spin' : ''} />
            {geo.state === 'locating' ? tc('lead.locating', 'Locating…') : tc('lead.refresh', 'Refresh')}
          </button>
        </div>

        {geo.state === 'ok' ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <MapPin size={17} color="#15803d" style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
              </div>
              <div style={{ fontSize: 12.5, color: '#666', marginTop: 2 }}>
                {tc('lead.accuracy', 'Accurate to about')} ±{Math.round(geo.acc)} m
              </div>
            </div>
          </div>
        ) : geo.state === 'locating' ? (
          <div style={{ fontSize: 13.5, color: '#666', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Loader2 size={15} className="spin" />{tc('lead.gettingLocation', 'Getting your location…')}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#854d0e' }}>
            <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              {geo.state === 'denied'
                ? tc('lead.locDenied', 'Location permission was refused. Allow it in your browser settings, or save without it.')
                : geo.state === 'unsupported'
                  ? tc('lead.locUnsupported', 'This browser cannot report a location.')
                  : tc('lead.locFailed', 'Could not get a location.')}
              <div style={{ color: '#666', marginTop: 3 }}>{tc('lead.locSaveAnyway', 'The lead will save without coordinates.')}</div>
            </div>
          </div>
        )}
      </div>

      {/* Interaction */}
      <div style={card}>
        <label style={label}>{tc('lead.interaction', 'Interaction')}</label>

        <InteractionRecorder value={interaction} onChange={setInteraction} tc={tc} onBusy={setRecBusy} />
      </div>

      <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ ...label, marginBottom: 0 }}>{tc('lead.dateTime', 'Date & Time')}</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{fmtDateTime(now)}</span>
      </div>

      {saveErr && (
        <div style={{ ...card, background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13.5 }}>
          {saveErr}
        </div>
      )}

      <button onClick={save} disabled={!canSave} style={{
        width: '100%', height: 54, borderRadius: 11, border: 'none', fontFamily: 'inherit',
        background: canSave ? ORANGE : '#e5e3de', color: canSave ? '#fff' : '#999',
        fontSize: 16.5, fontWeight: 800, cursor: canSave ? 'pointer' : 'not-allowed',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        marginBottom: '2rem',
      }}>
        {saving ? <><Loader2 size={18} className="spin" />{tc('lead.saving', 'Saving…')}</> : tc('lead.save', 'SAVE')}
      </button>
    </div>
  );
}
