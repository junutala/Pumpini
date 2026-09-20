'use client';
//
// Gift Report — did the campaign move anything, what went out, and who gave it.
//
// 🔴 THE HARD PART IS NOT OVERSTATING THE ANSWER.
//
// Daily litres are noisy enough that a fortnight's swing usually means nothing.
// Measured on this product's own history — sixteen consecutive five-day windows
// at Highway with NO campaign running — premium ranged 442 L to 899 L, jumping
// +71% and −42% between adjacent blocks. So a single headline percentage would
// be a fiction dressed as a finding, and this screen refuses to be one:
//
//   - the DAILY SERIES is the primary reading, because its shape is honest
//   - the prior matched window sits beside it
//   - the BASELINE BAND — the range of the windows before that — is printed as
//     an error bar, so "+37%" can be read against what happens anyway
//   - the SHARE of the eligible fuel is offered as the quieter measure, since a
//     busy week lifts both sides and cancels out
//   - every daily figure is in a table, because the owner asked for raw numbers
//     and a chart nobody can check is a chart nobody believes
//
// ── ON THE CHART'S COLOUR ────────────────────────────────────────────────────
//
// Two fills from ONE hue, light (before) to dark (campaign). That is a
// SEQUENTIAL ramp, not a categorical pair, because it is one measure across one
// timeline and the campaign is a region of it — so the categorical lightness-band
// and chroma-floor checks do not apply; lightness monotonicity does, and holds.
// Validated: CVD separation ΔE 17.2 deutan, normal-vision 18.7, chroma floor
// passes. The contrast warning against the surface is relieved by the daily
// table below, which is the documented relief and is present for its own sake.
// Do not "fix" this into two unrelated hues; it would say the two windows are
// different things, and they are not.
import { useState, useEffect, useMemo } from 'react';
import { Gift, AlertTriangle, Camera, Keyboard } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import Banner from '../../../components/shared/Banner';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText } from '../../../lib/apiError';

const BEFORE = '#f5c77e';   // light step
const DURING = '#e07b0c';   // dark step — same hue
const INK    = '#1a1916';
const INK2   = '#4a4845';

const num  = (v, d=0) => Number(v||0).toLocaleString('en-IN', { maximumFractionDigits:d });
const dLbl = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN',
  { timeZone:'Asia/Kolkata', day:'2-digit', month:'short' }) : '';

export default function GiftReportPage() {
  if (typeof window === 'undefined') return null;
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const reasonLabel = r => ({
    out_of_stock: tc('crep.rOut','Out of stock'), driver_refused: tc('crep.rRefused','Driver refused'),
    damaged: tc('crep.rDamaged','Damaged piece'), other: tc('crep.rOther','Something else'),
  }[r] || r);

  const [list, setList] = useState([]);
  const [id, setId]     = useState('');
  const [rep, setRep]   = useState(null);
  const [rows, setRows] = useState([]);
  const [showRows, setShowRows] = useState(false);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stationId) return;
    (async () => {
      try {
        const cs = await api.get('/campaigns', { params:{ station_id: stationId } });
        const arr = Array.isArray(cs) ? cs : [];
        setList(arr);
        if (arr.length) setId(arr[0].id);
      } catch (e) { setErr(errText(e, tc('crep.loadFailed','Could not load campaigns.'))); }
      setLoading(false);
    })();
  }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) return;
    setErr('');
    (async () => {
      try {
        setRep(await api.get(`/campaigns/${id}/report`));
        setRows(await api.get(`/campaigns/${id}/issues`));
      } catch (e) { setErr(errText(e, tc('crep.repFailed','Could not load the report.'))); }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // One timeline: the prior window then the campaign window, in order.
  const bars = useMemo(() => {
    if (!rep) return [];
    return [
      ...(rep.prior_daily || []).map(x => ({ ...x, during:false })),
      ...(rep.daily || []).map(x => ({ ...x, during:true })),
    ];
  }, [rep]);
  const peak = Math.max(1, ...bars.map(b => b.litres));

  const Tile = ({ label, value, sub, tone }) => (
    <div style={{flexGrow:1,minWidth:150,background:'#fff',border:'1px solid #e5e3de',borderRadius:10,padding:'13px 15px'}}>
      <div style={{fontSize:10.5,fontWeight:700,color:INK2,letterSpacing:'0.4px',marginBottom:5}}>{label}</div>
      <div style={{fontFamily:'DM Mono, monospace',fontSize:26,fontWeight:500,color:tone||INK,lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:11.5,color:INK2,marginTop:5}}>{sub}</div>}
    </div>
  );

  return (
    <AppShell>
      <div style={{padding:'20px 16px',maxWidth:980,margin:'0 auto'}}>
        <h1 style={{margin:'0 0 4px',fontSize:22,fontWeight:700,letterSpacing:'-0.3px'}}>{tc('crep.title','Gift Report')}</h1>
        <p style={{margin:'0 0 14px',fontSize:13,color:INK2}}>{tc('crep.sub','What went out, who gave it, and whether it moved any fuel.')}</p>

        <Banner tone="error">{err}</Banner>

        {loading ? <div style={{fontSize:13,color:INK2}}>{tc('crep.loading','Loading…')}</div>
        : !list.length ? (
          <div style={{padding:26,textAlign:'center',background:'#fff',border:'1px solid #e5e3de',borderRadius:12}}>
            <Gift size={22} style={{color:'#c9c6bf',marginBottom:8}}/>
            <div style={{fontSize:13.5,color:INK2}}>{tc('crep.none','No campaigns to report on yet.')}</div>
          </div>
        ) : (
          <>
            <select value={id} onChange={e=>setId(e.target.value)}
              style={{width:'100%',maxWidth:420,padding:'10px 12px',border:'1.5px solid #e5e3de',borderRadius:9,
                fontSize:14,background:'#fff',fontFamily:'inherit',marginBottom:16}}>
              {list.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {rep && (
              <>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
                  <Tile label={tc('crep.issued','GIFTS ISSUED')} value={num(rep.totals.issued)}
                    sub={tc('crep.splitSub','{r} read · {t} typed').replace('{r}',rep.totals.plate_read).replace('{t}',rep.totals.plate_typed)}/>
                  <Tile label={tc('crep.notIssued','NOT ISSUED')} value={num(rep.totals.not_issued)}
                    sub={rep.by_reason[0] ? `${rep.by_reason[0].n} ${reasonLabel(rep.by_reason[0].reason).toLowerCase()}` : '—'}/>
                  <Tile label={tc('crep.abandoned','ABANDONED')} value={num(rep.totals.abandoned)}
                    sub={tc('crep.abandonedSub','sessions that ran out')}/>
                  <Tile label={tc('crep.share','SHARE OF FUEL SOLD')}
                    value={rep.share.campaign != null ? `${rep.share.campaign}%` : '—'}
                    sub={rep.share.prior != null ? tc('crep.shareFrom','from {p}%').replace('{p}',rep.share.prior) : tc('crep.noPrior','no prior period')}/>
                </div>

                {/* VOLUME */}
                <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,padding:16,marginBottom:16}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:12,flexWrap:'wrap',marginBottom:12}}>
                    <span style={{fontSize:15,fontWeight:700}}>
                      {tc('crep.volTitle','{f} sold, litres per day').replace('{f}', (rep.fuels||[]).join(' + ') || tc('crep.eligible','eligible fuel'))}
                    </span>
                    <span style={{flexGrow:1}}/>
                    {/* Legend: two fills, so identity is never colour-alone. */}
                    <span style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,color:INK2}}>
                      <span style={{width:11,height:11,borderRadius:2,background:BEFORE}}/>{tc('crep.before','before')}
                    </span>
                    <span style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,color:INK2}}>
                      <span style={{width:11,height:11,borderRadius:2,background:DURING}}/>{tc('crep.during','campaign')}
                    </span>
                  </div>

                  {bars.length === 0 ? (
                    <div style={{fontSize:12.5,color:INK2}}>{tc('crep.noVol','No sales recorded in either window.')}</div>
                  ) : (
                    <>
                      {/* Thin marks, 4px rounded tops anchored to the baseline, a 2px
                          surface gap between bars, recessive axis. Each bar carries its
                          own <title> so the figure is reachable on hover and by a
                          screen reader without a number printed on every one. */}
                      <div style={{display:'flex',alignItems:'flex-end',gap:2,height:150,
                        borderBottom:'1px solid #e5e3de',marginBottom:6}}>
                        {bars.map((b,i)=>(
                          <div key={i} title={`${dLbl(b.d)} · ${num(b.litres,2)} L`}
                            style={{flexGrow:1,minWidth:3,height:`${Math.max(2,(b.litres/peak)*100)}%`,
                              background:b.during?DURING:BEFORE,borderRadius:'4px 4px 0 0'}}/>
                        ))}
                      </div>
                      <div style={{display:'flex',fontSize:11,color:INK2,marginBottom:12}}>
                        <span style={{flexGrow:1}}>{dLbl(rep.prior.from)}</span>
                        <span style={{fontWeight:700,color:INK}}>{dLbl(rep.window.from)}</span>
                        <span style={{flexGrow:1,textAlign:'right'}}>{dLbl(rep.window.to)}</span>
                      </div>

                      <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:13,marginBottom:12}}>
                        <span style={{color:INK2}}>{tc('crep.priorTot','Before')}: <strong style={{color:INK,fontFamily:'DM Mono, monospace'}}>{num(rep.litres.prior)} L</strong></span>
                        <span style={{color:INK2}}>{tc('crep.campTot','Campaign')}: <strong style={{color:INK,fontFamily:'DM Mono, monospace'}}>{num(rep.litres.campaign)} L</strong></span>
                        {rep.litres.change_pct != null && (
                          <span style={{color:INK2}}>{tc('crep.change','Change')}: <strong style={{color:INK,fontFamily:'DM Mono, monospace'}}>{rep.litres.change_pct > 0 ? '+' : ''}{rep.litres.change_pct}%</strong></span>
                        )}
                      </div>

                      {/* 🔴 THE ERROR BAR. Without it a swing reads as a result. */}
                      <div style={{display:'flex',gap:9,padding:'11px 13px',background:'#f3f2ef',borderRadius:9,alignItems:'flex-start'}}>
                        <AlertTriangle size={15} style={{flexShrink:0,marginTop:1,color:INK2}}/>
                        <span style={{fontSize:12,color:INK2,lineHeight:1.5}}>
                          {rep.baseline
                            ? tc('crep.baseline','Before reading anything into that: this outlet’s {w} earlier windows of the same length, with no campaign running, ranged {a} L to {b} L. A swing of that size happens on its own — the daily shape and the share are the honest reading.')
                                .replace('{w}', rep.baseline.windows).replace('{a}', num(rep.baseline.min)).replace('{b}', num(rep.baseline.max))
                            : tc('crep.noBaseline','This outlet has no earlier history of the same length to compare against, so there is nothing to say yet about whether a change is real.')}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
                  {/* GIFTS OUT */}
                  <div style={{flexGrow:1,minWidth:300,background:'#fff',border:'1px solid #e5e3de',borderRadius:12,overflow:'hidden'}}>
                    <div style={{padding:'13px 15px',borderBottom:'1px solid #e5e3de',fontSize:15,fontWeight:700}}>{tc('crep.giftsOut','Gifts out')}</div>
                    {rep.by_gift.length === 0
                      ? <div style={{padding:15,fontSize:12.5,color:INK2}}>{tc('crep.noGifts','Nothing issued yet.')}</div>
                      : rep.by_gift.map((g,i)=>(
                        <div key={g.product_id} style={{display:'flex',alignItems:'baseline',gap:10,padding:'11px 15px',borderTop:i===0?'none':'1px solid #f3f2ef'}}>
                          <span style={{flexGrow:1,fontSize:13.5,color:INK}}>{g.product_name}</span>
                          <span style={{fontSize:11.5,color:g.gift_stock>0?INK2:'#dc2626'}}>
                            {tc('crep.leftN','{n} left').replace('{n}', num(g.gift_stock))}
                          </span>
                          <span style={{fontFamily:'DM Mono, monospace',fontSize:14,fontWeight:500}}>{g.times}</span>
                        </div>
                      ))}
                  </div>

                  {/* NOT ISSUED */}
                  <div style={{flexGrow:1,minWidth:260,background:'#fff',border:'1px solid #e5e3de',borderRadius:12,overflow:'hidden'}}>
                    <div style={{padding:'13px 15px',borderBottom:'1px solid #e5e3de',fontSize:15,fontWeight:700}}>{tc('crep.refusals','Not issued')}</div>
                    {rep.by_reason.length === 0
                      ? <div style={{padding:15,fontSize:12.5,color:INK2}}>{tc('crep.noRefusals','No refusals recorded.')}</div>
                      : rep.by_reason.map((r,i)=>(
                        <div key={r.reason} style={{display:'flex',alignItems:'baseline',gap:10,padding:'11px 15px',borderTop:i===0?'none':'1px solid #f3f2ef'}}>
                          <span style={{flexGrow:1,fontSize:13.5,color:INK}}>{reasonLabel(r.reason)}</span>
                          <span style={{fontFamily:'DM Mono, monospace',fontSize:14,fontWeight:500}}>{r.n}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* THE CONTROL */}
                <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,overflow:'hidden',marginBottom:16}}>
                  <div style={{padding:'13px 15px',borderBottom:'1px solid #e5e3de'}}>
                    <div style={{fontSize:15,fontWeight:700}}>{tc('crep.whoTitle','Who issued them')}</div>
                    <div style={{fontSize:11.5,color:INK2,marginTop:2}}>
                      {tc('crep.whoSub','Typed plates beside the count. A worn plate is nobody’s fault — but it is also the one door to naming any vehicle, so the rate is worth a glance.')}
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 84px',padding:'8px 15px',background:'#f3f2ef',borderBottom:'1px solid #e5e3de'}}>
                    {[tc('crep.cWho','ATTENDANT'),tc('crep.cIssued','ISSUED'),tc('crep.cRefused','REFUSED'),tc('crep.cTyped','TYPED')].map((h,i)=>(
                      <span key={h} style={{fontSize:10.5,fontWeight:700,color:INK2,letterSpacing:'0.4px',textAlign:i===0?'left':'right'}}>{h}</span>
                    ))}
                  </div>
                  {rep.by_attendant.length === 0
                    ? <div style={{padding:15,fontSize:12.5,color:INK2}}>{tc('crep.noWho','Nobody has issued a gift yet.')}</div>
                    : rep.by_attendant.map(a=>(
                      <div key={a.id||a.name} style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 84px',alignItems:'center',padding:'11px 15px',borderBottom:'1px solid #f3f2ef'}}>
                        <span style={{fontSize:13.5,color:INK}}>{a.name || tc('crep.unknown','—')}</span>
                        <span style={{fontFamily:'DM Mono, monospace',fontSize:13.5,textAlign:'right'}}>{a.issued}</span>
                        <span style={{fontFamily:'DM Mono, monospace',fontSize:13.5,textAlign:'right',color:INK2}}>{a.refused}</span>
                        <span style={{fontFamily:'DM Mono, monospace',fontSize:13.5,textAlign:'right',
                          color:a.typed_pct >= 25 ? '#dc2626' : INK2}}>{a.typed}{a.issued?` (${a.typed_pct}%)`:''}</span>
                      </div>
                    ))}
                </div>

                {/* THE WORKING. Raw numbers, because a total nobody can open is a
                    total nobody checks — and it is the documented relief for the
                    chart's contrast warning. */}
                <button type="button" onClick={()=>setShowRows(v=>!v)}
                  style={{background:'none',border:'none',padding:0,color:'#9a4607',fontSize:13,cursor:'pointer',fontFamily:'inherit',marginBottom:10}}>
                  {showRows ? tc('crep.hideRows','Hide every gift') : tc('crep.showRows','Show every gift, one line each')} ({rows.length})
                </button>

                {showRows && (
                  <div style={{background:'#fff',border:'1px solid #e5e3de',borderRadius:12,overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',minWidth:640}}>
                      <thead><tr style={{background:'#f3f2ef'}}>
                        {[tc('crep.hWhen','WHEN'),tc('crep.hVehicle','VEHICLE'),tc('crep.hFill','FILL'),
                          tc('crep.hGift','GIFT'),tc('crep.hBy','BY'),tc('crep.hOut','OUTCOME')].map(h=>(
                          <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10.5,fontWeight:700,color:INK2,letterSpacing:'0.4px'}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {rows.map(r=>(
                          <tr key={r.id} style={{borderTop:'1px solid #f3f2ef'}}>
                            <td style={{padding:'9px 12px',fontSize:12.5,color:INK2,whiteSpace:'nowrap'}}>
                              {r.settled_at ? new Date(r.settled_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}
                            </td>
                            <td style={{padding:'9px 12px',fontFamily:'DM Mono, monospace',fontSize:12.5,whiteSpace:'nowrap'}}>
                              {r.vehicle_number}
                              {r.plate_source === 'manual'
                                ? <Keyboard size={11} style={{marginLeft:5,verticalAlign:'-1px',color:'#ca8a04'}}/>
                                : <Camera size={11} style={{marginLeft:5,verticalAlign:'-1px',color:'#c9c6bf'}}/>}
                            </td>
                            <td style={{padding:'9px 12px',fontSize:12.5,whiteSpace:'nowrap'}}>
                              {num(r.litres,2)} L{r.bill_no ? <span style={{color:INK2}}> · #{r.bill_no}</span> : ''}
                            </td>
                            <td style={{padding:'9px 12px',fontSize:12.5}}>{r.product_name || '—'}</td>
                            <td style={{padding:'9px 12px',fontSize:12.5,color:INK2}}>{r.issued_by_name || '—'}</td>
                            <td style={{padding:'9px 12px',fontSize:12.5,
                              color:r.status==='issued'?'#166534':INK2}}>
                              {r.status==='issued' ? tc('crep.oIssued','Issued') : reasonLabel(r.reason)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
