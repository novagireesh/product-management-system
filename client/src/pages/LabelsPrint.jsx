import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import Label from '../components/Label.jsx';
import { Button, Loading } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useTitle } from '../lib/hooks.js';
import { DEFAULT_LABEL, LABEL_PRESETS } from '../lib/labels.js';

export default function LabelsPrint() {
  useTitle('Print labels');
  const { branding } = useAuth();
  const [params] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  const flag = (k, d) => (params.has(k) ? params.get(k) === '1' : d);
  const opts = {
    preset: params.get('preset') || DEFAULT_LABEL.preset,
    code: params.get('code') || 'qr',
    img: flag('img', true),
    name: flag('name', true),
    sku: flag('sku', true),
    company: flag('company', false),
    outline: flag('outline', true),
    copies: Math.max(1, Math.min(50, Number(params.get('copies')) || 1)),
    fields: (params.get('fields') ?? DEFAULT_LABEL.fields.join(',')).split(',').filter(Boolean),
  };
  const [fieldDefs, setFieldDefs] = useState([]);
  useEffect(() => {
    api('/products/meta').then((m) => setFieldDefs(m.fields)).catch(() => {});
  }, []);
  const preset = LABEL_PRESETS[opts.preset] || LABEL_PRESETS['a4-3x8'];

  useEffect(() => {
    (async () => {
      try {
        const all = [];
        for (let i = 0; i < ids.length; i += 500) {
          const r = await api('/products', { query: { ids: ids.slice(i, i + 500).join(','), pageSize: 500, sort: 'sku:asc' } });
          all.push(...r.items);
        }
        const order = new Map(ids.map((id, i) => [Number(id), i]));
        all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        setProducts(all);
      } catch (err) {
        setError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('ids')]);

  // Thermal printers print one label per page at the label's exact size.
  const pageCss = useMemo(
    () => (preset.sheet
      // Two 10 cm stickers side by side need narrow page margins to fit on A4.
      ? `@page { size: A4; margin: ${preset.style === 'sticker' ? 4 : 8}mm; }`
      : `@page { size: ${preset.w}mm ${preset.h}mm; margin: 0; } .labels-sheet { gap: 0 !important; } .plabel, .sticker { border: 0 !important; page-break-after: always; }`),
    [preset],
  );

  const labels = useMemo(() => (products || []).flatMap((p) => Array.from({ length: opts.copies }, (_, i) => ({ p, key: `${p.id}-${i}` }))), [products, opts.copies]);

  if (error) return <div className="content">{error.message}</div>;
  if (!products) return <Loading />;

  return (
    <div className="print-area" style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <style>{pageCss}</style>
      <div className="no-print row between" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 18 }}>{labels.length} labels · {preset.label}</h1>
          <p className="muted small">Use your browser’s print dialog. For label sheets, set scale to 100% / “Actual size” and margins to default.</p>
        </div>
        <div className="row">
          <Button onClick={() => window.close()}>Close</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <div className="labels-sheet" style={{ gridTemplateColumns: `repeat(${preset.cols}, ${preset.w}mm)`, '--gap': preset.sheet ? (preset.style === 'sticker' ? '1mm' : '2.5mm') : '0' }}>
        {labels.map(({ p, key }) => <Label key={key} product={p} opts={opts} preset={preset} company={branding?.company_name} fieldDefs={fieldDefs} />)}
      </div>
    </div>
  );
}
