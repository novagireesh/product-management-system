import { useEffect, useMemo, useState } from 'react';
import { Eye, ExternalLink, ImageOff, Lock, Save, Smartphone, Tag } from 'lucide-react';
import { Alert, Badge, Button, Card, Check, Field, Input, Loading, Select, Switch } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatFieldValue } from '../../lib/fields.js';
import { useApi } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';

/**
 * Settings › QR scan page: choose what a scanned product page shows. Page items are stored in the
 * scan_page setting; product fields use their own "scan page" flag (the same switch as in Product fields).
 */
export default function ScanPageTab({ settings, onSaved }) {
  const toast = useToast();
  const fieldsApi = useApi('/settings/fields');
  const sample = useApi('/products', { query: { pageSize: 1, sort: 'sku:asc' } });
  const [show, setShow] = useState(settings.scan_page.show);
  const [price, setPrice] = useState(settings.scan_page.price);
  const [pub, setPub] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setShow(settings.scan_page.show);
    setPrice(settings.scan_page.price);
  }, [settings.scan_page]);
  useEffect(() => {
    if (fieldsApi.data) setPub(Object.fromEntries(fieldsApi.data.map((f) => [f.key, f.is_public])));
  }, [fieldsApi.data]);

  const fields = useMemo(() => (fieldsApi.data || []).filter((f) => f.active), [fieldsApi.data]);
  if (!fieldsApi.data || !pub) return <Loading />;

  const items = settings.scan_items;
  const sources = settings.price_sources || [];
  const dirty = JSON.stringify({ show, price }) !== JSON.stringify(settings.scan_page) || fieldsApi.data.some((f) => pub[f.key] !== f.is_public);
  const setAllFields = (on) => setPub({ ...pub, ...Object.fromEntries(fields.map((f) => [f.key, on])) });

  const save = async () => {
    setBusy(true);
    try {
      const s = await api('/settings/scan-page', { method: 'PUT', body: { show, price, fields: pub } });
      onSaved(s);
      fieldsApi.reload();
      toast.success('QR scan page saved — scanned pages show the new selection straight away');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const p = sample.data?.items?.[0];
  const previewFields = p ? fields.filter((f) => pub[f.key] && p.specs?.[f.key]) : [];

  return (
    <div className="stack-lg">
      <p className="muted" style={{ maxWidth: 820 }}>
        Choose what people see when they scan a product’s QR code. Only the ticked information is sent to their phone —
        everything else stays inside the app. Changes apply to all products and to labels already printed.
      </p>
      <div className="scan-config">
        <div className="stack-lg">
          <Card title="Page" icon={Smartphone}>
            <div className="stack" style={{ gap: 10 }}>
              {items.map((i) => (
                <div key={i.key}>
                  <Check label={<strong style={{ fontWeight: 550 }}>{i.label}</strong>} checked={Boolean(show[i.key])} onChange={(e) => setShow({ ...show, [i.key]: e.target.checked })} />
                  {i.hint && <div className="tiny muted" style={{ paddingLeft: 26 }}>{i.hint}</div>}
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Product information"
            icon={Eye}
            actions={<><Button size="sm" variant="ghost" onClick={() => setAllFields(true)}>All</Button><Button size="sm" variant="ghost" onClick={() => setAllFields(false)}>None</Button></>}
          >
            <div className="scan-fields">
              {fields.map((f) => (
                <Check
                  key={f.key}
                  checked={Boolean(pub[f.key])}
                  onChange={(e) => setPub({ ...pub, [f.key]: e.target.checked })}
                  label={
                    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span>{f.label}</span>
                      {f.calc && <Badge tone="blue">calculated</Badge>}
                      <span className="tiny muted">{f.usage} product{f.usage === 1 ? '' : 's'}</span>
                    </span>
                  }
                />
              ))}
            </div>
            <p className="tiny muted" style={{ marginTop: 12 }}>Empty values are never shown. Field order follows Settings › Product fields.</p>
          </Card>

          <Card title="Price" icon={Tag}>
            <div className="stack">
              <Switch label="Show a price on the scan page" checked={price.enabled} onChange={(v) => setPrice({ ...price, enabled: v })} disabled={!sources.length} />
              {!sources.length && <p className="small muted">Prices come from costing. Add costing to products first.</p>}
              {price.enabled && (
                <>
                  <Alert tone="warn">Anyone who scans the QR code — buyers, visitors — can see this price.</Alert>
                  <div className="form-grid">
                    <Field label="Price shown">
                      <Select value={price.source} onChange={(e) => setPrice({ ...price, source: e.target.value })} options={sources.map((s) => ({ value: s.key, label: `${s.label} · ${s.currency}` }))} />
                    </Field>
                    <Field label="If a product has no such price, use">
                      <Select value={price.fallback || ''} onChange={(e) => setPrice({ ...price, fallback: e.target.value })} placeholder="Nothing (show no price)">
                        {sources.filter((s) => s.key !== price.source).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Label on the page"><Input value={price.label} maxLength={40} onChange={(e) => setPrice({ ...price, label: e.target.value })} placeholder="Price" /></Field>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="scan-preview-col">
          <div className="small muted" style={{ marginBottom: 8 }}>Preview{p ? ` · ${p.sku}` : ''}</div>
          <div className="scan-preview" style={{ '--brand': settings.brand_color || '#1f3a5f' }}>
            <div className="sp-head">{settings.company_name}</div>
            {show.images && <div className="sp-img">{p?.image_url ? <img src={p.image_url} alt="" /> : <ImageOff size={28} />}</div>}
            <div className="sp-body">
              {show.code && p && <span className="pub-code sm"><span className="lbl">Code</span>{p.sku}</span>}
              {show.name && <div className="sp-name">{p?.name || 'Product name'}</div>}
              {show.category && p?.category && <div className="tiny muted">{[p.category, p.subcategory].filter(Boolean).join(' › ')}</div>}
              {price.enabled && <div className="sp-price"><span className="tiny muted">{price.label}</span> <strong>{sources.find((s) => s.key === price.source)?.currency} …</strong></div>}
              {show.description && p?.description && <p className="tiny" style={{ color: 'var(--text-2)' }}>{p.description}</p>}
              {previewFields.length > 0 && (
                <div className="sp-specs">
                  {previewFields.map((f) => (
                    <div key={f.key}><div className="k">{f.label}</div><div className="v">{formatFieldValue(f, p.specs[f.key])}</div></div>
                  ))}
                </div>
              )}
              {show.contact && <div className="row" style={{ gap: 6 }}><span className="sp-btn">WhatsApp</span><span className="sp-btn">Email</span></div>}
            </div>
            {show.costing_button && <div className="sp-cta"><Lock size={12} /> VIEW COSTING</div>}
          </div>
          {p && (
            <a className="btn btn-sm" style={{ marginTop: 10 }} href={`/p/${encodeURIComponent(p.code || p.sku)}`} target="_blank" rel="noreferrer">
              <ExternalLink /> Open the real scan page
            </a>
          )}
          {dirty && <p className="tiny muted" style={{ marginTop: 6 }}>Save first to see changes on the real page.</p>}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" icon={Save} onClick={save} loading={busy} disabled={!dirty}>Save scan page</Button>
      </div>
    </div>
  );
}
