import ExcelJS from 'exceljs';
import { q } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { productUrl } from './codes.js';
import { computeCosting, costingContext, costingFields, storedCosting } from './costing.js';
import { fieldDefs } from './fields.js';
import { listProducts } from './products.js';

function styleHeader(row, argb = 'FF1F3A5F') {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 22;
}

/**
 * Product data export in the same column layout the importer understands, so it can be
 * edited and uploaded again for bulk updates.
 */
export async function exportProducts(query, { canViewCosting, template = false }) {
  const defs = fieldDefs();
  const cost = canViewCosting ? costingFields().filter((f) => f.kind === 'input') : [];
  const computed = canViewCosting ? costingFields().filter((f) => f.kind === 'formula') : [];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = [
    { header: 'Product ID / SKU', key: 'sku', width: 18 },
    { header: 'Product Name', key: 'name', width: 32 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Sub Category', key: 'subcategory', width: 18 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Status', key: 'status', width: 10 },
    // System-calculated fields (loadability) are exported for reference and ignored on import.
    ...defs.filter((f) => !(template && f.calc)).map((f) => ({ header: f.calc ? `${f.label} (calculated)` : f.label, key: `spec:${f.key}`, width: Math.max(12, f.label.length + (f.calc ? 14 : 4)) })),
    ...cost.map((f) => ({ header: f.label, key: `cost:${f.key}`, width: Math.max(12, f.label.length + 2) })),
  ];
  if (!template) {
    cols.push(...computed.map((f) => ({ header: `${f.label} (calculated)`, key: `calc:${f.key}`, width: Math.max(14, f.label.length + 14) })));
    cols.push({ header: 'Images', key: 'images', width: 8 }, { header: 'Product Page', key: 'url', width: 34 });
  }
  ws.columns = cols;
  styleHeader(ws.getRow(1));
  if (cost.length) {
    cols.forEach((c, i) => {
      if (c.key.startsWith('cost:') || c.key.startsWith('calc:')) ws.getRow(1).getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C2D12' } };
    });
  }

  if (!template) {
    const { items } = listProducts(query, { canViewCosting, all: true });
    for (const p of items) {
      const row = { sku: p.sku, name: p.name, category: p.category, subcategory: p.subcategory, description: p.description, status: p.status, images: p.image_count, url: { text: productUrl(p.code || p.sku), hyperlink: productUrl(p.code || p.sku) } };
      for (const f of defs) row[`spec:${f.key}`] = p.specs[f.key] ?? null;
      if (canViewCosting) {
        const values = computeCosting(storedCosting(p.id), costingFields(), costingContext(p.id));
        for (const f of cost) row[`cost:${f.key}`] = values[f.key] ?? null;
        for (const f of computed) row[`calc:${f.key}`] = values[f.key] ?? null;
      }
      ws.addRow(row);
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }

  const notes = wb.addWorksheet('Read me');
  notes.columns = [{ width: 110 }];
  [
    'How to use this file',
    '',
    '• Edit values and upload the file on the Excel Import page to bulk-update products.',
    '• Rows are matched on "Product ID / SKU". Choose "Update existing products" when importing.',
    '• Blank cells never erase existing data during an update.',
    '• Leave the SKU empty on a new row to have one generated automatically.',
    '• Extra columns can be imported as new custom fields.',
    '• Columns marked "(calculated)" (e.g. Loadability) are worked out by the app and ignored on import.',
    '• CBM left blank is calculated from the Packing Size (L × W × H of each box, in cm).',
    '• Pictures placed on a row (Insert ▸ Pictures, over the row) are attached to that product.',
    cost.length ? '• Brown columns hold protected costing. Calculated columns are ignored on import.' : '',
  ].forEach((t, i) => {
    const r = notes.addRow([t]);
    if (i === 0) r.font = { bold: true, size: 14 };
  });
  return wb.xlsx.writeBuffer();
}

/** Costing sheet for the Costing module. */
export async function exportCosting(query) {
  const fields = costingFields();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Costing', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: 'Product ID / SKU', key: 'sku', width: 18 },
    { header: 'Product Name', key: 'name', width: 32 },
    ...fields.map((f) => ({
      header: f.kind === 'formula' ? `${f.label} (calculated)` : f.kind === 'constraint' ? `${f.label} (constraint)` : f.label,
      key: f.key,
      width: Math.max(14, f.label.length + 4),
    })),
  ];
  styleHeader(ws.getRow(1), 'FF7C2D12');
  const { items } = listProducts(query, { canViewCosting: true, all: true });
  const currency = getSetting('currency') || '';
  const symbol = (code) => ({ INR: '₹', USD: '$', EUR: '€', GBP: '£' })[code] || code;
  for (const p of items) {
    const values = computeCosting(storedCosting(p.id), fields, costingContext(p.id));
    const row = ws.addRow({ sku: p.sku, name: p.name, ...values });
    fields.forEach((f, i) => {
      const cell = row.getCell(i + 3);
      cell.numFmt = f.type === 'percent' ? '0.00"%"' : f.type === 'currency' ? `"${symbol(f.currency || currency)} "#,##0.00` : '#,##0.####';
    });
  }
  return wb.xlsx.writeBuffer();
}
