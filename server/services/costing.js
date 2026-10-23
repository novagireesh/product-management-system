import { computeCosting as compute, formulaRefs, kindOf, validateFormula as validateEngine } from '../../shared/costing-engine.js';
import { q, tx, now } from '../db/index.js';
import { badRequest } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import { fieldDefs, parseNumber } from './fields.js';
import { record } from './history.js';

export const COSTING_TYPES = ['currency', 'number', 'percent'];
export { formulaRefs };

let cache = null;
export function costingFields({ includeInactive = false } = {}) {
  if (!cache) {
    cache = q.all('SELECT * FROM costing_fields ORDER BY sort_order, id').map((f) => ({
      ...f,
      kind: kindOf(f),
      active: Boolean(f.active),
      highlight: Boolean(f.highlight),
    }));
  }
  return includeInactive ? cache : cache.filter((f) => f.active);
}
export const invalidateCosting = () => {
  cache = null;
};

/** Shape sent to the browser (enough to recalculate locally with the shared engine). */
export const publicField = (f) => ({
  key: f.key, label: f.label, kind: f.kind, type: f.type, currency: f.currency, unit: f.unit, formula: f.formula,
  default_value: f.default_value, group_name: f.group_name, highlight: f.highlight, description: f.description,
});

/** Numeric product fields (e.g. cbm) that costing formulas may use. System-calculated fields are
 * left out: costing has its own loadability formula based on the container capacity constraint. */
export const contextKeys = () => fieldDefs().filter((f) => f.type === 'number' && !f.calc).map((f) => f.key);

/** Costing amounts that can be shown as a price (catalogues, scan page). */
export function priceSources() {
  return costingFields()
    .filter((f) => f.type === 'currency' && (f.highlight || f.key === 'buyer_price'))
    .map((f) => ({ key: f.key, label: f.label, currency: f.currency || getSetting('currency') || 'USD' }));
}

export function costingContext(productId) {
  const keys = new Set(contextKeys());
  const ctx = {};
  for (const r of q.all('SELECT field_key, value FROM product_specifications WHERE product_id = ?', productId)) {
    if (keys.has(r.field_key)) {
      const n = parseNumber(r.value);
      if (n !== null) ctx[r.field_key] = n;
    }
  }
  return ctx;
}

export const computeCosting = (inputs, fields = costingFields(), context = {}) => compute(fields, inputs, context);

/** Throws a 400 if a formula is invalid, refers to unknown fields or would create a cycle. */
export function validateFormula(key, formula, fields) {
  try {
    validateEngine(key, formula, fields, contextKeys());
  } catch (err) {
    throw badRequest(`Formula error: ${err.message}`);
  }
}

export function storedCosting(productId) {
  return Object.fromEntries(q.all('SELECT field_key, value FROM product_costing WHERE product_id = ?', productId).map((r) => [r.field_key, r.value]));
}

/** Everything needed to show and recalculate a product's costing. */
export function getProductCosting(productId) {
  const fields = costingFields();
  const rows = q.all(
    `SELECT pc.field_key, pc.value, pc.updated_at, u.name AS updated_by
       FROM product_costing pc LEFT JOIN users u ON u.id = pc.updated_by WHERE pc.product_id = ?`,
    productId,
  );
  const inputs = Object.fromEntries(rows.map((r) => [r.field_key, r.value]));
  const context = costingContext(productId);
  const values = compute(fields, inputs, context);
  const latest = rows.reduce((a, r) => (!a || r.updated_at > a.updated_at ? r : a), null);
  return {
    fields: fields.map((f) => ({ ...publicField(f), value: values[f.key] ?? null, overridden: f.kind === 'constraint' && inputs[f.key] !== undefined })),
    inputs,
    context,
    values,
    has_costing: fields.some((f) => f.kind === 'input' && inputs[f.key] !== undefined),
    currency: getSetting('currency') || 'USD',
    updated_at: latest?.updated_at || null,
    updated_by: latest?.updated_by || null,
  };
}

/**
 * Save input values and per-product constraint overrides. values: { key: number|string|null }.
 * null / '' removes the value (for a constraint: the product goes back to the default).
 */
export function setProductCosting(productId, values, user, { source = 'manual' } = {}) {
  const fields = costingFields().filter((f) => f.kind !== 'formula');
  const before = storedCosting(productId);
  const changes = [];
  tx(() => {
    for (const f of fields) {
      if (!(f.key in values)) continue;
      const raw = values[f.key];
      const n = raw === null || raw === '' || raw === undefined ? null : parseNumber(raw);
      if (raw !== null && raw !== '' && raw !== undefined && n === null) throw badRequest(`${f.label} must be a number`);
      const old = before[f.key] ?? null;
      if (n === old) continue;
      if (n === null) q.run('DELETE FROM product_costing WHERE product_id = ? AND field_key = ?', productId, f.key);
      else {
        q.run(
          `INSERT INTO product_costing(product_id, field_key, value, updated_at, updated_by) VALUES (?,?,?,?,?)
           ON CONFLICT(product_id, field_key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
          productId, f.key, n, now(), user?.id,
        );
      }
      const label = f.kind === 'constraint' ? `${f.label} (this product)` : f.label;
      changes.push({ field: f.key, label, from: old === null ? null : String(old), to: n === null ? null : String(n) });
    }
    if (changes.length) {
      record({ user, productId, entity: 'costing', action: 'costing_updated', summary: `Costing updated (${source})`, changes });
    }
  });
  return changes.length;
}

/** Change the default value of constraints for all products. values: { key: number } */
export function setConstraintDefaults(values, user) {
  const constraints = costingFields({ includeInactive: true }).filter((f) => f.kind === 'constraint');
  const changes = [];
  tx(() => {
    for (const f of constraints) {
      if (!(f.key in values)) continue;
      const n = parseNumber(values[f.key]);
      if (n === null) throw badRequest(`${f.label} must be a number`);
      if (n === f.default_value) continue;
      q.run('UPDATE costing_fields SET default_value = ? WHERE key = ?', n, f.key);
      changes.push({ field: f.key, label: f.label, from: f.default_value === null ? null : String(f.default_value), to: String(n) });
    }
    if (changes.length) {
      record({ user, entity: 'costing', action: 'constraints_updated', summary: `Costing constraints changed for all products: ${changes.map((c) => c.label).join(', ')}`, changes });
    }
  });
  invalidateCosting();
  return changes.length;
}
