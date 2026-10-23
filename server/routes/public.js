import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q, now } from '../db/index.js';
import { can, createSession, rolePermissions, verifyPassword } from '../lib/auth.js';
import { HttpError, ah, badRequest, notFound } from '../lib/http.js';
import { normaliseScanPage } from '../lib/scan-page.js';
import { getSetting, publicBranding } from '../lib/settings.js';
import { resolveScan } from '../services/codes.js';
import { computeCosting, costingContext, costingFields, getProductCosting, priceSources, storedCosting } from '../services/costing.js';
import { fieldDefs, formatFieldValue } from '../services/fields.js';
import { record } from '../services/history.js';
import { serialiseImage } from '../services/images.js';
import { saveCosting } from './products.js';

const router = Router();

const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
});
const visitorLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function findProduct(code) {
  const id = resolveScan(code);
  if (!id) throw notFound('Product not found');
  const p = q.get(
    `SELECT p.id, p.sku, p.name, p.description, p.status, c.name AS category, sc.name AS subcategory, pc.code
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories sc ON sc.id = p.subcategory_id
       LEFT JOIN product_codes pc ON pc.product_id = p.id WHERE p.id = ?`,
    id,
  );
  if (!p) throw notFound('Product not found');
  return p;
}

/** Visitor identified by the token their browser received after sharing details. */
function visitorFrom(req) {
  const token = req.get('x-visitor-token');
  if (!token || token.length > 100) return null;
  return q.get('SELECT id, name FROM visitors WHERE token_hash = ?', sha256(token)) || null;
}

/** Price for the scan page from the configured costing value (with fallback), or null. */
function scanPrice(productId, cfg) {
  if (!cfg.enabled) return null;
  const sources = new Map(priceSources().map((p) => [p.key, p]));
  const values = computeCosting(storedCosting(productId), costingFields(), costingContext(productId));
  for (const key of [cfg.source, cfg.fallback]) {
    const v = key && sources.has(key) ? values[key] : null;
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      const currency = sources.get(key).currency;
      const value = Math.round(v * 100) / 100;
      return { label: cfg.label, value, currency, text: `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
    }
  }
  return null;
}

/**
 * Public product page data. Only what is switched on in Settings › QR scan page is included
 * (product fields: their "scan page" flag); costing is never part of this response.
 */
router.get('/products/:code', (req, res) => {
  const p = findProduct(req.params.code);
  if (p.status !== 'active' && !can(req, 'products.view')) throw notFound('This product is not available');
  const cfg = normaliseScanPage(getSetting('scan_page'));
  const show = cfg.show;
  const specs = Object.fromEntries(
    q.all('SELECT field_key, value FROM product_specifications WHERE product_id = ?', p.id).map((r) => [r.field_key, r.value]),
  );
  const fields = fieldDefs()
    .filter((f) => f.is_public && specs[f.key])
    .map((f) => ({ key: f.key, label: f.label, group: f.group_name, type: f.type, value: formatFieldValue(f, specs[f.key]) }));
  const images = show.images
    ? q.all('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order, id', p.id).map(serialiseImage)
    : [];

  const visitor = req.user ? null : visitorFrom(req);
  q.run('INSERT INTO product_scans(product_id, visitor_id, user_id) VALUES (?,?,?)', p.id, visitor?.id, req.user?.id);
  if (visitor) {
    q.run('UPDATE visitors SET scan_count = scan_count + 1, last_product_id = ?, last_seen_at = ? WHERE id = ?', p.id, now(), visitor.id);
  }

  res.json({
    product: {
      sku: show.code ? p.sku : null,
      code: p.code,
      name: show.name ? p.name : null,
      description: show.description ? p.description : null,
      category: show.category ? p.category : null,
      subcategory: show.category ? p.subcategory : null,
      status: p.status,
      fields,
      images,
      price: scanPrice(p.id, cfg.price),
    },
    display: show,
    branding: publicBranding(),
    viewer: req.user
      ? { name: req.user.name, canViewCosting: can(req, 'costing.view'), canOpenDashboard: can(req, 'products.view'), productId: p.id }
      : null,
    visitor: visitor ? { name: visitor.name } : null,
    // Unknown, signed-out visitors are invited (optionally) to share their details.
    askDetails: !req.user && !visitor && getSetting('visitor_prompt') !== false,
  });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Optional details shared by a visitor after scanning. Returns a token the browser keeps. */
router.post('/visitors', visitorLimiter, (req, res) => {
  const clean = (v, max) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 200).toLowerCase();
  const phone = clean(req.body.phone, 40);
  if (!name && !email && !phone) throw badRequest('Enter at least one detail, or choose Skip');
  if (email && !EMAIL_RE.test(email)) throw badRequest('Please check the email address');
  if (phone && !/^[+()\-\s\d]{6,40}$/.test(phone)) throw badRequest('Please check the mobile number');
  let productId = null;
  try {
    productId = req.body.code ? findProduct(req.body.code).id : null;
  } catch { /* unknown product: still keep the details */ }
  const token = crypto.randomBytes(24).toString('base64url');
  const { lastInsertRowid } = q.run(
    `INSERT INTO visitors(name, email, phone, token_hash, first_product_id, last_product_id, scan_count, user_agent)
     VALUES (?,?,?,?,?,?,?,?)`,
    name || null, email || null, phone || null, sha256(token), productId, productId, productId ? 1 : 0,
    String(req.get('user-agent') || '').slice(0, 300),
  );
  // Link the scan that brought them here (logged a moment ago, before they were known).
  if (productId) {
    q.run(
      `UPDATE product_scans SET visitor_id = ? WHERE id = (
         SELECT id FROM product_scans WHERE product_id = ? AND visitor_id IS NULL AND user_id IS NULL ORDER BY id DESC LIMIT 1)`,
      lastInsertRowid, productId,
    );
  }
  res.status(201).json({ token, id: Number(lastInsertRowid) });
});

function costingResponse(req, p, who) {
  const signedIn = Boolean(req.user) && who?.id === req.user.id;
  return {
    ...getProductCosting(p.id),
    currency: getSetting('currency'),
    // Saving needs a signed-in account with permission; PIN access can explore but not save.
    product_id: signedIn && can(req, 'costing.edit') ? p.id : null,
    can_edit: signedIn && can(req, 'costing.edit'),
    can_edit_defaults: signedIn && can(req, 'costing.constraints'),
  };
}

/**
 * Unlock costing for a scanned product. Accepts, in order:
 *  - an existing signed-in session with costing.view
 *  - username + password of a user with costing.view (also signs them in)
 *  - the shared costing PIN (if enabled in Settings)
 */
router.post('/products/:code/costing', unlockLimiter, ah(async (req, res) => {
  const p = findProduct(req.params.code);
  if (!normaliseScanPage(getSetting('scan_page')).show.costing_button && !can(req, 'costing.view')) {
    throw new HttpError(403, 'Costing is not available from the scan page');
  }
  let who = null;
  if (can(req, 'costing.view')) who = req.user;
  else if (req.body.username) {
    const user = q.get('SELECT id, name, username, role_id, active, password_hash FROM users WHERE username = ?', String(req.body.username).trim());
    const ok = await verifyPassword(req.body.password, user?.password_hash);
    if (!user || !ok || !user.active) throw new HttpError(401, 'Incorrect username or password');
    const perms = rolePermissions(user.role_id);
    if (!perms.has('costing.view')) throw new HttpError(403, 'Your account is not authorised to view costing');
    createSession(res, req, user.id);
    who = user;
    // The new session cookie applies from the next request; treat this one as signed in.
    req.user = { ...user, role_name: null };
    req.perms = perms;
  } else if (req.body.pin) {
    const hash = getSetting('costing_pin_hash');
    if (!hash) throw new HttpError(400, 'PIN access is not enabled. Please sign in instead.');
    if (!(await verifyPassword(String(req.body.pin), hash))) throw new HttpError(401, 'Incorrect PIN');
    who = { id: null, name: 'PIN access' };
  } else {
    throw new HttpError(401, 'Authorisation required');
  }
  record({ user: who, productId: p.id, entity: 'costing', action: 'costing_viewed', summary: `Costing viewed from scan page (${who.id ? 'signed in' : 'PIN'})` });
  res.setHeader('Cache-Control', 'no-store');
  res.json(costingResponse(req, p, who));
}));

/** Save costing changes made on the scan page (signed-in users with permission only). */
router.put('/products/:code/costing', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to save costing');
  const p = findProduct(req.params.code);
  saveCosting(req, p.id, 'scan page');
  res.json(costingResponse(req, p, req.user));
});

router.get('/branding', (req, res) => res.json(publicBranding()));

export default router;
