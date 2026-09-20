'use client';
//
// Campaign Setup — define a gift campaign, its tiers, and start it.
//
// WHAT THE SCREEN HAS TO MAKE OBVIOUS, because the rules are not guessable:
//   - a tier is judged on ONE FILL, never a running total
//   - only the HIGHEST tier a fill clears is awarded
//   - one gift per vehicle per tier, for the life of the campaign
//   - the rules FREEZE on Start; stock does not, because stock lives in the
//     catalogue and replenishing is not a change of terms
//
// Gifts are catalogue items, so there is no second stock counter here and no
// stock field to type. The figure shown is live from the gift store, and it is
// refilled on Products → Stock like everything else.
//
// A LADDER PER FUEL, not one shared ladder: a diesel driver's median fill is
// 50 L and a petrol driver's is 4 L, so a single "50 L → bottle" rung would gift
// nearly every diesel customer and almost no petrol one.
import { useState, useEffect, useMemo } from 'react';
import { Plus, X, Play, Square, Gift, Lock, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import Banner from '../../components/shared/Banner';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText } from '../../lib/apiError';

const inp = {width:'100%',padding:'9px 11px',border:'1.5px solid #e5e3de',borderRadius:8,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

// The four the backend accepts. `lubes` is excluded on purpose — a lube sale is
// not a tank fill and must not earn a fuel-fill gift.
const FUELS = [
  { id:'petrol',         colour:'#3b82f6' },
  { id:'diesel',         colour:'#f59e0b' },
  { id:'cng',            colour:'#10b981' },
  { id:'premium_petrol', colour:'#8b5cf6' },
];

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN',
  { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' }) : '';
const num = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function CampaignsPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const fuelLabel = id => ({
    petrol:         tc('camp.petrol','Petrol'),
    diesel:         tc('camp.diesel','Diesel'),
    cng:            tc('camp.cng','CNG'),
    premium_petrol: tc('camp.premium','Premium'),
  }[id] || id);
  const fuelColour = id => FUELS.find(f => f.id === id)?.colour || '#7a7773';

  const [list, setList]       = useState([]);
  const [products, setProducts] = useState([]);
  const [sel, setSel]         = useState(null);   // the open campaign, with tiers
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [newForm, setNewForm] = useState(null);   // null = closed
  const [tierForm, setTierForm] = useState({ fuel_type:'petrol', min_litres:'', product_id:'', quantity:'1' });

  const say = (m, good) => { if (good) { setOk(m); setErr(''); } else { setErr(m); setOk(''); } };

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const [cs, ps] = await Promise.all([
        api.get('/campaigns', { params:{ station_id: stationId } }),
        api.get('/products/stock-by-location', { params:{ station_id: stationId } }),
      ]);
      setList(Array.isArray(cs) ? cs : []);
      setProducts(Array.isArray(ps) ? ps : []);
    } catch (e) { say(errText(e, tc('camp.loadFailed','Could not load campaigns.')), false); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [stationId]);

  const openCampaign = async (id) => {
    setErr(''); setOk('');
    try { setSel(await api.get(`/campaigns/${id}`)); }
    catch (e) { say(errText(e, tc('camp.openFailed','Could not open that campaign.')), false); }
  };

  const createCampaign = async () => {
    setBusy(true);
    try {
      const c = await api.post('/campaigns', { station_id: stationId, ...newForm });
      setNewForm(null);
      await load();
      await openCampaign(c.id);
      say(tc('camp.created','Draft created. Add a tier for each fuel, then start it.'), true);
    } catch (e) { say(errText(e, tc('camp.createFailed','Could not create the campaign.')), false); }
    setBusy(false);
  };

  const addTier = async () => {
    setBusy(true);
    try {
      await api.post(`/campaigns/${sel.id}/tiers`, tierForm);
      setTierForm({ fuel_type: tierForm.fuel_type, min_litres:'', product_id:'', quantity:'1' });
      await openCampaign(sel.id); await load();
      say(tc('camp.tierAdded','Tier added.'), true);
    } catch (e) { say(errText(e, tc('camp.tierFailed','Could not add the tier.')), false); }
    setBusy(false);
  };

  const removeTier = async (tid) => {
    setBusy(true);
    try { await api.delete(`/campaigns/tiers/${tid}`); await openCampaign(sel.id); await load(); }
    catch (e) { say(errText(e, tc('camp.tierRemoveFailed','Could not remove the tier.')), false); }
    setBusy(false);
  };

  const startCampaign = async () => {
    setBusy(true);
    try {
      await api.post(`/campaigns/${sel.id}/start`);
      await openCampaign(sel.id); await load();
      say(tc('camp.started','Campaign started. Its rules are now locked.'), true);
    } catch (e) { say(errText(e, tc('camp.startFailed','Could not start the campaign.')), false); }
    setBusy(false);
  };

  const stopCampaign = async () => {
    if (!confirm(tc('camp.confirmStop','Close this campaign? Gifts already issued are unaffected, and it cannot be reopened.'))) return;
    setBusy(true);
    try {
      await api.post(`/campaigns/${sel.id}/stop`);
      await openCampaign(sel.id); await load();
      say(tc('camp.stopped','Campaign closed.'), true);
    } catch (e) { say(errText(e, tc('camp.stopFailed','Could not close the campaign.')), false); }
    setBusy(false);
  };

  const draft   = sel?.status === 'draft';
  const running = sel?.status === 'running';

  // Tiers grouped by fuel — one ladder per fuel, ordered as the award reads them.
  const ladders = useMemo(() => {
    const by = {};
    for (const tr of (sel?.tiers || [])) (by[tr.fuel_type] ||= []).push(tr);
    for (const k of Object.keys(by)) by[k].sort((a, b) => Number(a.min_litres) - Number(b.min_litres));
    return by;
  }, [sel]);

  const statusChip = (s) => {
    const map = {
      draft:   { bg:'#f3f2ef', fg:'#4a4845', label: tc('camp.draft','Draft') },
      running: { bg:'#dcfce7', fg:'#166534', label: tc('camp.running','Running') },
      closed:  { bg:'#e8eaef', fg:'#4a4845', label: tc('camp.closed','Closed') },
      cancelled:{bg:'#fee2e2', fg:'#991b1b', label: tc('camp.cancelled','Cancelled') },
    }[s] || { bg:'#f3f2ef', fg:'#4a4845', label:s };
    return <span style={{padding:'2px 9px',borderRadius:999,fontSize:11,fontWeight:700,background:map.bg,color:map.fg}}>{map.label}</span>;
  };

  return (
    <AppShell>
      <div style={{ padding:'20px 16px', maxWidth:900, margin:'0 auto' }}>

        <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap',marginBottom:16}}>
          <div style={{flexGrow:1}}>
            <h1 style={{margin:'0 0 4px',fontSize:22,fontWeight:700,letterSpacing:'-0.3px'}}>
              {tc('camp.title','Gift Campaigns')}
            </h1>
            <p style={{margin:0,fontSize:13,color:'#4a4845',lineHeight:1.5}}>
              {tc('camp.sub','Give a gift when a driver fills a certain quantity. Gifts come from your catalogue, and stock comes from the gift store.')}
            </p>
          </div>
          <button type="button" onClick={()=>{ setSel(null); setNewForm({ name:'', start_date:'', end_date:'' }); }}
            style={{display:'flex',alignItems:'center',gap:6,padding:'10px 18px',background:'#e07b0c',
              color:'#fff',border:'none',borderRadius:10,cursor:'pointer',fontWeight:700,fontSize:14}}>
            <Plus size={16}/> {tc('camp.new','New campaign')}
          </button>
        </div>

        <Banner tone="error">{err}</Banner>
        <Banner tone="ok">{ok}</Banner>

        {/* NEW CAMPAIGN */}
        {newForm && (
          <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:16,marginBottom:18}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>{tc('camp.newTitle','New campaign')}</div>
            <label htmlFor="c-name" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('camp.name','CAMPAIGN NAME')}</label>
            <input id="c-name" style={{...inp,marginBottom:12}} value={newForm.name}
              onChange={e=>setNewForm(p=>({...p,name:e.target.value}))}
              placeholder={tc('camp.namePh','Monsoon Power Push')}/>
            <div style={{display:'flex',gap:12,marginBottom:14,flexWrap:'wrap'}}>
              <div style={{flexGrow:1,minWidth:150}}>
                <label htmlFor="c-from" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('camp.from','START DATE')}</label>
                <input id="c-from" type="date" style={inp} value={newForm.start_date}
                  onChange={e=>setNewForm(p=>({...p,start_date:e.target.value}))}/>
              </div>
              <div style={{flexGrow:1,minWidth:150}}>
                <label htmlFor="c-to" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('camp.to','END DATE')}</label>
                <input id="c-to" type="date" style={inp} value={newForm.end_date}
                  onChange={e=>setNewForm(p=>({...p,end_date:e.target.value}))}/>
              </div>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button type="button" onClick={createCampaign}
                disabled={busy || !newForm.name || !newForm.start_date || !newForm.end_date}
                style={{flexGrow:1,padding:11,borderRadius:9,border:'none',fontWeight:700,fontSize:14,fontFamily:'inherit',
                  color:'#fff',background:(busy||!newForm.name||!newForm.start_date||!newForm.end_date)?'#c9c6bf':'#e07b0c',
                  cursor:'pointer'}}>
                {tc('camp.createDraft','Create draft')}
              </button>
              <button type="button" onClick={()=>setNewForm(null)}
                style={{padding:'11px 18px',borderRadius:9,border:'1px solid #c9c6bf',background:'#fff',fontWeight:500,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>
                {tc('camp.cancel','Cancel')}
              </button>
            </div>
          </div>
        )}

        {/* LIST */}
        {!sel && !newForm && (
          loading ? <div style={{color:'#4a4845',fontSize:13}}>{tc('camp.loading','Loading…')}</div>
          : list.length === 0 ? (
            <div style={{padding:30,textAlign:'center',background:'#fff',border:'1px solid #e5e3de',borderRadius:12}}>
              <Gift size={22} style={{color:'#c9c6bf',marginBottom:8}}/>
              <div style={{fontSize:13.5,color:'#1a1916',fontWeight:600,marginBottom:4}}>{tc('camp.noneTitle','No campaigns yet')}</div>
              <div style={{fontSize:12.5,color:'#4a4845',lineHeight:1.5}}>
                {tc('camp.noneBody','Add the gifts to your catalogue first, move some into the gift store on Products → Stock, then create a campaign here.')}
              </div>
            </div>
          ) : (
            <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,overflow:'hidden'}}>
              {list.map((c,i)=>(
                <button key={c.id} type="button" onClick={()=>openCampaign(c.id)}
                  style={{width:'100%',textAlign:'left',display:'flex',alignItems:'center',gap:12,padding:'13px 15px',
                    background:'#fff',border:'none',borderTop:i===0?'none':'1px solid #f3f2ef',cursor:'pointer',fontFamily:'inherit'}}>
                  <div style={{flexGrow:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                      <span style={{fontSize:14.5,fontWeight:700,color:'#1a1916'}}>{c.name}</span>
                      {statusChip(c.status)}
                    </div>
                    <div style={{fontSize:12,color:'#4a4845'}}>
                      {fmtDate(c.start_date)} – {fmtDate(c.end_date)}
                      {' · '}{(c.fuels||[]).map(fuelLabel).join(', ') || tc('camp.noTiers','no tiers yet')}
                      {' · '}{tc('camp.issuedN','{n} issued').replace('{n}', c.issued_count ?? 0)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {/* ONE CAMPAIGN */}
        {sel && (
          <div>
            <button type="button" onClick={()=>{ setSel(null); setErr(''); setOk(''); }}
              style={{background:'none',border:'none',padding:0,marginBottom:12,color:'#9a4607',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
              ← {tc('camp.allCampaigns','All campaigns')}
            </button>

            <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:16,marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:18,fontWeight:700,letterSpacing:'-0.2px'}}>{sel.name}</span>
                {statusChip(sel.status)}
              </div>
              <div style={{fontSize:12.5,color:'#4a4845'}}>{fmtDate(sel.start_date)} – {fmtDate(sel.end_date)}</div>

              {running && (
                <div style={{display:'flex',gap:9,padding:'10px 12px',background:'#f3f2ef',borderRadius:8,marginTop:12,alignItems:'flex-start'}}>
                  <Lock size={15} style={{flexShrink:0,marginTop:1,color:'#4a4845'}}/>
                  <span style={{fontSize:12,color:'#4a4845',lineHeight:1.45}}>
                    {tc('camp.frozen','The rules are locked while this runs. To change a tier or a gift, close it and start a new campaign — a gift already handed over has to stay explainable by the rules that were live when it went out. Stock is NOT locked: refill the gift store any time on Products → Stock.')}
                  </span>
                </div>
              )}

              <div style={{display:'flex',gap:10,marginTop:14}}>
                {draft && (
                  <button type="button" onClick={startCampaign} disabled={busy || !(sel.tiers||[]).length}
                    style={{display:'flex',alignItems:'center',justifyContent:'center',gap:7,flexGrow:1,padding:11,borderRadius:9,border:'none',
                      fontWeight:700,fontSize:14,fontFamily:'inherit',color:'#fff',
                      background:(busy||!(sel.tiers||[]).length)?'#c9c6bf':'#16a34a',cursor:'pointer'}}>
                    <Play size={15}/>{tc('camp.start','Start campaign')}
                  </button>
                )}
                {running && (
                  <button type="button" onClick={stopCampaign} disabled={busy}
                    style={{display:'flex',alignItems:'center',justifyContent:'center',gap:7,flexGrow:1,padding:11,borderRadius:9,
                      border:'1px solid #e9b8b8',background:'#fff',fontWeight:700,fontSize:14,fontFamily:'inherit',color:'#dc2626',cursor:'pointer'}}>
                    <Square size={14}/>{tc('camp.stop','Close campaign')}
                  </button>
                )}
              </div>
              {draft && !(sel.tiers||[]).length && (
                <div style={{fontSize:11.5,color:'#4a4845',marginTop:8}}>
                  {tc('camp.needTier','Add at least one tier — a campaign with no gift has nothing to give.')}
                </div>
              )}
            </div>

            {/* LADDERS */}
            {Object.keys(ladders).length === 0 ? null : Object.entries(ladders).map(([fuel, rungs]) => (
              <div key={fuel} style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,overflow:'hidden',marginBottom:14}}>
                <div style={{display:'flex',alignItems:'center',gap:9,padding:'11px 15px',borderBottom:'1px solid #e5e3de'}}>
                  <span style={{width:10,height:10,borderRadius:'50%',background:fuelColour(fuel)}}/>
                  <span style={{fontSize:14,fontWeight:700}}>{tc('camp.ladder','{f} tiers').replace('{f}', fuelLabel(fuel))}</span>
                </div>
                {rungs.map((tr,i)=>(
                  <div key={tr.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 15px',borderTop:i===0?'none':'1px solid #f3f2ef'}}>
                    <span style={{fontFamily:'DM Mono, monospace',fontSize:13.5,width:78,flexShrink:0}}>
                      {num(tr.min_litres)} L
                    </span>
                    <div style={{flexGrow:1,minWidth:0}}>
                      <div style={{fontSize:13.5,color:'#1a1916'}}>{tr.product_name}</div>
                      <div style={{fontSize:11.5,color:Number(tr.gift_stock)>0?'#4a4845':'#dc2626'}}>
                        {tc('camp.give','give {q} {u}').replace('{q}', num(tr.quantity)).replace('{u}', tr.unit||'')}
                        {' · '}
                        {tc('camp.inGiftStore','{n} in gift store').replace('{n}', num(tr.gift_stock))}
                      </div>
                    </div>
                    {draft && (
                      <button type="button" onClick={()=>removeTier(tr.id)} disabled={busy}
                        aria-label={tc('camp.removeTier','Remove tier')}
                        style={{background:'none',border:'none',padding:0,cursor:'pointer'}}>
                        <X size={15} style={{color:'#7a7773'}}/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* ADD TIER — draft only, because the rules freeze on start */}
            {draft && (
              <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:15}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{tc('camp.addTier','Add a tier')}</div>
                <div style={{fontSize:11.5,color:'#4a4845',lineHeight:1.5,marginBottom:12}}>
                  {tc('camp.tierHelp','Judged on ONE fill, not a running total. Only the highest tier a fill clears is awarded, and each vehicle wins a given tier once.')}
                </div>

                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                  {FUELS.map(f=>(
                    <button key={f.id} type="button" onClick={()=>setTierForm(p=>({...p,fuel_type:f.id}))}
                      style={{display:'flex',alignItems:'center',gap:7,padding:'8px 14px',borderRadius:999,cursor:'pointer',
                        fontSize:13,fontWeight:tierForm.fuel_type===f.id?700:400,fontFamily:'inherit',
                        border:'2px solid '+(tierForm.fuel_type===f.id?f.colour:'#e5e3de'),
                        background:'#fff',color:'#1a1916'}}>
                      <span style={{width:9,height:9,borderRadius:'50%',background:f.colour}}/>{fuelLabel(f.id)}
                    </button>
                  ))}
                </div>

                <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
                  <div style={{width:130}}>
                    <label htmlFor="t-l" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('camp.fillAtLeast','FILL AT LEAST (L)')}</label>
                    <input id="t-l" type="number" step="0.001" min="0" style={inp} value={tierForm.min_litres}
                      onChange={e=>setTierForm(p=>({...p,min_litres:e.target.value}))}/>
                  </div>
                  <div style={{flexGrow:1,minWidth:200}}>
                    <label htmlFor="t-p" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('camp.giftItem','GIFT — FROM YOUR CATALOGUE')}</label>
                    <select id="t-p" style={inp} value={tierForm.product_id}
                      onChange={e=>setTierForm(p=>({...p,product_id:e.target.value}))}>
                      <option value="">{tc('camp.pickGift','Choose an item…')}</option>
                      {products.map(pr=>(
                        <option key={pr.id} value={pr.id}>
                          {pr.name} — {num(pr.gift)} {tc('camp.inGift','in gift store')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{width:110}}>
                    <label htmlFor="t-q" style={{display:'block',fontSize:11.5,fontWeight:700,color:'#4a4845',letterSpacing:'0.3px',marginBottom:5}}>{tc('camp.qty','QUANTITY')}</label>
                    <input id="t-q" type="number" step="0.001" min="0" style={inp} value={tierForm.quantity}
                      onChange={e=>setTierForm(p=>({...p,quantity:e.target.value}))}/>
                  </div>
                </div>

                {products.length === 0 && (
                  <div style={{display:'flex',gap:9,padding:'10px 12px',background:'#fff8ed',border:'1px solid #e8c89a',
                    borderRadius:8,marginBottom:12,alignItems:'flex-start'}}>
                    <AlertTriangle size={15} style={{flexShrink:0,marginTop:1,color:'#9a4607'}}/>
                    <span style={{fontSize:12,color:'#4a4845',lineHeight:1.45}}>
                      {tc('camp.noProducts','Your catalogue is empty. Add the gift on Lubes → Catalogue first, then move some into the gift store on Lubes → Stock.')}
                    </span>
                  </div>
                )}

                <button type="button" onClick={addTier}
                  disabled={busy || !tierForm.min_litres || !tierForm.product_id || !tierForm.quantity}
                  style={{width:'100%',padding:11,borderRadius:9,border:'none',fontWeight:700,fontSize:14,fontFamily:'inherit',color:'#fff',
                    background:(busy||!tierForm.min_litres||!tierForm.product_id||!tierForm.quantity)?'#c9c6bf':'#e07b0c',
                    cursor:'pointer'}}>
                  {tc('camp.addTierBtn','Add tier')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
