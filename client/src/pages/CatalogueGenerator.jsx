import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, BookOpen, CheckCircle2, Download, Eye, FileSpreadsheet, FileText, Lock, PencilLine, Percent, Presentation, Plus, Sparkles, Tag, X,
} from 'lucide-react';
import { PERCENT_LIMITS, PRICE_ROUNDING, percentLabel, percentPrice } from '../../../shared/pricing.js';
import ManualPriceSheet from '../components/ManualPriceSheet.jsx';
import PercentPriceSheet, { referencePrice } from '../components/PercentPriceSheet.jsx';
import ProductPicker from '../components/ProductPicker.jsx';
import { Alert, Badge, Button, Card, Check, Field, Input, Loading, PageHeader, Segmented, Select, Switch, Thumb, useConfirm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { parseInputNumber } from '../lib/costing.js';
import { fmtBytes, plural } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useSelection } from '../lib/selection.jsx';
import { useToast } from '../lib/toast.jsx';

const FORMAT_META = {
  pdf: { label: 'PDF', icon: FileText, desc: 'Email, WhatsApp, printing' },
  pptx: { label: 'PowerPoint', icon: Presentation, desc: 'Buyer presentations' },
  xlsx: { label: 'Excel', icon: FileSpreadsheet, desc: 'Structured product list' },
};
const PRICE_KEY = 'pm.catalogue.manualPrices';

function TemplatePreview({ kind, brand }) {
  const band = kind === 'simple' ? '#e4e7ec' : brand;
  const pages = kind === 'buyer' ? 2 : 1;
  return (
    <div className="preview">
      <div className="mini-page" style={{ flex: 0.8, background: kind === 'simple' ? '#fff' : brand, justifyContent: 'center', padding: 8 }}>
        <div className="mini-lines"><i className="b" style={{ background: kind === 'simple' ? '#c8cfdb' : 'rgba(255,255,255,.75)' }} /><i style={{ width: '50%', background: kind === 'simple' ? '#e4e7ec' : 'rgba(255,255,255,.35)' }} /></div>
      </div>
      <div className="mini-page">
        <div className="mini-band" style={{ background: band }} />
        <div className="mini-body">
          {Array.from({ length: pages }).map((_, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', gap: 4, flexDirection: pages === 2 ? 'column' : 'row' }}>
              <div className="mini-img" style={{ flex: pages === 2 ? 1 : 1.3, minHeight: 20 }} />
              <div className="mini-lines">
                <i className="b" />
                <i />
                <i />
                {kind !== 'simple' && <><i /><i style={{ width: '60%' }} /></>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function loadPrices() {
  try {
    return JSON.parse(sessionStorage.getItem(PRICE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function CatalogueGenerator() {
  useTitle('Catalogue generator');
  const { can, branding } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const selection = useSelection();
  const [params] = useSearchParams();
  const options = useApi('/catalogues/options');
  const buyers = useApi('/buyers');
  const collections = useApi('/collections');
  const [productIds, setProductIds] = useState([]);
  const [collectionId, setCollectionId] = useState(params.get('collection') || '');
  const [picker, setPicker] = useState(false);
  const [form, setForm] = useState({
    title: '', subtitle: '', buyer_id: params.get('buyer') || '', template: 'premium', layout: 'single', orientation: 'landscape',
    code: 'qr', cover: true, fields: null, formats: ['pdf'],
  });
  const [price, setPrice] = useState({
    mode: 'none', source: 'buyer_price', fallback: 'price_usd', label: 'Price', currency: '', reference: 'buyer_price', percent: '', rounding: 'whole',
  });
  const [prices, setPrices] = useState(loadPrices);
  const [view, setView] = useState('settings');
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  // Initial product source
  useEffect(() => {
    if (params.get('from') === 'selection') setProductIds(selection.ids);
    else if (params.get('ids')) setProductIds(params.get('ids').split(',').map(Number).filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (options.data && !price.currency) setPrice((p) => ({ ...p, currency: options.data.currency }));
  }, [options.data, price.currency]);

  // Keep typed prices if the page is reloaded.
  useEffect(() => {
    try {
      sessionStorage.setItem(PRICE_KEY, JSON.stringify(prices));
    } catch { /* ignore */ }
  }, [prices]);

  // Pull products and buyer from a chosen collection
  useEffect(() => {
    if (!collectionId) return;
    api(`/collections/${collectionId}`)
      .then((c) => {
        setProductIds(c.products.map((p) => p.id));
        setForm((f) => ({ ...f, buyer_id: c.buyer_id ? String(c.buyer_id) : f.buyer_id, title: f.title || c.name }));
      })
      .catch((err) => toast.error(err));
  }, [collectionId, toast]);

  const products = useApi('/products', { query: { ids: productIds.join(',') || '0', pageSize: 500 }, deps: [productIds.join(',')] });
  const ordered = useMemo(() => {
    const map = new Map((products.data?.items || []).map((p) => [p.id, p]));
    return productIds.map((id) => map.get(id)).filter(Boolean);
  }, [products.data, productIds]);

  // Reference prices from costing (only for users who may see costing).
  const priceSources = useMemo(() => (options.data?.priceSources || []).map((s) => ({ ...s, type: 'currency' })), [options.data]);
  const references = useApi(priceSources.length && productIds.length ? '/costing' : null, {
    query: { ids: productIds.join(','), pageSize: 500 },
    skip: !priceSources.length || !productIds.length,
    deps: [productIds.join(',')],
  });
  const referenceValues = useMemo(() => Object.fromEntries((references.data?.items || []).map((p) => [p.id, p.values])), [references.data]);

  const templates = options.data?.templates || [];
  const allFields = options.data?.fields || [];
  const tpl = templates.find((t) => t.key === form.template);
  const fields = form.fields ?? tpl?.fields ?? [];
  const manualFilled = ordered.filter((p) => parseInputNumber(prices[p.id]) !== null).length;
  // Percentage increase: same calculation as the server, for the summary and the preview page.
  const pct = parseInputNumber(price.percent);
  const pctValid = pct !== null && pct >= PERCENT_LIMITS.min && pct <= PERCENT_LIMITS.max;
  const withReference = ordered.filter((p) => referencePrice(referenceValues[p.id], price) !== null);
  const pctExample = pctValid && withReference[0] ? { p: withReference[0], ref: referencePrice(referenceValues[withReference[0].id], price) } : null;
  const sourceCurrency = priceSources.find((s) => s.key === price.source)?.currency || '';

  const pickTemplate = (key) => {
    const t = templates.find((x) => x.key === key);
    setForm({ ...form, template: key, layout: t.layout, fields: null });
  };
  const toggleField = (key) => setForm({ ...form, fields: fields.includes(key) ? fields.filter((k) => k !== key) : [...fields, key] });
  const toggleFormat = (f) => setForm({ ...form, formats: form.formats.includes(f) ? form.formats.filter((x) => x !== f) : [...form.formats, f] });
  const move = (i, dir) => {
    const next = [...productIds];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setProductIds(next);
  };

  const buyer = (buyers.data || []).find((b) => String(b.id) === String(form.buyer_id));

  const pricePayload = () => {
    if (price.mode === 'existing') return { mode: 'existing', source: price.source, fallback: price.fallback || null, label: price.label };
    if (price.mode === 'percent') {
      return { mode: 'percent', source: price.source, fallback: price.fallback || null, label: price.label, percent: pct, rounding: price.rounding };
    }
    if (price.mode === 'manual') {
      const values = {};
      for (const p of ordered) {
        const n = parseInputNumber(prices[p.id]);
        if (n !== null) values[p.id] = n;
      }
      return { mode: 'manual', label: price.label, currency: price.currency, values };
    }
    return { mode: 'none' };
  };

  const generate = async (formatsOverride) => {
    const formats = formatsOverride || form.formats;
    if (!formats.length) return toast.error('Choose at least one export format');
    if (price.mode === 'percent' && !pctValid) return toast.error(`Enter the percentage increase (between ${PERCENT_LIMITS.min} and ${PERCENT_LIMITS.max})`);
    if (price.mode === 'manual' && manualFilled === 0) {
      const ok = await confirm({ title: 'No prices entered', message: 'None of the products has a price yet. Generate the catalogue without prices?', confirmLabel: 'Generate anyway' });
      if (!ok) return;
    }
    setBusy(formatsOverride ? formatsOverride[0] : 'all');
    setResult(null);
    try {
      const c = await api('/catalogues', {
        method: 'POST',
        body: {
          ...form,
          formats,
          title: form.title.trim() || (buyer ? `Product catalogue for ${buyer.company || buyer.name}` : 'Product catalogue'),
          fields,
          product_ids: productIds,
          buyer_id: form.buyer_id || null,
          collection_id: collectionId || null,
          price: pricePayload(),
        },
      });
      setResult(c);
      toast.success('Catalogue generated');
      setView('settings');
      setTimeout(() => document.getElementById('catalogue-result')?.scrollIntoView({ behavior: 'smooth' }), 80);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const saveToProducts = async () => {
    const values = pricePayload().values || {};
    const n = Object.keys(values).length;
    const ok = await confirm({
      title: `Save ${plural(n, 'price')} to the products?`,
      message: 'The entered prices will replace each product’s “As Discussed Rate ($)” in the master costing. This is recorded in the product history.',
      confirmLabel: 'Save to products',
    });
    if (!ok) return;
    try {
      const r = await api('/catalogues/save-prices', { method: 'POST', body: { field: 'buyer_price', values } });
      toast.success(`${plural(r.saved, 'price')} saved as ${r.field}`);
      references.reload?.();
    } catch (err) {
      toast.error(err);
    }
  };

  // Copy the percentage prices into Manual price, to change individual products before generating.
  const useAsManual = async () => {
    if (manualFilled) {
      const ok = await confirm({ title: 'Replace the manual prices?', message: `${plural(manualFilled, 'manual price')} already entered will be replaced by the calculated prices.`, confirmLabel: 'Replace' });
      if (!ok) return;
    }
    const next = {};
    for (const p of ordered) {
      const v = percentPrice(referencePrice(referenceValues[p.id], price), pct, price.rounding);
      if (v !== null) next[p.id] = String(v);
    }
    setPrices(next);
    setPrice({ ...price, mode: 'manual', currency: sourceCurrency || price.currency });
    setView('prices');
    toast.info('Prices copied to Manual price — change any product, then generate');
  };

  if (options.loading && !options.data) return <Loading />;

  if (view === 'percent') {
    return (
      <PercentPriceSheet
        products={ordered}
        price={price}
        setPrice={setPrice}
        references={referenceValues}
        referenceFields={priceSources}
        onUseAsManual={useAsManual}
        onBack={() => setView('settings')}
        onGenerate={generate}
        busy={busy}
      />
    );
  }

  if (view === 'prices') {
    return (
      <ManualPriceSheet
        products={ordered}
        prices={prices}
        setPrices={setPrices}
        price={price}
        setPrice={setPrice}
        references={referenceValues}
        referenceFields={priceSources}
        fieldDefs={options.data?.fields}
        canSave={options.data?.canSavePrices}
        onSaveToProducts={saveToProducts}
        onBack={() => setView('settings')}
        onGenerate={generate}
        busy={busy}
      />
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader title="Catalogue generator" subtitle="Turn a product selection into a professional catalogue for international buyers." />

      <Card title={<>1 · Products <Badge tone="blue">{productIds.length}</Badge></>} actions={
        <>
          {productIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setProductIds([]); setCollectionId(''); }}>Clear</Button>}
          <Button size="sm" icon={Plus} onClick={() => setPicker(true)}>Add products</Button>
        </>
      }>
        <div className="stack">
          <div className="row-wrap">
            <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} placeholder="Load a collection…" style={{ maxWidth: 360 }}>
              {[
                ['Buyer collections', (collections.data || []).filter((c) => !c.auto_key)],
                ['Collections by product code', (collections.data || []).filter((c) => c.auto_key).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))],
              ]
                .filter(([, list]) => list.length)
                .map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.buyer_name ? ` — ${c.buyer_name}` : ''} ({c.product_count})</option>)}
                  </optgroup>
                ))}
            </Select>
            {selection.count > 0 && <Button onClick={() => { setCollectionId(''); setProductIds(selection.ids); }}>Use my {plural(selection.count, 'selected product')}</Button>}
          </div>
          {ordered.length ? (
            <div className="card" style={{ maxHeight: 320, overflow: 'auto' }}>
              <div className="list">
                {ordered.map((p, i) => (
                  <div key={p.id} className="list-item" style={{ padding: '8px 14px' }}>
                    <span className="tiny muted" style={{ width: 22 }}>{i + 1}</span>
                    <Thumb src={p.thumb_url} size="sm" />
                    <div className="grow"><div className="truncate" style={{ fontWeight: 560 }}>{p.name}</div><div className="tiny muted mono">{p.sku}</div></div>
                    {p.image_count === 0 && <Badge tone="amber">No image</Badge>}
                    <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                    <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === ordered.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                    <Button size="sm" variant="ghost" icon={X} onClick={() => setProductIds(productIds.filter((x) => x !== p.id))} aria-label="Remove" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">Choose a buyer collection, use your selection from the Products page, or add products here.</p>
          )}
        </div>
      </Card>

      <Card title="2 · Template">
        <div className="tpl-grid">
          {templates.map((t) => (
            <button key={t.key} type="button" className={`tpl ${form.template === t.key ? 'on' : ''}`} onClick={() => pickTemplate(t.key)}>
              <TemplatePreview kind={t.key} brand={branding?.brand_color || '#1f3a5f'} />
              <div className="info"><div className="t">{t.label}</div><div className="d">{t.description}</div></div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="3 · Details">
          <div className="stack">
            <Field label="Catalogue title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={buyer ? `Product catalogue for ${buyer.company || buyer.name}` : 'e.g. Spring / Summer 2027 Collection'} maxLength={120} /></Field>
            <Field label="Subtitle (optional)"><Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="e.g. Solid wood living room furniture" maxLength={200} /></Field>
            <Field label="Prepared for (buyer)">
              <Select value={form.buyer_id} onChange={(e) => setForm({ ...form, buyer_id: e.target.value })} placeholder="No specific buyer">
                {(buyers.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.company ? ` (${b.company})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Products per page">
              <Segmented value={form.layout} onChange={(v) => setForm({ ...form, layout: v })} options={[{ value: 'single', label: '1 large' }, { value: 'grid2', label: '2 per page' }, { value: 'grid4', label: '4 per page' }]} />
            </Field>
            <Field label="Page orientation (PDF)">
              <Segmented value={form.orientation} onChange={(v) => setForm({ ...form, orientation: v })} options={[{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }]} />
            </Field>
            <Field label="Code on each product">
              <Segmented value={form.code} onChange={(v) => setForm({ ...form, code: v })} options={[{ value: 'qr', label: 'QR code' }, { value: 'barcode', label: 'Barcode' }, { value: 'none', label: 'None' }]} />
            </Field>
            <Switch label="Include cover page" checked={form.cover} onChange={(v) => setForm({ ...form, cover: v })} />
            {!branding?.logo_url && can('settings.manage') && <Alert tone="info">Add your company logo in <Link to="/settings">Settings</Link> to brand the catalogue.</Alert>}
          </div>
        </Card>

        <Card title="4 · Product information to show" actions={form.fields && <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, fields: null })}>Reset to template</Button>}>
          <div className="stack">
            <p className="small muted">Product image, Product ID and name are always included. Prices are set in step 5.</p>
            <div className="grid-2" style={{ gap: 8 }}>
              {allFields.map((f) => (
                <Check
                  key={f.key}
                  checked={fields.includes(f.key)}
                  onChange={() => toggleField(f.key)}
                  label={<span className="row" style={{ gap: 5 }}>{f.label}{f.is_public === false && <span className="tiny muted">internal</span>}</span>}
                />
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card title="5 · Price — pricing method" icon={Tag}>
        <div className="stack">
          <div className="radio-cards">
            <label className={`radio-card ${price.mode === 'none' ? 'on' : ''}`}>
              <input type="radio" name="price" checked={price.mode === 'none'} onChange={() => setPrice({ ...price, mode: 'none' })} />
              <span><span className="t">No price</span><span className="d" style={{ display: 'block' }}>Product details only</span></span>
            </label>
            <label className={`radio-card ${price.mode === 'existing' ? 'on' : ''}`} style={!priceSources.length ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
              <input type="radio" name="price" checked={price.mode === 'existing'} disabled={!priceSources.length} onChange={() => setPrice({ ...price, mode: 'existing' })} />
              <span>
                <span className="t row" style={{ gap: 5 }}>Reference price <Lock size={12} /></span>
                <span className="d" style={{ display: 'block' }}>{priceSources.length ? 'Each product’s existing price from costing, unchanged' : 'Needs costing access'}</span>
              </span>
            </label>
            <label className={`radio-card ${price.mode === 'manual' ? 'on' : ''}`}>
              <input type="radio" name="price" checked={price.mode === 'manual'} onChange={() => setPrice({ ...price, mode: 'manual' })} />
              <span><span className="t">Manual price</span><span className="d" style={{ display: 'block' }}>Enter the final negotiated price per product, for this catalogue only</span></span>
            </label>
            <label className={`radio-card ${price.mode === 'percent' ? 'on' : ''}`} style={!priceSources.length ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
              <input type="radio" name="price" checked={price.mode === 'percent'} disabled={!priceSources.length} onChange={() => setPrice({ ...price, mode: 'percent' })} />
              <span>
                <span className="t row" style={{ gap: 5 }}>Percentage increase <Lock size={12} /></span>
                <span className="d" style={{ display: 'block' }}>{priceSources.length ? 'Reference price + a percentage, e.g. +5%, for every product' : 'Needs costing access'}</span>
              </span>
            </label>
          </div>

          {price.mode !== 'none' && (
            <div className="form-grid">
              <Field label="Price label in the catalogue" hint="e.g. Price, FOB Price, Ex-Factory">
                <Input value={price.label} onChange={(e) => setPrice({ ...price, label: e.target.value })} maxLength={40} />
              </Field>
              {price.mode === 'percent' && (
                <>
                  <Field label="Increase by" hint="Applied to each product’s own reference price">
                    <div className="input-group">
                      <Input inputMode="decimal" value={price.percent} onChange={(e) => setPrice({ ...price, percent: e.target.value })} placeholder="e.g. 5" aria-label="Percentage increase" />
                      <span className="addon"><Percent size={14} /></span>
                    </div>
                  </Field>
                  <Field label="Rounding">
                    <Select value={price.rounding} onChange={(e) => setPrice({ ...price, rounding: e.target.value })} options={PRICE_ROUNDING} />
                  </Field>
                </>
              )}
              {price.mode === 'existing' || price.mode === 'percent' ? (
                <Field label={price.mode === 'percent' ? 'Reference price' : 'Price source'}>
                  <Select value={price.source} onChange={(e) => setPrice({ ...price, source: e.target.value })}>
                    {priceSources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </Select>
                </Field>
              ) : (
                <Field label="Currency">
                  <Select value={price.currency} onChange={(e) => setPrice({ ...price, currency: e.target.value })}>
                    {['USD', 'EUR', 'GBP', 'INR', 'AED', 'AUD', 'CAD'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              )}
              {(price.mode === 'existing' || price.mode === 'percent') && (
                <Field label="When the price is empty, use">
                  <Select value={price.fallback || ''} onChange={(e) => setPrice({ ...price, fallback: e.target.value })} placeholder="Nothing (show no price)">
                    {priceSources.filter((s) => s.key !== price.source).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}

          {(price.mode === 'existing' || price.mode === 'percent') && <Alert tone="warn" icon={Lock}>Prices come from protected costing data. Only share this catalogue with the intended buyer.</Alert>}
          {price.mode === 'percent' && (
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">
                {!ordered.length ? 'Add products first.' : !pctValid ? 'Enter the percentage to see the prices.' : (
                  <>
                    {withReference.length} of {plural(ordered.length, 'product')} have a reference price
                    {pctExample && (
                      <> · e.g. <span className="mono">{pctExample.p.sku}</span>: {sourceCurrency} {pctExample.ref.toLocaleString(undefined, { maximumFractionDigits: 2 })} {percentLabel(pct)} = <strong>{sourceCurrency} {percentPrice(pctExample.ref, pct, price.rounding).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></>
                    )}
                    . Reference prices are not changed.
                  </>
                )}
              </span>
              <Button variant="primary" icon={Eye} disabled={!ordered.length || !pctValid} onClick={() => setView('percent')}>Preview prices</Button>
            </div>
          )}
          {price.mode === 'manual' && (
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">
                {ordered.length ? `${manualFilled} of ${plural(ordered.length, 'product')} priced. Manual prices never change product costing.` : 'Add products first.'}
              </span>
              <Button variant="primary" icon={PencilLine} disabled={!ordered.length} onClick={() => setView('prices')}>Enter prices</Button>
            </div>
          )}
        </div>
      </Card>

      <Card title="6 · Export formats">
        <div className="radio-cards">
          {Object.entries(FORMAT_META).map(([k, m]) => (
            <label key={k} className={`radio-card ${form.formats.includes(k) ? 'on' : ''}`}>
              <input type="checkbox" checked={form.formats.includes(k)} onChange={() => toggleFormat(k)} />
              <m.icon size={20} className="muted" />
              <span><span className="t">{m.label}</span><span className="d" style={{ display: 'block' }}>{m.desc}</span></span>
            </label>
          ))}
        </div>
      </Card>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {price.mode === 'manual' && <Button size="lg" icon={PencilLine} onClick={() => setView('prices')} disabled={!ordered.length}>Enter prices ({manualFilled}/{ordered.length})</Button>}
        {price.mode === 'percent' && <Button size="lg" icon={Eye} onClick={() => setView('percent')} disabled={!ordered.length || !pctValid}>Preview prices</Button>}
        <Button variant="primary" size="lg" icon={Sparkles} onClick={() => generate(null)} loading={busy === 'all'} disabled={!productIds.length || !form.formats.length}>
          {busy ? 'Generating…' : `Generate catalogue (${plural(productIds.length, 'product')})`}
        </Button>
      </div>

      {result && (
        <div id="catalogue-result">
          <Card>
            <div className="stack">
              <div className="row" style={{ gap: 12 }}>
                <div className="stat" style={{ padding: 0 }}><div className="icon tone-green"><CheckCircle2 /></div></div>
                <div className="grow">
                  <h2>{result.title}</h2>
                  <p className="muted small">
                    {plural(result.product_count, 'product')} · {templates.find((t) => t.key === result.template)?.label} template{result.buyer_name ? ` · for ${result.buyer_name}` : ''}
                    {result.options?.price?.mode === 'manual' ? ' · manual prices'
                      : result.options?.price?.mode === 'existing' ? ' · prices from costing'
                        : result.options?.price?.mode === 'percent' ? ` · reference price ${percentLabel(result.options.price.percent)}${result.options.price.rounding === 'whole' ? ', rounded' : ''}` : ''}
                  </p>
                </div>
              </div>
              <div className="row-wrap">
                {result.files.map((f) => {
                  const M = FORMAT_META[f.format];
                  return (
                    <a key={f.format} className="btn btn-primary" href={`/api/catalogues/${result.id}/download/${f.format}`}>
                      <Download /> {M.label} <span style={{ opacity: 0.75, fontWeight: 400 }}>· {fmtBytes(f.size_bytes)}</span>
                    </a>
                  );
                })}
                {result.files.some((f) => f.format === 'pdf') && (
                  <a className="btn" href={`/api/catalogues/${result.id}/download/pdf?inline=1`} target="_blank" rel="noreferrer"><Eye /> Preview PDF</a>
                )}
                <Link className="btn btn-ghost" to="/catalogues"><BookOpen /> Catalogue history</Link>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ProductPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(ids) => { setProductIds([...new Set([...productIds, ...ids])]); setPicker(false); }}
        title="Add products to the catalogue"
      />
    </div>
  );
}
