import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calculator, ChevronDown, ChevronUp, FlaskConical, Info, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { computeCosting, fieldAffix, fmtCostValue, groupFields, parseInputNumber, sameNumber } from '../lib/costing.js';
import { fmtDate } from '../lib/format.js';
import { Alert, Button, Modal, Select } from './ui.jsx';

const masterValueOf = (f, inputs) => (f.kind === 'constraint' ? inputs[f.key] ?? f.default_value ?? null : inputs[f.key] ?? null);
const toDraft = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 1e6) / 1e6));

function NumberInput({ field, value, onChange, changed, currency, label }) {
  const { prefix, suffix } = fieldAffix(field, currency);
  return (
    <div className={`sim-input ${changed ? 'changed' : ''}`}>
      {prefix && <span className="affix">{prefix}</span>}
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" aria-label={label || field.label} />
      {suffix && <span className="affix">{suffix}</span>}
    </div>
  );
}

function Delta({ field, from, to, currency }) {
  if (sameNumber(from, to)) return null;
  const up = (to ?? 0) > (from ?? 0);
  const diff = (to ?? 0) - (from ?? 0);
  return (
    <span className={`sim-delta ${up ? 'up' : 'down'}`}>
      {up ? '+' : '−'}{fmtCostValue(field, Math.abs(diff), currency).replace(/^-/, '')}
    </span>
  );
}

/**
 * Real-time costing: shows constraints and inputs with their current (master) values, lets the
 * user change them and recalculates instantly with the same engine the server uses.
 * Nothing is stored unless the user explicitly saves.
 */
export default function CostingSimulator({ data, onSave, compact = false }) {
  const fields = data.fields;
  const currency = data.currency;
  const editable = useMemo(() => fields.filter((f) => f.kind !== 'formula'), [fields]);
  const master = useMemo(() => Object.fromEntries(editable.map((f) => [f.key, masterValueOf(f, data.inputs)])), [editable, data.inputs]);
  const initialDraft = useMemo(() => Object.fromEntries(editable.map((f) => [f.key, toDraft(master[f.key])])), [editable, master]);
  const [draft, setDraft] = useState(initialDraft);
  const [showSteps, setShowSteps] = useState(!compact);
  const [saving, setSaving] = useState(null);
  useEffect(() => setDraft(initialDraft), [initialDraft]);

  const draftNums = useMemo(() => Object.fromEntries(editable.map((f) => [f.key, parseInputNumber(draft[f.key])])), [editable, draft]);
  const masterValues = useMemo(() => computeCosting(fields, data.inputs, data.context), [fields, data.inputs, data.context]);
  const liveValues = useMemo(() => computeCosting(fields, draftNums, data.context), [fields, draftNums, data.context]);
  const changedKeys = editable.filter((f) => !sameNumber(draftNums[f.key], master[f.key])).map((f) => f.key);
  const dirty = changedKeys.length > 0;

  const constraints = editable.filter((f) => f.kind === 'constraint');
  const inputs = editable.filter((f) => f.kind === 'input');
  const formulas = fields.filter((f) => f.kind === 'formula');
  const highlights = fields.filter((f) => f.highlight);
  const canSave = Boolean(onSave) && (data.can_edit || data.can_edit_defaults);

  const set = (key) => (v) => setDraft((d) => ({ ...d, [key]: v }));

  return (
    <div className="sim">
      <div className="sim-results">
        {highlights.map((f) => {
          const live = liveValues[f.key];
          const before = masterValues[f.key];
          const changed = !sameNumber(live, before);
          return (
            <div key={f.key} className={`sim-result ${changed ? 'changed' : ''}`}>
              <div className="k">{f.label}</div>
              <div className="v">{fmtCostValue(f, live, currency)}</div>
              {changed && (
                <div className="was">
                  was {fmtCostValue(f, before, currency)} <Delta field={f} from={before} to={live} currency={currency} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dirty ? (
        <div className="sim-banner">
          <FlaskConical size={18} />
          <div className="grow">
            <strong>Temporary calculation</strong>
            <div className="small">{changedKeys.length} value{changedKeys.length === 1 ? '' : 's'} changed. The saved (master) costing is unchanged.</div>
          </div>
          <Button size="sm" icon={RotateCcw} onClick={() => setDraft(initialDraft)}>Reset</Button>
          {canSave && <Button size="sm" variant="primary" icon={Save} onClick={() => setSaving(true)}>Save…</Button>}
        </div>
      ) : (
        <p className="small muted row" style={{ alignItems: 'flex-start' }}>
          <SlidersHorizontal size={14} style={{ flexShrink: 0, marginTop: 3 }} />
          Change any constraint or cost below to see the costing recalculate instantly. Changes are temporary unless you save them.
        </p>
      )}

      <section className="sim-section">
        <h4><SlidersHorizontal size={15} /> Costing constraints</h4>
        {constraints.map((f) => (
          <div key={f.key} className="sim-row">
            <div className="sim-label">
              <div>{f.label}{data.inputs[f.key] !== undefined && <span className="tiny muted"> · product-specific</span>}</div>
              {f.description && !compact && <div className="tiny muted">{f.description}</div>}
            </div>
            <div className="sim-master">
              {changedKeys.includes(f.key) ? (
                <span className="row" style={{ gap: 4 }}>{fmtCostValue(f, master[f.key], currency)}<ArrowRight size={12} /></span>
              ) : null}
            </div>
            <NumberInput field={f} value={draft[f.key]} onChange={set(f.key)} changed={changedKeys.includes(f.key)} currency={currency} />
          </div>
        ))}
      </section>

      {groupFields(inputs).map(([group, list]) => (
        <section key={group} className="sim-section">
          <h4>{group}</h4>
          {list.map((f) => (
            <div key={f.key} className="sim-row">
              <div className="sim-label"><div>{f.label}</div>{f.description && !compact && <div className="tiny muted">{f.description}</div>}</div>
              <div className="sim-master">
                {changedKeys.includes(f.key) ? <span className="row" style={{ gap: 4 }}>{fmtCostValue(f, master[f.key], currency)}<ArrowRight size={12} /></span> : null}
              </div>
              <NumberInput field={f} value={draft[f.key]} onChange={set(f.key)} changed={changedKeys.includes(f.key)} currency={currency} />
            </div>
          ))}
        </section>
      ))}

      <section className="sim-section">
        <button type="button" className="sim-toggle" onClick={() => setShowSteps((s) => !s)}>
          <Calculator size={15} /> Calculation steps {showSteps ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {showSteps && formulas.map((f) => {
          const changed = !sameNumber(liveValues[f.key], masterValues[f.key]);
          return (
            <div key={f.key} className={`sim-step ${f.highlight ? 'strong' : ''}`}>
              <span className="grow" title={f.formula}>{f.label}</span>
              {changed && <span className="muted small nowrap" style={{ textDecoration: 'line-through' }}>{fmtCostValue(f, masterValues[f.key], currency)}</span>}
              <span className={`nowrap ${changed ? 'sim-new' : ''}`}>{fmtCostValue(f, liveValues[f.key], currency)}</span>
            </div>
          );
        })}
      </section>

      {data.updated_at && <p className="tiny muted">Master costing last saved {fmtDate(data.updated_at, true)}{data.updated_by ? ` by ${data.updated_by}` : ''}</p>}
      {!data.has_costing && !dirty && <Alert icon={Info}>No costing has been entered for this product yet. Enter the costs above to calculate a price.</Alert>}

      {saving && (
        <SaveDialog
          fields={editable.filter((f) => changedKeys.includes(f.key))}
          master={master}
          draftNums={draftNums}
          data={data}
          currency={currency}
          onClose={() => setSaving(null)}
          onSave={async (payload) => {
            await onSave(payload);
            setSaving(null);
          }}
        />
      )}
    </div>
  );
}

function SaveDialog({ fields, master, draftNums, data, currency, onClose, onSave }) {
  const [scope, setScope] = useState(() => Object.fromEntries(fields.filter((f) => f.kind === 'constraint').map((f) => [f.key, data.can_edit ? 'product' : 'all'])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputFields = fields.filter((f) => f.kind === 'input');
  const constraintFields = fields.filter((f) => f.kind === 'constraint');

  const save = async () => {
    const values = {};
    const defaults = {};
    for (const f of inputFields) values[f.key] = draftNums[f.key];
    for (const f of constraintFields) {
      const v = draftNums[f.key];
      if (scope[f.key] === 'all') {
        defaults[f.key] = v ?? f.default_value;
        if (data.inputs[f.key] !== undefined && data.can_edit) values[f.key] = null; // follow the new default
      } else {
        values[f.key] = v === null || sameNumber(v, f.default_value) ? null : v;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ values, defaults });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const blocked = (inputFields.length > 0 && !data.can_edit) || constraintFields.some((f) => scope[f.key] === 'product' && !data.can_edit);
  return (
    <Modal
      open
      onClose={onClose}
      title="Save costing changes"
      footer={<><Button onClick={onClose}>Keep as temporary</Button><Button variant="primary" icon={Save} onClick={save} loading={busy} disabled={blocked}>Save changes</Button></>}
    >
      <div className="stack">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="muted small">Saving updates the master costing. Every change is recorded in the product history.</p>
        {inputFields.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>This product’s costs</div>
            {inputFields.map((f) => (
              <div key={f.key} className="cost-row">
                <span>{f.label}</span>
                <span className="small">{fmtCostValue(f, master[f.key], currency)} → <strong>{fmtCostValue(f, draftNums[f.key], currency)}</strong></span>
              </div>
            ))}
            {!data.can_edit && <Alert tone="warn">Your role cannot save product costing.</Alert>}
          </div>
        )}
        {constraintFields.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Constraints</div>
            {constraintFields.map((f) => (
              <div key={f.key} className="cost-row" style={{ flexWrap: 'wrap' }}>
                <span>
                  {f.label}: {fmtCostValue(f, master[f.key], currency)} → <strong>{fmtCostValue(f, draftNums[f.key] ?? f.default_value, currency)}</strong>
                </span>
                <Select size="sm" value={scope[f.key]} onChange={(e) => setScope({ ...scope, [f.key]: e.target.value })} style={{ width: 'auto' }} aria-label={`Apply ${f.label} to`}>
                  {data.can_edit && <option value="product">This product only</option>}
                  {data.can_edit_defaults && <option value="all">All products (new default)</option>}
                </Select>
              </div>
            ))}
            {constraintFields.some((f) => scope[f.key] === 'all') && (
              <Alert tone="warn">Changing a default recalculates the costing of every product that does not have its own value.</Alert>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
