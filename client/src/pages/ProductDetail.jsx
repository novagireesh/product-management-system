import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Copy, Download, ExternalLink, FolderPlus, History, ImageOff, Images, Info, Pencil, Printer, QrCode, RefreshCw, ShoppingBag, Trash2, Wallet,
} from 'lucide-react';
import AddToCollection from '../components/AddToCollection.jsx';
import CostingPanel from '../components/CostingPanel.jsx';
import HistoryTimeline from '../components/HistoryTimeline.jsx';
import ImageManager from '../components/ImageManager.jsx';
import { Alert, Badge, Button, Card, ErrorState, Loading, PageHeader, StatusBadge, Tabs, useConfirm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { specText } from '../lib/fields.js';
import { fmtDate } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

function Gallery({ images }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [images]);
  const current = images[idx];
  return (
    <div>
      <div className="gallery-main">
        {current ? <img src={current.url} alt="" /> : <div className="stack" style={{ alignItems: 'center' }}><ImageOff size={34} /><span className="small">No images yet</span></div>}
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs">
          {images.map((img, i) => (
            <button key={img.id} type="button" className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} aria-label={`Image ${i + 1}`}>
              <img src={img.thumb_url} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SpecGroups({ product, fields }) {
  const groups = useMemo(() => {
    const out = new Map();
    for (const f of fields) {
      const v = product.specs?.[f.key];
      if (v === undefined || v === null || v === '') continue;
      if (!out.has(f.group_name)) out.set(f.group_name, []);
      out.get(f.group_name).push({ ...f, value: specText(product, f) });
    }
    return [...out.entries()];
  }, [product, fields]);
  if (!groups.length) return <p className="muted">No specifications entered yet.</p>;
  return groups.map(([group, items]) => (
    <div key={group}>
      <div className="spec-group-title">{group}</div>
      <dl className="spec-list">
        {items.map((f) => (
          <div key={f.key} style={{ display: 'contents' }}>
            <dt>
              {f.label}
              {f.calc && <span title="Calculated automatically (Settings › Calculation rules)" className="tiny muted"> · calculated</span>}
              {!f.is_public && <span title="Not shown on the public scan page" className="tiny muted"> · internal</span>}
            </dt>
            <dd style={{ whiteSpace: 'pre-line' }}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  ));
}

function CodesPanel({ product, onRegenerated, canManage }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState(0);
  const base = `/api/codes/${product.id}`;
  const stale = product.code && product.code.code !== product.sku;
  const regenerate = async () => {
    const ok = await confirm({ title: 'Regenerate QR code & barcode?', message: 'Labels already printed with the old code will stop working. Print new labels afterwards.', confirmLabel: 'Regenerate' });
    if (!ok) return;
    try {
      await api(`/products/${product.id}/code/regenerate`, { method: 'POST' });
      setV((x) => x + 1);
      onRegenerated();
      toast.success('Codes regenerated');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="stack">
      {stale && (
        <Alert tone="warn" title="Code differs from the current Product ID">
          Printed labels still encode <span className="mono">{product.code.code}</span> and keep working. Regenerate if you want the code to match <span className="mono">{product.sku}</span>.
        </Alert>
      )}
      <div className="grid-2">
        <div className="stack">
          <div className="code-box"><img src={`${base}/qr.svg?v=${v}`} alt="QR code" style={{ width: 180, height: 180 }} /></div>
          <div className="small muted" style={{ textAlign: 'center' }}>
            QR opens <a href={product.code?.url} target="_blank" rel="noreferrer" className="mono" style={{ overflowWrap: 'anywhere' }}>{product.code?.url}</a>
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <a className="btn btn-sm" href={`${base}/qr.png?size=1200&download=1`}><Download /> PNG</a>
            <a className="btn btn-sm" href={`${base}/qr.svg?download=1`}><Download /> SVG</a>
          </div>
        </div>
        <div className="stack">
          <div className="code-box" style={{ minHeight: 210 }}><img src={`${base}/barcode.svg?v=${v}`} alt="Barcode" style={{ maxWidth: '100%', height: 110 }} /></div>
          <div className="small muted" style={{ textAlign: 'center' }}>{product.code?.barcode_type === 'code39' ? 'Code 39' : 'Code 128'} · encodes <span className="mono">{product.code?.code}</span></div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <a className="btn btn-sm" href={`${base}/barcode.png?download=1`}><Download /> PNG</a>
            <a className="btn btn-sm" href={`${base}/barcode.svg?download=1`}><Download /> SVG</a>
          </div>
        </div>
      </div>
      {canManage && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button icon={RefreshCw} onClick={regenerate}>Regenerate</Button>
          <Link className="btn btn-primary" to={`/print/labels?ids=${product.id}`} target="_blank"><Printer /> Print label</Link>
        </div>
      )}
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const { can, branding } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data: product, error, loading, reload, setData } = useApi(`/products/${id}`);
  const meta = useApi('/products/meta');
  const [tab, setTab] = useState('details');
  const [historyKey, setHistoryKey] = useState(0);
  const history = useApi(tab === 'history' ? `/products/${id}/history` : null, { deps: [historyKey], skip: tab !== 'history' });
  const [collOpen, setCollOpen] = useState(false);
  useTitle(product?.name);

  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !product) return <Loading />;
  if (!product) return null;
  const fields = meta.data?.fields || [];

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${product.sku}?`, message: 'The product, its images, codes and costing will be permanently removed.', danger: true, confirmLabel: 'Delete product' });
    if (!ok) return;
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      toast.success('Product deleted');
      navigate('/products');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={<><Link to="/products">Products</Link><span>/</span><span className="mono">{product.sku}</span></>}
        title={product.name}
        subtitle={
          <span className="row-wrap" style={{ marginTop: 6 }}>
            <StatusBadge status={product.status} />
            {product.category && <Badge>{product.category}{product.subcategory ? ` › ${product.subcategory}` : ''}</Badge>}
            <span className="small muted">Updated {fmtDate(product.updated_at, true)}{product.updated_by_name ? ` by ${product.updated_by_name}` : ''}</span>
          </span>
        }
        actions={
          <>
            <a className="btn" href={product.code?.url} target="_blank" rel="noreferrer"><ExternalLink /> Scan page</a>
            {can('buyers.manage') && <Button icon={FolderPlus} onClick={() => setCollOpen(true)}>Add to collection</Button>}
            {can('products.create') && (
              <Button icon={Copy} onClick={() => navigate(`/products/new?copy=${product.id}`)} title="Duplicate">Duplicate</Button>
            )}
            {can('products.edit') && <Button variant="primary" icon={Pencil} onClick={() => navigate(`/products/${product.id}/edit`)}>Edit</Button>}
            {can('products.delete') && <Button icon={Trash2} onClick={remove} aria-label="Delete product" />}
          </>
        }
      />

      <div className="detail-grid">
        <Gallery images={product.images} />
        <Card>
          <div className="row between" style={{ marginBottom: 14 }}>
            <div>
              <div className="tiny muted">Product ID / SKU</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 650 }}>{product.sku}</div>
            </div>
            <img src={`/api/codes/${product.id}/qr.svg`} alt="QR code" style={{ width: 72, height: 72 }} />
          </div>
          {product.description && <p style={{ whiteSpace: 'pre-line', marginBottom: 16, color: 'var(--text-2)' }}>{product.description}</p>}
          <SpecGroups product={product} fields={fields} />
        </Card>
      </div>

      <section className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'details', label: 'All details', icon: Info },
            { value: 'images', label: 'Images', icon: Images, count: product.images.length },
            { value: 'codes', label: 'QR & barcode', icon: QrCode },
            can('costing.view') && { value: 'costing', label: 'Costing', icon: Wallet },
            { value: 'collections', label: 'Collections', icon: ShoppingBag, count: product.collections.length },
            { value: 'history', label: 'History', icon: History },
          ]}
        />
        <div className="card-body">
          {tab === 'details' && (
            <dl className="spec-list">
              {[
                ['Product ID / SKU', product.sku],
                ['Name', product.name],
                ['Category', product.category],
                ['Sub category', product.subcategory],
                ['Status', product.status],
                ...fields.map((f) => [f.label, specText(product, f)]),
                ['Created', `${fmtDate(product.created_at, true)}${product.created_by_name ? ` by ${product.created_by_name}` : ''}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{v || <span className="muted">—</span>}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === 'images' && (
            <ImageManager productId={product.id} images={product.images} canEdit={can('images.manage')} onChange={(images) => setData((p) => ({ ...p, images }))} />
          )}
          {tab === 'codes' && <CodesPanel product={product} onRegenerated={reload} canManage={can('codes.manage')} />}
          {tab === 'costing' && <CostingPanel productId={product.id} currency={branding?.currency} canEdit={can('costing.edit')} onSaved={() => setHistoryKey((k) => k + 1)} />}
          {tab === 'collections' && (
            product.collections.length ? (
              <div className="list" style={{ margin: '-18px -20px' }}>
                {product.collections.map((c) => (
                  <Link key={c.id} to={`/collections/${c.id}`} className="list-item">
                    <ShoppingBag size={16} className="muted" />
                    <span className="grow">{c.name}</span>
                    {c.buyer_name && <Badge>{c.buyer_name}</Badge>}
                  </Link>
                ))}
              </div>
            ) : <p className="muted">This product is not in any buyer collection yet.</p>
          )}
          {tab === 'history' && (history.loading && !history.data ? <Loading /> : <HistoryTimeline items={history.data} />)}
        </div>
      </section>

      <AddToCollection open={collOpen} onClose={() => setCollOpen(false)} productIds={[product.id]} />
    </div>
  );
}
