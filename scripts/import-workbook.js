// Import a product + costing workbook and a folder of product images, then verify the result.
//
//   node scripts/import-workbook.js --file samples/sample-costing.xlsx --images "Product Images"
//
// Options:
//   --sheet "PRODUCT LIST"  product list sheet (default: the sheet the costing sheets read from)
//   --categories            set a category from the product name when a product has none
//   --no-backup             skip the database backup taken before importing
//
// Stop the app before running this. Uses DATA_DIR from .env like the server does.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../server/config.js';
import { db, migrate, q } from '../server/db/index.js';
import { seed } from '../server/db/seed.js';
import { computeCosting, costingContext, costingFields, storedCosting } from '../server/services/costing.js';
import { addImages, compareImageNames, matchFileToProduct } from '../server/services/images.js';
import { commitImport, startImport } from '../server/services/importer.js';
import { updateProduct } from '../server/services/products.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const file = opt('file');
const imagesDir = opt('images');
if (!file) {
  console.error('Usage: node scripts/import-workbook.js --file <workbook.xlsx> [--images <folder>] [--sheet <name>] [--categories]');
  process.exit(1);
}

const USER = { id: null, name: `Data import (${path.basename(file)})` };
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const reportDir = path.join(config.dataDir, 'import-reports');
fs.mkdirSync(reportDir, { recursive: true });

// Product name -> category (singular product type). Only used with --categories.
const CATEGORY_RULES = [
  [/TV UNIT/, 'TV Unit'], [/SIDEBOARD/, 'Sideboard'], [/CHEST/, 'Chest of Drawers'], [/BEDSIDE/, 'Bedside'],
  [/WRITING DESK|\bDESK\b/, 'Desk'], [/DINING TABLE/, 'Dining Table'], [/CHAIR/, 'Chair'], [/CONSOLE/, 'Console Table'],
  [/COFFEE TABLE/, 'Coffee Table'], [/SIDE TABLE|END TABLE|PEDESTAL TABLE/, 'Side Table'], [/WALL ART/, 'Wall Art'],
  [/SHELF/, 'Wall Shelf'], [/WALL HANG/, 'Wall Décor'], [/TROLLEY/, 'Trolley'], [/CABINET/, 'Cabinet'],
];

async function main() {
  // Back up the database exactly as it is, before any upgrade or import.
  if (!flag('no-backup')) {
    const backups = path.join(config.dataDir, 'backups');
    fs.mkdirSync(backups, { recursive: true });
    const target = path.join(backups, `before-import-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log(`Backup of the database: ${path.relative(ROOT, target)}`);
  }
  migrate();
  seed();

  // 1. Products + costing through the app's importer.
  const buffer = fs.readFileSync(path.resolve(ROOT, file));
  const perms = { canEditCosting: true };
  const preview = await startImport({ buffer, originalname: path.basename(file) }, perms);
  let session = preview;
  if (opt('sheet') && opt('sheet') !== preview.sheet) {
    const { previewImport } = await import('../server/services/importer.js');
    session = { ...preview, ...(await previewImport(preview.token, opt('sheet'), perms)) };
  }
  console.log(`\nProduct list sheet: "${session.sheet}" (${session.totalRows} rows)` +
    (session.costingWorkbook ? `, ${session.costingWorkbook.sheets} product costing sheets` : ''));
  const mappingLines = session.headers.map((h) => `  ${h.name.padEnd(34)} → ${session.mapping[h.col]}${session.notes?.[h.col] ? `  (${session.notes[h.col]})` : ''}`);
  console.log('Column mapping:\n' + mappingLines.join('\n'));

  const result = await commitImport(preview.token, {
    sheet: session.sheet,
    mapping: session.mapping,
    duplicateStrategy: 'update',
    autoSku: false,
    importImages: true,
    importCosting: true,
  }, USER, perms);
  console.log(`\nImported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`);
  for (const e of result.errors) console.log(`  ! row ${e.row}: ${e.error}`);
  if (result.costing) {
    const c = result.costing;
    console.log(`Costing: ${c.imported} sheets imported, ${c.verified} match Excel exactly, ${c.mismatches.length} differ`);
    for (const m of c.mismatches) console.log(`  ! ${m.sku}: ${JSON.stringify(m.diffs)}`);
    for (const o of c.overrides) console.log(`  · ${o.sku}: ${o.field} = ${o.value} (default ${o.default}) saved for this product`);
    for (const x of c.cbmCorrections) console.log(`  · ${x.sku}: CBM set from costing sheet ${x.from ?? '—'} → ${x.to}`);
  }

  const productIds = q.all('SELECT id, sku, name, category_id FROM products');

  // 2. Categories from the product name (only where a product has none).
  const categoryReport = [];
  if (flag('categories')) {
    for (const p of productIds) {
      if (p.category_id) continue;
      const cat = CATEGORY_RULES.find(([re]) => re.test(p.name.toUpperCase()))?.[1];
      if (!cat) continue;
      updateProduct(p.id, { category: cat }, USER, { source: 'category from product name' });
      categoryReport.push({ sku: p.sku, category: cat });
    }
    console.log(`\nCategories set from product names: ${categoryReport.length}`);
  }

  // 3. Images from the folder, matched by file name (PRD-10025.jpg, PRD-10025.1.jpg, …).
  const imageReport = { added: 0, duplicates: [], unmatched: [], errors: [], perProduct: {} };
  if (imagesDir) {
    const dir = path.resolve(ROOT, imagesDir);
    const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|gif|tiff?|avif|heic|heif)$/i.test(f));
    const groups = new Map();
    for (const f of files) {
      const product = matchFileToProduct(f);
      if (!product) {
        imageReport.unmatched.push(f);
        continue;
      }
      if (!groups.has(product.id)) groups.set(product.id, { product, files: [] });
      groups.get(product.id).files.push(f);
    }
    for (const { product, files: names } of groups.values()) {
      names.sort(compareImageNames);
      const r = await addImages(product.id, names.map((n) => ({ buffer: fs.readFileSync(path.join(dir, n)), originalname: n })), USER, { source: 'image folder import' });
      imageReport.added += r.added;
      imageReport.duplicates.push(...r.duplicates.map((d) => `${product.sku}: ${d}`));
      imageReport.errors.push(...r.errors.map((e) => `${product.sku}: ${e.file} – ${e.error}`));
      imageReport.perProduct[product.sku] = names;
      process.stdout.write('.');
    }
    console.log(`\nImages: ${imageReport.added} added from ${files.length} files, ${imageReport.duplicates.length} identical duplicates skipped, ${imageReport.unmatched.length} unmatched`);
    for (const d of imageReport.duplicates) console.log(`  · duplicate skipped: ${d}`);
    for (const u of imageReport.unmatched) console.log(`  ! no product for file: ${u}`);
    for (const e of imageReport.errors) console.log(`  ! ${e}`);
  }

  // 4. Verification of every product in the sheet.
  const fields = costingFields();
  const rows = q.all(
    `SELECT p.id, p.sku, p.name, c.name AS category,
            (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS images,
            (SELECT original_name FROM product_images i WHERE i.product_id = p.id AND i.is_primary = 1) AS primary_image,
            (SELECT code FROM product_codes pc WHERE pc.product_id = p.id) AS code
       FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.sku`,
  );
  const verification = rows.map((p) => {
    const v = computeCosting(storedCosting(p.id), fields, costingContext(p.id));
    return {
      sku: p.sku, name: p.name, category: p.category, images: p.images, primary_image: p.primary_image, code: p.code,
      cbm: costingContext(p.id).cbm ?? null, price_usd: v.price_usd, parametric_usd: v.parametric_usd, discussed_usd: v.buyer_price,
    };
  });
  const noImage = verification.filter((r) => !r.images).map((r) => r.sku);
  const report = { file, sheet: session.sheet, createdAt: new Date().toISOString(), result, categories: categoryReport, images: imageReport, products: verification, noImage };
  const jsonPath = path.join(reportDir, `import-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    `# Import report — ${path.basename(file)}`,
    '',
    `- Date: ${new Date().toLocaleString()}`,
    `- Product list sheet: ${session.sheet}`,
    `- Products: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    result.costing ? `- Costing: ${result.costing.imported} imported, ${result.costing.verified} identical to Excel, ${result.costing.mismatches.length} different` : '',
    `- Images: ${imageReport.added} added, ${imageReport.duplicates.length} duplicates skipped, ${imageReport.unmatched.length} unmatched files`,
    `- Products without images: ${noImage.length ? noImage.join(', ') : 'none'}`,
    '',
    result.updatedProducts.length ? '## Existing products that changed' : '',
    ...result.updatedProducts.map((u) => `- **${u.sku}**: ${u.changes.map((c) => `${c.label}: “${c.from ?? '—'}” → “${c.to ?? '—'}”`).join('; ')}`),
    '',
    '## Products',
    '',
    '| Product ID | Name | Category | CBM | Price ($) | Parametric ($) | As discussed ($) | Images |',
    '|---|---|---|---|---|---|---|---|',
    ...verification.map((r) => `| ${r.sku} | ${r.name} | ${r.category || ''} | ${r.cbm ?? ''} | ${r.price_usd?.toFixed(2) ?? ''} | ${r.parametric_usd?.toFixed(2) ?? ''} | ${r.discussed_usd ?? ''} | ${r.images} |`),
  ].filter((l) => l !== null).join('\n');
  const mdPath = path.join(reportDir, `import-${stamp}.md`);
  fs.writeFileSync(mdPath, md);
  console.log(`\nReport: ${path.relative(ROOT, mdPath)}`);
  console.log(`Products in database: ${rows.length}; without images: ${noImage.length}; codes: ${rows.filter((r) => r.code).length}`);
}

main().catch((err) => {
  console.error('Import failed:', err.stack || err.message);
  process.exit(1);
});
