'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { Zap, Loader2 } from 'lucide-react';
import '../../i18n';
import { LANGUAGES } from '../../i18n';

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login }   = useAuth();
  const router      = useRouter();
  const [form, setForm] = useState({ phone: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(form.phone, form.password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '1rem' }}>

      {/* Language selector */}
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <select className="input" style={{ width: 'auto', fontSize: 13 }} value={i18n.language} onChange={e => i18n.changeLanguage(e.target.value)}>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.native}</option>)}
        </select>
      </div>

      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 52, height: 52, background: 'var(--brand)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Zap size={26} color="#fff" fill="#fff" />
          </div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>Petrol DMS</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Dealer Management System</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label className="label">{t('phone')}</label>
            <input className="input input-lg" type="tel" placeholder="+91 9876543210"
              value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} required />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="label">{t('password')}</label>
            <input className="input input-lg" type="password" placeholder="••••••••"
              value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required />
          </div>

          {error && (
            <div className="alert-banner danger" style={{ marginBottom: '1rem' }}>{error}</div>
          )}

          <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {t('login')}
          </button>
        </form>
      </div>

      <p style={{ marginTop: '1.5rem', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
        Secure login · Data encrypted at rest
      </p>
    </div>
  );
}
