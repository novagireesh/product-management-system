import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Copy, Eye, FileSpreadsheet, FileText, LibraryBig, Plus, Presentation, Search, Trash2 } from 'lucide-react';
import { Badge, Button, Empty, ErrorState, Input, Loading, Modal, PageHeader, Pagination, useConfirm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtBytes, fmtDate } from '../lib/format.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { useSelection } from '../lib/selection.jsx';
import { useToast } from '../lib/toast.jsx';

const ICON = { pdf: FileText, pptx: Presentation, xlsx: FileSpreadsheet };
const LABEL = { pdf: 'PDF', pptx: 'PPT', xlsx: 'Excel' };
const TEMPLATE = { simple: 'Simple', premium: 'Premium', buyer: 'Buyer specific' };

function ProductsModal({ id, onClose }) {
  const { data } = useApi(`/catalogues/${id}`);
  return (
    <Modal open onClose={onClose} title={data?.title || 'Catalogue'}>
      {!data ? <Loading /> : (
        <div className="list card">
          {data.products.map((p, i) => (
            <div key={i} className="list-item" style={{ padding: '8px 14px' }}>
              <span className="tiny muted" style={{ width: 22 }}>{i + 1}</span>
              {p.product_id ? <Link to={`/products/${p.product_id}`} className="grow">{p.name}</Link> : <span className="grow muted">{p.name} (deleted)</span>}
              <span className="mono tiny muted">{p.sku}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Catalogues() {
  useTitle('Catalogue history');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const selection = useSelection();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const { data, error, loading, reload } = useApi('/catalogues', { query: { page, pageSize: 20, search: q } });
  const [viewing, setViewing] = useState(null);

  const remove = async (c) => {
    if (!(await confirm({ title: `Delete “${c.title}”?`, message: 'The generated files will be removed from the server.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await api(`/catalogues/${c.id}`, { method: 'DELETE' });
      toast.success('Catalogue deleted');
      reload();
    } catch (err) {
      toast.error(err);
    }
  };

  const reuse = async (c) => {
    const full = await api(`/catalogues/${c.id}`);
    selection.set(full.products.map((p) => p.product_id).filter(Boolean));
    navigate('/catalogues/new?from=selection');
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="Catalogue history"
        subtitle="Every catalogue generated, with its files ready to download again."
        actions={can('catalogues.generate') && <Button variant="primary" icon={Plus} onClick={() => navigate('/catalogues/new')}>New catalogue</Button>}
      />
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search /><Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by title or buyer…" /></div>
        </div>
        {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : !data.items.length ? (
          <Empty icon={LibraryBig} title="No catalogues yet" action={can('catalogues.generate') && <Button variant="primary" icon={BookOpen} onClick={() => navigate('/catalogues/new')}>Generate a catalogue</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Catalogue</th><th className="hide-sm">Buyer</th><th className="hide-sm">Template</th><th className="num">Products</th><th>Files</th><th className="hide-sm">Created</th><th /></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.title}</div>
                      {c.collection_name && <div className="tiny muted">From collection: {c.collection_name}</div>}
                    </td>
                    <td className="hide-sm">{c.buyer_name ? <>{c.buyer_name}<div className="tiny muted">{c.buyer_company}</div></> : <span className="muted">—</span>}</td>
                    <td className="hide-sm"><Badge>{TEMPLATE[c.template]}</Badge></td>
                    <td className="num"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing(c.id)}>{c.product_count}</button></td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {c.files.map((f) => {
                          const I = ICON[f.format];
                          return <a key={f.format} className="btn btn-sm" href={`/api/catalogues/${c.id}/download/${f.format}`} title={`Download ${LABEL[f.format]} · ${fmtBytes(f.size_bytes)}`}><I /> {LABEL[f.format]}</a>;
                        })}
                        {c.files.some((f) => f.format === 'pdf') && <a className="btn btn-sm btn-ghost" href={`/api/catalogues/${c.id}/download/pdf?inline=1`} target="_blank" rel="noreferrer" title="Preview PDF" aria-label="Preview PDF"><Eye /></a>}
                      </div>
                    </td>
                    <td className="hide-sm small nowrap">{fmtDate(c.created_at, true)}<div className="tiny muted">{c.created_by_name}</div></td>
                    <td className="actions">
                      {can('catalogues.generate') && <Button size="sm" variant="ghost" icon={Copy} onClick={() => reuse(c)} title="Start a new catalogue with these products" aria-label="Reuse products" />}
                      {can('catalogues.generate') && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(c)} aria-label="Delete" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 20 && <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />}
      </div>
      {viewing && <ProductsModal id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
