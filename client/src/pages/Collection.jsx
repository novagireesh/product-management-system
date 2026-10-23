import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, BookOpen, Container, Hash, Pencil, Plus, QrCode, RefreshCw, Trash2, X } from 'lucide-react';
import AutoCollections from '../components/AutoCollections.jsx';
import ProductPicker from '../components/ProductPicker.jsx';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Textarea, Thumb, useConfirm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtNum, plural } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useSelection } from '../lib/selection.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Collection() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const selection = useSelection();
  const { data, error, loading, reload, setData } = useApi(`/collections/${id}`);
  const buyers = useApi('/buyers');
  const [picker, setPicker] = useState(params.get('add') === '1');
  const [editing, setEditing] = useState(null);
  const [autoOpen, setAutoOpen] = useState(false);
  useTitle(data?.name);
  const canManage = can('buyers.manage');
  // Collections kept from product codes (Code 18 = DF18xxx) get their products only from that rule.
  const isAuto = Boolean(data?.auto_key);
  const canEditList = canManage && !isAuto;

  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !data) return <Loading />;

  const add = async (ids) => {
    try {
      const r = await api(`/collections/${id}/products`, { method: 'POST', body: { product_ids: ids } });
      setData(r.collection);
      toast.success(`${plural(r.added, 'product')} added`);
      setPicker(false);
      if (params.get('add')) setParams({}, { replace: true });
    } catch (err) {
      toast.error(err);
    }
  };
  const removeOne = async (pid) => {
    try {
      setData(await api(`/collections/${id}/products/remove`, { method: 'POST', body: { product_ids: [pid] } }));
    } catch (err) {
      toast.error(err);
    }
  };
  const move = async (idx, dir) => {
    const ids = data.products.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    setData(await api(`/collections/${id}/order`, { method: 'PUT', body: { product_ids: ids } }));
  };
  const saveItem = async (pid, quantity, notes) => {
    try {
      setData(await api(`/collections/${id}/products/${pid}`, { method: 'PUT', body: { quantity: quantity === '' ? null : quantity, notes } }));
    } catch (err) {
      toast.error(err);
    }
  };
  const saveMeta = async () => {
    try {
      setData(await api(`/collections/${id}`, { method: 'PUT', body: { ...editing, buyer_id: editing.buyer_id || null } }));
      setEditing(null);
      toast.success('Collection saved');
    } catch (err) {
      toast.error(err);
    }
  };
  const remove = async () => {
    const message = isAuto
      ? 'The products themselves are not affected. Refreshing collections by product code will create it again.'
      : 'The products themselves are not affected.';
    if (!(await confirm({ title: 'Delete this collection?', message, danger: true, confirmLabel: 'Delete collection' }))) return;
    await api(`/collections/${id}`, { method: 'DELETE' });
    toast.success('Collection deleted');
    navigate('/buyers');
  };
  const ids = data.products.map((p) => p.id);
  const totalQty = data.products.reduce((a, p) => a + (p.quantity || 0), 0);

  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={<><Link to="/buyers">Buyers & collections</Link><span>/</span><span>Collection</span></>}
        title={<>{data.name}{isAuto && <> <Badge>auto</Badge></>}</>}
        subtitle={`${data.buyer_name ? `For ${data.buyer_name}${data.buyer_company ? ` (${data.buyer_company})` : ''} · ` : ''}${plural(data.products.length, 'product')}${totalQty ? ` · ${totalQty} pcs requested` : ''} · updated ${fmtDate(data.updated_at)}`}
        actions={
          <>
            {canManage && <Button icon={Pencil} onClick={() => setEditing({ name: data.name, buyer_id: data.buyer_id || '', notes: data.notes || '' })}>Edit</Button>}
            {can('codes.manage') && ids.length > 0 && <Button icon={QrCode} onClick={() => { selection.set(ids); navigate('/codes?from=selection'); }}>Labels</Button>}
            {canEditList && <Button icon={Plus} onClick={() => setPicker(true)}>Add products</Button>}
            {isAuto && canManage && <Button icon={RefreshCw} onClick={() => setAutoOpen(true)}>Refresh from product codes</Button>}
            {can('catalogues.generate') && <Button variant="primary" icon={BookOpen} disabled={!ids.length} onClick={() => navigate(`/catalogues/new?collection=${id}`)}>Generate catalogue</Button>}
          </>
        }
      />
      {isAuto && (
        <Alert icon={Hash}>
          Kept automatically from product codes: every product whose code starts with <span className="mono">{data.auto_key.replace(/^code:/, '')}</span> followed by
          three digits (letter suffixes included). New products join when you choose “Refresh from product codes”. Quantities and notes are kept.
        </Alert>
      )}
      {data.notes && <Card><p style={{ whiteSpace: 'pre-line' }}><strong>Buyer requirement: </strong>{data.notes}</p></Card>}

      <Card pad={false}>
        {data.products.length === 0 ? (
          <Empty title="This collection is empty" action={canEditList && <Button variant="primary" icon={Plus} onClick={() => setPicker(true)}>Add products</Button>}>
            Search and select the products that match the buyer’s requirement.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 40 }}>#</th><th>Product</th><th className="hide-sm">Category</th><th className="hide-sm num">CBM</th><th className="hide-sm num" title="Pieces per container (Settings › Calculation rules)">Loadability</th><th style={{ width: 110 }}>Quantity</th><th className="hide-sm">Notes</th><th /></tr></thead>
              <tbody>
                {data.products.map((p, i) => (
                  <tr key={p.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <div className="row"><Thumb src={p.thumb_url} />
                        <div><Link to={`/products/${p.id}`} style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</Link><div className="tiny muted mono">{p.sku} {p.status !== 'active' && <StatusBadge status={p.status} />}</div></div>
                      </div>
                    </td>
                    <td className="hide-sm">{p.category || '—'}</td>
                    <td className="hide-sm num small">{p.cbm ?? '—'}</td>
                    <td className="hide-sm num small nowrap">{p.loadability_text || '—'}</td>
                    <td>
                      {canManage ? <Input size="sm" type="number" min={0} defaultValue={p.quantity ?? ''} onBlur={(e) => String(e.target.value) !== String(p.quantity ?? '') && saveItem(p.id, e.target.value, p.notes)} aria-label="Quantity" /> : p.quantity ?? '—'}
                    </td>
                    <td className="hide-sm">
                      {canManage ? <Input size="sm" defaultValue={p.notes ?? ''} placeholder="e.g. in white wash" onBlur={(e) => e.target.value !== (p.notes ?? '') && saveItem(p.id, p.quantity ?? '', e.target.value)} aria-label="Notes" /> : p.notes}
                    </td>
                    <td className="actions">
                      {canEditList && (
                        <>
                          <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                          <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === data.products.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                          <Button size="sm" variant="ghost" icon={X} onClick={() => removeOne(p.id)} aria-label="Remove from collection" />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data.load?.total_qty > 0 && (
        <Card title="Container load (estimate)" icon={Container}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-wrap" style={{ gap: 28 }}>
              <div><div className="tiny muted">Quantity</div><strong>{fmtNum(data.load.total_qty)} pcs</strong></div>
              <div><div className="tiny muted">Total CBM</div><strong>{data.load.total_cbm} m³</strong></div>
              <div><div className="tiny muted">Containers</div><strong>≈ {data.load.containers}</strong> <span className="small muted">({Math.round(data.load.containers * 100)}% of one)</span></div>
            </div>
            <p className="tiny muted">Quantity × CBM of each product, with one container holding {data.load.container_cbm} CBM (the loadability rule in Settings › Calculation rules).</p>
            {data.load.missing_cbm > 0 && <Alert tone="warn">{data.load.missing_cbm} product{data.load.missing_cbm === 1 ? ' has' : 's have'} a quantity but no CBM, so {data.load.missing_cbm === 1 ? 'it is' : 'they are'} not counted.</Alert>}
          </div>
        </Card>
      )}
      {canManage && <div><Button variant="ghost" icon={Trash2} onClick={remove}>Delete collection</Button></div>}

      <ProductPicker open={picker} onClose={() => setPicker(false)} onPick={add} title={`Add products to “${data.name}”`} />
      {isAuto && <AutoCollections open={autoOpen} onClose={() => setAutoOpen(false)} onApplied={() => reload()} canManage={canManage} />}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit collection" footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={saveMeta}>Save</Button></>}>
        {editing && (
          <div className="stack">
            <Field label="Name" hint={isAuto ? 'Set by the product-code series (change the format in “Refresh from product codes”)' : undefined}>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={isAuto} />
            </Field>
            <Field label="Buyer">
              <Select value={editing.buyer_id} onChange={(e) => setEditing({ ...editing, buyer_id: e.target.value })} placeholder="No buyer">
                {(buyers.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.company ? ` (${b.company})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Buyer requirement"><Textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
