import { ArrowLeft, BookOpen, FileSpreadsheet, FileText, Info, PencilLine, Percent } from 'lucide-react';
import { PERCENT_LIMITS, PRICE_ROUNDING, percentLabel, percentPrice } from '../../../shared/pricing.js';
import { parseInputNumber } from '../lib/costing.js';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Thumb } from './ui.jsx';

const fmt = (v, decimals) => (v === null || v === undefined ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));

/** Reference price of a product for the chosen source (with fallback), as used by the server. */
export function referencePrice(values, price) {
  const v = values?.[price.source] ?? (price.fallback ? values?.[price.fallback] : null);
  return v === null || v === undefined ? null : v;
}

/**
 * Preview of “Percentage increase” prices: every selected product with its own reference price,
 * the increase and the final catalogue price — recalculated as the percentage or rounding changes.
 * Nothing is saved to the products; the server applies the same calculation when generating.
 */
export default function PercentPriceSheet({ products, price, setPrice, references, referenceFields, onUseAsManual, onBack, onGenerate, busy }) {
  const pct = parseInputNumber(price.percent);
  const validPct = pct !== null && pct >= PERCENT_LIMITS.min && pct <= PERCENT_LIMITS.max;
  const decimals = price.rounding === 'whole' ? 0 : 2;
  const source = referenceFields.find((f) => f.key === price.source);
  const fallback = referenceFields.find((f) => f.key === price.fallback);
  const currency = source?.currency || '';
  const rows = products.map((p) => {
    const ref = referencePrice(references[p.id], price);
    const usedFallback = references[p.id]?.[price.source] == null && ref !== null;
    return { p, ref, usedFallback, final: validPct ? percentPrice(ref, pct, price.rounding) : null };
  });
  const priced = rows.filter((r) => r.final !== null).length;
  const total = rows.reduce((a, r) => a + (r.final ?? 0), 0);

  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={<button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: -10 }}><ArrowLeft /> Back to catalogue settings</button>}
        title="Catalogue prices: percentage increase"
        subtitle={`${priced} of ${products.length} products priced${priced ? ` · total ${currency} ${fmt(total, decimals)}` : ''}`}
      />
      <Alert icon={Info}>
        Final price = reference price × (1 + {validPct ? pct : '…'} ÷ 100), worked out from each product’s <strong>own reference price</strong>.
        These prices are used <strong>only for this catalogue</strong> — reference prices and product costing are not changed.
      </Alert>

      <Card pad={false}>
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Field label="Increase by">
            <div className="input-group" style={{ width: 130 }}>
              <Input inputMode="decimal" value={price.percent ?? ''} onChange={(e) => setPrice({ ...price, percent: e.target.value })} aria-label="Percentage increase" autoFocus />
              <span className="addon"><Percent size={14} /></span>
            </div>
          </Field>
          <Field label="Rounding">
            <Select value={price.rounding} onChange={(e) => setPrice({ ...price, rounding: e.target.value })} options={PRICE_ROUNDING} />
          </Field>
          <Field label="Reference price">
            <Select value={price.source} onChange={(e) => setPrice({ ...price, source: e.target.value })} options={referenceFields.map((f) => ({ value: f.key, label: f.label }))} />
          </Field>
          <Field label="If empty, use">
            <Select value={price.fallback || ''} onChange={(e) => setPrice({ ...price, fallback: e.target.value })} placeholder="Nothing (no price)">
              {referenceFields.filter((f) => f.key !== price.source).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          </Field>
        </div>
        {!validPct && <div style={{ padding: '0 16px 12px' }}><Alert tone="error">Enter a percentage between {PERCENT_LIMITS.min} and {PERCENT_LIMITS.max} (e.g. 5 for +5%).</Alert></div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Product</th>
                <th className="num">Reference price ({currency})</th>
                <th className="num">Increase</th>
                <th className="num" style={{ width: 170 }}>Final catalogue price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, ref, usedFallback, final }, i) => (
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
                  <td className="num">
                    {fmt(ref, 2)}
                    {usedFallback && <div className="tiny muted">from {fallback?.label}</div>}
                  </td>
                  <td className="num muted">{validPct && ref !== null ? percentLabel(pct) : '—'}</td>
                  <td className="num" style={{ fontWeight: 700, fontSize: 15 }}>{final === null ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>No price</span> : `${currency} ${fmt(final, decimals)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row-wrap">
          <Button icon={PencilLine} onClick={onUseAsManual} disabled={!validPct || !priced} title="Copy these prices into Manual price to change individual products">Adjust individual prices…</Button>
          {priced < products.length && <Badge tone="amber">{products.length - priced} without reference price</Badge>}
        </div>
        <div className="row-wrap">
          <Button icon={FileSpreadsheet} onClick={() => onGenerate(['xlsx'])} loading={busy === 'xlsx'} disabled={Boolean(busy) || !validPct}>Generate Excel</Button>
          <Button icon={FileText} onClick={() => onGenerate(['pdf'])} loading={busy === 'pdf'} disabled={Boolean(busy) || !validPct}>Generate PDF</Button>
          <Button variant="primary" icon={BookOpen} onClick={() => onGenerate(null)} loading={busy === 'all'} disabled={Boolean(busy) || !validPct}>Generate Catalogue</Button>
        </div>
      </div>
    </div>
  );
}
