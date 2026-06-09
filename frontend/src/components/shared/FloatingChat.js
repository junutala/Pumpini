'use client';
import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, Mic, MicOff, Loader, Zap, ChevronDown } from 'lucide-react';
import { sendAiChat } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const STARTERS = [
  "Today's total sales?",
  "Which fuel has most stock?",
  "Any pending alerts?",
  "Current shift status?",
];

export default function FloatingChat() {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [open,       setOpen]       = useState(false);
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [recording,  setRecording]  = useState(false);
  const [voiceStatus,setVoiceStatus]= useState(''); // '' | 'listening' | 'processing' | 'error'
  const [mediaRec,   setMediaRec]   = useState(null);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const getLang = () =>
    (typeof window !== 'undefined' && localStorage.getItem('i18nextLng')) || 'en';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    const lang = getLang();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const { reply } = await sendAiChat({ message: msg, station_id: stationId, language: lang });
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Could not reach AI. Check your connection and try again.',
        error: true,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const startVoice = async () => {
    if (recording) { if (mediaRec) mediaRec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const mimeType = [
        'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', '',
      ].find(m => m === '' || MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        setVoiceStatus('processing');
        try {
          const mType = rec.mimeType || 'audio/webm';
          const blob  = new Blob(chunks, { type: mType });
          const ext   = mType.includes('ogg') ? 'ogg' : mType.includes('mp4') ? 'mp4' : 'webm';
          const form  = new FormData();
          form.append('audio', blob, `audio.${ext}`);
          form.append('language', getLang());
          const res  = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            body: form,
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          setVoiceStatus('');
          if (data.transcript?.trim()) send(data.transcript.trim());
        } catch {
          setVoiceStatus('error');
          setTimeout(() => setVoiceStatus(''), 3000);
        }
      };
      rec.start();
      setMediaRec(rec);
      setRecording(true);
      setVoiceStatus('listening');
      // Auto-stop after 10 s
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 10_000);
    } catch {
      setVoiceStatus('error');
      setTimeout(() => setVoiceStatus(''), 3000);
    }
  };

  if (!user) return null;

  const lang = getLang();

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen(o => !o)}
        title="AI Assistant"
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 54, height: 54, borderRadius: '50%',
          background: '#FF6B00', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 24px rgba(255,107,0,.55)',
          zIndex: 1000, transition: 'transform .2s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {open
          ? <ChevronDown size={22} color="#fff"/>
          : <MessageSquare size={22} color="#fff"/>}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 90, right: 24,
          width: 360, maxWidth: 'calc(100vw - 48px)',
          height: 520, maxHeight: 'calc(100dvh - 120px)',
          background: 'var(--surface-1, #ffffff)',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,.22)',
          display: 'flex', flexDirection: 'column',
          zIndex: 999, overflow: 'hidden',
          border: '1px solid var(--border, #e5e7eb)',
        }}>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', background: '#FF6B00', flexShrink: 0,
          }}>
            <div style={{
              width: 32, height: 32, background: 'rgba(255,255,255,.2)',
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Zap size={16} color="#fff" fill="#fff"/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>AI Assistant</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)' }}>
                Live station data · {lang.toUpperCase()}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,.8)', display:'flex',alignItems:'center' }}
            >
              <X size={18}/>
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '12px 12px 6px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: '1rem' }}>
                <Zap size={28} color="#FF6B00" fill="#FF6B00" style={{ marginBottom: 8 }}/>
                <p style={{ color: 'var(--text-3, #9ca3af)', fontSize: 12, margin: '0 0 12px', lineHeight: 1.5 }}>
                  Ask me about sales, stock, shifts, or alerts
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
                  {STARTERS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      style={{
                        padding: '5px 10px', borderRadius: 14,
                        border: '1px solid var(--border, #e5e7eb)',
                        background: 'var(--surface-2, #f9fafb)',
                        fontSize: 11, cursor: 'pointer',
                        color: 'var(--text-1, #111)', transition: 'all .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background='#FF6B00'; e.currentTarget.style.color='#fff'; e.currentTarget.style.borderColor='#FF6B00'; }}
                      onMouseLeave={e => { e.currentTarget.style.background='var(--surface-2,#f9fafb)'; e.currentTarget.style.color='var(--text-1,#111)'; e.currentTarget.style.borderColor='var(--border,#e5e7eb)'; }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                {m.role === 'assistant' && (
                  <div style={{
                    width: 22, height: 22, background: '#FF6B00', borderRadius: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: 2,
                  }}>
                    <Zap size={11} color="#fff" fill="#fff"/>
                  </div>
                )}
                <div style={{
                  maxWidth: '78%', padding: '8px 11px', borderRadius: 10,
                  fontSize: 13, lineHeight: 1.55,
                  background: m.role === 'user'
                    ? '#FF6B00'
                    : m.error ? '#fef2f2' : 'var(--surface-2, #f3f4f6)',
                  color: m.role === 'user'
                    ? '#fff'
                    : m.error ? '#991b1b' : 'var(--text-1, #111)',
                  borderBottomRightRadius: m.role === 'user' ? 2 : 10,
                  borderBottomLeftRadius:  m.role === 'assistant' ? 2 : 10,
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 22, height: 22, background: '#FF6B00', borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Zap size={11} color="#fff" fill="#fff"/>
                </div>
                <div style={{
                  padding: '8px 11px', borderRadius: 10,
                  background: 'var(--surface-2, #f3f4f6)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, color: 'var(--text-2, #6b7280)',
                }}>
                  <Loader size={12} style={{ animation: 'fcchat-spin 1s linear infinite' }}/>
                  Thinking…
                </div>
              </div>
            )}

            <div ref={bottomRef}/>
          </div>

          {/* Input bar */}
          <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--border, #e5e7eb)', flexShrink: 0 }}>
            {voiceStatus === 'listening' && (
              <div style={{ textAlign:'center', fontSize:11, color:'#dc2626', marginBottom:4, fontWeight:600 }}>
                🔴 Listening… tap mic to stop
              </div>
            )}
            {voiceStatus === 'processing' && (
              <div style={{ textAlign:'center', fontSize:11, color:'var(--text-2,#6b7280)', marginBottom:4 }}>
                Processing voice…
              </div>
            )}
            {voiceStatus === 'error' && (
              <div style={{ textAlign:'center', fontSize:11, color:'#dc2626', marginBottom:4 }}>
                Mic error — please try again
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <button onClick={startVoice}
                style={{
                  padding: '8px 9px', borderRadius: 8, border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: recording ? '#dc2626' : 'var(--surface-2, #f3f4f6)',
                  color:      recording ? '#fff'    : 'var(--text-2, #6b7280)',
                  boxShadow:  recording ? '0 0 0 3px rgba(220,38,38,.2)' : 'none',
                  transition: 'all .2s', display: 'flex', alignItems: 'center',
                }}>
                {recording ? <MicOff size={15}/> : <Mic size={15}/>}
              </button>

              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder="Ask anything… (Enter to send)"
                style={{
                  flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border, #e5e7eb)', fontSize: 13, fontFamily: 'inherit',
                  background: 'var(--surface-1, #fff)', color: 'var(--text-1, #111)',
                  outline: 'none', lineHeight: 1.4, minHeight: 36, maxHeight: 90, overflowY: 'auto',
                }}
              />

              <button onClick={() => send()}
                disabled={!input.trim() || loading}
                style={{
                  padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: input.trim() && !loading ? '#FF6B00' : 'var(--surface-2, #f3f4f6)',
                  color:      input.trim() && !loading ? '#fff'    : 'var(--text-3, #9ca3af)',
                  transition: 'all .2s', display: 'flex', alignItems: 'center',
                }}>
                <Send size={15}/>
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fcchat-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
