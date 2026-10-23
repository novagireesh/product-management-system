export const LABEL_PRESETS = {
  'a4-3x8': { label: 'A4 sheet · 3 × 8 (70 × 37 mm)', w: 70, h: 37, cols: 3, sheet: true },
  'a4-2x7': { label: 'A4 sheet · 2 × 7 (99 × 38 mm)', w: 99, h: 38, cols: 2, sheet: true },
  'a4-2x4': { label: 'A4 sheet · 2 × 4 (99 × 67 mm)', w: 99, h: 67, cols: 2, sheet: true },
  'a4-4x5': { label: 'A4 sheet · 4 × 5 square (48 × 48 mm)', w: 48, h: 48, cols: 4, sheet: true },
  'thermal-50x25': { label: 'Thermal roll · 50 × 25 mm', w: 50, h: 25, cols: 1, sheet: false },
  'thermal-100x50': { label: 'Thermal roll · 100 × 50 mm', w: 100, h: 50, cols: 1, sheet: false },
  'thermal-60x40': { label: 'Thermal roll · 60 × 40 mm', w: 60, h: 40, cols: 1, sheet: false },
  // 10 × 10 cm sticker: top half product image, bottom half chosen details + code.
  'sticker-100': { label: '10 × 10 cm sticker · image + details (one per page)', w: 100, h: 100, cols: 1, sheet: false, style: 'sticker' },
  'a4-sticker-100': { label: '10 × 10 cm sticker · image + details (A4, 2 × 2)', w: 100, h: 100, cols: 2, sheet: true, style: 'sticker' },
};

export const DEFAULT_LABEL = {
  preset: 'a4-3x8', code: 'qr', img: true, name: true, sku: true, company: false, copies: 1, outline: true,
  // Details shown on 10 × 10 cm stickers (product field keys, plus category).
  fields: ['dimensions', 'cbm', 'material', 'finish'],
};

export function labelQuery(opts, ids) {
  return new URLSearchParams({
    ids: ids.join(','),
    preset: opts.preset,
    code: opts.code,
    img: opts.img ? 1 : 0,
    name: opts.name ? 1 : 0,
    sku: opts.sku ? 1 : 0,
    company: opts.company ? 1 : 0,
    copies: opts.copies,
    outline: opts.outline ? 1 : 0,
    fields: (opts.fields || []).join(','),
  }).toString();
}
