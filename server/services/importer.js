import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { paths } from '../config.js';
import { q, tx } from '../db/index.js';
import { badRequest, notFound, slugKey } from '../lib/http.js';
import { computeCosting, costingContext, costingFields, setProductCosting, storedCosting } from './costing.js';
import { costingSheets, masterSheetName, parseCostingSheet } from './costingWorkbook.js';
import { editableFieldDefs, fieldDefs, invalidateFields } from './fields.js';
import { record } from './history.js';
import { addImages, deleteImage } from './images.js';
import { createProduct, nextSku, uniqueSku, updateProduct } from './products.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Common spreadsheet header spellings -> mapping target.
const SYNONYMS = {
  sku: ['sku', 'productid', 'productcode', 'itemcode', 'itemno', 'itemnumber', 'code', 'articleno', 'articlecode', 'article', 'styleno', 'style', 'refno', 'ref', 'reference', 'modelno', 'model', 'productidsku', 'id'],
  name: ['name', 'productname', 'itemname', 'title', 'product', 'item', 'itemdescription'],
  category: ['category', 'productcategory', 'cat', 'maincategory'],
  subcategory: ['subcategory', 'subcat', 'productsubcategory'],
  description: ['description', 'productdescription', 'details', 'desc', 'remarks'],
  status: ['status'],
  'spec:material': ['material', 'materials', 'mainmaterial'],
  'spec:wood_type': ['woodtype', 'wood', 'timber', 'timbertype'],
  'spec:finish': ['finish', 'colour', 'color', 'finishcolour', 'finishcolor', 'polish'],
  'spec:dimensions': ['dimensions', 'dimension', 'size', 'sizecm', 'sizeincm', 'dims', 'lxwxh', 'whd', 'dimensionscm', 'measurement', 'measurements', 'productsize'],
  'spec:size_inch': ['sizeininch', 'sizeinch', 'sizeininches', 'sizeinches', 'inch', 'inches'],
  'spec:weight': ['weight', 'wt', 'netweight', 'weightkg', 'nw', 'grossweight', 'gw'],
  'spec:cbm': ['cbm', 'volume', 'm3', 'cbmm3'],
  'spec:packing_size': ['packingsize', 'cartonsize', 'boxsize', 'packsize'],
  'spec:packing_details': ['packing', 'packaging', 'packingdetails', 'cartondetails', 'carton', 'packingdetail'],
  'spec:moq': ['moq', 'minimumorder', 'minorderqty', 'minimumorderquantity'],
  'spec:product_type': ['producttype', 'type'],
  'spec:collection': ['collection', 'range', 'series'],
  'cost:wood_cost': ['woodcost', 'materialcost', 'rawmaterial', 'rawmaterialcost', 'totalwoodcost'],
  'cost:wood_sft': ['woodsft', 'sft', 'totalwoodsft'],
  'cost:wages': ['wages', 'wage', 'labour', 'labor', 'labourcost', 'laborcost', 'labourwages'],
  'cost:knobs': ['knobhandle', 'knobshandle', 'knobshandles', 'knobs', 'knob', 'handles', 'handle'],
  'cost:tile_glass': ['tileglass', 'tile', 'glass', 'marble'],
  'cost:cnc': ['cnc', 'cnckherad'],
  'cost:kherad': ['kherad', 'turning'],
  'cost:iron': ['iron', 'ironwork'],
  'cost:other_hardware': ['hardware', 'otherhardware', 'upholstery', 'upholstry'],
  'cost:buyer_price': ['buyerprice', 'asdiscussedrate', 'discussedrate', 'asdiscussed', 'negotiatedprice', 'price', 'fob', 'fobprice', 'sellingprice', 'rate', 'unitprice', 'priceusd', 'fobusd'],
};
// In a costing workbook these columns are results of the costing formulas: the app calculates them.
const CALCULATED = {
  price_usd: ['price', 'priceusd', 'totalcosting'],
  parametric_usd: ['parametricrate', 'parametric', 'parametriccosting'],
  loadability: ['loadability', 'loadablity', 'loadablityfor40ft', 'loadabilityfor40ft'],
  wood_sft_total: ['totalwood20wastagesft', 'totalwood20wastage', 'totalwoodsft'],
  wood_total: ['totalwood', 'totalwoodconsumption'],
  kfd: ['kfd', 'kfd8'],
  polish_pf: ['pf', 'polishpf', 'polish'],
  overhead: ['oh', 'oh15', 'overheads', 'overhead'],
  margin: ['margin', 'margin20'],
};
// Column names of product fields the system calculates itself (never imported).
const SYSTEM_CALCULATED = { loadability: ['loadability', 'loadablity', 'loadablityfor40ft', 'loadabilityfor40ft', 'loadabilitypercontainer', 'pcspercontainer'] };
const IMAGE_HEADERS = new Set(['image', 'images', 'photo', 'photos', 'picture', 'pictures', 'productimage', 'productimages', 'img', 'pic']);
// Columns produced by our own exports that should not be re-imported.
const IGNORE_HEADERS = new Set(['productpage', 'productpageurl', 'qrcode', 'barcode', '', 'no', 'srno', 'sno', 'slno']);

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return cellText(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
    if ('error' in v) return '';
    return '';
  }
  return String(v).trim();
}

async function loadWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.csv') await wb.csv.readFile(file);
    else await wb.xlsx.readFile(file);
  } catch {
    throw badRequest('Could not read the file. Please upload an .xlsx or .csv file (save older .xls files as .xlsx first).');
  }
  return wb;
}

/** Turn a worksheet into { headers, rows } using the first row that looks like a header. */
function readSheet(ws) {
  let headerRow = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const row = ws.getRow(r);
    let filled = 0;
    row.eachCell({ includeEmpty: false }, (c) => {
      if (cellText(c.value)) filled++;
    });
    if (filled >= 2) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) return { headerRow: null, headers: [], rows: [] };

  const headers = [];
  const seen = new Map();
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, col) => {
    let name = cellText(c.value) || `Column ${col}`;
    const count = seen.get(name.toLowerCase()) || 0;
    seen.set(name.toLowerCase(), count + 1);
    if (count) name = `${name} (${count + 1})`;
    headers.push({ col, name });
  });

  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = {};
    let any = false;
    for (const h of headers) {
      const t = cellText(row.getCell(h.col).value);
      cells[h.col] = t;
      if (t) any = true;
    }
    if (any) rows.push({ rowNumber: r, cells });
  }
  return { headerRow, headers, rows };
}

/** Images floating over the sheet, grouped by the row their top-left corner sits in. */
function sheetImages(wb, ws) {
  const byRow = new Map();
  let images = [];
  try {
    images = ws.getImages();
  } catch {
    return byRow;
  }
  for (const img of images) {
    const media = wb.getImage(Number(img.imageId));
    if (!media?.buffer) continue;
    const tl = img.range?.tl;
    const row = Math.floor((tl?.nativeRow ?? tl?.row ?? -1)) + 1;
    if (row < 1) continue;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ col: tl?.nativeCol ?? tl?.col ?? 0, buffer: Buffer.from(media.buffer), ext: media.extension });
  }
  for (const list of byRow.values()) list.sort((a, b) => a.col - b.col);
  return byRow;
}

export function mappingTargets({ canEditCosting }) {
  const targets = [
    { value: 'sku', label: 'Product ID / SKU', group: 'Product' },
    { value: 'name', label: 'Product Name', group: 'Product' },
    { value: 'category', label: 'Category', group: 'Product' },
    { value: 'subcategory', label: 'Sub Category', group: 'Product' },
    { value: 'description', label: 'Description', group: 'Product' },
    { value: 'status', label: 'Status (active/inactive/draft)', group: 'Product' },
    ...editableFieldDefs().map((f) => ({ value: `spec:${f.key}`, label: f.label, group: 'Product fields' })),
  ];
  if (canEditCosting) {
    const fields = costingFields();
    targets.push(...fields.filter((f) => f.kind === 'input').map((f) => ({ value: `cost:${f.key}`, label: f.label, group: 'Costing (protected)' })));
    targets.push(...fields.filter((f) => f.kind === 'constraint').map((f) => ({ value: `cost:${f.key}`, label: `${f.label} (this product only)`, group: 'Costing constraints (protected)' })));
  }
  return targets;
}

function suggestMapping(headers, { canEditCosting, costingWorkbook = false }) {
  const targets = mappingTargets({ canEditCosting });
  const valid = new Set(targets.map((t) => t.value));
  const byLabel = new Map(targets.map((t) => [norm(t.label), t.value]));
  if (costingWorkbook) for (const f of costingFields()) if (f.kind === 'formula') byLabel.set(norm(f.label.replace(/\([^)]*\)/g, '')), `calc:${f.key}`);
  const used = new Set();
  const mapping = {};
  const notes = {};
  const keysOf = (h) => [norm(h.name), norm(h.name.replace(/\([^)]*\)/g, ''))]; // "Weight (kg)" -> "weight"
  const systemCalculated = new Map();
  for (const f of fieldDefs({ includeInactive: true }).filter((x) => x.calc)) {
    for (const k of [norm(f.label), norm(f.label.replace(/\([^)]*\)/g, '')), ...(SYSTEM_CALCULATED[f.calc] || [])]) systemCalculated.set(k, f);
  }

  // Pass 1: fixed ignores and exact label matches (so a label match always wins over a synonym).
  for (const h of headers) {
    const [n, bare] = keysOf(h);
    if (IMAGE_HEADERS.has(n) || IMAGE_HEADERS.has(bare) || IGNORE_HEADERS.has(n) || /\(calculated\)\s*$/i.test(h.name)) {
      mapping[h.col] = 'ignore';
      continue;
    }
    const sys = systemCalculated.get(n) || systemCalculated.get(bare);
    if (sys) {
      mapping[h.col] = 'ignore';
      notes[h.col] = `Calculated automatically from CBM (${sys.label}, Settings › Calculation rules) — not imported`;
      continue;
    }
    for (const key of [n, bare]) {
      const t = byLabel.get(key);
      if (t && !mapping[h.col] && (t.startsWith('calc:') || !used.has(t))) {
        mapping[h.col] = t;
        if (!t.startsWith('calc:')) used.add(t);
      }
    }
  }
  // Pass 2: calculated columns of a costing workbook, then synonyms.
  for (const h of headers) {
    if (mapping[h.col]) continue;
    const [n, bare] = keysOf(h);
    if (costingWorkbook) {
      const calc = Object.entries(CALCULATED).find(([, syns]) => syns.includes(n) || syns.includes(bare));
      if (calc) {
        mapping[h.col] = `calc:${calc[0]}`;
        continue;
      }
    }
    outer: for (const key of [n, bare]) {
      for (const [t, syns] of Object.entries(SYNONYMS)) {
        if (valid.has(t) && !used.has(t) && syns.includes(key)) {
          mapping[h.col] = t;
          used.add(t);
          break outer;
        }
      }
    }
    if (!mapping[h.col]) mapping[h.col] = 'new_field';
  }
  // A product list without a name column usually keeps the name under "Description".
  if (!used.has('name')) {
    const descCol = Object.keys(mapping).find((c) => mapping[c] === 'description');
    if (descCol) {
      mapping[descCol] = 'name';
      notes[descCol] = 'Used as the product name (the sheet has no name column)';
    }
  }
  for (const [col, t] of Object.entries(mapping)) {
    if (t.startsWith('calc:')) {
      const f = costingFields().find((x) => x.key === t.slice(5));
      notes[col] = `Calculated by the app${f ? ` (${f.label})` : ''} — not imported`;
      mapping[col] = 'ignore';
    }
  }
  return { mapping, notes };
}

// --- upload sessions (file kept on disk between preview and commit) ----------

const tokenFile = (token) => {
  if (!/^[a-f0-9]{32}$/.test(token)) throw badRequest('Invalid import token');
  const match = fs.readdirSync(paths.imports).find((f) => f.startsWith(token + '.') && !f.endsWith('.name'));
  if (!match) throw notFound('Import session expired. Please upload the file again.');
  return path.join(paths.imports, match);
};

export function cleanupOldImports(maxAgeMs = 24 * 3600 * 1000) {
  for (const f of fs.readdirSync(paths.imports)) {
    const p = path.join(paths.imports, f);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
}

export async function startImport(file, { canEditCosting }) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.csv', '.xlsm'].includes(ext)) throw badRequest('Please upload an Excel (.xlsx) or CSV file');
  const token = crypto.randomBytes(16).toString('hex');
  const dest = path.join(paths.imports, `${token}${ext === '.xlsm' ? '.xlsx' : ext}`);
  fs.writeFileSync(dest, file.buffer);
  fs.writeFileSync(dest + '.name', file.originalname.slice(0, 200));
  try {
    const info = await previewImport(token, null, { canEditCosting });
    return { token, filename: file.originalname, ...info };
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

async function openSheet(token, sheetName) {
  const file = tokenFile(token);
  const wb = await loadWorkbook(file);
  const sheets = wb.worksheets.map((ws) => ws.name);
  const costing = costingSheets(wb);
  const master = costing.size ? masterSheetName(wb, costing) : null;
  const ws = (sheetName && wb.getWorksheet(sheetName)) || (master && wb.getWorksheet(master)) ||
    wb.worksheets.find((w) => w.rowCount > 0 && !costing.has(w.name.toUpperCase())) || wb.worksheets[0];
  if (!ws) throw badRequest('The workbook has no sheets');
  return { file, wb, ws, sheets, costing, master };
}

export async function previewImport(token, sheetName, { canEditCosting }) {
  const { wb, ws, sheets, costing, master } = await openSheet(token, sheetName);
  const { headers, rows } = readSheet(ws);
  if (!headers.length) throw badRequest('Could not find a header row in the sheet');
  const images = sheetImages(wb, ws);
  const imageCount = [...images.values()].reduce((a, l) => a + l.length, 0);
  const { mapping, notes } = suggestMapping(headers, { canEditCosting, costingWorkbook: costing.size > 0 });
  return {
    sheet: ws.name,
    sheets: sheets.filter((s) => !costing.has(s.toUpperCase())),
    headers: headers.map((h) => ({ ...h, samples: rows.slice(0, 4).map((r) => r.cells[h.col]).filter(Boolean) })),
    totalRows: rows.length,
    imageCount,
    mapping,
    notes,
    targets: mappingTargets({ canEditCosting }),
    costingWorkbook: costing.size ? { sheets: costing.size, master, canImport: canEditCosting } : null,
  };
}

function validateMapping(mapping, headers, { canEditCosting }) {
  const valid = new Set(mappingTargets({ canEditCosting }).map((t) => t.value));
  const clean = {};
  const used = new Map();
  for (const h of headers) {
    const t = mapping?.[h.col] ?? 'ignore';
    if (t === 'ignore' || t === 'new_field') {
      clean[h.col] = t;
      continue;
    }
    if (!valid.has(t)) throw badRequest(`Invalid mapping target for column "${h.name}"`);
    if (used.has(t)) throw badRequest(`"${h.name}" and "${used.get(t)}" are both mapped to the same field`);
    used.set(t, h.name);
    clean[h.col] = t;
  }
  return clean;
}

function rowValues(row, headers, mapping) {
  const out = { core: {}, specs: {}, costs: {}, newFields: {} };
  for (const h of headers) {
    const t = mapping[h.col];
    const v = row.cells[h.col];
    if (!t || t === 'ignore') continue;
    if (t === 'new_field') out.newFields[h.col] = v;
    else if (t.startsWith('spec:')) out.specs[t.slice(5)] = v;
    else if (t.startsWith('cost:')) out.costs[t.slice(5)] = v;
    else out.core[t] = v;
  }
  return out;
}

export async function analyseImport(token, { sheet, mapping }, { canEditCosting }) {
  const { ws, costing } = await openSheet(token, sheet);
  const { headers, rows } = readSheet(ws);
  const clean = validateMapping(mapping, headers, { canEditCosting });
  const targets = new Set(Object.values(clean));
  let existing = 0;
  let missingSku = 0;
  let missingName = 0;
  let withCostingSheet = 0;
  const seen = new Set();
  let duplicatesInFile = 0;
  for (const row of rows) {
    const { core } = rowValues(row, headers, clean);
    const sku = (core.sku || '').trim();
    if (!sku) missingSku++;
    else {
      if (seen.has(sku.toLowerCase())) duplicatesInFile++;
      seen.add(sku.toLowerCase());
      if (q.get('SELECT 1 FROM products WHERE sku = ?', sku)) existing++;
      if (costing.has(sku.toUpperCase())) withCostingSheet++;
    }
    if (!(core.name || '').trim()) missingName++;
  }
  return {
    totalRows: rows.length,
    existing,
    newProducts: rows.length - existing,
    missingSku,
    missingName,
    duplicatesInFile,
    withCostingSheet,
    hasSkuColumn: targets.has('sku'),
    hasNameColumn: targets.has('name'),
    newFieldColumns: headers.filter((h) => clean[h.col] === 'new_field').map((h) => h.name),
  };
}

/** Create field definitions for "new_field" columns. Returns col -> field key. */
function createNewFields(headers, mapping) {
  const existing = new Map(fieldDefs({ includeInactive: true }).map((f) => [norm(f.label), f.key]));
  const keys = new Set(fieldDefs({ includeInactive: true }).map((f) => f.key));
  const result = {};
  let order = Number(q.value('SELECT ifnull(MAX(sort_order), 0) FROM field_definitions'));
  for (const h of headers) {
    if (mapping[h.col] !== 'new_field') continue;
    const n = norm(h.name);
    if (existing.has(n)) {
      result[h.col] = existing.get(n);
      continue;
    }
    let key = slugKey(h.name);
    if (['sku', 'name', 'category', 'subcategory', 'description', 'status'].includes(key)) key = `${key}_custom`;
    let k = key;
    for (let i = 2; keys.has(k); i++) k = `${key}_${i}`;
    keys.add(k);
    order += 10;
    q.run(
      `INSERT INTO field_definitions(key, label, type, group_name, is_public, is_filterable, sort_order)
       VALUES (?, ?, 'text', 'Additional', 0, 0, ?)`,
      k, h.name.slice(0, 80), order,
    );
    existing.set(n, k);
    result[h.col] = k;
  }
  invalidateFields();
  return result;
}

/**
 * Import a product's costing sheet: cost inputs, constants that differ from the default
 * constraints (saved for this product only) and the CBM the costing is based on.
 * Afterwards the app's own calculation is compared with the sheet's result.
 */
function importCostingSheet(productId, sku, ws, user, report) {
  const parsed = parseCostingSheet(ws);
  const fields = costingFields();
  const keys = new Set(fields.map((f) => f.key));
  const values = {};
  for (const [k, v] of Object.entries(parsed.inputs)) if (keys.has(k)) values[k] = v ?? null;
  for (const [k, v] of Object.entries(parsed.constants)) {
    const f = fields.find((x) => x.key === k && x.kind === 'constraint');
    if (!f) continue;
    if (Math.abs((f.default_value ?? 0) - v) > 1e-9) {
      values[k] = v;
      report.overrides.push({ sku, field: f.label, value: v, default: f.default_value });
    } else values[k] = null; // uses the default
  }
  setProductCosting(productId, values, user, { source: 'costing sheet import' });

  if (parsed.cbm !== null) {
    const current = Number(q.value(`SELECT value FROM product_specifications WHERE product_id = ? AND field_key = 'cbm'`, productId));
    if (!Number.isFinite(current) || Math.abs(current - parsed.cbm) > 0.0005) {
      updateProduct(productId, { specs: { cbm: String(Math.round(parsed.cbm * 1e6) / 1e6) } }, user, { source: 'costing sheet import' });
      report.cbmCorrections.push({ sku, from: Number.isFinite(current) && current ? current : null, to: parsed.cbm });
    }
  }
  const computed = computeCosting(storedCosting(productId), fields, costingContext(productId));
  const diffs = [];
  for (const [key, expected] of [['price_usd', parsed.check.price_usd], ['parametric_usd', parsed.check.parametric_usd]]) {
    if (expected === null || expected === undefined || !keys.has(key)) continue;
    if (computed[key] === null || Math.abs(computed[key] - expected) > 0.01) diffs.push({ field: key, app: computed[key], sheet: expected });
  }
  if (diffs.length) report.mismatches.push({ sku, diffs });
  else report.verified++;
  for (const w of parsed.warnings) report.warnings.push(`${sku}: ${w}`);
  report.imported++;
}

/**
 * Run the import.
 * options.duplicateStrategy: 'update' | 'skip' | 'create_new'
 * options.autoSku: generate an SKU when the cell is empty
 * options.importImages: attach images embedded in the sheet
 * options.replaceImages: for updated products, replace their existing images with the sheet's images
 * options.importCosting: read each product's costing sheet (costing workbooks only)
 */
export async function commitImport(token, options, user, { canEditCosting }) {
  const { file, wb, ws, costing } = await openSheet(token, options.sheet);
  const filename = fs.existsSync(file + '.name') ? fs.readFileSync(file + '.name', 'utf8') : path.basename(file);
  const { headers, rows } = readSheet(ws);
  const mapping = validateMapping(options.mapping, headers, { canEditCosting });
  if (!Object.values(mapping).includes('name')) throw badRequest('Map a column to "Product Name" before importing');
  const strategy = ['update', 'skip', 'create_new'].includes(options.duplicateStrategy) ? options.duplicateStrategy : 'update';
  const autoSku = options.autoSku !== false;
  const withCosting = canEditCosting && costing.size > 0 && options.importCosting !== false;

  const results = { created: 0, updated: 0, skipped: 0, failed: 0, images: 0, errors: [], updatedProducts: [] };
  const costingReport = { imported: 0, verified: 0, mismatches: [], overrides: [], cbmCorrections: [], warnings: [], missingSheets: [] };
  const imageJobs = [];
  const images = options.importImages !== false ? sheetImages(wb, ws) : new Map();
  const importUser = user;

  tx(() => {
    const newFieldKeys = createNewFields(headers, mapping);
    for (const row of rows) {
      try {
        tx(() => {
          const v = rowValues(row, headers, mapping);
          for (const [col, val] of Object.entries(v.newFields)) if (newFieldKeys[col]) v.specs[newFieldKeys[col]] = val;
          let sku = (v.core.sku || '').trim();
          const name = (v.core.name || '').trim();
          if (!name && !sku) throw new Error('Row has no Product ID or name');
          const existing = sku ? q.get('SELECT id, (SELECT COUNT(*) FROM product_images WHERE product_id = products.id) AS imgs FROM products WHERE sku = ?', sku) : null;
          const data = { specs: v.specs };
          if ('name' in v.core && name) data.name = name;
          if (v.core.category) data.category = v.core.category;
          if (v.core.subcategory) data.subcategory = v.core.subcategory;
          if (v.core.description) data.description = v.core.description;
          if (v.core.status) data.status = v.core.status.toLowerCase();
          // Blank cells never wipe existing data during an update.
          for (const k of Object.keys(data.specs)) if (!data.specs[k]) delete data.specs[k];

          let productId;
          let action;
          if (existing && strategy === 'skip') {
            results.skipped++;
            return;
          }
          if (existing && strategy === 'update') {
            const r = updateProduct(existing.id, data, importUser, { source: 'Excel import' });
            if (r.changes?.length && results.updatedProducts.length < 500) results.updatedProducts.push({ sku, changes: r.changes });
            productId = existing.id;
            action = 'updated';
          } else {
            if (!name) throw new Error('Product name is required for new products');
            if (existing) sku = uniqueSku(sku);
            if (!sku) {
              if (!autoSku) throw new Error('Product ID is empty');
              sku = nextSku();
            }
            productId = createProduct({ ...data, sku, name }, importUser, { source: 'Excel import' });
            action = 'created';
          }
          if (canEditCosting && Object.keys(v.costs).length) {
            const costs = Object.fromEntries(Object.entries(v.costs).filter(([, val]) => val !== ''));
            if (Object.keys(costs).length) setProductCosting(productId, costs, importUser, { source: 'Excel import' });
          }
          if (withCosting) {
            const sheet = costing.get(sku.toUpperCase());
            if (sheet) importCostingSheet(productId, sku, sheet, importUser, costingReport);
            else costingReport.missingSheets.push(sku);
          }
          results[action]++;
          const rowImages = images.get(row.rowNumber);
          if (rowImages?.length) {
            const hasImages = existing?.imgs > 0 && action === 'updated';
            if (!hasImages || options.replaceImages) imageJobs.push({ productId, replace: hasImages && options.replaceImages, images: rowImages, sku });
          }
        });
      } catch (err) {
        results.failed++;
        if (results.errors.length < 200) results.errors.push({ row: row.rowNumber, error: err.message });
      }
    }
  });

  for (const job of imageJobs) {
    if (job.replace) {
      const old = q.all('SELECT id FROM product_images WHERE product_id = ?', job.productId);
      for (const o of old) deleteImage(job.productId, o.id, importUser);
    }
    const files = job.images.map((img, i) => ({ buffer: img.buffer, originalname: `${job.sku}_${i + 1}.${img.ext || 'jpg'}` }));
    const res = await addImages(job.productId, files, importUser, { source: 'Excel import' });
    results.images += res.added;
    for (const e of res.errors) if (results.errors.length < 200) results.errors.push({ row: null, error: `${job.sku}: ${e.error}` });
  }

  const { lastInsertRowid } = q.run(
    `INSERT INTO import_history(filename, sheet, total_rows, created_count, updated_count, skipped_count, failed_count,
                                images_count, duplicate_strategy, mapping, errors, user_id, user_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    filename, ws.name, rows.length, results.created, results.updated, results.skipped, results.failed, results.images,
    strategy, JSON.stringify(Object.fromEntries(headers.map((h) => [h.name, mapping[h.col]]))),
    results.errors.length ? JSON.stringify(results.errors) : null, user?.id, user?.name,
  );
  const costingNote = withCosting ? `, costing from ${costingReport.imported} sheets (${costingReport.verified} verified)` : '';
  record({
    user, entity: 'import', entityId: Number(lastInsertRowid), action: 'excel_import',
    summary: `Excel import "${filename}": ${results.created} created, ${results.updated} updated, ${results.skipped} skipped, ${results.failed} failed, ${results.images} images${costingNote}`,
  });
  fs.rmSync(file, { force: true });
  fs.rmSync(file + '.name', { force: true });
  return { id: Number(lastInsertRowid), totalRows: rows.length, ...results, costing: withCosting ? costingReport : null };
}
