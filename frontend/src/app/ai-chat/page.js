'use client';
import { useState, useEffect, useRef } from 'react';
import { Send, Mic, MicOff, Loader, MessageSquare, Zap } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { sendAiChat } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const STARTERS = [
  "What are today's total sales?",
  "Which fuel has sold the most today?",
  "Are there any pending alerts?",
  "What is the current tank stock level?",
  "How many transactions were done today?",
];

export default function AiChatPage() {
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const lang = (typeof window !== 'undefined' && localStorage.getItem('i18nextLng')) || 'en';

  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Voice state
  const [recording,   setRecording]   = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [mediaRec,    setMediaRec]    = useState(null);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const { reply } = await sendAiChat({ message: msg, station_id: stationId, language: lang });
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Sorry, something went wrong. Please try again.',
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
        'audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4',''
      ].find(m => m === '' || MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        setVoiceStatus('processing');
        try {
          const mType = rec.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mType });
          const ext = mType.includes('ogg') ? 'ogg' : mType.includes('mp4') ? 'mp4' : 'webm';
          const formData = new FormData();
          formData.append('audio', blob, `audio.${ext}`);
          formData.append('language', lang);
          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
            body: formData,
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          setVoiceStatus('');
          // Auto-send the transcribed text
          if (data.transcript?.trim()) send(data.transcript.trim());
        } catch (err) {
          setVoiceStatus('error');
          setTimeout(() => setVoiceStatus(''), 3000);
        }
      };
      rec.start();
      setMediaRec(rec);
      setRecording(true);
      setVoiceStatus('listening');
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 10000);
    } catch (err) {
      setVoiceStatus('error');
      setTimeout(() => setVoiceStatus(''), 3000);
    }
  };

  return (
    <AppShell>
      <div style={{display:'flex',flexDirection:'column',height:'calc(100dvh - 2rem)',maxWidth:720,margin:'0 auto'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',gap:12,paddingBottom:'1rem',borderBottom:'1px solid var(--border)'}}>
          <div style={{width:40,height:40,background:'#FF6B00',borderRadius:10,
            display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <Zap size={20} color="#fff" fill="#fff"/>
          </div>
          <div>
            <h1 style={{margin:0,fontSize:18,fontWeight:800}}>AI Assistant</h1>
            <p style={{margin:0,fontSize:12,color:'var(--text-3)'}}>
              Ask anything about your station — sales, stock, shifts, alerts
            </p>
          </div>
        </div>

        {/* Messages */}
        <div style={{flex:1,overflowY:'auto',padding:'1rem 0',display:'flex',flexDirection:'column',gap:'0.75rem'}}>

          {messages.length === 0 && (
            <div style={{textAlign:'center',paddingTop:'2rem'}}>
              <MessageSquare size={36} color="var(--text-3)" style={{marginBottom:12}}/>
              <p style={{color:'var(--text-3)',fontSize:14,margin:'0 0 1.5rem'}}>
                Ask a question about your station or try one of these:
              </p>
              <div style={{display:'flex',flexWrap:'wrap',gap:8,justifyContent:'center'}}>
                {STARTERS.map(s => (
                  <button key={s}
                    onClick={() => send(s)}
                    style={{padding:'8px 14px',borderRadius:20,border:'1px solid var(--border)',
                      background:'var(--surface-2)',fontSize:13,cursor:'pointer',
                      color:'var(--text-1)',transition:'all .15s'}}
                    onMouseEnter={e => { e.currentTarget.style.background='var(--brand)'; e.currentTarget.style.color='#fff'; e.currentTarget.style.borderColor='var(--brand)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='var(--surface-2)'; e.currentTarget.style.color='var(--text-1)'; e.currentTarget.style.borderColor='var(--border)'; }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{display:'flex',justifyContent: m.role==='user' ? 'flex-end' : 'flex-start'}}>
              {m.role === 'assistant' && (
                <div style={{width:28,height:28,background:'#FF6B00',borderRadius:7,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  flexShrink:0,marginRight:8,marginTop:2}}>
                  <Zap size={14} color="#fff" fill="#fff"/>
                </div>
              )}
              <div style={{
                maxWidth:'75%',padding:'10px 14px',borderRadius:12,fontSize:14,lineHeight:1.6,
                background: m.role==='user'
                  ? 'var(--brand)'
                  : m.error ? '#fef2f2' : 'var(--surface-2)',
                color: m.role==='user'
                  ? '#fff'
                  : m.error ? '#991b1b' : 'var(--text-1)',
                borderBottomRightRadius: m.role==='user' ? 3 : 12,
                borderBottomLeftRadius:  m.role==='assistant' ? 3 : 12,
                whiteSpace:'pre-wrap',
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:28,height:28,background:'#FF6B00',borderRadius:7,
                display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <Zap size={14} color="#fff" fill="#fff"/>
              </div>
              <div style={{padding:'10px 14px',borderRadius:12,background:'var(--surface-2)',
                display:'flex',alignItems:'center',gap:6,fontSize:13,color:'var(--text-2)'}}>
                <Loader size={14} style={{animation:'spin 1s linear infinite'}}/>
                Thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Input bar */}
        <div style={{paddingTop:'0.75rem',borderTop:'1px solid var(--border)'}}>
          {voiceStatus === 'listening' && (
            <div style={{textAlign:'center',fontSize:12,color:'#dc2626',marginBottom:6,fontWeight:600}}>
              🔴 Listening… speak now (tap mic to stop)
            </div>
          )}
          {voiceStatus === 'processing' && (
            <div style={{textAlign:'center',fontSize:12,color:'var(--text-2)',marginBottom:6}}>
              Processing voice…
            </div>
          )}
          {voiceStatus === 'error' && (
            <div style={{textAlign:'center',fontSize:12,color:'#dc2626',marginBottom:6}}>
              Mic error — please try again
            </div>
          )}
          <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
            <button onClick={startVoice}
              style={{padding:'10px 12px',borderRadius:10,border:'none',cursor:'pointer',
                flexShrink:0,
                background: recording ? '#dc2626' : 'var(--surface-2)',
                color:      recording ? '#fff' : 'var(--text-2)',
                boxShadow: recording ? '0 0 0 3px rgba(220,38,38,.2)' : 'none',
                transition:'all .2s'}}>
              {recording ? <MicOff size={18}/> : <Mic size={18}/>}
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Ask about sales, stock, shifts… (Enter to send)"
              style={{flex:1,resize:'none',padding:'10px 14px',borderRadius:10,
                border:'1px solid var(--border)',fontSize:14,fontFamily:'inherit',
                background:'var(--surface-1)',color:'var(--text-1)',outline:'none',
                lineHeight:1.5,minHeight:42,maxHeight:120,overflowY:'auto'}}
            />
            <button onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{padding:'10px 14px',borderRadius:10,border:'none',cursor:'pointer',
                flexShrink:0,
                background: input.trim() && !loading ? 'var(--brand)' : 'var(--surface-2)',
                color:      input.trim() && !loading ? '#fff' : 'var(--text-3)',
                transition:'all .2s'}}>
              <Send size={18}/>
            </button>
          </div>
          <p style={{margin:'6px 0 0',fontSize:11,color:'var(--text-3)',textAlign:'center'}}>
            Answers are based on live station data · {lang.toUpperCase()} mode
          </p>
        </div>
      </div>
    </AppShell>
  );
}
