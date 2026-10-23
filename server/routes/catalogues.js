import { Router } from 'express';
import { q, tx } from '../db/index.js';
import { can, requirePerm } from '../lib/auth.js';
import { ah, badRequest, pageParams } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import {
  FORMATS, LAYOUTS, TEMPLATES, catalogueFieldOptions, catalogueFile, deleteCatalogue, generateCatalogue, getCatalogue, listCatalogues, priceSources,
} from '../services/catalogue/index.js';
import { costingFields, setProductCosting } from '../services/costing.js';

const router = Router();

router.get('/options', requirePerm('catalogues.generate'), (req, res) => {
  res.json({
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t })),
    layouts: Object.keys(LAYOUTS),
    formats: FORMATS,
    fields: catalogueFieldOptions({ canViewCosting: can(req, 'costing.view') }),
    priceSources: can(req, 'costing.view') ? priceSources() : [],
    currency: getSetting('currency') || 'USD',
    canSavePrices: can(req, 'costing.edit'),
  });
});

/**
 * Explicitly save manually entered catalogue prices into the products' costing
 * (e.g. as the As Discussed Rate). Only done when the user asks for it.
 */
router.post('/save-prices', requirePerm('costing.edit'), (req, res) => {
  const field = costingFields().find((f) => f.key === (req.body.field || 'buyer_price') && f.kind === 'input' && f.type === 'currency');
  if (!field) throw badRequest('Choose a price field to save into');
  const entries = Object.entries(req.body.values || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  let saved = 0;
  tx(() => {
    for (const [id, v] of entries) {
      if (!q.get('SELECT 1 FROM products WHERE id = ?', Number(id))) continue;
      saved += setProductCosting(Number(id), { [field.key]: v }, req.user, { source: 'catalogue prices' });
    }
  });
  res.json({ saved, field: field.label });
});

router.post('/', requirePerm('catalogues.generate'), ah(async (req, res) => {
  res.status(201).json(await generateCatalogue(req.body, req.user, { canViewCosting: can(req, 'costing.view') }));
}));

router.get('/', requirePerm('catalogues.view', 'catalogues.generate'), (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 20 });
  res.json({ ...listCatalogues({ buyer: req.query.buyer, search: String(req.query.search || '').trim(), offset, pageSize }), page, pageSize });
});

router.get('/:id', requirePerm('catalogues.view', 'catalogues.generate'), (req, res) => {
  res.json(getCatalogue(Number(req.params.id)));
});

router.get('/:id/download/:format', requirePerm('catalogues.view', 'catalogues.generate'), (req, res) => {
  const file = catalogueFile(Number(req.params.id), req.params.format);
  res.setHeader('Content-Type', file.mime);
  const disposition = req.query.inline && req.params.format === 'pdf' ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${file.name}"`);
  res.sendFile(file.path);
});

router.delete('/:id', requirePerm('catalogues.generate'), (req, res) => {
  deleteCatalogue(Number(req.params.id), req.user);
  res.json({ ok: true });
});

export default router;
