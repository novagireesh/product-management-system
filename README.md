# Product Management & Catalogue System

A web application to store, manage, search, scan and share product information, protect product costing, and generate professional buyer catalogues (PDF, PowerPoint, Excel). Built from the requirements in `Product Management.docx`.

```
Browser (React) ──► Express API ──► SQLite database
                        │
                        ├── File / image storage (data/uploads)
                        └── Catalogue engine (PDF · PPTX · XLSX)
```

---

## Quick start (Windows)

Requirements: **Node.js 22.13 or newer** (tested on Node 24).

Double-click **`start.bat`**, or run in a terminal in this folder:

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Then open **http://localhost:5050**. On first start you'll be asked to create the administrator account and enter your company name.

> **Try it with sample data:** `samples/sample-products.xlsx` has 12 furniture products with pictures inside the sheet. Import it on **Excel Import**. The files in `samples/images/` show how the bulk image upload matches file names to product IDs. `samples/sample-costing.xlsx` is a costing workbook with 24 fictional products (product list, wood rate table and one costing sheet per product) to try the costing import. Run `npm run sample` to regenerate them.

### Scanning QR codes with phones

QR codes point to `http://<this-computer's-network-address>:5050/p/<product-code>`. For phones on the same Wi-Fi to open them:

1. When Windows asks whether to allow **Node.js** on networks, allow **Private networks**.
2. In **Settings › Scanning & security**, check the "QR code address". The app suggests your computer's network address automatically. If the app is hosted on a server, enter its public address, e.g. `https://products.yourcompany.com`.
3. Print labels **after** setting the address. The address is encoded into each label.

The phone's normal camera app opens the product page directly. The in-app **Scan** page (camera inside the browser) works on `https://` or on `localhost`, as required by browsers. USB/Bluetooth barcode scanners work on the Scan page everywhere.

---

## What's included (mapped to the requirements)

| # | Requirement | Where |
|---|---|---|
| 1 | Excel upload, automatic + manual column mapping, duplicate handling (update / keep / create new), bulk import & bulk update, custom fields | **Excel Import**; **Products › Export Excel** produces a file you can edit and re-import |
| 2 | Multiple images per product, primary image, replace / delete / reorder, automatic optimisation | Product page › Images; **Product Images** (bulk upload by file name, e.g. `PRD-10025_2.jpg`) |
| 3 | Unique QR code + barcode per product, opening a mobile product page | Created automatically for every product (Code 128 or Code 39 barcode) |
| 4 | Scan page that shows only fields configured for buyers | `/p/<code>`; choose which fields are public in **Settings › Product fields** |
| 5 | Protected costing behind **VIEW COSTING** (PIN, sign-in, role permission) | Scan page; product page › Costing; **Costing** module. Every view is logged |
| 6 | Search & filtering by ID, name, category, material, finish, dimensions, buyer, collection, product type, custom fields; sorting | **Products** |
| 7 | Buyer-specific product selections | **Buyers & Collections** (quantities and notes per product) |
| 8–10 | Catalogue generator with Simple / Premium / Buyer-specific templates, logo, page numbers, QR/barcode, chosen fields; export to PDF, PowerPoint, Excel | **Catalogue Generator**, **Catalogue History** |
| 11 | Admin dashboard with all requested statistics and modules | **Dashboard** |
| 12 | Role-based access (Admin, Sales, Production, Accounts, Management), configurable permissions | **Users & Permissions** |
| 13 | Mobile-friendly everywhere, especially the scan page | Responsive layout |
| 14 | Generate / download / print QR codes, barcodes and labels in bulk (image, name, ID, code) | **Barcode / QR**; A4 label sheets and thermal label sizes |
| 15 | Product history with date, time, user and field-level changes | Product page › History; **Activity Log** |
| 16 | Relational database with the requested tables | `server/db/schema.js` |
| 17 | The full workflow (Excel → codes → labels → scan → costing → buyer selection → catalogue) | All of the above |
| 19 | Modern B2B interface: dashboard, product cards, gallery, advanced search, filters | Whole app |
| 20 | Authentication, authorisation, validation, API security, file validation, image optimisation, error handling, backups, logging | See *Security* and *Operations* below |

### October 2026 update

| Feature | Where |
|---|---|
| **Optional “Share your details” popup** for signed-out visitors who scan a QR code (name, email, mobile; Skip or Submit). Never shown to signed-in users or to visitors who already shared details | Scan page; details listed in **Sales › Scan Visitors** (search, scan history, Excel export). Can be turned off in **Settings › Scanning & security** |
| **Catalogue prices**: none, *Use price from existing data* (As Discussed Rate / Price ($) / Parametric Rate, with a fallback), or *Enter price manually* on a page listing all selected products. Manual prices apply to that catalogue only; *Save as As Discussed Rate* updates master prices only when you choose it | **Catalogue Generator › 5 · Price**; buttons *Generate Catalogue / Generate Excel / Generate PDF* |
| **10 × 10 cm sticker**: top 5 cm product image (in proportion), bottom 5 cm the details you tick plus QR / barcode. One per page (sticker printer) or 4 per A4 sheet | **Barcode / QR › Label size** |
| **Real-time costing**: after *View Costing*, every constraint (USD rate, wastage, KFD, trade margin, polish & packing per container, freight, container CBM, overheads, misc, profit margin) and every cost (wood, wages, hardware…) can be changed and the costing recalculates instantly. Changes are temporary until *Save*, where each constraint can be saved for this product only or as the new default for all products | Scan page › View Costing; product page › Costing; **Costing** page (change constraints for all products and preview every price) |
| **Costing workbooks**: an Excel file with a product list plus one costing sheet per product is detected automatically; costs, CBM and constants are read from each sheet and the app’s calculated price is checked against the sheet | **Excel Import**, or `node scripts/import-workbook.js --file <xlsx> --images <folder> --categories` |

The costing model follows the costing sheets exactly (verified on every product of `samples/sample-costing.xlsx`):
wood + wastage → + wages + KFD → + trade margin → + hardware + polish & packing (₹ per container × CBM ÷ container CBM) + freight → + overheads + misc → + margin = **Total costing (₹)** ÷ USD rate = **Price ($)**. *Parametric rate* leaves out trade margin and misc. No rate is hard-coded: all constraints live in **Settings › Costing structure**.

### October 2026 update 2

| Feature | Where |
|---|---|
| **Loadability per product** — pieces per container = *units per CBM* ÷ the product’s CBM (65 ÷ 0.705375 = 92 pcs). A system calculation, recalculated whenever CBM or the rule changes; read-only, never imported | Product pages & form, product list, scan page, all catalogue templates, stickers, collections (with a container-load estimate for the quantities). Rule: **Settings › Calculation rules** |
| **CBM from packing size** — when CBM is left blank it is calculated from all packing boxes (L × W × H cm ÷ 1,000,000) and keeps following packing changes; a typed CBM is kept | Product form (live), Excel import, **Settings › Calculation rules** |
| **QR scan page — choose what is shown**: images, product code, name, category, description, every product field (CBM, loadability, dimensions, material, finish…), a price from costing, enquiry buttons and *View costing*. Hidden information is not sent to the phone at all | **Settings › QR scan page** (live phone preview) |
| **Product code** on the scan page in a clear badge (tabular figures, slashed zero) | Scan page |
| **Dimensions with units** — “Dimensions (L × W × H)” field type: `160X40X90` is shown as **160 × 40 × 90 CM** (several boxes, missing commas and typed units handled) | Everywhere values are displayed; the Excel data export keeps the raw values |

### October 2026 update 3

| Feature | Where |
|---|---|
| **Pricing method “Percentage increase”** — every selected product’s own reference price + a percentage (e.g. +5%), optionally rounded to the nearest whole number (1,312.50 → 1,313). A preview lists reference price, increase and final price for every product and recalculates as you change the percentage. Reference prices are never changed; *Adjust individual prices…* copies the result into Manual price | **Catalogue Generator › 5 · Price — pricing method** (Reference price · Manual price · Percentage increase) |
| **Collections by product code** — one collection per code series (DF18xxx → “Code 18”, DF6xxx → “Code 6”, letter suffixes included), with product counts and codes shown before anything is created. Run it again to add new products: no duplicate collections or products | **Buyers & collections › Auto-create collections by product code**; pick them in the Catalogue Generator under “Collections by product code” |

### Configurable without code changes
- **Product fields**: add, rename, reorder, deactivate or delete fields. Choose the type (text, number, dimensions, dropdown, yes/no, date, long text) and unit, whether it appears on the public scan page, and whether it's a filter. Unknown Excel columns can become new fields automatically during import.
- **Calculation rules**: loadability (units per CBM, rounding) and automatic CBM from a size field.
- **QR scan page**: every item on the page can be switched on or off; optional price from any costing result.
- **Costing structure**: constraints (one value for all products, overridable per product), entered costs and calculated fields. Formulas such as `total_costing_inr / usd_rate` can also use numeric product fields like `cbm`. Circular references are rejected.
- **Roles & permissions**: tick boxes per role; create new roles.
- **Branding**: logo, company details, brand colour (catalogues, labels and scan page), currency, catalogue footer.

---

## Roles (defaults — all editable)

| Role | Access |
|---|---|
| Admin | Everything (always full access) |
| Sales | View/search products, buyer collections, catalogues (manual prices), labels, scan visitors. No costing unless granted |
| Production | View products and print labels. Internal fields (e.g. *Production Notes*) are visible to signed-in staff only |
| Accounts | Products plus viewing and editing costing, and changing constraints for all products |
| Management | Products, costing (view), buyers, catalogues, activity log |

Costing is never part of the public product response. A scan shows costing only after one of these:
- a signed-in session whose role has *View costing*,
- signing in on the spot,
- the optional shared PIN (Settings › Scanning & security).

Attempts are rate-limited.

---

## Operations

- **Data location**: `data/` in this folder: `app.db` (database), `uploads/` (product images, logo), `catalogues/` (generated files), `logs/` (daily JSON log files).
  > ⚠️ This folder is inside **OneDrive**. Syncing a live database can cause conflicts, so keep the data outside OneDrive. Create a `.env` file (copy `.env.example`) and set e.g. `DATA_DIR=C:\ProductData`.
- **Import reports & backups**: every run of `scripts/import-workbook.js` first saves a copy of the database in `data/backups/` and writes a verification report to `data/import-reports/`.
- **Backups**: Settings › Backup & system › *Download backup* produces a ZIP of the database and all images. To restore, stop the server and replace `app.db` and `uploads/`.
- **Logs**: `data/logs/app-YYYY-MM-DD.log`; the latest entries are also shown in Settings.
- **Configuration** (`.env`): `PORT`, `HOST`, `DATA_DIR`, `SESSION_DAYS`, `SECURE_COOKIES`, `TRUST_PROXY`, `MAX_UPLOAD_MB`, `MAX_IMPORT_MB`. See `.env.example`.

### Hosting on a server
Run `npm run build` and then `npm start` behind a reverse proxy with HTTPS (e.g. Nginx or Caddy). Set `SECURE_COOKIES=true` and `TRUST_PROXY=true`, and set the public address in Settings. Use a process manager (PM2, NSSM or a Windows service) so the app restarts automatically.

### Development
```bash
npm run dev
```
This runs the API on :5050 with auto-restart and the Vite dev server on http://localhost:5173 (with hot reload, proxying `/api`).

---

## Security measures
- Passwords hashed with bcrypt; sessions are random tokens stored hashed, in `HttpOnly`, `SameSite=Lax` cookies; sessions are revoked when a password changes or a user is deactivated.
- Permission checks on every API route (server-side, not just hidden buttons).
- Custom-header CSRF guard on all state-changing requests, Helmet security headers and Content-Security-Policy.
- Rate limiting on sign-in, first-run setup and costing unlock.
- Uploaded images are decoded and re-encoded (never trusted by extension or MIME type), metadata stripped, size limits enforced; product images get unguessable file names.
- Parameterised SQL everywhere; input validation with length limits; at least one active admin is always kept.
- Costing values in history are masked for users without costing access.

## Scalability & future integrations
- Indexed relational schema with a denormalised search column, so search and filters stay fast with tens of thousands of products. Product attributes use a specifications table, so new fields never need a schema change.
- The data layer is plain SQL in `server/services`, and the API is JSON under `/api`. This makes it straightforward to move to PostgreSQL, or to add modules from the roadmap (OMS, inventory, production, purchasing, CRM, email/WhatsApp automation, cloud storage, AI search and descriptions) as new routes and services.

## Known limitations
- Old binary `.xls` files must be saved as `.xlsx` first. Excel's newer "Place in cell" pictures aren't read; pictures inserted over cells are.
- PDF catalogues use the standard PDF fonts (Latin characters; `₹` is written as `Rs.`).
- `npm audit` reports advisories in two dependencies: `image-size` (via pptxgenjs) and `uuid` (via exceljs). Only images the app has already re-encoded itself reach those code paths, so neither affects this app. Update the packages when fixed versions are released.

## Project structure
```
server/
  index.js            Express app (security headers, routes, static files)
  config.js           Paths & environment settings
  db/                 Schema (migrations), seed data, SQLite helpers
  lib/                Auth & sessions, settings, logging, HTTP helpers
  services/           Products, fields, images, codes, costing, importer (incl. costing workbooks), exporter, history
    catalogue/        PDF (pdfkit), PowerPoint (pptxgenjs), Excel (exceljs) renderers
  routes/             REST API
client/src/
  pages/              Dashboard, Products, Import, Images, Codes, Costing, Buyers,
                      Catalogue generator/history, Users, Settings, Activity, Scan,
                      public product page
  components/         UI kit, layout, filters, pickers, image manager, costing panel
shared/costing-engine.js  Costing formula engine used by both the server and the browser
scripts/make-sample.js    Generates the sample Excel file
scripts/import-workbook.js  Imports a costing workbook + image folder with a backup and a verification report
```
