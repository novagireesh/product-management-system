import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, Info, Printer, QrCode, Smartphone } from 'lucide-react';
import Label from '../components/Label.jsx';
import { ProductPickerList } from '../components/ProductPicker.jsx';
import { Alert, Button, Card, Check, Field, Input, PageHeader, Segmented, Select } from '../components/ui.jsx';
import { api, downloadPost } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { plural } from '../lib/format.js';
import { useApi, useStored, useTitle } from '../lib/hooks.js';
import { DEFAULT_LABEL, LABEL_PRESETS, labelQuery } from '../lib/labels.js';
import { useSelection } from '../lib/selection.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Codes() {
  useTitle('Barcode / QR');
  const { branding } = useAuth();
  const toast = useToast();
  const global = useSelection();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(() => new Set(params.get('from') === 'selection' ? global.ids : []));
  const [stored, setOpts] = useStored('pm.labels', DEFAULT_LABEL);
  const opts = { ...DEFAULT_LABEL, ...stored };
  const meta = useApi('/products/meta');
  const [zipKinds, setZipKinds] = useState('qr');
  const [zipBusy, setZipBusy] = useState(false);
  const info = useApi('/codes/info');
  const preview = useApi('/products', { query: { ids: [...selected][0] || 0, pageSize: 1 } });
  const preset = LABEL_PRESETS[opts.preset] || LABEL_PRESETS['a4-3x8'];
  const ids = [...selected];

  useEffect(() => {
    if (params.get('from') === 'selection') setSelected(new Set(global.ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k, v) => setOpts({ ...opts, [k]: v });
  const sticker = preset.style === 'sticker';
  const stickerFields = [{ key: 'category', label: 'Category' }, ...(meta.data?.fields || []).map((f) => ({ key: f.key, label: f.label }))];
  const toggleField = (key) => set('fields', opts.fields.includes(key) ? opts.fields.filter((k) => k !== key) : [...opts.fields, key]);
  const localBase = info.data && /localhost|127\.0\.0\.1/.test(info.data.baseUrl);
  const sample = preview.data?.items?.[0] || { id: 0, name: 'Wooden Coffee Table', sku: 'PRD-10025', thumb_url: null };

  const print = () => {
    window.open(`/print/labels?${labelQuery(opts, ids)}`, '_blank', 'noopener');
    api('/codes/printed', { method: 'POST', body: { ids } }).catch(() => {});
  };

  const zip = async () => {
    setZipBusy(true);
    try {
      const kinds = zipKinds === 'both' ? ['qr', 'barcode'] : [zipKinds];
      await downloadPost('/codes/zip', { ids, kinds, format: 'png' }, 'product-codes.zip');
    } catch (err) {
      toast.error(err);
    } finally {
      setZipBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Barcode / QR generator" subtitle="Every product automatically has a unique QR code and barcode. Download them or print labels in bulk." />

      {info.data && (
        <Alert tone={localBase ? 'warn' : 'info'} icon={Smartphone} title="Where QR codes point">
          QR codes open <span className="mono">{info.data.baseUrl}/p/&lt;product-code&gt;</span>.{' '}
          {localBase
            ? 'This address only works on this computer — phones cannot open it. Set the public address in Settings before printing labels.'
            : 'Phones must be able to reach this address (same Wi-Fi network, or a public domain).'}{' '}
          <Link to="/settings?tab=scan">Change in Settings</Link>
        </Alert>
      )}

      <div className="split-grid">
        <Card title="1 · Choose products" icon={QrCode} pad={false} actions={selected.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear {selected.size}</Button>}>
          <ProductPickerList selected={selected} onChange={setSelected} />
        </Card>

        <div className="stack sticky-side">
          <Card title="2 · Label layout" icon={Printer}>
            <div className="stack">
              <Field label="Label size">
                <Select value={opts.preset} onChange={(e) => set('preset', e.target.value)}>
                  {Object.entries(LABEL_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Code on label">
                <Segmented value={opts.code} onChange={(v) => set('code', v)} options={[{ value: 'qr', label: 'QR code' }, { value: 'barcode', label: 'Barcode' }, { value: 'both', label: 'Both' }]} />
              </Field>
              {sticker && (
                <Field label="Details printed under the image" hint="Top 5 cm: product image (kept in proportion). Bottom 5 cm: these details and the code.">
                  <div className="grid-2" style={{ gap: 6 }}>
                    {stickerFields.map((f) => <Check key={f.key} label={f.label} checked={opts.fields.includes(f.key)} onChange={() => toggleField(f.key)} />)}
                  </div>
                </Field>
              )}
              <div className="grid-2" style={{ gap: 8 }}>
                {!sticker && <Check label="Product image" checked={opts.img} onChange={(e) => set('img', e.target.checked)} />}
                <Check label="Product name" checked={opts.name} onChange={(e) => set('name', e.target.checked)} />
                <Check label="Product ID" checked={opts.sku} onChange={(e) => set('sku', e.target.checked)} />
                <Check label="Company name" checked={opts.company} onChange={(e) => set('company', e.target.checked)} />
                <Check label="Cut lines" checked={opts.outline} onChange={(e) => set('outline', e.target.checked)} />
              </div>
              <Field label="Copies of each label">
                <Input type="number" min={1} max={50} value={opts.copies} onChange={(e) => set('copies', Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
              </Field>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>Preview</div>
                <div style={{ background: '#f2f4f7', borderRadius: 10, padding: 16, display: 'grid', placeItems: 'center', overflow: 'auto' }}>
                  <div style={{ transform: preset.w > 80 ? 'scale(1)' : 'scale(1.35)', transformOrigin: 'center', margin: preset.w > 80 ? 0 : '14px 0' }}>
                    {sample.id ? <Label product={sample} opts={opts} preset={preset} company={branding?.company_name} fieldDefs={meta.data?.fields} /> : <span className="small muted">Select a product to preview its label</span>}
                  </div>
                </div>
              </div>
              <Button variant="primary" size="lg" icon={Printer} disabled={!ids.length} onClick={print} block>
                Print {ids.length ? plural(ids.length * opts.copies, 'label') : 'labels'}
              </Button>
            </div>
          </Card>
          <Card title="Download codes" icon={Archive}>
            <div className="stack">
              <Segmented value={zipKinds} onChange={setZipKinds} options={[{ value: 'qr', label: 'QR codes' }, { value: 'barcode', label: 'Barcodes' }, { value: 'both', label: 'Both' }]} />
              <Button icon={Archive} disabled={!ids.length} loading={zipBusy} onClick={zip}>Download ZIP ({ids.length})</Button>
              <p className="tiny muted row" style={{ alignItems: 'flex-start' }}><Info size={13} style={{ flexShrink: 0, marginTop: 2 }} /> High-resolution PNG files named by Product ID. Single codes can be downloaded as PNG or SVG from each product’s page.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
