import { q, tx, now, likeEscape } from '../db/index.js';
import { badRequest, notFound } from '../lib/http.js';
import { getSetting, setSettings } from '../lib/settings.js';
import { applyCbmRule, calcRules, fillBlankCbm, syncCalculated } from './calculations.js';
import { categoryName, resolveCategory } from './categories.js';
import { ensureCode, productUrl } from './codes.js';
import { fieldDefs, fieldMap, normaliseFieldValue } from './fields.js';
import { diff, record } from './history.js';
import { imageUrl, removeProductImageFiles, serialiseImage } from './images.js';

export const STATUSES = ['active', 'inactive', 'draft'];
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9\-_./ ]{0,63}$/;

export function validateSku(sku) {
  const s = String(sku || '').trim();
  if (!SKU_RE.test(s)) {
    throw badRequest('Product ID / SKU may contain letters, numbers, spaces and - _ . / (max 64 characters)');
  }
  return s;
}

/** Next automatic SKU from the configured prefix and counter. */
export function nextSku() {
  const prefix = getSetting('sku_prefix') ?? 'PRD-';
  let n = Number(getSetting('sku_next')) || 10001;
  while (q.get('SELECT 1 FROM products WHERE sku = ?', `${prefix}${n}`)) n++;
  setSettings({ sku_next: n + 1 });
  return `${prefix}${n}`;
}

export function uniqueSku(base) {
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base}-${i}`;
    if (!q.get('SELECT 1 FROM products WHERE sku = ?', candidate)) return candidate;
  }
  throw badRequest(`Could not create a unique SKU from ${base}`);
}

export function refreshSearchText(productId) {
  const p = q.get('SELECT id, sku, name, description, category_id, subcategory_id FROM products WHERE id = ?', productId);
  if (!p) return;
  const specs = q.all('SELECT value FROM product_specifications WHERE product_id = ?', productId).map((r) => r.value);
  const code = q.value('SELECT code FROM product_codes WHERE product_id = ?', productId);
  const text = [p.sku, code, p.name, p.description, categoryName(p.category_id), categoryName(p.subcategory_id), ...specs]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
  q.run('UPDATE products SET search_text = ? WHERE id = ?', text, productId);
}

export function reindexAll() {
  tx(() => {
    for (const { id } of q.all('SELECT id FROM products')) refreshSearchText(id);
  });
}

/**
 * Apply the calculation rules to every product (blank CBM from packing size, loadability), e.g.
 * after a rule changes and at start-up. Returns the number of products whose values changed.
 */
export function recalculateAll(rules = calcRules()) {
  let changed = 0;
  tx(() => {
    for (const { id } of q.all('SELECT id FROM products')) {
      const filled = fillBlankCbm(id, rules);
      if (syncCalculated(id, rules).length || filled) {
        refreshSearchText(id);
        changed++;
      }
    }
  });
  return changed;
}

function specsFor(ids) {
  const map = new Map(ids.map((id) => [id, {}]));
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = q.all(
      `SELECT product_id, field_key, value FROM product_specifications WHERE product_id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk,
    );
    for (const r of rows) map.get(r.product_id)[r.field_key] = r.value;
  }
  return map;
}

const LIST_SQL = `
  SELECT p.id, p.sku, p.name, p.description, p.status, p.category_id, p.subcategory_id, p.created_at, p.updated_at,
         c.name AS category, sc.name AS subcategory,
         (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.sort_order LIMIT 1) AS thumb,
         (SELECT file FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.sort_order LIMIT 1) AS image,
         (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS image_count,
         (SELECT code FROM product_codes pc WHERE pc.product_id = p.id) AS code,
         EXISTS (SELECT 1 FROM product_costing k WHERE k.product_id = p.id) AS has_costing
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories sc ON sc.id = p.subcategory_id`;

/** Build WHERE clause + args from list query parameters. */
export function buildFilters(query, { canViewCosting = false } = {}) {
  const where = [];
  const args = [];
  const search = String(query.search || '').trim().toLowerCase();
  if (search) {
    for (const term of search.split(/\s+/).slice(0, 8)) {
      where.push(`p.search_text LIKE ? ESCAPE '\\'`);
      args.push(`%${likeEscape(term)}%`);
    }
  }
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  if (num(query.category)) {
    where.push('(p.category_id = ? OR p.subcategory_id = ?)');
    args.push(num(query.category), num(query.category));
  }
  if (num(query.subcategory)) {
    where.push('p.subcategory_id = ?');
    args.push(num(query.subcategory));
  }
  if (STATUSES.includes(query.status)) {
    where.push('p.status = ?');
    args.push(query.status);
  }
  if (query.images === 'with') where.push('EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)');
  if (query.images === 'without') where.push('NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)');
  if (canViewCosting && query.costing === 'with') where.push('EXISTS (SELECT 1 FROM product_costing k WHERE k.product_id = p.id)');
  if (canViewCosting && query.costing === 'without') where.push('NOT EXISTS (SELECT 1 FROM product_costing k WHERE k.product_id = p.id)');
  if (num(query.buyer)) {
    where.push(`EXISTS (SELECT 1 FROM collection_products cp JOIN collections co ON co.id = cp.collection_id
                         WHERE cp.product_id = p.id AND co.buyer_id = ?)`);
    args.push(num(query.buyer));
  }
  if (num(query.collection)) {
    where.push('EXISTS (SELECT 1 FROM collection_products cp WHERE cp.product_id = p.id AND cp.collection_id = ?)');
    args.push(num(query.collection));
  }
  if (query.ids) {
    const ids = String(query.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 5000);
    where.push(`p.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    args.push(...ids);
  }
  // Field filters: f_<key>=value (exact, case-insensitive) or fl_<key>=value (contains).
  const fields = fieldMap();
  for (const [k, v] of Object.entries(query)) {
    if (v === '' || v === undefined) continue;
    const exact = k.startsWith('f_');
    const contains = k.startsWith('fl_');
    if (!exact && !contains) continue;
    const key = k.slice(exact ? 2 : 3);
    if (!fields.has(key)) continue;
    if (exact) {
      where.push('EXISTS (SELECT 1 FROM product_specifications s WHERE s.product_id = p.id AND s.field_key = ? AND s.value = ? COLLATE NOCASE)');
      args.push(key, String(v));
    } else {
      where.push(`EXISTS (SELECT 1 FROM product_specifications s WHERE s.product_id = p.id AND s.field_key = ? AND s.value LIKE ? ESCAPE '\\')`);
      args.push(key, `%${likeEscape(v)}%`);
    }
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function orderBy(sort) {
  const [key, dirRaw] = String(sort || 'updated_at:desc').split(':');
  const dir = dirRaw === 'asc' ? 'ASC' : 'DESC';
  const core = {
    updated_at: 'p.updated_at',
    created_at: 'p.created_at',
    name: 'p.name COLLATE NOCASE',
    sku: 'p.sku COLLATE NOCASE',
    category: 'c.name COLLATE NOCASE',
  };
  if (core[key]) return { sql: `ORDER BY ${core[key]} ${dir}, p.id ${dir}`, args: [] };
  const field = fieldMap().get(key);
  if (field) {
    const expr = field.type === 'number' ? 'CAST(s.value AS REAL)' : 's.value COLLATE NOCASE';
    return {
      sql: `ORDER BY (SELECT ${expr} FROM product_specifications s WHERE s.product_id = p.id AND s.field_key = ?) ${dir} NULLS LAST, p.id`,
      args: [key],
    };
  }
  return { sql: 'ORDER BY p.updated_at DESC', args: [] };
}

export function serialiseListItem(row, specs, { canViewCosting }) {
  return {
    id: row.id,
    sku: row.sku,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    category: row.category,
    subcategory: row.subcategory,
    thumb_url: imageUrl(row.thumb),
    image_url: imageUrl(row.image),
    image_count: row.image_count,
    has_costing: canViewCosting ? Boolean(row.has_costing) : undefined,
    specs: specs || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listProducts(query, { canViewCosting = false, page = 1, pageSize = 24, all = false } = {}) {
  const { where, args } = buildFilters(query, { canViewCosting });
  const order = orderBy(query.sort);
  const total = Number(q.value(`SELECT COUNT(*) FROM products p ${where}`, ...args));
  const limit = all ? '' : `LIMIT ${Number(pageSize)} OFFSET ${(Number(page) - 1) * Number(pageSize)}`;
  const rows = q.all(`${LIST_SQL} ${where} ${order.sql} ${limit}`, ...args, ...order.args);
  const specs = specsFor(rows.map((r) => r.id));
  return {
    items: rows.map((r) => serialiseListItem(r, specs.get(r.id), { canViewCosting })),
    total,
    page,
    pageSize,
  };
}

export function getProduct(id, { canViewCosting = false } = {}) {
  const row = q.get(`${LIST_SQL} WHERE p.id = ?`, id);
  if (!row) throw notFound('Product not found');
  const specs = specsFor([id]).get(id);
  const images = q.all('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order, id', id).map(serialiseImage);
  const code = q.get('SELECT code, barcode_type, created_at, regenerated_at FROM product_codes WHERE product_id = ?', id);
  const collections = q.all(
    `SELECT co.id, co.name, b.name AS buyer_name FROM collection_products cp
       JOIN collections co ON co.id = cp.collection_id LEFT JOIN buyers b ON b.id = co.buyer_id
      WHERE cp.product_id = ? ORDER BY co.updated_at DESC`,
    id,
  );
  const meta = q.get(
    `SELECT cu.name AS created_by_name, uu.name AS updated_by_name FROM products p
       LEFT JOIN users cu ON cu.id = p.created_by LEFT JOIN users uu ON uu.id = p.updated_by WHERE p.id = ?`,
    id,
  );
  return {
    ...serialiseListItem(row, specs, { canViewCosting }),
    images,
    code: code ? { ...code, url: productUrl(code.code) } : null,
    collections,
    created_by_name: meta?.created_by_name,
    updated_by_name: meta?.updated_by_name,
  };
}

/** Resolve category inputs (id or name) into ids. */
function resolveCategories(data, current = {}) {
  let categoryId = current.category_id ?? null;
  let subcategoryId = current.subcategory_id ?? null;
  if ('category_id' in data || 'category' in data) {
    if (data.category_id) {
      categoryId = Number(data.category_id);
      if (!q.get('SELECT 1 FROM categories WHERE id = ? AND parent_id IS NULL', categoryId)) throw badRequest('Unknown category');
    } else {
      categoryId = data.category ? resolveCategory(data.category) : null;
    }
    if (categoryId !== (current.category_id ?? null) && !('subcategory_id' in data || 'subcategory' in data)) subcategoryId = null;
  }
  if ('subcategory_id' in data || 'subcategory' in data) {
    if (data.subcategory_id) {
      subcategoryId = Number(data.subcategory_id);
      const sub = q.get('SELECT parent_id FROM categories WHERE id = ?', subcategoryId);
      if (!sub || sub.parent_id !== categoryId) throw badRequest('Sub category does not belong to the selected category');
    } else if (data.subcategory) {
      if (!categoryId) throw badRequest('Choose a category before a sub category');
      subcategoryId = resolveCategory(data.subcategory, categoryId);
    } else {
      subcategoryId = null;
    }
  }
  return { categoryId, subcategoryId };
}

/**
 * The only place product field values are written. Applies the CBM rule first, ignores values
 * sent for system-calculated fields and recalculates those afterwards.
 */
function writeSpecs(productId, specsIn, before = {}) {
  const fields = fieldMap();
  const specs = applyCbmRule(specsIn, before);
  const changes = [];
  for (const [key, raw] of Object.entries(specs || {})) {
    const field = fields.get(key);
    if (!field || field.calc) continue;
    const value = normaliseFieldValue(field, raw);
    const old = before[key] ?? null;
    if ((value ?? null) === old) continue;
    if (value === null) q.run('DELETE FROM product_specifications WHERE product_id = ? AND field_key = ?', productId, key);
    else {
      q.run(
        `INSERT INTO product_specifications(product_id, field_key, value) VALUES (?,?,?)
         ON CONFLICT(product_id, field_key) DO UPDATE SET value = excluded.value`,
        productId, key, value,
      );
    }
    changes.push({ field: key, label: field.label, from: old, to: value });
  }
  changes.push(...syncCalculated(productId));
  return changes;
}

const CORE_LABELS = { sku: 'SKU', name: 'Name', category: 'Category', subcategory: 'Sub Category', description: 'Description', status: 'Status' };

export function createProduct(data, user, { source = 'manual' } = {}) {
  return tx(() => {
    const sku = data.sku ? validateSku(data.sku) : nextSku();
    if (q.get('SELECT 1 FROM products WHERE sku = ?', sku)) throw badRequest(`Product ID ${sku} already exists`);
    const name = String(data.name || '').trim();
    if (!name) throw badRequest('Product name is required');
    const { categoryId, subcategoryId } = resolveCategories(data);
    const status = STATUSES.includes(data.status) ? data.status : 'active';
    const ts = now();
    const { lastInsertRowid } = q.run(
      `INSERT INTO products(sku, name, category_id, subcategory_id, description, status, created_by, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      sku, name.slice(0, 300), categoryId, subcategoryId, data.description ? String(data.description).slice(0, 10000) : null,
      status, user?.id, user?.id, ts, ts,
    );
    const id = Number(lastInsertRowid);
    writeSpecs(id, data.specs);
    ensureCode(id, sku);
    refreshSearchText(id);
    record({ user, productId: id, entity: 'product', entityId: id, action: 'created', summary: `Product ${sku} created (${source})` });
    record({ user, productId: id, entity: 'code', entityId: id, action: 'code_generated', summary: `QR code & barcode generated for ${sku}` });
    return id;
  });
}

export function updateProduct(id, data, user, { source = 'manual' } = {}) {
  return tx(() => {
    const current = q.get('SELECT * FROM products WHERE id = ?', id);
    if (!current) throw notFound('Product not found');
    const next = {};
    if ('sku' in data && data.sku !== undefined && String(data.sku).trim() !== current.sku) {
      next.sku = validateSku(data.sku);
      if (q.get('SELECT 1 FROM products WHERE sku = ? AND id <> ?', next.sku, id)) throw badRequest(`Product ID ${next.sku} already exists`);
    }
    if ('name' in data) {
      const name = String(data.name || '').trim();
      if (!name) throw badRequest('Product name is required');
      next.name = name.slice(0, 300);
    }
    if ('description' in data) next.description = data.description ? String(data.description).slice(0, 10000) : null;
    if ('status' in data && STATUSES.includes(data.status)) next.status = data.status;
    const { categoryId, subcategoryId } = resolveCategories(data, current);
    next.category_id = categoryId;
    next.subcategory_id = subcategoryId;

    const beforeCore = {
      sku: current.sku, name: current.name, description: current.description, status: current.status,
      category: categoryName(current.category_id), subcategory: categoryName(current.subcategory_id),
    };
    const afterCore = {
      sku: next.sku ?? current.sku, name: next.name ?? current.name,
      description: 'description' in next ? next.description : current.description,
      status: next.status ?? current.status, category: categoryName(categoryId), subcategory: categoryName(subcategoryId),
    };
    const changes = diff(beforeCore, afterCore, CORE_LABELS);

    const beforeSpecs = specsFor([id]).get(id);
    changes.push(...writeSpecs(id, data.specs, beforeSpecs));
    if (!changes.length) return { changed: false };

    q.run(
      `UPDATE products SET sku = ?, name = ?, description = ?, status = ?, category_id = ?, subcategory_id = ?,
              updated_by = ?, updated_at = ? WHERE id = ?`,
      afterCore.sku, afterCore.name, afterCore.description, afterCore.status, categoryId, subcategoryId, user?.id, now(), id,
    );
    ensureCode(id, afterCore.sku);
    refreshSearchText(id);
    record({
      user, productId: id, entity: 'product', entityId: id, action: 'updated',
      summary: `Product updated (${source}): ${changes.map((c) => c.label).slice(0, 6).join(', ')}${changes.length > 6 ? '…' : ''}`,
      changes,
    });
    return { changed: true, skuChanged: Boolean(next.sku), changes };
  });
}

export function deleteProducts(ids, user) {
  const rows = ids.length
    ? q.all(`SELECT id, sku, name FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
    : [];
  tx(() => {
    for (const p of rows) {
      q.run('DELETE FROM products WHERE id = ?', p.id);
      record({ user, productId: p.id, entity: 'product', entityId: p.id, action: 'deleted', summary: `Product ${p.sku} (${p.name}) deleted` });
    }
  });
  for (const p of rows) removeProductImageFiles(p.id);
  return rows.length;
}

/** Distinct values for a field (for filter dropdowns). */
export function fieldValues(key, limit = 300) {
  return q
    .all(
      `SELECT value, COUNT(*) AS count FROM product_specifications WHERE field_key = ? AND value IS NOT NULL AND value <> ''
       GROUP BY value COLLATE NOCASE ORDER BY value COLLATE NOCASE LIMIT ?`,
      key, limit,
    )
    .map((r) => ({ value: r.value, count: r.count }));
}

export function filterableFields() {
  return fieldDefs().filter((f) => f.is_filterable).map((f) => ({ key: f.key, label: f.label, values: fieldValues(f.key) }));
}
