import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtBytes } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Button, Dropzone, useConfirm } from './ui.jsx';

export default function ImageManager({ productId, images, onChange, canEdit }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const replaceInput = useRef(null);
  const replacing = useRef(null);

  const upload = async (files) => {
    const form = new FormData();
    for (const f of files) form.append('images', f);
    setBusy(true);
    try {
      const r = await api(`/products/${productId}/images`, { method: 'POST', form });
      onChange(r.images);
      if (r.added) toast.success(`${r.added} image${r.added === 1 ? '' : 's'} uploaded and optimised`);
      for (const e of r.errors) toast.error(`${e.file}: ${e.error}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn) => {
    try {
      onChange(await fn());
    } catch (err) {
      toast.error(err);
    }
  };

  const move = (idx, dir) => {
    const ids = images.map((i) => i.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    act(() => api(`/products/${productId}/images/order`, { method: 'PUT', body: { ids } }));
  };

  return (
    <div className="stack">
      {canEdit && (
        <Dropzone
          accept="image/*"
          onFiles={upload}
          disabled={busy}
          title={busy ? 'Uploading…' : 'Upload images'}
          hint="JPG, PNG, WebP, HEIC/AVIF · up to 30 at once · optimised automatically"
        />
      )}
      {images.length > 0 ? (
        <div className="image-tiles">
          {images.map((img, i) => (
            <div key={img.id} className={`image-tile ${img.is_primary ? 'primary' : ''}`}>
              {img.is_primary && <span className="tag"><Badge tone="blue" icon={Star}>Primary</Badge></span>}
              <a className="pic" href={img.url} target="_blank" rel="noreferrer"><img src={img.thumb_url} alt={img.original_name || ''} loading="lazy" /></a>
              <div className="bar">
                <span className="tiny muted truncate" title={`${img.width}×${img.height} · ${fmtBytes(img.size_bytes)}`}>{img.width}×{img.height}</span>
                {canEdit && (
                  <div className="row" style={{ gap: 0 }}>
                    <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move left" />
                    <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Move right" />
                    {!img.is_primary && <Button size="sm" variant="ghost" icon={Star} title="Set as primary" aria-label="Set as primary" onClick={() => act(() => api(`/products/${productId}/images/${img.id}/primary`, { method: 'POST' }))} />}
                    <Button size="sm" variant="ghost" icon={RefreshCw} title="Replace" aria-label="Replace image" onClick={() => { replacing.current = img.id; replaceInput.current?.click(); }} />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      title="Delete"
                      aria-label="Delete image"
                      onClick={async () => {
                        if (await confirm({ title: 'Delete this image?', danger: true, confirmLabel: 'Delete' })) act(() => api(`/products/${productId}/images/${img.id}`, { method: 'DELETE' }));
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !canEdit && <p className="muted">No images yet.</p>
      )}
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const form = new FormData();
          form.append('image', file);
          act(() => api(`/products/${productId}/images/${replacing.current}`, { method: 'PUT', form }));
        }}
      />
    </div>
  );
}
