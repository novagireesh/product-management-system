import { Router } from 'express';
import { q } from '../db/index.js';
import { can, requirePerm } from '../lib/auth.js';
import { pageParams } from '../lib/http.js';
import { redactHistory } from '../services/history.js';
import { imageUrl } from '../services/images.js';

const router = Router();
const n = (sql, ...args) => Number(q.value(sql, ...args));

router.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
  const total = n('SELECT COUNT(*) FROM products');
  const withImages = n('SELECT COUNT(DISTINCT product_id) FROM product_images');
  const stats = {
    totalProducts: total,
    activeProducts: n(`SELECT COUNT(*) FROM products WHERE status = 'active'`),
    categories: n('SELECT COUNT(*) FROM categories WHERE parent_id IS NULL'),
    subcategories: n('SELECT COUNT(*) FROM categories WHERE parent_id IS NOT NULL'),
    withImages,
    withoutImages: total - withImages,
    withCodes: n('SELECT COUNT(*) FROM product_codes'),
    withCosting: can(req, 'costing.view') ? n('SELECT COUNT(DISTINCT product_id) FROM product_costing') : null,
    cataloguesGenerated: n('SELECT COUNT(*) FROM catalogues'),
    buyers: n('SELECT COUNT(*) FROM buyers'),
    collections: n('SELECT COUNT(*) FROM collections'),
  };
  const byCategory = q.all(
    `SELECT ifnull(c.name, 'Uncategorised') AS name, COUNT(*) AS count
       FROM products p LEFT JOIN categories c ON c.id = p.category_id GROUP BY c.id ORDER BY count DESC LIMIT 8`,
  );
  const recentProducts = q.all(
    `SELECT p.id, p.sku, p.name, p.updated_at,
            (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.sort_order LIMIT 1) AS thumb
       FROM products p ORDER BY p.updated_at DESC LIMIT 6`,
  ).map((p) => ({ ...p, thumb_url: imageUrl(p.thumb) }));
  const recentCatalogues = q.all(
    `SELECT c.id, c.title, c.template, c.product_count, c.created_at, b.name AS buyer_name
       FROM catalogues c LEFT JOIN buyers b ON b.id = c.buyer_id ORDER BY c.created_at DESC LIMIT 5`,
  );
  const activity = can(req, 'history.view')
    ? redactHistory(
      q.all(
        `SELECT h.*, p.sku FROM product_history h LEFT JOIN products p ON p.id = h.product_id
          WHERE h.action NOT IN ('included_in_catalogue', 'costing_viewed', 'code_generated')
          ORDER BY h.created_at DESC, h.id DESC LIMIT 10`,
      ),
      can(req, 'costing.view'),
    )
    : [];
  res.json({ stats, byCategory, recentProducts, recentCatalogues, activity });
});

router.get('/history', requirePerm('history.view'), (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 50 });
  const where = [];
  const args = [];
  if (req.query.entity) {
    where.push('h.entity = ?');
    args.push(String(req.query.entity));
  }
  if (req.query.user) {
    where.push('h.user_id = ?');
    args.push(Number(req.query.user));
  }
  if (req.query.product) {
    where.push('h.product_id = ?');
    args.push(Number(req.query.product));
  }
  if (req.query.from) {
    where.push('h.created_at >= ?');
    args.push(String(req.query.from));
  }
  if (req.query.to) {
    where.push('h.created_at <= ?');
    args.push(String(req.query.to) + 'T23:59:59.999Z');
  }
  if (req.query.search) {
    where.push('(h.summary LIKE ? OR p.sku LIKE ? OR p.name LIKE ?)');
    const s = `%${req.query.search}%`;
    args.push(s, s, s);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = n(`SELECT COUNT(*) FROM product_history h LEFT JOIN products p ON p.id = h.product_id ${w}`, ...args);
  const rows = q.all(
    `SELECT h.*, p.sku, p.name AS product_name FROM product_history h LEFT JOIN products p ON p.id = h.product_id ${w}
      ORDER BY h.created_at DESC, h.id DESC LIMIT ? OFFSET ?`,
    ...args, pageSize, offset,
  );
  res.json({
    items: redactHistory(rows, can(req, 'costing.view')),
    total,
    page,
    pageSize,
    entities: q.all('SELECT DISTINCT entity FROM product_history ORDER BY entity').map((r) => r.entity),
    users: q.all('SELECT DISTINCT user_id AS id, user_name AS name FROM product_history WHERE user_id IS NOT NULL ORDER BY user_name'),
  });
});

export default router;
