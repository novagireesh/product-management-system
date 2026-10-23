import { q } from '../db/index.js';

export function listCategories() {
  const rows = q.all(
    `SELECT c.id, c.name, c.parent_id,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id OR p.subcategory_id = c.id) AS product_count
       FROM categories c ORDER BY c.name COLLATE NOCASE`,
  );
  const top = rows.filter((r) => !r.parent_id).map((r) => ({ ...r, children: [] }));
  const byId = new Map(top.map((r) => [r.id, r]));
  for (const r of rows) if (r.parent_id) byId.get(r.parent_id)?.children.push(r);
  return top;
}

/** Find a category by name (case-insensitive) under the given parent, creating it if needed. */
export function resolveCategory(name, parentId = null) {
  const clean = name ? String(name).trim().slice(0, 120) : '';
  if (!clean) return null;
  const existing = q.get(
    'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND ifnull(parent_id, 0) = ?',
    clean, parentId || 0,
  );
  if (existing) return existing.id;
  return Number(q.run('INSERT INTO categories(name, parent_id) VALUES (?, ?)', clean, parentId).lastInsertRowid);
}

export function categoryName(id) {
  return id ? q.value('SELECT name FROM categories WHERE id = ?', id) || null : null;
}
