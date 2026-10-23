import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { paths } from '../config.js';
import { q, tx } from '../db/index.js';
import { badRequest } from '../lib/http.js';
import { record } from './history.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif', 'heif']);
const FULL_SIZE = 1600;
const THUMB_SIZE = 480;

sharp.cache(false);

/**
 * Validate an uploaded image by decoding it (not trusting the extension or MIME type),
 * then produce an optimised JPEG and a thumbnail.
 */
export async function optimise(buffer) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 120_000_000 }).metadata();
  } catch {
    throw badRequest('File is not a valid image');
  }
  if (!ALLOWED_FORMATS.has(meta.format)) throw badRequest(`Unsupported image format: ${meta.format}`);

  const base = sharp(buffer, { limitInputPixels: 120_000_000, animated: false }).rotate().flatten({ background: '#ffffff' });
  const full = await base
    .clone()
    .resize({ width: FULL_SIZE, height: FULL_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base
    .clone()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return { full: full.data, width: full.info.width, height: full.info.height, thumb };
}

export const imageUrl = (file) => (file ? `/media/products/${file}` : null);
export const imagePath = (file) => path.join(paths.productImages, file);

export function serialiseImage(img) {
  return {
    id: img.id,
    url: imageUrl(img.file),
    thumb_url: imageUrl(img.thumb),
    original_name: img.original_name,
    width: img.width,
    height: img.height,
    size_bytes: img.size_bytes,
    is_primary: Boolean(img.is_primary),
    sort_order: img.sort_order,
  };
}

/** Store processed images for a product. files: [{ buffer, originalname }] */
export async function addImages(productId, files, user, { source = 'upload' } = {}) {
  const dir = path.join(paths.productImages, String(productId));
  fs.mkdirSync(dir, { recursive: true });
  const processed = [];
  const errors = [];
  const duplicates = [];
  // Never attach the same picture twice to a product (identical file content).
  const known = new Set(q.all('SELECT hash FROM product_images WHERE product_id = ? AND hash IS NOT NULL', productId).map((r) => r.hash));
  for (const f of files) {
    const hash = crypto.createHash('sha256').update(f.buffer).digest('hex');
    if (known.has(hash)) {
      duplicates.push(f.originalname);
      continue;
    }
    try {
      const out = await optimise(f.buffer);
      const id = crypto.randomBytes(12).toString('hex');
      const file = `${productId}/${id}.jpg`;
      const thumb = `${productId}/${id}_t.jpg`;
      fs.writeFileSync(path.join(paths.productImages, file), out.full);
      fs.writeFileSync(path.join(paths.productImages, thumb), out.thumb);
      processed.push({ file, thumb, hash, name: f.originalname, width: out.width, height: out.height, size: out.full.length });
      known.add(hash);
    } catch (err) {
      errors.push({ file: f.originalname, error: err.message });
    }
  }
  if (processed.length) {
    tx(() => {
      let order = Number(q.value('SELECT ifnull(MAX(sort_order), -1) FROM product_images WHERE product_id = ?', productId)) + 1;
      const hasPrimary = q.value('SELECT COUNT(*) FROM product_images WHERE product_id = ? AND is_primary = 1', productId) > 0;
      processed.forEach((p, i) => {
        q.run(
          `INSERT INTO product_images(product_id, file, thumb, original_name, width, height, size_bytes, is_primary, sort_order, hash)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          productId, p.file, p.thumb, p.name?.slice(0, 200), p.width, p.height, p.size, !hasPrimary && i === 0, order++, p.hash,
        );
      });
      q.run(`UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, productId);
      record({
        user, productId, entity: 'image', action: 'image_added',
        summary: `${processed.length} image${processed.length > 1 ? 's' : ''} added (${source})`,
        changes: processed.map((p) => ({ field: 'image', label: 'Image', from: null, to: p.name })),
      });
    });
  }
  return { added: processed.length, errors, duplicates };
}

function unlinkQuiet(file) {
  try {
    fs.unlinkSync(imagePath(file));
  } catch { /* already gone */ }
}

export function deleteImage(productId, imageId, user) {
  const img = q.get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', imageId, productId);
  if (!img) return false;
  tx(() => {
    q.run('DELETE FROM product_images WHERE id = ?', imageId);
    if (img.is_primary) {
      q.run(
        `UPDATE product_images SET is_primary = 1
          WHERE id = (SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1)`,
        productId,
      );
    }
    record({ user, productId, entity: 'image', entityId: imageId, action: 'image_deleted', summary: `Image deleted (${img.original_name || img.id})` });
  });
  unlinkQuiet(img.file);
  unlinkQuiet(img.thumb);
  return true;
}

export async function replaceImage(productId, imageId, file, user) {
  const img = q.get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', imageId, productId);
  if (!img) return false;
  const out = await optimise(file.buffer);
  const id = crypto.randomBytes(12).toString('hex');
  const newFile = `${productId}/${id}.jpg`;
  const newThumb = `${productId}/${id}_t.jpg`;
  fs.mkdirSync(path.join(paths.productImages, String(productId)), { recursive: true });
  fs.writeFileSync(imagePath(newFile), out.full);
  fs.writeFileSync(imagePath(newThumb), out.thumb);
  tx(() => {
    q.run(
      'UPDATE product_images SET file=?, thumb=?, original_name=?, width=?, height=?, size_bytes=?, hash=? WHERE id=?',
      newFile, newThumb, file.originalname?.slice(0, 200), out.width, out.height, out.full.length,
      crypto.createHash('sha256').update(file.buffer).digest('hex'), imageId,
    );
    record({ user, productId, entity: 'image', entityId: imageId, action: 'image_replaced', summary: `Image replaced with ${file.originalname}` });
  });
  unlinkQuiet(img.file);
  unlinkQuiet(img.thumb);
  return true;
}

export function setPrimary(productId, imageId, user) {
  const img = q.get('SELECT id FROM product_images WHERE id = ? AND product_id = ?', imageId, productId);
  if (!img) return false;
  tx(() => {
    q.run('UPDATE product_images SET is_primary = (id = ?) WHERE product_id = ?', imageId, productId);
    record({ user, productId, entity: 'image', entityId: imageId, action: 'image_primary', summary: 'Primary image changed' });
  });
  return true;
}

export function reorderImages(productId, ids) {
  tx(() => {
    ids.forEach((id, i) => q.run('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?', i, id, productId));
  });
}

export function removeProductImageFiles(productId) {
  fs.rmSync(path.join(paths.productImages, String(productId)), { recursive: true, force: true });
}

/**
 * Order images of one product: the plain file name ("PRD-10025.jpg") first, then numbered
 * alternates ("PRD-10025.1.jpg", "PRD-10025_2.jpg", "PRD-10025 (3).png") in number order.
 */
export function compareImageNames(a, b) {
  const key = (name) => {
    const base = path.parse(name).name.trim();
    const m = base.match(/(?:[\s_\-.]+\(?(\d{1,3})\)?|\s*\((\d{1,3})\))$/);
    return m ? [1, Number(m[1] ?? m[2]), name.toLowerCase()] : [0, 0, name.toLowerCase()];
  };
  const ka = key(a);
  const kb = key(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

/** Match bulk-uploaded file names to SKUs: "PRD-10025.jpg", "PRD-10025_2.jpg", "PRD-10025 (3).png". */
export function matchFileToProduct(filename) {
  const base = path.parse(filename).name.trim();
  // Exact name first; then strip a separated numeric suffix ("_2", "-3", " (4)").
  const candidates = [base, base.replace(/(?:[\s_\-.]+\(?\d{1,3}\)?|\s*\(\d{1,3}\))$/, '')];
  for (const c of [...new Set(candidates)]) {
    if (!c) continue;
    const row =
      q.get('SELECT p.id, p.sku, p.name FROM products p WHERE p.sku = ?', c) ||
      q.get('SELECT p.id, p.sku, p.name FROM product_codes pc JOIN products p ON p.id = pc.product_id WHERE pc.code = ?', c);
    if (row) return row;
  }
  return null;
}
