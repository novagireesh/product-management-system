import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { paths } from '../../config.js';
import { q } from '../../db/index.js';
import { getSettings } from '../../lib/settings.js';
import { barcodePng, productUrl, qrPng } from '../codes.js';
import { computeCosting, costingContext, costingFields, priceSources, storedCosting } from '../costing.js';
import { fieldDefs, formatFieldValue } from '../fields.js';
import { imagePath } from '../images.js';
import { percentPrice } from '../../../shared/pricing.js';

export const TEMPLATES = {
  simple: {
    label: 'Simple',
    description: 'Large product image with basic product information.',
    layout: 'single',
    fields: ['dimensions', 'material', 'finish', 'cbm', 'loadability'],
  },
  premium: {
    label: 'Premium',
    description: 'Large image, image strip, detailed specifications and full company branding.',
    layout: 'single',
    fields: ['category', 'description', 'material', 'wood_type', 'finish', 'dimensions', 'weight', 'cbm', 'loadability', 'packing_details', 'moq'],
  },
  buyer: {
    label: 'Buyer Specific',
    description: 'Choose exactly which fields and layout a particular buyer sees.',
    layout: 'grid2',
    fields: ['description', 'material', 'finish', 'dimensions', 'cbm', 'loadability', 'packing_details'],
  },
};

export const LAYOUTS = { single: 1, grid2: 2, grid4: 4 };

/** Fields a catalogue can include, beyond the always-present SKU and name. */
export function catalogueFieldOptions({ canViewCosting }) {
  const opts = [
    { key: 'category', label: 'Category' },
    { key: 'subcategory', label: 'Sub Category' },
    { key: 'description', label: 'Description' },
    ...fieldDefs().map((f) => ({ key: f.key, label: f.label, is_public: f.is_public, type: f.type, unit: f.unit, calc: f.calc })),
  ];
  return opts;
}

// Costing amounts that can be shown as the catalogue price ("Use price from existing data").
export { priceSources };

const hex = (c, fallback = '1f3a5f') => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '') : fallback);

/** Mix a hex colour with white. amount 0..1 (1 = white). */
export function tint(hexColor, amount) {
  const n = parseInt(hexColor, 16);
  const mix = (v) => Math.round(v + (255 - v) * amount);
  return [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function money(value, currency, decimals = 2) {
  if (value === null || value === undefined) return '';
  return `${currency} ${Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Decimals shown for catalogue prices: none when a percentage price is rounded to whole numbers. */
export const priceDecimals = (price) => (price?.mode === 'percent' && price.rounding === 'whole' ? 0 : 2);

/**
 * Per-product price for this catalogue only (never written back to the product).
 * price: { mode: 'none' | 'existing' | 'percent' | 'manual', source, fallback, percent, rounding, label, currency,
 *          values: { productId: number } }
 */
function cataloguePriceResolver(price) {
  if (!price || price.mode === 'none') return () => null;
  if (price.mode === 'manual') {
    return (id) => {
      const v = price.values?.[id];
      return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    };
  }
  const fields = costingFields();
  const reference = (id) => {
    const values = computeCosting(storedCosting(id), fields, costingContext(id));
    return values[price.source] ?? (price.fallback ? values[price.fallback] : null) ?? null;
  };
  // Percentage increase: always applied to the product's own reference price, never stored.
  if (price.mode === 'percent') return (id) => percentPrice(reference(id), price.percent, price.rounding);
  return reference;
}

export async function loadCatalogueData(productIds, opts, { canViewCosting }) {
  const settings = getSettings();
  const defs = new Map(fieldDefs().map((f) => [f.key, f]));
  const labels = new Map(catalogueFieldOptions({ canViewCosting }).map((f) => [f.key, f.label.replace(' (from costing)', '')]));
  const selected = (opts.fields || []).filter((k) => labels.has(k));
  const priceOf = cataloguePriceResolver(opts.price);

  let logo = null;
  if (settings.company_logo) {
    const p = path.join(paths.branding, settings.company_logo);
    if (fs.existsSync(p)) {
      const meta = await sharp(p).metadata();
      logo = { path: p, width: meta.width, height: meta.height, buffer: fs.readFileSync(p) };
    }
  }

  const products = [];
  for (const id of productIds) {
    const p = q.get(
      `SELECT p.*, c.name AS category, sc.name AS subcategory, pc.code
         FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories sc ON sc.id = p.subcategory_id
         LEFT JOIN product_codes pc ON pc.product_id = p.id WHERE p.id = ?`,
      id,
    );
    if (!p) continue;
    const specs = Object.fromEntries(
      q.all('SELECT field_key, value FROM product_specifications WHERE product_id = ?', id).map((r) => [r.field_key, r.value]),
    );
    const images = q
      .all('SELECT file, thumb, width, height FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order, id', id)
      .map((img) => ({ path: imagePath(img.file), thumbPath: imagePath(img.thumb), width: img.width, height: img.height }))
      .filter((img) => fs.existsSync(img.path));

    const fields = [];
    let description = null;
    for (const key of selected) {
      let value = null;
      if (key === 'category') value = p.category;
      else if (key === 'subcategory') value = p.subcategory;
      else if (key === 'description') {
        description = p.description || null;
        continue;
      } else value = formatFieldValue(defs.get(key), specs[key]);
      if (value) fields.push({ key, label: labels.get(key), value: String(value) });
    }

    const code = p.code || p.sku;
    const priceValue = priceOf(id);
    products.push({
      price: priceValue === null ? null : {
        label: opts.price.label, value: Math.round(priceValue * 100) / 100, text: money(priceValue, opts.price.currency, priceDecimals(opts.price)),
      },
      id,
      sku: p.sku,
      code,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      description,
      fields,
      images,
      url: productUrl(code),
      qr: opts.code === 'qr' ? await qrPng(productUrl(code), 480) : null,
      barcode: opts.code === 'barcode' ? await barcodePng(code, settings.barcode_type) : null,
    });
  }

  const buyer = opts.buyer_id ? q.get('SELECT * FROM buyers WHERE id = ?', opts.buyer_id) : null;
  return {
    products,
    price: opts.price?.mode && opts.price.mode !== 'none' ? { label: opts.price.label, currency: opts.price.currency, decimals: priceDecimals(opts.price) } : null,
    selectedFields: selected,
    fieldLabels: labels,
    logo,
    buyer,
    brand: hex(settings.brand_color),
    company: {
      name: settings.company_name || '',
      tagline: settings.company_tagline || '',
      email: settings.company_email || '',
      phone: settings.company_phone || '',
      website: settings.company_website || '',
      address: settings.company_address || '',
      footer: settings.catalogue_footer || '',
    },
    generatedAt: new Date(),
  };
}

/**
 * Resize images to what the layout actually needs so catalogues stay small enough
 * for email / WhatsApp. Adds p.main = { buffer, width, height } and p.extras = [...].
 */
export async function prepareImages(data, { layout, extras = false }) {
  const max = layout === 'grid4' ? 700 : layout === 'grid2' ? 1000 : 1300;
  const resize = async (file, size) => {
    const { data: buffer, info } = await sharp(file)
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer, width: info.width, height: info.height };
  };
  for (const p of data.products) {
    p.main = p.images[0] ? await resize(p.images[0].path, max) : null;
    p.extras = [];
    if (extras) for (const img of p.images.slice(1, 5)) p.extras.push(await resize(img.thumbPath, 360));
  }
}

export const contactLine = (c) => [c.website, c.email, c.phone].filter(Boolean).join('   ·   ');

/** Fit (w,h) inside (bw,bh) keeping aspect ratio. */
export function fit(w, h, bw, bh) {
  if (!w || !h) return { w: bw, h: bh, dx: 0, dy: 0 };
  const s = Math.min(bw / w, bh / h);
  const fw = w * s;
  const fh = h * s;
  return { w: fw, h: fh, dx: (bw - fw) / 2, dy: (bh - fh) / 2 };
}

export const formatDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
