// Generates samples/sample-costing.xlsx: a costing workbook with fictional products — a product
// list sheet, a wood rate table and one costing sheet per product — to try the costing workbook
// import (npm run sample). Every formula is written with its calculated result, like Excel saves it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'samples', 'sample-costing.xlsx');

const LIST = 'PRODUCT LIST';
const USD = 78;
const CONTAINER_CBM = 65;
const PF_PER_CONTAINER = 350000;
const HARDWARE_RATES = { knobs: ['KNOBS/HANDLE', 'PC', 35], tile: ['TILE', 'SQ.FT', 180], iron: ['IRON', 'KG', 150], cnc: ['CNC', 'MIN', 2], kherad: ['KHERAD', 'PC', 60] };
// Wood rate (₹ per SFT) by piece length in inches.
const woodRate = (len) => (len <= 24 ? 42 : len <= 48 ? 52 : len <= 72 ? 62 : 72);

// [description, construction, size in cm (L x W x H), as discussed rate ($), wages (₹), hardware quantities]
const PRODUCTS = [
  ['MANGO WOOD 4 DOOR SIDEBOARD', 'case', [155, 45, 85], 240, 1100, { knobs: 4 }],
  ['ACACIA 6 DRAWER CHEST', 'case', [110, 45, 80], 185, 1000, { knobs: 6 }],
  ['WALL MOUNTED BEDSIDE SHELF', 'wall', [45, 35, 23], 40, 380, { knobs: 1, iron: 1.5 }],
  ['SOLID WOOD DINING TABLE 6 SEATER', 'table', [180, 90, 76], 260, 1300, {}],
  ['ROUND COFFEE TABLE', 'table', [80, 80, 42], 95, 550, {}],
  ['CONSOLE TABLE WITH 2 DRAWERS', 'table', [120, 38, 78], 120, 650, { knobs: 2 }],
  ['SLATTED DINING CHAIR', 'seat', [45, 52, 88], 55, 420, {}],
  ['COUNTER BAR STOOL', 'seat', [40, 40, 75], 42, 300, { iron: 2 }],
  ['ENTRYWAY BENCH WITH SHELF', 'seat', [120, 38, 46], 85, 500, {}],
  ['FIVE TIER BOOKSHELF', 'case', [80, 35, 180], 150, 800, {}],
  ['TV UNIT 2 DOOR 1 DRAWER', 'case', [140, 40, 55], 145, 750, { knobs: 3 }],
  ['NEST OF 2 SIDE TABLES', 'table', [50, 50, 55], 60, 400, {}],
  ['BAR CABINET WITH IRON FRAME', 'case', [90, 45, 110], 220, 1050, { knobs: 2, iron: 6 }],
  ['CANE DOOR CABINET', 'case', [80, 40, 120], 190, 950, { knobs: 2 }],
  ['FLUTED NIGHT STAND', 'case', [45, 40, 60], 58, 380, { knobs: 1, cnc: 30 }],
  ['MIRROR WITH CARVED FRAME', 'wall', [70, 4, 100], 65, 350, { tile: 4, cnc: 45 }],
  ['KIDS STUDY DESK', 'table', [100, 50, 75], 110, 600, { knobs: 1 }],
  ['DRESSING TABLE WITH MIRROR', 'case', [110, 40, 150], 210, 1000, { knobs: 3, tile: 3 }],
  ['COAT RACK 6 HOOKS', 'wall', [100, 8, 30], 25, 150, { iron: 1 }],
  ['HERRINGBONE COFFEE TABLE', 'table', [110, 60, 40], 135, 700, { cnc: 60 }],
  ['TURNED LEG SIDE TABLE', 'table', [45, 45, 55], 48, 320, { kherad: 4 }],
  ['WINE RACK 12 BOTTLE', 'case', [45, 35, 90], 70, 400, {}],
  ['MARBLE TOP SIDE TABLE', 'table', [50, 50, 55], 85, 380, { tile: 3 }],
  ['SHOE CABINET 3 TIER', 'case', [90, 35, 100], 125, 650, { knobs: 2 }],
];

const inch = (cm) => Math.round(cm / 2.54);
const len = (n) => Math.min(150, Math.max(6, n));
// Wood pieces [length, width, thickness (inches), qty] for each kind of construction.
function woodParts(kind, [l, w, h]) {
  const [L, W, H] = [inch(l), inch(w), inch(h)];
  if (kind === 'case') return [[L + 2, W + 1, 1, 1], [H + 1, W, 1, 2], [L, W, 1, 2], [L, H, 0.5, 1], [H, 3, 1, 4], [6, 3, 3, 4], [L, 3, 1, 2]];
  if (kind === 'table') return [[L + 2, W + 2, 1, 1], [H, 3, 3, 4], [L, 4, 1, 2], [W, 4, 1, 2]];
  if (kind === 'seat') return [[L + 1, W + 1, 1, 1], [H, 2, 2, 4], [L, 3, 1, 4], [W, 3, 1, 2]];
  return [[L + 1, Math.max(W, 4), 1, 2], [H + 1, Math.max(W, 4), 1, 2]];
}

const wb = new ExcelJS.Workbook();
wb.calcProperties = { fullCalcOnLoad: true };
const list = wb.addWorksheet(LIST);
const rates = wb.addWorksheet('RATE');

const F = (formula, result) => ({ formula, result });
const MONEY = '[$$-2809]#,##0';
list.columns = [
  { header: 'S.NO.', width: 8 }, { header: 'IMAGE', width: 12 }, { header: 'PRODUCT CODE', width: 15 }, { header: 'DESCRIPTION', width: 36 },
  { header: 'SIZE IN CM', width: 14 }, { header: 'SIZE IN INCH', width: 14 }, { header: 'PACKING SIZE', width: 14 }, { header: 'CBM', width: 10 },
  { header: 'PRICE ($)', width: 11 }, { header: 'PARAMETRIC RATE ($)', width: 20 }, { header: 'AS DISCUSSED RATE ($)', width: 22 },
  { header: 'WAGES', width: 10 }, { header: 'LOADABILITY FOR 40FT', width: 20 },
];
list.getRow(1).font = { bold: true };

rates.columns = [{ header: 'LENGTH', width: 10 }, { header: 'RATE', width: 10 }];
for (let n = 6; n <= 150; n++) rates.addRow([n, woodRate(n)]);

for (const [i, [name, kind, size, buyerPrice, wages, hw]] of PRODUCTS.entries()) {
  const code = `DF${20001 + i}`;
  const r = i + 2; // row on the product list
  const ref = `'${LIST}'!`;
  const packing = size.map((d) => d + 5);
  const cbm = (packing[0] * packing[1] * packing[2]) / 1000000;
  const ws = wb.addWorksheet(code);
  ws.columns = [22, 9, 9, 9, 13, 9, 22, 11, 6].map((width) => ({ width }));
  const set = (addr, v, numFmt) => {
    ws.getCell(addr).value = v;
    if (numFmt) ws.getCell(addr).numFmt = numFmt;
  };

  // Header: description and code come from the product list.
  set('D1', 'DESCRIPTION'); set('F1', F(`${ref}D${r}`, name));
  set('D2', 'PRODUCT CODE'); set('F2', F(`${ref}C${r}`, code));
  ['B3', 'C3', 'D3', 'E3', 'F3'].forEach((a, k) => set(a, ['L', 'W', 'H', 'CBM', 'LOADABILITY'][k]));
  set('A4', 'PRODUCT SIZE'); set('B4', F(`INDEX(${ref}E:E,MATCH(F2,${ref}C:C,0))`, size.join('X')));
  set('A5', 'PACKING SIZE'); set('B5', F(`INDEX(${ref}G:G,MATCH(F2,${ref}C:C,0))`, packing.join('X')));
  set('A6', 'CBM'); set('B6', packing[0]); set('C6', packing[1]); set('D6', packing[2]);
  set('E6', F('B6*C6*D6/1000000', cbm), '0.000'); set('F6', F(`${CONTAINER_CBM}/E6`, CONTAINER_CBM / cbm), '0');
  ['A1:C2', 'D1:E1', 'D2:E2', 'F1:G1', 'F3:G3', 'B4:D4', 'B5:D5', 'F6:G6'].forEach((m) => ws.mergeCells(m));
  ['L', 'W', 'H', 'QTY', 'SFT', 'RATE', 'TOTAL'].forEach((t, k) => set(`${'ABCDEFG'[k]}7`, t));

  // Wood pieces: SFT = L × W × H ÷ 144 × QTY, rate looked up by length.
  let row = 8;
  let sft = 0;
  let wood = 0;
  for (const [l, w, t, qty] of woodParts(kind, size)) {
    const L = len(l);
    const e = (L * w * t) / 144 * qty;
    const rate = woodRate(L);
    set(`A${row}`, L); set(`B${row}`, w); set(`C${row}`, t); set(`D${row}`, qty);
    set(`E${row}`, F(`SUM(A${row}*B${row}*C${row}/144*D${row})`, e));
    set(`F${row}`, F(`INDEX(RATE!B:B,MATCH(A${row},RATE!A:A,0))`, rate));
    set(`G${row}`, F(`SUM(E${row}*F${row})`, e * rate), '0.00');
    sft += e;
    wood += e * rate;
    row++;
  }
  const first = 8;
  const totalWood = row;
  set(`A${row}`, 'TOTAL WOOD'); set(`E${row}`, F(`SUM(E${first}:E${row - 1})`, sft)); set(`G${row}`, F(`SUM(G${first}:G${row - 1})`, wood), '0.00');
  row++;
  const wastage = wood * 0.2;
  set(`A${row}`, 'WASTAGE 20%'); set(`E${row}`, F(`+E${totalWood}*0.2`, sft * 0.2), '0.000'); set(`G${row}`, F(`+G${totalWood}*0.2`, wastage), '0.00');
  row++;
  const consumption = wood + wastage;
  const consRow = row;
  set(`A${row}`, 'TOTAL WOOD CONSUMP.'); set(`E${row}`, F(`SUM(E${totalWood}:E${row - 1})`, sft * 1.2), '0.00'); set(`G${row}`, F(`SUM(G${totalWood}:G${row - 1})`, consumption), '0.00');
  row++;
  set(`A${row}`, 'WAGES'); set(`G${row}`, F(`INDEX(${ref}L:L,MATCH(F2,${ref}C:C,0))`, wages), '0.00');
  row++;
  const kfd = consumption * 0.08;
  set(`A${row}`, 'KFD 8%'); set(`G${row}`, F(`G${consRow}*8%`, kfd), '0.00');
  row++;
  const base = consumption + wages + kfd;
  const baseRow = row;
  set(`A${row}`, 'TOTAL'); set(`G${row}`, F(`SUM(G${consRow}:G${row - 1})`, base), '0.00');
  row++;
  const trade = base * 0.1;
  set(`A${row}`, 'TRAD MARGIN/ 10%'); set(`G${row}`, F(`G${baseRow}*10%`, trade), '0.00');
  row++;
  const purchaseRow = row;
  set(`A${row}`, 'TOTAL PURCHASE'); set(`G${row}`, F(`G${row - 1}+G${baseRow}`, base + trade), '0.00');
  row++;

  // Hardware: quantity × rate. Knobs, tile, iron and CNC rows are always there; kherad only when used.
  const hwRows = [];
  let hardware = 0;
  for (const key of ['knobs', 'tile', 'iron', 'cnc', 'kherad']) {
    if (key === 'kherad' && !hw.kherad) continue;
    const [label, unit, rate] = HARDWARE_RATES[key];
    const qty = hw[key] || 0;
    set(`A${row}`, label); set(`C${row}`, qty); set(`D${row}`, unit); set(`F${row}`, rate);
    set(`G${row}`, F(`C${row}*F${row}`, qty * rate), '0.00');
    hardware += qty * rate;
    hwRows.push(row);
    row++;
  }

  // Polish & packing: the cost per container shared by CBM.
  const polish = PF_PER_CONTAINER / (CONTAINER_CBM / cbm);
  const polishRow = row;
  set(`A${row}`, 'POLISH P & F'); set(`D${row}`, 'FIX'); set(`E${row}`, F('E6', cbm), '0.00');
  set(`F${row}`, F(`${CONTAINER_CBM}/E${row}`, CONTAINER_CBM / cbm)); set(`G${row}`, F(`${PF_PER_CONTAINER}/F${row}`, polish), '0.00');
  row++;
  const subtotal = base + trade + hardware + polish;
  const subRow = row;
  set(`A${row}`, 'TOTAL'); set(`G${row}`, F(`SUM(G${purchaseRow}:G${row - 1})`, subtotal), '0.00'); set(`H${row}`, F(`+G${row}/${USD}`, subtotal / USD), '0.00'); set(`I${row}`, `@${USD}`);
  row++;
  const oh = subtotal * 0.15;
  const ohRow = row;
  set(`A${row}`, 'OH 15%'); set(`G${row}`, F(`G${subRow}*15%`, oh), '0.00');
  row++;
  set(`A${row}`, 'MISC 15%'); set(`G${row}`, F(`G${subRow}*15%`, oh), '0.00');
  row++;
  const beforeMargin = subtotal + oh * 2;
  set(`A${row}`, 'TOTAL'); set(`G${row}`, F(`SUM(G${subRow}:G${row - 1})`, beforeMargin), '0.00'); set(`H${row}`, F(`+G${row}/${USD}`, beforeMargin / USD), '0.00');
  row++;
  const margin = beforeMargin * 0.2;
  const marginRow = row;
  set(`A${row}`, 'MARGIN 20%'); set(`G${row}`, F(`G${row - 1}*0.2`, margin), '0.00');
  row++;
  const total = beforeMargin + margin;
  set(`A${row}`, 'TOTAL COSTING'); set(`G${row}`, F(`G${row - 2}+G${row - 1}`, total), '0'); set(`H${row}`, F(`+G${row}/${USD}`, total / USD), '0.00'); set(`I${row}`, `@${USD}`);
  row++;
  // Parametric costing leaves out the trade margin and misc.
  const parametric = base + hardware + polish + oh + margin;
  const paramFormula = [baseRow, ...hwRows, polishRow, ohRow, marginRow].map((n) => `G${n}`).join('+');
  set(`A${row}`, 'PARAMETRIC COSTING'); set(`G${row}`, F(paramFormula, parametric), '0'); set(`H${row}`, F(`+G${row}/${USD}`, parametric / USD), '0.00'); set(`I${row}`, `@${USD}`);
  ws.getColumn(1).font = { bold: true };

  // Product list row: CBM and prices read back from the costing sheet.
  const sheet = `'${code}'!`;
  const lr = list.addRow([
    i + 1, null, code, name, size.join('X'), size.map(inch).join('X'), packing.join('X'),
    F(`${sheet}E${polishRow}`, cbm),
    F(`INDEX(${sheet}H:H,MATCH("TOTAL COSTING",${sheet}A:A,0))`, total / USD),
    F(`INDEX(${sheet}H:H,MATCH("PARAMETRIC COSTING",${sheet}A:A,0))`, parametric / USD),
    buyerPrice, wages,
    F(`${CONTAINER_CBM}/H${r}`, CONTAINER_CBM / cbm),
  ]);
  lr.getCell(8).numFmt = '0.000';
  [9, 10, 11].forEach((c) => { lr.getCell(c).numFmt = MONEY; });
  lr.getCell(13).numFmt = '0';
}

await wb.xlsx.writeFile(out);
console.log(`Wrote ${path.relative(root, out)} with ${PRODUCTS.length} costing sheets`);
