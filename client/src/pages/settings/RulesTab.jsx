import { useEffect, useState } from 'react';
import { Box, Calculator, Save } from 'lucide-react';
import { Alert, Button, Card, Field, Input, Select, Switch } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { LOADABILITY_ROUNDING, calcLoadability, cbmFromDimensions } from '../../lib/fields.js';
import { useApi } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';

/** Settings › Calculation rules: loadability per product and CBM from the packing size. */
export default function RulesTab({ settings, onSaved }) {
  const toast = useToast();
  const fields = useApi('/settings/fields');
  const [form, setForm] = useState(settings.calc_rules);
  const [sample, setSample] = useState({ cbm: '0.705375', packing: '140X40X8, 59X32X81' });
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(settings.calc_rules), [settings.calc_rules]);

  const l = form.loadability;
  const c = form.cbm;
  const per = Number(l.units_per_cbm);
  const valid = Number.isFinite(per) && per > 0;
  const sourceOptions = (fields.data || []).filter((f) => !f.calc && (f.type === 'dimensions' || f.type === 'text'));
  const sourceField = sourceOptions.find((f) => f.key === c.source);
  const changed = JSON.stringify(form) !== JSON.stringify(settings.calc_rules);
  const sampleLoad = valid ? calcLoadability(sample.cbm, { ...l, units_per_cbm: per }) : null;
  const samplePackCbm = cbmFromDimensions(sample.packing, sourceField?.unit);

  const save = async () => {
    setBusy(true);
    try {
      const s = await api('/settings/rules', { method: 'PUT', body: { loadability: { ...l, units_per_cbm: per }, cbm: c } });
      onSaved(s);
      toast.success(`Rules saved · ${s.recalculated} product${s.recalculated === 1 ? '' : 's'} recalculated`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <p className="muted" style={{ maxWidth: 820 }}>
        System calculations applied to every product. Results are saved with the product, so the product list, product pages,
        Excel export, catalogues and QR scan pages always show the same numbers. Changing a rule recalculates all products.
      </p>

      <Card title="Loadability per product" icon={Box}>
        <div className="stack">
          <p className="small muted">How many pieces of a product fit into one container: <strong>units per CBM ÷ the product’s CBM</strong>.</p>
          <div className="form-grid">
            <Field label="Units per 1 CBM" hint="e.g. 65 — a 1 CBM product loads 65 pcs (one 40 ft container holds about 65 CBM)">
              <div className="input-group">
                <Input inputMode="decimal" value={l.units_per_cbm} onChange={(e) => setForm({ ...form, loadability: { ...l, units_per_cbm: e.target.value } })} />
                <span className="addon">pcs / CBM</span>
              </div>
            </Field>
            <Field label="Rounding">
              <Select value={l.rounding} onChange={(e) => setForm({ ...form, loadability: { ...l, rounding: e.target.value } })} options={LOADABILITY_ROUNDING} />
            </Field>
          </div>
          {!valid && <Alert tone="error">Units per CBM must be a number greater than 0.</Alert>}
          <div className="rule-example">
            <span className="muted small">Try it:</span>
            <span className="row" style={{ gap: 6 }}>
              <Input size="sm" inputMode="decimal" value={sample.cbm} onChange={(e) => setSample({ ...sample, cbm: e.target.value })} style={{ width: 110 }} aria-label="Sample CBM" />
              <span className="small">CBM →</span>
              <strong>{sampleLoad === null ? '—' : `${sampleLoad} pcs`}</strong>
              {valid && Number(sample.cbm) > 0 && <span className="tiny muted">({per} ÷ {sample.cbm} = {(per / Number(sample.cbm)).toFixed(2)})</span>}
            </span>
          </div>
          {settings.costing_container_cbm !== null && valid && Number(settings.costing_container_cbm) !== per && (
            <Alert tone="info">
              Costing uses its own container capacity of {settings.costing_container_cbm} CBM (Settings › Costing structure) to share polish,
              packing and freight per container. It is separate from this rule.
            </Alert>
          )}
        </div>
      </Card>

      <Card title="CBM from packing size" icon={Calculator}>
        <div className="stack">
          <Switch label="Calculate CBM automatically when it is left blank" checked={c.auto} onChange={(v) => setForm({ ...form, cbm: { ...c, auto: v } })} />
          <p className="small muted">
            CBM = the sum of L × W × H of every box in the size field, converted to m³ (cm ÷ 1,000,000). A CBM calculated this way keeps
            following the packing size when it changes; a CBM typed in yourself is never overwritten.
          </p>
          <div className="form-grid">
            <Field label="Calculate from">
              <Select value={c.source} onChange={(e) => setForm({ ...form, cbm: { ...c, source: e.target.value } })} disabled={!c.auto}
                options={sourceOptions.map((f) => ({ value: f.key, label: `${f.label}${f.unit ? ` (${f.unit})` : ''}` }))} />
            </Field>
            <Field label="Try it" hint={samplePackCbm === null ? 'Enter sizes like 165X45X95, one set per box' : `= ${samplePackCbm} m³`}>
              <Input value={sample.packing} onChange={(e) => setSample({ ...sample, packing: e.target.value })} className="mono" />
            </Field>
          </div>
        </div>
      </Card>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {changed && <span className="small muted">Saving recalculates all products.</span>}
        <Button variant="primary" icon={Save} onClick={save} loading={busy} disabled={!valid || !changed}>Save rules</Button>
      </div>
    </div>
  );
}
