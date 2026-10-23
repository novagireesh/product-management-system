import fs from 'node:fs';
import PptxGenJS from 'pptxgenjs';
import { LAYOUTS, contactLine, fit, formatDate, tint } from './data.js';

const INK = '1D2433';
const BODY = '374151';
const MUTED = '6B7280';
const LINE = 'E5E7EB';
const PANEL = 'F4F5F7';
const FONT = 'Calibri';
const W = 13.333;
const H = 7.5;

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const b64 = (img, mime = 'image/jpeg') => `${mime};base64,${img.toString('base64')}`;

function addFitted(slide, img, box, pad = 0, mime = 'image/jpeg') {
  const f = fit(img.width, img.height, box.w - pad * 2, box.h - pad * 2);
  slide.addImage({ data: b64(img.buffer, mime), x: box.x + pad + f.dx, y: box.y + pad + f.dy, w: f.w, h: f.h });
}

function addLogo(ctx, slide, x, y, maxW, maxH, onDark) {
  const { data } = ctx;
  if (data.logo) {
    const f = fit(data.logo.width, data.logo.height, maxW - (onDark ? 0.2 : 0), maxH - (onDark ? 0.1 : 0));
    if (onDark) {
      slide.addShape(ctx.pres.shapes.ROUNDED_RECTANGLE, { x, y, w: f.w + 0.2, h: maxH, fill: { color: 'FFFFFF' }, line: { color: 'FFFFFF' }, rectRadius: 0.06 });
      slide.addImage({ data: b64(data.logo.buffer, 'image/png'), x: x + 0.1, y: y + 0.05 + f.dy, w: f.w, h: f.h });
      return f.w + 0.2;
    }
    slide.addImage({ data: b64(data.logo.buffer, 'image/png'), x, y: y + f.dy, w: f.w, h: f.h });
    return f.w;
  }
  slide.addText(data.company.name, { x, y, w: maxW, h: maxH, fontFace: FONT, fontSize: 14, bold: true, color: onDark ? 'FFFFFF' : INK, valign: 'middle', margin: 0 });
  return maxW;
}

function cover(ctx) {
  const { pres, data, opts, brand } = ctx;
  const slide = pres.addSlide();
  const prepared = data.buyer ? [data.buyer.name, data.buyer.company].filter(Boolean).join(' · ') : null;
  const meta = `${formatDate(data.generatedAt)}   ·   ${data.products.length} product${data.products.length === 1 ? '' : 's'}`;
  const hero = data.products.find((p) => p.main)?.main;

  if (opts.template === 'simple') {
    slide.background = { color: 'FFFFFF' };
    if (data.logo) {
      const f = fit(data.logo.width, data.logo.height, 3, 1.1);
      slide.addImage({ data: b64(data.logo.buffer, 'image/png'), x: (W - f.w) / 2, y: 1.0 + f.dy, w: f.w, h: f.h });
    }
    slide.addText('PRODUCT CATALOGUE', { x: 0, y: 2.7, w: W, h: 0.35, align: 'center', fontFace: FONT, fontSize: 12, color: brand, charSpacing: 4 });
    slide.addText(opts.title, { x: 1.5, y: 3.05, w: W - 3, h: 1.0, align: 'center', fontFace: FONT, fontSize: 36, bold: true, color: INK, valign: 'middle' });
    if (opts.subtitle) slide.addText(opts.subtitle, { x: 2, y: 4.05, w: W - 4, h: 0.45, align: 'center', fontFace: FONT, fontSize: 16, color: MUTED });
    slide.addShape(pres.shapes.RECTANGLE, { x: W / 2 - 0.4, y: 4.65, w: 0.8, h: 0.04, fill: { color: brand }, line: { color: brand } });
    if (prepared) slide.addText([{ text: 'Prepared for  ', options: { color: MUTED } }, { text: prepared, options: { bold: true, color: INK } }], { x: 0, y: 4.85, w: W, h: 0.4, align: 'center', fontFace: FONT, fontSize: 14 });
    slide.addText(meta, { x: 0, y: 5.3, w: W, h: 0.35, align: 'center', fontFace: FONT, fontSize: 12, color: MUTED });
    slide.addText([{ text: data.company.name, options: { bold: true, color: INK, breakLine: true } }, { text: contactLine(data.company), options: { color: MUTED } }], { x: 0, y: 6.45, w: W, h: 0.6, align: 'center', fontFace: FONT, fontSize: 11 });
    return;
  }

  const pw = W * 0.42;
  slide.addShape(pres.shapes.RECTANGLE, { x: pw, y: 0, w: W - pw, h: H, fill: { color: tint(brand, 0.9) }, line: { color: tint(brand, 0.9) } });
  if (hero) {
    // Cover-crop the hero image to the right-hand area. pptxgenjs derives the crop from the
    // ratio of w/h (the image's natural size, scaled) against sizing.w/h (the frame).
    const box = { w: W - pw, h: H };
    const s = Math.max(box.w / hero.width, box.h / hero.height);
    slide.addImage({
      data: b64(hero.buffer), x: pw, y: 0, w: hero.width * s, h: hero.height * s,
      sizing: { type: 'cover', w: box.w, h: box.h },
    });
  }
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: pw, h: H, fill: { color: brand }, line: { color: brand } });
  const x = 0.6;
  const w = pw - 1.2;
  addLogo(ctx, slide, x, 0.55, 2.4, 0.75, true);
  const soft = tint(brand, 0.62);
  slide.addText('PRODUCT CATALOGUE', { x, y: 2.35, w, h: 0.3, fontFace: FONT, fontSize: 11, color: soft, charSpacing: 4, margin: 0 });
  slide.addText(opts.title, { x, y: 2.7, w, h: 1.25, fontFace: FONT, fontSize: opts.title.length > 40 ? 28 : 34, bold: true, color: 'FFFFFF', valign: 'top', margin: 0 });
  let y = 4.0;
  if (opts.subtitle) {
    slide.addText(opts.subtitle, { x, y, w, h: 0.5, fontFace: FONT, fontSize: 15, color: tint(brand, 0.8), valign: 'top', margin: 0 });
    y += 0.55;
  }
  slide.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.05, w: 0.6, h: 0.04, fill: { color: 'FFFFFF' }, line: { color: 'FFFFFF' } });
  y += 0.25;
  if (prepared) {
    slide.addText([{ text: 'PREPARED FOR', options: { fontSize: 10, color: soft, charSpacing: 2, breakLine: true } }, { text: prepared, options: { fontSize: 16, bold: true, color: 'FFFFFF' } }], { x, y, w, h: 0.75, fontFace: FONT, valign: 'top', margin: 0 });
    y += 0.8;
  }
  slide.addText(meta, { x, y, w, h: 0.3, fontFace: FONT, fontSize: 11, color: soft, margin: 0 });
  slide.addText(
    [
      { text: data.company.name, options: { bold: true, color: 'FFFFFF', fontSize: 12, breakLine: true } },
      ...(data.company.tagline ? [{ text: data.company.tagline, options: { color: soft, fontSize: 10, breakLine: true } }] : []),
      { text: contactLine(data.company), options: { color: soft, fontSize: 10 } },
    ],
    { x, y: 6.2, w, h: 0.85, fontFace: FONT, valign: 'bottom', margin: 0 },
  );
}

function header(ctx, slide) {
  const { pres, data, opts, brand } = ctx;
  const right = opts.title + (data.buyer ? `  ·  Prepared for ${data.buyer.company || data.buyer.name}` : '');
  if (ctx.premium) {
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.62, fill: { color: brand }, line: { color: brand } });
    const used = addLogo(ctx, slide, 0.4, 0.1, data.logo ? 1.9 : 5.6, 0.42, true);
    if (data.logo) slide.addText(data.company.name, { x: 0.4 + used + 0.15, y: 0.1, w: 5, h: 0.42, fontFace: FONT, fontSize: 13, bold: true, color: 'FFFFFF', valign: 'middle', margin: 0 });
    slide.addText(right, { x: 6.4, y: 0.1, w: W - 6.8, h: 0.42, fontFace: FONT, fontSize: 11, color: tint(brand, 0.75), align: 'right', valign: 'middle', margin: 0 });
  } else {
    addLogo(ctx, slide, 0.4, 0.14, data.logo ? 1.7 : 4.8, 0.38, false);
    slide.addText(right, { x: 5.4, y: 0.14, w: W - 5.8, h: 0.38, fontFace: FONT, fontSize: 11, color: MUTED, align: 'right', valign: 'middle', margin: 0 });
    slide.addShape(pres.shapes.LINE, { x: 0.4, y: 0.64, w: W - 0.8, h: 0, line: { color: LINE, width: 1 } });
  }
}

function footer(ctx, slide, page, total) {
  const { pres, data } = ctx;
  slide.addShape(pres.shapes.LINE, { x: 0.4, y: 7.03, w: W - 0.8, h: 0, line: { color: LINE, width: 0.75 } });
  slide.addText(data.company.footer || contactLine(data.company) || data.company.name, { x: 0.4, y: 7.08, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, margin: 0, valign: 'middle' });
  slide.addText(`Page ${page} of ${total}`, { x: W - 2.4, y: 7.08, w: 2, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, align: 'right', margin: 0, valign: 'middle' });
}

const SIZES = {
  full: { sku: 11, name: 24, desc: 11, row: 11, rowH: 0.36, code: 1.3, descChars: 330, valueChars: 70 },
  medium: { sku: 9, name: 15, desc: 9.5, row: 9.5, rowH: 0.27, code: 0.95, descChars: 150, valueChars: 48 },
  compact: { sku: 8, name: 12, desc: 0, row: 8.5, rowH: 0.23, code: 0.7, descChars: 0, valueChars: 30 },
};

function images(ctx, slide, p, box, density) {
  const { pres } = ctx;
  const extras = density === 'full' && ctx.premium ? p.extras : [];
  const stripH = extras.length ? 0.95 : 0;
  const main = { x: box.x, y: box.y, w: box.w, h: box.h - (stripH ? stripH + 0.1 : 0) };
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { ...main, fill: { color: PANEL }, line: { color: PANEL }, rectRadius: 0.08 });
  if (p.main) addFitted(slide, p.main, main, density === 'compact' ? 0.08 : 0.2);
  else slide.addText('No image', { ...main, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 11, color: MUTED });
  if (stripH) {
    const tw = (box.w - 0.3) / 4;
    extras.forEach((img, i) => {
      const t = { x: box.x + i * (tw + 0.1), y: main.y + main.h + 0.1, w: tw, h: stripH };
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { ...t, fill: { color: PANEL }, line: { color: PANEL }, rectRadius: 0.05 });
      addFitted(slide, img, t, 0.06);
    });
  }
}

function info(ctx, slide, p, box, density) {
  const { pres, brand } = ctx;
  const s = SIZES[density];
  const codeImg = p.qr || p.barcode;
  const isBar = Boolean(p.barcode);
  const codeW = isBar ? s.code * 2 : s.code;
  const codeH = isBar ? s.code * 0.75 : s.code;
  const codeRight = codeImg && box.w > box.h * 1.25;
  const textW = codeRight ? box.w - codeW - 0.2 : box.w;
  const bottom = box.y + box.h - (codeImg && !codeRight ? codeH + 0.3 : 0);
  let y = box.y;

  slide.addText(p.sku.toUpperCase(), { x: box.x, y, w: textW, h: s.sku / 50, fontFace: FONT, fontSize: s.sku, bold: true, color: brand, charSpacing: 1, margin: 0, valign: 'top' });
  y += s.sku / 50 + 0.06;
  const nameSize = p.name.length > 60 ? s.name * 0.75 : p.name.length > 34 ? s.name * 0.85 : s.name;
  const nameH = (nameSize / 72) * 1.25 * 2;
  slide.addText(clip(p.name, 90), { x: box.x, y, w: textW, h: nameH, fontFace: FONT, fontSize: nameSize, bold: true, color: INK, margin: 0, valign: 'top' });
  y += nameH + 0.04;
  slide.addShape(pres.shapes.RECTANGLE, { x: box.x, y, w: density === 'full' ? 0.45 : 0.3, h: 0.035, fill: { color: brand }, line: { color: brand } });
  y += density === 'full' ? 0.2 : 0.14;

  if (p.price) {
    const size = density === 'full' ? 20 : density === 'medium' ? 14 : 11;
    slide.addText(
      [
        { text: p.price.label.toUpperCase(), options: { fontSize: Math.max(7, size * 0.5), color: MUTED, charSpacing: 1, breakLine: true } },
        { text: p.price.text, options: { fontSize: size, bold: true, color: brand } },
      ],
      { x: box.x, y, w: textW, h: (size / 72) * 1.9, fontFace: FONT, margin: 0, valign: 'top' },
    );
    y += (size / 72) * 1.9 + 0.08;
  }

  if (p.description && s.descChars) {
    const text = clip(p.description, s.descChars);
    const lines = Math.ceil(text.length / ((textW * 72 * 1.9) / s.desc)) + 0.4;
    const h = Math.min(lines * (s.desc / 72) * 1.3, density === 'full' ? 1.45 : 0.6);
    slide.addText(text, { x: box.x, y, w: textW, h, fontFace: FONT, fontSize: s.desc, color: BODY, margin: 0, valign: 'top' });
    y += h + 0.12;
  }

  const maxRows = Math.max(0, Math.floor((bottom - y) / s.rowH));
  const rows = p.fields.slice(0, maxRows).map((f) => [
    { text: f.label, options: { color: MUTED } },
    { text: clip(f.value, s.valueChars), options: { color: INK, bold: true } },
  ]);
  if (rows.length) {
    const labelW = Math.min(textW * 0.4, density === 'full' ? 1.75 : 1.25);
    slide.addTable(rows, {
      x: box.x, y, w: textW, colW: [labelW, textW - labelW], rowH: s.rowH,
      fontFace: FONT, fontSize: s.row, valign: 'middle', margin: [0, 4, 0, 0],
      border: [{ type: 'none' }, { type: 'none' }, { pt: 0.75, color: LINE }, { type: 'none' }],
    });
  }

  if (codeImg) {
    const cx = box.x + box.w - codeW;
    const cy = codeRight ? box.y : box.y + box.h - codeH - 0.22;
    slide.addImage({ data: b64(codeImg, 'image/png'), x: cx, y: cy, w: codeW, h: isBar ? codeH : codeW });
    if (!isBar) slide.addText('Scan for details', { x: cx - 0.3, y: cy + codeH + 0.02, w: codeW + 0.6, h: 0.2, align: 'center', fontFace: FONT, fontSize: Math.max(7, s.row - 3), color: MUTED, margin: 0 });
  }
}

function cells(perPage) {
  const x = 0.4;
  const y = 0.85;
  const w = W - 0.8;
  const h = 6.05;
  const g = 0.25;
  if (perPage === 1) return [{ x, y, w, h }];
  if (perPage === 2) return [{ x, y, w: (w - g) / 2, h }, { x: x + (w + g) / 2, y, w: (w - g) / 2, h }];
  const cw = (w - g) / 2;
  const ch = (h - g) / 2;
  return [
    { x, y, w: cw, h: ch }, { x: x + cw + g, y, w: cw, h: ch },
    { x, y: y + ch + g, w: cw, h: ch }, { x: x + cw + g, y: y + ch + g, w: cw, h: ch },
  ];
}

function product(ctx, slide, p, cell, perPage) {
  const { pres } = ctx;
  const density = perPage === 1 ? 'full' : perPage === 2 ? 'medium' : 'compact';
  let box = cell;
  if (perPage > 1) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { ...cell, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 0.75 }, rectRadius: 0.1 });
    box = { x: cell.x + 0.18, y: cell.y + 0.18, w: cell.w - 0.36, h: cell.h - 0.36 };
  }
  const side = box.w > box.h * 1.2;
  const gap = density === 'full' ? 0.4 : 0.2;
  if (side) {
    const iw = box.w * (density === 'full' ? 0.56 : 0.48);
    images(ctx, slide, p, { x: box.x, y: box.y, w: iw, h: box.h }, density);
    info(ctx, slide, p, { x: box.x + iw + gap, y: box.y + (density === 'full' ? 0.1 : 0), w: box.w - iw - gap, h: box.h - (density === 'full' ? 0.1 : 0) }, density);
  } else {
    const ih = box.h * 0.55;
    images(ctx, slide, p, { x: box.x, y: box.y, w: box.w, h: ih }, density);
    info(ctx, slide, p, { x: box.x, y: box.y + ih + gap, w: box.w, h: box.h - ih - gap }, density);
  }
}

export async function renderPptx(data, opts, outFile) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = data.company.name;
  pres.company = data.company.name;
  pres.title = opts.title;
  const ctx = { pres, data, opts, brand: data.brand.toUpperCase(), premium: opts.template !== 'simple' };

  const perPage = LAYOUTS[opts.layout] || 1;
  const productSlides = Math.ceil(data.products.length / perPage);
  const total = productSlides + (opts.cover !== false ? 1 : 0);
  if (opts.cover !== false) cover(ctx);
  let page = opts.cover !== false ? 1 : 0;
  for (let i = 0; i < data.products.length; i += perPage) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    header(ctx, slide);
    const boxes = cells(perPage);
    data.products.slice(i, i + perPage).forEach((p, j) => product(ctx, slide, p, boxes[j], perPage));
    footer(ctx, slide, ++page, total);
  }
  const buffer = await pres.write({ outputType: 'nodebuffer' });
  fs.writeFileSync(outFile, buffer);
}
