import multer from 'multer';
import { log } from './logger.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Errors from Express internals / static middleware (http-errors) carry their own status.
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.expose ? err.message : 'Request could not be completed' });
  }
  if (/UNIQUE constraint failed/.test(err?.message || '')) {
    return res.status(409).json({ error: 'A record with the same unique value already exists' });
  }
  log.error(err?.message || 'Unhandled error', { stack: err?.stack, url: req.originalUrl, user: req.user?.username });
  res.status(500).json({ error: 'Something went wrong. The error has been logged.' });
}

// --- tiny validation helpers -------------------------------------------------

export function str(value, field, { required = false, max = 500, min = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const s = String(value).trim();
  if (required && !s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  if (s.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  return s || null;
}

export function int(value, field, { required = false, min, max } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} must be a whole number`);
  if (min !== undefined && n < min) throw badRequest(`${field} must be ≥ ${min}`);
  if (max !== undefined && n > max) throw badRequest(`${field} must be ≤ ${max}`);
  return n;
}

export function oneOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function idList(value, max = 5000) {
  const arr = Array.isArray(value) ? value : String(value || '').split(',');
  const ids = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length > max) throw badRequest(`Too many items (max ${max})`);
  return ids;
}

export function slugKey(label) {
  return String(label)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'field';
}

export const pageParams = (query, { defaultSize = 24, maxSize = 200 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
};
