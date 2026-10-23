import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../config.js';
import { q, tx } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/http.js';
import { getSetting } from '../../lib/settings.js';
import { PERCENT_LIMITS, PRICE_ROUNDING, percentLabel } from '../../../shared/pricing.js';
import { record } from '../history.js';
import { LAYOUTS, TEMPLATES, catalogueFieldOptions, loadCatalogueData, prepareImages, priceSources } from './data.js';
import { renderPdf } from './pdf.js';
import { renderPptx } from './pptx.js';
import { renderXlsx } from './xlsx.js';

export const FORMATS = { pdf: 'PDF', pptx: 'PowerPoint', xlsx: 'Excel' };
const MIME = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export { TEMPLATES, LAYOUTS, catalogueFieldOptions, priceSources };

/** Short description of a catalogue's pricing method for history and summaries. */
export function priceSummary(price) {
  if (!price || price.mode === 'none') return '';
  if (price.mode === 'manual') return 'manual prices';
  const label = priceSources().find((s) => s.key === price.source)?.label || price.source;
  if (price.mode === 'percent') return `${label} ${percentLabel(price.percent)}${price.rounding === 'whole' ? ', rounded' : ''}`;
  return 'prices from costing';
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'catalogue';

/**
 * Price shown in a catalogue (pricing method):
 *  - none
 *  - existing: the reference price from costing data, unchanged (needs costing access)
 *  - percent:  the reference price increased by a percentage, optionally rounded (needs costing access)
 *  - manual:   typed in per product
 * Catalogue prices belong to that catalogue only and never change the product's costing.
 */
function normalisePrice(input, { canViewCosting }) {
  const p = input.price && typeof input.price === 'object' ? input.price : {};
  // Older clients sent the buyer price as a field.
  const legacy = Array.isArray(input.fields) && input.fields.includes('cost:buyer_price');
  const mode = ['existing', 'manual', 'percent'].includes(p.mode) ? p.mode : legacy ? 'existing' : 'none';
  if (mode === 'none') return { mode };
  const label = String(p.label || 'Price').trim().slice(0, 40) || 'Price';
  if (mode === 'existing' || mode === 'percent') {
    if (!canViewCosting) throw forbidden('Prices from costing data need costing access. Enter prices manually instead.');
    const sources = priceSources();
    const source = sources.find((s) => s.key === (p.source || 'buyer_price')) || sources[0];
    if (!source) throw badRequest('No price fields are available in the costing structure');
    const fallback = sources.find((s) => s.key === p.fallback && s.key !== source.key) || null;
    const base = { mode, label, source: source.key, fallback: fallback?.key || null, currency: source.currency };
    if (mode === 'existing') return base;
    const percent = Number(String(p.percent ?? '').replace(/[,%\s]/g, ''));
    if (String(p.percent ?? '').trim() === '' || !Number.isFinite(percent) || percent < PERCENT_LIMITS.min || percent > PERCENT_LIMITS.max) {
      throw badRequest(`Enter the percentage increase as a number between ${PERCENT_LIMITS.min} and ${PERCENT_LIMITS.max}`);
    }
    const rounding = PRICE_ROUNDING.some((r) => r.value === p.rounding) ? p.rounding : 'whole';
    return { ...base, percent: Math.round(percent * 1000) / 1000, rounding };
  }
  const values = {};
  for (const [id, v] of Object.entries(p.values || {})) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) throw badRequest(`Invalid price for product ${id}`);
    values[Number(id)] = Math.round(n * 100) / 100;
  }
  const currency = String(p.currency || getSetting('currency') || 'USD').trim().toUpperCase().slice(0, 10);
  return { mode, label, currency, values };
}

function normaliseOptions(input, { canViewCosting }) {
  const template = TEMPLATES[input.template] ? input.template : 'premium';
  const allowedFields = new Set(catalogueFieldOptions({ canViewCosting }).map((f) => f.key));
  const fields = (Array.isArray(input.fields) ? input.fields : TEMPLATES[template].fields).filter((k) => allowedFields.has(k));
  const formats = (Array.isArray(input.formats) ? input.formats : ['pdf']).filter((f) => FORMATS[f]);
  if (!formats.length) throw badRequest('Choose at least one export format');
  const title = String(input.title || '').trim().slice(0, 120);
  if (!title) throw badRequest('Catalogue title is required');
  return {
    title,
    subtitle: String(input.subtitle || '').trim().slice(0, 200) || null,
    template,
    layout: LAYOUTS[input.layout] ? input.layout : TEMPLATES[template].layout,
    orientation: input.orientation === 'portrait' ? 'portrait' : 'landscape',
    fields: [...new Set(fields)],
    code: ['qr', 'barcode', 'none'].includes(input.code) ? input.code : 'qr',
    cover: input.cover !== false,
    formats,
    buyer_id: Number(input.buyer_id) || null,
    collection_id: Number(input.collection_id) || null,
    price: normalisePrice(input, { canViewCosting }),
  };
}

export async function generateCatalogue(input, user, { canViewCosting }) {
  const opts = normaliseOptions(input, { canViewCosting });
  let productIds = (Array.isArray(input.product_ids) ? input.product_ids : []).map(Number).filter(Number.isInteger);
  if (!productIds.length && opts.collection_id) {
    productIds = q.all('SELECT product_id FROM collection_products WHERE collection_id = ? ORDER BY sort_order, added_at', opts.collection_id).map((r) => r.product_id);
  }
  productIds = [...new Set(productIds)];
  if (!productIds.length) throw badRequest('Select at least one product');
  if (productIds.length > 2000) throw badRequest('A catalogue can contain at most 2000 products');
  if (opts.buyer_id && !q.get('SELECT 1 FROM buyers WHERE id = ?', opts.buyer_id)) throw badRequest('Unknown buyer');

  const data = await loadCatalogueData(productIds, opts, { canViewCosting });
  if (!data.products.length) throw badRequest('None of the selected products exist any more');
  await prepareImages(data, { layout: opts.layout, extras: opts.template === 'premium' && opts.layout === 'single' });

  const { lastInsertRowid } = q.run(
    `INSERT INTO catalogues(title, subtitle, template, buyer_id, collection_id, options, product_count, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    opts.title, opts.subtitle, opts.template, opts.buyer_id, opts.collection_id,
    JSON.stringify({ ...opts, price: { ...opts.price, values: undefined } }), data.products.length, user?.id,
  );
  const id = Number(lastInsertRowid);
  const files = [];
  try {
    for (const format of opts.formats) {
      const file = `${id}-${slug(opts.title)}.${format}`;
      const out = path.join(paths.catalogues, file);
      if (format === 'pdf') await renderPdf(data, opts, out);
      else if (format === 'pptx') await renderPptx(data, opts, out);
      else await renderXlsx(data, opts, out);
      files.push({ format, file, size: fs.statSync(out).size });
    }
  } catch (err) {
    q.run('DELETE FROM catalogues WHERE id = ?', id);
    for (const f of files) fs.rmSync(path.join(paths.catalogues, f.file), { force: true });
    throw err;
  }

  tx(() => {
    for (const f of files) q.run('INSERT INTO catalogue_files(catalogue_id, format, file, size_bytes) VALUES (?,?,?,?)', id, f.format, f.file, f.size);
    data.products.forEach((p, i) => {
      q.run('INSERT INTO catalogue_products(catalogue_id, product_id, sku, name, sort_order, price) VALUES (?,?,?,?,?,?)', id, p.id, p.sku, p.name, i, p.price?.value ?? null);
      record({ user, productId: p.id, entity: 'catalogue', entityId: id, action: 'included_in_catalogue', summary: `Included in catalogue "${opts.title}"` });
    });
    record({
      user, entity: 'catalogue', entityId: id, action: 'catalogue_generated',
      summary: `Catalogue "${opts.title}" generated (${TEMPLATES[opts.template].label}, ${data.products.length} products, ${files.map((f) => FORMATS[f.format]).join(' / ')}${opts.price.mode !== 'none' ? `, ${priceSummary(opts.price)}` : ''})`,
    });
  });
  return getCatalogue(id);
}

export function getCatalogue(id) {
  const c = q.get(
    `SELECT c.*, b.name AS buyer_name, b.company AS buyer_company, co.name AS collection_name, u.name AS created_by_name
       FROM catalogues c LEFT JOIN buyers b ON b.id = c.buyer_id LEFT JOIN collections co ON co.id = c.collection_id
       LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?`,
    id,
  );
  if (!c) throw notFound('Catalogue not found');
  return {
    ...c,
    options: c.options ? JSON.parse(c.options) : {},
    files: q.all('SELECT format, size_bytes FROM catalogue_files WHERE catalogue_id = ? ORDER BY id', id),
    products: q.all('SELECT product_id, sku, name, price FROM catalogue_products WHERE catalogue_id = ? ORDER BY sort_order', id),
  };
}

export function listCatalogues({ buyer, search, offset, pageSize }) {
  const where = [];
  const args = [];
  if (buyer) {
    where.push('c.buyer_id = ?');
    args.push(Number(buyer));
  }
  if (search) {
    where.push('(c.title LIKE ? OR b.name LIKE ? OR b.company LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(q.value(`SELECT COUNT(*) FROM catalogues c LEFT JOIN buyers b ON b.id = c.buyer_id ${w}`, ...args));
  const items = q.all(
    `SELECT c.id, c.title, c.subtitle, c.template, c.product_count, c.created_at, c.buyer_id, c.collection_id,
            b.name AS buyer_name, b.company AS buyer_company, co.name AS collection_name, u.name AS created_by_name,
            (SELECT json_group_array(json_object('format', format, 'size_bytes', size_bytes)) FROM catalogue_files f WHERE f.catalogue_id = c.id) AS files
       FROM catalogues c LEFT JOIN buyers b ON b.id = c.buyer_id LEFT JOIN collections co ON co.id = c.collection_id
       LEFT JOIN users u ON u.id = c.created_by ${w}
      ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    ...args, pageSize, offset,
  ).map((r) => ({ ...r, files: JSON.parse(r.files || '[]') }));
  return { items, total };
}

export function catalogueFile(id, format) {
  const row = q.get(
    'SELECT f.file, c.title FROM catalogue_files f JOIN catalogues c ON c.id = f.catalogue_id WHERE f.catalogue_id = ? AND f.format = ?',
    id, format,
  );
  if (!row) throw notFound('File not found');
  const full = path.join(paths.catalogues, row.file);
  if (!fs.existsSync(full)) throw notFound('The file is no longer on the server. Please generate the catalogue again.');
  return { path: full, name: `${slug(row.title)}.${format}`, mime: MIME[format] };
}

export function deleteCatalogue(id, user) {
  const c = q.get('SELECT title FROM catalogues WHERE id = ?', id);
  if (!c) throw notFound('Catalogue not found');
  const files = q.all('SELECT file FROM catalogue_files WHERE catalogue_id = ?', id);
  tx(() => {
    q.run('DELETE FROM catalogues WHERE id = ?', id);
    record({ user, entity: 'catalogue', entityId: id, action: 'catalogue_deleted', summary: `Catalogue "${c.title}" deleted` });
  });
  for (const f of files) fs.rmSync(path.join(paths.catalogues, f.file), { force: true });
}
