'use client';
// SPOKE 3 — ATTENDANT CLOSE.
//
// Owner, 23-Sep-2026: "the shift end will be renamed as Attendant Close... show all the
// attendants who have assigned nozzles and let the flow start from there instead of the
// current LOV for attendants."
//
// 🔴 WHY THE LIST CHANGED. It was built from outstanding(), which derives from
// CLOSINGS — so a man who had taken a nozzle and not yet handed it over did not appear
// at all. He owes nothing yet, which is true, and he is also exactly the man standing
// in front of the manager wanting to go home. The list now STARTS from who is holding a
// nozzle, and the men who owe follow.
//
// 🔴 SETTLING HIM RELEASES HIS NOZZLES. Owner, 23-Sep-2026: "If the attendant settles
// his account, ALL his assigned nozzles will be released and goes back to the pool."
// So a man still holding nozzles is closed HERE: one closing reading per nozzle, the
// total due, what he brought, and one act. Nozzle Events only hands a nozzle from one
// man to another — there is no "nobody takes over" there any more, so each act has one
// path. The reading box is components/shared/HandoverReading, the same one Nozzle
// Events embeds, so the two screens cannot drift apart on how a reading is taken.
//
// 🔴 THE TOTAL DUE INCLUDES WHAT HIS REASSIGNMENTS ALREADY PUT ON HIM. Owner: "do not
// forget to add the suspense created by the nozzle reassign during the attendant
// settlement." `r.outstanding` is his running account from the server — every nozzle
// taken off him by a reassign, less everything he has brought — and each nozzle closed
// now is added to it, line by line, before he is asked what he brought.

import { useState, useEffect, useCallback } from 'react';
import { Wallet, Info, Check } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import Banner from '../../components/shared/Banner';
import SettlementBreakup, { emptyBreakup, breakupTotal } from '../../components/shared/SettlementBreakup';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText, errCode } from '../../lib/apiError';
import HandoverReading from '../../components/shared/HandoverReading';
import { nozName } from '../../lib/nozzle';

const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = ts => ts ? new Date(ts).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '';

export default function AttendantDuesPage() {
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [rows, setRows]       = useState([]);
  // WHO IS ON A NOZZLE RIGHT NOW. Travels with the dues in one answer — see
  // GET /spokes/outstanding.
  const [held, setHeld]       = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId]   = useState(null);
  // THE WORKING behind each man's figure, fetched on demand: attendant_id -> legs[].
  // Kept per man rather than fetched for the whole list, because most rows are read
  // and closed without ever being questioned.
  const [legs, setLegs]       = useState({});
  const [legsBusy, setLegsBusy] = useState('');
  const [form, setForm]       = useState({});
  // CLOSING HIS NOZZLES, per nozzle: the reading (typed or off a slip), the preview the
  // server derived for it, and the physics refusal if one came back.
  const [closeForm, setCloseForm] = useState({});   // nozzle_id -> { reading, source, serial, no, reason }
  const [closePv, setClosePv]     = useState({});   // nozzle_id -> handover preview
  const [refused, setRefused]     = useState({});   // nozzle_id -> sentence
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');

  const load = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const r = await api.get('/spokes/outstanding', { params: { station_id: sid } });
      setEnabled(r?.enabled !== false);
      setRows(Array.isArray(r?.attendants) ? r.attendants : []);
      setHeld(Array.isArray(r?.holdings) ? r.holdings : []);
    } catch (e) { setErr(errText(e, 'Could not load the dues just now.')); }
    setLoading(false);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const brought = breakupTotal(form);

  const resetClose = () => { setCloseForm({}); setClosePv({}); setRefused({}); };

  // CLOSE AND SETTLE, ONE ACT. Each nozzle he holds gets its closing reading — the
  // event that closes him and opens nobody, so the nozzle goes back to the pool — and
  // then what he brought is recorded against the running account.
  //
  // ORDER MATTERS AND FAILURE IS SAFE. Closings first: they are what put the litres on
  // his account. If one is refused (a reading that went down, or rose faster than a
  // pump can pour) the rest stop and the reason box opens on that nozzle; closings
  // already recorded stand, because each is a true reading. If the settlement itself
  // fails, his nozzles are free and he stays on the list owing exactly what he owes —
  // nothing is lost and nothing is invented.
  const settle = async (r) => {
    setBusy(true); setErr(''); setOk('');
    try {
      for (const h of (r.holds || [])) {
        const f = closeForm[h.nozzle_id] || {};
        try {
          await api.post('/spokes/event', {
            station_id: sid, nozzle_id: h.nozzle_id,
            reading: Number(f.reading),
            opens_attendant_id: null,
            source: f.source === 'photo' ? 'photo' : 'typed',
            drift_reason: f.reason || undefined,
            read_pump_serial: f.serial || undefined, read_nozzle_no: f.no || undefined,
          });
        } catch (e) {
          const code = errCode(e);
          if (code === 'reading_decreased' || code === 'faster_than_the_pump') {
            setRefused(x => ({ ...x, [h.nozzle_id]: errText(e, 'That figure cannot be right.') }));
          } else {
            setErr(errText(e, tc('dues.closeFailed', 'Could not record that closing reading.')));
          }
          await load(); setBusy(false); return;
        }
      }
      // A SETTLEMENT OF NOTHING IS NOT A SETTLEMENT — unless there is nothing to
      // settle. A man who took a nozzle and sold nothing must still be able to go home;
      // his nozzles are closed above and no settlement row is written for zero.
      if (brought > 0) {
        await api.post('/spokes/settle', { station_id: sid, attendant_id: r.attendant_id, ...form });
      }
      setOk(tc('dues.recorded', 'Recorded.'));
      setOpenId(null); setForm(emptyBreakup()); resetClose();
      await load();
    } catch (e) {
      setErr(errText(e, tc('dues.settleFailed', 'Could not record that settlement.')));
      await load();
    }
    setBusy(false);
  };

  // WHY THIS IS ON DEMAND AND NOT ROLLED INTO THE LIST. The list answers "who owes
  // what"; this answers "and how do you know". A manager asks the second question of
  // one man at a time, usually the first few times he uses the screen and rarely
  // after — so fetching every man's legs up front would be work nobody asked for.
  const showWorking = async (attendant_id) => {
    if (legs[attendant_id]) { setLegs(l => ({ ...l, [attendant_id]: null })); return; }
    setLegsBusy(attendant_id);
    try {
      const r = await api.get(`/spokes/outstanding/${attendant_id}/detail`, { params: { station_id: sid } });
      setLegs(l => ({ ...l, [attendant_id]: Array.isArray(r) ? r : [] }));
    } catch (e) { setErr(errText(e, 'Could not load the breakdown.')); }
    setLegsBusy('');
  };

  if (!hubSpokesFlow) {
    return (
      <AppShell>
        <div className="card" style={{ maxWidth: 640, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Info size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, color: '#666' }}>
            {tc('dues.off', 'Attendant Close belongs to the nozzle-led flow, which is switched off here. This outlet runs shift-led — its operators are closed from Shift Close. You can change the flow in Settings.')}
          </div>
        </div>
      </AppShell>
    );
  }

  // ── WHO IS ON THIS LIST, AND WHEN HE LEAVES IT ─────────────────────────────
  //
  // Owner, 23-Sep-2026: "₹1 is fine... remove him if the settlement completes. If he
  // has outstanding, add it to the next settlement, now that we have the running
  // account for the attendant."
  //
  // UNDER ₹1 IS CLEARED. Cash is counted in rupees and meters in paise, so nearly
  // every settlement leaves a few paise — ABR DUMMY1 owed ₹7,010.83 and brought
  // ₹7,010.00. The paise are not zeroed: they stay in the ledger and ride into his
  // next settlement with everything else. They just stop being shown as a debt.
  const CLEARED_BELOW = 1;
  const isClear = r => Math.abs(Number(r.outstanding) || 0) < CLEARED_BELOW;

  // A SETTLEMENT COMPLETES HIM. Once his last settlement is later than his last
  // close, he has nothing new to answer for today and he leaves the list — even if
  // he settled short. The shortfall is NOT forgotten: outstanding() is his running
  // account (everything he has ever sold, less everything he has ever brought), so
  // the balance is already inside the figure he meets at his next close. A man
  // holding a nozzle is never removed: fuel is still being sold on his account.
  const settledSinceClose = r =>
    r.last_settled && (!r.last_close || new Date(r.last_settled) >= new Date(r.last_close));

  const byId = new Map();
  for (const h of held) {
    byId.set(String(h.attendant_id), {
      attendant_id: h.attendant_id, name: h.name,
      holds: h.nozzles || [],
      ltrs: 0, value: 0, handed_over: 0, outstanding: 0, last_close: null,
    });
  }
  for (const r of rows) {
    const k = String(r.attendant_id);
    byId.set(k, { ...(byId.get(k) || { holds: [] }), ...r });
  }
  const people = [...byId.values()]
    .filter(r => (r.holds || []).length > 0                 // still on a nozzle
              || (!isClear(r) && !settledSinceClose(r)))   // owes, and not yet settled
    .sort((a, b) => {
      const ah = (a.holds || []).length > 0, bh = (b.holds || []).length > 0;
      if (ah !== bh) return ah ? -1 : 1;                    // holders first
      return (Number(b.outstanding) || 0) - (Number(a.outstanding) || 0);
    });
  const owing = people.filter(r => !isClear(r));

  return (
    <AppShell>
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <Wallet size={19} style={{ color: 'var(--brand)' }} />
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>
            {tc('dues.title', 'Attendant Close')}
          </h1>
          {owing.length > 0 && (
            <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, padding: '2px 8px',
                           borderRadius: 99, background: '#fbeee4', color: '#9a3412' }}>
              {owing.length} {tc('dues.notCleared', 'not cleared')}
            </span>
          )}
        </div>

        {err && <Banner tone="error">{err}</Banner>}
        {ok && <Banner tone="ok">{ok}</Banner>}

        {!enabled ? (
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={17} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13.5, color: '#666' }}>
              {tc('dues.notMigrated', 'Attendant Close is not switched on for this database yet. Nothing is lost — it will appear once the tables are added.')}
            </div>
          </div>
        ) : loading ? (
          <div className="card" style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {tc('dues.loading', 'Loading…')}
          </div>
        ) : people.length === 0 ? (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>
              {tc('dues.emptyTitle2', 'Nobody to close')}
            </div>
            <div style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6 }}>
              {tc('dues.emptyBody3', 'Men holding a nozzle, or with a close not yet settled, appear here.')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
            {people.map(r => {
              const out = Number(r.outstanding) || 0;
              const clear = isClear(r);
              return (
                <div key={r.attendant_id} className="card"
                  style={{ minWidth: 0, borderLeft: `3px solid ${clear ? '#166534' : 'var(--brand)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 16, fontWeight: 800,
                                   color: clear ? '#166534' : '#9a3412' }}>
                      {money(out)}
                    </span>
                  </div>

                  {/* WHAT HE IS STILL HOLDING. Owner, 23-Sep-2026: the flow starts
                      from the men who have nozzles assigned. Each one is named the one
                      way a nozzle is ever named, and the reading it stands at is shown
                      so the manager knows what he is going to be reading against.

                      He cannot be finished while he holds one: a nozzle still open
                      against him is fuel still being sold on his account. The link goes
                      to the ONE form that records a handover rather than repeating it
                      here — see the note at the top of this file. */}
                  {(r.holds || []).length > 0 && (
                    <div style={{ marginTop: 9, padding: '9px 11px', borderRadius: 8,
                                  background: 'var(--surface-2)', fontSize: 12.5 }}>
                      <div style={{ fontWeight: 700, marginBottom: 5 }}>
                        {tc('dues.stillHolding', 'Still holding {n} nozzle(s)').replace('{n}', r.holds.length)}
                      </div>
                      <div style={{ display: 'grid', gap: 3 }}>
                        {r.holds.map(h => (
                          <div key={h.nozzle_id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap',
                                justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                            <span>{nozName(h)}</span>
                            <span style={{ color: 'var(--text-3)' }}>
                              {h.reading == null ? '—' : Number(h.reading).toFixed(3)}
                              {h.since ? ` · ${when(h.since)}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* HOW IT WAS ARRIVED AT, shown rather than asserted. He can see the
                      litres and the money behind the figure he is being asked about. */}
                  <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12.5,
                                color: 'var(--text-3)', flexWrap: 'wrap' }}>
                    <span>{Number(r.ltrs || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L {tc('dues.sold', 'sold')}</span>
                    <span>{money(r.value)} {tc('dues.owed', 'owed')}</span>
                    <span>{money(r.handed_over)} {tc('dues.broughtWord', 'brought')}</span>
                    {r.last_close && <span>{tc('dues.lastClose', 'last close')} {when(r.last_close)}</span>}
                    {Number(r.ltrs || 0) > 0 && (
                      <button type="button" onClick={() => showWorking(r.attendant_id)}
                        disabled={legsBusy === r.attendant_id}
                        style={{ border: 'none', background: 'none', padding: 0, fontSize: 12.5,
                                 fontWeight: 700, color: 'var(--brand)', cursor: 'pointer' }}>
                        {legsBusy === r.attendant_id
                          ? tc('dues.working', 'working…')
                          : legs[r.attendant_id]
                            ? tc('dues.hideWorking', 'hide the working')
                            : tc('dues.showWorking', 'how is this worked out?')}
                      </button>
                    )}
                  </div>

                  {/* THE WORKING. Every row is two readings off two slips HE
                      photographed, with the subtraction and the multiplication shown.
                      Owner, 29-Aug-2026: "wherever money is involved, we should show as
                      much info as possible so that the manager also knows that we are
                      supporting him in his work rather than extending his work."

                      A calculated figure he cannot audit is a figure he will not trust
                      — today the slip reader handed him confident numbers, he checked
                      them himself, found them wrong, and stopped scanning. He verifies
                      one line here against paper in ten seconds, and then he stops
                      verifying. That is what trust is. */}
                  {legs[r.attendant_id] && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #f0ebe3', paddingTop: 10, overflowX: 'auto' }}>
                      {legs[r.attendant_id].length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                          {tc('dues.noLegs', 'No closed nozzle readings yet — nothing has been handed over on his account.')}
                        </div>
                      ) : (
                        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
                          <tbody>
                            {legs[r.attendant_id].map(l => (
                              <tr key={l.event_id} style={{ borderBottom: '1px solid #f6f2ec' }}>
                                <td style={{ padding: '5px 10px 5px 0', fontWeight: 700, whiteSpace: 'nowrap' }}>{nozName(l)}</td>
                                <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                  {l.opened_at_reading == null
                                    ? tc('dues.firstReading', 'first reading')
                                    : `${Number(l.opened_at_reading).toFixed(3)} → ${Number(l.closed_at_reading).toFixed(3)}`}
                                </td>
                                <td style={{ padding: '5px 10px', fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {Number(l.ltrs).toFixed(2)} L
                                </td>
                                <td style={{ padding: '5px 10px', fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                  × {money(l.price)}
                                </td>
                                <td style={{ padding: '5px 0 5px 10px', fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  {money(l.value)}
                                </td>
                              </tr>
                            ))}
                            <tr>
                              <td colSpan={4} style={{ padding: '7px 10px 0 0', textAlign: 'right', fontWeight: 700 }}>
                                {tc('dues.owed', 'owed')}
                              </td>
                              <td style={{ padding: '7px 0 0 10px', fontFamily: 'monospace', textAlign: 'right', fontWeight: 800 }}>
                                {money(r.value)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {openId === r.attendant_id ? (() => {
                    const holds = r.holds || [];
                    const allRead = holds.every(h => {
                      const v = (closeForm[h.nozzle_id] || {}).reading;
                      return v !== undefined && v !== '' && Number.isFinite(Number(v));
                    });
                    // TOTAL DUE = his running account + each nozzle closed now. Every
                    // part is a server figure (outstanding() and handover-preview); this
                    // only adds them up, and shows each one it adds.
                    const earlier = Number(r.outstanding) || 0;
                    const pvs = holds.map(h => closePv[h.nozzle_id]);
                    const pvKnown = pvs.every(pv => pv && pv.found);
                    const dueNow = pvs.reduce((sum, pv) => sum + (Number(pv?.value) || 0), 0);
                    const due = earlier + dueNow;
                    // He may go home having brought nothing only when nothing is due.
                    const canGo = holds.length === 0
                      ? brought > 0
                      : allRead && (brought > 0 || (pvKnown && Math.abs(due) < CLEARED_BELOW));
                    return (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0ebe3', display: 'grid', gap: 12 }}>
                      {holds.length > 0 && (
                        <div style={{ display: 'grid', gap: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {tc('dues.closingReadings', 'Closing reading on each nozzle')}
                          </div>
                          {holds.map(h => (
                            <div key={h.nozzle_id}>
                              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>
                                {nozName(h)}
                              </div>
                              <HandoverReading stationId={sid} nozzle={{ id: h.nozzle_id, nozzle_name: h.nozzle_name }}
                                value={closeForm[h.nozzle_id] || {}}
                                onChange={patch => setCloseForm(x => ({ ...x, [h.nozzle_id]: { ...(x[h.nozzle_id] || {}), ...patch } }))}
                                onPreview={pv => setClosePv(x => ({ ...x, [h.nozzle_id]: pv }))}
                                refused={refused[h.nozzle_id]} disabled={busy} showBalance={false} />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* WHAT HE OWES, WORKING SHOWN — including what his reassignments
                          already put on him. */}
                      <div style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--surface-2)',
                                    fontSize: 12.5, display: 'grid', gap: 3 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <span style={{ color: 'var(--text-3)' }}>{tc('dues.earlier', 'From earlier handovers')}</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{money(earlier)}</span>
                        </div>
                        {holds.map(h => {
                          const pv = closePv[h.nozzle_id];
                          return (
                            <div key={h.nozzle_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <span style={{ color: 'var(--text-3)' }}>{nozName(h)}</span>
                              <span style={{ fontFamily: 'var(--font-mono)' }}>{pv && pv.found ? money(pv.value) : '—'}</span>
                            </div>
                          );
                        })}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontWeight: 700,
                                      borderTop: '1px solid #e5e3de', paddingTop: 5, marginTop: 2 }}>
                          <span>{tc('dues.totalDue', 'Total due')}</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>
                            {holds.length === 0 || pvKnown ? money(due) : '—'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                          {tc('dues.whatHeBrought', 'What he handed over')}
                        </div>
                        {/* THE SAME FORM AS SHIFT CLOSE — components/shared/SettlementBreakup.
                            Still NO FIELD for the outstanding: it is calculated. */}
                        <SettlementBreakup value={form}
                          onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))} />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                          {tc('dues.total', 'Total brought')} <strong style={{ fontFamily: 'monospace' }}>{money(brought)}</strong>
                        </span>
                        <button onClick={() => settle(r)} disabled={busy || !canGo}
                          style={{ marginLeft: 'auto', background: (busy || !canGo) ? '#e5e3de' : 'var(--brand)',
                                   color: (busy || !canGo) ? '#8b9099' : '#fff', border: 'none',
                                   borderRadius: 8, padding: '9px 15px', fontSize: 13.5, fontWeight: 700,
                                   cursor: (busy || !canGo) ? 'not-allowed' : 'pointer' }}>
                          {busy ? tc('dues.recording', 'Recording…')
                            : holds.length ? tc('dues.closeAndSettle', 'Close & settle')
                            : tc('dues.record', 'Record what he brought')}
                        </button>
                        <button onClick={() => { setOpenId(null); setForm(emptyBreakup()); resetClose(); }}
                          style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 8,
                                   color: 'var(--text-2)', padding: '9px 15px', fontSize: 13, cursor: 'pointer' }}>
                          {tc('spoke.close', 'Close')}
                        </button>
                      </div>
                    </div>
                    );
                  })() : (clear && !(r.holds || []).length) ? (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: '#166534',
                                  display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Check size={14} /> {tc('dues.settled', 'Settled')}
                      {r.last_settled ? ` · ${when(r.last_settled)}` : ''}
                    </div>
                  ) : (
                    <button onClick={() => { setOpenId(r.attendant_id); setForm(emptyBreakup()); resetClose(); setOk(''); }}
                      style={{ marginTop: 12, background: 'none', border: '1px solid #e5e3de',
                               borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                      {(r.holds || []).length ? tc('dues.closeAndSettle', 'Close & settle') : tc('dues.settleCta', 'Settle him')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
