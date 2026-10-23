import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, History, Image as ImageIcon, RotateCcw, Upload,
} from 'lucide-react';
import { Alert, Badge, Button, Card, Check, Dropzone, Field, Loading, PageHeader, Pagination, Select } from '../components/ui.jsx';
import { api, downloadUrl } from '../lib/api.js';
import { fmtDate, plural } from '../lib/format.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

const STRATEGIES = [
  { value: 'update', title: 'Update existing products', desc: 'Overwrite matching products with the values in the sheet. Blank cells keep the current value.' },
  { value: 'skip', title: 'Keep existing data', desc: 'Leave matching products untouched and only add new ones.' },
  { value: 'create_new', title: 'Create as new products', desc: 'Import matching rows as new products with a suffixed ID (e.g. PRD-10025-1).' },
];

function Steps({ step }) {
  const items = ['Upload file', 'Map columns', 'Done'];
  return (
    <div className="steps">
      {items.map((label, i) => (
        <div key={label} className="row" style={{ gap: 8 }}>
          {i > 0 && <span className="step-sep" />}
          <span className={`step ${step === i ? 'on' : step > i ? 'done' : ''}`}>
            <span className="n">{step > i ? '✓' : i + 1}</span>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ImportHistory({ refreshKey }) {
  const [page, setPage] = useState(1);
  const { data } = useApi('/import/history', { query: { page, pageSize: 10 }, deps: [refreshKey] });
  if (!data?.items.length) return null;
  return (
    <Card title="Import history" icon={History} pad={false}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>File</th><th>Date</th><th className="num">Rows</th><th className="num">Created</th><th className="num">Updated</th><th className="num">Skipped</th><th className="num">Failed</th><th className="num">Images</th><th>By</th></tr>
          </thead>
          <tbody>
            {data.items.map((h) => (
              <tr key={h.id}>
                <td><div className="row"><FileSpreadsheet size={16} className="muted" /><span className="truncate" style={{ maxWidth: 240 }}>{h.filename}</span></div></td>
                <td className="nowrap small">{fmtDate(h.created_at, true)}</td>
                <td className="num">{h.total_rows}</td>
                <td className="num">{h.created_count}</td>
                <td className="num">{h.updated_count}</td>
                <td className="num">{h.skipped_count}</td>
                <td className="num">{h.failed_count ? <Badge tone="red">{h.failed_count}</Badge> : 0}</td>
                <td className="num">{h.images_count}</td>
                <td className="small">{h.user_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.total > 10 && <Pagination page={page} pageSize={10} total={data.total} onPage={setPage} />}
    </Card>
  );
}

export default function Import() {
  useTitle('Excel import');
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(null);
  const [mapping, setMapping] = useState({});
  const [options, setOptions] = useState({ duplicateStrategy: 'update', autoSku: true, importImages: true, replaceImages: false, importCosting: true });
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);

  const upload = async ([file]) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      const s = await api('/import/upload', { method: 'POST', form });
      setSession(s);
      setMapping(s.mapping);
      setStep(1);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const changeSheet = async (sheet) => {
    setBusy(true);
    try {
      const s = await api(`/import/${session.token}/preview`, { query: { sheet } });
      setSession({ ...session, ...s });
      setMapping(s.mapping);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const debouncedMapping = useDebounced(mapping, 350);
  useEffect(() => {
    if (!session || step !== 1) return;
    api(`/import/${session.token}/analyse`, { method: 'POST', body: { sheet: session.sheet, mapping: debouncedMapping } })
      .then((a) => setAnalysis({ ...a, error: null }))
      .catch((err) => setAnalysis((a) => ({ ...(a || {}), error: err.message })));
  }, [debouncedMapping, session, step]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const t of session?.targets || []) {
      if (!m.has(t.group)) m.set(t.group, []);
      m.get(t.group).push(t);
    }
    return [...m.entries()];
  }, [session]);
  const used = new Map(Object.entries(mapping).filter(([, t]) => t !== 'ignore' && t !== 'new_field').map(([col, t]) => [t, col]));

  const commit = async () => {
    setBusy(true);
    try {
      const r = await api(`/import/${session.token}/commit`, { method: 'POST', body: { sheet: session.sheet, mapping, ...options } });
      setResult(r);
      setStep(2);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(0);
    setSession(null);
    setResult(null);
    setAnalysis(null);
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="Excel import"
        subtitle="Bulk-create and bulk-update products from a spreadsheet."
        actions={
          <>
            <Button icon={Download} onClick={() => downloadUrl('/products/export.xlsx', { template: 1 })}>Blank template</Button>
            <Button icon={Download} onClick={() => downloadUrl('/products/export.xlsx')}>Export all products</Button>
          </>
        }
      />
      <Card>
        <Steps step={step} />
      </Card>

      {step === 0 && (
        <Card title="Upload your spreadsheet" icon={Upload}>
          <div className="stack">
            {busy ? <Loading /> : <Dropzone accept=".xlsx,.xlsm,.csv" multiple={false} onFiles={upload} title="Choose an Excel file" hint=".xlsx or .csv · up to 50 MB · pictures placed on rows are imported too" />}
            <div className="grid-3 small muted">
              <div><strong className="row" style={{ color: 'var(--text)', marginBottom: 4 }}><FileSpreadsheet size={15} /> Any column layout</strong>The first row with headings is detected and columns are matched to product fields automatically. You can change the mapping before importing.</div>
              <div><strong className="row" style={{ color: 'var(--text)', marginBottom: 4 }}><ImageIcon size={15} /> Pictures in the sheet</strong>Images inserted over a row are attached to that row’s product. Images can also be uploaded later on the Product Images page.</div>
              <div><strong className="row" style={{ color: 'var(--text)', marginBottom: 4 }}><RotateCcw size={15} /> Bulk updates</strong>Export your products, edit the file, and import it again with “Update existing products”.</div>
            </div>
          </div>
        </Card>
      )}

      {step === 1 && session && (
        <>
          <Card
            title={<><FileSpreadsheet size={17} /> {session.filename}</>}
            actions={session.sheets.length > 1 && (
              <Select size="sm" value={session.sheet} onChange={(e) => changeSheet(e.target.value)} style={{ width: 'auto' }} aria-label="Sheet">
                {session.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
            pad={false}
          >
            <div className="card-body row-wrap" style={{ gap: 18, paddingBottom: 12 }}>
              <span><strong>{plural(session.totalRows, 'row')}</strong> <span className="muted">found</span></span>
              <span><strong>{session.headers.length}</strong> <span className="muted">columns</span></span>
              {session.costingWorkbook && <span><strong>{session.costingWorkbook.sheets}</strong> <span className="muted">product costing sheets</span></span>}
              {session.imageCount > 0 && <span><strong>{session.imageCount}</strong> <span className="muted">embedded pictures</span></span>}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Excel column</th><th>Sample values</th><th style={{ width: 300 }}>Import as</th></tr></thead>
                <tbody>
                  {session.headers.map((h) => {
                    const t = mapping[h.col];
                    const dup = t && t !== 'ignore' && t !== 'new_field' && used.get(t) !== String(h.col);
                    return (
                      <tr key={h.col} style={t === 'ignore' ? { opacity: 0.6 } : undefined}>
                        <td style={{ fontWeight: 600 }}>{h.name}</td>
                        <td className="small muted"><div className="truncate" style={{ maxWidth: 380 }}>{h.samples.join(' · ') || '—'}</div></td>
                        <td>
                          <Select size="sm" value={t} onChange={(e) => setMapping({ ...mapping, [h.col]: e.target.value })} aria-label={`Map ${h.name}`} style={dup ? { borderColor: 'var(--danger)' } : undefined}>
                            <option value="ignore">— Skip this column —</option>
                            <option value="new_field">＋ Create new custom field “{h.name}”</option>
                            {groups.map(([g, list]) => (
                              <optgroup key={g} label={g}>
                                {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </optgroup>
                            ))}
                          </Select>
                          {session.notes?.[h.col] && t === session.mapping[h.col] && <div className="tiny muted" style={{ marginTop: 3 }}>{session.notes[h.col]}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="When a Product ID already exists">
            <div className="stack">
              <div className="radio-cards">
                {STRATEGIES.map((s) => (
                  <label key={s.value} className={`radio-card ${options.duplicateStrategy === s.value ? 'on' : ''}`}>
                    <input type="radio" name="strategy" checked={options.duplicateStrategy === s.value} onChange={() => setOptions({ ...options, duplicateStrategy: s.value })} />
                    <span><span className="t">{s.title}</span><span className="d" style={{ display: 'block' }}>{s.desc}</span></span>
                  </label>
                ))}
              </div>
              {session.costingWorkbook && (
                <Alert tone="info" title="Costing workbook detected">
                  This file has a costing sheet for each product{session.costingWorkbook.master ? ` (product list: “${session.costingWorkbook.master}”)` : ''}.
                  Costs (wood, wages, hardware, CBM) and constants (USD rate, wastage, margins…) are read from each sheet, and the app’s calculated price is checked against the sheet’s result.
                  <div style={{ marginTop: 8 }}>
                    {session.costingWorkbook.canImport
                      ? <Check label="Import costing from the product costing sheets" checked={options.importCosting} onChange={(e) => setOptions({ ...options, importCosting: e.target.checked })} />
                      : <span className="small">Your role cannot import costing; only product details will be imported.</span>}
                  </div>
                </Alert>
              )}
              <div className="row-wrap" style={{ gap: 20 }}>
                <Check label="Generate a Product ID when the cell is empty" checked={options.autoSku} onChange={(e) => setOptions({ ...options, autoSku: e.target.checked })} />
                {session.imageCount > 0 && <Check label="Import pictures from the sheet" checked={options.importImages} onChange={(e) => setOptions({ ...options, importImages: e.target.checked })} />}
                {session.imageCount > 0 && options.importImages && options.duplicateStrategy === 'update' && (
                  <Check label="Replace images of updated products" checked={options.replaceImages} onChange={(e) => setOptions({ ...options, replaceImages: e.target.checked })} />
                )}
              </div>
            </div>
          </Card>

          {analysis && (
            analysis.error ? <Alert tone="error">{analysis.error}</Alert> : (
              <Card>
                <div className="stack">
                  <div className="row-wrap" style={{ gap: 22 }}>
                    <span><strong>{analysis.newProducts}</strong> <span className="muted">new products</span></span>
                    <span><strong>{analysis.existing}</strong> <span className="muted">already exist</span></span>
                    {analysis.missingSku > 0 && <span><strong>{analysis.missingSku}</strong> <span className="muted">without Product ID</span></span>}
                    {analysis.duplicatesInFile > 0 && <span><strong>{analysis.duplicatesInFile}</strong> <span className="muted">repeated IDs in file</span></span>}
                    {analysis.newFieldColumns.length > 0 && <span><strong>{analysis.newFieldColumns.length}</strong> <span className="muted">new custom fields</span></span>}
                    {session.costingWorkbook && <span><strong>{analysis.withCostingSheet}</strong> <span className="muted">with a costing sheet</span></span>}
                  </div>
                  {!analysis.hasNameColumn && <Alert tone="error">Map a column to “Product Name” to continue.</Alert>}
                  {!analysis.hasSkuColumn && <Alert tone="warn">No column is mapped to Product ID — every row will be created as a new product{options.autoSku ? ' with a generated ID' : ''}.</Alert>}
                  {analysis.missingSku > 0 && !options.autoSku && <Alert tone="warn">{plural(analysis.missingSku, 'row')} without a Product ID will fail. Turn on automatic IDs to import them.</Alert>}
                </div>
              </Card>
            )
          )}

          <div className="row between">
            <Button icon={ArrowLeft} onClick={reset}>Choose another file</Button>
            <Button variant="primary" size="lg" icon={ArrowRight} onClick={commit} loading={busy} disabled={!analysis || analysis.error || !analysis.hasNameColumn}>
              Import {plural(session.totalRows, 'row')}
            </Button>
          </div>
        </>
      )}

      {step === 2 && result && (
        <Card>
          <div className="stack">
            <div className="row" style={{ gap: 14 }}>
              <div className="stat" style={{ padding: 0 }}><div className="icon tone-green"><CheckCircle2 /></div></div>
              <div>
                <h2>Import finished</h2>
                <p className="muted">{plural(result.totalRows, 'row')} processed. QR codes and barcodes were generated for every new product.</p>
              </div>
            </div>
            <div className="stat-grid">
              {[['Created', result.created, 'green'], ['Updated', result.updated, 'blue'], ['Skipped', result.skipped, 'slate'], ['Failed', result.failed, result.failed ? 'red' : 'slate'], ['Images', result.images, 'wood']].map(([l, v, tone]) => (
                <div key={l} className="card stat"><div className="grow"><div className="label">{l}</div><div className="value" style={{ color: `var(--${tone === 'red' ? 'danger' : 'text'})` }}>{v}</div></div></div>
              ))}
            </div>
            {result.costing && (
              <Alert tone={result.costing.mismatches.length ? 'warn' : 'success'} title={`Costing: ${result.costing.imported} sheets imported · ${result.costing.verified} match the Excel price exactly`}>
                {result.costing.mismatches.map((m) => <div key={m.sku}>{m.sku}: {m.diffs.map((d) => `${d.field} app ${d.app?.toFixed?.(2)} vs sheet ${d.sheet?.toFixed?.(2)}`).join(', ')}</div>)}
                {result.costing.cbmCorrections.map((c) => <div key={c.sku}>{c.sku}: CBM set from its costing sheet ({c.from ?? '—'} → {c.to})</div>)}
                {result.costing.overrides.map((o, i) => <div key={i}>{o.sku}: {o.field} {o.value} differs from the default ({o.default}); saved for this product only</div>)}
                {result.costing.missingSheets.length > 0 && <div>No costing sheet for: {result.costing.missingSheets.join(', ')}</div>}
              </Alert>
            )}
            {result.updatedProducts?.length > 0 && (
              <details className="card card-pad">
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Changes to {result.updatedProducts.length} existing product{result.updatedProducts.length === 1 ? '' : 's'}</summary>
                <div className="stack" style={{ marginTop: 10, gap: 6 }}>
                  {result.updatedProducts.map((u) => (
                    <div key={u.sku} className="small"><strong className="mono">{u.sku}</strong>: {u.changes.map((c) => `${c.label} “${c.from ?? '—'}” → “${c.to ?? '—'}”`).join('; ')}</div>
                  ))}
                  <span className="tiny muted">Previous values are kept in each product’s history.</span>
                </div>
              </details>
            )}
            {result.errors.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table table-compact">
                  <thead><tr><th style={{ width: 90 }}>Row</th><th>Problem</th></tr></thead>
                  <tbody>{result.errors.map((e, i) => <tr key={i}><td>{e.row ?? '—'}</td><td>{e.error}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="row">
              <Button variant="primary" onClick={() => navigate('/products?sort=updated_at:desc')}>View products</Button>
              <Button onClick={reset}>Import another file</Button>
              <Link to="/images" className="btn btn-ghost">Upload more images</Link>
            </div>
          </div>
        </Card>
      )}

      <ImportHistory refreshKey={historyKey} />
    </div>
  );
}
