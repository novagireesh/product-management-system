import { Link } from 'react-router-dom';
import { Check as CheckIcon, ImageOff, Wallet } from 'lucide-react';
import { specText } from '../lib/fields.js';
import { timeAgo } from '../lib/format.js';
import { Badge, StatusBadge, Thumb } from './ui.jsx';

/** Table of products with optional row selection. */
export function ProductTable({ items, selected, onToggle, onToggleAll, columns = ['material', 'finish', 'dimensions', 'cbm', 'loadability'], fields = [], link = true, extra }) {
  const allOn = items.length > 0 && items.every((p) => selected?.has(p.id));
  const field = (k) => fields.find((f) => f.key === k);
  const label = (k) => field(k)?.label || k;
  const cell = (p, k) => (field(k) ? specText(p, field(k)) : p.specs?.[k]);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {onToggle && (
              <th className="chk">
                <input type="checkbox" checked={allOn} onChange={() => onToggleAll(!allOn)} aria-label="Select all on this page" />
              </th>
            )}
            <th>Product</th>
            <th className="hide-sm">Category</th>
            {columns.map((c) => <th key={c} className="hide-sm">{label(c)}</th>)}
            <th className="hide-sm">Status</th>
            <th className="hide-sm">Updated</th>
            {extra && <th />}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className={selected?.has(p.id) ? 'selected' : ''}>
              {onToggle && (
                <td className="chk">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle(p.id)} aria-label={`Select ${p.name}`} />
                </td>
              )}
              <td>
                <div className="row" style={{ gap: 12 }}>
                  <Thumb src={p.thumb_url} />
                  <div style={{ minWidth: 0 }}>
                    {link ? <Link to={`/products/${p.id}`} style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</Link> : <span style={{ fontWeight: 600 }}>{p.name}</span>}
                    <div className="row tiny muted" style={{ gap: 6 }}>
                      <span className="mono">{p.sku}</span>
                      {p.image_count === 0 && <span title="No images"><ImageOff size={12} /></span>}
                      {p.has_costing && <span title="Has costing"><Wallet size={12} /></span>}
                    </div>
                  </div>
                </div>
              </td>
              <td className="hide-sm">
                <div>{p.category || <span className="muted">—</span>}</div>
                {p.subcategory && <div className="tiny muted">{p.subcategory}</div>}
              </td>
              {columns.map((c) => <td key={c} className="hide-sm">{cell(p, c) || <span className="muted">—</span>}</td>)}
              <td className="hide-sm"><StatusBadge status={p.status} /></td>
              <td className="hide-sm small muted nowrap">{timeAgo(p.updated_at)}</td>
              {extra && <td className="actions">{extra(p)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductCards({ items, selected, onToggle }) {
  return (
    <div className={`product-grid ${selected?.size ? 'selecting' : ''}`} style={{ padding: 14 }}>
      {items.map((p) => {
        const on = selected?.has(p.id);
        return (
          <div key={p.id} className={`pcard ${on ? 'selected' : ''}`}>
            {onToggle && (
              <button type="button" className="select-box" onClick={() => onToggle(p.id)} aria-label={on ? 'Deselect' : 'Select'} aria-pressed={on}>
                {on && <CheckIcon />}
              </button>
            )}
            <Link to={`/products/${p.id}`} className="media">
              {p.thumb_url ? <img src={p.thumb_url} alt="" loading="lazy" /> : <ImageOff />}
            </Link>
            <div className="body">
              <span className="sku">{p.sku}</span>
              <Link to={`/products/${p.id}`} className="name">{p.name}</Link>
              <span className="meta">{[p.category, p.subcategory].filter(Boolean).join(' › ') || 'Uncategorised'}</span>
              <div className="tags">
                {p.specs?.material && <Badge tone="wood">{p.specs.material}</Badge>}
                {p.specs?.finish && <Badge>{p.specs.finish}</Badge>}
                {p.status !== 'active' && <StatusBadge status={p.status} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
