'use client';
// SPOKE 1 · TANK RECON — the landing.
//
// THE OUTLET IS THE HUB. This is the manager's way into the tank's own clock: ATG,
// deliveries and every nozzle slip captured at ONE moment, so the tank window and the
// nozzle totals share a boundary by construction rather than by arithmetic afterwards.
//
// IT SHOWS THE LAST RECON, NEVER CURRENT STOCK (owner, 27-Aug-2026: "we will not have
// data on Current Stock. That's a trap."). A figure labelled "stock now" would be the
// last dip plus assumptions, and a manager reads it as a measurement. The last recon
// is a thing that actually happened, at a time we can name.
//
// The date picker is a JUMP TO, not the primary control — one card, one line, one
// button, and the past lives behind the jump rather than as a list padding the screen.
//
// BEHIND THE MIGRATION FLAG. Reached only from the Daily Flow group, which the sidebar
// shows only where hub_spokes_migration_enabled is on. A manager who types the URL at
// an outlet still on the shift flow is told so plainly rather than shown half a screen.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Droplet, CalendarDays, ArrowRight, Info } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function TankReconPage() {
  const router = useRouter();
  const { station, hubSpokesFlow } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [jumpTo, setJumpTo] = useState(today());

  // THE RECON RECORD DOES NOT EXIST YET. A row per tank window — its two ATG
  // boundaries, its deliveries, its nozzle totals, its testing, its variance and its
  // draft/confirmed state — is owner-run DDL and is not applied. Until it is, there is
  // nothing to read and the honest screen is the empty state below.
  //
  // Deliberately NOT faked from dipstick_readings: a dip is not a recon, and a screen
  // that dresses one up as the other teaches a manager to trust a number nobody took.
  const [lastRecon] = useState(null);

  if (!hubSpokesFlow) {
    return (
      <AppShell>
        <div style={{ maxWidth: 560 }}>
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={18} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                {tc('recon.offTitle', 'This outlet runs the shift flow')}
              </div>
              <div style={{ fontSize: 13.5, color: '#666' }}>
                {tc('recon.offBody', 'Tank Recon belongs to the hub-and-spokes flow, which is switched off here. Turn it on in Settings → Shift Timings, one outlet at a time.')}
              </div>
              <button onClick={() => router.push('/dashboard')}
                style={{ marginTop: 14, background: 'none', border: '1px solid #e5e3de', borderRadius: 8,
                         padding: '7px 13px', fontSize: 13, cursor: 'pointer' }}>
                {tc('recon.backToDashboard', 'Back to Bunk View')}
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 560 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Droplet size={19} style={{ color: 'var(--brand)' }} />
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>
              {tc('recon.title', 'Tank Recon')}
            </h1>
          </div>
          {/* JUMP TO, not the primary control — it sits quiet beside the heading. */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5,
                          color: 'var(--text-3)', cursor: 'pointer' }}>
            <CalendarDays size={14} />
            {tc('recon.jumpTo', 'Jump to date')}
            <input type="date" value={jumpTo} max={today()}
              onChange={e => setJumpTo(e.target.value)}
              style={{ border: '1px solid #e5e3de', borderRadius: 7, padding: '4px 7px',
                       fontSize: 12.5, background: '#fff' }} />
          </label>
        </div>

        {lastRecon ? null : (
          // THE EMPTY STATE — specified in the build plan (§8.4) and drawn nowhere, so
          // it is written here rather than left to a blank card. It says what a recon
          // is and what the manager will be asked for, because the first one he does
          // is the only one he does without knowing.
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>
              {tc('recon.emptyTitle', 'No recon yet at this outlet')}
            </div>
            <div style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6 }}>
              {tc('recon.emptyBody', 'A recon reads the tanks and every nozzle at one moment, so the two can be compared over the same window. Three steps: photograph the gauge console, scan the nozzle slips, then check the variance before you confirm it.')}
            </div>
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#faf8f5',
                          border: '1px solid #f0ebe3', borderRadius: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
              {tc('recon.emptyNote', 'Nothing is recorded until you confirm the variance, and a recon you abandon is kept as a draft rather than deleted.')}
            </div>
          </div>
        )}

        {/* ONE BUTTON. The recon is the job this screen exists for; everything else on
            it is context for that press. */}
        <button onClick={() => router.push('/tank-recon/atg')}
          style={{ width: '100%', height: 48, marginTop: 14, background: 'var(--brand)', color: '#fff',
                   border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer',
                   display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {tc('recon.start', 'Start a new recon')}
          <ArrowRight size={17} />
        </button>

      </div>
    </AppShell>
  );
}
