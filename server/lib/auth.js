import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { q, now } from '../db/index.js';
import { HttpError, forbidden } from './http.js';

export const SESSION_COOKIE = 'pm_session';

export const hashPassword = (pw) => bcrypt.hash(pw, 11);
let dummyHash = null;
/** Constant-ish time check; compares against a dummy hash when the user does not exist. */
export async function verifyPassword(pw, hash) {
  dummyHash ??= bcrypt.hashSync('not-a-real-password', 11);
  try {
    return (await bcrypt.compare(String(pw || ''), hash || dummyHash)) && Boolean(hash);
  } catch {
    return false;
  }
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
}

const permCache = new Map();
export function invalidatePermissions() {
  permCache.clear();
}

export function rolePermissions(roleId) {
  if (!permCache.has(roleId)) {
    const role = q.get('SELECT is_system FROM roles WHERE id = ?', roleId);
    const perms = role?.is_system
      ? q.all('SELECT key FROM permissions').map((r) => r.key)
      : q.all('SELECT permission_key AS key FROM role_permissions WHERE role_id = ?', roleId).map((r) => r.key);
    permCache.set(roleId, new Set(perms));
  }
  return permCache.get(roleId);
}

export function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  q.run(
    'INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)',
    sha256(token), userId, expires.toISOString(), req.ip, String(req.get('user-agent') || '').slice(0, 300),
  );
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Attach req.user / req.perms when a valid session cookie is present. */
export function loadSession(req, _res, next) {
  req.perms = new Set();
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const row = q.get(
    `SELECT u.id, u.username, u.name, u.email, u.role_id, u.active, r.name AS role_name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row || !row.active || row.expires_at < now()) return next();
  req.user = row;
  req.perms = rolePermissions(row.role_id);
  next();
}

export const can = (req, perm) => Boolean(req.user && req.perms.has(perm));

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

/** Require at least one of the given permissions. */
export const requirePerm = (...perms) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if (!perms.some((p) => req.perms.has(p))) return next(forbidden());
  next();
};

/**
 * Cheap CSRF defence in addition to SameSite cookies: state-changing API calls must carry
 * a custom header, which cross-site forms cannot set without a CORS preflight.
 */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-pm-client') !== '1') return res.status(403).json({ error: 'Missing client header' });
  next();
}

export function purgeExpiredSessions() {
  q.run('DELETE FROM sessions WHERE expires_at < ?', now());
}
