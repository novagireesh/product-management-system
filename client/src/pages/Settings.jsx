import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, Building2, Calculator, Database, Download, FolderTree, KeyRound, ListPlus, Pencil, Plus, QrCode, Save, ScanLine, ScrollText, Sigma, Smartphone, Trash2, Upload, UserRound, Wallet,
} from 'lucide-react';
import { Alert, Badge, Button, Card, Check, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Switch, Tabs, Textarea, useConfirm } from '../components/ui.jsx';
import { api, downloadUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtBytes, fmtDate } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import RulesTab from './settings/RulesTab.jsx';
import ScanPageTab from './settings/ScanPageTab.jsx';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'dimensions', label: 'Dimensions (L × W × H)' },
  { value: 'select', label: 'Dropdown list' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'date', label: 'Date' },
];

function CompanyTab({ settings, onSaved }) {
  const toast = useToast();
  const { setBranding } = useAuth();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const logoInput = useRef(null);
  useEffect(() => setForm(settings), [settings]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const keys = ['company_name', 'company_tagline', 'company_email', 'company_phone', 'company_whatsapp', 'company_website', 'company_address', 'brand_color', 'currency', 'catalogue_footer'];
  const save = async () => {
    setBusy(true);
    try {
      const s = await api('/settings', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, form[k] ?? ''])) });
      onSaved(s);
      setBranding({ company_name: s.company_name, brand_color: s.brand_color, currency: s.currency });
      toast.success('Company details saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const uploadLogo = async (file) => {
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const s = await api('/settings/logo', { method: 'POST', form: fd });
      onSaved(s);
      setBranding({ logo_url: s.logo_url });
      toast.success('Logo updated');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="stack-lg">
      <div className="row" style={{ gap: 18, alignItems: 'center' }}>
        <div style={{ width: 140, height: 80, borderRadius: 10, border: '1px dashed var(--border-strong)', display: 'grid', placeItems: 'center', background: '#fff', overflow: 'hidden' }}>
          {settings.logo_url ? <img src={settings.logo_url} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <Building2 className="muted" />}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div><strong>Company logo</strong><p className="small muted">Used on catalogues, labels, the scan page and the sidebar. PNG with transparent background works best.</p></div>
          <div className="row">
            <Button size="sm" icon={Upload} onClick={() => logoInput.current?.click()}>Upload logo</Button>
            {settings.logo_url && <Button size="sm" variant="ghost" onClick={async () => { const s = await api('/settings/logo', { method: 'DELETE' }); onSaved(s); setBranding({ logo_url: null }); }}>Remove</Button>}
          </div>
          <input ref={logoInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadLogo(f); }} />
        </div>
      </div>
      <div className="form-grid">
        <Field label="Company name"><Input value={form.company_name || ''} onChange={set('company_name')} /></Field>
        <Field label="Tagline"><Input value={form.company_tagline || ''} onChange={set('company_tagline')} /></Field>
        <Field label="Email"><Input type="email" value={form.company_email || ''} onChange={set('company_email')} /></Field>
        <Field label="Phone"><Input value={form.company_phone || ''} onChange={set('company_phone')} /></Field>
        <Field label="WhatsApp number" hint="International format, e.g. +91 98765 43210 — adds a WhatsApp button to scan pages"><Input value={form.company_whatsapp || ''} onChange={set('company_whatsapp')} /></Field>
        <Field label="Website"><Input value={form.company_website || ''} onChange={set('company_website')} placeholder="www.example.com" /></Field>
        <Field label="Address" className="span-2"><Textarea rows={2} value={form.company_address || ''} onChange={set('company_address')} /></Field>
        <Field label="Brand colour" hint="Catalogue covers, headers and the scan page">
          <div className="row">
            <input type="color" className="color-swatch" value={form.brand_color || '#1f3a5f'} onChange={set('brand_color')} aria-label="Brand colour" />
            <Input value={form.brand_color || ''} onChange={set('brand_color')} className="mono" style={{ maxWidth: 140 }} />
          </div>
        </Field>
        <Field label="Currency" hint="Used for costing and buyer prices"><Input value={form.currency || ''} onChange={set('currency')} maxLength={10} placeholder="USD" /></Field>
        <Field label="Catalogue footer text" className="span-2" hint="Replaces the contact line in catalogue footers, e.g. “Prices FOB Jodhpur · valid until 31 March”"><Input value={form.catalogue_footer || ''} onChange={set('catalogue_footer')} /></Field>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" icon={Save} onClick={save} loading={busy}>Save company details</Button></div>
    </div>
  );
}

function FieldModal({ field, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !field.key;
  const [form, setForm] = useState({
    label: field.label || '', type: field.type || 'text', options: (field.options || []).join(', '), unit: field.unit || '',
    group_name: field.group_name || 'Specifications', is_public: field.is_public ?? true, is_filterable: field.is_filterable ?? false,
    in_catalogue: field.in_catalogue ?? true, active: field.active ?? true,
  });
  const save = async () => {
    try {
      onSaved(await api(isNew ? '/settings/fields' : `/settings/fields/${field.key}`, { method: isNew ? 'POST' : 'PUT', body: form }));
      toast.success(isNew ? 'Field added' : 'Field saved');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add product field' : `Edit “${field.label}”`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!form.label.trim()}>Save field</Button></>}>
      <div className="stack">
        <Field label="Label"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Assembly Required" autoFocus /></Field>
        <div className="grid-2">
          <Field label="Type" hint={field.calc ? 'Calculated by the system (Settings › Calculation rules)' : form.type === 'dimensions' ? 'Shown as 120 × 45 × 80 followed by the unit' : undefined}>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={FIELD_TYPES} disabled={Boolean(field.calc)} />
          </Field>
          <Field label="Unit (optional)" hint={form.type === 'dimensions' ? 'e.g. CM — added after the sizes' : undefined}><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="cm, kg, pcs…" /></Field>
        </div>
        {form.type === 'select' && <Field label="Options" hint="Separate with commas"><Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Yes, No, Partial" /></Field>}
        <Field label="Group" hint="Fields are grouped under this heading on forms and product pages"><Input value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} list="field-groups" /></Field>
        <datalist id="field-groups">{['Specifications', 'Classification', 'Packing', 'Commercial', 'Production', 'Additional'].map((g) => <option key={g} value={g} />)}</datalist>
        <div className="stack" style={{ gap: 10 }}>
          <Switch label="Show on the public scan page (buyers & customers)" checked={form.is_public} onChange={(v) => setForm({ ...form, is_public: v })} />
          <Switch label="Show as a filter on the products page" checked={form.is_filterable} onChange={(v) => setForm({ ...form, is_filterable: v })} />
          <Switch label="Active (shown on forms)" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
        </div>
      </div>
    </Modal>
  );
}

function FieldsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const fields = useApi('/settings/fields');
  const cats = useApi('/settings/categories');
  const [editing, setEditing] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', parent_id: '' });
  if (!fields.data) return <Loading />;
  const list = fields.data;
  const move = async (i, dir) => {
    const keys = list.map((f) => f.key);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    await api('/settings/fields/order', { method: 'PUT', body: { keys } });
    fields.reload();
  };
  const remove = async (f) => {
    if (!(await confirm({ title: `Delete field “${f.label}”?`, message: `Its values on ${f.usage} product${f.usage === 1 ? '' : 's'} will be permanently deleted. To keep the data, deactivate the field instead.`, danger: true, confirmLabel: 'Delete field and values' }))) return;
    try {
      await api(`/settings/fields/${f.key}`, { method: 'DELETE' });
      fields.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const addCat = async () => {
    try {
      await api('/settings/categories', { method: 'POST', body: { name: newCat.name, parent_id: newCat.parent_id || null } });
      setNewCat({ name: '', parent_id: newCat.parent_id });
      cats.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const renameCat = async (c) => {
    const name = window.prompt('Rename category', c.name);
    if (!name || name === c.name) return;
    try {
      await api(`/settings/categories/${c.id}`, { method: 'PUT', body: { name } });
      cats.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const deleteCat = async (c) => {
    if (!(await confirm({ title: `Delete category “${c.name}”?`, message: `${c.product_count} product(s) will become uncategorised.`, danger: true, confirmLabel: 'Delete' }))) return;
    await api(`/settings/categories/${c.id}`, { method: 'DELETE' });
    cats.reload();
  };

  return (
    <div className="stack-lg">
      <div className="row between">
        <p className="muted">Add custom fields any time — they appear on product forms, filters, Excel import/export, scan pages and catalogues, without changing the application.</p>
        <Button variant="primary" icon={ListPlus} onClick={() => setEditing({})}>Add field</Button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Field</th><th>Type</th><th className="hide-sm">Group</th><th>Scan page</th><th className="hide-sm">Filter</th><th className="num hide-sm">Used by</th><th /></tr></thead>
            <tbody>
              {list.map((f, i) => (
                <tr key={f.key} style={f.active ? undefined : { opacity: 0.55 }}>
                  <td><div style={{ fontWeight: 600 }}>{f.label}{!f.active && <Badge>inactive</Badge>}{f.calc && <> <Badge tone="blue">calculated</Badge></>}</div><div className="tiny muted mono">{f.key}</div></td>
                  <td className="small">{FIELD_TYPES.find((t) => t.value === f.type)?.label}{f.unit ? ` (${f.unit})` : ''}</td>
                  <td className="hide-sm small">{f.group_name}</td>
                  <td>{f.is_public ? <Badge tone="green">Public</Badge> : <Badge>Internal</Badge>}</td>
                  <td className="hide-sm">{f.is_filterable ? 'Yes' : '—'}</td>
                  <td className="num hide-sm">{f.usage}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                    <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(f)} aria-label="Edit" />
                    {!f.calc && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(f)} aria-label="Delete" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Card title="Categories" icon={FolderTree}>
        <div className="stack">
          <div className="row-wrap">
            <Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="New category name" style={{ maxWidth: 260 }} onKeyDown={(e) => e.key === 'Enter' && newCat.name.trim() && addCat()} />
            <Select value={newCat.parent_id} onChange={(e) => setNewCat({ ...newCat, parent_id: e.target.value })} placeholder="Top-level category" style={{ maxWidth: 240 }}>
              {(cats.data || []).map((c) => <option key={c.id} value={c.id}>Sub category of {c.name}</option>)}
            </Select>
            <Button icon={Plus} onClick={addCat} disabled={!newCat.name.trim()}>Add</Button>
          </div>
          {(cats.data || []).length === 0 ? <p className="muted small">Categories are created automatically when you import or add products.</p> : (
            <div className="grid-3">
              {cats.data.map((c) => (
                <div key={c.id} className="card card-pad" style={{ padding: 12 }}>
                  <div className="row between">
                    <strong>{c.name} <span className="muted small">({c.product_count})</span></strong>
                    <span className="row" style={{ gap: 0 }}>
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => renameCat(c)} aria-label="Rename" />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => deleteCat(c)} aria-label="Delete" />
                    </span>
                  </div>
                  {c.children.map((s) => (
                    <div key={s.id} className="row between small" style={{ paddingLeft: 10 }}>
                      <span className="muted">› {s.name} ({s.product_count})</span>
                      <span className="row" style={{ gap: 0 }}>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => renameCat(s)} aria-label="Rename" />
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => deleteCat(s)} aria-label="Delete" />
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
      {editing && <FieldModal field={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); fields.reload(); }} />}
    </div>
  );
}

const KIND_LABEL = { constraint: 'Constraint', input: 'Entered per product', formula: 'Calculated' };
const KIND_TONE = { constraint: 'amber', input: 'blue', formula: undefined };

function CostingTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi('/costing/fields');
  const [editing, setEditing] = useState(null);
  if (!data) return <Loading />;
  const list = data.fields;
  const typeLabel = (f) => (f.type === 'currency' ? `Amount (${f.currency || data.currency})` : f.type === 'percent' ? 'Percentage' : `Number${f.unit ? ` (${f.unit})` : ''}`);
  const move = async (i, dir) => {
    const keys = list.map((f) => f.key);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    await api('/costing/fields/order', { method: 'PUT', body: { keys } });
    reload();
  };
  const save = async () => {
    try {
      const body = { ...editing, formula: editing.kind === 'formula' ? editing.formula : '' };
      await api(editing.key ? `/costing/fields/${editing.key}` : '/costing/fields', { method: editing.key ? 'PUT' : 'POST', body });
      setEditing(null);
      reload();
      toast.success('Costing structure saved');
    } catch (err) {
      toast.error(err);
    }
  };
  const remove = async (f) => {
    if (!(await confirm({ title: `Delete “${f.label}”?`, message: 'All values entered for this costing field will be deleted.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await api(`/costing/fields/${f.key}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const names = [...list.filter((f) => f.key !== editing?.key).map((f) => f.key), ...(data.contextKeys || [])];
  const blank = { label: '', type: 'currency', kind: 'input', formula: '', currency: '', unit: '', group_name: '', highlight: false, default_value: '' };
  return (
    <div className="stack-lg">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 4, maxWidth: 760 }}>
          <p className="muted">
            The costing structure mirrors your costing sheet. <strong>Constraints</strong> (USD rate, margins…) have one value for all products and can be
            changed in real time on the Costing page and on scan pages. <strong>Entered</strong> fields hold each product’s costs.
            <strong> Calculated</strong> fields use formulas such as <span className="mono">total_costing_inr / usd_rate</span>.
          </p>
          <p className="small muted">Formulas can also use numeric product fields: {(data.contextKeys || []).map((k) => <span key={k} className="mono">{k} </span>)}</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setEditing(blank)}>Add costing field</Button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Field</th><th>Kind</th><th>Type</th><th>Value / calculation</th><th /></tr></thead>
            <tbody>
              {list.map((f, i) => (
                <tr key={f.key} style={f.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{f.label} {f.highlight && <Badge tone="green">key result</Badge>}</div>
                    <div className="tiny muted"><span className="mono">{f.key}</span>{f.group_name ? ` · ${f.group_name}` : ''}</div>
                  </td>
                  <td><Badge tone={KIND_TONE[f.kind]}>{KIND_LABEL[f.kind]}</Badge></td>
                  <td className="small nowrap">{typeLabel(f)}</td>
                  <td>
                    {f.kind === 'formula' ? (
                      <span className="mono small"><Calculator size={12} style={{ verticalAlign: -2 }} /> {f.formula}</span>
                    ) : f.kind === 'constraint' ? (
                      <span className="small">Default: <strong>{f.default_value}</strong>{f.type === 'percent' ? '%' : f.unit ? ` ${f.unit}` : ''}</span>
                    ) : (
                      <span className="muted small">Entered for each product</span>
                    )}
                  </td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                    <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing({ ...f, formula: f.formula || '', currency: f.currency || '', unit: f.unit || '', group_name: f.group_name || '', default_value: f.default_value ?? '' })} aria-label="Edit" />
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(f)} aria-label="Delete" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing?.key ? `Edit “${editing.label}”` : 'Add costing field'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save} disabled={!editing?.label?.trim()}>Save</Button></>}
      >
        {editing && (
          <div className="stack">
            <div className="form-grid">
              <Field label="Label"><Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="e.g. Commission" autoFocus /></Field>
              <Field label="Kind">
                <Select
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                  options={[{ value: 'input', label: 'Entered per product' }, { value: 'constraint', label: 'Constraint (one value for all products)' }, { value: 'formula', label: 'Calculated (formula)' }]}
                />
              </Field>
              <Field label="Type">
                <Select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })} options={[{ value: 'currency', label: 'Amount' }, { value: 'percent', label: 'Percentage' }, { value: 'number', label: 'Number' }]} />
              </Field>
              {editing.type === 'currency' ? (
                <Field label="Currency" hint={`Empty = company currency (${data.currency})`}><Input value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} placeholder="INR, USD…" maxLength={10} /></Field>
              ) : (
                <Field label="Unit (optional)"><Input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="₹ per US$, CBM, SFT…" /></Field>
              )}
              {editing.kind === 'constraint' && (
                <Field label="Default value" hint="Used for every product unless it has its own value"><Input inputMode="decimal" value={editing.default_value} onChange={(e) => setEditing({ ...editing, default_value: e.target.value })} /></Field>
              )}
              <Field label="Group" hint="Heading the field is shown under"><Input value={editing.group_name} onChange={(e) => setEditing({ ...editing, group_name: e.target.value })} list="cost-groups" /></Field>
              <datalist id="cost-groups">{['Constraints', 'Material & Labour', 'Hardware & Fittings', 'Calculation', 'Result'].map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            {editing.kind === 'formula' && (
              <>
                <Field label="Formula" hint="Use field keys with + − × ÷ and brackets.">
                  <Input className="mono" value={editing.formula} onChange={(e) => setEditing({ ...editing, formula: e.target.value })} placeholder="e.g. total_costing_inr / usd_rate" />
                </Field>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {names.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="badge"
                      style={{ border: 0, cursor: 'pointer' }}
                      onClick={() => setEditing({ ...editing, formula: `${editing.formula}${editing.formula && !/[\s(+\-*/]$/.test(editing.formula) ? ' + ' : ''}${k}` })}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </>
            )}
            <Switch label="Key result (shown in the summary at the top of costing screens)" checked={editing.highlight} onChange={(v) => setEditing({ ...editing, highlight: v })} />
            {editing.key && <Switch label="Active" checked={editing.active !== false} onChange={(v) => setEditing({ ...editing, active: v })} />}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ScanTab({ settings, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ public_base_url: settings.public_base_url || '', barcode_type: settings.barcode_type, sku_prefix: settings.sku_prefix ?? '', sku_next: settings.sku_next });
  const [pin, setPin] = useState('');
  const save = async () => {
    try {
      onSaved(await api('/settings', { method: 'PUT', body: form }));
      toast.success('Saved');
    } catch (err) {
      toast.error(err);
    }
  };
  const savePin = async (value) => {
    try {
      onSaved(await api('/settings/costing-pin', { method: 'PUT', body: { pin: value } }));
      setPin('');
      toast.success(value ? 'Costing PIN set' : 'PIN access disabled');
    } catch (err) {
      toast.error(err);
    }
  };
  const local = /localhost|127\.0\.0\.1/.test(settings.effective_base_url);
  return (
    <div className="stack-lg">
      <Card title="QR code address" icon={Smartphone}>
        <div className="stack">
          <p className="muted">QR codes on labels open <span className="mono">{settings.effective_base_url}/p/&lt;code&gt;</span>. Phones must be able to reach this address.</p>
          {local && <Alert tone="warn">Phones cannot open “localhost”. Choose your computer’s network address below, or your public domain if the app is hosted online.</Alert>}
          <Field label="Public address" hint="Leave empty to use this computer’s network address automatically. Use https://your-domain when hosted on a server.">
            <Input value={form.public_base_url} onChange={(e) => setForm({ ...form, public_base_url: e.target.value })} placeholder={settings.effective_base_url} className="mono" />
          </Field>
          {settings.lan_addresses.length > 0 && (
            <div className="row-wrap small">
              <span className="muted">Network addresses of this computer:</span>
              {settings.lan_addresses.map((a) => <button key={a} type="button" className="badge badge-blue" style={{ border: 0, cursor: 'pointer' }} onClick={() => setForm({ ...form, public_base_url: a })}>{a}</button>)}
            </div>
          )}
          <Alert tone="info">Changing this address changes what newly printed QR codes contain. Labels printed earlier keep pointing at the old address.</Alert>
        </div>
      </Card>
      <Card title="Product IDs & barcodes" icon={QrCode}>
        <div className="form-grid">
          <Field label="Automatic Product ID prefix" hint="Used when a product is created without an ID"><Input value={form.sku_prefix} onChange={(e) => setForm({ ...form, sku_prefix: e.target.value })} className="mono" /></Field>
          <Field label="Next number"><Input type="number" min={1} value={form.sku_next} onChange={(e) => setForm({ ...form, sku_next: e.target.value })} /></Field>
          <Field label="Barcode format" hint="Code 128 supports letters, numbers and symbols and suits most scanners">
            <Select value={form.barcode_type} onChange={(e) => setForm({ ...form, barcode_type: e.target.value })} options={Object.entries(settings.barcode_types).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><Button variant="primary" icon={Save} onClick={save}>Save</Button></div>
      </Card>
      <Card title="Visitor details on scan pages" icon={UserRound}>
        <div className="stack">
          <p className="muted">When someone who is not signed in scans a product, they can be invited to share their name, email and mobile number. Sharing is always optional: they can skip and view the product. Submitted details appear under Sales &rsaquo; Scan Visitors.</p>
          <Switch
            label="Ask unknown visitors for their details (optional for them)"
            checked={settings.visitor_prompt !== false}
            onChange={async (v) => {
              try {
                onSaved(await api('/settings', { method: 'PUT', body: { visitor_prompt: v } }));
                toast.success(v ? 'Visitors will be asked for their details' : 'Visitor prompt turned off');
              } catch (err) {
                toast.error(err);
              }
            }}
          />
        </div>
      </Card>
      <Card title="Costing access on scan pages" icon={KeyRound}>
        <div className="stack">
          <p className="muted">“View costing” on a scanned product always requires authorisation. Signed-in users with costing permission see it directly; others can sign in on the spot. Optionally allow a shared PIN as well.</p>
          <div className="row"><strong>PIN access:</strong> {settings.costing_pin_enabled ? <Badge tone="green" dot>Enabled</Badge> : <Badge dot>Disabled</Badge>}</div>
          <div className="row-wrap">
            <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4–12 digit PIN" style={{ maxWidth: 200 }} autoComplete="new-password" aria-label="New costing PIN" />
            <Button icon={KeyRound} onClick={() => savePin(pin)} disabled={pin.length < 4}>{settings.costing_pin_enabled ? 'Change PIN' : 'Enable PIN'}</Button>
            {settings.costing_pin_enabled && <Button variant="ghost" onClick={() => savePin(null)}>Disable PIN</Button>}
          </div>
          <p className="tiny muted">PIN attempts are rate-limited and every costing view is recorded in the activity log.</p>
        </div>
      </Card>
    </div>
  );
}

function SystemTab() {
  const sys = useApi('/settings/system');
  const logs = useApi('/settings/logs', { query: { limit: 100 } });
  return (
    <div className="stack-lg">
      <Card title="Backup" icon={Database}>
        <div className="stack">
          <p className="muted">Download a ZIP containing the complete database and all product images and logos. Keep backups somewhere safe (another drive or cloud storage).</p>
          <div><Button variant="primary" icon={Download} onClick={() => downloadUrl('/settings/backup')}>Download backup</Button></div>
          <p className="tiny muted">To restore: stop the server, replace the data folder’s app.db and uploads folder with the ones from the backup, then start the server again.</p>
        </div>
      </Card>
      {sys.data && (
        <Card title="System" icon={Database}>
          <dl className="spec-list">
            {[
              ['Data folder', <span className="mono small" key="d">{sys.data.dataDir}</span>],
              ['Database size', fmtBytes(sys.data.dbBytes)],
              ['Images & logos', fmtBytes(sys.data.uploadsBytes)],
              ['Generated catalogues', fmtBytes(sys.data.cataloguesBytes)],
              ['Products / images', `${sys.data.counts.products} / ${sys.data.counts.images}`],
              ['History entries', sys.data.counts.history],
              ['Node.js', sys.data.node],
              ['Uptime', `${Math.floor(sys.data.uptimeSeconds / 3600)} h ${Math.floor((sys.data.uptimeSeconds % 3600) / 60)} min`],
            ].map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </Card>
      )}
      <Card title="Recent log entries" icon={ScrollText} pad={false}>
        {logs.data?.length ? (
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="table table-compact">
              <tbody>
                {logs.data.map((l, i) => (
                  <tr key={i}>
                    <td className="nowrap tiny muted">{fmtDate(l.time, true)}</td>
                    <td><Badge tone={l.level === 'error' ? 'red' : l.level === 'warn' ? 'amber' : undefined}>{l.level}</Badge></td>
                    <td className="small mono" style={{ overflowWrap: 'anywhere' }}>{l.message}{l.url ? ` (${l.url})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card-body muted">No log entries.</div>}
      </Card>
    </div>
  );
}

export default function Settings() {
  useTitle('Settings');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'company';
  const { data, error, loading, reload, setData } = useApi('/settings');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="stack-lg">
      <PageHeader title="Settings" subtitle="Company branding, product fields, calculation rules, costing, the QR scan page, scanning and backups." />
      <div className="card">
        <Tabs
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          tabs={[
            { value: 'company', label: 'Company & branding', icon: Building2 },
            { value: 'fields', label: 'Product fields', icon: ListPlus },
            { value: 'rules', label: 'Calculation rules', icon: Sigma },
            { value: 'costing', label: 'Costing structure', icon: Wallet },
            { value: 'scanpage', label: 'QR scan page', icon: ScanLine },
            { value: 'scan', label: 'Scanning & security', icon: QrCode },
            { value: 'system', label: 'Backup & system', icon: Database },
          ]}
        />
        <div className="card-body">
          {tab === 'company' && <CompanyTab settings={data} onSaved={setData} />}
          {tab === 'fields' && <FieldsTab />}
          {tab === 'rules' && <RulesTab settings={data} onSaved={setData} />}
          {tab === 'costing' && <CostingTab />}
          {tab === 'scanpage' && <ScanPageTab settings={data} onSaved={setData} />}
          {tab === 'scan' && <ScanTab settings={data} onSaved={setData} />}
          {tab === 'system' && <SystemTab />}
        </div>
      </div>
    </div>
  );
}
