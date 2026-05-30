'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const router = useRouter();
  const [phone,   setPhone]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');

  const handlePhone = v => setPhone(v.replace(/\D/g,'').slice(0,10));

  const handleSubmit = async e => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.post('/auth/forgot-password', { phone });
      setSent(true);
    } catch(err) {
      setError(err.error||'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#0F1923',padding:'1rem'}}>
      <div style={{background:'#fff',borderRadius:20,padding:'2.5rem',width:'100%',maxWidth:380,boxShadow:'0 20px 60px rgba(0,0,0,.4)'}}>

        {/* Logo wordmark */}
        <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
          <div style={{fontSize:28,fontWeight:900}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#1A5F7A'}}>ini</span>
          </div>
        </div>

        <h2 style={{fontSize:18,fontWeight:700,marginBottom:6,textAlign:'center',color:'#111'}}>
          {tc('fp_page.forgot_title','Reset Password')}
        </h2>
        <p style={{fontSize:13,color:'#888',textAlign:'center',marginBottom:'1.5rem',lineHeight:1.5}}>
          {tc('fp_page.forgot_sub','Enter your registered mobile number. We\'ll send a temporary password via WhatsApp / SMS.')}
        </p>

        {!sent ? (
          <form onSubmit={handleSubmit}>
            <div style={{marginBottom:'1rem'}}>
              <div style={{display:'flex',alignItems:'center',border:'1.5px solid #ddd',borderRadius:10,overflow:'hidden'}}>
                <div style={{background:'#f8f8f8',padding:'12px 12px',fontSize:14,color:'#888',borderRight:'1px solid #ddd',whiteSpace:'nowrap'}}>
                  🇮🇳 +91
                </div>
                <input type="tel" inputMode="numeric" placeholder="9876543210"
                  value={phone} onChange={e=>handlePhone(e.target.value)} maxLength={10}
                  style={{flex:1,padding:'12px 14px',border:'none',outline:'none',fontSize:16,fontFamily:'monospace',letterSpacing:'0.08em'}}
                  required/>
                {phone.length>0 && (
                  <div style={{padding:'0 10px',fontSize:12,color:phone.length===10?'#16a34a':'#aaa'}}>{phone.length}/10</div>
                )}
              </div>
            </div>

            {error && (
              <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 14px',fontSize:13,marginBottom:'1rem',border:'1px solid #fca5a5'}}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading||phone.length!==10}
              style={{width:'100%',height:50,background:phone.length===10?'#FF6B00':'#ccc',color:'#fff',border:'none',borderRadius:10,fontSize:16,fontWeight:700,cursor:phone.length===10?'pointer':'not-allowed',marginBottom:'0.75rem'}}>
              {loading?tc('fp_page.sending','Sending...'):tc('fp_page.send_otp','Send Temporary Password')}
            </button>

            <button type="button" onClick={()=>router.push('/login')}
              style={{width:'100%',background:'none',border:'none',color:'#888',fontSize:14,cursor:'pointer',padding:'8px'}}>
              {tc('fp_page.back_to_login','← Back to Login')}
            </button>
          </form>
        ) : (
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:'1rem'}}>📱</div>
            <div style={{background:'#dcfce7',border:'1px solid #86efac',borderRadius:12,padding:'1rem 1.25rem',color:'#15803d',fontSize:14,lineHeight:1.6,marginBottom:'1.5rem'}}>
              {tc('fp_page.sent_ok','A temporary password has been sent to your WhatsApp / SMS. Please login with it and change your password immediately.')}
            </div>
            <button onClick={()=>router.push('/login')}
              style={{width:'100%',height:50,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontSize:16,fontWeight:700,cursor:'pointer'}}>
              {tc('fp_page.back_to_login','← Back to Login')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

