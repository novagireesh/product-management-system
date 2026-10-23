import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ImagePlus, Save, Wallet, X } from 'lucide-react';
import { Alert, Button, Card, Dropzone, ErrorState, Field, Input, Loading, PageHeader, Select, Textarea } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { calcLoadability, cbmFromDimensions } from '../lib/fields.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';

const sameNumber = (a, b) => a !== null && b !== null && Number.isFinite(Number(a)) && Math.abs(Number(a) - b) < 1e-6;
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

function FieldInput({ field, value, onChange }) {
  const common = { value: value ?? '', onChange: (e) => onChange(e.target.value), id: `f-${field.key}` };
  if (field.calc) {
    // System-calculated (e.g. loadability): shown, never typed.
    const input = <Input {...common} readOnly tabIndex={-1} placeholder="Calculated from CBM" style={{ background: 'var(--surface-2)' }} />;
    return field.unit ? <div className="input-group">{input}<span className="addon">{field.unit}</span></div> : input;
  }
  switch (field.type) {
    case 'textarea':
      return <Textarea rows={3} {...common} />;
    case 'number':
      return field.unit ? (
        <div className="input-group"><Input inputMode="decimal" {...common} /><span className="addon">{field.unit}</span></div>
      ) : <Input inputMode="decimal" {...common} />;
    case 'select':
      return <Select {...common} placeholder="—" options={field.options} />;
    case 'boolean':
      return <Select {...common} placeholder="—" options={['Yes', 'No']} />;
    case 'date':
      return <Input type="date" {...common} />;
    default:
      return field.unit ? (
        <div className="input-group"><Input {...common} /><span className="addon">{field.unit}</span></div>
      ) : <Input {...common} />;
  }
}

const EMPTY = { sku: '', name: '', category: '', subcategory: '', description: '', status: 'active', specs: {} };

export default function ProductForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const copyFrom = params.get('copy');
  const isEdit = Boolean(id);
  const { can, branding } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  useTitle(isEdit ? 'Edit product' : 'New product');

  const meta = useApi('/products/meta');
  const source = useApi(isEdit ? `/products/${id}` : copyFrom ? `/products/${copyFrom}` : null, { skip: !isEdit && !copyFrom });
  const nextSku = useApi(!isEdit ? '/products/next-sku' : null, { skip: isEdit });
  const costFields = useApi(!isEdit && can('costing.edit') ? '/costing/fields' : null, { skip: isEdit || !can('costing.edit') });
  const [form, setForm] = useState(EMPTY);
  const [files, setFiles] = useState([]);
  const [costing, setCosting] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const p = source.data;
    if (!p) return;
    setForm({
      sku: isEdit ? p.sku : '',
      name: isEdit ? p.name : `${p.name} (copy)`,
      category: p.category || '',
      subcategory: p.subcategory || '',
      description: p.description || '',
      status: p.status,
      specs: { ...p.specs },
    });
  }, [source.data, isEdit]);

  const fields = meta.data?.fields || [];
  const groups = useMemo(() => {
    const m = new Map();
    for (const f of fields) {
      if (!m.has(f.group_name)) m.set(f.group_name, []);
      m.get(f.group_name).push(f);
    }
    return [...m.entries()];
  }, [fields]);
  const categories = meta.data?.categories || [];
  const subOptions = categories.find((c) => c.name.toLowerCase() === form.category.trim().toLowerCase())?.children || [];

  if (meta.error) return <ErrorState error={meta.error} retry={meta.reload} />;
  if (meta.loading || (source.loading && !source.data && (isEdit || copyFrom))) return <Loading />;

  const rules = meta.data?.rules;
  const cbmRule = rules?.cbm?.auto ? fields.find((f) => f.key === rules.cbm.source && !f.calc) : null;
  const packingCbm = cbmRule ? cbmFromDimensions(form.specs[cbmRule.key], cbmRule.unit) : null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setSpec = (k) => (v) => {
    const specs = { ...form.specs, [k]: v };
    // CBM follows the packing size while it is blank or still equal to the old packing size's CBM.
    if (cbmRule && k === cbmRule.key && fields.some((f) => f.key === 'cbm')) {
      const next = cbmFromDimensions(v, cbmRule.unit);
      if (next !== null && (blank(form.specs.cbm) || sameNumber(form.specs.cbm, cbmFromDimensions(form.specs[k], cbmRule.unit)))) specs.cbm = String(next);
    }
    setForm({ ...form, specs });
  };
  // Calculated values as they will be saved (the server applies the same rules).
  const calculated = (f) => (f.calc === 'loadability' && rules ? calcLoadability(form.specs.cbm, rules.loadability) ?? '' : form.specs[f.key]);
  const hintFor = (f) => {
    if (f.calc === 'loadability' && rules) {
      return `${rules.loadability.units_per_cbm} pcs per 1 CBM ÷ this product’s CBM. Change the rule in Settings › Calculation rules.`;
    }
    if (f.key === 'cbm' && cbmRule) {
      if (blank(form.specs.cbm)) return `Leave blank to calculate from ${cbmRule.label}`;
      if (packingCbm !== null && !sameNumber(form.specs.cbm, packingCbm)) {
        return (
          <span>
            {cbmRule.label} gives {packingCbm} m³.{' '}
            <button type="button" className="link-btn" onClick={() => setForm({ ...form, specs: { ...form.specs, cbm: String(packingCbm) } })}>Use it</button>
          </span>
        );
      }
    }
    return !f.is_public ? 'Internal – not shown on the scan page' : undefined;
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        sku: form.sku.trim() || undefined,
        category: form.category.trim() || null,
        subcategory: form.subcategory.trim() || null,
        specs: Object.fromEntries(fields.filter((f) => !f.calc).map((f) => [f.key, form.specs[f.key] ?? null])),
      };
      let product;
      if (isEdit) {
        product = await api(`/products/${id}`, { method: 'PUT', body });
        if (product.skuChanged) toast.info('Product ID changed. Existing printed labels keep working; regenerate the code if you want new labels.');
      } else {
        if (Object.values(costing).some((v) => v !== '')) body.costing = costing;
        product = await api('/products', { method: 'POST', body });
        if (files.length) {
          const fd = new FormData();
          for (const f of files) fd.append('images', f);
          await api(`/products/${product.id}/images`, { method: 'POST', form: fd }).catch((err) => toast.error(`Images: ${err.message}`));
        }
      }
      toast.success(isEdit ? 'Product saved' : `Product ${product.sku} created`);
      navigate(`/products/${product.id}`);
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack-lg">
      <PageHeader
        crumbs={<><Link to="/products">Products</Link><span>/</span><span>{isEdit ? source.data?.sku : 'New'}</span></>}
        title={isEdit ? `Edit ${source.data?.name || 'product'}` : 'Add product'}
        subtitle={isEdit ? 'Changes are recorded in the product history.' : 'A QR code and barcode are generated automatically when you save.'}
        actions={
          <>
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="primary" type="submit" icon={Save} loading={busy}>{isEdit ? 'Save changes' : 'Create product'}</Button>
          </>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}

      <Card title="Basic information">
        <div className="form-grid">
          <Field label="Product ID / SKU" hint={isEdit ? 'Changing the ID keeps printed labels working.' : `Leave empty to generate ${nextSku.data?.sku || 'one automatically'}`}>
            <Input value={form.sku} onChange={set('sku')} placeholder={isEdit ? '' : nextSku.data?.sku} className="mono" maxLength={64} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set('status')} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'draft', label: 'Draft' }]} />
          </Field>
          <Field label="Product name" className="span-2">
            <Input value={form.name} onChange={set('name')} required maxLength={300} placeholder="e.g. Wooden Coffee Table" />
          </Field>
          <Field label="Category" hint="Pick one or type a new name">
            <Input list="cat-list" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, subcategory: '' })} placeholder="e.g. Tables" />
            <datalist id="cat-list">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Sub category">
            <Input list="sub-list" value={form.subcategory} onChange={set('subcategory')} disabled={!form.category.trim()} placeholder={form.category ? 'e.g. Coffee Tables' : 'Choose a category first'} />
            <datalist id="sub-list">{subOptions.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Description" className="span-2">
            <Textarea value={form.description} onChange={set('description')} rows={4} placeholder="Short description shown on the scan page and in catalogues" />
          </Field>
        </div>
      </Card>

      {groups.map(([group, list]) => (
        <Card key={group} title={group}>
          <div className="form-grid">
            {list.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`} className={f.type === 'textarea' ? 'span-2' : ''} hint={hintFor(f)}>
                <FieldInput field={f} value={f.calc ? calculated(f) : form.specs[f.key]} onChange={setSpec(f.key)} />
              </Field>
            ))}
          </div>
        </Card>
      ))}
      {can('settings.manage') && <p className="small muted" style={{ marginTop: -8 }}>Need another field? Add custom fields in <Link to="/settings?tab=fields">Settings › Product fields</Link>.</p>}

      {!isEdit && can('images.manage') && (
        <Card title="Images" icon={ImagePlus}>
          <div className="stack">
            <Dropzone accept="image/*" onFiles={(f) => setFiles((cur) => [...cur, ...f])} hint="The first image becomes the primary image" />
            {files.length > 0 && (
              <div className="row-wrap">
                {files.map((f, i) => (
                  <span className="chip" key={`${f.name}-${i}`}>
                    {f.name}
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><X /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {!isEdit && costFields.data && (
        <Card title="Costing (protected)" icon={Wallet} className="costing-card">
          <div className="form-grid">
            {costFields.data.fields.filter((f) => f.active && f.kind === 'input').map((f) => (
              <Field key={f.key} label={f.label}>
                <div className="input-group">
                  <Input inputMode="decimal" value={costing[f.key] ?? ''} onChange={(e) => setCosting({ ...costing, [f.key]: e.target.value })} />
                  <span className="addon">{f.type === 'percent' ? '%' : f.type === 'currency' ? (f.currency || branding?.currency) : f.unit || '#'}</span>
                </div>
              </Field>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>Constraints (USD rate, margins…) and calculated values (total costing, price) are applied automatically.</p>
        </Card>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="primary" type="submit" icon={Save} loading={busy}>{isEdit ? 'Save changes' : 'Create product'}</Button>
      </div>
    </form>
  );
}
