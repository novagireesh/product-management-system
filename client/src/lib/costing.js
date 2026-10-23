// Browser side of costing: the very same engine the server uses, plus display helpers.
export { computeCosting, kindOf } from '../../../shared/costing-engine.js';

const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', AUD: 'A$', CAD: 'C$' };
export const currencySymbol = (code) => SYMBOLS[code] ?? (code ? `${code} ` : '');

/** Format a costing value according to its field (currency, percent or number with unit). */
export function fmtCostValue(field, value, defaultCurrency = 'USD') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (field.type === 'percent') return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (field.type === 'currency') {
    const code = field.currency || defaultCurrency;
    return `${currencySymbol(code)}${n.toLocaleString(code === 'INR' ? 'en-IN' : undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const digits = Math.abs(n) < 10 ? 4 : 2;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })}${field.unit ? ` ${field.unit}` : ''}`;
}

/** Suffix/prefix shown next to an input for a field. */
export function fieldAffix(field, defaultCurrency = 'USD') {
  if (field.type === 'percent') return { suffix: '%' };
  if (field.type === 'currency') return { prefix: currencySymbol(field.currency || defaultCurrency).trim() };
  return field.unit ? { suffix: field.unit } : {};
}

export function parseInputNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s₹$€£]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Group fields by group_name, keeping their order. */
export function groupFields(fields) {
  const groups = new Map();
  for (const f of fields) {
    const g = f.group_name || (f.kind === 'constraint' ? 'Constraints' : f.kind === 'formula' ? 'Calculation' : 'Inputs');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  return [...groups.entries()];
}

export const sameNumber = (a, b) => (a === null || a === undefined ? b === null || b === undefined : b !== null && b !== undefined && Math.abs(a - b) < 1e-9);
