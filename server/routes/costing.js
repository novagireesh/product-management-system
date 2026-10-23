import { Router } from 'express';
import { FIELD_KINDS } from '../../shared/costing-engine.js';
import { q, tx } from '../db/index.js';
import { requirePerm } from '../lib/auth.js';
import { ah, badRequest, notFound, pageParams, slugKey, str } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import {
  COSTING_TYPES, computeCosting, contextKeys, costingContext, costingFields, invalidateCosting, publicField,
  setConstraintDefaults, setProductCosting, validateFormula,
} from '../services/costing.js';
import { exportCosting } from '../services/exporter.js';
import { record } from '../services/history.js';
import { listProducts } from '../services/products.js';
import { parseNumber } from '../services/fields.js';

const router = Router();

router.get('/fields', requirePerm('costing.view', 'settings.manage'), (req, res) => {
  res.json({
    fields: costingFields({ includeInactive: true }).map((f) => ({ ...publicField(f), active: f.active, sort_order: f.sort_order })),
    currency: getSetting('currency'),
    contextKeys: contextKeys(),
  });
});

/** Products with their stored costing values, context and calculated results (paged, filterable). */
router.get('/', requirePerm('costing.view'), (req, res) => {
  const { page, pageSize } = pageParams(req.query, { defaultSize: 50, maxSize: 500 });
  const data = listProducts(req.query, { canViewCosting: true, page, pageSize });
  const ids = data.items.map((p) => p.id);
  const inputs = new Map(ids.map((i) => [i, {}]));
  if (ids.length) {
    for (const r of q.all(`SELECT product_id, field_key, value FROM product_costing WHERE product_id IN (${ids.map(() => '?').join(',')})`, ...ids)) {
      inputs.get(r.product_id)[r.field_key] = r.value;
    }
  }
  const fields = costingFields();
  res.json({
    ...data,
    fields: fields.map(publicField),
    currency: getSetting('currency'),
    items: data.items.map((p) => {
      const context = costingContext(p.id);
      return {
        id: p.id, sku: p.sku, name: p.name, thumb_url: p.thumb_url, category: p.category, has_costing: p.has_costing,
        inputs: inputs.get(p.id), context, values: computeCosting(inputs.get(p.id), fields, context),
      };
    }),
  });
});

router.get('/export.xlsx', requirePerm('costing.view'), ah(async (req, res) => {
  const buffer = await exportCosting(req.query);
  record({ user: req.user, entity: 'costing', action: 'costing_exported', summary: 'Costing exported to Excel' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="costing-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

/** Save several products' costing at once (spreadsheet-style editing). */
router.put('/bulk', requirePerm('costing.edit'), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 1000) : [];
  let changed = 0;
  tx(() => {
    for (const r of rows) {
      const pid = Number(r.product_id);
      if (!q.get('SELECT 1 FROM products WHERE id = ?', pid)) continue;
      changed += setProductCosting(pid, r.values || {}, req.user, { source: 'costing sheet' });
    }
  });
  res.json({ changed });
});

/** Change constraint defaults (e.g. USD rate) for every product that has no override. */
router.put('/constraints', requirePerm('costing.constraints'), (req, res) => {
  const values = req.body?.values;
  if (!values || typeof values !== 'object') throw badRequest('values are required');
  const changed = setConstraintDefaults(values, req.user);
  res.json({ changed, fields: costingFields({ includeInactive: true }).map(publicField) });
});

// --- costing structure (configurable fields) -------------------------------------
function fieldInput(body, existing) {
  const label = str(body.label, 'Label', { required: true, max: 80 });
  const type = COSTING_TYPES.includes(body.type) ? body.type : 'currency';
  const formula = str(body.formula, 'Formula', { max: 500 });
  let kind = FIELD_KINDS.includes(body.kind) ? body.kind : existing?.kind || 'input';
  if (formula) kind = 'formula';
  else if (kind === 'formula') throw badRequest('A calculated field needs a formula');
  const defaultValue = kind === 'constraint' ? parseNumber(body.default_value) : null;
  if (kind === 'constraint' && defaultValue === null) throw badRequest('A constraint needs a default value');
  const currency = str(body.currency, 'Currency', { max: 10 })?.toUpperCase() || null;
  return {
    key: existing?.key || slugKey(str(body.key, 'Key', { max: 48 }) || label),
    label, type, kind, formula: kind === 'formula' ? formula : null, default_value: defaultValue,
    currency: type === 'currency' ? currency : null,
    unit: str(body.unit, 'Unit', { max: 20 }),
    group_name: str(body.group_name, 'Group', { max: 40 }),
    highlight: Boolean(body.highlight),
    description: str(body.description, 'Description', { max: 200 }),
  };
}

router.post('/fields', requirePerm('settings.manage'), (req, res) => {
  const f = fieldInput(req.body);
  const all = costingFields({ includeInactive: true });
  if (all.some((x) => x.key === f.key) || contextKeys().includes(f.key)) throw badRequest(`The key "${f.key}" is already in use`);
  if (f.formula) validateFormula(f.key, f.formula, [...all, { key: f.key }]);
  const order = Number(q.value('SELECT ifnull(MAX(sort_order), 0) FROM costing_fields')) + 10;
  q.run(
    `INSERT INTO costing_fields(key, label, type, kind, formula, default_value, currency, unit, group_name, highlight, description, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    f.key, f.label, f.type, f.kind, f.formula, f.default_value, f.currency, f.unit, f.group_name, f.highlight, f.description, order,
  );
  invalidateCosting();
  record({ user: req.user, entity: 'settings', action: 'costing_field_added', summary: `Costing field "${f.label}" added` });
  res.status(201).json(costingFields({ includeInactive: true }).map(publicField));
});

router.put('/fields/order', requirePerm('settings.manage'), (req, res) => {
  const keys = Array.isArray(req.body.keys) ? req.body.keys : [];
  tx(() => keys.forEach((k, i) => q.run('UPDATE costing_fields SET sort_order = ? WHERE key = ?', (i + 1) * 10, k)));
  invalidateCosting();
  res.json(costingFields({ includeInactive: true }).map(publicField));
});

router.put('/fields/:key', requirePerm('settings.manage'), (req, res) => {
  const current = costingFields({ includeInactive: true }).find((f) => f.key === req.params.key);
  if (!current) throw notFound('Costing field not found');
  const f = fieldInput(req.body, current);
  if (f.formula) validateFormula(f.key, f.formula, costingFields({ includeInactive: true }));
  q.run(
    `UPDATE costing_fields SET label=?, type=?, kind=?, formula=?, default_value=?, currency=?, unit=?, group_name=?, highlight=?, description=?, active=?
      WHERE key = ?`,
    f.label, f.type, f.kind, f.formula, f.default_value, f.currency, f.unit, f.group_name, f.highlight, f.description, req.body.active === false ? 0 : 1, f.key,
  );
  invalidateCosting();
  record({ user: req.user, entity: 'settings', action: 'costing_field_updated', summary: `Costing field "${f.label}" updated` });
  res.json(costingFields({ includeInactive: true }).map(publicField));
});

router.delete('/fields/:key', requirePerm('settings.manage'), (req, res) => {
  const current = q.get('SELECT * FROM costing_fields WHERE key = ?', req.params.key);
  if (!current) throw notFound('Costing field not found');
  const dependants = costingFields({ includeInactive: true }).filter((f) => f.formula && new RegExp(`\\b${current.key}\\b`).test(f.formula));
  if (dependants.length) throw badRequest(`Used in the formula of: ${dependants.map((d) => d.label).join(', ')}`);
  tx(() => {
    q.run('DELETE FROM costing_fields WHERE key = ?', current.key);
    q.run('DELETE FROM product_costing WHERE field_key = ?', current.key);
  });
  invalidateCosting();
  record({ user: req.user, entity: 'settings', action: 'costing_field_deleted', summary: `Costing field "${current.label}" deleted` });
  res.json(costingFields({ includeInactive: true }).map(publicField));
});

export default router;
