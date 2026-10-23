// Generates samples/sample-products.xlsx: 12 furniture products with pictures embedded
// in the sheet, to try the Excel import (npm run sample).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const WOOD = { mango: '#b9844f', walnut: '#6e4528', acacia: '#9a6639', sheesham: '#7f4f2c', whitewash: '#e6d9c3', black: '#2e2b29', natural: '#c99a63' };

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

// Simple flat illustrations of furniture pieces (1000 x 800).
const DRAW = {
  coffeeTable: (w) => `
    <rect x="200" y="380" width="600" height="46" rx="8" fill="${w}"/>
    <rect x="200" y="420" width="600" height="14" fill="${shade(w, 0.75)}"/>
    <rect x="235" y="434" width="34" height="200" fill="${shade(w, 0.85)}"/><rect x="731" y="434" width="34" height="200" fill="${shade(w, 0.85)}"/>
    <rect x="300" y="434" width="26" height="170" fill="${shade(w, 0.65)}"/><rect x="674" y="434" width="26" height="170" fill="${shade(w, 0.65)}"/>
    <rect x="300" y="540" width="400" height="18" fill="${shade(w, 0.7)}"/>`,
  sideTable: (w) => `
    <ellipse cx="500" cy="330" rx="190" ry="40" fill="${w}"/><rect x="310" y="330" width="380" height="18" fill="${shade(w, 0.75)}"/>
    <ellipse cx="500" cy="348" rx="190" ry="40" fill="${shade(w, 0.75)}" opacity="0.5"/>
    <rect x="482" y="360" width="36" height="230" fill="${shade(w, 0.8)}"/>
    <ellipse cx="500" cy="610" rx="130" ry="26" fill="${shade(w, 0.7)}"/>`,
  chair: (w) => `
    <rect x="370" y="170" width="260" height="210" rx="14" fill="${w}"/>
    <rect x="395" y="200" width="210" height="10" fill="${shade(w, 0.8)}"/><rect x="395" y="240" width="210" height="10" fill="${shade(w, 0.8)}"/>
    <rect x="340" y="380" width="320" height="50" rx="8" fill="${shade(w, 0.9)}"/>
    <rect x="355" y="430" width="30" height="210" fill="${shade(w, 0.75)}"/><rect x="615" y="430" width="30" height="210" fill="${shade(w, 0.75)}"/>
    <rect x="390" y="430" width="22" height="180" fill="${shade(w, 0.6)}"/><rect x="588" y="430" width="22" height="180" fill="${shade(w, 0.6)}"/>`,
  cabinet: (w) => `
    <rect x="270" y="170" width="460" height="430" rx="10" fill="${w}"/>
    <rect x="292" y="192" width="200" height="386" rx="6" fill="${shade(w, 0.9)}"/><rect x="508" y="192" width="200" height="386" rx="6" fill="${shade(w, 0.9)}"/>
    <rect x="470" y="355" width="10" height="60" rx="5" fill="#d7c3a0"/><rect x="520" y="355" width="10" height="60" rx="5" fill="#d7c3a0"/>
    <rect x="290" y="600" width="26" height="50" fill="${shade(w, 0.6)}"/><rect x="684" y="600" width="26" height="50" fill="${shade(w, 0.6)}"/>`,
  bookshelf: (w) => `
    <rect x="320" y="110" width="360" height="540" fill="${w}"/>
    <rect x="345" y="135" width="310" height="490" fill="${shade(w, 0.7)}"/>
    ${[250, 370, 490].map((y) => `<rect x="345" y="${y}" width="310" height="16" fill="${w}"/>`).join('')}
    <rect x="370" y="170" width="28" height="80" fill="#8c3b2c"/><rect x="402" y="185" width="22" height="65" fill="#3d5a73"/><rect x="560" y="300" width="60" height="70" rx="30" fill="#c9b79a"/>
    <rect x="380" y="420" width="90" height="70" fill="#5b6b4b"/>`,
  stool: (w) => `
    <ellipse cx="500" cy="300" rx="150" ry="36" fill="${w}"/><rect x="350" y="300" width="300" height="22" fill="${shade(w, 0.75)}"/>
    <path d="M390 320 L340 640 L370 640 L420 320 Z" fill="${shade(w, 0.8)}"/><path d="M610 320 L660 640 L630 640 L580 320 Z" fill="${shade(w, 0.8)}"/>
    <path d="M480 322 L470 610 L500 610 L510 322 Z" fill="${shade(w, 0.6)}"/>
    <rect x="370" y="520" width="260" height="14" fill="${shade(w, 0.7)}"/>`,
  bench: (w) => `
    <rect x="160" y="380" width="680" height="52" rx="8" fill="${w}"/><rect x="160" y="428" width="680" height="12" fill="${shade(w, 0.75)}"/>
    <rect x="200" y="440" width="70" height="180" fill="${shade(w, 0.8)}"/><rect x="730" y="440" width="70" height="180" fill="${shade(w, 0.8)}"/>
    <rect x="270" y="540" width="460" height="16" fill="${shade(w, 0.65)}"/>`,
  console: (w) => `
    <rect x="180" y="300" width="640" height="40" rx="6" fill="${w}"/>
    <rect x="200" y="340" width="600" height="90" fill="${shade(w, 0.88)}"/>
    <rect x="215" y="352" width="180" height="66" rx="4" fill="${shade(w, 0.78)}"/><rect x="410" y="352" width="180" height="66" rx="4" fill="${shade(w, 0.78)}"/><rect x="605" y="352" width="180" height="66" rx="4" fill="${shade(w, 0.78)}"/>
    <rect x="215" y="430" width="28" height="210" fill="${shade(w, 0.7)}"/><rect x="757" y="430" width="28" height="210" fill="${shade(w, 0.7)}"/>`,
};

function svg(kind, wood, accent = 0) {
  const bg = ['#f2ede6', '#eef0f1', '#f3eee8'][accent % 3];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800" viewBox="0 0 1000 800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs>
    <rect width="1000" height="800" fill="url(#g)"/>
    <ellipse cx="500" cy="660" rx="360" ry="34" fill="#000" opacity="0.08"/>
    ${DRAW[kind](wood)}
  </svg>`);
}

const PRODUCTS = [
  ['PRD-10025', 'Wooden Coffee Table', 'Tables', 'Coffee Tables', 'Solid mango wood coffee table with a lower shelf and rounded edges.', 'Mango Wood', 'Mango', 'Light Brown', '90 x 60 x 45', 18, 0.24, '1 pc / 5-ply carton, corner protectors', 50, 'coffeeTable', WOOD.mango, 'Living Room', 'Heritage', 148, 38, 22, 6, 9, 7, 8, 12],
  ['PRD-10026', 'Round Side Table', 'Tables', 'Side Tables', 'Pedestal side table turned from acacia wood.', 'Acacia Wood', 'Acacia', 'Natural Oil', '50 x 50 x 55', 7.5, 0.09, '2 pcs / carton', 100, 'sideTable', WOOD.acacia, 'Living Room', 'Heritage', 64, 14, 9, 2, 4, 3, 4, 6],
  ['PRD-10027', 'Slatted Dining Chair', 'Seating', 'Dining Chairs', 'Comfortable dining chair with a slatted back, KD construction.', 'Sheesham Wood', 'Sheesham', 'Honey', '45 x 52 x 88', 6.2, 0.15, '2 pcs / carton, knock-down', 100, 'chair', WOOD.sheesham, 'Dining', 'Nordic Living', 72, 18, 11, 3, 5, 4, 4, 7],
  ['PRD-10028', 'Two Door Cabinet', 'Storage', 'Cabinets', 'Two-door storage cabinet with an adjustable inner shelf.', 'Mango Wood', 'Mango', 'Walnut Brown', '90 x 40 x 110', 42, 0.48, '1 pc / carton, foam wrapped', 20, 'cabinet', WOOD.walnut, 'Living Room', 'Heritage', 289, 82, 45, 14, 18, 12, 16, 24],
  ['PRD-10029', 'Open Bookshelf', 'Storage', 'Shelving', 'Four-tier open bookshelf in solid wood with a back panel.', 'Acacia Wood', 'Acacia', 'Dark Walnut', '80 x 35 x 180', 38, 0.52, '1 pc / carton', 20, 'bookshelf', WOOD.walnut, 'Study', 'Urban Loft', 245, 70, 38, 8, 15, 11, 14, 22],
  ['PRD-10030', 'Bar Stool', 'Seating', 'Stools', 'Counter-height bar stool with a footrest ring.', 'Mango Wood', 'Mango', 'Black', '40 x 40 x 75', 5.1, 0.08, '4 pcs / carton', 200, 'stool', WOOD.black, 'Dining', 'Urban Loft', 49, 11, 7, 2, 4, 3, 3, 5],
  ['PRD-10031', 'Entryway Bench', 'Seating', 'Benches', 'Long entryway bench with a lower slatted shelf.', 'Sheesham Wood', 'Sheesham', 'Natural', '120 x 38 x 46', 16, 0.22, '1 pc / carton', 50, 'bench', WOOD.natural, 'Hallway', 'Nordic Living', 132, 34, 21, 4, 8, 6, 7, 11],
  ['PRD-10032', 'Three Drawer Console', 'Tables', 'Console Tables', 'Slim console table with three drawers and brass knobs.', 'Mango Wood', 'Mango', 'White Wash', '120 x 35 x 78', 24, 0.31, '1 pc / carton, drawers taped', 30, 'console', WOOD.whitewash, 'Hallway', 'Coastal', 196, 52, 30, 12, 11, 8, 10, 15],
  ['PRD-10033', 'Rustic Coffee Table', 'Tables', 'Coffee Tables', 'Chunky reclaimed-look coffee table with distressed finish.', 'Acacia Wood', 'Acacia', 'Distressed Grey', '110 x 65 x 42', 26, 0.3, '1 pc / carton', 30, 'coffeeTable', '#8e8a83', 'Living Room', 'Urban Loft', 168, 44, 25, 5, 10, 8, 9, 14],
  ['PRD-10034', 'Nesting Side Table', 'Tables', 'Side Tables', 'Small round side table, nests with PRD-10026.', 'Mango Wood', 'Mango', 'Light Brown', '40 x 40 x 48', 5.4, 0.06, '2 pcs / carton', 100, 'sideTable', WOOD.mango, 'Living Room', 'Heritage', 52, 11, 8, 2, 3, 3, 3, 5],
  ['PRD-10035', 'Low Display Cabinet', 'Storage', 'Cabinets', 'Low sideboard with two doors, ideal for living rooms.', 'Sheesham Wood', 'Sheesham', 'Honey', '140 x 42 x 75', 48, 0.55, '1 pc / carton, foam wrapped', 20, 'cabinet', WOOD.sheesham, 'Living Room', 'Nordic Living', 318, 90, 50, 16, 20, 13, 18, 26],
  ['', 'Kids Step Stool', 'Seating', 'Stools', 'Sturdy two-step stool. No SKU in the sheet — one is generated on import.', 'Pine Wood', 'Pine', 'Natural', '38 x 30 x 40', 3.2, 0.04, '6 pcs / carton', 300, 'stool', WOOD.natural, 'Kids', 'Coastal', 28, 6, 4, 1, 2, 2, 2, 3],
];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Products');
ws.columns = [
  { header: 'Product ID', width: 12 }, { header: 'Product Name', width: 26 }, { header: 'Category', width: 12 }, { header: 'Sub Category', width: 15 },
  { header: 'Description', width: 40 }, { header: 'Material', width: 14 }, { header: 'Wood Type', width: 11 }, { header: 'Finish / Colour', width: 15 },
  { header: 'Dimensions (cm)', width: 15 }, { header: 'Weight (kg)', width: 11 }, { header: 'CBM', width: 7 }, { header: 'Packing Details', width: 28 },
  { header: 'MOQ', width: 7 }, { header: 'Image', width: 18 }, { header: 'Product Type', width: 13 }, { header: 'Collection', width: 14 },
  { header: 'As Discussed Rate ($)', width: 14 }, { header: 'Wood Cost (₹)', width: 13 }, { header: 'Wages (₹)', width: 11 },
  { header: 'Knobs / Handles (₹)', width: 13 }, { header: 'Tile / Glass (₹)', width: 12 }, { header: 'Iron (₹)', width: 10 },
  { header: 'HS Code', width: 11 },
];
ws.getRow(1).font = { bold: true };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } };

for (const [i, p] of PRODUCTS.entries()) {
  const [sku, name, cat, sub, desc, material, wood, finish, dims, weight, cbm, packing, moq, kind, colour, type, collection, price, raw, labour, hw, polish] = p;
  // Costs in rupees, as on the costing sheets (wood before wastage, wages, hardware).
  const row = ws.addRow([sku, name, cat, sub, desc, material, wood, finish, dims, weight, cbm, packing, moq, null, type, collection, price, raw * 75, labour * 70, hw * 30, polish > 10 ? polish * 20 : 0, 0, '9403.60']);
  row.height = 75;
  row.alignment = { vertical: 'middle', wrapText: true };
  const png = await sharp(svg(kind, colour, i)).resize(400, 320).jpeg({ quality: 85 }).toBuffer();
  const imageId = wb.addImage({ buffer: png, extension: 'jpeg' });
  ws.addImage(imageId, { tl: { col: 13.05, row: row.number - 1 + 0.05 }, ext: { width: 120, height: 96 } });
  // A second, alternate-angle picture for the first product to show multi-image import.
  if (i === 0) {
    const alt = await sharp(svg('sideTable', colour, 1)).resize(400, 320).jpeg({ quality: 85 }).toBuffer();
    ws.addImage(wb.addImage({ buffer: alt, extension: 'jpeg' }), { tl: { col: 13.75, row: row.number - 1 + 0.5 }, ext: { width: 50, height: 40 } });
  }
}

const out = path.join(outDir, 'sample-products.xlsx');
await wb.xlsx.writeFile(out);

// Loose image files named by SKU, to try the bulk image upload.
const imgDir = path.join(outDir, 'images');
fs.mkdirSync(imgDir, { recursive: true });
const extra = [['PRD-10027_2', 'chair', WOOD.walnut], ['PRD-10029_2', 'bookshelf', WOOD.acacia], ['PRD-10031_2', 'bench', WOOD.sheesham]];
for (const [name, kind, colour] of extra) await sharp(svg(kind, colour, 2)).jpeg({ quality: 85 }).toFile(path.join(imgDir, `${name}.jpg`));

console.log(`Wrote ${path.relative(root, out)} and ${extra.length} images in ${path.relative(root, imgDir)}`);
