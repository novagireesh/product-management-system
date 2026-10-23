/*
 * What the public QR-code scan page shows (Settings › QR scan page).
 * Product fields are switched on and off with their own "scan page" flag (field_definitions.is_public);
 * this setting covers everything else on the page.
 */

export const SCAN_PAGE_ITEMS = [
  { key: 'images', label: 'Product images', hint: 'Photo gallery at the top of the page' },
  { key: 'code', label: 'Product code', hint: 'e.g. DF20001' },
  { key: 'name', label: 'Product name' },
  { key: 'category', label: 'Category & sub category' },
  { key: 'description', label: 'Product description' },
  { key: 'contact', label: 'WhatsApp & email enquiry buttons', hint: 'Shown when a WhatsApp number or email is set in company details' },
  { key: 'costing_button', label: '“View costing” button', hint: 'Costing always needs a PIN or staff sign-in' },
];

export const DEFAULT_SCAN_PAGE = {
  show: Object.fromEntries(SCAN_PAGE_ITEMS.map((i) => [i.key, true])),
  // Price shown to anyone who scans: off unless switched on. source/fallback are costing field keys.
  price: { enabled: false, source: 'buyer_price', fallback: 'price_usd', label: 'Price' },
};

/** Stored setting merged with the defaults (new items are shown until switched off). */
export function normaliseScanPage(value) {
  const show = { ...DEFAULT_SCAN_PAGE.show };
  for (const i of SCAN_PAGE_ITEMS) if (typeof value?.show?.[i.key] === 'boolean') show[i.key] = value.show[i.key];
  const p = value?.price || {};
  const d = DEFAULT_SCAN_PAGE.price;
  return {
    show,
    price: {
      enabled: Boolean(p.enabled),
      source: typeof p.source === 'string' && p.source ? p.source : d.source,
      fallback: typeof p.fallback === 'string' ? p.fallback : d.fallback,
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 40) : d.label,
    },
  };
}
