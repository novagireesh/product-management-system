import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Boxes, Download, FileSpreadsheet, FolderPlus, LayoutGrid, List, Plus, QrCode, Trash2, X, CircleDot,
} from 'lucide-react';
import AddToCollection from '../components/AddToCollection.jsx';
import ProductFilters from '../components/ProductFilters.jsx';
import { ProductCards, ProductTable } from '../components/ProductTable.jsx';
import { Button, Empty, ErrorState, Loading, Menu, PageHeader, Pagination, Segmented, useConfirm } from '../components/ui.jsx';
import { api, downloadUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { plural } from '../lib/format.js';
import { useApi, useStored, useTitle } from '../lib/hooks.js';
import { useSelection } from '../lib/selection.jsx';
import { useToast } from '../lib/toast.jsx';

export function useQueryState() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params);
  const update = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined || v === '') next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      },
      { replace: true },
    );
  return [query, update];
}

export default function Products() {
  useTitle('Products');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const selection = useSelection();
  const [query, update] = useQueryState();
  const [view, setView] = useStored('pm.products.view', 'grid');
  const [pageSize, setPageSize] = useStored('pm.products.pageSize', 24);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const meta = useApi('/products/meta');
  const onlySelected = query.selected === '1';
  const page = Number(query.page) || 1;
  const listQuery = { ...query, selected: undefined, page, pageSize, ids: onlySelected ? selection.ids.join(',') || '0' : undefined };
  const { data, error, loading, reload } = useApi('/products', { query: listQuery });

  const selected = new Set(selection.ids);
  const items = data?.items || [];

  const selectAllMatching = async () => {
    try {
      const ids = await api('/products/ids', { query: { ...query, selected: undefined, page: undefined } });
      selection.add(ids);
      toast.info(`${ids.length} products selected`);
    } catch (err) {
      toast.error(err);
    }
  };

  const bulkDelete = async () => {
    const ok = await confirm({ title: `Delete ${plural(selection.count, 'product')}?`, message: 'Products, their images, codes and costing will be permanently removed. Their change history is kept.', danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      const r = await api('/products/bulk-delete', { method: 'POST', body: { ids: selection.ids } });
      toast.success(`${plural(r.deleted, 'product')} deleted`);
      selection.clear();
      reload();
    } catch (err) {
      toast.error(err);
    }
  };

  const bulkStatus = async (status) => {
    try {
      const r = await api('/products/bulk-update', { method: 'POST', body: { ids: selection.ids, status } });
      toast.success(`${plural(r.updated, 'product')} set to ${status}`);
      reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={data ? `${plural(data.total, 'product')}${onlySelected ? ' selected' : ''}` : 'Your complete product database'}
        actions={
          <>
            {can('products.import') && (
              <Button icon={Download} onClick={() => downloadUrl('/products/export.xlsx', { ...query, selected: undefined, ids: onlySelected ? selection.ids.join(',') : undefined })}>Export Excel</Button>
            )}
            {can('products.import') && <Button icon={FileSpreadsheet} onClick={() => navigate('/import')}>Import</Button>}
            {can('products.create') && <Button variant="primary" icon={Plus} onClick={() => navigate('/products/new')}>Add product</Button>}
          </>
        }
      />

      <div className="card">
        <ProductFilters
          query={query}
          update={update}
          meta={meta.data}
          right={
            <Segmented
              value={view}
              onChange={setView}
              options={[{ value: 'grid', icon: LayoutGrid, title: 'Card view' }, { value: 'table', icon: List, title: 'Table view' }]}
            />
          }
        />
        {onlySelected && (
          <div className="active-filters">
            <span className="chip">Showing selected products only<button type="button" onClick={() => update({ selected: null })} aria-label="Show all"><X /></button></span>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="row small" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', gap: 12 }}>
            <span className="muted">{selection.count ? `${selection.count} selected` : 'Select products to build collections, catalogues and labels'}</span>
            <div className="grow" />
            {!onlySelected && data.total > items.length && <Button size="sm" variant="ghost" onClick={selectAllMatching}>Select all {data.total} results</Button>}
            {!onlySelected && <Button size="sm" variant="ghost" onClick={() => selection.add(items.map((p) => p.id))}>Select page</Button>}
          </div>
        )}

        {error ? (
          <ErrorState error={error} retry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty
            icon={Boxes}
            title={data?.total === 0 && Object.keys(query).length === 0 ? 'No products yet' : 'No products match'}
            action={Object.keys(query).length > 0 ? <Button onClick={() => update(Object.fromEntries(Object.keys(query).map((k) => [k, null])))}>Clear search & filters</Button> : can('products.import') && <Button variant="primary" icon={FileSpreadsheet} onClick={() => navigate('/import')}>Import from Excel</Button>}
          >
            {Object.keys(query).length ? 'Try a different search term or remove some filters.' : 'Import your Excel product list or add products one by one.'}
          </Empty>
        ) : view === 'grid' ? (
          <ProductCards items={items} selected={selected} onToggle={selection.toggle} />
        ) : (
          <ProductTable
            items={items}
            fields={meta.data?.fields}
            selected={selected}
            onToggle={selection.toggle}
            onToggleAll={(on) => (on ? selection.add(items.map((p) => p.id)) : selection.remove(items.map((p) => p.id)))}
          />
        )}
        {data && data.total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={data.total} onPage={(p) => update({ page: p })} onPageSize={(s) => { setPageSize(s); update({ page: null }); }} />
        )}
      </div>

      {selection.count > 0 && (
        <div className="bulkbar">
          <span className="count">{plural(selection.count, 'product')} selected</span>
          {can('buyers.manage') && <Button size="sm" icon={FolderPlus} onClick={() => setCollectionOpen(true)}>Add to collection</Button>}
          {can('catalogues.generate') && <Button size="sm" variant="primary" icon={BookOpen} onClick={() => navigate('/catalogues/new?from=selection')}>Generate catalogue</Button>}
          {can('codes.manage') && <Button size="sm" icon={QrCode} onClick={() => navigate('/codes?from=selection')}>Labels & codes</Button>}
          {can('products.import') && <Button size="sm" icon={Download} onClick={() => downloadUrl('/products/export.xlsx', { ids: selection.ids.join(',') })}>Export</Button>}
          {can('products.edit') && (
            <Menu trigger={({ toggle }) => <Button size="sm" icon={CircleDot} onClick={toggle}>Status</Button>}>
              {['active', 'inactive', 'draft'].map((s) => <button key={s} type="button" onClick={() => bulkStatus(s)}>Mark as {s}</button>)}
            </Menu>
          )}
          {can('products.delete') && <Button size="sm" icon={Trash2} onClick={bulkDelete}>Delete</Button>}
          {!onlySelected && <Button size="sm" onClick={() => update({ selected: '1', page: null })}>View</Button>}
          <Button size="sm" icon={X} onClick={() => { selection.clear(); if (onlySelected) update({ selected: null }); }} aria-label="Clear selection" />
        </div>
      )}

      <AddToCollection open={collectionOpen} onClose={() => setCollectionOpen(false)} productIds={selection.ids} />
    </div>
  );
}
