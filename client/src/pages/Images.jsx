import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, HardDrive, ImageOff, ImagePlus, Images as ImagesIcon, Upload, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, Dropzone, Empty, PageHeader, Pagination, StatCard, Thumb } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtBytes, plural } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

function QuickUpload({ product, onDone }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" icon={ImagePlus} loading={busy} onClick={() => input.current?.click()}>Upload</Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          if (!files.length) return;
          const fd = new FormData();
          files.forEach((f) => fd.append('images', f));
          setBusy(true);
          try {
            const r = await api(`/products/${product.id}/images`, { method: 'POST', form: fd });
            toast.success(`${r.added} image${r.added === 1 ? '' : 's'} added to ${product.sku}`);
            onDone();
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export default function Images() {
  useTitle('Product images');
  const toast = useToast();
  const stats = useApi('/images/stats');
  const [page, setPage] = useState(1);
  const missing = useApi('/products', { query: { images: 'without', page, pageSize: 12, sort: 'sku:asc' } });
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const choose = async (files) => {
    const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif|tiff?)$/i.test(f.name));
    if (!imgs.length) return toast.error('No image files were selected');
    try {
      const matches = await api('/images/match', { method: 'POST', body: { names: imgs.map((f) => f.name) } });
      setPending(imgs.map((f, i) => ({ file: f, product: matches[i].product })));
      setResult(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const uploadAll = async () => {
    const matched = pending.filter((p) => p.product);
    setBusy(true);
    try {
      let added = 0;
      const errors = [];
      const duplicates = [];
      // Upload in batches so very large selections stay within request limits.
      for (let i = 0; i < matched.length; i += 40) {
        const fd = new FormData();
        matched.slice(i, i + 40).forEach((p) => fd.append('images', p.file));
        const r = await api('/images/bulk', { method: 'POST', form: fd });
        added += r.added;
        errors.push(...r.errors);
        duplicates.push(...(r.duplicates || []));
      }
      setResult({ added, errors, duplicates, products: new Set(matched.map((p) => p.product.id)).size });
      setPending(null);
      stats.reload();
      missing.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const matchedCount = pending?.filter((p) => p.product).length || 0;

  return (
    <div className="stack-lg">
      <PageHeader title="Product images" subtitle="Upload images in bulk and see which products still need pictures." />
      {stats.data && (
        <div className="stat-grid">
          <StatCard icon={ImagesIcon} label="Images stored" value={stats.data.total} tone="wood" />
          <StatCard icon={CheckCircle2} label="Products with images" value={stats.data.withImages} tone="green" />
          <StatCard icon={ImageOff} label="Products without images" value={stats.data.withoutImages} tone={stats.data.withoutImages ? 'amber' : 'slate'} />
          <StatCard icon={HardDrive} label="Storage used" value={fmtBytes(stats.data.bytes)} hint="optimised JPEG + thumbnails" tone="slate" />
        </div>
      )}

      <Card title="Bulk upload by file name" icon={Upload}>
        <div className="stack">
          <p className="muted">
            Name each file after its Product ID — e.g. <span className="mono">PRD-10025.jpg</span>, <span className="mono">PRD-10025_2.jpg</span>, <span className="mono">PRD-10025 (3).png</span>.
            Images are matched to products, optimised and added to their gallery. The first image of a product without pictures becomes its primary image.
          </p>
          {!pending && <Dropzone accept="image/*" onFiles={choose} title="Choose images" hint="Select many files at once, or drop a whole folder’s contents here" />}
          {pending && (
            <>
              <Alert tone={matchedCount === pending.length ? 'success' : 'warn'}>
                {matchedCount} of {plural(pending.length, 'file')} matched a product.
                {matchedCount < pending.length && ' Unmatched files will be skipped — rename them to the Product ID and try again.'}
              </Alert>
              <div className="card" style={{ maxHeight: 360, overflow: 'auto' }}>
                <table className="table table-compact">
                  <thead><tr><th>File</th><th>Product</th></tr></thead>
                  <tbody>
                    {pending.map((p, i) => (
                      <tr key={i}>
                        <td className="mono">{p.file.name} <span className="muted tiny">{fmtBytes(p.file.size)}</span></td>
                        <td>
                          {p.product ? (
                            <span className="row"><CheckCircle2 size={15} color="var(--success)" /> <span className="mono">{p.product.sku}</span> <span className="muted truncate">{p.product.name}</span></span>
                          ) : (
                            <span className="row muted"><XCircle size={15} color="var(--danger)" /> No product with this ID</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button onClick={() => setPending(null)}>Cancel</Button>
                <Button variant="primary" icon={Upload} onClick={uploadAll} loading={busy} disabled={!matchedCount}>Upload {plural(matchedCount, 'image')}</Button>
              </div>
            </>
          )}
          {result && (
            <Alert tone={result.errors.length ? 'warn' : 'success'} title={`${plural(result.added, 'image')} added to ${plural(result.products, 'product')}`}>
              {result.duplicates.length > 0 && <div>{result.duplicates.length} identical picture{result.duplicates.length === 1 ? ' was' : 's were'} already attached and skipped: {result.duplicates.join(', ')}</div>}
              {result.errors.map((e, i) => <div key={i}>{e.file}: {e.error}</div>)}
            </Alert>
          )}
        </div>
      </Card>

      <Card title="Products without images" icon={ImageOff} pad={false} actions={stats.data?.withoutImages > 0 && <Badge tone="amber">{stats.data.withoutImages}</Badge>}>
        {missing.data?.items.length ? (
          <>
            <div className="list">
              {missing.data.items.map((p) => (
                <div key={p.id} className="list-item">
                  <Thumb />
                  <div className="grow">
                    <Link to={`/products/${p.id}`} style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</Link>
                    <div className="tiny muted mono">{p.sku}</div>
                  </div>
                  <QuickUpload product={p} onDone={() => { missing.reload(); stats.reload(); }} />
                </div>
              ))}
            </div>
            <Pagination page={page} pageSize={12} total={missing.data.total} onPage={setPage} />
          </>
        ) : (
          <Empty icon={CheckCircle2} title="Every product has at least one image" />
        )}
      </Card>
    </div>
  );
}
