import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { q, tx } from '../db/index.js';
import { can, requirePerm } from '../lib/auth.js';
import { ah, badRequest, forbidden, idList, notFound, pageParams } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import { calcRules } from '../services/calculations.js';
import { listCategories } from '../services/categories.js';
import { regenerateCode } from '../services/codes.js';
import { getProductCosting, setConstraintDefaults, setProductCosting } from '../services/costing.js';
import { exportProducts } from '../services/exporter.js';
import { fieldDefs } from '../services/fields.js';
import { record, redactHistory } from '../services/history.js';
import { addImages, deleteImage, reorderImages, replaceImage, setPrimary } from '../services/images.js';
import {
  STATUSES, buildFilters, createProduct, deleteProducts, filterableFields, getProduct, listProducts, updateProduct,
} from '../services/products.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 30 } });
const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw notFound('Product not found');
  return n;
};
const exists = (pid) => {
  if (!q.get('SELECT 1 FROM products WHERE id = ?', pid)) throw notFound('Product not found');
};

router.get('/meta', requirePerm('products.view'), (req, res) => {
  res.json({
    categories: listCategories(),
    fields: fieldDefs(),
    // System calculation rules, so forms can show calculated values (loadability, CBM) while typing.
    rules: calcRules(),
    filters: filterableFields(),
    statuses: STATUSES,
    buyers: q.all('SELECT id, name, company FROM buyers ORDER BY name COLLATE NOCASE'),
    collections: q.all(
      `SELECT c.id, c.name, b.name AS buyer_name FROM collections c LEFT JOIN buyers b ON b.id = c.buyer_id ORDER BY c.updated_at DESC`,
    ),
  });
});

router.get('/next-sku', requirePerm('products.create'), (req, res) => {
  // Preview only — the counter is not consumed until a product is saved without an SKU.
  const p = getSetting('sku_prefix') ?? 'PRD-';
  let n = Number(getSetting('sku_next')) || 10001;
  while (q.get('SELECT 1 FROM products WHERE sku = ?', `${p}${n}`)) n++;
  res.json({ sku: `${p}${n}` });
});

router.get('/', requirePerm('products.view'), (req, res) => {
  const { page, pageSize } = pageParams(req.query, { defaultSize: 24, maxSize: 500 });
  res.json(listProducts(req.query, { canViewCosting: can(req, 'costing.view'), page, pageSize }));
});

/** Ids of every product matching the filters ("select all results"). */
router.get('/ids', requirePerm('products.view'), (req, res) => {
  const { where, args } = buildFilters(req.query, { canViewCosting: can(req, 'costing.view') });
  res.json(q.all(`SELECT p.id FROM products p ${where} ORDER BY p.updated_at DESC LIMIT 5000`, ...args).map((r) => r.id));
});

router.get('/export.xlsx', requirePerm('products.import'), ah(async (req, res) => {
  const buffer = await exportProducts(req.query, { canViewCosting: can(req, 'costing.view'), template: req.query.template === '1' });
  const name = req.query.template === '1' ? 'product-import-template.xlsx' : `products-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(buffer));
}));

router.post('/', requirePerm('products.create'), ah(async (req, res) => {
  const pid = createProduct(req.body, req.user);
  if (req.body.costing && can(req, 'costing.edit')) setProductCosting(pid, req.body.costing, req.user);
  res.status(201).json(getProduct(pid, { canViewCosting: can(req, 'costing.view') }));
}));

router.post('/bulk-delete', requirePerm('products.delete'), (req, res) => {
  const ids = idList(req.body.ids);
  res.json({ deleted: deleteProducts(ids, req.user) });
});

router.post('/bulk-update', requirePerm('products.edit'), (req, res) => {
  const ids = idList(req.body.ids);
  const patch = {};
  if (STATUSES.includes(req.body.status)) patch.status = req.body.status;
  if (req.body.category_id !== undefined) patch.category_id = req.body.category_id || null;
  if (req.body.specs && typeof req.body.specs === 'object') patch.specs = req.body.specs;
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  let updated = 0;
  for (const pid of ids) if (updateProduct(pid, patch, req.user, { source: 'bulk edit' }).changed) updated++;
  res.json({ updated });
});

router.get('/:id', requirePerm('products.view'), (req, res) => {
  res.json(getProduct(id(req), { canViewCosting: can(req, 'costing.view') }));
});

router.put('/:id', requirePerm('products.edit'), (req, res) => {
  const pid = id(req);
  const result = updateProduct(pid, req.body, req.user);
  res.json({ ...getProduct(pid, { canViewCosting: can(req, 'costing.view') }), skuChanged: result.skuChanged });
});

router.delete('/:id', requirePerm('products.delete'), (req, res) => {
  const n = deleteProducts([id(req)], req.user);
  if (!n) throw notFound('Product not found');
  res.json({ ok: true });
});

router.get('/:id/history', requirePerm('products.view'), (req, res) => {
  const rows = q.all('SELECT * FROM product_history WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 300', id(req));
  res.json(redactHistory(rows, can(req, 'costing.view')));
});

// --- images -------------------------------------------------------------------
router.post('/:id/images', requirePerm('images.manage'), upload.array('images', 30), ah(async (req, res) => {
  const pid = id(req);
  exists(pid);
  if (!req.files?.length) throw badRequest('Choose at least one image');
  const result = await addImages(pid, req.files, req.user);
  res.json({ ...result, images: getProduct(pid).images });
}));

router.put('/:id/images/order', requirePerm('images.manage'), (req, res) => {
  const pid = id(req);
  reorderImages(pid, idList(req.body.ids));
  res.json(getProduct(pid).images);
});

router.post('/:id/images/:imageId/primary', requirePerm('images.manage'), (req, res) => {
  const pid = id(req);
  if (!setPrimary(pid, Number(req.params.imageId), req.user)) throw notFound('Image not found');
  res.json(getProduct(pid).images);
});

router.put('/:id/images/:imageId', requirePerm('images.manage'), upload.single('image'), ah(async (req, res) => {
  const pid = id(req);
  if (!req.file) throw badRequest('Choose an image');
  if (!(await replaceImage(pid, Number(req.params.imageId), req.file, req.user))) throw notFound('Image not found');
  res.json(getProduct(pid).images);
}));

router.delete('/:id/images/:imageId', requirePerm('images.manage'), (req, res) => {
  const pid = id(req);
  if (!deleteImage(pid, Number(req.params.imageId), req.user)) throw notFound('Image not found');
  res.json(getProduct(pid).images);
});

// --- costing --------------------------------------------------------------------
export const costingPayload = (req, pid) => ({
  ...getProductCosting(pid),
  product_id: pid,
  can_edit: can(req, 'costing.edit'),
  can_edit_defaults: can(req, 'costing.constraints'),
});

router.get('/:id/costing', requirePerm('costing.view'), (req, res) => {
  const pid = id(req);
  exists(pid);
  record({ user: req.user, productId: pid, entity: 'costing', action: 'costing_viewed', summary: 'Costing viewed in dashboard' });
  res.json(costingPayload(req, pid));
});

/**
 * Save costing. values: product inputs and per-product constraint overrides (needs costing.edit);
 * defaults: constraint values for all products (needs costing.constraints). Nothing is saved
 * unless the user explicitly saves — recalculation while exploring happens in the browser.
 */
export function saveCosting(req, pid, source) {
  const { values, defaults } = req.body || {};
  if ((!values || typeof values !== 'object') && (!defaults || typeof defaults !== 'object')) throw badRequest('Nothing to save');
  if (values && Object.keys(values).length && !can(req, 'costing.edit')) throw forbidden('You are not allowed to save product costing');
  if (defaults && Object.keys(defaults).length && !can(req, 'costing.constraints')) throw forbidden('You are not allowed to change constraints for all products');
  tx(() => {
    if (defaults && Object.keys(defaults).length) setConstraintDefaults(defaults, req.user);
    if (values && Object.keys(values).length) setProductCosting(pid, values, req.user, { source });
  });
  return costingPayload(req, pid);
}

router.put('/:id/costing', requirePerm('costing.edit', 'costing.constraints'), (req, res) => {
  const pid = id(req);
  exists(pid);
  res.json(saveCosting(req, pid, 'manual'));
});

// --- codes ------------------------------------------------------------------------
router.post('/:id/code/regenerate', requirePerm('codes.manage'), (req, res) => {
  const pid = id(req);
  const before = q.value('SELECT code FROM product_codes WHERE product_id = ?', pid);
  const code = regenerateCode(pid);
  if (!code) throw notFound('Product not found');
  record({
    user: req.user, productId: pid, entity: 'code', action: 'code_regenerated', summary: 'QR code / barcode regenerated',
    changes: [{ field: 'code', label: 'Code', from: before, to: code.code }],
  });
  res.json(getProduct(pid).code);
});

export default router;
