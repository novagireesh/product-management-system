import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q } from '../db/index.js';
import {
  createSession, destroySession, hashPassword, requireAuth, rolePermissions, validatePassword, verifyPassword,
} from '../lib/auth.js';
import { HttpError, ah, badRequest, str } from '../lib/http.js';
import { publicBranding, setSettings } from '../lib/settings.js';
import { record } from '../services/history.js';

const router = Router();

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

export function userPayload(req) {
  if (!req.user) return null;
  return {
    id: req.user.id,
    username: req.user.username,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role_name,
    permissions: [...req.perms],
  };
}

router.get('/status', (req, res) => {
  const setupRequired = Number(q.value('SELECT COUNT(*) FROM users')) === 0;
  res.json({ setupRequired, user: userPayload(req), branding: publicBranding() });
});

// First-run: create the initial administrator. Only possible while no users exist.
router.post('/setup', loginLimiter, ah(async (req, res) => {
  if (Number(q.value('SELECT COUNT(*) FROM users')) > 0) throw new HttpError(409, 'Setup has already been completed');
  const name = str(req.body.name, 'Name', { required: true, max: 100 });
  const username = str(req.body.username, 'Username', { required: true, max: 50, min: 3 });
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw badRequest('Username may contain letters, numbers, dot, dash and underscore');
  validatePassword(req.body.password);
  const company = str(req.body.company_name, 'Company name', { max: 120 });
  const adminRole = q.get('SELECT id FROM roles WHERE is_system = 1 ORDER BY id LIMIT 1');
  const hash = await hashPassword(req.body.password);
  const { lastInsertRowid } = q.run(
    'INSERT INTO users(username, name, email, password_hash, role_id) VALUES (?,?,?,?,?)',
    username, name, str(req.body.email, 'Email', { max: 200 }), hash, adminRole.id,
  );
  if (company) setSettings({ company_name: company });
  createSession(res, req, Number(lastInsertRowid));
  record({ user: { id: Number(lastInsertRowid), name }, entity: 'user', entityId: Number(lastInsertRowid), action: 'setup', summary: `Initial administrator ${username} created` });
  res.status(201).json({ ok: true });
}));

router.post('/login', loginLimiter, ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const user = q.get('SELECT id, password_hash, active, name FROM users WHERE username = ?', username);
  const ok = await verifyPassword(req.body.password, user?.password_hash);
  if (!user || !ok) throw new HttpError(401, 'Incorrect username or password');
  if (!user.active) throw new HttpError(403, 'This account has been deactivated');
  createSession(res, req, user.id);
  const role = q.get('SELECT u.role_id, r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', user.id);
  res.json({ ok: true, permissions: [...rolePermissions(role.role_id)] });
}));

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json(userPayload(req)));

router.post('/password', requireAuth, loginLimiter, ah(async (req, res) => {
  const row = q.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!(await verifyPassword(req.body.current_password, row.password_hash))) throw badRequest('Current password is incorrect');
  validatePassword(req.body.new_password);
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(req.body.new_password), req.user.id);
  q.run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
  createSession(res, req, req.user.id);
  record({ user: req.user, entity: 'user', entityId: req.user.id, action: 'password_changed', summary: 'Password changed' });
  res.json({ ok: true });
}));

export default router;
