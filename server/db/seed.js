import { DEFAULT_CALC_RULES } from '../../shared/product-fields.js';
import { DEFAULT_SCAN_PAGE } from '../lib/scan-page.js';
import { invalidateFields } from '../services/fields.js';
import { q, tx } from './index.js';

export const PERMISSIONS = [
  ['dashboard.view', 'View dashboard', 'General'],
  ['products.view', 'View products', 'Products'],
  ['products.create', 'Create products', 'Products'],
  ['products.edit', 'Edit products', 'Products'],
  ['products.delete', 'Delete products', 'Products'],
  ['products.import', 'Import / export Excel', 'Products'],
  ['images.manage', 'Manage product images', 'Products'],
  ['codes.manage', 'Generate, download & print QR / barcodes', 'Products'],
  ['costing.view', 'View costing', 'Costing'],
  ['costing.edit', 'Edit & save product costing', 'Costing'],
  ['costing.constraints', 'Change costing constraints for all products (e.g. USD rate)', 'Costing'],
  ['buyers.view', 'View buyers & collections', 'Sales'],
  ['buyers.manage', 'Manage buyers & collections', 'Sales'],
  ['catalogues.generate', 'Generate catalogues', 'Sales'],
  ['catalogues.view', 'View catalogue history & downloads', 'Sales'],
  ['visitors.view', 'View & export scan visitors', 'Sales'],
  ['visitors.manage', 'Delete scan visitor records', 'Sales'],
  ['history.view', 'View activity / change history', 'Administration'],
  ['users.manage', 'Manage users, roles & permissions', 'Administration'],
  ['settings.manage', 'Manage settings, fields & backups', 'Administration'],
];

const ROLES = [
  { name: 'Admin', description: 'Full access to everything.', system: 1, perms: PERMISSIONS.map((p) => p[0]) },
  {
    name: 'Sales',
    description: 'Search products, build buyer collections and generate catalogues.',
    perms: ['dashboard.view', 'products.view', 'codes.manage', 'buyers.view', 'buyers.manage', 'catalogues.generate', 'catalogues.view', 'visitors.view'],
  },
  {
    name: 'Production',
    description: 'View production-related product information and print labels.',
    perms: ['dashboard.view', 'products.view', 'codes.manage'],
  },
  {
    name: 'Accounts',
    description: 'Access costing and financial information.',
    perms: ['dashboard.view', 'products.view', 'costing.view', 'costing.edit', 'costing.constraints', 'catalogues.view'],
  },
  {
    name: 'Management',
    description: 'View products, costing, reports and catalogues.',
    perms: ['dashboard.view', 'products.view', 'costing.view', 'buyers.view', 'catalogues.view', 'history.view', 'visitors.view'],
  },
];

// [key, label, type, group, unit, is_public, is_filterable, sort_order, calc]
// calc: name of the system calculation that fills the field (read-only for users).
const FIELDS = [
  ['material', 'Material', 'text', 'Specifications', null, 1, 1, 10],
  ['wood_type', 'Wood Type', 'text', 'Specifications', null, 1, 1, 20],
  ['finish', 'Finish / Colour', 'text', 'Specifications', null, 1, 1, 30],
  ['dimensions', 'Dimensions', 'dimensions', 'Specifications', 'CM', 1, 0, 40],
  ['size_inch', 'Size in Inch', 'dimensions', 'Specifications', 'INCH', 1, 0, 45],
  ['weight', 'Weight', 'number', 'Specifications', 'kg', 1, 0, 50],
  ['cbm', 'CBM', 'number', 'Specifications', 'm³', 1, 0, 60],
  ['loadability', 'Loadability', 'number', 'Specifications', 'pcs / container', 1, 0, 65, 'loadability'],
  ['product_type', 'Product Type', 'text', 'Classification', null, 0, 1, 70],
  ['collection', 'Collection / Range', 'text', 'Classification', null, 1, 1, 80],
  ['packing_size', 'Packing Size', 'dimensions', 'Packing', 'CM', 1, 0, 85],
  ['packing_details', 'Packing Details', 'textarea', 'Packing', null, 1, 0, 90],
  ['moq', 'MOQ', 'number', 'Commercial', 'pcs', 0, 0, 100],
  ['production_notes', 'Production Notes', 'textarea', 'Production', null, 0, 0, 110],
];
// Fields added in later versions; created in existing databases if missing.
const ADDED_FIELDS = ['size_inch', 'packing_size', 'loadability'];

/*
 * Default costing model — the export costing sheet used by the business (one sheet per product):
 * wood + 20% wastage, wages, KFD 8%, trade margin 10%, hardware, polish & packing per container,
 * overheads 15%, misc 15%, margin 20%, converted at ₹78 per US$.
 * [key, label, kind, type, currency, unit, formula | default value, group, highlight, description]
 */
const C = 'Constraints';
const M = 'Material & Labour';
const H = 'Hardware & Fittings';
const K = 'Calculation';
const R = 'Result';
export const COSTING_MODEL = [
  ['usd_rate', 'USD Conversion Rate', 'constraint', 'number', null, '₹ per US$', 78, C, 0, 'Rupees per US dollar used to convert the costing'],
  ['wastage_pct', 'Wood Wastage', 'constraint', 'percent', null, null, 20, C, 0, 'Added on top of the wood cost'],
  ['kfd_pct', 'KFD', 'constraint', 'percent', null, null, 8, C, 0, 'Percentage of total wood consumption'],
  ['trade_margin_pct', 'Trade Margin', 'constraint', 'percent', null, null, 10, C, 0, 'On wood + wages + KFD'],
  ['pf_per_container', 'Polish & Packing per Container', 'constraint', 'currency', 'INR', null, 350000, C, 0, 'Shared across a container by CBM'],
  ['freight_per_container', 'Freight / Transport per Container', 'constraint', 'currency', 'INR', null, 0, C, 0, 'Optional; shared across a container by CBM'],
  ['container_cbm', 'Container Capacity', 'constraint', 'number', null, 'CBM', 65, C, 0, '40 ft container'],
  ['oh_pct', 'Overheads', 'constraint', 'percent', null, null, 15, C, 0, null],
  ['misc_pct', 'Miscellaneous', 'constraint', 'percent', null, null, 15, C, 0, null],
  ['margin_pct', 'Profit Margin', 'constraint', 'percent', null, null, 20, C, 0, null],

  ['wood_cost', 'Wood / Material Cost', 'input', 'currency', 'INR', null, null, M, 0, 'Wood cost before wastage'],
  ['wood_sft', 'Wood Quantity', 'input', 'number', null, 'SFT', null, M, 0, 'Before wastage'],
  ['wages', 'Labour / Wages', 'input', 'currency', 'INR', null, null, M, 0, null],
  ['knobs', 'Knobs / Handles', 'input', 'currency', 'INR', null, null, H, 0, null],
  ['tile_glass', 'Tile / Glass', 'input', 'currency', 'INR', null, null, H, 0, null],
  ['cnc', 'CNC', 'input', 'currency', 'INR', null, null, H, 0, null],
  ['kherad', 'Kherad', 'input', 'currency', 'INR', null, null, H, 0, null],
  ['iron', 'Iron', 'input', 'currency', 'INR', null, null, H, 0, null],
  ['other_hardware', 'Other Hardware / Upholstery', 'input', 'currency', 'INR', null, null, H, 0, null],

  ['wastage', 'Wood Wastage Amount', 'formula', 'currency', 'INR', null, 'wood_cost * wastage_pct / 100', K, 0, null],
  ['wood_total', 'Total Wood Consumption', 'formula', 'currency', 'INR', null, 'wood_cost + wastage', K, 0, null],
  ['wood_sft_total', 'Wood incl. Wastage', 'formula', 'number', null, 'SFT', 'wood_sft * (1 + wastage_pct / 100)', K, 0, null],
  ['kfd', 'KFD Amount', 'formula', 'currency', 'INR', null, 'wood_total * kfd_pct / 100', K, 0, null],
  ['base_total', 'Total (Wood + Wages + KFD)', 'formula', 'currency', 'INR', null, 'wood_total + wages + kfd', K, 0, null],
  ['trade_margin', 'Trade Margin Amount', 'formula', 'currency', 'INR', null, 'base_total * trade_margin_pct / 100', K, 0, null],
  ['total_purchase', 'Total Purchase', 'formula', 'currency', 'INR', null, 'base_total + trade_margin', K, 0, null],
  ['hardware_total', 'Hardware & Fittings Total', 'formula', 'currency', 'INR', null, 'knobs + tile_glass + cnc + kherad + iron + other_hardware', K, 0, null],
  ['loadability', 'Loadability (pcs per container)', 'formula', 'number', null, 'pcs', 'container_cbm / cbm', K, 0, null],
  ['polish_pf', 'Polish & Packing (P&F)', 'formula', 'currency', 'INR', null, 'pf_per_container * cbm / container_cbm', K, 0, null],
  ['freight', 'Freight / Transport', 'formula', 'currency', 'INR', null, 'freight_per_container * cbm / container_cbm', K, 0, null],
  ['subtotal', 'Sub Total', 'formula', 'currency', 'INR', null, 'total_purchase + hardware_total + polish_pf + freight', K, 0, null],
  ['overhead', 'Overheads Amount', 'formula', 'currency', 'INR', null, 'subtotal * oh_pct / 100', K, 0, null],
  ['misc', 'Miscellaneous Amount', 'formula', 'currency', 'INR', null, 'subtotal * misc_pct / 100', K, 0, null],
  ['total_before_margin', 'Total before Margin', 'formula', 'currency', 'INR', null, 'subtotal + overhead + misc', K, 0, null],
  ['margin', 'Profit Margin Amount', 'formula', 'currency', 'INR', null, 'total_before_margin * margin_pct / 100', K, 0, null],

  ['total_costing_inr', 'Total Costing (₹)', 'formula', 'currency', 'INR', null, 'total_before_margin + margin', R, 1, null],
  ['price_usd', 'Price ($)', 'formula', 'currency', 'USD', null, 'total_costing_inr / usd_rate', R, 1, 'Total costing converted to US$'],
  ['parametric_inr', 'Parametric Costing (₹)', 'formula', 'currency', 'INR', null, 'base_total + hardware_total + polish_pf + freight + overhead + margin', R, 0, 'Excludes trade margin and miscellaneous'],
  ['parametric_usd', 'Parametric Rate ($)', 'formula', 'currency', 'USD', null, 'parametric_inr / usd_rate', R, 1, null],
  ['buyer_price', 'As Discussed Rate ($)', 'input', 'currency', 'USD', null, null, R, 1, 'Rate agreed with the buyer'],
  ['discussed_margin_pct', 'Margin at Discussed Rate', 'formula', 'percent', null, null, '(buyer_price * usd_rate - total_before_margin) / (buyer_price * usd_rate) * 100', R, 0, 'Profit margin if sold at the discussed rate'],
];

// The generic costing structure shipped with the first version (replaced if never used).
const LEGACY_COSTING_KEYS = ['buyer_price', 'export_cost', 'final_cost', 'hardware', 'labour', 'manufacturing_cost', 'margin', 'overhead', 'packaging', 'polish_finish', 'raw_material'];

export const DEFAULT_SETTINGS = {
  company_name: 'Your Company',
  company_tagline: 'Handcrafted furniture & home décor',
  company_address: '',
  company_email: '',
  company_phone: '',
  company_whatsapp: '',
  company_website: '',
  company_logo: null,
  brand_color: '#1f3a5f',
  currency: 'USD',
  sku_prefix: 'PRD-',
  sku_next: 10001,
  barcode_type: 'code128',
  public_base_url: '',
  costing_pin_hash: null,
  catalogue_footer: '',
  visitor_prompt: true,
  // System calculation rules: loadability = units_per_cbm ÷ CBM; CBM from the packing size when blank.
  calc_rules: DEFAULT_CALC_RULES,
  // What the public QR-code scan page shows. Product fields use their own "scan page" flag (is_public).
  scan_page: DEFAULT_SCAN_PAGE,
  // Automatic collections by product code: name of each series collection ({series} = 18 for DF18001).
  auto_collections: { name_template: 'Code {series}' },
};

function insertCostingModel() {
  COSTING_MODEL.forEach(([key, label, kind, type, currency, unit, fv, group, highlight, description], i) => {
    q.run(
      `INSERT INTO costing_fields(key, label, kind, type, currency, unit, formula, default_value, group_name, highlight, description, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      key, label, kind, type, currency, unit,
      kind === 'formula' ? fv : null, kind === 'constraint' ? fv : null,
      group, highlight, description, (i + 1) * 10,
    );
  });
}

export function seed() {
  tx(() => {
    const before = new Set(q.all('SELECT key FROM permissions').map((r) => r.key));
    PERMISSIONS.forEach(([key, label, group], i) => {
      q.run(
        `INSERT INTO permissions(key, label, group_name, sort_order) VALUES (?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET label=excluded.label, group_name=excluded.group_name, sort_order=excluded.sort_order`,
        key, label, group, i,
      );
    });
    const added = before.size ? PERMISSIONS.map((p) => p[0]).filter((k) => !before.has(k)) : [];

    for (const role of ROLES) {
      const existing = q.get('SELECT id, is_system FROM roles WHERE name = ?', role.name);
      if (!existing) {
        const { lastInsertRowid } = q.run(
          'INSERT INTO roles(name, description, is_system) VALUES (?,?,?)',
          role.name, role.description, role.system || 0,
        );
        for (const p of role.perms) q.run('INSERT INTO role_permissions VALUES (?,?)', lastInsertRowid, p);
      } else if (existing.is_system) {
        // The system Admin role always holds every permission, including newly added ones.
        for (const [p] of PERMISSIONS) q.run('INSERT OR IGNORE INTO role_permissions VALUES (?,?)', existing.id, p);
      } else {
        // Grant permissions introduced in an upgrade to the default roles that include them.
        for (const p of role.perms.filter((k) => added.includes(k))) q.run('INSERT OR IGNORE INTO role_permissions VALUES (?,?)', existing.id, p);
      }
    }

    const insertField = (or, [key, label, type, group, unit, pub, filt, order, calc]) => q.run(
      `INSERT ${or} INTO field_definitions(key, label, type, group_name, unit, is_public, is_filterable, sort_order, calc)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      key, label, type, group, unit, pub, filt, order, calc || null,
    );
    if (!q.value('SELECT COUNT(*) FROM field_definitions')) {
      for (const f of FIELDS) insertField('', f);
    } else {
      for (const f of FIELDS.filter((x) => ADDED_FIELDS.includes(x[0]))) {
        const { changes } = insertField('OR IGNORE', f);
        // Show loadability right after CBM, wherever the fields have been reordered to.
        const cbmOrder = q.value(`SELECT sort_order FROM field_definitions WHERE key = 'cbm'`);
        if (changes && f[0] === 'loadability' && cbmOrder !== undefined) {
          q.run('UPDATE field_definitions SET sort_order = sort_order + 10 WHERE sort_order > ?', cbmOrder);
          q.run(`UPDATE field_definitions SET sort_order = ? WHERE key = 'loadability'`, cbmOrder + 5);
        }
      }
    }
    // System-calculated fields stay calculated even if an older copy of the field exists.
    for (const [key, , , , , , , , calc] of FIELDS.filter((x) => x[8])) {
      q.run('UPDATE field_definitions SET calc = ? WHERE key = ? AND calc IS NULL', calc, key);
    }

    // Install the costing model on new databases, and replace the generic first-version
    // structure if it was never used (no costing values other than buyer price).
    const keys = q.all('SELECT key FROM costing_fields').map((r) => r.key).sort();
    const legacyUnused = keys.length === LEGACY_COSTING_KEYS.length && keys.every((k, i) => k === LEGACY_COSTING_KEYS[i]) &&
      !q.value(`SELECT COUNT(*) FROM product_costing WHERE field_key <> 'buyer_price'`);
    if (!keys.length || legacyUnused) {
      q.run('DELETE FROM costing_fields');
      insertCostingModel();
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      q.run('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)', key, JSON.stringify(value));
    }
  });
  invalidateFields(); // field definitions may have changed
}
