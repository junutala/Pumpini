'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle } from 'lucide-react';

export default function ConfirmDialog({ message, detail, onConfirm, onCancel, confirmLabel='Confirm', danger=false }) {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  // Prevent background scroll when dialog open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.55)',
      padding: '1rem',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '2rem',
        maxWidth: 420, width: '100%',
        boxShadow: '0 25px 80px rgba(0,0,0,.35)',
        animation: 'dialogIn .15s ease',
      }}>
        <div style={{ display: 'flex', gap: 14, marginBottom: '1.5rem', alignItems: 'flex-start' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
            background: danger ? '#fee2e2' : '#fff7ed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertCircle size={22} color={danger ? '#dc2626' : '#ea580c'}/>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: detail ? 6 : 0 }}>
              {message}
            </div>
            {detail && (
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5 }}>{detail}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '10px 20px', border: '1.5px solid #ddd', borderRadius: 8,
            background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#444',
          }}>
            {tc('common.cancel','Cancel')}
          </button>
          <button onClick={onConfirm} style={{
            padding: '10px 20px', border: 'none', borderRadius: 8,
            background: danger ? '#dc2626' : '#FF6B00',
            color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700,
          }}>
            {confirmLabel}
          </button>
        </div>
      </div>
      <style>{`@keyframes dialogIn { from { opacity:0; transform:scale(.95); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  );
}

