import { formatFieldValue as formatShared } from '../../shared/product-fields.js';
import { q } from '../db/index.js';

export const FIELD_TYPES = ['text', 'textarea', 'number', 'dimensions', 'select', 'boolean', 'date'];

// Core product columns, presented alongside custom fields wherever fields are listed.
export const CORE_FIELDS = [
  { key: 'sku', label: 'Product ID / SKU', core: true },
  { key: 'name', label: 'Product Name', core: true },
  { key: 'category', label: 'Category', core: true },
  { key: 'subcategory', label: 'Sub Category', core: true },
  { key: 'description', label: 'Description', core: true },
];

let cache = null;

export function fieldDefs({ includeInactive = false } = {}) {
  if (!cache) {
    cache = q.all('SELECT * FROM field_definitions ORDER BY sort_order, id').map((f) => ({
      ...f,
      options: f.options ? JSON.parse(f.options) : [],
      is_public: Boolean(f.is_public),
      is_filterable: Boolean(f.is_filterable),
      in_catalogue: Boolean(f.in_catalogue),
      active: Boolean(f.active),
      calc: f.calc || null,
    }));
  }
  return includeInactive ? cache : cache.filter((f) => f.active);
}

/** Fields users can enter values for (excludes system-calculated fields such as loadability). */
export const editableFieldDefs = (opts) => fieldDefs(opts).filter((f) => !f.calc);

export const fieldMap = () => new Map(fieldDefs({ includeInactive: true }).map((f) => [f.key, f]));
export const invalidateFields = () => {
  cache = null;
};

/** Normalise a raw value according to its field type. Returns string or null. */
export function normaliseFieldValue(field, raw) {
  if (raw === undefined || raw === null) return null;
  let v = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '') return null;
  switch (field?.type) {
    case 'number': {
      const n = parseNumber(v);
      // Round away floating-point noise from spreadsheets (0.19772800000000001 -> 0.197728).
      return n === null ? String(v) : String(Math.round(n * 1e6) / 1e6);
    }
    case 'boolean': {
      const s = String(v).toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(s)) return 'Yes';
      if (['0', 'false', 'no', 'n'].includes(s)) return 'No';
      return String(v);
    }
    case 'date': {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v);
    }
    default:
      return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 5000);
  }
}

/** Parse "1,234.50", "$ 12", "12.5 kg" etc. into a number; null if not numeric. */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s]/g, '').replace(/^[^\d\-.]+/, '').replace(/[^\d.]+$/, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Display text, e.g. "120 × 45 × 80 CM" or "92 pcs / container" (same formatter as the browser). */
export const formatFieldValue = formatShared;
