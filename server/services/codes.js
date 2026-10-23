import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { q } from '../db/index.js';
import { getSetting, publicBaseUrl } from '../lib/settings.js';

export const BARCODE_TYPES = { code128: 'Code 128', code39: 'Code 39' };

/** URL a product's QR code points to. */
export const productUrl = (code) => `${publicBaseUrl()}/p/${encodeURIComponent(code)}`;

/** Make sure a product has a code registry entry. Called on every product create. */
export function ensureCode(productId, sku) {
  const existing = q.get('SELECT * FROM product_codes WHERE product_id = ?', productId);
  if (existing) return existing;
  let code = sku;
  // A code freed by an SKU change could clash with another product's original code.
  if (q.get('SELECT 1 FROM product_codes WHERE code = ?', code)) code = `${sku}-${productId}`;
  q.run(
    'INSERT INTO product_codes(product_id, code, barcode_type) VALUES (?,?,?)',
    productId, code, getSetting('barcode_type') || 'code128',
  );
  return q.get('SELECT * FROM product_codes WHERE product_id = ?', productId);
}

/** Point the code back at the product's current SKU (use after an SKU change; reprint labels). */
export function regenerateCode(productId) {
  const product = q.get('SELECT sku FROM products WHERE id = ?', productId);
  if (!product) return null;
  const clash = q.get('SELECT product_id FROM product_codes WHERE code = ? AND product_id <> ?', product.sku, productId);
  const code = clash ? `${product.sku}-${productId}` : product.sku;
  q.run(
    `UPDATE product_codes SET code = ?, barcode_type = ?, regenerated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE product_id = ?`,
    code, getSetting('barcode_type') || 'code128', productId,
  );
  return q.get('SELECT * FROM product_codes WHERE product_id = ?', productId);
}

/** Resolve a scanned value (code, SKU or full product URL) to a product id. */
export function resolveScan(value) {
  let v = String(value || '').trim();
  const m = v.match(/\/p\/([^/?#]+)/);
  if (m) v = decodeURIComponent(m[1]);
  if (!v) return null;
  const byCode = q.get('SELECT product_id FROM product_codes WHERE code = ?', v);
  if (byCode) return byCode.product_id;
  const bySku = q.get('SELECT id FROM products WHERE sku = ?', v);
  return bySku?.id ?? null;
}

const QR_OPTS = { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#111111', light: '#ffffff' } };

export const qrPng = (text, width = 600) => QRCode.toBuffer(text, { ...QR_OPTS, width, type: 'png' });
export const qrSvg = (text) => QRCode.toString(text, { ...QR_OPTS, type: 'svg' });

function barcodeOpts(text, type) {
  return {
    bcid: BARCODE_TYPES[type] ? type : 'code128',
    text: type === 'code39' ? String(text).toUpperCase() : String(text),
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    textsize: 9,
    paddingwidth: 6,
    paddingheight: 4,
    backgroundcolor: 'FFFFFF',
  };
}

export const barcodePng = (text, type = 'code128') => bwipjs.toBuffer(barcodeOpts(text, type));
export const barcodeSvg = (text, type = 'code128') => bwipjs.toSVG(barcodeOpts(text, type));
