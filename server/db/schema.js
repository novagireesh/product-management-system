// Ordered list of migrations. Never edit a shipped migration; append a new one instead.
const TS = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const migrations = [
  /* 1: initial schema */ `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Users, roles & permissions -------------------------------------------
  CREATE TABLE roles (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    is_system   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE TABLE permissions (
    key        TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    group_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE role_permissions (
    role_id        INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_key)
  );
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    email         TEXT,
    password_hash TEXT NOT NULL,
    role_id       INTEGER NOT NULL REFERENCES roles(id),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT ${TS},
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT ${TS},
    expires_at TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );
  CREATE INDEX ix_sessions_user ON sessions(user_id);

  -- Catalogue structure ----------------------------------------------------
  CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE UNIQUE INDEX ux_categories_name ON categories(ifnull(parent_id, 0), name COLLATE NOCASE);

  -- Configurable product attributes (the "custom fields" system).
  CREATE TABLE field_definitions (
    id            INTEGER PRIMARY KEY,
    key           TEXT NOT NULL UNIQUE,
    label         TEXT NOT NULL,
    type          TEXT NOT NULL DEFAULT 'text',   -- text | textarea | number | select | boolean | date
    options       TEXT,                           -- JSON array for select
    unit          TEXT,
    group_name    TEXT NOT NULL DEFAULT 'Specifications',
    is_public     INTEGER NOT NULL DEFAULT 1,     -- shown on the public scan page
    is_filterable INTEGER NOT NULL DEFAULT 0,
    in_catalogue  INTEGER NOT NULL DEFAULT 1,     -- offered by default in catalogues
    sort_order    INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT ${TS}
  );

  CREATE TABLE products (
    id             INTEGER PRIMARY KEY,
    sku            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description    TEXT,
    status         TEXT NOT NULL DEFAULT 'active', -- active | inactive | draft
    search_text    TEXT NOT NULL DEFAULT '',
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT ${TS},
    updated_at     TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE INDEX ix_products_category ON products(category_id);
  CREATE INDEX ix_products_subcategory ON products(subcategory_id);
  CREATE INDEX ix_products_status ON products(status);
  CREATE INDEX ix_products_updated ON products(updated_at);
  CREATE INDEX ix_products_name ON products(name COLLATE NOCASE);

  CREATE TABLE product_specifications (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    field_key  TEXT NOT NULL,
    value      TEXT,
    PRIMARY KEY (product_id, field_key)
  );
  CREATE INDEX ix_specs_field_value ON product_specifications(field_key, value COLLATE NOCASE);

  CREATE TABLE product_images (
    id            INTEGER PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    file          TEXT NOT NULL,
    thumb         TEXT NOT NULL,
    original_name TEXT,
    width         INTEGER,
    height        INTEGER,
    size_bytes    INTEGER,
    is_primary    INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE INDEX ix_images_product ON product_images(product_id, sort_order);

  -- QR / barcode registry. "code" is what labels encode; it survives SKU edits.
  CREATE TABLE product_codes (
    id             INTEGER PRIMARY KEY,
    product_id     INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    code           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    barcode_type   TEXT NOT NULL DEFAULT 'code128',
    created_at     TEXT NOT NULL DEFAULT ${TS},
    regenerated_at TEXT
  );

  -- Costing (protected) ----------------------------------------------------
  CREATE TABLE costing_fields (
    id         INTEGER PRIMARY KEY,
    key        TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'currency',  -- currency | number | percent
    formula    TEXT,                              -- e.g. "raw_material + labour"
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE TABLE product_costing (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    field_key  TEXT NOT NULL,
    value      REAL,
    updated_at TEXT NOT NULL DEFAULT ${TS},
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (product_id, field_key)
  );

  -- Buyers & collections ---------------------------------------------------
  CREATE TABLE buyers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    company    TEXT,
    country    TEXT,
    email      TEXT,
    phone      TEXT,
    address    TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT ${TS},
    updated_at TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE TABLE collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    buyer_id   INTEGER REFERENCES buyers(id) ON DELETE SET NULL,
    notes      TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT ${TS},
    updated_at TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE INDEX ix_collections_buyer ON collections(buyer_id);
  CREATE TABLE collection_products (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity      INTEGER,
    notes         TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    added_at      TEXT NOT NULL DEFAULT ${TS},
    PRIMARY KEY (collection_id, product_id)
  );
  CREATE INDEX ix_collection_products_product ON collection_products(product_id);

  -- Catalogues -------------------------------------------------------------
  CREATE TABLE catalogues (
    id            INTEGER PRIMARY KEY,
    title         TEXT NOT NULL,
    subtitle      TEXT,
    template      TEXT NOT NULL,
    buyer_id      INTEGER REFERENCES buyers(id) ON DELETE SET NULL,
    collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    options       TEXT,
    product_count INTEGER NOT NULL DEFAULT 0,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE TABLE catalogue_files (
    id           INTEGER PRIMARY KEY,
    catalogue_id INTEGER NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
    format       TEXT NOT NULL,   -- pdf | pptx | xlsx
    file         TEXT NOT NULL,
    size_bytes   INTEGER
  );
  CREATE TABLE catalogue_products (
    id           INTEGER PRIMARY KEY,
    catalogue_id INTEGER NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
    sku          TEXT,
    name         TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_catalogue_products_cat ON catalogue_products(catalogue_id);

  -- Imports & audit trail --------------------------------------------------
  CREATE TABLE import_history (
    id                 INTEGER PRIMARY KEY,
    filename           TEXT NOT NULL,
    sheet              TEXT,
    total_rows         INTEGER NOT NULL DEFAULT 0,
    created_count      INTEGER NOT NULL DEFAULT 0,
    updated_count      INTEGER NOT NULL DEFAULT 0,
    skipped_count      INTEGER NOT NULL DEFAULT 0,
    failed_count       INTEGER NOT NULL DEFAULT 0,
    images_count       INTEGER NOT NULL DEFAULT 0,
    duplicate_strategy TEXT,
    mapping            TEXT,
    errors             TEXT,
    user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name          TEXT,
    created_at         TEXT NOT NULL DEFAULT ${TS}
  );

  -- Product change history / activity log. product_id intentionally has no FK
  -- so the trail survives product deletion.
  CREATE TABLE product_history (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER,
    entity     TEXT NOT NULL,     -- product | image | costing | code | import | catalogue | user | settings ...
    entity_id  INTEGER,
    action     TEXT NOT NULL,
    summary    TEXT,
    changes    TEXT,              -- JSON [{field, label, from, to}]
    user_id    INTEGER,
    user_name  TEXT,
    created_at TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE INDEX ix_history_product ON product_history(product_id, created_at);
  CREATE INDEX ix_history_created ON product_history(created_at);
  `,

  /* 2: costing constraints, visitor details, catalogue prices, image de-duplication */ `
  ALTER TABLE costing_fields ADD COLUMN kind TEXT NOT NULL DEFAULT 'input';  -- input | constraint | formula
  ALTER TABLE costing_fields ADD COLUMN default_value REAL;                  -- constraints: value for all products
  ALTER TABLE costing_fields ADD COLUMN currency TEXT;                       -- e.g. INR / USD (null = company currency)
  ALTER TABLE costing_fields ADD COLUMN unit TEXT;
  ALTER TABLE costing_fields ADD COLUMN group_name TEXT;
  ALTER TABLE costing_fields ADD COLUMN highlight INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE costing_fields ADD COLUMN description TEXT;
  UPDATE costing_fields SET kind = 'formula' WHERE formula IS NOT NULL AND formula <> '';

  ALTER TABLE product_images ADD COLUMN hash TEXT;
  CREATE INDEX ix_images_hash ON product_images(product_id, hash);

  -- Price used for a product in a specific catalogue (manual or from costing). Never the master price.
  ALTER TABLE catalogue_products ADD COLUMN price REAL;

  -- People who scanned a QR code and chose to share their details.
  CREATE TABLE visitors (
    id               INTEGER PRIMARY KEY,
    name             TEXT,
    email            TEXT,
    phone            TEXT,
    token_hash       TEXT NOT NULL UNIQUE,
    first_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    last_product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    scan_count       INTEGER NOT NULL DEFAULT 0,
    user_agent       TEXT,
    created_at       TEXT NOT NULL DEFAULT ${TS},
    last_seen_at     TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE INDEX ix_visitors_created ON visitors(created_at);

  CREATE TABLE product_scans (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    visitor_id INTEGER REFERENCES visitors(id) ON DELETE SET NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT ${TS}
  );
  CREATE INDEX ix_scans_product ON product_scans(product_id, created_at);
  CREATE INDEX ix_scans_visitor ON product_scans(visitor_id);
  `,

  /* 3: system-calculated fields (loadability), dimensions field type */ `
  -- Name of the system calculation that fills this field (read-only), e.g. 'loadability'. NULL = entered by users.
  ALTER TABLE field_definitions ADD COLUMN calc TEXT;

  -- Size fields become the "dimensions" type: shown as "120 × 45 × 80 CM" everywhere.
  UPDATE field_definitions SET type = 'dimensions', unit = 'CM'
   WHERE key IN ('dimensions', 'packing_size') AND type = 'text' AND lower(ifnull(unit, '')) IN ('cm', '');
  UPDATE field_definitions SET type = 'dimensions', unit = 'INCH'
   WHERE key = 'size_inch' AND type = 'text' AND lower(ifnull(unit, '')) IN ('inch', 'in', '');
  `,

  /* 4: collections maintained automatically from product codes */ `
  -- Rule key for collections kept up to date automatically, e.g. 'code:DF18' = all DF18xxx products.
  -- NULL for collections people build themselves. One collection per key (no duplicates on re-runs).
  ALTER TABLE collections ADD COLUMN auto_key TEXT;
  CREATE UNIQUE INDEX ux_collections_auto_key ON collections(auto_key) WHERE auto_key IS NOT NULL;
  `,
];
