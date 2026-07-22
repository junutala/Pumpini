'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, UserCheck, UserX, LogOut } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getUsers, updateUser } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const ROLE_COLORS = { owner: 'badge-danger', manager: 'badge-warning', attendant: 'badge-info', rsa: 'badge-gray', corporate: 'badge-success' };

export default function UsersPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const { user, station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [users, setUsers]     = useState([]);
  const [filter, setFilter]   = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm]       = useState({ role: 'attendant', language: 'en' });
  const [loading, setLoading] = useState(false);

  const load = () => {
    const params = { station_id: stationId };
    if (roleFilter) params.role = roleFilter;
    getUsers(params).then(setUsers);
  };

  useEffect(() => { if (stationId) load(); }, [stationId, roleFilter]);
  useRefreshOnFocus(load);

  // Single-writer create: POST /users creates the user AND links the station in one
  // guarded call (owner-only, role validated server-side). Replaces the old
  // /auth/register (public hole) + separate station-link two-step.
  const handleRegister = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/users', { ...form, station_id: stationId });
      setShowAdd(false); load();
    } catch (err) { alert(err.error || err.errors?.[0]?.msg || tc('usersp.failed', 'Failed')); }
    finally { setLoading(false); }
  };

  const handleEdit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const { id, ...rest } = editUser;
      await updateUser(id, rest);
      setEditUser(null); load();
    } catch (err) { alert(err.error || tc('usersp.failed', 'Failed')); }
    finally { setLoading(false); }
  };

  const toggleActive = async (u) => {
    await updateUser(u.id, { is_active: !u.is_active }); load();
  };

  const forceLogout = async (u) => {
    if (!confirm(tc('usersp.forceLogoutConfirm', "Force-logout {name}? Their active sessions will end immediately and they'll need to log in again.").replace('{name}', u.name))) return;
    try {
      await api.post(`/users/${u.id}/force-logout`, {});
      alert(tc('usersp.forceLogoutDone', '{name} has been logged out of all sessions.').replace('{name}', u.name));
    } catch (err) { alert(err.error || tc('usersp.failedForceLogout', 'Failed to force-logout')); }
  };

  const filtered = users.filter(u =>
    !filter || u.name.toLowerCase().includes(filter.toLowerCase()) || u.phone.includes(filter)
  );

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('nav.users')}</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} />{tc('usersp.addUser', 'Add User')}</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: '1.5rem' }}>
        <input className="input" placeholder={tc('usersp.searchPlaceholder', 'Search by name or phone...')} style={{ maxWidth: 260 }}
          value={filter} onChange={e => setFilter(e.target.value)} />
        <select className="input" style={{ width: 160 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">{tc('usersp.allRoles', 'All Roles')}</option>
          {['owner','manager','attendant','rsa','corporate'].map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>{tc('usersp.colName', 'Name')}</th>
                <th>{tc('usersp.colPhone', 'Phone')}</th>
                <th>{tc('usersp.colEmail', 'Email')}</th>
                <th>{tc('usersp.colRole', 'Role')}</th>
                <th>{tc('usersp.colLanguage', 'Language')}</th>
                <th>{tc('usersp.colStatus', 'Status')}</th>
                <th>{tc('usersp.colActions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>{t('no_data')}</td></tr>
              )}
              {filtered.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td className="num" style={{ fontSize: 13 }}>{u.phone}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{u.email || '—'}</td>
                  <td><span className={`badge ${ROLE_COLORS[u.role] || 'badge-gray'}`}>{t(`roles.${u.role}`)}</span></td>
                  <td style={{ fontSize: 13 }}>{u.language?.toUpperCase()}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-success' : 'badge-danger'}`}>
                      {u.is_active ? tc('usersp.statusActive', 'Active') : tc('usersp.statusInactive', 'Inactive')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditUser({ ...u })}>{tc('usersp.edit', 'Edit')}</button>
                      <button className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-secondary'}`} onClick={() => toggleActive(u)}>
                        {u.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
                      </button>
                      <button className="btn btn-secondary btn-sm" title={tc('usersp.forceLogoutTitle', 'Force logout (end all sessions)')} onClick={() => forceLogout(u)}>
                        <LogOut size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add user */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>{tc('usersp.addNewUser', 'Add New User')}</span>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleRegister}>
              {[['name',tc('usersp.fullName','Full Name'),true,'text'],['phone',tc('usersp.phonePlus91','Phone (+91...)'),true,'tel'],['email',tc('usersp.email','Email'),false,'email'],['password',tc('usersp.password','Password'),true,'password']].map(([f,l,r,type]) => (
                <div key={f} style={{ marginBottom: '0.75rem' }}>
                  <label className="label">{l}</label>
                  <input className="input" type={type} placeholder={l} required={r}
                    onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1.25rem' }}>
                <div>
                  <label className="label">{tc('usersp.role', 'Role')}</label>
                  <select className="input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                    {['owner','manager','attendant','rsa','corporate'].map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{tc('usersp.language', 'Language')}</label>
                  <select className="input" value={form.language} onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                    {[['en','English'],['hi','हिन्दी'],['ta','தமிழ்'],['te','తెలుగు'],['kn','ಕನ್ನಡ'],['mr','मराठी']].map(([c,n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? tc('usersp.creating', 'Creating...') : tc('usersp.createAndAssign', 'Create User & Assign to Station')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit user */}
      {editUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 600 }}>{tc('usersp.editUser', 'Edit User')}</span>
              <button onClick={() => setEditUser(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleEdit}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">{tc('usersp.colName', 'Name')}</label>
                <input className="input" value={editUser.name || ''} onChange={e => setEditUser(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">{tc('usersp.email', 'Email')}</label>
                <input className="input" type="email" value={editUser.email || ''} onChange={e => setEditUser(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '0.75rem' }}>
                <div>
                  <label className="label">{tc('usersp.role', 'Role')}</label>
                  {/* Role is set at creation and NOT editable here — PATCH /users/:id
                      does not change role (avoids a silent no-op that looked editable). */}
                  <input className="input" value={t(`roles.${editUser.role}`)} disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                </div>
                <div>
                  <label className="label">{tc('usersp.language', 'Language')}</label>
                  <select className="input" value={editUser.language || 'en'} onChange={e => setEditUser(p => ({ ...p, language: e.target.value }))}>
                    {[['en','English'],['hi','हिन्दी'],['ta','தமிழ்'],['te','తెలుగు'],['kn','ಕನ್ನಡ'],['mr','मराठी']].map(([c,n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">{tc('usersp.newPassword', 'New Password (leave blank to keep)')}</label>
                <input className="input" type="password" placeholder="••••••••" onChange={e => setEditUser(p => ({ ...p, password: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? tc('usersp.saving', 'Saving...') : tc('usersp.saveChanges', 'Save Changes')}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
