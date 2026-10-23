/*
 * Product field display and system calculations, shared by the server and the browser so that
 * product pages, scan pages, labels and catalogues always show the same values.
 *
 * System calculation rules (configured in Settings › Calculation rules):
 *   Loadability = units_per_cbm ÷ CBM     (65 units per 1 CBM → a 0.705 CBM product loads 92 pcs)
 *   CBM         = Σ L × W × H of the packing boxes, converted to m³ (used when CBM is left blank)
 */

export const DEFAULT_CALC_RULES = {
  loadability: { units_per_cbm: 65, rounding: 'down' },
  cbm: { auto: true, source: 'packing_size' },
};

export const LOADABILITY_ROUNDING = [
  { value: 'down', label: 'Whole pieces, rounded down (recommended)' },
  { value: 'nearest', label: 'Whole pieces, rounded to nearest' },
  { value: 'exact', label: 'Exact, 2 decimals (as in the Excel sheet)' },
];

/** Fill in missing or invalid parts of stored rules with the defaults. */
export function normaliseCalcRules(rules) {
  const l = rules?.loadability || {};
  const c = rules?.cbm || {};
  const per = Number(l.units_per_cbm);
  return {
    loadability: {
      units_per_cbm: Number.isFinite(per) && per > 0 ? per : DEFAULT_CALC_RULES.loadability.units_per_cbm,
      rounding: LOADABILITY_ROUNDING.some((r) => r.value === l.rounding) ? l.rounding : DEFAULT_CALC_RULES.loadability.rounding,
    },
    cbm: {
      auto: c.auto === undefined ? DEFAULT_CALC_RULES.cbm.auto : Boolean(c.auto),
      source: typeof c.source === 'string' && c.source ? c.source : DEFAULT_CALC_RULES.cbm.source,
    },
  };
}

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Units of one product that fit in a container, or null when CBM is missing. */
export function calcLoadability(cbm, rule = DEFAULT_CALC_RULES.loadability) {
  const n = toNumber(cbm);
  const per = toNumber(rule?.units_per_cbm);
  if (!(n > 0) || !(per > 0)) return null;
  const raw = per / n;
  if (rule.rounding === 'exact') return Math.round(raw * 100) / 100;
  if (rule.rounding === 'nearest') return Math.round(raw);
  return Math.floor(raw + 1e-9); // tolerance so 65 / 0.05 is 1300, not 1299
}

// "120X45X80", "120 x 45 x 80", "120×45×80 cm", "120*45"; several sets separated by commas or spaces.
const SET_RE = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?/gi;

/** Number sets in a dimensions value: "140X40X8, 59X32X81" → [[140, 40, 8], [59, 32, 81]]. */
export function parseDimensionSets(value) {
  return [...String(value ?? '').matchAll(SET_RE)].map((m) => m.slice(1).filter(Boolean).map(Number));
}

const UNIT_ALIASES = {
  cm: ['cm', 'cms', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
  mm: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'],
  m: ['m', 'mtr', 'meter', 'meters', 'metre', 'metres'],
  inch: ['inch', 'inches', 'in', '"', '″'],
  ft: ['ft', 'feet', 'foot', "'"],
};
const unitKey = (unit) => {
  const u = String(unit || '').trim().toLowerCase();
  return Object.keys(UNIT_ALIASES).find((k) => UNIT_ALIASES[k].includes(u)) || null;
};
// m³ per cubic unit
const VOLUME_FACTOR = { cm: 1e-6, mm: 1e-9, m: 1, inch: 1.6387064e-5, ft: 0.028316846592 };

/** Total volume in m³ of all L × W × H sets (e.g. the boxes of a packing size). Null if none. */
export function cbmFromDimensions(value, unit = 'cm') {
  const sets = parseDimensionSets(value).filter((s) => s.length === 3);
  if (!sets.length) return null;
  const total = sets.reduce((sum, [l, w, h]) => sum + l * w * h, 0) * (VOLUME_FACTOR[unitKey(unit)] ?? VOLUME_FACTOR.cm);
  return Math.round(total * 1e6) / 1e6;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "160X40X90" → "160 × 40 × 90 CM"; "125X45X23, 85X45X23" → "125 × 45 × 23, 85 × 45 × 23 CM".
 * A unit already typed in the value is not repeated. Values without number sets get the unit appended.
 */
export function formatDimensions(value, unit) {
  let s = String(value ?? '').trim();
  if (!s) return '';
  const u = String(unit || '').trim();
  if (u) {
    const aliases = UNIT_ALIASES[unitKey(u)] || [u.toLowerCase()];
    const words = aliases.filter((a) => /^[a-z]+$/i.test(a)).map(escapeRe);
    if (words.length) s = s.replace(new RegExp(`(\\d)\\s*(?:${words.join('|')})\\b\\.?`, 'gi'), '$1');
  }
  s = s.replace(SET_RE, (_, a, b, c) => [a, b, c].filter(Boolean).join(' × '));
  s = s.replace(/(\d)\s+(?=\d+(?:\.\d+)? × )/g, '$1, '); // "55 35 × 35" → "55, 35 × 35"
  s = s.replace(/\s*,\s*/g, ', ').replace(/\s{2,}/g, ' ').trim();
  return u && /\d/.test(s) ? `${s} ${u}` : s;
}

/** Display text of a product field value (adds units, formats dimensions). */
export function formatFieldValue(field, value) {
  if (value === null || value === undefined || value === '') return '';
  if (field?.type === 'dimensions') return formatDimensions(value, field.unit);
  if (field?.type === 'number' && field.unit) return `${value} ${field.unit}`;
  return String(value);
}

/** Fields whose value is calculated by the system (read-only on forms and imports). */
export const isCalculatedField = (field) => Boolean(field?.calc);
