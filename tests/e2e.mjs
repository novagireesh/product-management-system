#!/usr/bin/env node
/*
 * End-to-end regression test. Starts the app on a throwaway database in the temp folder, runs every
 * main workflow through the HTTP API (setup, Excel import, products, images, costing, scan page,
 * visitors, users, catalogues, the costing workbook, calculation rules, QR scan page settings,
 * collections, export/backup) and checks the results. Your real data is never touched.
 *
 *   npm test             run everything (about a minute)
 *   KEEP=1 npm test      keep the temp folder afterwards (generated catalogues are in its "out" folder)
 *
 * Add a section at the end for every new feature, so future changes can be checked in one go.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { computeCosting } from '../shared/costing-engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-e2e-'));
const OUT = path.join(DATA, 'out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;

// --- start a server on the throwaway database ---------------------------------------------
let serverLog = '';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DATA, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const cleanup = () => {
  server.kill();
  if (!process.env.KEEP) {
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* files still locked on Windows */ }
  } else console.log(`\nTest data kept in ${DATA}`);
};
process.on('exit', cleanup);
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch { /* not up yet */ }
  if (server.exitCode !== null || i === 99) {
    console.error('The server did not start:\n', serverLog);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`Server on ${BASE}, data in ${DATA}\n`);

function client() {
  let cookie = '';
  return async function call(method, url, body, { form, raw, headers: extra } = {}) {
    const headers = { 'X-PM-Client': '1', ...(extra || {}) };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + '/api' + url, { method, headers, body: payload });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) if (c.startsWith('pm_session=')) cookie = c.split(';')[0];
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}

let failures = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log('  ✓', msg);
  else {
    failures++;
    console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : '');
  }
};
const near = (a, b, tol = 0.005) => a !== null && b !== null && a !== undefined && b !== undefined && Math.abs(a - b) <= tol;

const admin = client();
const pw = crypto.randomBytes(9).toString('base64url');

console.log('Setup');
let r = await admin('POST', '/auth/setup', { name: 'Test Admin', username: 'tester', password: pw, company_name: 'Acme Woodcraft Exports' });
ok(r.status === 201, 'initial admin created', r.data);
r = await admin('GET', '/auth/me');
ok(r.status === 200 && r.data.permissions.includes('costing.constraints') && r.data.permissions.includes('visitors.view'), 'admin has all permissions incl. new ones');
r = await admin('GET', '/costing/fields');
const fieldDefs = r.data.fields;
ok(fieldDefs.find((f) => f.key === 'usd_rate')?.default_value === 78 && fieldDefs.find((f) => f.key === 'price_usd')?.kind === 'formula', 'costing model seeded (USD rate 78, price formula)');

console.log('Excel import (sample file)');
const fd = new FormData();
fd.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'samples/sample-products.xlsx'))]), 'sample-products.xlsx');
r = await admin('POST', '/import/upload', undefined, { form: fd });
ok(r.status === 200 && r.data.totalRows === 12 && !r.data.costingWorkbook, 'upload preview: 12 rows, not a costing workbook', r.data);
const { token, mapping, headers, imageCount } = r.data;
ok(imageCount === 13, `embedded images detected (${imageCount})`);
const mapped = Object.fromEntries(headers.map((h) => [h.name, mapping[h.col]]));
ok(mapped['Product ID'] === 'sku' && mapped['Product Name'] === 'name' && mapped['Dimensions (cm)'] === 'spec:dimensions', 'core columns auto-mapped', mapped);
ok(mapped['As Discussed Rate ($)'] === 'cost:buyer_price' && mapped['Wages (₹)'] === 'cost:wages' && mapped['Wood Cost (₹)'] === 'cost:wood_cost' && mapped['Knobs / Handles (₹)'] === 'cost:knobs', 'costing columns auto-mapped', mapped);
ok(mapped['HS Code'] === 'new_field' && mapped.Image === 'ignore', 'unknown -> new field, image -> ignore');
r = await admin('POST', `/import/${token}/commit`, { mapping, duplicateStrategy: 'update', importImages: true, autoSku: true });
ok(r.data.created === 12 && r.data.failed === 0 && r.data.images === 13, 'import committed with images', r.data);

console.log('Products');
r = await admin('GET', '/products?pageSize=50');
ok(r.data.total === 12, 'list total 12', r.data.total);
const table = r.data.items.find((p) => p.sku === 'PRD-10025');
ok(table && table.image_count === 2 && table.image_url && table.specs.dimensions === '90 x 60 x 45', 'PRD-10025 specs, 2 images, full image url');
r = await admin('GET', '/products?search=mango%20coffee');
ok(r.data.total === 1, 'search "mango coffee"');
r = await admin('GET', '/products?f_material=Acacia%20Wood');
ok(r.data.total === 3, 'filter material');
r = await admin('POST', '/products', { name: 'Manual Test Lamp', category: 'Lighting', specs: { material: 'Brass', cbm: '0.05' } });
ok(r.status === 201 && r.data.sku === 'PRD-10002', 'create product with auto SKU');
const lampId = r.data.id;

console.log('Images');
const fd2 = new FormData();
for (const f of fs.readdirSync(path.join(ROOT, 'samples/images'))) fd2.append('images', new Blob([fs.readFileSync(path.join(ROOT, 'samples/images', f))]), f);
fd2.append('images', new Blob([fs.readFileSync(path.join(ROOT, 'samples/images/PRD-10027_2.jpg'))]), 'PRD-10027 (3).jpg');
r = await admin('POST', '/images/bulk', undefined, { form: fd2 });
ok(r.data.added === 3 && r.data.duplicates.length === 1, 'bulk upload by SKU, identical duplicate skipped', r.data);

console.log('Costing engine & constraints');
r = await admin('GET', `/products/${table.id}/costing`);
const c1 = r.data;
const expected = computeCosting(c1.fields, c1.inputs, c1.context);
ok(c1.can_edit && c1.can_edit_defaults && c1.context.cbm === 0.24, 'costing payload with permissions and CBM context', { ...c1, fields: undefined });
ok(near(c1.values.price_usd, expected.price_usd) && c1.values.price_usd > 0, `server price = browser engine price (${c1.values.price_usd})`);
const manual = (() => {
  const i = c1.inputs; const wood = i.wood_cost * 1.2; const base = wood + i.wages + wood * 0.08;
  const sub = base * 1.1 + i.knobs + (i.tile_glass || 0) + 350000 * 0.24 / 65;
  return (sub * 1.3 * 1.2) / 78;
})();
ok(near(c1.values.price_usd, manual, 0.01), `formula chain matches the costing sheet logic (${manual.toFixed(4)})`);
r = await admin('PUT', `/products/${table.id}/costing`, { values: { wages: c1.inputs.wages + 100 } });
ok(r.data.values.price_usd > c1.values.price_usd, 'saving an input recalculates the price');
r = await admin('PUT', `/products/${table.id}/costing`, { values: { usd_rate: 92 } });
ok(r.data.inputs.usd_rate === 92 && r.data.fields.find((f) => f.key === 'usd_rate').overridden, 'product-specific constraint override saved');
r = await admin('PUT', `/products/${table.id}/costing`, { values: { usd_rate: null, wages: c1.inputs.wages } });
ok(r.data.inputs.usd_rate === undefined && near(r.data.values.price_usd, c1.values.price_usd), 'override removed, back to master values');
const other = (await admin('GET', '/products?search=bar%20stool')).data.items[0];
const before = (await admin('GET', `/products/${other.id}/costing`)).data.values.price_usd;
r = await admin('PUT', '/costing/constraints', { values: { usd_rate: 80 } });
ok(r.status === 200 && r.data.changed === 1, 'constraint default changed for all products');
const after = (await admin('GET', `/products/${other.id}/costing`)).data.values.price_usd;
ok(near(after, (before * 78) / 80, 0.01), `all products recalculated (${before} → ${after})`);
await admin('PUT', '/costing/constraints', { values: { usd_rate: 78 } });
r = await admin('GET', '/costing?pageSize=5');
ok(r.data.items.length === 5 && r.data.items[0].inputs && r.data.items[0].context, 'costing list returns inputs + context for live recalculation');
r = await admin('POST', '/costing/fields', { label: 'Commission', type: 'currency', kind: 'input', currency: 'INR' });
ok(r.status === 201, 'add costing input field');
r = await admin('POST', '/costing/fields', { label: 'Insurance Pct', type: 'percent', kind: 'constraint', default_value: 0.5 });
ok(r.status === 201, 'add costing constraint');
r = await admin('PUT', '/costing/fields/commission', { label: 'Commission', type: 'currency', kind: 'formula', formula: 'price_usd * 0.05' });
ok(r.status === 200, 'turn field into a formula');
r = await admin('PUT', '/costing/fields/price_usd', { label: 'Price ($)', type: 'currency', currency: 'USD', kind: 'formula', formula: '(total_costing_inr + commission) / usd_rate', highlight: true });
ok(r.status === 400, 'circular formula rejected', r.data);
await admin('DELETE', '/costing/fields/commission');

console.log('Public scan page + visitor details');
const anon = client();
r = await anon('GET', '/public/products/PRD-10025');
ok(r.status === 200 && r.data.askDetails === true && !r.data.visitor, 'unknown visitor is asked for details');
ok(!JSON.stringify(r.data).includes('wood_cost') && !r.data.product.fields.some((f) => f.key === 'moq'), 'no costing / private fields in public payload');
r = await anon('POST', '/public/visitors', { name: '', email: '', phone: '' });
ok(r.status === 400, 'empty details rejected (skip is client-side)');
r = await anon('POST', '/public/visitors', { name: 'Maria Buyer', email: 'not-an-email', code: 'PRD-10025' });
ok(r.status === 400, 'invalid email rejected');
r = await anon('POST', '/public/visitors', { name: 'Maria Buyer', email: 'maria@example.com', phone: '+45 1234 5678', code: 'PRD-10025' });
ok(r.status === 201 && r.data.token, 'visitor details stored');
const vtoken = r.data.token;
r = await anon('GET', '/public/products/PRD-10026', undefined, { headers: { 'X-Visitor-Token': vtoken } });
ok(r.data.askDetails === false && r.data.visitor?.name === 'Maria Buyer', 'known visitor is not asked again');
r = await admin('GET', '/public/products/PRD-10025');
ok(r.data.askDetails === false && r.data.viewer, 'signed-in users never see the prompt');
r = await admin('GET', '/visitors');
ok(r.data.total === 1 && r.data.items[0].email === 'maria@example.com' && r.data.items[0].scan_count === 2, 'visitor listed with scan count', r.data.items[0]);
r = await admin('GET', `/visitors/${r.data.items[0].id}`);
ok(r.data.scans.length === 2, 'visitor scan history');
let res = await admin('GET', '/visitors/export.xlsx', undefined, { raw: true });
ok(res.status === 200 && (await res.arrayBuffer()).byteLength > 3000, 'visitors Excel export');

console.log('Scan page costing unlock + real-time save');
r = await anon('POST', '/public/products/PRD-10025/costing', {});
ok(r.status === 401, 'costing requires auth');
r = await admin('PUT', '/settings/costing-pin', { pin: '482915' });
r = await anon('POST', '/public/products/PRD-10025/costing', { pin: '482915' });
ok(r.status === 200 && r.data.fields.length > 20 && r.data.inputs && r.data.can_edit === false, 'PIN unlocks costing for exploring only');
r = await anon('PUT', '/public/products/PRD-10025/costing', { values: { wages: 1 } });
ok(r.status === 401, 'PIN user cannot save');
const anon2 = client();
r = await anon2('POST', '/public/products/PRD-10025/costing', { username: 'tester', password: pw });
ok(r.status === 200 && r.data.can_edit && r.data.can_edit_defaults, 'staff sign-in on scan page can save');
r = await anon2('PUT', '/public/products/PRD-10025/costing', { values: { buyer_price: 151 } });
ok(r.status === 200 && r.data.inputs.buyer_price === 151, 'save from scan page');

console.log('Users & roles');
r = await admin('GET', '/users');
const sales = r.data.roles.find((x) => x.name === 'Sales');
ok(sales.permissions.includes('visitors.view') && !sales.permissions.includes('costing.view'), 'sales role: visitors yes, costing no');
const spw = crypto.randomBytes(9).toString('base64url');
await admin('POST', '/users', { name: 'Sam Sales', username: 'sam', password: spw, role_id: sales.id });
const s = client();
r = await s('POST', '/auth/login', { username: 'sam', password: spw });
ok(r.status === 200, 'sales login');
r = await s('GET', `/products/${table.id}/costing`);
ok(r.status === 403, 'sales cannot view costing');
r = await s('PUT', '/costing/constraints', { values: { usd_rate: 1 } });
ok(r.status === 403, 'sales cannot change constraints');

console.log('Catalogues with prices');
r = await admin('POST', '/buyers', { name: 'Emma Larsen', company: 'Nordhus Interiors', country: 'Denmark' });
const buyer = r.data;
r = await admin('GET', '/products?pageSize=50&sort=sku:asc');
const ids = r.data.items.map((p) => p.id);
r = await admin('GET', '/catalogues/options');
ok(r.data.priceSources.some((p) => p.key === 'buyer_price') && r.data.priceSources.some((p) => p.key === 'price_usd'), 'price sources offered', r.data.priceSources);
r = await s('GET', '/catalogues/options');
ok(r.data.priceSources.length === 0, 'no price sources for sales (no costing access)');
r = await admin('POST', '/catalogues', { title: 'Existing prices', template: 'premium', product_ids: ids.slice(0, 4), formats: ['pdf', 'pptx', 'xlsx'], price: { mode: 'existing', source: 'buyer_price', fallback: 'price_usd', label: 'FOB Price' } });
ok(r.status === 201 && r.data.products.filter((p) => p.sku !== 'PRD-10002').every((p) => p.price > 0) && r.data.products.find((p) => p.sku === 'PRD-10002').price === null, 'catalogue with existing prices; product without costing gets no price', r.data.products);
for (const f of r.data.files) fs.writeFileSync(path.join(OUT, `existing.${f.format}`), Buffer.from(await (await admin('GET', `/catalogues/${r.data.id}/download/${f.format}`, undefined, { raw: true })).arrayBuffer()));
const manualPrices = { [ids[0]]: 199.5, [ids[1]]: 88, [ids[2]]: '' };
r = await s('POST', '/catalogues', { title: 'Negotiated', template: 'buyer', layout: 'grid2', buyer_id: buyer.id, product_ids: ids.slice(0, 3), formats: ['pdf', 'xlsx', 'pptx'], price: { mode: 'manual', label: 'Price', currency: 'USD', values: manualPrices } });
ok(r.status === 201 && r.data.products[0].price === 199.5 && r.data.products[1].price === 88 && r.data.products[2].price === null, 'sales generates catalogue with manual prices', r.data.products);
for (const f of r.data.files) fs.writeFileSync(path.join(OUT, `manual.${f.format}`), Buffer.from(await (await s('GET', `/catalogues/${r.data.id}/download/${f.format}`, undefined, { raw: true })).arrayBuffer()));
r = await admin('GET', `/products/${ids[0]}/costing`);
ok(r.data.inputs.buyer_price !== 199.5, 'manual price did not change master costing');
r = await s('POST', '/catalogues', { title: 'x', product_ids: ids.slice(0, 1), formats: ['pdf'], price: { mode: 'existing' } });
ok(r.status === 403, 'sales cannot use prices from costing');
r = await admin('POST', '/catalogues/save-prices', { field: 'buyer_price', values: { [ids[0]]: 199.5 } });
ok(r.data.saved === 1, 'explicitly save manual price to master');
r = await admin('GET', `/products/${ids[0]}/costing`);
ok(r.data.inputs.buyer_price === 199.5, 'master price updated only after explicit save');

console.log('Costing workbook (samples/sample-costing.xlsx)');
const fd3 = new FormData();
fd3.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'samples/sample-costing.xlsx'))]), 'sample-costing.xlsx');
r = await admin('POST', '/import/upload', undefined, { form: fd3 });
ok(r.status === 200 && r.data.costingWorkbook?.sheets === 24 && r.data.sheet === 'PRODUCT LIST', 'costing workbook detected, master sheet chosen', { sheet: r.data.sheet, cw: r.data.costingWorkbook });
const wm = Object.fromEntries(r.data.headers.map((h) => [h.name, r.data.mapping[h.col]]));
ok(wm.DESCRIPTION === 'name' && wm['PRICE ($)'] === 'ignore' && wm['AS DISCUSSED RATE ($)'] === 'cost:buyer_price' && wm['SIZE IN INCH'] === 'spec:size_inch', 'workbook mapping', wm);
r = await admin('POST', `/import/${r.data.token}/commit`, { sheet: r.data.sheet, mapping: r.data.mapping, duplicateStrategy: 'update', importCosting: true });
ok(r.data.created === 24 && r.data.costing.imported === 24 && r.data.costing.verified === 24, 'all 24 costing sheets imported and verified against Excel', { ...r.data, updatedProducts: undefined });

console.log('Dashboard, export, backup');
r = await admin('GET', '/dashboard');
ok(r.data.stats.totalProducts === 37, 'dashboard stats', r.data.stats);
res = await admin('GET', '/costing/export.xlsx', undefined, { raw: true });
ok(res.status === 200, 'costing export');
res = await admin('GET', '/products/export.xlsx', undefined, { raw: true });
const exportBuf = Buffer.from(await res.arrayBuffer());
const fd4 = new FormData();
fd4.append('file', new Blob([exportBuf]), 'export.xlsx');
r = await admin('POST', '/import/upload', undefined, { form: fd4 });
const m4 = Object.fromEntries(r.data.headers.map((h) => [h.name, r.data.mapping[h.col]]));
ok(!Object.values(m4).includes('new_field'), 'own export re-maps without new fields', Object.entries(m4).filter(([, v]) => v === 'new_field'));
res = await admin('GET', '/settings/backup', undefined, { raw: true });
ok(res.status === 200, 'backup');


// ============================================================================================
// October 2026 update 2: loadability, CBM rule, dimensions in CM, configurable QR scan page
// ============================================================================================
const prod = async (sku) => (await admin('GET', `/products?search=${encodeURIComponent(sku)}`)).data.items.find((p) => p.sku === sku);
const specsOf = async (id) => (await admin('GET', `/products/${id}`)).data.specs;

console.log('Loadability (system calculation rule)');
r = await admin('GET', '/products/meta');
const loadField = r.data.fields.find((f) => f.key === 'loadability');
ok(r.data.rules?.loadability?.units_per_cbm === 65 && r.data.rules.cbm.auto === true, 'rules exposed to forms (65 per CBM, CBM auto)', r.data.rules);
ok(loadField?.calc === 'loadability' && loadField.is_public && loadField.unit === 'pcs / container', 'loadability is a calculated, public field', loadField);
ok(r.data.fields.findIndex((f) => f.key === 'loadability') === r.data.fields.findIndex((f) => f.key === 'cbm') + 1, 'loadability listed right after CBM');
ok(['dimensions', 'packing_size', 'size_inch'].every((k) => r.data.fields.find((f) => f.key === k)?.type === 'dimensions'), 'size fields use the dimensions type');
const df1 = await prod('DF20001');
const df3 = await prod('DF20003');
ok(df1.specs.loadability === '90' && df3.specs.loadability === '1160', 'imported products: 65 ÷ CBM rounded down (DF20001 0.72 → 90, DF20003 0.056 → 1160)', [df1.specs, df3.specs]);

console.log('CBM from packing size + loadability on save');
r = await admin('POST', '/products', { name: 'Rule Test Cabinet', specs: { packing_size: '100X50X40' } });
const rt = r.data;
ok(rt.specs.cbm === '0.2' && rt.specs.loadability === '325', 'blank CBM calculated from packing (0.2) → loadability 325', rt.specs);
r = await admin('PUT', `/products/${rt.id}`, { specs: { packing_size: '100X50X50', cbm: '0.2' } });
ok(r.data.specs.cbm === '0.25' && r.data.specs.loadability === '260', 'calculated CBM follows a new packing size → 0.25 / 260', r.data.specs);
r = await admin('PUT', `/products/${rt.id}`, { specs: { cbm: '0.3' } });
ok(r.data.specs.cbm === '0.3' && r.data.specs.loadability === '216', 'typed CBM used → loadability 216', r.data.specs);
r = await admin('PUT', `/products/${rt.id}`, { specs: { packing_size: '100X50X70', cbm: '0.3' } });
ok(r.data.specs.cbm === '0.3', 'typed CBM is not overwritten by a packing change', r.data.specs);
r = await admin('PUT', `/products/${rt.id}`, { specs: { cbm: '' } });
ok(r.data.specs.cbm === '0.35' && r.data.specs.loadability === '185', 'clearing CBM recalculates it from packing (0.35 → 185)', r.data.specs);
r = await admin('PUT', `/products/${rt.id}`, { specs: { loadability: '999' } });
ok(r.data.specs.loadability === '185', 'loadability cannot be typed in (value ignored)', r.data.specs);
r = await admin('POST', '/products', { name: 'Two Box Table', specs: { packing_size: '140X40X8, 59X32X81' } });
ok(r.data.specs.cbm === '0.197728' && r.data.specs.loadability === '328', 'multi-box packing summed (0.197728) → 328', r.data.specs);
r = await admin('POST', '/products/bulk-update', { ids: [rt.id], specs: { loadability: '1' } });
ok((await specsOf(rt.id)).loadability === '185', 'bulk edit cannot set loadability');
r = await admin('GET', `/products/${rt.id}/history`);
ok(JSON.stringify(r.data).includes('Loadability'), 'loadability changes appear in product history');
r = await admin('GET', '/products?sort=loadability:desc&pageSize=3');
ok(Number(r.data.items[0].specs.loadability) >= Number(r.data.items[1].specs.loadability), 'products sort by loadability');

console.log('Rule changes recalculate every product');
r = await admin('PUT', '/settings/rules', { loadability: { units_per_cbm: 60, rounding: 'exact' } });
ok(r.status === 200 && r.data.recalculated >= 24 && r.data.calc_rules.loadability.units_per_cbm === 60, `rule saved, ${r.data.recalculated} products recalculated`, r.data.calc_rules);
ok((await prod('DF20001')).specs.loadability === '83.33', 'DF20001 now 60 ÷ 0.72 = 83.33 (exact)');
r = await admin('PUT', '/settings/rules', { loadability: { units_per_cbm: 0 } });
ok(r.status === 400, 'units per CBM must be > 0');
r = await admin('PUT', '/settings/rules', { cbm: { source: 'cbm' } });
ok(r.status === 400, 'CBM source must be a dimensions field');
r = await admin('PUT', '/settings/rules', { loadability: { units_per_cbm: 65, rounding: 'down' } });
ok((await prod('DF20001')).specs.loadability === '90', 'rule restored → 90');
r = await admin('GET', `/products/${df1.id}/costing`);
ok(near(r.data.values.loadability, 65 / 0.72, 1e-6) && !('loadability' in r.data.context), 'costing keeps its own loadability formula (product field not in costing context)');
r = await admin('DELETE', '/settings/fields/loadability');
ok(r.status === 400, 'system field cannot be deleted');
r = await admin('PUT', '/settings/fields/loadability', { label: 'Loadability (40ft)', type: 'text', unit: 'pcs / container', is_public: true });
ok(r.data.find((f) => f.key === 'loadability').type === 'number' && r.data.find((f) => f.key === 'loadability').label === 'Loadability (40ft)', 'label can change, type stays', r.data.find?.((f) => f.key === 'loadability'));
await admin('PUT', '/settings/fields/loadability', { label: 'Loadability', type: 'number', unit: 'pcs / container', is_public: true });

console.log('QR scan page — default and configured display');
const anon3 = client();
r = await anon3('GET', '/public/products/DF20001');
const pf = Object.fromEntries(r.data.product.fields.map((f) => [f.key, f.value]));
ok(r.data.product.sku === 'DF20001' && r.data.product.name && r.data.product.price === null, 'defaults: code and name; no price');
ok((await anon3('GET', '/public/products/PRD-10025')).data.product.images.length === 2, 'defaults: images shown');
ok(pf.dimensions === '155 × 45 × 85 CM' && pf.packing_size === '160 × 50 × 90 CM' && pf.size_inch === '61 × 18 × 33 INCH', 'dimensions shown with units', pf);
ok(pf.loadability === '90 pcs / container' && pf.cbm === '0.72 m³', 'loadability and CBM on the scan page', pf);
ok(r.data.display?.costing_button === true && r.data.display.contact === true, 'display flags sent');
r = await admin('GET', '/settings');
ok(r.data.scan_items.length === 7 && r.data.price_sources.some((s) => s.key === 'buyer_price') && r.data.scan_page.price.enabled === false, 'scan page settings payload', { items: r.data.scan_items?.length, ps: r.data.price_sources });
r = await admin('PUT', '/settings/scan-page', {
  show: { code: false, images: false, description: false, costing_button: false },
  price: { enabled: true, source: 'buyer_price', fallback: 'price_usd', label: 'FOB Price' },
  fields: { cbm: false, material: false },
});
ok(r.status === 200 && r.data.scan_page.show.code === false && r.data.scan_page.price.enabled, 'scan page configured', r.data.scan_page);
r = await admin('GET', '/settings/fields');
ok(r.data.find((f) => f.key === 'cbm').is_public === false, 'field switch shared with Settings › Product fields');
r = await anon3('GET', '/public/products/DF20001');
const p2 = r.data.product;
ok(p2.sku === null && p2.images.length === 0 && p2.description === null && p2.name, 'hidden items are not sent at all', { sku: p2.sku, images: p2.images.length });
ok((await anon3('GET', '/public/products/PRD-10025')).data.product.images.length === 0, 'images hidden for every product');
ok(!p2.fields.some((f) => f.key === 'cbm') && p2.fields.some((f) => f.key === 'loadability'), 'hidden field removed, others kept');
ok(p2.price?.label === 'FOB Price' && p2.price.text === 'USD 240.00', 'price from As Discussed Rate', p2.price);
r = await anon3('GET', `/public/products/${encodeURIComponent(rt.sku)}`);
ok(r.status === 200 && r.data.product.price === null, 'no costing → no price shown');
ok(r.data.display.costing_button === false, 'costing button switched off');
r = await anon3('POST', '/public/products/DF20001/costing', { pin: '482915' });
ok(r.status === 403, 'costing endpoint closed when the button is off');
r = await admin('PUT', '/settings/scan-page', { show: { code: true, images: true, description: true, costing_button: true }, price: { enabled: false }, fields: { cbm: true, material: true } });
r = await anon3('GET', '/public/products/DF20001');
ok(r.data.product.sku === 'DF20001' && r.data.product.fields.some((f) => f.key === 'cbm') && r.data.product.price === null, 'scan page restored');

console.log('Catalogue with loadability and dimensions in CM');
r = await admin('GET', '/catalogues/options');
ok(r.data.templates.every((t) => t.fields.includes('loadability')), 'every template includes loadability');
r = await admin('POST', '/catalogues', { title: 'Loadability check', template: 'simple', product_ids: [df1.id, df3.id], formats: ['pdf', 'xlsx', 'pptx'] });
ok(r.status === 201, 'catalogue generated', r.data);
const files = {};
for (const f of r.data.files || []) {
  files[f.format] = Buffer.from(await (await admin('GET', `/catalogues/${r.data.id}/download/${f.format}`, undefined, { raw: true })).arrayBuffer());
  fs.writeFileSync(path.join(OUT, `loadability.${f.format}`), files[f.format]);
}
const xwb = new ExcelJS.Workbook();
await xwb.xlsx.load(files.xlsx);
const xText = [];
xwb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => xText.push(String(c.value?.richText ? c.value.richText.map((t) => t.text).join('') : c.value)))));
ok(xText.some((t) => t.includes('155 × 45 × 85 CM')) && xText.some((t) => t.includes('90 pcs / container')), 'Excel catalogue shows "155 × 45 × 85 CM" and "90 pcs / container"');
const zip = await JSZip.loadAsync(files.pptx);
const slides = await Promise.all(Object.keys(zip.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => zip.file(n).async('string')));
ok(slides.some((s) => s.includes('155 × 45 × 85 CM')) && slides.some((s) => s.includes('1160 pcs / container')), 'PowerPoint catalogue shows dimensions in CM and loadability');
ok(files.pdf?.length > 10000, 'PDF catalogue generated');

console.log('Collections: loadability and container load');
r = await admin('POST', '/collections', { name: 'Container check', product_ids: [df1.id, df3.id] });
const coll = r.data;
await admin('PUT', `/collections/${coll.id}/products/${df1.id}`, { quantity: 65 });
r = await admin('PUT', `/collections/${coll.id}/products/${df3.id}`, { quantity: 100 });
ok(r.data.products?.find((p) => p.id === df1.id)?.loadability_text === '90 pcs / container', 'loadability per product in the collection', r.data.products?.[0]);
ok(r.data.load?.total_qty === 165 && r.data.load.total_cbm === 52.4 && r.data.load.containers === 0.81, 'container load: 52.4 CBM ≈ 0.81 containers', r.data.load);

console.log('Import & export of calculated columns');
const fd5 = new FormData();
fd5.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'samples/sample-costing.xlsx'))]), 'sample-costing.xlsx');
r = await admin('POST', '/import/upload', undefined, { form: fd5 });
const lc = r.data.headers.find((h) => /LOADAB/i.test(h.name));
ok(r.data.mapping[lc.col] === 'ignore' && /Calculated automatically/.test(r.data.notes?.[lc.col] || ''), 'Excel loadability column ignored with an explanation', { m: r.data.mapping[lc.col], n: r.data.notes?.[lc.col] });
ok(!r.data.targets.some((t) => t.value === 'spec:loadability'), 'loadability is not offered as an import target');
res = await admin('GET', '/products/export.xlsx', undefined, { raw: true });
const ewb = new ExcelJS.Workbook();
await ewb.xlsx.load(Buffer.from(await res.arrayBuffer()));
ok(ewb.getWorksheet('Products').getRow(1).values.includes('Loadability (calculated)'), 'product export marks loadability as calculated');
res = await admin('GET', '/products/export.xlsx?template=1', undefined, { raw: true });
const twb = new ExcelJS.Workbook();
await twb.xlsx.load(Buffer.from(await res.arrayBuffer()));
ok(!twb.getWorksheet('Products').getRow(1).values.some((v) => /loadab/i.test(String(v))), 'import template has no loadability column');

// ============================================================================================
// October 2026 update 3: percentage-based catalogue prices, collections by product code
// ============================================================================================
console.log('Catalogue pricing: percentage increase');
const ref = {};
for (const [sku, buyerPrice] of [['DF18001', 1000], ['DF18002', 1250], ['DF18003', 2000], ['DF18004', 2499]]) {
  r = await admin('POST', '/products', { sku, name: `Series test ${sku}`, costing: { buyer_price: buyerPrice } });
  ref[sku] = r.data.id;
}
const pctIds = Object.values(ref);
const pctCatalogue = (price, extra = {}, who = admin) => who('POST', '/catalogues', { title: 'Percent test', template: 'simple', product_ids: pctIds, formats: ['xlsx'], ...extra, price: { label: 'Price', source: 'buyer_price', ...price } });
const pricesOf = (c) => c.products.map((p) => p.price);
r = await pctCatalogue({ mode: 'percent', percent: 5, rounding: 'whole' });
ok(r.status === 201 && JSON.stringify(pricesOf(r.data)) === JSON.stringify([1050, 1313, 2100, 2624]), '+5% rounded: 1000→1050, 1250→1313, 2000→2100, 2499→2624', r.data.products?.map((p) => [p.sku, p.price]));
ok(r.data.options.price.mode === 'percent' && r.data.options.price.percent === 5 && r.data.options.price.rounding === 'whole', 'pricing method stored with the catalogue', r.data.options.price);
const pctXlsx = new ExcelJS.Workbook();
await pctXlsx.xlsx.load(Buffer.from(await (await admin('GET', `/catalogues/${r.data.id}/download/xlsx`, undefined, { raw: true })).arrayBuffer()));
const pctCells = [];
pctXlsx.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { if (c.value === 1313) pctCells.push(c.numFmt); })));
ok(pctCells.length === 1 && pctCells[0] === '#,##0', 'Excel catalogue: 1313 as a whole-number price', pctCells);
r = await pctCatalogue({ mode: 'percent', percent: 5, rounding: 'none' });
ok(JSON.stringify(pricesOf(r.data)) === JSON.stringify([1050, 1312.5, 2100, 2623.95]), 'no rounding: 1312.50 and 2623.95', pricesOf(r.data));
r = await pctCatalogue({ mode: 'percent', percent: 10, rounding: 'whole' });
ok(pricesOf(r.data)[1] === 1375, 'next catalogue +10% uses the original 1250 (1375), not a previous result');
r = await admin('GET', `/products/${ref.DF18002}/costing`);
ok(r.data.inputs.buyer_price === 1250, 'reference price in the database unchanged (1250)');
r = await admin('POST', '/catalogues', { title: 'Mixed', template: 'simple', product_ids: [ref.DF18002, rt.id], formats: ['xlsx'], price: { mode: 'percent', source: 'buyer_price', fallback: null, percent: 5, label: 'Price' } });
ok(r.data.products.find((p) => p.sku === rt.sku)?.price === null && r.data.products.find((p) => p.sku === 'DF18002')?.price === 1313, 'mixed selection: product without reference price gets no price', r.data.products?.map((p) => [p.sku, p.price]));
const df1Usd = (await admin('GET', `/products/${df1.id}/costing`)).data.values;
r = await admin('POST', '/catalogues', { title: 'Fallback', template: 'simple', product_ids: [df1.id], formats: ['xlsx'], price: { mode: 'percent', source: 'parametric_usd', fallback: 'price_usd', percent: 5, rounding: 'none', label: 'Price' } });
ok(near(r.data.products[0].price, Math.round(df1Usd.parametric_usd * 105) / 100, 0.011), 'percentage applied to the chosen reference price (parametric rate)', [r.data.products[0].price, df1Usd.parametric_usd]);
r = await pctCatalogue({ mode: 'percent', rounding: 'whole' });
ok(r.status === 400, 'percentage is required');
r = await pctCatalogue({ mode: 'percent', percent: 5000 });
ok(r.status === 400, 'percentage out of range rejected');
r = await pctCatalogue({ mode: 'percent', percent: 5 }, {}, s);
ok(r.status === 403, 'percentage pricing needs costing access (sales user refused)');
r = await pctCatalogue({ mode: 'manual', currency: 'USD', values: { [ref.DF18001]: 999 } });
ok(r.status === 201 && r.data.products[0].price === 999 && r.data.products[1].price === null, 'manual pricing unchanged');
r = await pctCatalogue({ mode: 'existing' });
ok(JSON.stringify(pricesOf(r.data)) === JSON.stringify([1000, 1250, 2000, 2499]), 'reference price unchanged option still works');
r = await admin('GET', '/history?search=Percent%20test&pageSize=50');
ok(r.status === 200 && JSON.stringify(r.data).includes('As Discussed Rate ($) +5%, rounded'), 'activity log describes the pricing method (+5%, rounded)');

console.log('Collections by product code');
for (const sku of ['DF18070A', 'DF19001', 'DF6053']) await admin('POST', '/products', { sku, name: `Series test ${sku}` });
r = await admin('GET', '/collections/auto');
const autoPlan = Object.fromEntries(r.data.collections.map((c) => [c.name, c]));
ok(r.status === 200 && Object.keys(autoPlan).join(',') === 'Code 6,Code 18,Code 19,Code 20', 'series found: Code 6, 18, 19, 20', Object.keys(autoPlan));
ok(autoPlan['Code 18'].codes.join(' ') === 'DF18001 DF18002 DF18003 DF18004 DF18070A' && autoPlan['Code 20'].product_count === 24, 'Code 18 includes the suffixed DF18070A; Code 20 has 24', autoPlan['Code 18'].codes);
ok(r.data.unmatched.includes('PRD-10025') && !r.data.up_to_date, 'codes not following the pattern are listed, nothing created by the scan');
ok((await admin('GET', '/collections')).data.every((c) => !c.auto_key), 'scan alone creates nothing');
r = await admin('POST', '/collections/auto', {});
ok(r.status === 200 && r.data.totals.created === 4 && r.data.up_to_date, 'four collections created', r.data.totals);
const autoCount = async () => (await admin('GET', '/collections')).data.filter((c) => c.auto_key);
const before2 = (await autoCount()).map((c) => `${c.name}:${c.product_count}`).sort().join(',');
r = await admin('POST', '/collections/auto', {});
ok(r.data.totals.created === 0 && r.data.totals.added === 0 && (await autoCount()).map((c) => `${c.name}:${c.product_count}`).sort().join(',') === before2, 'running again creates no duplicate collections or products', before2);
const code18 = (await autoCount()).find((c) => c.name === 'Code 18');
await admin('POST', '/products', { sku: 'DF18005', name: 'Series test DF18005' });
r = await admin('POST', '/collections/auto', {});
ok(r.data.totals.added === 1 && (await admin('GET', `/collections/${code18.id}`)).data.products.length === 6, 'new product DF18005 joins Code 18 on refresh');
await admin('PUT', `/products/${(await prod('DF19001')).id}`, { sku: 'DF18099' });
r = await admin('POST', '/collections/auto', {});
ok(r.data.totals.deleted === 1 && !r.data.collections.some((c) => c.name === 'Code 19') && r.data.collections.find((c) => c.name === 'Code 18').codes.includes('DF18099'), 'changed code moves to its new series; empty Code 19 removed', r.data.totals);
r = await admin('POST', `/collections/${code18.id}/products`, { product_ids: [rt.id] });
ok(r.status === 400, 'products cannot be added by hand to a code collection');
r = await admin('PUT', `/collections/${code18.id}`, { name: 'Renamed', notes: 'For the fair' });
ok(r.data.name === 'Code 18' && r.data.notes === 'For the fair', 'name follows the series, notes can be edited');
await admin('PUT', `/collections/${code18.id}/products/${ref.DF18001}`, { quantity: 40 });
r = await admin('POST', '/collections/auto', { name_template: 'Series {series}' });
ok(r.data.collections.some((c) => c.name === 'Series 18') && (await admin('GET', `/collections/${code18.id}`)).data.products.find((p) => p.id === ref.DF18001).quantity === 40, 'name format changeable; quantities kept on refresh');
r = await admin('POST', '/collections/auto', { name_template: 'no placeholder' });
ok(r.status === 400, 'name format must contain {series}');
await admin('POST', '/collections/auto', { name_template: 'Code {series}' });
r = await s('POST', '/collections/auto', {});
ok(r.status === 200 && r.data.totals.created === 0, 'sales role (buyers.manage) can refresh; nothing new to create');
r = await anon3('GET', '/collections/auto');
ok(r.status === 401, 'collection scan needs a signed-in user');
r = await admin('POST', '/catalogues', { title: 'From Code 18', template: 'simple', collection_id: code18.id, formats: ['pdf'], price: { mode: 'percent', source: 'buyer_price', percent: 5, label: 'Price' } });
ok(r.status === 201 && r.data.product_count === 7 && r.data.collection_name === 'Code 18', 'catalogue generated from the Code 18 collection with +5% prices', { n: r.data.product_count, c: r.data.collection_name });

const errors = serverLog.split('\n').filter((l) => l.startsWith('[error]'));
ok(errors.length === 0, 'no server errors logged', errors.slice(0, 3));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
