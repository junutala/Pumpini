'use client';
// Opening Balances — the one-time anchor for the balance sheet. The owner enters the
// outlet's position at a books-start date; fixed assets come from the list below (only
// outlet-owned count). Capital is the balancing figure, so the sheet always tallies.
import { useState, useEffect, useCallback } from 'react';
import { Sliders, Trash2, CheckCircle } from 'lucide-react';
import AppShell from '../../../components/shared/AppShell';
import api from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useTranslation } from 'react-i18next';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const ASSET_FIELDS = [
  ['cash', 'Cash in hand'], ['bank', 'Bank balance'], ['stock_fuel', 'Fuel stock (value)'],
  ['stock_lube', 'Lube stock (value)'], ['receivables', 'Customers owe you (receivables)'],
];
const LIAB_FIELDS = [
  ['creditors', 'You owe suppliers / oil co. (payables)'], ['cng_payable', 'CNG owed to IOCL'],
  ['loans', 'Loans / owner loan'],
];

export default function OpeningBalancesPage() {
  const { station, user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const sid = typeof station === 'object' ? station?.id : station;
  const isOwner = user?.role === 'owner';

  const [enabled, setEnabled] = useState(null);
  const [form, setForm] = useState({ books_start_date: todayISO(), land_ownership: 'owned' });
  const [assetsList, setAssetsList] = useState([]);
  const [fixedNet, setFixedNet] = useState(0);
  const [newAsset, setNewAsset] = useState({ name: '', owned_by: 'outlet', cost: '', accum_depreciation: '', depreciation_rate: '', purchase_date: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const num = (k) => Number(form[k] || 0);
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    if (!sid) return;
    const [ob, fa] = await Promise.all([
      api.get(`/accounts/opening-balances?station_id=${sid}`).catch(() => null),
      api.get(`/accounts/fixed-assets?station_id=${sid}`).catch(() => null),
    ]);
    if (ob?.opening) setForm(f => ({ ...f, ...ob.opening, books_start_date: ob.opening.books_start_date?.slice(0, 10) || f.books_start_date }));
    setFixedNet(ob?.fixed_assets_net || 0);
    setAssetsList(fa?.assets || []);
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    api.get(`/stations/${sid}/settings`).then(s => setEnabled(!!s?.accounts_enabled)).catch(() => setEnabled(false));
  }, [sid]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const assetsTotal = ASSET_FIELDS.reduce((s, [k]) => s + num(k), 0) + Number(fixedNet || 0);
  const liabTotal = LIAB_FIELDS.reduce((s, [k]) => s + num(k), 0);
  const capital = assetsTotal - liabTotal;

  const addAsset = async () => {
    if (!newAsset.name || !(Number(newAsset.cost) > 0)) return showToast(tc('ob.assetNeed', 'Name and cost are required.'));
    try {
      await api.post('/accounts/fixed-assets', { station_id: sid, ...newAsset });
      setNewAsset({ name: '', owned_by: 'outlet', cost: '', accum_depreciation: '', depreciation_rate: '', purchase_date: '' });
      await load();
    } catch (e) { showToast(e.response?.data?.error || tc('ob.failed', 'Could not save.')); }
  };
  const delAsset = async (id) => {
    try { await api.delete(`/accounts/fixed-assets/${id}?station_id=${sid}`); await load(); }
    catch (e) { showToast(tc('ob.failed', 'Could not delete.')); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/accounts/opening-balances', { station_id: sid, ...form });
      showToast(tc('ob.saved', 'Opening balances saved.'));
      await load();
    } catch (e) { showToast(e.response?.data?.error || tc('ob.failed', 'Could not save.')); }
    setSaving(false);
  };

  const NumField = ([k, label]) => (
    <div key={k}>
      <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{tc('ob.' + k, label)}</label>
      <input className="input" type="number" inputMode="decimal" value={form[k] ?? ''} onChange={e => set(k, e.target.value)} disabled={!isOwner} />
    </div>
  );

  return (
    <AppShell>
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#16a34a', color: '#fff', padding: '10px 18px', borderRadius: 10, zIndex: 400, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={16} />{toast}
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={22} /> {tc('ob.title', 'Opening Balances')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {tc('ob.subtitle', 'Your outlet’s position at a go-live date — the anchor for the balance sheet. Pumpini counts only transactions AFTER this date, so enter today’s figures and start clean.')}
          </div>
        </div>
      </div>

      {enabled === false && <div className="card" style={{ maxWidth: 560 }}>{tc('ob.off', 'The Accounts module is off for this outlet. Turn it on in Settings → Accounting.')}</div>}
      {!isOwner && enabled && <div className="card" style={{ maxWidth: 560 }}>{tc('ob.ownerOnly', 'Only the outlet owner can set opening balances.')}</div>}

      {enabled && isOwner && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{tc('ob.startDate', 'Go-live date (position as of this day’s close)')}</label>
                <input className="input" type="date" value={form.books_start_date || ''} onChange={e => set('books_start_date', e.target.value)} />
              </div>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)' }}>{tc('ob.land', 'Land')}</label>
                <select className="input" value={form.land_ownership || 'owned'} onChange={e => set('land_ownership', e.target.value)}>
                  <option value="owned">{tc('ob.landOwned', 'Owned by outlet (OMC rent = income)')}</option>
                  <option value="leased">{tc('ob.landLeased', 'Leased (rent passes through)')}</option>
                </select>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>{tc('ob.whatYouHave', 'What you have (assets)')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{ASSET_FIELDS.map(NumField)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 8 }}>{tc('ob.fixedNote', 'Fixed assets (from the list below, outlet-owned):')} <b>{fmt(fixedNet)}</b></div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>{tc('ob.whatYouOwe', 'What you owe (liabilities)')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{LIAB_FIELDS.map(NumField)}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--surface-2,#f7f6f3)', borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('ob.capital', 'Owner’s capital (auto = what you have − what you owe)')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tc('ob.assetsMinusLiab', 'Assets {a} − Liabilities {l}').replace('{a}', fmt(assetsTotal)).replace('{l}', fmt(liabTotal))}</div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{fmt(capital)}</div>
            </div>

            <button onClick={save} disabled={saving} style={{ background: '#FF6B00', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 20px', borderRadius: 9, border: 'none', cursor: saving ? 'wait' : 'pointer', justifySelf: 'start' }}>
              {saving ? tc('ob.saving', 'Saving…') : tc('ob.save', 'Save opening balances')}
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -4 }}>
              {tc('ob.afterSave', 'After saving, open Accounts → “Re-post from scratch” so only after-go-live activity is counted (no double-counting the history).')}
            </div>
          </div>

          {/* Fixed assets */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{tc('ob.fixedAssets', 'Fixed assets')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>{tc('ob.fixedHelp', 'Equipment/property the outlet owns. Mark items the oil company owns as “OMC” — those don’t count as yours.')}</div>
            {assetsList.length > 0 && (
              <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                {assetsList.map(a => (
                  <div key={a.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span>{a.name} <span style={{ fontSize: 11, color: a.owned_by === 'omc' ? '#dc2626' : 'var(--text-3)' }}>· {a.owned_by === 'omc' ? tc('ob.omc', 'OMC-owned') : tc('ob.outlet', 'outlet')}</span></span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(a.cost) - Number(a.accum_depreciation || 0))}</span>
                      <button onClick={() => delAsset(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><Trash2 size={15} /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
              <div><label className="label" style={{ fontSize: 11, color: 'var(--text-3)' }}>{tc('ob.assetName', 'Name')}</label><input className="input" value={newAsset.name} onChange={e => setNewAsset(a => ({ ...a, name: e.target.value }))} /></div>
              <div><label className="label" style={{ fontSize: 11, color: 'var(--text-3)' }}>{tc('ob.cost', 'Cost ₹')}</label><input className="input" type="number" value={newAsset.cost} onChange={e => setNewAsset(a => ({ ...a, cost: e.target.value }))} /></div>
              <div><label className="label" style={{ fontSize: 11, color: 'var(--text-3)' }}>{tc('ob.accum', 'Deprec. so far ₹')}</label><input className="input" type="number" value={newAsset.accum_depreciation} onChange={e => setNewAsset(a => ({ ...a, accum_depreciation: e.target.value }))} /></div>
              <div><label className="label" style={{ fontSize: 11, color: 'var(--text-3)' }}>{tc('ob.owner', 'Owner')}</label>
                <select className="input" value={newAsset.owned_by} onChange={e => setNewAsset(a => ({ ...a, owned_by: e.target.value }))}>
                  <option value="outlet">{tc('ob.outlet', 'Outlet')}</option>
                  <option value="omc">{tc('ob.omc', 'OMC')}</option>
                </select>
              </div>
            </div>
            <button onClick={addAsset} style={{ marginTop: 10, background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}>+ {tc('ob.addAsset', 'Add asset')}</button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
