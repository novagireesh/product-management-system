import { Router } from 'express';
import { q, tx } from '../db/index.js';
import { hashPassword, invalidatePermissions, requirePerm, validatePassword } from '../lib/auth.js';
import { ah, badRequest, int, notFound, str } from '../lib/http.js';
import { record } from '../services/history.js';

const router = Router();
router.use(requirePerm('users.manage'));

const listUsers = () =>
  q.all(
    `SELECT u.id, u.username, u.name, u.email, u.role_id, r.name AS role_name, u.active, u.created_at, u.last_login_at
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name COLLATE NOCASE`,
  ).map((u) => ({ ...u, active: Boolean(u.active) }));

function rolesWithPerms() {
  return q.all(
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.is_system DESC, r.name`,
  ).map((r) => ({
    ...r,
    is_system: Boolean(r.is_system),
    permissions: r.is_system
      ? q.all('SELECT key FROM permissions').map((p) => p.key)
      : q.all('SELECT permission_key FROM role_permissions WHERE role_id = ?', r.id).map((p) => p.permission_key),
  }));
}

const adminCount = () =>
  Number(q.value('SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_system = 1 AND u.active = 1'));

router.get('/', (req, res) => {
  res.json({
    users: listUsers(),
    roles: rolesWithPerms(),
    permissions: q.all('SELECT * FROM permissions ORDER BY sort_order'),
  });
});

router.post('/', ah(async (req, res) => {
  const username = str(req.body.username, 'Username', { required: true, min: 3, max: 50 });
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw badRequest('Username may contain letters, numbers, dot, dash and underscore');
  if (q.get('SELECT 1 FROM users WHERE username = ?', username)) throw badRequest('That username is already taken');
  const roleId = int(req.body.role_id, 'Role', { required: true });
  if (!q.get('SELECT 1 FROM roles WHERE id = ?', roleId)) throw badRequest('Unknown role');
  validatePassword(req.body.password);
  const name = str(req.body.name, 'Name', { required: true, max: 100 });
  const { lastInsertRowid } = q.run(
    'INSERT INTO users(username, name, email, password_hash, role_id) VALUES (?,?,?,?,?)',
    username, name, str(req.body.email, 'Email', { max: 200 }), await hashPassword(req.body.password), roleId,
  );
  record({ user: req.user, entity: 'user', entityId: Number(lastInsertRowid), action: 'user_created', summary: `User ${username} created` });
  res.status(201).json(listUsers());
}));

router.put('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const user = q.get('SELECT u.*, r.is_system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', id);
  if (!user) throw notFound('User not found');
  const roleId = int(req.body.role_id, 'Role', { required: true });
  const role = q.get('SELECT is_system FROM roles WHERE id = ?', roleId);
  if (!role) throw badRequest('Unknown role');
  const active = req.body.active !== false;
  if (user.is_system && user.active && (!role.is_system || !active) && adminCount() <= 1) {
    throw badRequest('At least one active administrator is required');
  }
  if (id === req.user.id && !active) throw badRequest('You cannot deactivate your own account');
  tx(() => {
    q.run(
      'UPDATE users SET name = ?, email = ?, role_id = ?, active = ? WHERE id = ?',
      str(req.body.name, 'Name', { required: true, max: 100 }), str(req.body.email, 'Email', { max: 200 }), roleId, active, id,
    );
    if (!active) q.run('DELETE FROM sessions WHERE user_id = ?', id);
  });
  if (req.body.password) {
    validatePassword(req.body.password);
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(req.body.password), id);
    if (id !== req.user.id) q.run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  record({ user: req.user, entity: 'user', entityId: id, action: 'user_updated', summary: `User ${user.username} updated${req.body.password ? ' (password reset)' : ''}` });
  res.json(listUsers());
}));

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = q.get('SELECT u.*, r.is_system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', id);
  if (!user) throw notFound('User not found');
  if (id === req.user.id) throw badRequest('You cannot delete your own account');
  if (user.is_system && user.active && adminCount() <= 1) throw badRequest('At least one active administrator is required');
  q.run('DELETE FROM users WHERE id = ?', id);
  record({ user: req.user, entity: 'user', entityId: id, action: 'user_deleted', summary: `User ${user.username} deleted` });
  res.json(listUsers());
});

// --- roles ---------------------------------------------------------------------------
function savePerms(roleId, perms) {
  const valid = new Set(q.all('SELECT key FROM permissions').map((p) => p.key));
  q.run('DELETE FROM role_permissions WHERE role_id = ?', roleId);
  for (const p of new Set(perms || [])) if (valid.has(p)) q.run('INSERT INTO role_permissions VALUES (?, ?)', roleId, p);
}

router.post('/roles', (req, res) => {
  const name = str(req.body.name, 'Role name', { required: true, max: 60 });
  if (q.get('SELECT 1 FROM roles WHERE name = ?', name)) throw badRequest('A role with that name already exists');
  tx(() => {
    const { lastInsertRowid } = q.run('INSERT INTO roles(name, description) VALUES (?, ?)', name, str(req.body.description, 'Description', { max: 300 }));
    savePerms(Number(lastInsertRowid), req.body.permissions);
    record({ user: req.user, entity: 'role', entityId: Number(lastInsertRowid), action: 'role_created', summary: `Role ${name} created` });
  });
  invalidatePermissions();
  res.status(201).json(rolesWithPerms());
});

router.put('/roles/:id', (req, res) => {
  const id = Number(req.params.id);
  const role = q.get('SELECT * FROM roles WHERE id = ?', id);
  if (!role) throw notFound('Role not found');
  if (role.is_system) throw badRequest('The Admin role always has full access and cannot be changed');
  const name = str(req.body.name, 'Role name', { required: true, max: 60 });
  tx(() => {
    q.run('UPDATE roles SET name = ?, description = ? WHERE id = ?', name, str(req.body.description, 'Description', { max: 300 }), id);
    savePerms(id, req.body.permissions);
    record({ user: req.user, entity: 'role', entityId: id, action: 'role_updated', summary: `Role ${name} permissions updated` });
  });
  invalidatePermissions();
  res.json(rolesWithPerms());
});

router.delete('/roles/:id', (req, res) => {
  const id = Number(req.params.id);
  const role = q.get('SELECT * FROM roles WHERE id = ?', id);
  if (!role) throw notFound('Role not found');
  if (role.is_system) throw badRequest('The Admin role cannot be deleted');
  if (Number(q.value('SELECT COUNT(*) FROM users WHERE role_id = ?', id))) throw badRequest('Move the users in this role to another role first');
  q.run('DELETE FROM roles WHERE id = ?', id);
  invalidatePermissions();
  record({ user: req.user, entity: 'role', entityId: id, action: 'role_deleted', summary: `Role ${role.name} deleted` });
  res.json(rolesWithPerms());
});

export default router;
