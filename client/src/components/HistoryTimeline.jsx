import { Link } from 'react-router-dom';
import {
  BookOpen, Eye, FilePlus2, FileSpreadsheet, ImagePlus, ImageMinus, Pencil, QrCode, Settings, ShoppingBag, Trash2, User, Wallet,
} from 'lucide-react';
import { fmtDate } from '../lib/format.js';

const ICONS = {
  created: [FilePlus2, 'tone-green'],
  updated: [Pencil, 'tone-blue'],
  deleted: [Trash2, 'tone-red'],
  image_added: [ImagePlus, 'tone-wood'],
  image_deleted: [ImageMinus, 'tone-red'],
  image_replaced: [ImagePlus, 'tone-wood'],
  image_primary: [ImagePlus, 'tone-wood'],
  costing_updated: [Wallet, 'tone-amber'],
  costing_viewed: [Eye, 'tone-slate'],
  code_generated: [QrCode, 'tone-slate'],
  code_regenerated: [QrCode, 'tone-violet'],
  excel_import: [FileSpreadsheet, 'tone-green'],
  catalogue_generated: [BookOpen, 'tone-blue'],
  included_in_catalogue: [BookOpen, 'tone-blue'],
};
const ENTITY = { user: User, role: User, settings: Settings, buyer: ShoppingBag, collection: ShoppingBag, code: QrCode, catalogue: BookOpen, import: FileSpreadsheet };

export default function HistoryTimeline({ items, showProduct = false }) {
  if (!items?.length) return <p className="muted">No history yet.</p>;
  return (
    <div className="timeline">
      {items.map((h) => {
        const [Icon, tone] = ICONS[h.action] || [ENTITY[h.entity] || Pencil, 'tone-slate'];
        return (
          <div className="tl-item" key={h.id}>
            <div className={`tl-icon ${tone}`}><Icon /></div>
            <div className="grow">
              <div>
                <span style={{ fontWeight: 560 }}>{h.summary}</span>
                {showProduct && h.product_id && h.sku && (
                  <> · <Link to={`/products/${h.product_id}`} className="mono">{h.sku}</Link></>
                )}
              </div>
              <div className="tiny muted">{h.user_name || 'System'} · {fmtDate(h.created_at, true)}</div>
              {h.changes?.length > 0 && (
                <div className="tl-changes">
                  {h.changes.slice(0, 12).map((c, i) => (
                    <div key={i}>
                      <span className="muted">{c.label}: </span>
                      {c.from !== null && <span className="from">{c.from}</span>}
                      {c.from !== null && c.to !== null && ' → '}
                      {c.to !== null ? <span className="to">{c.to}</span> : <span className="muted">(cleared)</span>}
                    </div>
                  ))}
                  {h.changes.length > 12 && <div className="muted">+ {h.changes.length - 12} more</div>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
