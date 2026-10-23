import { useState } from 'react';
import { Search } from 'lucide-react';
import HistoryTimeline from '../components/HistoryTimeline.jsx';
import { Card, Empty, ErrorState, Input, Loading, PageHeader, Pagination, Select } from '../components/ui.jsx';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';

const ENTITY_LABEL = {
  product: 'Products', image: 'Images', costing: 'Costing', code: 'QR / barcodes', import: 'Excel imports', catalogue: 'Catalogues',
  buyer: 'Buyers', collection: 'Collections', user: 'Users', role: 'Roles', settings: 'Settings',
};

export default function Activity() {
  useTitle('Activity log');
  const [filters, setFilters] = useState({ entity: '', user: '', from: '', to: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search, 300);
  const { data, error, loading, reload } = useApi('/history', { query: { ...filters, search: q, page, pageSize: 50 } });
  const set = (k) => (e) => {
    setFilters({ ...filters, [k]: e.target.value });
    setPage(1);
  };
  return (
    <div className="stack-lg">
      <PageHeader title="Activity log" subtitle="Who changed what and when — products, images, costing, imports, catalogues and settings." />
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search /><Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search activity or Product ID…" /></div>
          <Select value={filters.entity} onChange={set('entity')} placeholder="All activity" style={{ width: 'auto' }}>
            {(data?.entities || []).map((e) => <option key={e} value={e}>{ENTITY_LABEL[e] || e}</option>)}
          </Select>
          <Select value={filters.user} onChange={set('user')} placeholder="All users" style={{ width: 'auto' }}>
            {(data?.users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Input type="date" value={filters.from} onChange={set('from')} style={{ width: 'auto' }} aria-label="From date" />
          <Input type="date" value={filters.to} onChange={set('to')} style={{ width: 'auto' }} aria-label="To date" />
        </div>
        {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : !data.items.length ? <Empty title="No activity found" /> : (
          <div className="card-body"><HistoryTimeline items={data.items} showProduct /></div>
        )}
        {data && data.total > 50 && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
      </div>
    </div>
  );
}
