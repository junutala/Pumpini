'use client';
// Financial statements — the P&L and the Balance Sheet, both derived from the journal.
// Owner/accountant. Reads only; the balance sheet tallies because every entry is balanced
// and capital is the opening plug (set on the Opening Balances screen).
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Scale, CheckCircle2, AlertTriangle } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Statement({ title, rows, total, totalLabel, strong }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'grid', gap: 4 }}>
        {(rows || []).map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '2px 0' }}>
            <span style={{ color: 'var(--text-2)' }}>{r.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.amount)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--border)', marginTop: 6, paddingTop: 6, fontWeight: strong ? 800 : 700, fontSize: 14 }}>
        <span>{totalLabel}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</span>
      </div>
    </div>
  );
}

export default function BalanceSheetPage() {
  const { station } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;

  const [enabled, setEnabled] = useState(null);
  const [bs, setBs] = useState(null);
  const [pl, setPl] = useState(null);

  const load = useCallback(async () => {
    if (!sid) return;
    const [b, p] = await Promise.all([
      api.get(`/accounts/balance-sheet?station_id=${sid}`).catch(() => null),
      api.get(`/accounts/pnl?station_id=${sid}`).catch(() => null),
    ]);
    setBs(b && b.enabled ? b : null);
    setPl(p && p.enabled ? p : null);
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`).then(s => setEnabled(!!s?.accounts_enabled)).catch(() => setEnabled(false));
  }, [sid]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scale size={22} /> {tc('bs.title', 'Financial Statements')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{tc('bs.subtitle', 'Profit & loss and the balance sheet, built from your books.')}</div>
        </div>
      </div>

      {enabled === false && <div className="card" style={{ maxWidth: 560 }}>{tc('bs.off', 'The Accounts module is off for this outlet. Turn it on in Settings → Accounting.')}</div>}

      {enabled && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 620 }}>
          {/* P&L */}
          {pl && (
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>{tc('bs.pnl', 'Profit & Loss')}</div>
              <Statement title={tc('bs.income', 'Income')} rows={pl.income} total={pl.incomeTotal} totalLabel={tc('bs.totalIncome', 'Total income')} />
              <Statement title={tc('bs.expenses', 'Expenses')} rows={pl.expenses} total={pl.expenseTotal} totalLabel={tc('bs.totalExpenses', 'Total expenses')} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, padding: '10px 0 0', color: pl.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                <span>{tc('bs.netProfit', pl.netProfit >= 0 ? 'Net Profit' : 'Net Loss')}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(pl.netProfit)}</span>
              </div>
            </div>
          )}

          {/* Balance sheet */}
          {bs && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{tc('bs.balanceSheet', 'Balance Sheet')}</div>
                {bs.balanced
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#16a34a' }}><CheckCircle2 size={14} /> {tc('bs.tallies', 'Tallies')}</span>
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#dc2626' }}><AlertTriangle size={14} /> {tc('bs.notTally', 'Does not tally')}</span>}
              </div>
              <Statement title={tc('bs.assets', 'Assets')} rows={bs.assets} total={bs.assetsTotal} totalLabel={tc('bs.totalAssets', 'Total assets')} strong />
              <Statement title={tc('bs.liabilities', 'Liabilities')} rows={bs.liabilities} total={bs.liabTotal} totalLabel={tc('bs.totalLiab', 'Total liabilities')} />
              <Statement title={tc('bs.equity', 'Owner’s equity')} rows={bs.equity} total={bs.equityTotal} totalLabel={tc('bs.totalEquity', 'Total equity')} />
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--text-1)', marginTop: 4, paddingTop: 8, fontWeight: 800, fontSize: 15 }}>
                <span>{tc('bs.liabPlusEquity', 'Liabilities + Equity')}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(bs.liabPlusEquity)}</span>
              </div>
              {!bs.assets?.length && (
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 12 }}>
                  {tc('bs.setOpening', 'Tip: set your')} <Link href="/accounts/opening-balances" style={{ color: '#FF6B00' }}>{tc('bs.openingLink', 'opening balances')}</Link> {tc('bs.setOpening2', 'so the sheet reflects your real starting position (cash, bank, stock, capital).')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
