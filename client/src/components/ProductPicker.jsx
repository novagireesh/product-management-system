import { useState } from 'react';
import { useApi } from '../lib/hooks.js';
import ProductFilters from './ProductFilters.jsx';
import { ProductTable } from './ProductTable.jsx';
import { Button, Empty, Loading, Modal, Pagination } from './ui.jsx';

/** Searchable, filterable product list with checkbox selection. Controlled via selected/onChange (Set of ids). */
export function ProductPickerList({ selected, onChange, pageSize = 20 }) {
  const [query, setQuery] = useState({});
  const [page, setPage] = useState(1);
  const meta = useApi('/products/meta');
  const { data, loading } = useApi('/products', { query: { ...query, page, pageSize } });
  const update = (patch) => {
    setQuery((q) => {
      const next = { ...q };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'page') continue;
        if (v === null || v === '' || v === undefined) delete next[k];
        else next[k] = v;
      }
      return next;
    });
    if (!('page' in patch) || patch.page === null) setPage(1);
    else setPage(patch.page);
  };
  const items = data?.items || [];
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div>
      <ProductFilters query={query} update={update} meta={meta.data} />
      {loading && !data ? (
        <Loading />
      ) : items.length ? (
        <ProductTable
          items={items}
          fields={meta.data?.fields}
          columns={['material', 'finish']}
          selected={selected}
          onToggle={toggle}
          link={false}
          onToggleAll={(on) => {
            const next = new Set(selected);
            for (const p of items) (on ? next.add(p.id) : next.delete(p.id));
            onChange(next);
          }}
        />
      ) : (
        <Empty title="No products match" />
      )}
      {data && data.total > pageSize && <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

export default function ProductPicker({ open, onClose, onPick, title = 'Select products', confirmLabel = 'Add selected' }) {
  const [selected, setSelected] = useState(new Set());
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={title}
      footer={
        <>
          <span className="muted small grow">{selected.size} selected</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected.size} onClick={() => { onPick([...selected]); setSelected(new Set()); }}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="card" style={{ margin: -20, border: 0, boxShadow: 'none' }}>
        <ProductPickerList selected={selected} onChange={setSelected} />
      </div>
    </Modal>
  );
}
