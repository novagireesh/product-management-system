import { useMemo } from 'react';
import { ArrowLeft, BookOpen, Copy, Eraser, FileSpreadsheet, FileText, Info, Save } from 'lucide-react';
import { currencySymbol, fmtCostValue, parseInputNumber } from '../lib/costing.js';
import { specText } from '../lib/fields.js';
import { Alert, Badge, Button, Card, PageHeader, Select, Thumb } from './ui.jsx';

/**
 * Full page for entering the negotiated price of each product in a catalogue.
 * Prices typed here are used only for this catalogue.
 */
export default function ManualPriceSheet({
  products, prices, setPrices, price, setPrice, references, referenceFields, fieldDefs = [], canSave, onSaveToProducts, onBack, onGenerate, busy,
}) {
  const dimsField = fieldDefs.find((f) => f.key === 'dimensions');
  const loadField = fieldDefs.find((f) => f.key === 'loadability');
  const filled = products.filter((p) => parseInputNumber(prices[p.id]) !== null).length;
  const refField = referenceFields.find((f) => f.key === price.reference) || referenceFields[0];
  const total = useMemo(() => products.reduce((a, p) => a + (parseInputNumber(prices[p.id]) ?? 0), 0), [products, prices]);
  const sym = currencySymbol(price.currency).trim();

  const fillFromReference = () => {
    if (!refField) return;
    const next = { ...prices };
    for (const p of products) {
      const v = references[p.id]?.[refField.key];
      if (parseInputNumber(next[p.id]) === null && v !== null && v !== undefined) next[p.id] = String(Math.round(v * 100) / 100);
    }
    setPrices(next);
  };

  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={<button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: -10 }}><ArrowLeft /> Back to catalogue settings</button>}
        title="Enter prices for this catalogue"
        subtitle={`${filled} of ${products.length} products priced${filled ? ` · total ${sym} ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}`}
      />
      <Alert icon={Info}>
        These prices are used <strong>only for this catalogue</strong>. Product costing and master prices are not changed
        {canSave ? ' unless you choose “Save as As Discussed Rate”.' : '.'} Products left empty are shown without a price.
      </Alert>

      <Card pad={false}>
        <div className="toolbar">
          <span className="label">Currency</span>
          <Select size="sm" value={price.currency} onChange={(e) => setPrice({ ...price, currency: e.target.value })} style={{ width: 'auto' }} aria-label="Currency">
            {['USD', 'EUR', 'GBP', 'INR', 'AED', 'AUD', 'CAD'].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="grow" />
          {referenceFields.length > 0 && (
            <>
              <Select size="sm" value={refField?.key || ''} onChange={(e) => setPrice({ ...price, reference: e.target.value })} style={{ width: 'auto' }} aria-label="Reference price">
                {referenceFields.map((f) => <option key={f.key} value={f.key}>Reference: {f.label}</option>)}
              </Select>
              <Button size="sm" icon={Copy} onClick={fillFromReference}>Fill empty from reference</Button>
            </>
          )}
          <Button size="sm" variant="ghost" icon={Eraser} onClick={() => setPrices({})}>Clear all</Button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Product</th>
                <th style={{ width: 170 }}>Catalogue price ({price.currency})</th>
                {refField && <th className="num hide-sm">{refField.label}</th>}
                <th className="hide-sm">{dimsField?.label || 'Dimensions'}</th>
                <th className="hide-sm num">CBM</th>
                {loadField && <th className="hide-sm num">{loadField.label}</th>}
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const ref = refField ? references[p.id]?.[refField.key] : null;
                const value = prices[p.id] ?? '';
                const n = parseInputNumber(value);
                const invalid = String(value).trim() !== '' && (n === null || n < 0);
                return (
                  <tr key={p.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <div className="row"><Thumb src={p.thumb_url} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, maxWidth: 300 }} className="truncate" title={p.name}>{p.name}</div>
                          <div className="tiny muted"><span className="mono">{p.sku}</span>{p.category ? ` · ${p.category}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className={`sim-input ${n !== null ? 'changed' : ''}`} style={invalid ? { borderColor: 'var(--danger)' } : undefined}>
                        <span className="affix">{sym}</span>
                        <input inputMode="decimal" value={value} placeholder="Enter price" onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} aria-label={`Price for ${p.sku}`} />
                      </div>
                    </td>
                    {refField && <td className="num hide-sm small muted">{fmtCostValue(refField, ref)}</td>}
                    <td className="hide-sm small">{(dimsField ? specText(p, dimsField) : p.specs?.dimensions) || '—'}</td>
                    <td className="hide-sm num small">{p.specs?.cbm ? Number(p.specs.cbm).toFixed(3) : '—'}</td>
                    {loadField && <td className="hide-sm num small">{p.specs?.loadability ?? '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <div>
          {canSave && (
            <Button icon={Save} onClick={onSaveToProducts} disabled={!filled}>Save as As Discussed Rate…</Button>
          )}
          {filled < products.length && <Badge tone="amber">{products.length - filled} without price</Badge>}
        </div>
        <div className="row-wrap">
          <Button icon={FileSpreadsheet} onClick={() => onGenerate(['xlsx'])} loading={busy === 'xlsx'} disabled={Boolean(busy)}>Generate Excel</Button>
          <Button icon={FileText} onClick={() => onGenerate(['pdf'])} loading={busy === 'pdf'} disabled={Boolean(busy)}>Generate PDF</Button>
          <Button variant="primary" icon={BookOpen} onClick={() => onGenerate(null)} loading={busy === 'all'} disabled={Boolean(busy)}>Generate Catalogue</Button>
        </div>
      </div>
    </div>
  );
}
