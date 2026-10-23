import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye, Mail, Phone, ScanLine, Search, Trash2, UserRound, Users } from 'lucide-react';
import { Button, Empty, ErrorState, Input, Loading, Modal, PageHeader, Pagination, StatCard, useConfirm } from '../components/ui.jsx';
import { api, downloadUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, timeAgo } from '../lib/format.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

function VisitorModal({ id, onClose }) {
  const { data } = useApi(`/visitors/${id}`);
  return (
    <Modal open onClose={onClose} title={data?.name || data?.email || 'Visitor'}>
      {!data ? <Loading /> : (
        <div className="stack">
          <div className="stack" style={{ gap: 6 }}>
            {data.email && <a className="row" href={`mailto:${data.email}`}><Mail size={15} /> {data.email}</a>}
            {data.phone && <a className="row" href={`tel:${data.phone.replace(/\s/g, '')}`}><Phone size={15} /> {data.phone}</a>}
            <span className="small muted">Shared details on {fmtDate(data.created_at, true)}</span>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Products scanned ({data.scans.length})</div>
            {data.scans.length ? (
              <div className="list card">
                {data.scans.map((s, i) => (
                  <Link key={i} to={`/products/${s.product_id}`} className="list-item" style={{ padding: '8px 14px' }}>
                    <ScanLine size={15} className="muted" />
                    <span className="grow truncate">{s.name}</span>
                    <span className="mono tiny muted">{s.sku}</span>
                    <span className="tiny muted nowrap">{timeAgo(s.created_at)}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="muted small">No scans recorded.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Visitors() {
  useTitle('Scan visitors');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const q = useDebounced(search, 300);
  const { data, error, loading, reload } = useApi('/visitors', { query: { search: q, page, pageSize: 50 } });

  const remove = async (v) => {
    if (!(await confirm({ title: 'Delete this visitor record?', message: 'Their name, email and mobile number will be removed permanently.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await api('/visitors/delete', { method: 'POST', body: { ids: [v.id] } });
      toast.success('Visitor record deleted');
      reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="Scan visitors"
        subtitle="People who scanned a product QR code and chose to share their details. Sharing is optional for them."
        actions={<Button icon={Download} onClick={() => downloadUrl('/visitors/export.xlsx', { search: q })}>Export Excel</Button>}
      />
      {data && (
        <div className="stat-grid">
          <StatCard icon={Users} label="Visitors who shared details" value={data.stats.visitors} tone="blue" />
          <StatCard icon={UserRound} label="New in the last 7 days" value={data.stats.last7} tone="green" />
          <StatCard icon={ScanLine} label="Total product scans" value={data.stats.scans} hint={`${data.stats.anonymousScans} without details`} tone="slate" />
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search /><Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, email, mobile or product…" /></div>
        </div>
        {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : !data.items.length ? (
          <Empty icon={UserRound} title="No visitor details yet">
            When someone scans a product QR code without being signed in, they are invited (optionally) to share their name, email and mobile number.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Visitor</th><th>Contact</th><th className="hide-sm">First product scanned</th><th className="num hide-sm">Scans</th><th className="hide-sm">Shared</th><th /></tr></thead>
              <tbody>
                {data.items.map((v) => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{v.name || <span className="muted">(no name)</span>}</td>
                    <td className="small">
                      {v.email && <div><a href={`mailto:${v.email}`}>{v.email}</a></div>}
                      {v.phone && <div>{v.phone}</div>}
                    </td>
                    <td className="hide-sm small">{v.first_product_id ? <Link to={`/products/${v.first_product_id}`}><span className="mono">{v.first_sku}</span> · {v.first_name}</Link> : '—'}</td>
                    <td className="num hide-sm">{v.scan_count}</td>
                    <td className="hide-sm small nowrap">{fmtDate(v.created_at, true)}</td>
                    <td className="actions">
                      <Button size="sm" variant="ghost" icon={Eye} onClick={() => setViewing(v.id)} aria-label="View scans" />
                      {can('visitors.manage') && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(v)} aria-label="Delete" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 50 && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
      </div>
      {viewing && <VisitorModal id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
