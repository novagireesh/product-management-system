import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, Columns3, Download, FileSpreadsheet, FlaskConical, Lock, RotateCcw, Save, Settings2, SlidersHorizontal, Undo2 } from 'lucide-react';
import ProductFilters from '../components/ProductFilters.jsx';
import { Alert, Button, Card, Empty, ErrorState, Loading, PageHeader, Pagination, Switch, Thumb, useConfirm } from '../components/ui.jsx';
import { api, downloadUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { computeCosting, fieldAffix, fmtCostValue, parseInputNumber, sameNumber } from '../lib/costing.js';
import { plural } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { useQueryState } from './Products.jsx';

function ConstraintsPanel({ fields, draft, setDraft, currency, canApply, onApply }) {
  const constraints = fields.filter((f) => f.kind === 'constraint');
  const changed = constraints.filter((f) => !sameNumber(parseInputNumber(draft[f.key]), f.default_value));
  return (
    <Card title="Costing constraints (all products)" icon={SlidersHorizontal}>
      <div className="stack">
        <p className="small muted">These values are used for every product unless a product has its own value. Change them to preview all prices instantly — nothing is saved until you apply.</p>
        <div className="grid-3" style={{ gap: 10 }}>
          {constraints.map((f) => {
            const { prefix, suffix } = fieldAffix(f, currency);
            const isChanged = changed.includes(f);
            return (
              <label key={f.key} className="field" style={{ gap: 4 }}>
                <span className="label">{f.label}{isChanged && <span className="tiny muted"> (was {fmtCostValue(f, f.default_value, currency)})</span>}</span>
                <span className={`sim-input ${isChanged ? 'changed' : ''}`}>
                  {prefix && <span className="affix">{prefix}</span>}
                  <input inputMode="decimal" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-label={f.label} />
                  {suffix && <span className="affix">{suffix}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {changed.length > 0 && (
          <div className="sim-banner" style={{ position: 'static' }}>
            <FlaskConical size={18} />
            <div className="grow">
              <strong>Preview with changed constraints</strong>
              <div className="small">The table below shows recalculated prices. Saved costing is unchanged.</div>
            </div>
            <Button size="sm" icon={RotateCcw} onClick={() => setDraft(Object.fromEntries(constraints.map((c) => [c.key, String(c.default_value ?? '')])))}>Reset</Button>
            {canApply && <Button size="sm" variant="primary" icon={Save} onClick={() => onApply(Object.fromEntries(changed.map((c) => [c.key, parseInputNumber(draft[c.key])])))}>Apply to all products</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Costing() {
  useTitle('Costing');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [query, update] = useQueryState();
  const page = Number(query.page) || 1;
  const meta = useApi('/products/meta');
  const { data, error, loading, reload } = useApi('/costing', { query: { ...query, page, pageSize: 50 } });
  const [edits, setEdits] = useState({});
  const [draftDefaults, setDraftDefaults] = useState({});
  const [allColumns, setAllColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = can('costing.edit');
  const dirtyCount = Object.keys(edits).length;
  const fields = data?.fields || [];

  useEffect(() => {
    if (data?.fields) setDraftDefaults((d) => (Object.keys(d).length ? d : Object.fromEntries(data.fields.filter((f) => f.kind === 'constraint').map((f) => [f.key, String(f.default_value ?? '')]))));
  }, [data]);

  // Fields with the (possibly changed) constraint defaults applied, for live recalculation.
  const liveFields = useMemo(
    () => fields.map((f) => (f.kind === 'constraint' && draftDefaults[f.key] !== undefined ? { ...f, default_value: parseInputNumber(draftDefaults[f.key]) ?? f.default_value } : f)),
    [fields, draftDefaults],
  );
  const inputFields = fields.filter((f) => f.kind === 'input');
  const resultFields = fields.filter((f) => f.kind === 'formula' && (allColumns || f.highlight));

  const setCell = (pid, key, value, original) => {
    setEdits((cur) => {
      const row = { ...(cur[pid] || {}) };
      if (sameNumber(parseInputNumber(value), original ?? null)) delete row[key];
      else row[key] = value;
      const next = { ...cur };
      if (Object.keys(row).length) next[pid] = row;
      else delete next[pid];
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const rows = Object.entries(edits).map(([product_id, values]) => ({ product_id: Number(product_id), values }));
      const r = await api('/costing/bulk', { method: 'PUT', body: { rows } });
      toast.success(`${plural(r.changed, 'value')} saved`);
      setEdits({});
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const applyDefaults = async (values) => {
    const ok = await confirm({
      title: 'Apply constraints to all products?',
      message: `This changes the saved costing of every product that has no product-specific value: ${Object.keys(values).map((k) => fields.find((f) => f.key === k)?.label).join(', ')}.`,
      confirmLabel: 'Apply to all products',
    });
    if (!ok) return;
    try {
      await api('/costing/constraints', { method: 'PUT', body: { values } });
      toast.success('Constraints updated for all products');
      setDraftDefaults({});
      reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="Costing"
        subtitle={<span className="row"><Lock size={14} /> Protected — only roles with costing access can open this page. Never shown on scan pages without authorisation.</span>}
        actions={
          <>
            {can('settings.manage') && <Link className="btn" to="/settings?tab=costing"><Settings2 /> Costing structure</Link>}
            {can('products.import') && canEdit && <Link className="btn" to="/import"><FileSpreadsheet /> Import costing</Link>}
            <Button icon={Download} onClick={() => downloadUrl('/costing/export.xlsx', { ...query, page: undefined })}>Export Excel</Button>
          </>
        }
      />

      {data && <ConstraintsPanel fields={fields} draft={draftDefaults} setDraft={setDraftDefaults} currency={data.currency} canApply={can('costing.constraints')} onApply={applyDefaults} />}
      {canEdit && <Alert tone="info" icon={Calculator}>Click a cost to edit it. Results recalculate as you type; nothing is saved until you press Save changes.</Alert>}

      <div className="card">
        <ProductFilters query={query} update={update} meta={meta.data} right={<Switch label={<span className="row" style={{ gap: 5 }}><Columns3 size={15} /> All calculation steps</span>} checked={allColumns} onChange={setAllColumns} />} />
        {error ? (
          <ErrorState error={error} retry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data.items.length ? (
          <Empty title="No products match" />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '70vh' }}>
            <table className="table table-compact sheet">
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, zIndex: 2, minWidth: 230 }}>Product</th>
                  {inputFields.map((f) => <th key={f.key} className="num">{f.label}</th>)}
                  {resultFields.map((f) => (
                    <th key={f.key} className="num" title={f.formula}><Calculator size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => {
                  const rowInputs = { ...p.inputs };
                  for (const [k, v] of Object.entries(edits[p.id] || {})) rowInputs[k] = parseInputNumber(v);
                  const live = computeCosting(liveFields, rowInputs, p.context);
                  return (
                    <tr key={p.id}>
                      <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                        <div className="row">
                          <Thumb src={p.thumb_url} size="sm" />
                          <div style={{ minWidth: 0 }}>
                            <Link to={`/products/${p.id}`} className="truncate" style={{ display: 'block', fontWeight: 560, color: 'var(--text)', maxWidth: 190 }}>{p.name}</Link>
                            <span className="tiny muted mono">{p.sku}</span>
                          </div>
                        </div>
                      </td>
                      {inputFields.map((f) =>
                        canEdit ? (
                          <td key={f.key} style={{ padding: '2px 4px' }}>
                            <input
                              inputMode="decimal"
                              className={edits[p.id]?.[f.key] !== undefined ? 'dirty' : ''}
                              value={edits[p.id]?.[f.key] ?? (p.inputs[f.key] ?? '')}
                              onChange={(e) => setCell(p.id, f.key, e.target.value, p.inputs[f.key])}
                              aria-label={`${f.label} for ${p.sku}`}
                              placeholder="—"
                            />
                          </td>
                        ) : (
                          <td key={f.key} className="num nowrap">{fmtCostValue(f, p.inputs[f.key], data.currency)}</td>
                        ),
                      )}
                      {resultFields.map((f) => {
                        const changed = !sameNumber(live[f.key], p.values[f.key]);
                        return (
                          <td key={f.key} className={`num nowrap calc ${changed ? 'sim-new' : ''}`} title={changed ? `Saved: ${fmtCostValue(f, p.values[f.key], data.currency)}` : undefined}>
                            {fmtCostValue(f, live[f.key], data.currency)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && <Pagination page={page} pageSize={50} total={data.total} onPage={(p) => { if (dirtyCount && !window.confirm('Discard unsaved costing changes?')) return; setEdits({}); update({ page: p }); }} />}
      </div>

      {dirtyCount > 0 && (
        <div className="bulkbar">
          <span className="count">Unsaved changes in {plural(dirtyCount, 'product')}</span>
          <Button size="sm" icon={Undo2} onClick={() => setEdits({})}>Discard</Button>
          <Button size="sm" variant="primary" icon={Save} onClick={save} loading={busy}>Save changes</Button>
        </div>
      )}
    </div>
  );
}
