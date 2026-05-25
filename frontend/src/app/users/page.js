'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, UserCheck, UserX } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getUsers, updateUser } from '../../lib/api';
import api from '../../lib/api';
import { useAuth } from '../../lib/auth';

const ROLE_COLORS = { owner: 'badge-danger', manager: 'badge-warning', attendant: 'badge-info', rsa: 'badge-gray', corporate: 'badge-success' };

export default function UsersPage() {
  const { t } = useTranslation();
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

  const handleAdd = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post('/auth/register', form);
      if (stationId) await api.post(`/stations/${stationId}/users`, { user_id: '__last__' }); // will use proper id via response
      setShowAdd(false); load();
    } catch (err) { alert(err.error || 'Failed to add user'); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const newUser = await api.post('/auth/register', form);
      if (stationId) await api.post(`/stations/${stationId}/users`, { user_id: newUser.id });
      setShowAdd(false); load();
    } catch (err) { alert(err.error || err.errors?.[0]?.msg || 'Failed'); }
    finally { setLoading(false); }
  };

  const handleEdit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const { id, ...rest } = editUser;
      await updateUser(id, rest);
      setEditUser(null); load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const toggleActive = async (u) => {
    await updateUser(u.id, { is_active: !u.is_active }); load();
  };

  const filtered = users.filter(u =>
    !filter || u.name.toLowerCase().includes(filter.toLowerCase()) || u.phone.includes(filter)
  );

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">{t('nav.users')}</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} />Add User</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: '1.5rem' }}>
        <input className="input" placeholder="Search by name or phone..." style={{ maxWidth: 260 }}
          value={filter} onChange={e => setFilter(e.target.value)} />
        <select className="input" style={{ width: 160 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          {['owner','manager','attendant','rsa','corporate'].map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="dms-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Role</th>
                <th>Language</th>
                <th>Status</th>
                <th>Actions</th>
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
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditUser({ ...u })}>Edit</button>
                      <button className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-secondary'}`} onClick={() => toggleActive(u)}>
                        {u.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
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
              <span style={{ fontWeight: 600 }}>Add New User</span>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleRegister}>
              {[['name','Full Name',true,'text'],['phone','Phone (+91...)',true,'tel'],['email','Email',false,'email'],['password','Password',true,'password']].map(([f,l,r,type]) => (
                <div key={f} style={{ marginBottom: '0.75rem' }}>
                  <label className="label">{l}</label>
                  <input className="input" type={type} placeholder={l} required={r}
                    onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1.25rem' }}>
                <div>
                  <label className="label">Role</label>
                  <select className="input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                    {['owner','manager','attendant','rsa','corporate'].map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Language</label>
                  <select className="input" value={form.language} onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                    {[['en','English'],['hi','हिन्दी'],['ta','தமிழ்'],['te','తెలుగు'],['kn','ಕನ್ನಡ'],['mr','मराठी']].map(([c,n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Creating...' : 'Create User & Assign to Station'}
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
              <span style={{ fontWeight: 600 }}>Edit User</span>
              <button onClick={() => setEditUser(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleEdit}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Name</label>
                <input className="input" value={editUser.name || ''} onChange={e => setEditUser(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="label">Email</label>
                <input className="input" type="email" value={editUser.email || ''} onChange={e => setEditUser(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '0.75rem' }}>
                <div>
                  <label className="label">Role</label>
                  <select className="input" value={editUser.role} onChange={e => setEditUser(p => ({ ...p, role: e.target.value }))}>
                    {['owner','manager','attendant','rsa','corporate'].map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Language</label>
                  <select className="input" value={editUser.language || 'en'} onChange={e => setEditUser(p => ({ ...p, language: e.target.value }))}>
                    {[['en','English'],['hi','हिन्दी'],['ta','தமிழ்'],['te','తెలుగు'],['kn','ಕನ್ನಡ'],['mr','मराठी']].map(([c,n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="label">New Password (leave blank to keep)</label>
                <input className="input" type="password" placeholder="••••••••" onChange={e => setEditUser(p => ({ ...p, password: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
