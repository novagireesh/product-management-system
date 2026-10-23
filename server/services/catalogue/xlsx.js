import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { contactLine, fit, formatDate } from './data.js';

const PX_PER_CHAR = 7.2; // approx. Excel column width unit in pixels
const PT_PER_PX = 0.75;

export async function renderXlsx(data, opts, outFile) {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.company.name;
  wb.title = opts.title;
  wb.created = data.generatedAt;
  const ws = wb.addWorksheet('Catalogue', {
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const withCode = Boolean(opts.code && opts.code !== 'none');
  const fieldCols = data.selectedFields.filter((k) => k !== 'description');
  const hasDesc = data.selectedFields.includes('description');
  const columns = [
    { header: '#', key: 'n', width: 5 },
    { header: 'Image', key: 'image', width: 20 },
    { header: 'Product ID', key: 'sku', width: 16 },
    { header: 'Product Name', key: 'name', width: 30 },
    ...(data.price ? [{ header: `${data.price.label} (${data.price.currency})`, key: 'price', width: 14 }] : []),
    ...(hasDesc ? [{ header: 'Description', key: 'description', width: 42 }] : []),
    ...fieldCols.map((k) => ({ header: data.fieldLabels.get(k) || k, key: k, width: Math.min(28, Math.max(12, (data.fieldLabels.get(k) || k).length + 4)) })),
    ...(withCode ? [{ header: opts.code === 'barcode' ? 'Barcode' : 'QR Code', key: 'code', width: opts.code === 'barcode' ? 26 : 16 }] : []),
    { header: 'Product Page', key: 'url', width: 30 },
  ];
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
  const lastCol = columns.length;
  const brand = 'FF' + data.brand.toUpperCase();

  // Title block
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = data.company.name;
  ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: brand } };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = opts.title + (opts.subtitle ? ` — ${opts.subtitle}` : '');
  ws.getCell(2, 1).font = { bold: true, size: 13 };
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = [
    data.buyer ? `Prepared for: ${[data.buyer.name, data.buyer.company].filter(Boolean).join(', ')}` : null,
    formatDate(data.generatedAt),
    `${data.products.length} products`,
  ].filter(Boolean).join('   |   ');
  ws.getCell(3, 1).font = { size: 10, color: { argb: 'FF6B7280' } };
  ws.mergeCells(4, 1, 4, lastCol);
  ws.getCell(4, 1).value = contactLine(data.company);
  ws.getCell(4, 1).font = { size: 10, color: { argb: 'FF6B7280' } };

  if (data.logo) {
    const f = fit(data.logo.width, data.logo.height, 180, 60);
    const png = await sharp(data.logo.buffer).png().toBuffer();
    const id = wb.addImage({ buffer: png, extension: 'png' });
    ws.addImage(id, { tl: { col: lastCol - 1.6, row: 0.1 }, ext: { width: f.w, height: f.h }, editAs: 'absolute' });
  }

  const headerRow = ws.getRow(6);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  headerRow.height = 24;
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: lastCol } };

  const ROW_PX = 110;
  const imgCol = columns.findIndex((c) => c.key === 'image');
  const codeCol = columns.findIndex((c) => c.key === 'code');
  for (const [i, p] of data.products.entries()) {
    const values = { n: i + 1, sku: p.sku, name: p.name, url: { text: 'Open', hyperlink: p.url } };
    if (data.price) values.price = p.price?.value ?? null;
    if (hasDesc) values.description = p.description || '';
    for (const f of p.fields) values[f.key] = f.value;
    const row = ws.addRow(values);
    const r = row.number;
    row.height = ROW_PX * PT_PER_PX;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.font = { size: 10 };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });
    row.getCell('sku').font = { bold: true, size: 10, color: { argb: brand } };
    row.getCell('name').font = { bold: true, size: 10 };
    if (data.price) {
      row.getCell('price').numFmt = data.price.decimals === 0 ? '#,##0' : '#,##0.00';
      row.getCell('price').font = { bold: true, size: 10, color: { argb: brand } };
    }
    row.getCell('url').font = { size: 10, color: { argb: 'FF2563EB' }, underline: true };
    if (i % 2 === 1) row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });

    if (p.images[0]) {
      const thumb = await sharp(p.images[0].thumbPath).resize(260, 260, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true });
      const colPx = columns[imgCol].width * PX_PER_CHAR;
      const f = fit(thumb.info.width, thumb.info.height, colPx - 10, ROW_PX - 10);
      const id = wb.addImage({ buffer: thumb.data, extension: 'jpeg' });
      ws.addImage(id, { tl: { col: imgCol + (5 + f.dx) / colPx, row: r - 1 + (5 + f.dy) / ROW_PX }, ext: { width: f.w, height: f.h }, editAs: 'oneCell' });
    }
    const code = p.qr || p.barcode;
    if (code && codeCol >= 0) {
      const colPx = columns[codeCol].width * PX_PER_CHAR;
      const isBar = Boolean(p.barcode);
      const meta = await sharp(code).metadata();
      const f = fit(meta.width, meta.height, colPx - 12, isBar ? 60 : ROW_PX - 14);
      const id = wb.addImage({ buffer: code, extension: 'png' });
      ws.addImage(id, { tl: { col: codeCol + (6 + f.dx) / colPx, row: r - 1 + (ROW_PX - f.h) / 2 / ROW_PX }, ext: { width: f.w, height: f.h }, editAs: 'oneCell' });
    }
  }

  await wb.xlsx.writeFile(outFile);
}
