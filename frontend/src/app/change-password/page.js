'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const router = useRouter();
  const { user, logout } = useAuth();

  const [newPw,    setNewPw]    = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showNew,  setShowNew]  = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    if (newPw.length < 6) { setError(tc('chpwd.pwShort','Password must be at least 6 characters')); return; }
    if (newPw !== confirm) { setError(tc('chpwd.pwMismatch','Passwords do not match')); return; }
    setLoading(true);
    try {
      await api.post('/auth/change-password', { new_password: newPw });
      setDone(true);
      setTimeout(()=>{ logout(); router.replace('/login'); }, 2000);
    } catch(err) {
      setError(err.error||tc('chpwd.changeFailed','Failed to change password. Please try again.'));
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#0F1923',padding:'1rem'}}>
      <div style={{background:'#fff',borderRadius:20,padding:'2.5rem',width:'100%',maxWidth:380,boxShadow:'0 20px 60px rgba(0,0,0,.4)'}}>

        <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
          <div style={{fontSize:28,fontWeight:900}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#1A5F7A'}}>ini</span>
          </div>
        </div>

        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'10px 14px',marginBottom:'1.5rem',fontSize:13,color:'#9a3412'}}>
          🔐 {tc('chpwd.changeSub','You must set a new password before continuing.')}
        </div>

        <h2 style={{fontSize:17,fontWeight:700,marginBottom:'1.5rem',textAlign:'center',color:'#111'}}>
          {tc('chpwd.changeTitle','Change Your Password')}
        </h2>

        {!done ? (
          <form onSubmit={handleSubmit}>
            {/* New password */}
            <div style={{marginBottom:'1rem'}}>
              <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
                {tc('chpwd.newPassword','New Password (min 6 characters)')}
              </label>
              <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',borderRadius:10,overflow:'hidden'}}>
                <input type={showNew?'text':'password'} placeholder="••••••••"
                  value={newPw} onChange={e=>setNewPw(e.target.value)}
                  style={{flex:1,padding:'12px 14px',border:'none',outline:'none',fontSize:15}} required/>
                <button type="button" onClick={()=>setShowNew(p=>!p)}
                  style={{background:'none',border:'none',cursor:'pointer',padding:'0 14px',color:'#aaa',display:'flex',alignItems:'center'}}>
                  {showNew?<EyeOff size={18}/>:<Eye size={18}/>}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div style={{marginBottom:'1.5rem'}}>
              <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:6,color:'#333'}}>
                {tc('chpwd.confirmPassword','Confirm New Password')}
              </label>
              <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',borderRadius:10,overflow:'hidden'}}>
                <input type={showConf?'text':'password'} placeholder="••••••••"
                  value={confirm} onChange={e=>setConfirm(e.target.value)}
                  style={{flex:1,padding:'12px 14px',border:'none',outline:'none',fontSize:15}} required/>
                <button type="button" onClick={()=>setShowConf(p=>!p)}
                  style={{background:'none',border:'none',cursor:'pointer',padding:'0 14px',color:'#aaa',display:'flex',alignItems:'center'}}>
                  {showConf?<EyeOff size={18}/>:<Eye size={18}/>}
                </button>
              </div>
              {confirm && newPw && confirm!==newPw && (
                <div style={{fontSize:12,color:'var(--danger)',marginTop:4}}>
                  {tc('chpwd.pwMismatch','Passwords do not match')}
                </div>
              )}
            </div>

            {error && (
              <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 14px',fontSize:13,marginBottom:'1rem',border:'1px solid #fca5a5'}}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{width:'100%',height:50,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontSize:16,fontWeight:700,cursor:'pointer'}}>
              {loading?tc('chpwd.changing','Changing...'):tc('chpwd.changeBtn','Set New Password')}
            </button>
          </form>
        ) : (
          <div style={{textAlign:'center',color:'#15803d',background:'#dcfce7',borderRadius:12,padding:'1.5rem',fontSize:14}}>
            ✓ {tc('chpwd.changeOk','Password changed successfully. Redirecting...')}
          </div>
        )}
      </div>
    </div>
  );
}
