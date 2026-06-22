'use client';
// Add Attendant — minimal: a manager registers a shift attendant (name + phone).
// They get a dummy password (no login/POS yet) and become available for shift
// assignment at Start Shift. Scoped to the current bunk.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, ChevronRight, ArrowLeft, Check } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { addAttendant, getUsers } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };

export default function AddAttendantPage() {
  const router = useRouter();
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [form, setForm] = useState({ name:'', phone:'' });
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [saved, setSaved] = useState('');

  const load = async () => {
    if (!stationId) return;
    const u = await getUsers({ station_id: stationId, role: 'attendant' }).catch(()=>[]);
    setList(Array.isArray(u) ? u : []);
  };
  useEffect(() => { load(); }, [stationId]);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setSaved('');
    if (!form.name.trim() || !form.phone.trim()) return setErr('Enter the name and phone.');
    setBusy(true);
    try {
      await addAttendant({ ...form, station_id: stationId });
      setSaved(`${form.name} added — available for shift assignment.`);
      setForm({ name:'', phone:'' });
      load();
      setTimeout(()=>setSaved(''), 4000);
    } catch (e) {
      // Surface the real reason (backend message, else network/timeout text) so
      // failures are self-describing instead of a generic catch-all.
      setErr(e?.error || e?.message || (typeof e==='string'?e:'Could not add attendant'));
    }
    finally { setBusy(false); }
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>Dashboard</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>Add Attendant</span>
      </div>

      {err   && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}
      {saved && <div style={{background:'#dcfce7',color:'#166534',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>✓ {saved}</div>}

      <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'440px 1fr',gap:'1.25rem',alignItems:'start'}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><UserPlus size={16} color="#FF6B00"/>New attendant</div>
          <div style={{fontSize:12,color:'var(--text-3)',marginBottom:'1rem'}}>They&apos;ll appear in the operator list at Start Shift. No login needed yet — a default password is set.</div>
          <form onSubmit={submit} style={{display:'grid',gap:12}}>
            <div>
              <label className="label">Name</label>
              <input style={inp} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Suresh"/>
            </div>
            <div>
              <label className="label">Phone</label>
              <input style={inp} value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} placeholder="10-digit mobile"/>
            </div>
            <button type="submit" disabled={busy} style={{height:44,background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:busy?'default':'pointer'}}>
              {busy ? 'Adding…' : 'Add attendant'}
            </button>
          </form>
        </div>

        <div className="card">
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>Attendants at this bunk ({list.length})</div>
          {list.length === 0
            ? <div style={{color:'#aaa',fontSize:13}}>No attendants yet.</div>
            : list.map(a => (
                <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc',borderRadius:8,padding:'8px 10px',marginBottom:6}}>
                  <div style={{fontWeight:600,fontSize:13}}>{a.name}</div>
                  <div style={{fontSize:12,color:'#888',fontFamily:'var(--font-mono)'}}>{a.phone}{a.is_active===false && <span style={{color:'#dc2626',marginLeft:6}}>inactive</span>}</div>
                </div>
              ))}
        </div>
      </div>
    </AppShell>
  );
}
