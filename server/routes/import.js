import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { q } from '../db/index.js';
import { can, requirePerm } from '../lib/auth.js';
import { ah, badRequest, pageParams } from '../lib/http.js';
import { analyseImport, commitImport, previewImport, startImport } from '../services/importer.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImportMb * 1024 * 1024, files: 1 } });
const perms = (req) => ({ canEditCosting: can(req, 'costing.edit') });

router.use(requirePerm('products.import'));

router.post('/upload', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw badRequest('Choose an Excel file to upload');
  res.json(await startImport(req.file, perms(req)));
}));

router.get('/:token/preview', ah(async (req, res) => {
  res.json(await previewImport(req.params.token, req.query.sheet, perms(req)));
}));

router.post('/:token/analyse', ah(async (req, res) => {
  res.json(await analyseImport(req.params.token, req.body, perms(req)));
}));

router.post('/:token/commit', ah(async (req, res) => {
  res.json(await commitImport(req.params.token, req.body, req.user, perms(req)));
}));

router.get('/history', (req, res) => {
  const { pageSize, offset } = pageParams(req.query, { defaultSize: 20 });
  const items = q.all('SELECT * FROM import_history ORDER BY created_at DESC LIMIT ? OFFSET ?', pageSize, offset).map((r) => ({
    ...r,
    mapping: r.mapping ? JSON.parse(r.mapping) : null,
    errors: r.errors ? JSON.parse(r.errors) : [],
  }));
  res.json({ items, total: Number(q.value('SELECT COUNT(*) FROM import_history')) });
});

export default router;
