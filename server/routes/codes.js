import { Router } from 'express';
import { ZipArchive } from 'archiver';
import { q } from '../db/index.js';
import { requirePerm } from '../lib/auth.js';
import { ah, badRequest, idList, notFound } from '../lib/http.js';
import { publicBaseUrl } from '../lib/settings.js';
import { BARCODE_TYPES, barcodePng, barcodeSvg, productUrl, qrPng, qrSvg } from '../services/codes.js';
import { record } from '../services/history.js';

const router = Router();

function codeFor(productId) {
  const row = q.get(
    'SELECT pc.code, pc.barcode_type, p.sku FROM product_codes pc JOIN products p ON p.id = pc.product_id WHERE pc.product_id = ?',
    productId,
  );
  if (!row) throw notFound('Product not found');
  return row;
}

const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');

async function render(kind, format, row, size) {
  if (kind === 'qr') return format === 'svg' ? qrSvg(productUrl(row.code)) : qrPng(productUrl(row.code), size);
  return format === 'svg' ? barcodeSvg(row.code, row.barcode_type) : barcodePng(row.code, row.barcode_type);
}

router.get('/info', requirePerm('products.view'), (req, res) => {
  res.json({ baseUrl: publicBaseUrl(), barcodeTypes: BARCODE_TYPES });
});

// GET /api/codes/:productId/qr.png  |  qr.svg  |  barcode.png  |  barcode.svg
router.get('/:productId/:kind.:format', requirePerm('products.view'), ah(async (req, res) => {
  const { kind, format } = req.params;
  if (!['qr', 'barcode'].includes(kind) || !['png', 'svg'].includes(format)) throw notFound();
  const row = codeFor(Number(req.params.productId));
  const size = Math.min(2000, Math.max(120, Number(req.query.size) || 600));
  const out = await render(kind, format, row, size);
  res.setHeader('Content-Type', format === 'svg' ? 'image/svg+xml' : 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${safeName(row.sku)}-${kind}.${format}"`);
  res.send(out);
}));

/** ZIP of QR codes and/or barcodes for many products. */
router.post('/zip', requirePerm('codes.manage'), ah(async (req, res) => {
  const ids = idList(req.body.ids, 2000);
  if (!ids.length) throw badRequest('Select at least one product');
  const kinds = (Array.isArray(req.body.kinds) ? req.body.kinds : ['qr']).filter((k) => ['qr', 'barcode'].includes(k));
  const format = req.body.format === 'svg' ? 'svg' : 'png';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="product-codes-${new Date().toISOString().slice(0, 10)}.zip"`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err) => res.destroy(err));
  zip.pipe(res);
  for (const pid of ids) {
    const row = q.get('SELECT pc.code, pc.barcode_type, p.sku FROM product_codes pc JOIN products p ON p.id = pc.product_id WHERE pc.product_id = ?', pid);
    if (!row) continue;
    for (const kind of kinds) zip.append(await render(kind, format, row, 800), { name: `${safeName(row.sku)}-${kind}.${format}` });
  }
  record({ user: req.user, entity: 'code', action: 'codes_downloaded', summary: `Downloaded ${kinds.join(' & ')} codes for ${ids.length} products` });
  await zip.finalize();
}));

router.post('/printed', requirePerm('codes.manage'), (req, res) => {
  const ids = idList(req.body.ids, 2000);
  record({ user: req.user, entity: 'code', action: 'labels_printed', summary: `Printed labels for ${ids.length} products` });
  res.json({ ok: true });
});

export default router;
