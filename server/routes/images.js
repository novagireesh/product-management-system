import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { q } from '../db/index.js';
import { requirePerm } from '../lib/auth.js';
import { ah, badRequest } from '../lib/http.js';
import { addImages, compareImageNames, matchFileToProduct } from '../services/images.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 200 } });

router.get('/stats', requirePerm('products.view'), (req, res) => {
  res.json({
    total: Number(q.value('SELECT COUNT(*) FROM product_images')),
    bytes: Number(q.value('SELECT ifnull(SUM(size_bytes), 0) FROM product_images')),
    withImages: Number(q.value('SELECT COUNT(DISTINCT product_id) FROM product_images')),
    withoutImages: Number(q.value('SELECT COUNT(*) FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)')),
  });
});

/** Check which product each file name would be attached to, without uploading. */
router.post('/match', requirePerm('images.manage'), (req, res) => {
  const names = Array.isArray(req.body.names) ? req.body.names.slice(0, 1000) : [];
  res.json(names.map((name) => ({ name, product: matchFileToProduct(String(name)) })));
});

/** Bulk upload: each file is attached to the product whose SKU matches its file name. */
router.post('/bulk', requirePerm('images.manage'), upload.array('images', 200), ah(async (req, res) => {
  if (!req.files?.length) throw badRequest('Choose images to upload');
  const groups = new Map();
  const unmatched = [];
  for (const f of req.files) {
    const product = matchFileToProduct(f.originalname);
    if (!product) {
      unmatched.push(f.originalname);
      continue;
    }
    if (!groups.has(product.id)) groups.set(product.id, { product, files: [] });
    groups.get(product.id).files.push(f);
  }
  const results = [];
  let added = 0;
  const errors = [];
  const duplicates = [];
  for (const { product, files } of groups.values()) {
    files.sort((a, b) => compareImageNames(a.originalname, b.originalname));
    const r = await addImages(product.id, files, req.user, { source: 'bulk upload' });
    added += r.added;
    errors.push(...r.errors);
    duplicates.push(...r.duplicates);
    results.push({ product, added: r.added });
  }
  res.json({ added, products: results, unmatched, errors, duplicates });
}));

export default router;
