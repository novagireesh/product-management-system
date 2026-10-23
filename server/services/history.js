import { q } from '../db/index.js';

/**
 * Record an entry in the product change history / activity log.
 * changes: [{ field, label, from, to }]
 */
export function record({ user, productId = null, entity, entityId = null, action, summary, changes = null }) {
  q.run(
    `INSERT INTO product_history(product_id, entity, entity_id, action, summary, changes, user_id, user_name)
     VALUES (?,?,?,?,?,?,?,?)`,
    productId, entity, entityId, action, summary,
    changes && changes.length ? JSON.stringify(changes) : null,
    user?.id ?? null, user?.name || user?.username || 'System',
  );
}

/** Field-by-field diff between two flat objects. labels maps key -> display label. */
export function diff(before, after, labels = {}) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    const norm = (v) => (v === null || v === undefined || v === '' ? null : String(v));
    if (norm(a) !== norm(b)) changes.push({ field: key, label: labels[key] || key, from: norm(a), to: norm(b) });
  }
  return changes;
}

/** Hide costing values from users who cannot view costing. */
export function redactHistory(rows, canViewCosting) {
  return rows.map((r) => {
    const changes = r.changes ? JSON.parse(r.changes) : null;
    if (r.entity === 'costing' && !canViewCosting && changes) {
      return { ...r, changes: changes.map((c) => ({ ...c, from: c.from === null ? null : '•••', to: c.to === null ? null : '•••' })) };
    }
    return { ...r, changes };
  });
}
