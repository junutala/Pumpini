'use client';
// SPOKE 3 — ATTENDANT DUES.
//
// THE OUTSTANDING IS CALCULATED, NEVER TYPED. It is derived from the man's own nozzle
// events, and there is deliberately NO FIELD for it anywhere on this screen. That is
// the structural fix for the 25-Aug loss of Rs 1,25,275 across three settlements
// recorded with cash_actual = 0: a manager cannot make a liability vanish by leaving a
// field blank, because there is no field to leave blank.
//
// THE ONLY MANUAL ENTRY IS WHAT HE BROUGHT — cash, UPI, card, credit slips, petty. That
// entry brings his suspense DOWN; nothing silently zeroes it, and a settlement of
// nothing is refused rather than recorded.
//
// THE MONEY CLOCK NEVER BLOCKS THE FORECOURT. A man with an outstanding works his next
// shift; he simply cannot reach zero until he settles.
import { useState, useEffect, useCallback } from 'react';
import { Wallet, Info, Check } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import Banner from '../../components/shared/Banner';
import SettlementBreakup, { emptyBreakup, breakupTotal } from '../../components/shared/SettlementBreakup';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { errText } from '../../lib/apiError';
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
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId]   = useState(null);
  // THE WORKING behind each man's figure, fetched on demand: attendant_id -> legs[].
  // Kept per man rather than fetched for the whole list, because most rows are read
  // and closed without ever being questioned.
  const [legs, setLegs]       = useState({});
  const [legsBusy, setLegsBusy] = useState('');
  const [form, setForm]       = useState({});
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
    } catch (e) { setErr(errText(e, 'Could not load the dues just now.')); }
    setLoading(false);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const brought = breakupTotal(form);

  const settle = async (attendant_id) => {
    setBusy(true); setErr(''); setOk('');
    try {
      await api.post('/spokes/settle', { station_id: sid, attendant_id, ...form });
      setOk(tc('dues.recorded', 'Recorded.'));
      setOpenId(null); setForm(emptyBreakup());
      await load();
    } catch (e) {
      setErr(errText(e, tc('dues.settleFailed', 'Could not record that settlement.')));
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
            {tc('dues.off', 'Attendant Dues belongs to the hub-and-spokes flow, which is switched off here. Turn it on in Settings → Shift Timings, one outlet at a time.')}
          </div>
        </div>
      </AppShell>
    );
  }

  const owing = rows.filter(r => Number(r.outstanding) > 0.5);

  return (
    <AppShell>
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <Wallet size={19} style={{ color: 'var(--brand)' }} />
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>
            {tc('dues.title', 'Attendant Dues')}
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
              {tc('dues.notMigrated', 'Attendant Dues is not switched on for this database yet. Nothing is lost — it will appear once the tables are added.')}
            </div>
          </div>
        ) : loading ? (
          <div className="card" style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {tc('dues.loading', 'Loading…')}
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>
              {tc('dues.emptyTitle', 'Nothing outstanding')}
            </div>
            <div style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6 }}>
              {tc('dues.emptyBody', 'What a man owes is worked out from his own nozzle readings — it is never typed in. Once handovers are being recorded, anyone who has not settled will appear here.')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {rows.map(r => {
              const out = Number(r.outstanding) || 0;
              const clear = out <= 0.5;
              return (
                <div key={r.attendant_id} className="card"
                  style={{ borderLeft: `3px solid ${clear ? '#166534' : 'var(--brand)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 16, fontWeight: 800,
                                   color: clear ? '#166534' : '#9a3412' }}>
                      {money(out)}
                    </span>
                  </div>

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

                  {openId === r.attendant_id ? (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0ebe3' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                        {tc('dues.whatHeBrought', 'What he handed over')}
                      </div>
                      {/* THE SAME FORM AS SHIFT CLOSE — components/shared/SettlementBreakup.
                          The manager already knows these five boxes in that order; a
                          second version of them, differing only in a label, is the drift
                          the cardinal rule forbids. And there is still NO FIELD for the
                          outstanding: it is calculated, so there is nothing to blank. */}
                      <SettlementBreakup value={form}
                        onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                          {tc('dues.total', 'Total brought')} <strong style={{ fontFamily: 'monospace' }}>{money(brought)}</strong>
                        </span>
                        {/* A SETTLEMENT OF NOTHING IS NOT A SETTLEMENT. It may not
                            complete silently at zero — that is exactly how three
                            settlements on 25-Aug carried Rs 1,25,275 away. */}
                        <button onClick={() => settle(r.attendant_id)} disabled={busy || !(brought > 0)}
                          style={{ marginLeft: 'auto', background: (busy || !(brought > 0)) ? '#e5e3de' : 'var(--brand)',
                                   color: (busy || !(brought > 0)) ? '#8b9099' : '#fff', border: 'none',
                                   borderRadius: 8, padding: '9px 15px', fontSize: 13.5, fontWeight: 700,
                                   cursor: (busy || !(brought > 0)) ? 'not-allowed' : 'pointer' }}>
                          {busy ? tc('dues.recording', 'Recording…') : tc('dues.record', 'Record what he brought')}
                        </button>
                        <button onClick={() => { setOpenId(null); setForm(emptyBreakup()); }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-3)',
                                   fontSize: 13, cursor: 'pointer' }}>
                          {tc('dues.cancel', 'Cancel')}
                        </button>
                      </div>
                      {!(brought > 0) && (
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
                          {tc('dues.zeroWhy', 'Enter what he actually handed over. A settlement of nothing is not a settlement.')}
                        </div>
                      )}
                    </div>
                  ) : clear ? (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: '#166534',
                                  display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Check size={14} /> {tc('dues.settled', 'Settled')}
                      {r.last_settled ? ` · ${when(r.last_settled)}` : ''}
                    </div>
                  ) : (
                    <button onClick={() => { setOpenId(r.attendant_id); setForm(emptyBreakup()); setOk(''); }}
                      style={{ marginTop: 12, background: 'none', border: '1px solid #e5e3de',
                               borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                      {tc('dues.settleCta', 'Settle him')}
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
