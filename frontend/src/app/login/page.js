'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login }   = useAuth();
  const router      = useRouter();

  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Accept only digits, max 10
  const handlePhone = (val) => {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (phone.length !== 10) {
      setError('Please enter your 10-digit mobile number');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const res = await login(phone, password);
      if (res?.user?.must_change_password) {
        router.replace('/change-password');
      } else {
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err.error || 'Invalid mobile number or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight:'100dvh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      background:'#0F1923', padding:'1rem',
    }}>

      {/* Card */}
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

        <form onSubmit={handleSubmit}>
          {/* Mobile number */}
          <div style={{marginBottom:'1rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
              Mobile Number
            </label>
            <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',
              borderRadius:10,overflow:'hidden',transition:'border-color .2s',
              ...(phone.length>0?{borderColor:'#FF6B00'}:{})
            }}>
              <div style={{
                background:'#f8f8f8', padding:'12px 12px',
                fontSize:14, color:'#888', borderRight:'1px solid #ddd',
                whiteSpace:'nowrap', fontWeight:500,
              }}>
                🇮🇳 +91
              </div>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="9876543210"
                value={phone}
                onChange={e=>handlePhone(e.target.value)}
                maxLength={10}
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
            <div style={{fontSize:11,color:'#aaa',marginTop:4}}>
              Enter 10-digit number without +91
            </div>
          </div>

          {/* Password */}
          <div style={{marginBottom:'1.5rem'}}>
            <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
              Password
            </label>
            <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',
              borderRadius:10,overflow:'hidden',transition:'border-color .2s',
              ...(password.length>0?{borderColor:'#FF6B00'}:{})
            }}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e=>setPassword(e.target.value)}
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
              width:'100%', height:50, background: phone.length===10 ? '#FF6B00' : '#ccc',
              color:'#fff', border:'none', borderRadius:10,
              fontSize:16, fontWeight:700, cursor: phone.length===10 ? 'pointer' : 'not-allowed',
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
