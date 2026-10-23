import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Building2, FolderOpen, Globe, Hash, Mail, Pencil, Phone, Plus, RefreshCw, Search, ShoppingBag, Trash2, Users } from 'lucide-react';
import AutoCollections from '../components/AutoCollections.jsx';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useConfirm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, initials, plural } from '../lib/format.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

const EMPTY_BUYER = { name: '', company: '', country: '', email: '', phone: '', address: '', notes: '' };

function BuyerModal({ buyer, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(buyer?.id ? { ...EMPTY_BUYER, ...buyer } : EMPTY_BUYER);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const saved = await api(buyer?.id ? `/buyers/${buyer.id}` : '/buyers', { method: buyer?.id ? 'PUT' : 'POST', body: form });
      toast.success(buyer?.id ? 'Buyer saved' : 'Buyer added');
      onSaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={buyer?.id ? 'Edit buyer' : 'Add buyer'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>Save buyer</Button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label="Contact name"><Input value={form.name} onChange={set('name')} required autoFocus /></Field>
        <Field label="Company"><Input value={form.company} onChange={set('company')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone / WhatsApp"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Country"><Input value={form.country} onChange={set('country')} /></Field>
        <Field label="Address"><Input value={form.address} onChange={set('address')} /></Field>
        <Field label="Notes & requirements" className="span-2"><Textarea value={form.notes} onChange={set('notes')} placeholder="Preferred materials, finishes, price targets, shipping terms…" /></Field>
      </form>
    </Modal>
  );
}

function BuyerDetail({ id, onClose, onEdit }) {
  const { data } = useApi(`/buyers/${id}`);
  const navigate = useNavigate();
  return (
    <Modal open onClose={onClose} title={data?.name || 'Buyer'} size="lg" footer={data && <><Button icon={Pencil} onClick={() => onEdit(data)}>Edit</Button><Button variant="primary" icon={BookOpen} onClick={() => navigate(`/catalogues/new?buyer=${id}`)}>New catalogue for buyer</Button></>}>
      {!data ? <Loading /> : (
        <div className="stack-lg">
          <div className="row-wrap" style={{ gap: 16 }}>
            {data.company && <span className="row"><Building2 size={15} className="muted" />{data.company}</span>}
            {data.country && <span className="row"><Globe size={15} className="muted" />{data.country}</span>}
            {data.email && <a className="row" href={`mailto:${data.email}`}><Mail size={15} />{data.email}</a>}
            {data.phone && <span className="row"><Phone size={15} className="muted" />{data.phone}</span>}
          </div>
          {data.notes && <p style={{ whiteSpace: 'pre-line' }} className="muted">{data.notes}</p>}
          <div>
            <h3 style={{ marginBottom: 8 }}>Collections</h3>
            {data.collections.length ? (
              <div className="list card">
                {data.collections.map((c) => (
                  <Link key={c.id} to={`/collections/${c.id}`} className="list-item">
                    <FolderOpen size={16} className="muted" />
                    <span className="grow">{c.name}</span>
                    <Badge>{plural(c.product_count, 'product')}</Badge>
                  </Link>
                ))}
              </div>
            ) : <p className="muted small">No collections yet.</p>}
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Catalogues sent</h3>
            {data.catalogues.length ? (
              <div className="list card">
                {data.catalogues.map((c) => (
                  <Link key={c.id} to="/catalogues" className="list-item">
                    <BookOpen size={16} className="muted" />
                    <span className="grow">{c.title}</span>
                    <span className="tiny muted">{c.product_count} products · {fmtDate(c.created_at)}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="muted small">No catalogues generated for this buyer yet.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function NewCollectionModal({ buyers, onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', buyer_id: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const c = await api('/collections', { method: 'POST', body: { ...form, buyer_id: form.buyer_id || null } });
      toast.success('Collection created — now add products');
      navigate(`/collections/${c.id}?add=1`);
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="New buyer collection" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>Create & add products</Button></>}>
      <div className="stack">
        <Field label="Collection name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 20 wooden coffee tables – Spring 2027" autoFocus /></Field>
        <Field label="Buyer">
          <Select value={form.buyer_id} onChange={(e) => setForm({ ...form, buyer_id: e.target.value })} placeholder="No buyer">
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.company ? ` (${b.company})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Buyer requirement"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What did the buyer ask for?" /></Field>
      </div>
    </Modal>
  );
}

export default function Buyers() {
  useTitle('Buyers & collections');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'collections';
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const buyers = useApi('/buyers', { query: { search: q } });
  const collections = useApi('/collections');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [newColl, setNewColl] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const canManage = can('buyers.manage');
  const natural = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true });
  const autoColls = (collections.data || []).filter((c) => c.auto_key).sort(natural);
  const buyerColls = (collections.data || []).filter((c) => !c.auto_key);
  const collCard = (c) => (
    <Link key={c.id} to={`/collections/${c.id}`} className="pcard">
      <div className="media">{c.cover_url ? <img src={c.cover_url} alt="" /> : <FolderOpen />}</div>
      <div className="body">
        <span className="name">{c.name}</span>
        <span className="meta">{c.auto_key ? `Product codes ${c.auto_key.replace(/^code:/, '')}xxx` : c.buyer_name ? `${c.buyer_name}${c.buyer_company ? ` · ${c.buyer_company}` : ''}` : 'No buyer'}</span>
        <div className="tags">
          <Badge tone="blue">{plural(c.product_count, 'product')}</Badge>
          {c.auto_key && <Badge>auto</Badge>}
          <span className="tiny muted" style={{ marginLeft: 'auto' }}>{fmtDate(c.updated_at)}</span>
        </div>
      </div>
    </Link>
  );

  const removeBuyer = async (b) => {
    if (!(await confirm({ title: `Delete ${b.name}?`, message: 'Their collections are kept but no longer linked to a buyer.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await api(`/buyers/${b.id}`, { method: 'DELETE' });
      buyers.reload();
      toast.success('Buyer deleted');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="Buyers & collections"
        subtitle="Keep buyer details and build product selections for each buyer’s requirement."
        actions={canManage && (
          <>
            <Button icon={Users} onClick={() => setEditing({})}>Add buyer</Button>
            <Button icon={Hash} onClick={() => setAutoOpen(true)}>Auto-create collections by product code</Button>
            <Button variant="primary" icon={Plus} onClick={() => setNewColl(true)}>New collection</Button>
          </>
        )}
      />
      <div className="card">
        <Tabs
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          tabs={[
            { value: 'collections', label: 'Collections', icon: FolderOpen, count: collections.data?.length },
            { value: 'buyers', label: 'Buyers', icon: Users, count: buyers.data?.length },
          ]}
        />
        {tab === 'buyers' && (
          <>
            <div className="toolbar">
              <div className="search"><Search /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyers by name, company, country…" /></div>
            </div>
            {buyers.error ? <ErrorState error={buyers.error} retry={buyers.reload} /> : !buyers.data ? <Loading /> : buyers.data.length === 0 ? (
              <Empty icon={Users} title="No buyers yet" action={canManage && <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add buyer</Button>}>Add the buyers you send catalogues to.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Buyer</th><th className="hide-sm">Country</th><th className="hide-sm">Contact</th><th className="num">Collections</th><th className="num">Catalogues</th><th /></tr></thead>
                  <tbody>
                    {buyers.data.map((b) => (
                      <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setViewing(b.id)}>
                        <td>
                          <div className="row"><span className="avatar">{initials(b.name)}</span><div><div style={{ fontWeight: 600 }}>{b.name}</div><div className="tiny muted">{b.company}</div></div></div>
                        </td>
                        <td className="hide-sm">{b.country || '—'}</td>
                        <td className="hide-sm small">{b.email || b.phone || '—'}</td>
                        <td className="num">{b.collection_count}</td>
                        <td className="num">{b.catalogue_count}</td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {canManage && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(b)} aria-label="Edit" />}
                          {canManage && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeBuyer(b)} aria-label="Delete" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {tab === 'collections' && (
          collections.error ? <ErrorState error={collections.error} retry={collections.reload} /> : !collections.data ? <Loading /> : collections.data.length === 0 ? (
            <Empty icon={ShoppingBag} title="No collections yet" action={canManage && <div className="row-wrap" style={{ justifyContent: 'center' }}><Button icon={Hash} onClick={() => setAutoOpen(true)}>Auto-create by product code</Button><Button variant="primary" icon={Plus} onClick={() => setNewColl(true)}>New collection</Button></div>}>
              A collection is a buyer-specific selection of products — e.g. “Buyer wants 20 wooden coffee tables”. Generate catalogues straight from it.
            </Empty>
          ) : (
            <div className="stack" style={{ padding: 14, gap: 18 }}>
              {buyerColls.length > 0 && (
                <div>
                  {autoColls.length > 0 && <div className="spec-group-title">Buyer collections</div>}
                  <div className="product-grid">{buyerColls.map(collCard)}</div>
                </div>
              )}
              {autoColls.length > 0 && (
                <div>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <div className="spec-group-title" style={{ margin: 0 }}>Collections by product code</div>
                    <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setAutoOpen(true)}>Refresh</Button>
                  </div>
                  <div className="product-grid">{autoColls.map(collCard)}</div>
                </div>
              )}
              {!autoColls.length && canManage && (
                <Alert tone="info">
                  Group all products by their code series automatically — DF18xxx → “Code 18”, DF19xxx → “Code 19”…{' '}
                  <button type="button" className="link-btn" onClick={() => setAutoOpen(true)}>Auto-create collections by product code</button>
                </Alert>
              )}
            </div>
          )
        )}
      </div>
      {editing && <BuyerModal buyer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); buyers.reload(); }} />}
      {viewing && <BuyerDetail id={viewing} onClose={() => setViewing(null)} onEdit={(b) => { setViewing(null); setEditing(b); }} />}
      {newColl && <NewCollectionModal buyers={buyers.data || []} onClose={() => setNewColl(false)} />}
      <AutoCollections open={autoOpen} onClose={() => setAutoOpen(false)} onApplied={() => collections.reload()} canManage={canManage} />
    </div>
  );
}
