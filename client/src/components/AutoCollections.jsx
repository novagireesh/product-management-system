import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, RefreshCw, ScanSearch } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDebounced } from '../lib/hooks.js';
import { plural } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Alert, Badge, Button, Field, Input, Loading, Modal } from './ui.jsx';

function Codes({ codes }) {
  const [all, setAll] = useState(false);
  const shown = all ? codes : codes.slice(0, 18);
  return (
    <div className="code-chips">
      {shown.map((c) => <span key={c} className="code-chip">{c}</span>)}
      {codes.length > shown.length && <button type="button" className="link-btn tiny" onClick={() => setAll(true)}>+{codes.length - shown.length} more</button>}
    </div>
  );
}

const change = (c) => {
  if (!c.exists) return <Badge tone="blue">New</Badge>;
  const parts = [c.added && `+${c.added}`, c.removed && `−${c.removed}`, c.renamed && 'renamed'].filter(Boolean);
  return parts.length ? <Badge tone="amber">{parts.join(' · ')}</Badge> : <Badge tone="green">Up to date</Badge>;
};

/**
 * Auto-create / refresh collections by product code (DF18001 → “Code 18”).
 * Opens with a scan (nothing saved); the button then creates or refreshes the collections.
 */
export default function AutoCollections({ open, onClose, onApplied, canManage }) {
  const toast = useToast();
  const [template, setTemplate] = useState('');
  const debounced = useDebounced(template, 300);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError(null);
    api('/collections/auto', { query: debounced.includes('{series}') ? { template: debounced } : undefined })
      .then((p) => {
        setPlan(p);
        setTemplate((t) => t || p.template);
      })
      .catch((err) => setError(err.message));
  }, [open, debounced]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api('/collections/auto', { method: 'POST', body: { name_template: template } });
      setPlan(r);
      setDone(r.totals);
      toast.success(`Collections by product code: ${r.totals.created} created, ${r.totals.added} products added`);
      onApplied?.(r);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const total = plan?.collections.reduce((a, c) => a + c.product_count, 0) ?? 0;
  const pending = plan?.collections.filter((c) => !c.exists || c.added || c.removed || c.renamed).length ?? 0;
  const templateOk = template.includes('{series}');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Collections by product code"
      footer={
        <>
          <Button onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
          {canManage && (
            <Button variant="primary" icon={RefreshCw} onClick={apply} loading={busy} disabled={!plan || !templateOk || (plan.up_to_date && !done)}>
              {plan?.collections.some((c) => c.exists) ? `Refresh ${plural(plan.collections.length, 'collection')}` : `Create ${plural(plan?.collections.length || 0, 'collection')}`}
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          Products are grouped by the series in their <strong>product code</strong> — the number in front of the last three digits:
          <span className="mono"> DF18001</span>, <span className="mono">DF18070A</span> → series 18; <span className="mono">DF6053</span> → series 6.
          Names, materials and other details are not used. Run it again any time: new products are added, nothing is duplicated.
        </p>
        <Field label="Collection name format" hint="{series} is replaced by the series number, e.g. Code 18">
          <Input value={template} onChange={(e) => setTemplate(e.target.value)} style={{ maxWidth: 260 }} disabled={!canManage} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        {!plan && !error && <Loading />}
        {plan && (
          <>
            {done ? (
              <Alert tone="success" icon={CheckCircle2}>
                Done: {done.created} created, {done.updated} updated, {plural(done.added, 'product')} added{done.removed ? `, ${done.removed} moved out` : ''}{done.deleted ? `, ${done.deleted} empty removed` : ''}.
              </Alert>
            ) : (
              <div className="row-wrap small">
                <ScanSearch size={16} className="muted" />
                <span><strong>{plural(plan.collections.length, 'series', 'series')}</strong> found · {plural(total, 'product')} matched{plan.unmatched.length ? ` · ${plan.unmatched.length} not matching the pattern` : ''}</span>
                {plan.up_to_date ? <Badge tone="green">All collections up to date</Badge> : pending > 0 && <Badge tone="amber">{pending} to create or update</Badge>}
              </div>
            )}
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="table table-compact">
                <thead><tr><th>Collection</th><th>Codes</th><th className="num">Products</th><th>Change</th></tr></thead>
                <tbody>
                  {plan.collections.map((c) => (
                    <tr key={c.key}>
                      <td className="nowrap">
                        {c.collection_id && done ? <Link to={`/collections/${c.collection_id}`} onClick={onClose} style={{ fontWeight: 600 }}>{c.name}</Link> : <strong>{c.name}</strong>}
                        <div className="tiny muted mono">{c.pattern}</div>
                      </td>
                      <td><Codes codes={c.codes} /></td>
                      <td className="num">{c.product_count}</td>
                      <td>{change(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plan.unmatched.length > 0 && (
              <Alert tone="warn" title={`${plural(plan.unmatched.length, 'product code')} not matching the pattern (letters + number ending in 3 digits)`}>
                <Codes codes={plan.unmatched} />
              </Alert>
            )}
            {plan.stale.length > 0 && !done && (
              <Alert tone="info">{plan.stale.map((s) => s.name).join(', ')}: no products left in this series — the empty collection will be removed.</Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
