/*
 * Automatic collections by product code (Buyers & collections › Auto-create by product code).
 *
 * A product's series is the number in front of the last three digits of its code:
 *   DF18001 → 18 ("Code 18"),  DF18070A → 18 (letter suffixes stay in their series),  DF6053 → 6 ("Code 6").
 * Only the product code (SKU, exactly as stored) is used — never the name or any other attribute.
 *
 * Each series has one collection, identified by collections.auto_key ('code:DF18'), so running the
 * process again updates the same collections: new products are added, products whose code moved to
 * another series are moved, and a product is never listed twice (collection_products primary key).
 */
import { q, tx, now } from '../db/index.js';
import { badRequest } from '../lib/http.js';
import { getSetting, setSettings } from '../lib/settings.js';
import { record } from './history.js';

export const DEFAULT_NAME_TEMPLATE = 'Code {series}';
const CODE_RE = /^([A-Za-z]+)(\d+)(\d{3})([A-Za-z]*)$/;
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** { prefix: 'DF', series: '18' } for 'DF18001', or null when the code does not follow the pattern. */
export function codeSeries(code) {
  const m = String(code ?? '').trim().match(CODE_RE);
  return m ? { prefix: m[1].toUpperCase(), series: m[2] } : null;
}

export function nameTemplate() {
  const t = getSetting('auto_collections')?.name_template;
  return typeof t === 'string' && t.includes('{series}') ? t : DEFAULT_NAME_TEMPLATE;
}

export function validateTemplate(template) {
  const t = String(template ?? '').trim();
  if (!t.includes('{series}')) throw badRequest('The name format must contain {series}, e.g. “Code {series}”');
  if (t.length > 60) throw badRequest('The name format is too long');
  return t;
}

/**
 * What the process would do, without changing anything: one entry per series with its name,
 * product codes and how many products would be added to / removed from the existing collection.
 */
export function planAutoCollections(template = nameTemplate()) {
  const groups = new Map();
  const unmatched = [];
  for (const p of q.all('SELECT id, sku FROM products')) {
    const s = codeSeries(p.sku);
    if (!s) {
      unmatched.push(p.sku);
      continue;
    }
    const key = `code:${s.prefix}${s.series}`;
    if (!groups.has(key)) groups.set(key, { key, prefix: s.prefix, series: s.series, pattern: `${s.prefix}${s.series}xxx`, products: [] });
    groups.get(key).products.push(p);
  }
  const prefixes = new Set([...groups.values()].map((g) => g.prefix));
  const existing = new Map(q.all('SELECT id, name, auto_key FROM collections WHERE auto_key IS NOT NULL').map((c) => [c.auto_key, c]));
  const members = (id) => new Set(q.all('SELECT product_id FROM collection_products WHERE collection_id = ?', id).map((r) => r.product_id));

  const list = [...groups.values()].sort((a, b) => a.prefix.localeCompare(b.prefix) || Number(a.series) - Number(b.series));
  for (const g of list) {
    g.products.sort((a, b) => natural(a.sku, b.sku));
    const base = template.replaceAll('{series}', g.series).replaceAll('{prefix}', g.prefix);
    // Two prefixes with the same series number (DF18…, AB18…) would otherwise share a name.
    g.name = (prefixes.size > 1 && !template.includes('{prefix}') ? `${g.prefix} ${base}` : base).slice(0, 150);
    const c = existing.get(g.key);
    g.collection_id = c?.id ?? null;
    g.current_name = c?.name ?? null;
    const have = c ? members(c.id) : new Set();
    const want = new Set(g.products.map((p) => p.id));
    g.added = g.products.filter((p) => !have.has(p.id)).length;
    g.removed = [...have].filter((id) => !want.has(id)).length;
  }
  const stale = [...existing.values()].filter((c) => !groups.has(c.auto_key)).map((c) => ({ id: c.id, name: c.name, key: c.auto_key }));
  return { template, groups: list, unmatched: unmatched.sort(natural), stale };
}

/** API shape of a plan (codes instead of internal product rows). */
export function serialisePlan(plan) {
  const collections = plan.groups.map((g) => ({
    key: g.key, name: g.name, pattern: g.pattern, prefix: g.prefix, series: g.series,
    collection_id: g.collection_id, exists: Boolean(g.collection_id), renamed: Boolean(g.current_name && g.current_name !== g.name),
    product_count: g.products.length, added: g.added, removed: g.removed, codes: g.products.map((p) => p.sku),
  }));
  return {
    template: plan.template,
    collections,
    unmatched: plan.unmatched,
    stale: plan.stale,
    up_to_date: !plan.stale.length && collections.every((c) => c.exists && !c.added && !c.removed && !c.renamed),
  };
}

/** Create or refresh every series collection. Returns the plan that was applied plus totals. */
export function applyAutoCollections(user, { template } = {}) {
  const t = template === undefined ? nameTemplate() : validateTemplate(template);
  return tx(() => {
    if (t !== nameTemplate()) setSettings({ auto_collections: { ...(getSetting('auto_collections') || {}), name_template: t } });
    const plan = planAutoCollections(t);
    const totals = { created: 0, updated: 0, deleted: 0, added: 0, removed: 0 };
    for (const g of plan.groups) {
      let id = g.collection_id;
      if (!id) {
        id = Number(q.run('INSERT INTO collections(name, created_by, auto_key) VALUES (?,?,?)', g.name, user?.id, g.key).lastInsertRowid);
        totals.created++;
      } else if (g.current_name !== g.name) {
        q.run('UPDATE collections SET name = ? WHERE id = ?', g.name, id);
      }
      const want = new Set(g.products.map((p) => p.id));
      for (const { product_id: pid } of q.all('SELECT product_id FROM collection_products WHERE collection_id = ?', id)) {
        if (!want.has(pid)) q.run('DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?', id, pid);
      }
      // Code order (DF18001, DF18002 … DF18070, DF18070A …); quantities and notes are kept.
      g.products.forEach((p, i) => {
        q.run(
          `INSERT INTO collection_products(collection_id, product_id, sort_order) VALUES (?,?,?)
           ON CONFLICT(collection_id, product_id) DO UPDATE SET sort_order = excluded.sort_order`,
          id, p.id, i,
        );
      });
      if (g.collection_id && (g.added || g.removed || g.current_name !== g.name)) totals.updated++;
      if (g.added || g.removed || !g.collection_id) q.run('UPDATE collections SET updated_at = ? WHERE id = ?', now(), id);
      g.collection_id = id;
      totals.added += g.added;
      totals.removed += g.removed;
    }
    // A series with no products left (codes changed or products deleted) loses its collection.
    for (const c of plan.stale) {
      q.run('DELETE FROM collections WHERE id = ?', c.id);
      totals.deleted++;
    }
    record({
      user, entity: 'collection', action: 'auto_collections_refreshed',
      summary: `Collections by product code refreshed: ${plan.groups.length} series, ${totals.created} created, ${totals.added} products added, ${totals.removed} removed${totals.deleted ? `, ${totals.deleted} empty collections deleted` : ''}`,
    });
    const after = serialisePlan(planAutoCollections(t));
    return { ...after, applied: serialisePlan(plan), totals };
  });
}
