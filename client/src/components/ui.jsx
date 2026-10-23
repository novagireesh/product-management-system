import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ImageOff, Info, UploadCloud, X } from 'lucide-react';
import { fmtNum } from '../lib/format.js';

export function Button({ variant, size, icon: Icon, loading, children, className = '', block, ...props }) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, !children && Icon && 'btn-icon', block && 'btn-block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} disabled={loading || props.disabled} {...props}>
      {loading ? <span className="spinner" /> : Icon ? <Icon /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '', htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export const Input = ({ className = '', size, ...p }) => <input className={`input ${size === 'sm' ? 'input-sm' : ''} ${className}`} {...p} />;
export const Textarea = ({ className = '', ...p }) => <textarea className={`textarea ${className}`} {...p} />;
export function Select({ className = '', size, options, placeholder, children, ...p }) {
  return (
    <select className={`select ${size === 'sm' ? 'select-sm' : ''} ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>))}
      {children}
    </select>
  );
}

export function Check({ label, className = '', ...p }) {
  return (
    <label className={`check ${className}`}>
      <input type="checkbox" {...p} />
      {label}
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title || o.label} aria-pressed={value === o.value}>
          {o.icon && <o.icon />}
          {o.label && <span className={o.icon ? 'hide-sm' : ''}>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone, children, dot, icon: Icon }) {
  return (
    <span className={`badge ${tone ? `badge-${tone}` : ''}`}>
      {dot && <span className="dot" />}
      {Icon && <Icon />}
      {children}
    </span>
  );
}

export const STATUS_TONE = { active: 'green', inactive: 'red', draft: 'amber' };
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status]} dot>{status}</Badge>;

export function Card({ title, icon: Icon, actions, children, footer, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{Icon && <Icon size={17} className="muted" />}{title}</h3>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }) {
  return (
    <div className="page-head">
      <div className="grow">
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Spinner({ large }) {
  return <span className={`spinner ${large ? 'spinner-lg' : ''}`} role="status" aria-label="Loading" />;
}

export const Loading = () => (
  <div className="loading-block">
    <Spinner large />
  </div>
);

export function Empty({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="empty">
      <div className="icon"><Icon /></div>
      {title && <h3>{title}</h3>}
      {children && <div style={{ maxWidth: 420 }}>{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', icon: Icon, children, title }) {
  const I = Icon || (tone === 'warn' || tone === 'error' ? AlertTriangle : Info);
  return (
    <div className={`alert alert-${tone}`}>
      <I />
      <div className="grow">
        {title && <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function ErrorState({ error, retry }) {
  return (
    <Empty icon={AlertTriangle} title="Could not load this page" action={retry && <Button onClick={retry}>Try again</Button>}>
      {error?.message}
    </Empty>
  );
}

export function Modal({ open, onClose, title, children, footer, size }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size ? `modal-${size}` : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Promise-based confirm dialog: const confirm = useConfirm(); if (await confirm({...})) ...
const ConfirmContext = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={state?.title || 'Are you sure?'}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {state?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="muted">{state?.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmContext);

export function Tabs({ value, onChange, tabs }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter(Boolean).map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon />}
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, sizes = [24, 48, 96] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span className="muted small">
        {fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}
      </span>
      <div className="row">
        {onPageSize && (
          <Select size="sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} style={{ width: 'auto' }} aria-label="Rows per page">
            {sizes.map((s) => <option key={s} value={s}>{s} / page</option>)}
          </Select>
        )}
        <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <span className="small nowrap">Page {page} of {pages}</span>
        <Button size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </div>
  );
}

export function Dropzone({ onFiles, accept, multiple = true, title, hint, disabled }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled && e.dataTransfer.files?.length) onFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="icon"><UploadCloud size={20} /></div>
      <div><strong>{title || 'Click to upload'}</strong> or drag and drop</div>
      {hint && <div className="small">{hint}</div>}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Thumb({ src, size, alt = '' }) {
  const [failed, setFailed] = useState(false);
  const cls = `thumb ${size ? `thumb-${size}` : ''}`;
  if (!src || failed) return <div className={cls}><ImageOff /></div>;
  return <img className={cls} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

export function StatCard({ icon: Icon, label, value, hint, tone = 'blue' }) {
  return (
    <div className="card stat">
      <div className={`icon tone-${tone}`}><Icon /></div>
      <div className="grow">
        <div className="label">{label}</div>
        <div className="value">{typeof value === 'string' ? value : value === null || value === undefined ? '—' : fmtNum(value)}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}

/** Small click-outside dropdown menu. */
export function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
