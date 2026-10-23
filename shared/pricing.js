/*
 * Catalogue price calculations shared by the server (generated catalogue) and the browser (preview),
 * so the prices shown before generating are exactly the prices in the catalogue.
 *
 * Percentage increase: final = reference × (1 + percent / 100), always from the product's own
 * reference price (never from a previously adjusted price), e.g. 1,250 + 5% = 1,312.50 → 1,313.
 */

export const PRICE_ROUNDING = [
  { value: 'whole', label: 'Nearest whole number (1,312.50 → 1,313)' },
  { value: 'none', label: 'No rounding (2 decimals)' },
];

export const PERCENT_LIMITS = { min: -99, max: 1000 };

/** Final price from a reference price and a percentage, or null when either is missing. */
export function percentPrice(reference, percent, rounding = 'whole') {
  if (reference === null || reference === undefined || reference === '') return null;
  const ref = Number(reference);
  const pct = Number(percent);
  if (!Number.isFinite(ref) || !Number.isFinite(pct)) return null;
  // ref × (100 + pct) / 100 keeps whole-number cases exact (1250 × 105 / 100 = 1312.5).
  const raw = (ref * (100 + pct)) / 100;
  if (rounding === 'whole') return Math.round(raw);
  return Math.round((raw + Number.EPSILON) * 100) / 100;
}

/** "+5%" / "−10%" for labels. */
export const percentLabel = (percent) => {
  const n = Number(percent);
  if (!Number.isFinite(n)) return '';
  return `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
};
