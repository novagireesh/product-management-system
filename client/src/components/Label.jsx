import { formatFieldValue } from '../lib/fields.js';

/** 10 × 10 cm sticker: product image in the top half, chosen details and the code below. */
function Sticker({ product, opts, preset, company, fieldDefs }) {
  const qr = opts.code === 'qr' || opts.code === 'both';
  const bar = opts.code === 'barcode' || opts.code === 'both';
  const defs = new Map((fieldDefs || []).map((f) => [f.key, f]));
  const rows = (opts.fields || [])
    .map((key) => {
      if (key === 'category') return product.category ? ['Category', [product.category, product.subcategory].filter(Boolean).join(' › ')] : null;
      const f = defs.get(key);
      const v = product.specs?.[key];
      if (!f || v === undefined || v === null || v === '') return null;
      return [f.label, formatFieldValue(f, v)];
    })
    .filter(Boolean);
  const src = product.image_url || product.thumb_url;
  return (
    <div className={`sticker ${opts.outline ? 'outline' : ''}`} style={{ '--w': `${preset.w}mm`, '--h': `${preset.h}mm` }}>
      <div className="s-img">{src ? <img src={src} alt="" /> : <span className="s-noimg">No image</span>}</div>
      <div className="s-info">
        <div className="s-text">
          {opts.name && <div className="s-name">{product.name}</div>}
          {opts.sku && <div className="s-sku">{product.sku}</div>}
          {rows.length > 0 && (
            <dl className="s-rows">
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
          {opts.company && company && <div className="s-company">{company}</div>}
        </div>
        {(qr || bar) && (
          <div className={`s-code ${qr && bar ? 'both' : bar ? 'bar-only' : ''}`}>
            {qr && <img className="qr" src={`/api/codes/${product.id}/qr.svg`} alt="" />}
            {bar && <img className="bar" src={`/api/codes/${product.id}/barcode.svg`} alt="" />}
          </div>
        )}
      </div>
    </div>
  );
}

/** One printable product label. Sizes are in millimetres. */
export default function Label({ product, opts, preset, company, fieldDefs }) {
  if (preset.style === 'sticker') return <Sticker product={product} opts={opts} preset={preset} company={company} fieldDefs={fieldDefs} />;
  const square = preset.h / preset.w > 0.8;
  const fs = Math.max(6, Math.min(11, preset.h / 4.2));
  const qr = opts.code === 'qr' || opts.code === 'both';
  const bar = opts.code === 'barcode' || opts.code === 'both';
  const style = { '--w': `${preset.w}mm`, '--h': `${preset.h}mm`, '--fs': `${fs}pt` };
  const qrSrc = `/api/codes/${product.id}/qr.svg`;
  const barSrc = `/api/codes/${product.id}/barcode.svg`;

  if (square) {
    return (
      <div className={`plabel vertical ${opts.outline ? 'outline' : ''}`} style={style}>
        {qr && <img className="l-qr" src={qrSrc} alt="" />}
        {!qr && opts.img && product.thumb_url && <img className="l-img" src={product.thumb_url} alt="" style={{ height: '50%' }} />}
        <div className="l-info">
          {opts.name && <div className="l-name">{product.name}</div>}
          {opts.sku && <div className="l-sku">{product.sku}</div>}
          {bar && <img className="l-bar" src={barSrc} alt="" />}
        </div>
      </div>
    );
  }
  return (
    <div className={`plabel ${opts.outline ? 'outline' : ''}`} style={style}>
      {opts.img && product.thumb_url && <img className="l-img" src={product.thumb_url} alt="" />}
      <div className="l-info">
        {opts.company && company && <div className="l-company">{company}</div>}
        {opts.name && <div className="l-name">{product.name}</div>}
        {opts.sku && <div className="l-sku">{product.sku}</div>}
        {bar && <img className="l-bar" src={barSrc} alt="" />}
      </div>
      {qr && <img className="l-qr" src={qrSrc} alt="" />}
    </div>
  );
}
