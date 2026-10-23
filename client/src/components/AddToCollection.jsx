import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Button, Field, Input, Modal, Segmented, Select, Textarea } from './ui.jsx';

/** Add products to an existing buyer collection, or create a new one with them. */
export default function AddToCollection({ open, onClose, productIds, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('new');
  const [collections, setCollections] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [form, setForm] = useState({ collection_id: '', name: '', buyer_id: '', notes: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([api('/collections'), api('/buyers')])
      .then(([c, b]) => {
        setCollections(c);
        setBuyers(b);
        setMode(c.length ? 'existing' : 'new');
        setForm((f) => ({ ...f, collection_id: c[0]?.id || '' }));
      })
      .catch((err) => toast.error(err));
  }, [open, toast]);

  const submit = async () => {
    setBusy(true);
    try {
      let collection;
      if (mode === 'existing') {
        const r = await api(`/collections/${form.collection_id}/products`, { method: 'POST', body: { product_ids: productIds } });
        collection = r.collection;
        toast.success(`${r.added} product${r.added === 1 ? '' : 's'} added to ${collection.name}`);
      } else {
        collection = await api('/collections', { method: 'POST', body: { name: form.name, buyer_id: form.buyer_id || null, notes: form.notes, product_ids: productIds } });
        toast.success(`Collection “${collection.name}” created`);
      }
      onDone?.(collection);
      onClose();
      navigate(`/collections/${collection.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${productIds.length} product${productIds.length === 1 ? '' : 's'} to a buyer collection`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={mode === 'existing' ? !form.collection_id : !form.name.trim()}>
            {mode === 'existing' ? 'Add to collection' : 'Create collection'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {collections.length > 0 && (
          <Segmented value={mode} onChange={setMode} options={[{ value: 'existing', label: 'Existing collection' }, { value: 'new', label: 'New collection' }]} />
        )}
        {mode === 'existing' ? (
          <Field label="Collection">
            <Select value={form.collection_id} onChange={(e) => setForm({ ...form, collection_id: e.target.value })}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.buyer_name ? ` — ${c.buyer_name}` : ''} ({c.product_count})</option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Collection name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nordhus – 20 coffee tables" autoFocus /></Field>
            <Field label="Buyer" hint={buyers.length ? undefined : 'You can add buyers on the Buyers page.'}>
              <Select value={form.buyer_id} onChange={(e) => setForm({ ...form, buyer_id: e.target.value })} placeholder="No buyer">
                {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.company ? ` (${b.company})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Requirement notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Buyer wants 20 wooden coffee tables in light finishes" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
