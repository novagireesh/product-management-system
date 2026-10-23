import { Router } from 'express';
import { q, tx, now } from '../db/index.js';
import { requirePerm } from '../lib/auth.js';
import { badRequest, idList, int, notFound, str } from '../lib/http.js';
import { applyAutoCollections, planAutoCollections, serialisePlan, validateTemplate } from '../services/autoCollections.js';
import { calcRules } from '../services/calculations.js';
import { fieldMap, formatFieldValue, parseNumber } from '../services/fields.js';
import { record } from '../services/history.js';
import { imageUrl } from '../services/images.js';

const router = Router();

function buyerInput(b) {
  return {
    name: str(b.name, 'Buyer name', { required: true, max: 150 }),
    company: str(b.company, 'Company', { max: 150 }),
    country: str(b.country, 'Country', { max: 80 }),
    email: str(b.email, 'Email', { max: 200 }),
    phone: str(b.phone, 'Phone', { max: 60 }),
    address: str(b.address, 'Address', { max: 500 }),
    notes: str(b.notes, 'Notes', { max: 4000 }),
  };
}

// --- buyers -----------------------------------------------------------------------
router.get('/buyers', requirePerm('buyers.view', 'catalogues.generate'), (req, res) => {
  const search = String(req.query.search || '').trim();
  const rows = q.all(
    `SELECT b.*,
            (SELECT COUNT(*) FROM collections c WHERE c.buyer_id = b.id) AS collection_count,
            (SELECT COUNT(*) FROM catalogues k WHERE k.buyer_id = b.id) AS catalogue_count
       FROM buyers b
      WHERE (? = '' OR b.name LIKE ? OR b.company LIKE ? OR b.country LIKE ? OR b.email LIKE ?)
      ORDER BY b.name COLLATE NOCASE`,
    search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`,
  );
  res.json(rows);
});

router.get('/buyers/:id', requirePerm('buyers.view'), (req, res) => {
  const buyer = q.get('SELECT * FROM buyers WHERE id = ?', Number(req.params.id));
  if (!buyer) throw notFound('Buyer not found');
  const collections = q.all(
    `SELECT c.*, (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id) AS product_count
       FROM collections c WHERE c.buyer_id = ? ORDER BY c.updated_at DESC`,
    buyer.id,
  );
  const catalogues = q.all('SELECT id, title, template, product_count, created_at FROM catalogues WHERE buyer_id = ? ORDER BY created_at DESC LIMIT 50', buyer.id);
  res.json({ ...buyer, collections, catalogues });
});

router.post('/buyers', requirePerm('buyers.manage'), (req, res) => {
  const b = buyerInput(req.body);
  const { lastInsertRowid } = q.run(
    'INSERT INTO buyers(name, company, country, email, phone, address, notes) VALUES (?,?,?,?,?,?,?)',
    b.name, b.company, b.country, b.email, b.phone, b.address, b.notes,
  );
  record({ user: req.user, entity: 'buyer', entityId: Number(lastInsertRowid), action: 'buyer_created', summary: `Buyer ${b.name} added` });
  res.status(201).json(q.get('SELECT * FROM buyers WHERE id = ?', lastInsertRowid));
});

router.put('/buyers/:id', requirePerm('buyers.manage'), (req, res) => {
  const id = Number(req.params.id);
  if (!q.get('SELECT 1 FROM buyers WHERE id = ?', id)) throw notFound('Buyer not found');
  const b = buyerInput(req.body);
  q.run(
    'UPDATE buyers SET name=?, company=?, country=?, email=?, phone=?, address=?, notes=?, updated_at=? WHERE id=?',
    b.name, b.company, b.country, b.email, b.phone, b.address, b.notes, now(), id,
  );
  res.json(q.get('SELECT * FROM buyers WHERE id = ?', id));
});

router.delete('/buyers/:id', requirePerm('buyers.manage'), (req, res) => {
  const b = q.get('SELECT name FROM buyers WHERE id = ?', Number(req.params.id));
  if (!b) throw notFound('Buyer not found');
  q.run('DELETE FROM buyers WHERE id = ?', Number(req.params.id));
  record({ user: req.user, entity: 'buyer', entityId: Number(req.params.id), action: 'buyer_deleted', summary: `Buyer ${b.name} deleted` });
  res.json({ ok: true });
});

// --- collections --------------------------------------------------------------------
router.get('/collections', requirePerm('buyers.view', 'catalogues.generate'), (req, res) => {
  const buyer = Number(req.query.buyer) || null;
  res.json(
    q.all(
      `SELECT c.*, b.name AS buyer_name, b.company AS buyer_company, u.name AS created_by_name,
              (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id) AS product_count,
              (SELECT i.thumb FROM collection_products cp JOIN product_images i ON i.product_id = cp.product_id
                WHERE cp.collection_id = c.id ORDER BY cp.sort_order, i.is_primary DESC LIMIT 1) AS cover
         FROM collections c LEFT JOIN buyers b ON b.id = c.buyer_id LEFT JOIN users u ON u.id = c.created_by
        WHERE (? IS NULL OR c.buyer_id = ?)
        ORDER BY c.updated_at DESC`,
      buyer, buyer,
    ).map((c) => ({ ...c, cover_url: imageUrl(c.cover) })),
  );
});

function collectionDetail(id) {
  const c = q.get(
    `SELECT c.*, b.name AS buyer_name, b.company AS buyer_company FROM collections c LEFT JOIN buyers b ON b.id = c.buyer_id WHERE c.id = ?`,
    id,
  );
  if (!c) throw notFound('Collection not found');
  const spec = (key) => `(SELECT value FROM product_specifications s WHERE s.product_id = p.id AND s.field_key = '${key}')`;
  const fields = fieldMap();
  const products = q.all(
    `SELECT p.id, p.sku, p.name, p.status, cat.name AS category, cp.quantity, cp.notes, cp.sort_order,
            ${spec('cbm')} AS cbm, ${spec('loadability')} AS loadability,
            (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.sort_order LIMIT 1) AS thumb
       FROM collection_products cp JOIN products p ON p.id = cp.product_id LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE cp.collection_id = ? ORDER BY cp.sort_order, cp.added_at`,
    id,
  ).map((p) => ({
    ...p,
    thumb_url: imageUrl(p.thumb),
    cbm: parseNumber(p.cbm),
    loadability: parseNumber(p.loadability),
    loadability_text: formatFieldValue(fields.get('loadability'), p.loadability),
  }));
  // Container load for the requested quantities: Σ quantity × CBM, against the loadability rule
  // (65 units per CBM ⇔ one container holds 65 CBM).
  const capacity = calcRules().loadability.units_per_cbm;
  const withQty = products.filter((p) => p.quantity > 0);
  const totalCbm = withQty.reduce((a, p) => a + (p.cbm || 0) * p.quantity, 0);
  const load = {
    total_qty: withQty.reduce((a, p) => a + p.quantity, 0),
    total_cbm: Math.round(totalCbm * 1000) / 1000,
    containers: Math.round((totalCbm / capacity) * 100) / 100,
    container_cbm: capacity,
    missing_cbm: withQty.filter((p) => !p.cbm).length,
  };
  return { ...c, products, load };
}

// --- automatic collections by product code (DF18001 → "Code 18") -----------------------
/** Scan product codes and show what would be created / refreshed. Changes nothing. */
router.get('/collections/auto', requirePerm('buyers.view'), (req, res) => {
  const template = req.query.template ? validateTemplate(req.query.template) : undefined;
  res.json(serialisePlan(planAutoCollections(template)));
});

/** Create or refresh one collection per product-code series. Safe to run any number of times. */
router.post('/collections/auto', requirePerm('buyers.manage'), (req, res) => {
  res.json(applyAutoCollections(req.user, { template: req.body.name_template }));
});

/** Collections kept by the product-code rule get their products only from that rule. */
function assertManual(c) {
  if (c.auto_key) throw badRequest(`“${c.name}” is kept automatically from product codes. Use “Refresh collections by product code” instead.`);
}

router.get('/collections/:id', requirePerm('buyers.view', 'catalogues.generate'), (req, res) => {
  res.json(collectionDetail(Number(req.params.id)));
});

router.post('/collections', requirePerm('buyers.manage'), (req, res) => {
  const name = str(req.body.name, 'Collection name', { required: true, max: 150 });
  const buyerId = int(req.body.buyer_id, 'Buyer');
  if (buyerId && !q.get('SELECT 1 FROM buyers WHERE id = ?', buyerId)) throw badRequest('Unknown buyer');
  const ids = idList(req.body.product_ids || []);
  const id = tx(() => {
    const { lastInsertRowid } = q.run(
      'INSERT INTO collections(name, buyer_id, notes, created_by) VALUES (?,?,?,?)',
      name, buyerId, str(req.body.notes, 'Notes', { max: 4000 }), req.user.id,
    );
    ids.forEach((pid, i) => q.run('INSERT OR IGNORE INTO collection_products(collection_id, product_id, sort_order) SELECT ?, id, ? FROM products WHERE id = ?', lastInsertRowid, i, pid));
    record({ user: req.user, entity: 'collection', entityId: Number(lastInsertRowid), action: 'collection_created', summary: `Buyer collection "${name}" created with ${ids.length} products` });
    return Number(lastInsertRowid);
  });
  res.status(201).json(collectionDetail(id));
});

router.put('/collections/:id', requirePerm('buyers.manage'), (req, res) => {
  const id = Number(req.params.id);
  const current = collectionDetail(id);
  // The name of an automatic collection comes from its product-code series.
  const name = current.auto_key ? current.name : str(req.body.name, 'Collection name', { required: true, max: 150 });
  const buyerId = int(req.body.buyer_id, 'Buyer');
  q.run('UPDATE collections SET name=?, buyer_id=?, notes=?, updated_at=? WHERE id=?', name, buyerId, str(req.body.notes, 'Notes', { max: 4000 }), now(), id);
  res.json(collectionDetail(id));
});

router.delete('/collections/:id', requirePerm('buyers.manage'), (req, res) => {
  const c = collectionDetail(Number(req.params.id));
  q.run('DELETE FROM collections WHERE id = ?', c.id);
  record({ user: req.user, entity: 'collection', entityId: c.id, action: 'collection_deleted', summary: `Buyer collection "${c.name}" deleted` });
  res.json({ ok: true });
});

router.post('/collections/:id/products', requirePerm('buyers.manage'), (req, res) => {
  const id = Number(req.params.id);
  const c = collectionDetail(id);
  assertManual(c);
  const ids = idList(req.body.product_ids);
  let order = Number(q.value('SELECT ifnull(MAX(sort_order), -1) FROM collection_products WHERE collection_id = ?', id)) + 1;
  let added = 0;
  tx(() => {
    for (const pid of ids) {
      const r = q.run('INSERT OR IGNORE INTO collection_products(collection_id, product_id, sort_order) SELECT ?, id, ? FROM products WHERE id = ?', id, order++, pid);
      added += Number(r.changes);
    }
    q.run('UPDATE collections SET updated_at = ? WHERE id = ?', now(), id);
    if (added) record({ user: req.user, entity: 'collection', entityId: id, action: 'collection_products_added', summary: `${added} products added to "${c.name}"` });
  });
  res.json({ added, collection: collectionDetail(id) });
});

router.post('/collections/:id/products/remove', requirePerm('buyers.manage'), (req, res) => {
  const id = Number(req.params.id);
  assertManual(collectionDetail(id));
  const ids = idList(req.body.product_ids);
  tx(() => {
    for (const pid of ids) q.run('DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?', id, pid);
    q.run('UPDATE collections SET updated_at = ? WHERE id = ?', now(), id);
  });
  res.json(collectionDetail(id));
});

router.put('/collections/:id/products/:productId', requirePerm('buyers.manage'), (req, res) => {
  const id = Number(req.params.id);
  q.run(
    'UPDATE collection_products SET quantity = ?, notes = ? WHERE collection_id = ? AND product_id = ?',
    int(req.body.quantity, 'Quantity', { min: 0, max: 10_000_000 }), str(req.body.notes, 'Notes', { max: 1000 }), id, Number(req.params.productId),
  );
  res.json(collectionDetail(id));
});

router.put('/collections/:id/order', requirePerm('buyers.manage'), (req, res) => {
  const id = Number(req.params.id);
  assertManual(collectionDetail(id));
  const ids = idList(req.body.product_ids);
  tx(() => ids.forEach((pid, i) => q.run('UPDATE collection_products SET sort_order = ? WHERE collection_id = ? AND product_id = ?', i, id, pid)));
  res.json(collectionDetail(id));
});

export default router;
