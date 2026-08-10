'use client';
// Accounts module — landing.
//
// This is the entry screen for the OPTIONAL bookkeeping module. Slice 1 ships the
// on/off plumbing only: the page reads the outlet's `accounts_enabled` switch and
// shows the right state. The real screens (posting engine, expense capture, P&L,
// balance sheet, finance dashboard) land in later slices behind this same page.
//
// It never touches an existing flow — it only READS the settings endpoint.
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Landmark, Settings as SettingsIcon } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';

export default function AccountsPage() {
  const { station, user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;
  const isOwner = user?.role === 'owner';

  const [enabled, setEnabled] = useState(null); // null = loading, then true/false

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`)
      .then(s => setEnabled(!!s?.accounts_enabled))
      .catch(() => setEnabled(false));
  }, [sid]);

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
        <div className="card" style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
            {tc('acc.onTitle', 'Accounts is on for this outlet')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {tc('acc.onDesc', 'The module is enabled. Screens are being rolled out in stages — the posting engine, expense capture, profit/loss, balance sheet and the finance dashboard will appear here as each is released.')}
          </div>
        </div>
      )}
    </AppShell>
  );
}
