import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { ZipArchive } from 'archiver';
import { config, lanAddress, paths } from '../config.js';
import { db, q, tx } from '../db/index.js';
import { hashPassword, requirePerm } from '../lib/auth.js';
import { ah, badRequest, notFound, slugKey, str } from '../lib/http.js';
import { readRecentLogs } from '../lib/logger.js';
import { LOADABILITY_ROUNDING, normaliseCalcRules } from '../../shared/product-fields.js';
import { SCAN_PAGE_ITEMS, normaliseScanPage } from '../lib/scan-page.js';
import { getSettings, publicBaseUrl, setSettings } from '../lib/settings.js';
import { calcRules } from '../services/calculations.js';
import { listCategories, resolveCategory } from '../services/categories.js';
import { BARCODE_TYPES } from '../services/codes.js';
import { costingFields, priceSources } from '../services/costing.js';
import { FIELD_TYPES, fieldDefs, invalidateFields, parseNumber } from '../services/fields.js';
import { record } from '../services/history.js';
import { recalculateAll, reindexAll } from '../services/products.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const EDITABLE = {
  company_name: { max: 120 },
  company_tagline: { max: 200 },
  company_address: { max: 500 },
  company_email: { max: 200 },
  company_phone: { max: 60 },
  company_whatsapp: { max: 60 },
  company_website: { max: 200 },
  brand_color: { pattern: /^#[0-9a-fA-F]{6}$/ },
  currency: { max: 10 },
  sku_prefix: { max: 20, allowEmpty: true },
  sku_next: { number: true },
  barcode_type: { oneOf: Object.keys(BARCODE_TYPES) },
  public_base_url: { max: 300, allowEmpty: true, url: true },
  catalogue_footer: { max: 300, allowEmpty: true },
  visitor_prompt: { boolean: true },
};

function settingsPayload() {
  const s = { ...getSettings() };
  const pinEnabled = Boolean(s.costing_pin_hash);
  delete s.costing_pin_hash;
  return {
    ...s,
    costing_pin_enabled: pinEnabled,
    logo_url: s.company_logo ? `/media/branding/${s.company_logo}` : null,
    effective_base_url: publicBaseUrl(),
    lan_addresses: lanAddress().map((ip) => `http://${ip}:${config.port}`),
    barcode_types: BARCODE_TYPES,
    calc_rules: normaliseCalcRules(s.calc_rules),
    scan_page: normaliseScanPage(s.scan_page),
    scan_items: SCAN_PAGE_ITEMS,
    price_sources: priceSources(),
    // Costing keeps its own container capacity (used to share P&F and freight across a container).
    costing_container_cbm: costingFields().find((f) => f.key === 'container_cbm')?.default_value ?? null,
  };
}

router.get('/', requirePerm('settings.manage'), (req, res) => res.json(settingsPayload()));

router.put('/', requirePerm('settings.manage'), (req, res) => {
  const updates = {};
  for (const [key, rule] of Object.entries(EDITABLE)) {
    if (!(key in req.body)) continue;
    let v = req.body[key];
    if (rule.boolean) {
      v = v === true || v === 'true' || v === 1;
    } else if (rule.number) {
      v = Number(v);
      if (!Number.isInteger(v) || v < 1) throw badRequest(`${key} must be a positive whole number`);
    } else {
      v = v === null || v === undefined ? '' : String(v).trim();
      if (!v && !rule.allowEmpty && !key.startsWith('company_')) throw badRequest(`${key} is required`);
      if (rule.max && v.length > rule.max) throw badRequest(`${key} is too long`);
      if (rule.pattern && v && !rule.pattern.test(v)) throw badRequest(`${key} has an invalid format`);
      if (rule.oneOf && !rule.oneOf.includes(v)) throw badRequest(`${key} is invalid`);
      if (rule.url && v && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(v)) throw badRequest('Public base URL must start with http:// or https://');
    }
    updates[key] = v;
  }
  if (updates.company_name === '') throw badRequest('Company name is required');
  setSettings(updates);
  record({ user: req.user, entity: 'settings', action: 'settings_updated', summary: `Settings updated: ${Object.keys(updates).join(', ')}` });
  res.json(settingsPayload());
});

router.post('/logo', requirePerm('settings.manage'), upload.single('logo'), ah(async (req, res) => {
  if (!req.file) throw badRequest('Choose a logo image');
  let png;
  try {
    png = await sharp(req.file.buffer).resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw badRequest('File is not a valid image');
  }
  const name = `logo-${crypto.randomBytes(6).toString('hex')}.png`;
  fs.writeFileSync(path.join(paths.branding, name), png);
  const old = getSettings().company_logo;
  setSettings({ company_logo: name });
  if (old) fs.rmSync(path.join(paths.branding, old), { force: true });
  record({ user: req.user, entity: 'settings', action: 'logo_updated', summary: 'Company logo updated' });
  res.json(settingsPayload());
}));

router.delete('/logo', requirePerm('settings.manage'), (req, res) => {
  const old = getSettings().company_logo;
  setSettings({ company_logo: null });
  if (old) fs.rmSync(path.join(paths.branding, old), { force: true });
  res.json(settingsPayload());
});

router.put('/costing-pin', requirePerm('settings.manage'), ah(async (req, res) => {
  const pin = req.body.pin;
  if (pin === null || pin === '') {
    setSettings({ costing_pin_hash: null });
    record({ user: req.user, entity: 'settings', action: 'costing_pin_disabled', summary: 'Costing PIN disabled' });
  } else {
    if (!/^\d{4,12}$/.test(String(pin))) throw badRequest('PIN must be 4 to 12 digits');
    setSettings({ costing_pin_hash: await hashPassword(String(pin)) });
    record({ user: req.user, entity: 'settings', action: 'costing_pin_set', summary: 'Costing PIN changed' });
  }
  res.json(settingsPayload());
}));

// --- system calculation rules (loadability, CBM) --------------------------------------
router.put('/rules', requirePerm('settings.manage'), (req, res) => {
  const before = calcRules();
  const l = req.body.loadability || {};
  const c = req.body.cbm || {};
  const per = l.units_per_cbm === undefined ? before.loadability.units_per_cbm : parseNumber(l.units_per_cbm);
  if (per === null || per <= 0 || per > 1e6) throw badRequest('Units per CBM must be a number greater than 0');
  const rounding = l.rounding ?? before.loadability.rounding;
  if (!LOADABILITY_ROUNDING.some((r) => r.value === rounding)) throw badRequest('Choose how loadability is rounded');
  const source = c.source ?? before.cbm.source;
  const sourceField = fieldDefs({ includeInactive: true }).find((f) => f.key === source);
  if (!sourceField || sourceField.calc || !['dimensions', 'text'].includes(sourceField.type)) {
    throw badRequest('CBM can only be calculated from a dimensions field, e.g. Packing Size');
  }
  const next = normaliseCalcRules({ loadability: { units_per_cbm: per, rounding }, cbm: { auto: c.auto ?? before.cbm.auto, source } });
  setSettings({ calc_rules: next });
  const recalculated = recalculateAll(next);
  const changes = [
    ['Loadability: units per CBM', before.loadability.units_per_cbm, next.loadability.units_per_cbm],
    ['Loadability rounding', before.loadability.rounding, next.loadability.rounding],
    ['CBM from packing size', before.cbm.auto ? 'on' : 'off', next.cbm.auto ? 'on' : 'off'],
    ['CBM calculated from', before.cbm.source, next.cbm.source],
  ].filter(([, a, b]) => String(a) !== String(b)).map(([label, from, to]) => ({ field: label, label, from: String(from), to: String(to) }));
  if (changes.length || recalculated) {
    record({ user: req.user, entity: 'settings', action: 'calc_rules_updated', summary: `Calculation rules updated; ${recalculated} product(s) recalculated`, changes });
  }
  res.json({ ...settingsPayload(), recalculated });
});

// --- QR scan page: what scanned product pages show -----------------------------------
router.put('/scan-page', requirePerm('settings.manage'), (req, res) => {
  const current = normaliseScanPage(getSettings().scan_page);
  const show = { ...current.show };
  for (const item of SCAN_PAGE_ITEMS) {
    const v = req.body.show?.[item.key];
    if (v !== undefined) show[item.key] = v === true;
  }
  const price = { ...current.price, ...(req.body.price || {}) };
  const sources = new Set(priceSources().map((p) => p.key));
  price.enabled = price.enabled === true;
  if (price.enabled && !sources.has(price.source)) throw badRequest('Choose which costing value is shown as the price');
  if (price.fallback && !sources.has(price.fallback)) price.fallback = '';
  const next = normaliseScanPage({ show, price });

  const fields = new Map(fieldDefs({ includeInactive: true }).map((f) => [f.key, f]));
  const fieldUpdates = Object.entries(req.body.fields || {}).filter(([k, v]) => fields.has(k) && typeof v === 'boolean' && v !== fields.get(k).is_public);
  tx(() => {
    setSettings({ scan_page: next });
    for (const [k, v] of fieldUpdates) q.run('UPDATE field_definitions SET is_public = ? WHERE key = ?', v, k);
  });
  invalidateFields();
  const shown = [...SCAN_PAGE_ITEMS.filter((i) => next.show[i.key]).map((i) => i.label), ...(next.price.enabled ? ['Price'] : [])];
  record({
    user: req.user, entity: 'settings', action: 'scan_page_updated',
    summary: `QR scan page updated (${shown.length} page items${fieldUpdates.length ? `, ${fieldUpdates.length} field(s) changed` : ''})`,
    changes: fieldUpdates.map(([k, v]) => ({ field: k, label: fields.get(k).label, from: v ? 'hidden' : 'shown', to: v ? 'shown' : 'hidden' })),
  });
  res.json(settingsPayload());
});

// --- product fields (custom fields) -------------------------------------------------
function fieldInput(body) {
  const type = FIELD_TYPES.includes(body.type) ? body.type : 'text';
  const options = type === 'select'
    ? (Array.isArray(body.options) ? body.options : String(body.options || '').split(','))
      .map((o) => String(o).trim()).filter(Boolean).slice(0, 200)
    : [];
  return {
    label: str(body.label, 'Label', { required: true, max: 80 }),
    type,
    options: options.length ? JSON.stringify(options) : null,
    unit: str(body.unit, 'Unit', { max: 20 }),
    group_name: str(body.group_name, 'Group', { max: 60 }) || 'Specifications',
    is_public: body.is_public !== false,
    is_filterable: Boolean(body.is_filterable),
    in_catalogue: body.in_catalogue !== false,
    active: body.active !== false,
  };
}

router.get('/fields', requirePerm('products.view'), (req, res) => {
  res.json(
    fieldDefs({ includeInactive: true }).map((f) => ({
      ...f,
      usage: Number(q.value('SELECT COUNT(*) FROM product_specifications WHERE field_key = ?', f.key)),
    })),
  );
});

router.post('/fields', requirePerm('settings.manage'), (req, res) => {
  const f = fieldInput(req.body);
  let key = slugKey(req.body.key || f.label);
  if (['sku', 'name', 'category', 'subcategory', 'description', 'status'].includes(key)) key = `${key}_field`;
  if (q.get('SELECT 1 FROM field_definitions WHERE key = ?', key)) throw badRequest(`A field with key "${key}" already exists`);
  const order = Number(q.value('SELECT ifnull(MAX(sort_order), 0) FROM field_definitions')) + 10;
  q.run(
    `INSERT INTO field_definitions(key, label, type, options, unit, group_name, is_public, is_filterable, in_catalogue, active, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    key, f.label, f.type, f.options, f.unit, f.group_name, f.is_public, f.is_filterable, f.in_catalogue, f.active, order,
  );
  invalidateFields();
  record({ user: req.user, entity: 'settings', action: 'field_added', summary: `Product field "${f.label}" added` });
  res.status(201).json(fieldDefs({ includeInactive: true }));
});

router.put('/fields/order', requirePerm('settings.manage'), (req, res) => {
  const keys = Array.isArray(req.body.keys) ? req.body.keys : [];
  tx(() => keys.forEach((k, i) => q.run('UPDATE field_definitions SET sort_order = ? WHERE key = ?', (i + 1) * 10, k)));
  invalidateFields();
  res.json(fieldDefs({ includeInactive: true }));
});

router.put('/fields/:key', requirePerm('settings.manage'), (req, res) => {
  const existing = q.get('SELECT type, calc FROM field_definitions WHERE key = ?', req.params.key);
  if (!existing) throw notFound('Field not found');
  const f = fieldInput(req.body);
  if (existing.calc) f.type = existing.type; // system-calculated: the type follows the calculation
  q.run(
    `UPDATE field_definitions SET label=?, type=?, options=?, unit=?, group_name=?, is_public=?, is_filterable=?, in_catalogue=?, active=?
      WHERE key = ?`,
    f.label, f.type, f.options, f.unit, f.group_name, f.is_public, f.is_filterable, f.in_catalogue, f.active, req.params.key,
  );
  invalidateFields();
  record({ user: req.user, entity: 'settings', action: 'field_updated', summary: `Product field "${f.label}" updated` });
  res.json(fieldDefs({ includeInactive: true }));
});

router.delete('/fields/:key', requirePerm('settings.manage'), (req, res) => {
  const field = q.get('SELECT * FROM field_definitions WHERE key = ?', req.params.key);
  if (!field) throw notFound('Field not found');
  if (field.calc) throw badRequest(`“${field.label}” is calculated by the system and cannot be deleted. Deactivate it instead.`);
  tx(() => {
    q.run('DELETE FROM field_definitions WHERE key = ?', field.key);
    q.run('DELETE FROM product_specifications WHERE field_key = ?', field.key);
  });
  invalidateFields();
  reindexAll();
  record({ user: req.user, entity: 'settings', action: 'field_deleted', summary: `Product field "${field.label}" and its values deleted` });
  res.json(fieldDefs({ includeInactive: true }));
});

// --- categories ----------------------------------------------------------------------
router.get('/categories', requirePerm('products.view'), (req, res) => res.json(listCategories()));

router.post('/categories', requirePerm('products.edit', 'settings.manage'), (req, res) => {
  const name = str(req.body.name, 'Category name', { required: true, max: 120 });
  const parent = Number(req.body.parent_id) || null;
  if (parent && !q.get('SELECT 1 FROM categories WHERE id = ? AND parent_id IS NULL', parent)) throw badRequest('Unknown parent category');
  const id = resolveCategory(name, parent);
  res.status(201).json({ id, categories: listCategories() });
});

router.put('/categories/:id', requirePerm('products.edit', 'settings.manage'), (req, res) => {
  const id = Number(req.params.id);
  const name = str(req.body.name, 'Category name', { required: true, max: 120 });
  const cat = q.get('SELECT * FROM categories WHERE id = ?', id);
  if (!cat) throw notFound('Category not found');
  q.run('UPDATE categories SET name = ? WHERE id = ?', name, id);
  reindexAll();
  record({ user: req.user, entity: 'settings', action: 'category_renamed', summary: `Category "${cat.name}" renamed to "${name}"` });
  res.json(listCategories());
});

router.delete('/categories/:id', requirePerm('settings.manage'), (req, res) => {
  const id = Number(req.params.id);
  const cat = q.get('SELECT * FROM categories WHERE id = ?', id);
  if (!cat) throw notFound('Category not found');
  q.run('DELETE FROM categories WHERE id = ?', id);
  reindexAll();
  record({ user: req.user, entity: 'settings', action: 'category_deleted', summary: `Category "${cat.name}" deleted` });
  res.json(listCategories());
});

// --- system: backup, logs, info ---------------------------------------------------------
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

router.get('/system', requirePerm('settings.manage'), (req, res) => {
  res.json({
    node: process.version,
    dataDir: config.dataDir,
    dbBytes: fs.statSync(paths.db).size,
    uploadsBytes: dirSize(paths.uploads),
    cataloguesBytes: dirSize(paths.catalogues),
    counts: {
      products: Number(q.value('SELECT COUNT(*) FROM products')),
      images: Number(q.value('SELECT COUNT(*) FROM product_images')),
      users: Number(q.value('SELECT COUNT(*) FROM users')),
      history: Number(q.value('SELECT COUNT(*) FROM product_history')),
    },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.get('/logs', requirePerm('settings.manage'), (req, res) => {
  res.json(readRecentLogs(Math.min(500, Number(req.query.limit) || 200)));
});

/** Download a consistent snapshot of the database plus all uploaded images and logos. */
router.get('/backup', requirePerm('settings.manage'), ah(async (req, res) => {
  const snapshot = path.join(paths.tmp, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="pms-backup-${stamp}.zip"`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err) => res.destroy(err));
  res.on('close', () => fs.rmSync(snapshot, { force: true }));
  zip.pipe(res);
  zip.file(snapshot, { name: 'app.db' });
  zip.directory(paths.uploads, 'uploads');
  zip.append(
    `Product Management System backup\nCreated: ${new Date().toISOString()}\n\nTo restore: stop the server, replace data/app.db and data/uploads with the files in this archive, then start the server.\n`,
    { name: 'README.txt' },
  );
  record({ user: req.user, entity: 'settings', action: 'backup_downloaded', summary: 'Backup downloaded' });
  await zip.finalize();
}));

export default router;
