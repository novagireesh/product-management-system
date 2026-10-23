// Reads "costing workbooks": a product list sheet plus one costing sheet per product
// (sheet named after the product code, ending in TOTAL COSTING / PARAMETRIC COSTING rows),
// as used for export costing. Extracts the product's cost inputs and the constants
// (USD rate, wastage %, margins, container figures) its formulas use.

const label = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

function value(cell) {
  const v = cell?.value;
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result ?? null;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('error' in v) return null;
    if (v instanceof Date) return v;
    return null;
  }
  return v ?? null;
}
const num = (cell) => {
  const v = value(cell);
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return v === null || v === '' || !Number.isFinite(n) ? null : n;
};
function formula(cell) {
  try {
    return cell?.formula || cell?.value?.formula || null;
  } catch {
    return null;
  }
}

/** First numeric literal in a formula, ignoring sheet and cell references. { n, percent } */
function literal(f) {
  if (!f) return null;
  const stripped = String(f).replace(/'[^']*'!|[A-Za-z0-9_]+!/g, '').replace(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g, '');
  const m = stripped.match(/(\d+(?:\.\d+)?)\s*(%)?/);
  return m ? { n: Number(m[1]), percent: Boolean(m[2]) } : null;
}
const pct = (f) => {
  const l = literal(f);
  if (!l) return null;
  return l.percent ? l.n : l.n <= 1 ? Math.round(l.n * 100 * 1e6) / 1e6 : l.n;
};
const plain = (f) => literal(f)?.n ?? null;

const HARDWARE = [
  [/KNOB|HANDLE/, 'knobs'],
  [/TILE|GLASS|MARBLE|MIRROR/, 'tile_glass'],
  [/^CNC/, 'cnc'],
  [/KHERAD|TURNING/, 'kherad'],
  [/IRON|METAL|BRASS/, 'iron'],
];

export function isCostingSheet(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 200); r++) if (label(value(ws.getCell(r, 1))) === 'TOTAL COSTING') return true;
  return false;
}

/** Sheets whose name is a product code and which hold a costing calculation. Map(code upper -> ws) */
export function costingSheets(wb) {
  const out = new Map();
  for (const ws of wb.worksheets) {
    const name = ws.name.trim();
    if (/^[A-Za-z]{1,6}[-_ ]?\d{2,}[A-Za-z0-9-]*$/.test(name) && isCostingSheet(ws)) out.set(name.toUpperCase(), ws);
  }
  return out;
}

/** The product list sheet the costing sheets read from (e.g. formulas like ='PRODUCT LIST'!D2). */
export function masterSheetName(wb, sheets) {
  const counts = new Map();
  for (const ws of [...sheets.values()].slice(0, 10)) {
    for (let r = 1; r <= 30; r++) {
      for (let c = 1; c <= 8; c++) {
        const f = formula(ws.getCell(r, c));
        if (!f) continue;
        for (const m of String(f).matchAll(/'([^']+)'!|([A-Za-z][A-Za-z0-9_]*)!/g)) {
          const name = m[1] || m[2];
          if (name && !sheets.has(name.toUpperCase()) && wb.getWorksheet(name)) counts.set(name, (counts.get(name) || 0) + 1);
        }
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // The wood rate table is referenced a lot but is not the product list.
  return ranked.find(([name]) => !/^RATE/i.test(name))?.[0] || null;
}

/**
 * Parse one product costing sheet.
 * Returns { inputs, constants, cbm, check: { total_inr, price_usd, parametric_usd }, hardware, warnings }
 */
export function parseCostingSheet(ws) {
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) rows.push([r, label(value(ws.getCell(r, 1)))]);
  const G = (r) => num(ws.getCell(r, 7));
  const GF = (r) => formula(ws.getCell(r, 7));
  const warnings = [];
  const inputs = { wood_cost: null, wood_sft: null, wages: null, knobs: 0, tile_glass: 0, cnc: 0, kherad: 0, iron: 0, other_hardware: 0 };
  const constants = {};
  const check = {};
  const hardware = [];
  let cbm = null;

  const woodRow = rows.find(([, l]) => l.startsWith('TOTAL WOOD') && !l.includes('CONSUMP'))?.[0];
  if (!woodRow) throw new Error('No "TOTAL WOOD" row found');
  inputs.wood_cost = G(woodRow);
  inputs.wood_sft = num(ws.getCell(woodRow, 5));

  let section = 'wood';
  for (const [r, l] of rows) {
    if (r <= woodRow || !l) continue;
    if (l.startsWith('WASTAGE')) constants.wastage_pct = pct(GF(r));
    else if (l.includes('CONSUMP')) { /* wood + wastage, calculated */ }
    else if (l.startsWith('WAGES')) inputs.wages = G(r);
    else if (l.startsWith('KFD')) constants.kfd_pct = pct(GF(r));
    else if (l.startsWith('TRAD')) constants.trade_margin_pct = pct(GF(r));
    else if (l.startsWith('TOTAL PURCHASE')) section = 'hardware';
    else if (l.startsWith('POLISH')) {
      constants.pf_per_container = plain(GF(r));
      constants.container_cbm = plain(formula(ws.getCell(r, 6)));
      cbm = num(ws.getCell(r, 5));
      section = 'after';
    } else if (l.startsWith('OH')) constants.oh_pct = pct(GF(r));
    else if (l.startsWith('MISC')) constants.misc_pct = pct(GF(r));
    else if (l.startsWith('MARGIN')) constants.margin_pct = pct(GF(r));
    else if (l.startsWith('TOTAL COSTING')) {
      check.total_inr = G(r);
      check.price_usd = num(ws.getCell(r, 8));
      constants.usd_rate = plain(formula(ws.getCell(r, 8)));
    } else if (l.startsWith('PARAMETRIC')) {
      check.parametric_usd = num(ws.getCell(r, 8));
    } else if (section === 'hardware' && l !== 'TOTAL') {
      const amount = G(r) ?? 0;
      const key = HARDWARE.find(([re]) => re.test(l))?.[1] || 'other_hardware';
      inputs[key] += amount;
      hardware.push({ label: l, qty: num(ws.getCell(r, 3)), unit: value(ws.getCell(r, 4)), rate: num(ws.getCell(r, 6)), amount, key });
    }
  }
  if (cbm === null) {
    cbm = num(ws.getCell(6, 5));
    warnings.push('CBM taken from the packing size row');
  }
  for (const [k, v] of Object.entries(constants)) if (v === null || v === undefined) delete constants[k];
  if (inputs.wages === null) warnings.push('No WAGES row found');
  return { inputs, constants, cbm, check, hardware, warnings };
}
