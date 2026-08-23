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
import { Loader2, Check, LogOut, Plus, List, Shield, XCircle, CalendarClock } from 'lucide-react';
// The SAME control the owner uses on /admin to log a visit. One implementation,
// two screens (CLAUDE.md: reuse the form, do not open a new route).
import InteractionRecorder from '../../components/shared/InteractionRecorder';
// The owner's side. Both are REUSED, not re-implemented: the rail is the very
// component the /admin Leads tab renders, and the client is the one superadmin
// client — so a lead worked here and a lead worked on /admin are the same lead
// through the same writer.
import LeadRail from '../../components/admin/LeadRail';
// The SAME list the /admin Appointments tab renders, in its phone layout.
import AppointmentList from '../../components/admin/AppointmentList';
import { adminFetch, adminLogin, getAdminToken, clearAdminToken } from '../../lib/adminApi';

const AGENT_KEY = 'pumpini_lead_agent';
// Mirrors the /admin pipeline exactly — the rail renders the same badges on both
// screens, so a status means the same thing wherever it is read.
const LEAD_STATUS = [
  ['new',       'New',            '#dbeafe', '#1d4ed8'],
  // Field outcomes from pumpini.in/lead. 'revisit' is an OPEN item — nobody was
  // there to ask, so it is worth going back. 'refused' is closed: the manager
  // would not share the owner's details, and a second trip buys nothing.
  ['revisit',   'Revisit',        '#ffedd5', '#9a3412'],
  ['contacted', 'Contacted',      '#fef9c3', '#854d0e'],
  ['trial',     'Trial Set',      '#ede9fe', '#5b21b6'],
  ['converted', 'Converted',      '#dcfce7', '#15803d'],
  ['refused',   'Refused',        '#ffe4e6', '#9f1239'],
  ['lost',      'Lost',           '#fee2e2', '#991b1b'],
];
const ORANGE    = '#FF6B00';


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
      fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
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
              {tab('new',   <Plus size={15} />,          tc('lead.tabNew', 'New'))}
              {tab('list',  <List size={15} />,          tc('lead.tabAll', 'Leads'))}
              {tab('appts', <CalendarClock size={15} />, tc('lead.tabAppts', 'Diary'))}
            </div>
            {view === 'new'   && <LeadForm agent={owner.name || owner.email} tc={tc} onSaved={() => setView('list')} />}
            {view === 'list'  && <OwnerLeads tc={tc} />}
            {view === 'appts' && <OwnerAppointments tc={tc} />}
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

// ── Owner: what he must attend next, on the phone he is holding ─────────────
// The /admin Appointments tab is the same endpoint and the same component; only
// the layout differs, because a forecourt is not a desk.
function OwnerAppointments({ tc }) {
  const [appts, setAppts] = useState(null);   // null = still loading
  const [err, setErr]     = useState('');

  const load = useCallback(async () => {
    setErr('');
    const r = await adminFetch('/appointments');
    if (!r || !Array.isArray(r.appointments)) {
      setAppts([]);
      setErr(tc('lead.loadFailedAppts', 'Could not load your diary. Pull to refresh, or sign in again.'));
      return;
    }
    setAppts(r.appointments);
  }, [tc]);

  useEffect(() => { load(); }, [load]);

  if (appts === null) {
    return <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 14 }}>
      <Loader2 size={16} className="spin" />{tc('lead.loadingAppts', 'Loading your diary…')}
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

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10, padding: '0 2px' }}>
        <span style={{ fontSize: 12.5, color: '#666', fontWeight: 600 }}>
          {appts.length} {appts.length === 1 ? tc('lead.apptOne', 'appointment') : tc('lead.apptMany', 'appointments')}
        </span>
        <button onClick={load} style={{
          background: 'none', border: 'none', color: ORANGE, fontSize: 12.5, fontWeight: 700,
          cursor: 'pointer', padding: 0, fontFamily: 'inherit',
        }}>{tc('lead.refresh', 'Refresh')}</button>
      </div>
      <AppointmentList appointments={appts} tc={tc} compact />
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
  const [outlet, setOutlet]           = useState('');
  const [interaction, setInteraction] = useState('');
  const [appt, setAppt]               = useState('');   // datetime-local string

  // 'idle' | 'locating' | 'ok' | 'denied' | 'unsupported' | 'error'
  const [geo, setGeo] = useState({ state: 'idle', lat: null, lng: null, acc: null });

  const [recBusy, setRecBusy] = useState(false);   // mic open or transcript in flight

  const [saving, setSaving]   = useState('');   // '' | 'captured' | 'refused' | 'absent'
  const [saved, setSaved]     = useState('');
  const [saveErr, setSaveErr] = useState('');

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

  // Every field is optional (owner's call, 22-Aug-2026) — making any of them
  // mandatory would collide with the two refusal buttons, which by their nature
  // have no owner and no number. SAVE only asks that SOMETHING names the visit.
  const identified = phone.length > 0 || name.trim().length > 0 || outlet.trim().length > 0;
  const busy       = !!saving || recBusy;

  // ONE submit for all three buttons. They differ by the `outcome` they send and
  // by nothing else — same fields, same coordinates, same endpoint — so a change
  // to what a visit records reaches all three by construction.
  const submit = async (kind) => {
    setSaveErr('');
    setSaving(kind);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'direct',
          outcome: kind,
          name: name.trim() || null,
          phone: phone || null,
          station_name: outlet.trim() || null,
          message: interaction.trim() || null,
          // toInstant is the one rule for "is this actually an appointment":
          // it refuses a day with no time yet, and anything already gone.
          appointment_at: toInstant(appt),
          captured_by: agent,
          // Never partial coordinates — either the fix we got, or nothing.
          lat: geo.state === 'ok' ? geo.lat : null,
          lng: geo.state === 'ok' ? geo.lng : null,
          location_accuracy: geo.state === 'ok' ? geo.acc : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `Could not save (${res.status})`);

      setSaved(
        data.reused ? tc('lead.savedAppended', 'You had already filed this outlet — the visit was added to it.')
        : kind === 'refused' ? tc('lead.savedRefused', 'Recorded as refused. You will not be sent back here.')
        : kind === 'absent'  ? tc('lead.savedAbsent',  'Recorded. This outlet is marked for a revisit.')
        : tc('lead.savedOk', 'Lead saved.')
      );
      setPhone(''); setName(''); setOutlet(''); setInteraction(''); setAppt('');
      locate();                                  // next outlet, next fix
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { setSaved(''); onSaved?.(); }, 2500);
    } catch (e) {
      setSaveErr(e?.message || tc('lead.saveFailed', 'Could not save. Check the signal and try again.'));
    } finally {
      setSaving('');
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

      {/* The order the visit actually happens in: the board is read from the
          road, the owner is named next, and the number is the last thing given. */}
      {/* Read off the roadside board. It needs nobody's permission, and it is the
          only thing that names a visit where no number was given. */}
      <div style={card}>
        <label style={label}>{tc('lead.outletName', 'Outlet Name')}</label>
        <input style={input} value={outlet} onChange={e => setOutlet(e.target.value)}
               placeholder={tc('lead.outletNamePlaceholder', 'Name on the board')} autoComplete="off" />
      </div>

      <div style={card}>
        <label style={label}>{tc('lead.ownerName', 'Owner Name')}</label>
        <input style={input} value={name} onChange={e => setName(e.target.value)}
               placeholder={tc('lead.ownerNamePlaceholder', 'Full name')} autoComplete="off" />
      </div>

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




      {/* Coordinates and the timestamp are recorded SILENTLY on any of the three
          buttons. Nothing about the location is shown, and there is deliberately
          no warning when it is missing: the temp can do nothing with a latitude,
          and a warning they can dismiss is not what catches a denied permission.
          The owner watches this data daily and calls the temp by the second or
          third lead if the map pins are missing (owner, 22-Aug-2026) — a faster
          loop than any banner, and it needs no pixels here. */}

      {/* Interaction */}
      <div style={card}>
        <label style={label}>{tc('lead.interaction', 'Interaction')}</label>

        <InteractionRecorder value={interaction} onChange={setInteraction} tc={tc} onBusy={setRecBusy}
                             appointment={appt} onAppointmentChange={setAppt} />
      </div>


      {saveErr && (
        <div style={{ ...card, background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13.5 }}>
          {saveErr}
        </div>
      )}

      <button onClick={() => submit('captured')} disabled={!identified || busy} style={{
        width: '100%', height: 54, borderRadius: 11, border: 'none', fontFamily: 'inherit',
        background: identified && !busy ? ORANGE : '#e5e3de', color: identified && !busy ? '#fff' : '#999',
        fontSize: 16.5, fontWeight: 800, cursor: identified && !busy ? 'pointer' : 'not-allowed',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
      }}>
        {saving === 'captured'
          ? <><Loader2 size={18} className="spin" />{tc('lead.saving', 'Saving…')}</>
          : tc('lead.save', 'SAVE')}
      </button>

      {/* The visit that produced nothing still has to be recorded, because the
          two ways it can fail mean OPPOSITE things: a refusal is an outlet not to
          be sent back to, an absent manager is one that must be. Kept visually
          quieter than SAVE — they are the exception, not the choice. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '1.4rem 0 0.8rem' }}>
        <div style={{ flex: 1, height: 1, background: '#e5e3de' }} />
        <span style={{ fontSize: 11.5, color: '#999', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {tc('lead.orNoLuck', 'or, if nothing came of it')}
        </span>
        <div style={{ flex: 1, height: 1, background: '#e5e3de' }} />
      </div>

      <div style={{ display: 'grid', gap: 9, marginBottom: '2rem' }}>
        {[['refused', tc('lead.ctaRefused', 'Details refused'),
                      tc('lead.ctaRefusedSub', 'Manager would not share the owner\u2019s details')],
          ['absent',  tc('lead.ctaAbsent', 'Manager not available'),
                      tc('lead.ctaAbsentSub', 'Nobody there to ask \u2014 worth another visit')]].map(([kind, title, sub]) => (
          <button key={kind} onClick={() => submit(kind)} disabled={busy} style={{
            width: '100%', padding: '11px 14px', borderRadius: 10, fontFamily: 'inherit',
            border: '1.5px solid #ddd', background: '#fff', textAlign: 'left',
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .55 : 1,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {saving === kind
              ? <Loader2 size={17} className="spin" style={{ flexShrink: 0 }} />
              : <XCircle size={17} color="#9f1239" style={{ flexShrink: 0 }} />}
            <span>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700 }}>{title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: '#888', marginTop: 1 }}>{sub}</span>
            </span>
          </button>
        ))}
      </div>

    </div>
  );
}
