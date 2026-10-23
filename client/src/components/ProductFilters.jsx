import { useEffect, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useDebounced } from '../lib/hooks.js';
import { Button, Input, Select } from './ui.jsx';

export const SORTS = [
  { value: 'updated_at:desc', label: 'Recently updated' },
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'sku:asc', label: 'Product ID A–Z' },
  { value: 'category:asc', label: 'Category' },
  { value: 'cbm:asc', label: 'CBM (low → high)' },
  { value: 'cbm:desc', label: 'CBM (high → low)' },
];

const FIXED_KEYS = ['category', 'subcategory', 'status', 'images', 'costing', 'buyer', 'collection'];
export const filterKeys = (query) => Object.keys(query).filter((k) => FIXED_KEYS.includes(k) || k.startsWith('f_') || k.startsWith('fl_'));

/** "Any field contains …" filter for fields that are not marked filterable. */
function FieldContains({ fields, onApply }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const apply = () => {
    if (key && value.trim()) {
      onApply(key, value.trim());
      setValue('');
    }
  };
  return (
    <div className="row" style={{ gridColumn: 'span 2', gap: 6 }}>
      <Select value={key} onChange={(e) => setKey(e.target.value)} placeholder="Another field…" aria-label="Field" style={{ maxWidth: 170 }}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </Select>
      <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} placeholder="contains…" disabled={!key} aria-label="Contains" />
      <Button onClick={apply} disabled={!key || !value.trim()}>Apply</Button>
    </div>
  );
}

/**
 * Search box + filter panel + active-filter chips for product lists.
 * `query` is a plain object; `update(patch)` merges changes (null/'' removes a key).
 */
export default function ProductFilters({ query, update, meta, right, showSort = true }) {
  const { can } = useAuth();
  const [text, setText] = useState(query.search || '');
  const debounced = useDebounced(text, 300);
  const active = filterKeys(query).filter((k) => query[k]);
  const [open, setOpen] = useState(active.length > 0);

  useEffect(() => {
    if ((query.search || '') !== debounced) update({ search: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    setText(query.search || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search]);

  const categories = meta?.categories || [];
  const sub = categories.find((c) => String(c.id) === String(query.category))?.children || [];
  const set = (k) => (e) => update({ [k]: e.target.value || null, ...(k === 'category' ? { subcategory: null } : {}), page: null });

  const chipLabel = (k) => {
    const v = query[k];
    if (k === 'category' || k === 'subcategory') {
      const all = categories.flatMap((c) => [c, ...c.children]);
      return `${k === 'category' ? 'Category' : 'Sub category'}: ${all.find((c) => String(c.id) === String(v))?.name || v}`;
    }
    if (k === 'buyer') return `Buyer: ${meta?.buyers?.find((b) => String(b.id) === String(v))?.name || v}`;
    if (k === 'collection') return `Collection: ${meta?.collections?.find((b) => String(b.id) === String(v))?.name || v}`;
    if (k === 'images') return v === 'with' ? 'Has images' : 'No images';
    if (k === 'costing') return v === 'with' ? 'Has costing' : 'No costing';
    if (k === 'status') return `Status: ${v}`;
    const key = k.replace(/^fl?_/, '');
    const label = meta?.fields?.find((f) => f.key === key)?.label || key;
    return `${label}: ${v}`;
  };

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search ID, name, material, finish, dimensions…" aria-label="Search products" />
        </div>
        <Button icon={Filter} variant={open || active.length ? 'soft' : undefined} onClick={() => setOpen((o) => !o)}>
          Filters{active.length ? ` · ${active.length}` : ''}
        </Button>
        {showSort && (
          <Select value={query.sort || 'updated_at:desc'} onChange={(e) => update({ sort: e.target.value, page: null })} style={{ width: 'auto' }} aria-label="Sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        )}
        {right}
      </div>
      {open && (
        <div className="filter-panel">
          <Select value={query.category || ''} onChange={set('category')} placeholder="All categories" aria-label="Category">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.product_count})</option>)}
          </Select>
          <Select value={query.subcategory || ''} onChange={set('subcategory')} placeholder="All sub categories" disabled={!sub.length} aria-label="Sub category">
            {sub.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {meta?.filters?.map((f) => (
            <Select key={f.key} value={query[`f_${f.key}`] || ''} onChange={set(`f_${f.key}`)} placeholder={`Any ${f.label.toLowerCase()}`} aria-label={f.label}>
              {f.values.map((v) => <option key={v.value} value={v.value}>{v.value} ({v.count})</option>)}
            </Select>
          ))}
          <Select value={query.status || ''} onChange={set('status')} placeholder="Any status" aria-label="Status" options={meta?.statuses || []} />
          <Select value={query.images || ''} onChange={set('images')} placeholder="Images: any" aria-label="Images">
            <option value="with">Has images</option>
            <option value="without">No images</option>
          </Select>
          {can('costing.view') && (
            <Select value={query.costing || ''} onChange={set('costing')} placeholder="Costing: any" aria-label="Costing">
              <option value="with">Has costing</option>
              <option value="without">No costing</option>
            </Select>
          )}
          {meta?.buyers?.length > 0 && (
            <Select value={query.buyer || ''} onChange={set('buyer')} placeholder="Any buyer" aria-label="Buyer">
              {meta.buyers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.company ? ` (${b.company})` : ''}</option>)}
            </Select>
          )}
          {meta?.collections?.length > 0 && (
            <Select value={query.collection || ''} onChange={set('collection')} placeholder="Any buyer collection" aria-label="Buyer collection">
              {meta.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <FieldContains fields={meta?.fields || []} onApply={(key, v) => update({ [`fl_${key}`]: v, page: null })} />
        </div>
      )}
      {active.length > 0 && (
        <div className="active-filters">
          {active.map((k) => (
            <span className="chip" key={k}>
              {chipLabel(k)}
              <button type="button" onClick={() => update({ [k]: null, ...(k === 'category' ? { subcategory: null } : {}), page: null })} aria-label="Remove filter"><X /></button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={() => update(Object.fromEntries([...active.map((k) => [k, null]), ['page', null]]))}>Clear all</Button>
        </div>
      )}
    </>
  );
}
