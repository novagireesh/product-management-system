import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { LAYOUTS, contactLine, fit, formatDate, tint } from './data.js';

const INK = '#1d2433';
const BODY = '#374151';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const PANEL = '#f4f5f7';

// The built-in PDF fonts only cover the WinAnsi character set; map or drop anything else.
const safe = (s) =>
  String(s ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[³]/g, '³')
    .replace(/[^\x20-\x7E\xA0-\xFF\n€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '');

const DENSITY = {
  full: { sku: 9, name: 21, desc: 9.5, row: 9.5, rowH: 21, code: 86, gap: 26 },
  medium: { sku: 7.5, name: 13.5, desc: 8.3, row: 8.3, rowH: 15.5, code: 60, gap: 14 },
  compact: { sku: 6.5, name: 10.5, desc: 7.2, row: 7.2, rowH: 12.5, code: 46, gap: 10 },
};

function line(doc, x1, y1, x2, y2, color = LINE, width = 0.6) {
  doc.save().moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke().restore();
}

function imageInBox(doc, img, box, pad = 0) {
  const f = fit(img.width, img.height, box.w - pad * 2, box.h - pad * 2);
  doc.image(img.buffer, box.x + pad + f.dx, box.y + pad + f.dy, { width: f.w, height: f.h });
}

function coverImage(doc, img, box) {
  doc.save();
  doc.rect(box.x, box.y, box.w, box.h).clip();
  const s = Math.max(box.w / img.width, box.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  doc.image(img.buffer, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, { width: w, height: h });
  doc.restore();
}

/** Single-line text that never wraps or overflows. */
function oneLine(doc, text, x, y, width, opts = {}) {
  doc.text(safe(text), x, y, { width, height: doc.currentLineHeight(true) + 1, ellipsis: true, lineBreak: true, ...opts });
}

function drawLogoOrName(ctx, x, y, maxW, maxH, onDark) {
  const { doc, data } = ctx;
  if (data.logo) {
    if (onDark) {
      const padX = 8;
      const f = fit(data.logo.width, data.logo.height, maxW - padX * 2, maxH - 8);
      doc.roundedRect(x, y, f.w + padX * 2, maxH, 4).fill('#ffffff');
      doc.image(data.logo.buffer, x + padX, y + 4 + f.dy, { width: f.w, height: f.h });
      return f.w + padX * 2;
    }
    const f = fit(data.logo.width, data.logo.height, maxW, maxH);
    doc.image(data.logo.buffer, x, y + f.dy, { width: f.w, height: f.h });
    return f.w;
  }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(onDark ? '#ffffff' : INK);
  oneLine(doc, data.company.name, x, y + maxH / 2 - 8, maxW);
  return Math.min(doc.widthOfString(safe(data.company.name)), maxW);
}

function drawCover(ctx) {
  const { doc, data, opts, W, H, brand } = ctx;
  doc.addPage();
  const hero = data.products.find((p) => p.main)?.main;
  const prepared = data.buyer ? [data.buyer.name, data.buyer.company].filter(Boolean).join(' · ') : null;
  const meta = `${formatDate(data.generatedAt)}   ·   ${data.products.length} product${data.products.length === 1 ? '' : 's'}`;

  if (opts.template === 'simple') {
    if (data.logo) {
      const f = fit(data.logo.width, data.logo.height, 220, 90);
      doc.image(data.logo.buffer, (W - f.w) / 2, H * 0.16 + f.dy, { width: f.w, height: f.h });
    } else {
      doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(safe(data.company.name), 0, H * 0.2, { width: W, align: 'center' });
    }
    doc.font('Helvetica').fontSize(9).fillColor(brand).text('PRODUCT CATALOGUE', 0, H * 0.4, { width: W, align: 'center', characterSpacing: 2.5 });
    doc.font('Helvetica-Bold').fontSize(30).fillColor(INK).text(safe(opts.title), W * 0.12, H * 0.4 + 22, { width: W * 0.76, align: 'center' });
    let y = doc.y + 8;
    if (opts.subtitle) {
      doc.font('Helvetica').fontSize(13).fillColor(MUTED).text(safe(opts.subtitle), W * 0.15, y, { width: W * 0.7, align: 'center' });
      y = doc.y + 8;
    }
    doc.rect(W / 2 - 30, y + 6, 60, 2.5).fill(brand);
    y += 26;
    if (prepared) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Prepared for', 0, y, { width: W, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(safe(prepared), 0, doc.y + 2, { width: W, align: 'center' });
      y = doc.y + 10;
    }
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(safe(meta), 0, y, { width: W, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(safe(data.company.name), 0, H - 74, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(safe(contactLine(data.company)), 0, H - 58, { width: W, align: 'center' });
    if (data.company.address) doc.text(safe(data.company.address), 0, H - 45, { width: W, align: 'center' });
    return;
  }

  // Premium / buyer: brand panel + hero image.
  const landscape = W > H;
  const panel = landscape ? { x: 0, y: 0, w: W * 0.42, h: H } : { x: 0, y: H * 0.5, w: W, h: H * 0.5 };
  const heroBox = landscape ? { x: panel.w, y: 0, w: W - panel.w, h: H } : { x: 0, y: 0, w: W, h: H * 0.5 };
  doc.rect(heroBox.x, heroBox.y, heroBox.w, heroBox.h).fill('#' + tint(ctx.brandHex, 0.9));
  if (hero) coverImage(doc, hero, heroBox);
  doc.rect(panel.x, panel.y, panel.w, panel.h).fill(brand);

  const pad = landscape ? 44 : 40;
  const x = panel.x + pad;
  const w = panel.w - pad * 2;
  let y = panel.y + pad;
  drawLogoOrName(ctx, x, y, 170, 52, true);
  y = landscape ? H * 0.34 : panel.y + 100;
  const soft = '#' + tint(ctx.brandHex, 0.62);
  doc.font('Helvetica').fontSize(9).fillColor(soft).text('PRODUCT CATALOGUE', x, y, { width: w, characterSpacing: 2.5 });
  doc.font('Helvetica-Bold').fontSize(landscape ? 30 : 26).fillColor('#ffffff').text(safe(opts.title), x, y + 18, { width: w, height: 120, ellipsis: true });
  y = doc.y + 6;
  if (opts.subtitle) {
    doc.font('Helvetica').fontSize(12.5).fillColor('#' + tint(ctx.brandHex, 0.8)).text(safe(opts.subtitle), x, y, { width: w, height: 60, ellipsis: true });
    y = doc.y + 6;
  }
  doc.rect(x, y + 8, 46, 2.5).fill('#ffffff');
  y += 26;
  if (prepared) {
    doc.font('Helvetica').fontSize(9).fillColor(soft).text('PREPARED FOR', x, y, { width: w, characterSpacing: 1.5 });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(safe(prepared), x, doc.y + 3, { width: w });
    y = doc.y + 10;
  }
  doc.font('Helvetica').fontSize(9.5).fillColor(soft).text(safe(meta), x, y, { width: w });

  const by = panel.y + panel.h - pad - 44;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#ffffff').text(safe(data.company.name), x, by, { width: w });
  doc.font('Helvetica').fontSize(8).fillColor(soft);
  if (data.company.tagline) oneLine(doc, data.company.tagline, x, doc.y + 1, w);
  oneLine(doc, contactLine(data.company), x, doc.y + 4, w);
}

function drawHeader(ctx) {
  const { doc, data, opts, W, brand } = ctx;
  const right = opts.title + (data.buyer ? `  ·  Prepared for ${data.buyer.company || data.buyer.name}` : '');
  if (ctx.premium) {
    doc.rect(0, 0, W, 50).fill(brand);
    const used = drawLogoOrName(ctx, 32, 9, data.logo ? 140 : W * 0.42, 32, true);
    if (data.logo) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#ffffff');
      oneLine(doc, data.company.name, 32 + used + 12, 19, W * 0.4);
    }
    doc.font('Helvetica').fontSize(9).fillColor('#' + tint(ctx.brandHex, 0.75));
    oneLine(doc, right, W * 0.45, 20, W * 0.55 - 32, { align: 'right' });
  } else {
    drawLogoOrName(ctx, 32, 12, data.logo ? 120 : W * 0.38, 28, false);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    oneLine(doc, right, W * 0.4, 21, W * 0.6 - 32, { align: 'right' });
    line(doc, 32, 50, W - 32, 50, LINE, 0.8);
  }
}

function drawFooter(ctx, page, total) {
  const { doc, data, W, H } = ctx;
  line(doc, 32, H - 32, W - 32, H - 32);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
  oneLine(doc, data.company.footer || contactLine(data.company) || data.company.name, 32, H - 23, W * 0.7);
  oneLine(doc, `Page ${page} of ${total}`, W - 132, H - 23, 100, { align: 'right' });
}

function cellBoxes(ctx, perPage) {
  const { W, H } = ctx;
  const x = 32;
  const y = 68;
  const w = W - 64;
  const h = H - 32 - 14 - y;
  const g = 16;
  if (perPage === 1) return [{ x, y, w, h }];
  if (perPage === 2) {
    return W > H
      ? [{ x, y, w: (w - g) / 2, h }, { x: x + (w + g) / 2, y, w: (w - g) / 2, h }]
      : [{ x, y, w, h: (h - g) / 2 }, { x, y: y + (h + g) / 2, w, h: (h - g) / 2 }];
  }
  const cw = (w - g) / 2;
  const ch = (h - g) / 2;
  return [
    { x, y, w: cw, h: ch },
    { x: x + cw + g, y, w: cw, h: ch },
    { x, y: y + ch + g, w: cw, h: ch },
    { x: x + cw + g, y: y + ch + g, w: cw, h: ch },
  ];
}

function drawImages(ctx, p, box, density) {
  const { doc } = ctx;
  const extras = density === 'full' && ctx.premium ? p.extras : [];
  const stripH = extras.length ? Math.min(70, box.h * 0.16) : 0;
  const main = { x: box.x, y: box.y, w: box.w, h: box.h - (stripH ? stripH + 8 : 0) };
  doc.roundedRect(main.x, main.y, main.w, main.h, 6).fill(PANEL);
  if (p.main) imageInBox(doc, p.main, main, density === 'compact' ? 6 : 14);
  else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No image', main.x, main.y + main.h / 2 - 5, { width: main.w, align: 'center' });
  }
  if (stripH) {
    const n = 4;
    const tw = (box.w - (n - 1) * 8) / n;
    extras.forEach((img, i) => {
      const t = { x: box.x + i * (tw + 8), y: main.y + main.h + 8, w: tw, h: stripH };
      doc.roundedRect(t.x, t.y, t.w, t.h, 4).fill(PANEL);
      imageInBox(doc, img, t, 4);
    });
  }
}

function drawInfo(ctx, p, box, density) {
  const { doc, brand, opts } = ctx;
  const s = DENSITY[density];
  const codeImg = p.qr || p.barcode;
  const isBar = Boolean(p.barcode);
  const codeW = isBar ? s.code * 2 : s.code;
  const codeH = isBar ? s.code * 0.75 : s.code;
  const codeRight = codeImg && box.w > box.h * 1.25;
  const textW = codeRight ? box.w - codeW - 14 : box.w;
  const bottom = box.y + box.h - (codeImg && !codeRight ? codeH + 20 : 0);
  let y = box.y;

  doc.font('Helvetica-Bold').fontSize(s.sku).fillColor(brand);
  oneLine(doc, p.sku.toUpperCase(), box.x, y, textW, { characterSpacing: 1 });
  y += s.sku + 5;

  doc.font('Helvetica-Bold').fontSize(s.name).fillColor(INK);
  const name = safe(p.name);
  const nameH = Math.min(doc.heightOfString(name, { width: textW }), s.name * 1.2 * 2 + 1);
  doc.text(name, box.x, y, { width: textW, height: nameH, ellipsis: true });
  y += nameH + 3;
  doc.rect(box.x, y + 3, density === 'full' ? 34 : 22, 2).fill(brand);
  y += density === 'full' ? 16 : 11;

  if (p.price) {
    const size = density === 'full' ? 17 : density === 'medium' ? 12.5 : 10;
    doc.font('Helvetica').fontSize(size * 0.55).fillColor(MUTED);
    oneLine(doc, p.price.label.toUpperCase(), box.x, y, textW, { characterSpacing: 0.8 });
    y += size * 0.55 + 3;
    doc.font('Helvetica-Bold').fontSize(size).fillColor(brand);
    oneLine(doc, p.price.text, box.x, y, textW);
    y += size + (density === 'full' ? 12 : 7);
  }

  if (p.description && density !== 'compact') {
    doc.font('Helvetica').fontSize(s.desc).fillColor(BODY);
    const desc = safe(p.description);
    const maxH = density === 'full' ? (opts.template === 'premium' ? 96 : 64) : 34;
    const h = Math.min(doc.heightOfString(desc, { width: textW, lineGap: 1.5 }), maxH);
    doc.text(desc, box.x, y, { width: textW, height: h, ellipsis: true, lineGap: 1.5 });
    y += h + (density === 'full' ? 12 : 7);
  }

  const labelW = Math.min(textW * 0.4, density === 'full' ? 118 : 84);
  const valueW = textW - labelW - 8;
  const padY = (s.rowH - s.row) / 2 - 1;
  for (const f of p.fields) {
    doc.font('Helvetica-Bold').fontSize(s.row);
    const value = safe(f.value);
    const vh = Math.min(doc.heightOfString(value, { width: valueW }), s.row * 1.2 * (density === 'full' ? 3 : 2) + 1);
    const rowH = Math.max(s.rowH, vh + padY * 2 + 2);
    if (y + rowH > bottom) break;
    doc.font('Helvetica').fontSize(s.row).fillColor(MUTED);
    oneLine(doc, f.label, box.x, y + padY, labelW);
    doc.font('Helvetica-Bold').fontSize(s.row).fillColor(INK).text(value, box.x + labelW + 8, y + padY, { width: valueW, height: vh, ellipsis: true });
    y += rowH;
    line(doc, box.x, y, box.x + textW, y, LINE, 0.5);
  }

  if (codeImg) {
    const cx = box.x + box.w - codeW;
    const cy = codeRight ? box.y : box.y + box.h - codeH - 14;
    doc.image(codeImg, cx, cy, { fit: [codeW, codeH], align: 'center', valign: 'center' });
    if (!isBar) {
      doc.font('Helvetica').fontSize(Math.max(6, s.row - 2)).fillColor(MUTED);
      oneLine(doc, 'Scan for details', cx - 10, cy + codeH + 2, codeW + 20, { align: 'center' });
    }
  }
}

function drawProduct(ctx, p, cell, perPage) {
  const { doc } = ctx;
  const density = perPage === 1 ? 'full' : perPage === 2 ? 'medium' : 'compact';
  const s = DENSITY[density];
  let box = cell;
  if (perPage > 1) {
    doc.roundedRect(cell.x, cell.y, cell.w, cell.h, 8).lineWidth(0.7).strokeColor(LINE).stroke();
    box = { x: cell.x + 12, y: cell.y + 12, w: cell.w - 24, h: cell.h - 24 };
  }
  const side = box.w > box.h * 1.2;
  let img;
  let info;
  if (side) {
    const iw = box.w * (density === 'full' ? 0.57 : 0.5);
    img = { x: box.x, y: box.y, w: iw, h: box.h };
    info = { x: box.x + iw + s.gap, y: box.y + (density === 'full' ? 8 : 0), w: box.w - iw - s.gap, h: box.h - (density === 'full' ? 8 : 0) };
  } else {
    const ih = box.h * (density === 'full' ? 0.54 : 0.55);
    img = { x: box.x, y: box.y, w: box.w, h: ih };
    info = { x: box.x, y: box.y + ih + s.gap * 0.8, w: box.w, h: box.h - ih - s.gap * 0.8 };
  }
  drawImages(ctx, p, img, density);
  drawInfo(ctx, p, info, density);
}

export async function renderPdf(data, opts, outFile) {
  const landscape = opts.orientation !== 'portrait';
  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: 0,
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: safe(opts.title), Author: safe(data.company.name), Creator: 'Product Management System' },
  });
  const stream = fs.createWriteStream(outFile);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(stream);

  const W = landscape ? 841.89 : 595.28;
  const H = landscape ? 595.28 : 841.89;
  const ctx = { doc, data, opts, W, H, brand: '#' + data.brand, brandHex: data.brand, premium: opts.template !== 'simple' };

  if (opts.cover !== false) drawCover(ctx);
  const perPage = LAYOUTS[opts.layout] || 1;
  for (let i = 0; i < data.products.length; i += perPage) {
    doc.addPage();
    drawHeader(ctx);
    const cells = cellBoxes(ctx, perPage);
    data.products.slice(i, i + perPage).forEach((p, j) => drawProduct(ctx, p, cells[j], perPage));
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    if (i === 0 && opts.cover !== false) continue;
    doc.switchToPage(i);
    drawFooter(ctx, i + 1, range.count);
  }
  doc.end();
  await done;
}
