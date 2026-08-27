'use client';
// Accounts module — landing + a small verification console.
//
// Slices 1–2 shipped the switch and the posting engine; Slice 3 wires the auto-fed
// per-shift / per-delivery events. This screen lets the owner pull those into the
// journal and eyeball the result (trial balance + recent entries) while the finance
// dashboard and reports are still being built. It only READS existing data via the
// module's own /api/accounts endpoints — no existing flow is touched.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Landmark, Settings as SettingsIcon, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';

import { errText } from '../../lib/apiError';
const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsPage() {
  const { station, user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;
  const isOwner = user?.role === 'owner';

  const [enabled, setEnabled] = useState(null); // null=loading
  const [tb, setTb] = useState(null);
  const [journal, setJournal] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadLedger = useCallback(async () => {
    if (!sid) return;
    const [tbr, jr] = await Promise.all([
      api.get(`/accounts/trial-balance?station_id=${sid}`).catch(() => null),
      api.get(`/accounts/journal?station_id=${sid}&limit=40`).catch(() => null),
    ]);
    setTb(tbr && tbr.enabled ? tbr : null);
    setJournal(jr && jr.enabled ? (jr.entries || []) : []);
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`)
      .then(s => setEnabled(!!s?.accounts_enabled))
      .catch(() => setEnabled(false));
  }, [sid]);

  useEffect(() => { if (enabled) loadLedger(); }, [enabled, loadLedger]);

  const materialize = async (reset = false) => {
    if (reset && !window.confirm(tc('acc.resetConfirm', 'Re-post from scratch? This clears the auto-posted shift/delivery entries and posts them again with the current logic. Manual entries are kept.'))) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.post('/accounts/materialize', { station_id: sid, reset });
      setMsg(tc('acc.posted', 'Posted {s} shift(s) and {d} delivery(ies).')
        .replace('{s}', r.shifts_posted ?? 0).replace('{d}', r.deliveries_posted ?? 0));
      await loadLedger();
    } catch (e) {
      setMsg(errText(e, tc('acc.postFailed', 'Could not post entries.')));
    }
    setBusy(false);
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Landmark size={22} /> {tc('acc.title', 'Accounts')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {tc('acc.subtitle', 'Profit & loss, balance sheet and the money pulse of your outlet — built from what Pumpini already records.')}
          </div>
        </div>
      </div>

      {enabled === null && (
        <div className="card" style={{ maxWidth: 560 }}>{tc('common.loading', 'Loading…')}</div>
      )}

      {enabled === false && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
            {tc('acc.offTitle', 'Accounts is switched off for this outlet')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.5 }}>
            {tc('acc.offDesc', 'The Accounts module is optional. Turn it on to see profit/loss, the balance sheet and the finance dashboard for this outlet. Your operations are unaffected either way.')}
          </div>
          {isOwner ? (
            <Link href="/settings" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none',
              background: '#FF6B00', color: '#fff', fontWeight: 600, fontSize: 13,
              padding: '9px 16px', borderRadius: 8,
            }}>
              <SettingsIcon size={15} /> {tc('acc.goToSettings', 'Enable in Settings → Accounting')}
            </Link>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              {tc('acc.offOwnerHint', 'Ask the outlet owner to enable it in Settings → Accounting.')}
            </div>
          )}
        </div>
      )}

      {enabled === true && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
          {/* Pull settled shifts + deliveries into the journal */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tc('acc.postTitle', 'Post settled shifts & deliveries')}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>
                  {tc('acc.postDesc', 'Reads settled shifts (sales, COGS, petty cash) and deliveries (fuel purchases) and posts them to the journal. Safe to run repeatedly — only new items are posted.')}
                </div>
              </div>
              {isOwner && (
                <button onClick={() => materialize(false)} disabled={busy} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, background: '#FF6B00',
                  color: '#fff', fontWeight: 600, fontSize: 13, padding: '9px 16px', borderRadius: 8,
                  border: 'none', cursor: busy ? 'wait' : 'pointer', flexShrink: 0,
                }}>
                  <RefreshCw size={15} /> {busy ? tc('acc.posting', 'Posting…') : tc('acc.postBtn', 'Post now')}
                </button>
              )}
            </div>
            {msg && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-2)' }}>{msg}</div>}
            {isOwner && (
              <button onClick={() => materialize(true)} disabled={busy} style={{
                marginTop: 10, background: 'none', border: 'none', color: 'var(--text-3)',
                fontSize: 12, cursor: busy ? 'wait' : 'pointer', textDecoration: 'underline', padding: 0,
              }}>
                {tc('acc.repost', 'Re-post from scratch')}
              </button>
            )}
          </div>

          {/* Trial balance — the correctness check */}
          {tb && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tc('acc.trialBalance', 'Trial Balance')}</div>
                {tb.balanced
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#16a34a' }}><CheckCircle2 size={14} /> {tc('acc.balanced', 'Balanced')}</span>
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#dc2626' }}><AlertTriangle size={14} /> {tc('acc.unbalanced', 'Not balanced')}</span>}
              </div>
              {(!tb.rows || !tb.rows.length) ? (
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('acc.noEntries', 'No entries yet — post settled shifts above.')}</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        <th style={{ padding: '6px 8px' }}>{tc('acc.account', 'Account')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>{tc('acc.debit', 'Debit')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>{tc('acc.credit', 'Credit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tb.rows.map(r => (
                        <tr key={r.account_code} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 8px' }}>{r.name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.debit) ? fmt(r.debit) : '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.credit) ? fmt(r.credit) : '—'}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                        <td style={{ padding: '6px 8px' }}>{tc('acc.total', 'Total')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(tb.totalDebit)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(tb.totalCredit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Recent journal */}
          {journal.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{tc('acc.recentJournal', 'Recent Journal')}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {journal.slice(0, 20).map(j => (
                  <div key={j.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                      <span style={{ color: 'var(--text-2)' }}>{j.entry_date} · {j.narration || j.event_type}</span>
                      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(j.amount)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
                      {(j.lines || []).map(l => `${l.account_name} ${Number(l.debit) ? 'Dr ' + fmt(l.debit) : 'Cr ' + fmt(l.credit)}`).join('  ·  ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
