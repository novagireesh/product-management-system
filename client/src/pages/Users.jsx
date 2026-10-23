import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Save, ShieldCheck, Trash2, UserPlus, Users as UsersIcon } from 'lucide-react';
import { Alert, Badge, Button, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Switch, Tabs, useConfirm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, initials } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

function UserModal({ user, roles, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user.id;
  const [form, setForm] = useState({ name: user.name || '', username: user.username || '', email: user.email || '', role_id: user.role_id || roles.find((r) => r.name === 'Sales')?.id || roles[0]?.id, active: user.active !== false, password: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, role_id: Number(form.role_id) };
      if (!isNew && !body.password) delete body.password;
      const users = await api(isNew ? '/users' : `/users/${user.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast.success(isNew ? 'User created' : 'User saved');
      onSaved(users);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const role = roles.find((r) => r.id === Number(form.role_id));
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add user' : `Edit ${user.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save</Button></>}>
      <div className="stack">
        <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <div className="grid-2">
          <Field label="Username"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!isNew} autoComplete="off" /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </div>
        <Field label="Role" hint={role?.description}>
          <Select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label={isNew ? 'Password' : 'Reset password'} hint={isNew ? 'At least 8 characters. Share it with the user securely.' : 'Leave empty to keep the current password.'}>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        {!isNew && <Switch label="Account active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}
      </div>
    </Modal>
  );
}

function RolesMatrix({ roles, permissions, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState({});
  const [newRole, setNewRole] = useState(null);
  useEffect(() => setDraft(Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)]))), [roles]);
  const groups = permissions.reduce((m, p) => m.set(p.group_name, [...(m.get(p.group_name) || []), p]), new Map());
  const editable = roles.filter((r) => !r.is_system);
  const changed = (r) => {
    const a = draft[r.id];
    return a && (a.size !== r.permissions.length || r.permissions.some((p) => !a.has(p)));
  };
  const toggle = (roleId, key) => {
    const s = new Set(draft[roleId]);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    setDraft({ ...draft, [roleId]: s });
  };
  const save = async (r) => {
    try {
      onSaved(await api(`/users/roles/${r.id}`, { method: 'PUT', body: { name: r.name, description: r.description, permissions: [...draft[r.id]] } }));
      toast.success(`${r.name} permissions saved`);
    } catch (err) {
      toast.error(err);
    }
  };
  const remove = async (r) => {
    if (!(await confirm({ title: `Delete role ${r.name}?`, danger: true, confirmLabel: 'Delete' }))) return;
    try {
      onSaved(await api(`/users/roles/${r.id}`, { method: 'DELETE' }));
    } catch (err) {
      toast.error(err);
    }
  };
  const create = async () => {
    try {
      onSaved(await api('/users/roles', { method: 'POST', body: { ...newRole, permissions: ['dashboard.view', 'products.view'] } }));
      setNewRole(null);
      toast.success('Role created — now choose its permissions');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <div className="toolbar"><span className="muted small grow">Tick what each role may do. Changes apply the next time a user loads a page.</span><Button icon={Plus} onClick={() => setNewRole({ name: '', description: '' })}>New role</Button></div>
      <div className="table-wrap">
        <table className="table table-compact perm-matrix">
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>Permission</th>
              {roles.map((r) => (
                <th key={r.id} style={{ minWidth: 110 }}>
                  <div>{r.name}</div>
                  <div className="tiny muted" style={{ fontWeight: 400 }}>{r.user_count} user{r.user_count === 1 ? '' : 's'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([g, list]) => (
              <Fragment key={g}>
                <tr><td colSpan={roles.length + 1} style={{ background: 'var(--surface-2)', fontWeight: 650, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)' }}>{g}</td></tr>
                {list.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}{p.key.startsWith('costing') && <Badge tone="amber">protected</Badge>}</td>
                    {roles.map((r) => (
                      <td key={r.id}>
                        <input type="checkbox" checked={r.is_system || Boolean(draft[r.id]?.has(p.key))} disabled={r.is_system} onChange={() => toggle(r.id, p.key)} aria-label={`${r.name}: ${p.label}`} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr>
              <td />
              {roles.map((r) => (
                <td key={r.id}>
                  {r.is_system ? <span className="tiny muted">Always full access</span> : (
                    <div className="row" style={{ justifyContent: 'center', gap: 2 }}>
                      <Button size="sm" variant={changed(r) ? 'primary' : undefined} icon={Save} disabled={!changed(r)} onClick={() => save(r)} aria-label={`Save ${r.name}`} />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(r)} disabled={r.user_count > 0} title={r.user_count ? 'Role has users' : 'Delete role'} aria-label={`Delete ${r.name}`} />
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {editable.length === 0 && <div className="card-body"><Alert>Create a role to customise permissions.</Alert></div>}
      <Modal open={Boolean(newRole)} onClose={() => setNewRole(null)} title="New role" footer={<><Button onClick={() => setNewRole(null)}>Cancel</Button><Button variant="primary" onClick={create} disabled={!newRole?.name?.trim()}>Create role</Button></>}>
        {newRole && (
          <div className="stack">
            <Field label="Role name"><Input value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} placeholder="e.g. Quality Control" autoFocus /></Field>
            <Field label="Description"><Input value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function Users() {
  useTitle('Users & permissions');
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'users';
  const { data, error, loading, reload, setData } = useApi('/users');
  const [editing, setEditing] = useState(null);

  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !data) return <Loading />;

  const remove = async (u) => {
    if (!(await confirm({ title: `Delete ${u.name}?`, message: 'Their history entries are kept. Consider deactivating instead.', danger: true, confirmLabel: 'Delete user' }))) return;
    try {
      setData({ ...data, users: await api(`/users/${u.id}`, { method: 'DELETE' }) });
      toast.success('User deleted');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Users & permissions" subtitle="Role-based access: who can see products, costing, catalogues and settings." actions={tab === 'users' && <Button variant="primary" icon={UserPlus} onClick={() => setEditing({})}>Add user</Button>} />
      <div className="card">
        <Tabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} tabs={[{ value: 'users', label: 'Users', icon: UsersIcon, count: data.users.length }, { value: 'roles', label: 'Roles & permissions', icon: ShieldCheck, count: data.roles.length }]} />
        {tab === 'users' ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>User</th><th>Role</th><th className="hide-sm">Email</th><th className="hide-sm">Last sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td><div className="row"><span className="avatar">{initials(u.name)}</span><div><div style={{ fontWeight: 600 }}>{u.name}{u.id === me.id && <span className="tiny muted"> (you)</span>}</div><div className="tiny muted">@{u.username}</div></div></div></td>
                    <td><Badge tone={u.role_name === 'Admin' ? 'blue' : undefined}>{u.role_name}</Badge></td>
                    <td className="hide-sm small">{u.email || '—'}</td>
                    <td className="hide-sm small">{u.last_login_at ? fmtDate(u.last_login_at, true) : 'Never'}</td>
                    <td>{u.active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="red" dot>Inactive</Badge>}</td>
                    <td className="actions">
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(u)} aria-label="Edit user" />
                      {u.id !== me.id && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(u)} aria-label="Delete user" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <RolesMatrix roles={data.roles} permissions={data.permissions} onSaved={(roles) => setData({ ...data, roles })} />
        )}
      </div>
      {editing && <UserModal user={editing} roles={data.roles} onClose={() => setEditing(null)} onSaved={(users) => { setData({ ...data, users }); setEditing(null); reload(); }} />}
    </div>
  );
}
