'use client';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { Eye, EyeOff, Loader2, Fingerprint, CheckCircle } from 'lucide-react';
import api from '../../lib/api';

// Lazy-import browser SDK only on client
let startAuthentication, startRegistration;

// Post-login landing: owners see the multi-outlet group view; everyone else
// (manager/attendant) lands on their outlet's bunk cockpit.
const landingFor = (u) => (
  u?.role === 'owner' ? '/group-dashboard'    // group rollup is owner-only (margins/analysis)
  : u?.role === 'attendant' ? '/settlement'   // operators land straight on their settlement screen
  : '/dashboard'                              // manager, CCO, rsa… land on the outlet cockpit
);

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login }   = useAuth();
  const router      = useRouter();

  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Biometric state
  const [bioSupported, setBioSupported]       = useState(false);
  const [bioLoading,   setBioLoading]         = useState(false);
  const [bioError,     setBioError]           = useState('');
  // Post-login: offer to register biometric
  const [showRegPrompt, setShowRegPrompt]     = useState(false);
  const [regLoading,    setRegLoading]        = useState(false);
  const [regDone,       setRegDone]           = useState(false);
  const [pendingData,   setPendingData]       = useState(null); // { token, user }

  useEffect(() => {
    // Check WebAuthn support
    if (typeof window !== 'undefined' &&
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(available => setBioSupported(available))
        .catch(() => setBioSupported(false));
    }

    // Dynamically import browser SDK
    import('@simplewebauthn/browser').then(mod => {
      startAuthentication = mod.startAuthentication;
      startRegistration   = mod.startRegistration;
    });
  }, []);

  const handlePhone = (val) => {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
  };

  // Normal password login
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (phone.length !== 10) { setError('Please enter your 10-digit mobile number'); return; }
    if (!password)            { setError('Please enter your password'); return; }

    setLoading(true);
    try {
      const res = await login(phone, password);

      if (res?.user?.must_change_password) {
        window.location.href = '/change-password';
        return;
      }

      // Check if biometric is supported and not yet registered
      if (bioSupported) {
        try {
          const status = await api.get('/auth/passkey/status');
          if (!status.registered) {
            // Offer to register — store pending data and show prompt
            setPendingData(res);
            setShowRegPrompt(true);
            return;
          }
        } catch {}
      }

      window.location.href = landingFor(res?.user);
    } catch (err) {
      setError(err.error || 'Invalid mobile number or password');
    } finally {
      setLoading(false);
    }
  };

  // Register biometric after successful login
  const handleRegister = async () => {
    if (!startRegistration) return;
    setRegLoading(true);
    setBioError('');
    try {
      const options  = await api.post('/auth/passkey/register-begin', {});
      const attResp  = await startRegistration({ optionsJSON: options });
      await api.post('/auth/passkey/register-finish', attResp);
      setRegDone(true);
      setTimeout(() => { window.location.href = landingFor(pendingData?.user); }, 1200);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setBioError('Fingerprint prompt was cancelled.');
      } else {
        setBioError(err.message || 'Registration failed. You can set it up later in Settings.');
      }
    } finally {
      setRegLoading(false);
    }
  };

  // Login with biometric (discoverable credential)
  const handleBioLogin = async () => {
    if (!startAuthentication) return;
    setBioLoading(true);
    setBioError('');
    try {
      const beginRes = await api.post('/auth/passkey/auth-begin', {});
      const { sessionKey, ...options } = beginRes;
      const assertResp = await startAuthentication({ optionsJSON: options });
      const result = await api.post('/auth/passkey/auth-finish', { sessionKey, ...assertResp });

      // Save token the same way useAuth does
      const { token, user } = result;
      document.cookie = `token=${token}; path=/`; // session cookie (cleared on browser close)
      sessionStorage.setItem('token', token);
      if (user.station_id) localStorage.setItem('station', user.station_id);
      if (user.language)   localStorage.setItem('i18nextLng', user.language);

      if (user.must_change_password) {
        window.location.href = '/change-password';
      } else {
        window.location.href = landingFor(user);
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setBioError('Fingerprint prompt was cancelled.');
      } else {
        setBioError(err.error || err.message || 'Biometric login failed. Use your password instead.');
      }
    } finally {
      setBioLoading(false);
    }
  };

  // ── Post-login biometric registration prompt ─────────────
  if (showRegPrompt) {
    return (
      <div style={{
        minHeight:'100dvh', display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        background:'#0F1923', padding:'1rem',
      }}>
        <div style={{
          background:'#fff', borderRadius:20, padding:'2.5rem',
          width:'100%', maxWidth:380, textAlign:'center',
          boxShadow:'0 20px 60px rgba(0,0,0,.4)',
        }}>
          {regDone ? (
            <>
              <CheckCircle size={48} color="#16a34a" style={{margin:'0 auto 1rem'}}/>
              <h2 style={{margin:'0 0 8px',fontSize:20,fontWeight:800}}>Fingerprint Enabled!</h2>
              <p style={{color:'#666',fontSize:14}}>Redirecting to dashboard…</p>
            </>
          ) : (
            <>
              <div style={{width:64,height:64,background:'#fff7ed',borderRadius:'50%',
                display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 1.25rem'}}>
                <Fingerprint size={32} color="#FF6B00"/>
              </div>
              <h2 style={{margin:'0 0 10px',fontSize:20,fontWeight:800}}>Enable Fingerprint Login?</h2>
              <p style={{color:'#666',fontSize:14,marginBottom:'1.5rem',lineHeight:1.6}}>
                Next time you can log in instantly with your fingerprint — no password needed.
              </p>

              {bioError && (
                <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,
                  padding:'10px 14px',fontSize:13,marginBottom:'1rem',border:'1px solid #fca5a5'}}>
                  {bioError}
                </div>
              )}

              <button onClick={handleRegister} disabled={regLoading}
                style={{width:'100%',height:50,background:'#FF6B00',color:'#fff',
                  border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:10}}>
                {regLoading
                  ? <><Loader2 size={18} style={{animation:'spin .7s linear infinite'}}/> Setting up…</>
                  : <><Fingerprint size={18}/> Enable Fingerprint</>}
              </button>

              <button onClick={() => { window.location.href = '/dashboard'; }}
                style={{width:'100%',height:44,background:'transparent',color:'#888',
                  border:'1px solid #ddd',borderRadius:10,fontSize:14,cursor:'pointer'}}>
                Maybe Later
              </button>
            </>
          )}
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ── Main login page ──────────────────────────────────────
  return (
    <div style={{
      minHeight:'100dvh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      background:'#0F1923', padding:'1rem',
    }}>
      <div style={{
        background:'#fff', borderRadius:20, padding:'2.5rem',
        width:'100%', maxWidth:380,
        boxShadow:'0 20px 60px rgba(0,0,0,.4)',
      }}>
        {/* Logo */}
        <div style={{textAlign:'center',marginBottom:'2rem'}}>
          <Image src="/pumpini-logo.png" alt="Pumpini" width={180} height={56}
            style={{objectFit:'contain',margin:'0 auto',display:'block'}}/>
        </div>

        {/* Biometric login button */}
        {bioSupported && (
          <>
            <button onClick={handleBioLogin} disabled={bioLoading}
              style={{
                width:'100%', height:50, marginBottom:'1rem',
                background: bioLoading ? '#e5e7eb' : '#0F1923',
                color:'#fff', border:'none', borderRadius:10,
                fontSize:15, fontWeight:700, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                transition:'background .2s',
              }}>
              {bioLoading
                ? <><Loader2 size={18} style={{animation:'spin .7s linear infinite'}}/> Verifying…</>
                : <><Fingerprint size={20} color="#FF6B00"/> Login with Fingerprint</>}
            </button>

            {bioError && (
              <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,
                padding:'10px 14px',fontSize:13,marginBottom:'1rem',border:'1px solid #fca5a5'}}>
                {bioError}
              </div>
            )}

            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:'1rem'}}>
              <div style={{flex:1,height:1,background:'#e5e7eb'}}/>
              <span style={{fontSize:12,color:'#aaa',whiteSpace:'nowrap'}}>or login with password</span>
              <div style={{flex:1,height:1,background:'#e5e7eb'}}/>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit}>
          {/* Mobile number */}
          <div style={{marginBottom:'1rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
              Mobile Number
            </label>
            <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',
              borderRadius:10,overflow:'hidden',transition:'border-color .2s',
              ...(phone.length>0?{borderColor:'#FF6B00'}:{})}}>
              <div style={{
                background:'#f8f8f8', padding:'12px 12px',
                fontSize:14, color:'#888', borderRight:'1px solid #ddd',
                whiteSpace:'nowrap', fontWeight:500,
              }}>
                🇮🇳 +91
              </div>
              <input
                type="tel" inputMode="numeric" placeholder="9876543210"
                value={phone} onChange={e=>handlePhone(e.target.value)} maxLength={10}
                style={{
                  flex:1, padding:'12px 14px', border:'none', outline:'none',
                  fontSize:16, fontFamily:'var(--font-mono,monospace)',
                  letterSpacing:'0.08em', background:'transparent',
                }}
                required
              />
              {phone.length > 0 && (
                <div style={{padding:'0 10px',fontSize:12,
                  color: phone.length===10 ? '#16a34a' : '#888'}}>
                  {phone.length}/10
                </div>
              )}
            </div>
            <div style={{fontSize:11,color:'#aaa',marginTop:4}}>Enter 10-digit number without +91</div>
          </div>

          {/* Password */}
          <div style={{marginBottom:'1.5rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
              Password
            </label>
            <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',
              borderRadius:10,overflow:'hidden',transition:'border-color .2s',
              ...(password.length>0?{borderColor:'#FF6B00'}:{})}}>
              <input
                type={showPw ? 'text' : 'password'} placeholder="••••••••"
                value={password} onChange={e=>setPassword(e.target.value)}
                style={{
                  flex:1, padding:'12px 14px', border:'none', outline:'none',
                  fontSize:15, background:'transparent',
                }}
                required
              />
              <button type="button" onClick={()=>setShowPw(p=>!p)}
                style={{background:'none',border:'none',cursor:'pointer',
                  padding:'0 14px',color:'#aaa',display:'flex',alignItems:'center'}}>
                {showPw ? <EyeOff size={18}/> : <Eye size={18}/>}
              </button>
            </div>
          </div>

          {/* Language */}
          <div style={{marginBottom:'1.5rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
              Language
            </label>
            <select
              value={i18n.language}
              onChange={e=>i18n.changeLanguage(e.target.value)}
              style={{
                width:'100%', padding:'12px 14px', border:'1.5px solid #ddd',
                borderRadius:10, outline:'none', fontSize:15, background:'#fff',
                color:'#333', cursor:'pointer',
              }}>
              {LANGUAGES.map(l=>(
                <option key={l.code} value={l.code}>{l.native}</option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background:'#fee2e2', color:'#991b1b', borderRadius:8,
              padding:'10px 14px', fontSize:13, marginBottom:'1rem',
              border:'1px solid #fca5a5',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button type="submit" disabled={loading || phone.length !== 10}
            style={{
              width:'100%', height:50,
              background: phone.length===10 ? '#FF6B00' : '#ccc',
              color:'#fff', border:'none', borderRadius:10,
              fontSize:16, fontWeight:700,
              cursor: phone.length===10 ? 'pointer' : 'not-allowed',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              transition:'background .2s',
            }}>
            {loading ? <Loader2 size={20} style={{animation:'spin .7s linear infinite'}}/> : null}
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>

        {/* Forgot password */}
        <div style={{textAlign:'center',marginTop:'1rem'}}>
          <button type="button"
            onClick={()=>router.push('/forgot-password')}
            style={{background:'none',border:'none',color:'#FF6B00',fontSize:13,cursor:'pointer',textDecoration:'underline'}}>
            {t('fp_page.forgot_password') === 'fp_page.forgot_password' ? 'Forgot Password?' : t('fp_page.forgot_password')}
          </button>
        </div>

        <div style={{textAlign:'center',marginTop:'0.75rem',fontSize:12,color:'#bbb'}}>
          Secure login · Data encrypted
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
