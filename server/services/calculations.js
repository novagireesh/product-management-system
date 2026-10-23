/*
 * System calculation rules for product fields (Settings › Calculation rules).
 *
 *  - CBM: when left blank it is calculated from the packing size (sum of L × W × H of all boxes).
 *    A CBM that was calculated keeps following the packing size; a CBM typed by a user is kept.
 *  - Loadability (and any future field with `calc` set): stored like other field values so lists,
 *    sorting, search, exports, catalogues and the scan page all read the same number, and
 *    recalculated whenever the product's values or the rule change.
 */
import { calcLoadability, cbmFromDimensions, normaliseCalcRules } from '../../shared/product-fields.js';
import { q } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { fieldMap, normaliseFieldValue, parseNumber } from './fields.js';

export const calcRules = () => normaliseCalcRules(getSetting('calc_rules'));

/** calc name → (specs, rules) => value | null. Add new system calculations here. */
const CALCULATIONS = {
  loadability: (specs, rules) => calcLoadability(parseNumber(specs.cbm), rules.loadability),
};
export const CALCULATION_NAMES = Object.keys(CALCULATIONS);

const sameNumber = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-6;

/**
 * Apply the CBM rule to incoming spec values before they are saved.
 * Returns a copy of `specs` with `cbm` filled in when the rule applies.
 */
export function applyCbmRule(specs, before = {}, rules = calcRules()) {
  if (!specs || !rules.cbm.auto) return specs;
  const fields = fieldMap();
  const src = fields.get(rules.cbm.source);
  const cbmField = fields.get('cbm');
  if (!src || !cbmField || src.calc || cbmField.calc) return specs;
  const norm = (f, v) => normaliseFieldValue(f, v) ?? null;
  const srcBefore = before[src.key] ?? null;
  const srcAfter = src.key in specs ? norm(src, specs[src.key]) : srcBefore;
  const cbmBefore = before.cbm ?? null;
  const cbmAfter = 'cbm' in specs ? norm(cbmField, specs.cbm) : cbmBefore;
  // CBM untouched while the packing size changes, and it matched the old packing size: it follows.
  const followsSource = cbmAfter !== null && cbmAfter === cbmBefore && srcAfter !== srcBefore &&
    sameNumber(parseNumber(cbmBefore), cbmFromDimensions(srcBefore, src.unit));
  if (cbmAfter !== null && !followsSource) return specs;
  const cbm = cbmFromDimensions(srcAfter, src.unit);
  return cbm === null ? specs : { ...specs, cbm: String(cbm) };
}

/** Fill a blank CBM from the packing size (rule switched on, packing size readable). Returns true if filled. */
export function fillBlankCbm(productId, rules = calcRules()) {
  if (!rules.cbm.auto) return false;
  const fields = fieldMap();
  const src = fields.get(rules.cbm.source);
  if (!src || !fields.has('cbm')) return false;
  const has = q.value(`SELECT value FROM product_specifications WHERE product_id = ? AND field_key = 'cbm'`, productId);
  if (has !== undefined && has !== null && has !== '') return false;
  const cbm = cbmFromDimensions(q.value('SELECT value FROM product_specifications WHERE product_id = ? AND field_key = ?', productId, src.key), src.unit);
  if (cbm === null) return false;
  q.run(
    `INSERT INTO product_specifications(product_id, field_key, value) VALUES (?, 'cbm', ?)
     ON CONFLICT(product_id, field_key) DO UPDATE SET value = excluded.value`,
    productId, String(cbm),
  );
  return true;
}

/**
 * Recalculate the system-calculated values of one product from its saved values.
 * Run inside the caller's transaction. Returns history-style changes.
 */
export function syncCalculated(productId, rules = calcRules()) {
  const calcFields = [...fieldMap().values()].filter((f) => f.calc && CALCULATIONS[f.calc]);
  if (!calcFields.length) return [];
  const specs = Object.fromEntries(
    q.all('SELECT field_key, value FROM product_specifications WHERE product_id = ?', productId).map((r) => [r.field_key, r.value]),
  );
  const changes = [];
  for (const f of calcFields) {
    const v = CALCULATIONS[f.calc](specs, rules);
    const value = v === null || v === undefined || !Number.isFinite(Number(v)) ? null : String(v);
    const old = specs[f.key] ?? null;
    if (value === old) continue;
    if (value === null) q.run('DELETE FROM product_specifications WHERE product_id = ? AND field_key = ?', productId, f.key);
    else {
      q.run(
        `INSERT INTO product_specifications(product_id, field_key, value) VALUES (?,?,?)
         ON CONFLICT(product_id, field_key) DO UPDATE SET value = excluded.value`,
        productId, f.key, value,
      );
    }
    changes.push({ field: f.key, label: f.label, from: old, to: value });
  }
  return changes;
}
