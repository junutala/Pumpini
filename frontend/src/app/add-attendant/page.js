'use client';
// Add Attendant — minimal: a manager registers a shift attendant (name + phone).
// They get a dummy password (no login/POS yet) and become available for shift
// assignment at Start Shift. Scoped to the current bunk.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { UserPlus, ChevronRight, ArrowLeft, Check } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api, { addAttendant, getUsers } from '../../lib/api';
import PhotoCapture from '../../components/shared/PhotoCapture';
import { useAuth } from '../../lib/auth';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };

export default function AddAttendantPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [form, setForm] = useState({ name:'', phone:'' });
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [saved, setSaved] = useState('');
  const [loaded, setLoaded]   = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const load = async () => {
    if (!stationId) return;
    setLoadErr('');
    try {
      // Don't swallow the error — a failed fetch must NOT look like "no attendants".
      const u = await getUsers({ station_id: stationId, role: 'attendant' });
      setList(Array.isArray(u) ? u : []);
    } catch (e) {
      setLoadErr(e?.error || e?.message || tc('addatt.errLoad', 'Could not load attendants — try refreshing.'));
    } finally { setLoaded(true); }
  };
  useEffect(() => { load(); }, [stationId]);

  // The enrolment photograph. Optional by design — a camera that will not
  // co-operate must never stop an outlet putting a man on shift — but captured
  // HERE because this is the reference the shift-start pictures get compared
  // against, first by eye and later by the matcher that replaces the picker.
  const [photo, setPhoto] = useState(null);
  const [photoSlot, setPhotoSlot] = useState(0);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setSaved('');
    if (!form.name.trim() || !form.phone.trim()) return setErr(tc('addatt.errEnterNamePhone', 'Enter the name and phone.'));
    setBusy(true);
    try {
      await addAttendant({
        ...form,
        station_id: stationId,
        photo_base64: photo?.base64 || null,
        photo_media_type: photo?.media_type || null,
      });
      setSaved(tc('addatt.savedAdded', '{name} added — available for shift assignment.').replace('{name}', form.name));
      setForm({ name:'', phone:'' });
      setPhoto(null); setPhotoSlot(n => n + 1);   // remount so the next man starts blank
      load();
      setTimeout(()=>setSaved(''), 4000);
    } catch (e) {
      // Surface the real reason (backend message, else network/timeout text) so
      // failures are self-describing instead of a generic catch-all.
      setErr(e?.error || e?.message || (typeof e==='string'?e:tc('addatt.errCouldNotAdd', 'Could not add attendant')));
    }
    finally { setBusy(false); }
  };

  // End-date a leaving attendant (drops them from the Start-Shift picker) or
  // bring one back. Reversible — reactivating clears the end date.
  const toggleEndDate = async (a) => {
    const leaving = a.is_active !== false;
    if (leaving && !window.confirm(tc('addatt.confirmEndDate', 'End-date {name}? They stop appearing in the operator list. You can reactivate later.').replace('{name}', a.name))) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    try {
      await api.patch(`/users/${a.id}`, leaving ? { is_active:false, end_date: today } : { is_active:true, end_date:null });
      load();
    } catch (e) { setErr(e?.error || e?.message || tc('addatt.errCouldNotUpdate', 'Could not update attendant')); }
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('addatt.dashboard', 'Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('addatt.title', 'Add Attendant')}</span>
      </div>

      {err   && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}
      {saved && <div style={{background:'#dcfce7',color:'#166534',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>✓ {saved}</div>}

      <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'440px 1fr',gap:'1.25rem',alignItems:'start'}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><UserPlus size={16} color="#FF6B00"/>{tc('addatt.newAttendant', 'New attendant')}</div>
          <div style={{fontSize:12,color:'var(--text-3)',marginBottom:'1rem'}}>{tc('addatt.newAttendantHint', "They'll appear in the operator list at Start Shift. No login needed yet — a default password is set.")}</div>
          <form onSubmit={submit} style={{display:'grid',gap:12}}>
            <div>
              <label className="label">{tc('addatt.labelName', 'Name')}</label>
              <input style={inp} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder={tc('addatt.phName', 'e.g. Suresh')}/>
            </div>
            <div>
              <label className="label">{tc('addatt.labelPhone', 'Phone')}</label>
              <input style={inp} value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} placeholder={tc('addatt.phPhone', '10-digit mobile')}/>
            </div>
            <div>
              <label className="label">{tc('addatt.labelPhoto', 'Photo')} <span style={{fontWeight:400,color:'var(--text-3)'}}>{tc('addatt.photoOptional', '(optional)')}</span></label>
              <PhotoCapture
                key={photoSlot}
                label={tc('addatt.takePhoto', 'Take photo')}
                hint={tc('addatt.photoHint', 'Kept as his reference photo — the one his shift-start pictures are checked against.')}
                onCapture={setPhoto}
                disabled={busy}
          removeLabel={tc('photo.remove', 'Remove')}/>
            </div>
            <button type="submit" disabled={busy} style={{height:44,background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:busy?'default':'pointer'}}>
              {busy ? tc('addatt.adding', 'Adding…') : tc('addatt.addAttendant', 'Add attendant')}
            </button>
          </form>
        </div>

        <div className="card">
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('addatt.attendantsAtBunk', 'Attendants at this bunk ({n})').replace('{n}', list.length)}</div>
          {loadErr
            ? <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13}}>{loadErr}</div>
            : !loaded
            ? <div style={{color:'#aaa',fontSize:13}}>{tc('addatt.loading', 'Loading…')}</div>
            : list.length === 0
            ? <div style={{color:'#aaa',fontSize:13}}>{tc('addatt.noAttendants', 'No attendants yet.')}</div>
            : list.map(a => {
                const inactive = a.is_active === false;
                return (
                <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,background:'#f8fafc',borderRadius:8,padding:'8px 10px',marginBottom:6,opacity:inactive?0.75:1}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13}}>{a.name}{inactive && <span style={{color:'#dc2626',fontWeight:600,marginLeft:6,fontSize:11}}>{tc('addatt.endedOn', 'ended {d}').replace('{d}', a.end_date || '')}</span>}</div>
                    <div style={{fontSize:12,color:'#888',fontFamily:'var(--font-mono)'}}>{a.phone}</div>
                  </div>
                  {/* Active/Ended toggle switch */}
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    <span style={{fontSize:11,fontWeight:600,color:inactive?'#9a3412':'#16a34a'}}>{inactive?tc('addatt.statusEnded','Ended'):tc('addatt.statusActive','Active')}</span>
                    <button onClick={()=>toggleEndDate(a)} aria-label={tc('addatt.toggleAria','Toggle attendant active')} title={inactive?tc('addatt.reactivate','Reactivate'):tc('addatt.endDate','End-date')}
                      style={{width:42,height:24,borderRadius:99,border:'none',cursor:'pointer',background:inactive?'#cbd5e1':'#16a34a',position:'relative',padding:0,flexShrink:0,transition:'background .15s'}}>
                      <span style={{position:'absolute',top:3,left:inactive?3:21,width:18,height:18,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 2px rgba(0,0,0,.25)',transition:'left .15s'}}/>
                    </button>
                  </div>
                </div>
                );
              })}
        </div>
      </div>
    </AppShell>
  );
}
