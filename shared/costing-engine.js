// Costing formula engine, shared by the server and the browser so that stored costing,
// exports and the real-time "what-if" screens always calculate exactly the same way.
//
// Field kinds:
//   input       a value entered per product (e.g. wood cost, wages)
//   constraint  a parameter with a default for all products, optionally overridden per product
//               (e.g. USD conversion rate, margin %)
//   formula     calculated from other fields, constraints and numeric product fields (e.g. cbm)

export const FIELD_KINDS = ['input', 'constraint', 'formula'];

export const kindOf = (f) => (f.formula ? 'formula' : f.kind === 'constraint' ? 'constraint' : 'input');

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([a-z_][a-z0-9_]*)|([-+*/()]))/giy;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`Unexpected character "${src.slice(pos).trim()[0]}"`);
    }
    if (m[1]) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) tokens.push({ t: 'id', v: m[2].toLowerCase() });
    else if (m[3]) tokens.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Compile a formula (numbers, field keys, + - * / and parentheses) into RPN. Throws on syntax errors. */
export function compileFormula(src) {
  const tokens = tokenize(String(src || ''));
  if (!tokens.length) throw new Error('Formula is empty');
  const out = [];
  const ops = [];
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3 };
  let prev = null;
  for (const tok of tokens) {
    if (tok.t === 'num' || tok.t === 'id') {
      out.push(tok);
    } else if (tok.v === '(') {
      ops.push(tok);
    } else if (tok.v === ')') {
      while (ops.length && ops.at(-1).v !== '(') out.push(ops.pop());
      if (!ops.length) throw new Error('Mismatched parentheses');
      ops.pop();
    } else {
      const prefix = !prev || (prev.t === 'op' && prev.v !== ')');
      if (prefix && tok.v === '+') {
        prev = tok;
        continue; // unary plus
      }
      const op = prefix && tok.v === '-' ? { t: 'op', v: 'neg' } : tok;
      while (ops.length && ops.at(-1).v !== '(' && op.v !== 'neg' && prec[ops.at(-1).v] >= prec[op.v]) out.push(ops.pop());
      ops.push(op);
    }
    prev = tok;
  }
  while (ops.length) {
    const op = ops.pop();
    if (op.v === '(') throw new Error('Mismatched parentheses');
    out.push(op);
  }
  let depth = 0;
  for (const tok of out) {
    if (tok.t !== 'op') depth++;
    else if (tok.v === 'neg') {
      if (depth < 1) throw new Error('Invalid formula');
    } else {
      if (depth < 2) throw new Error('Invalid formula');
      depth--;
    }
  }
  if (depth !== 1) throw new Error('Invalid formula');
  return out;
}

export const formulaRefs = (src) => [...new Set(compileFormula(src).filter((t) => t.t === 'id').map((t) => t.v))];

function evalRpn(rpn, lookup) {
  const st = [];
  for (const tok of rpn) {
    if (tok.t === 'num') st.push(tok.v);
    else if (tok.t === 'id') st.push(lookup(tok.v));
    else if (tok.v === 'neg') {
      const a = st.pop();
      st.push(a === null ? null : -a);
    } else {
      const b = st.pop();
      const a = st.pop();
      if (a === null || b === null) st.push(null);
      else if (tok.v === '+') st.push(a + b);
      else if (tok.v === '-') st.push(a - b);
      else if (tok.v === '*') st.push(a * b);
      else st.push(b === 0 ? null : a / b);
    }
  }
  const r = st.pop();
  return r === null || r === undefined || !Number.isFinite(r) ? null : Math.round(r * 1e6) / 1e6;
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Calculate every costing field for one product.
 * @param fields  costing field definitions [{ key, kind, formula, default_value }]
 * @param inputs  the product's stored values: inputs and constraint overrides { key: number }
 * @param context extra numeric variables formulas may use, e.g. product fields { cbm: 0.7 }
 * @returns { key: number|null }
 *
 * A product without any input values gets no calculated results (so a price is never shown
 * from constraints alone). Inside a formula, a missing value counts as 0 unless every value
 * the formula refers to is missing.
 */
export function computeCosting(fields, inputs = {}, context = {}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const hasInput = fields.some((f) => kindOf(f) === 'input' && num(inputs[f.key]) !== null);
  const result = {};
  const visiting = new Set();
  const compiled = new Map();

  const resolve = (key) => {
    if (key in result) return result[key];
    const f = byKey.get(key);
    if (!f) return num(context[key]);
    const kind = kindOf(f);
    if (kind === 'input') return (result[key] = num(inputs[key]));
    if (kind === 'constraint') return (result[key] = num(inputs[key]) ?? num(f.default_value));
    if (!hasInput || visiting.has(key)) return (result[key] = null);
    visiting.add(key);
    try {
      if (!compiled.has(key)) compiled.set(key, compileFormula(f.formula));
      const rpn = compiled.get(key);
      const refs = rpn.filter((t) => t.t === 'id').map((t) => t.v);
      const values = refs.map(resolve);
      result[key] = values.length && values.every((v) => v === null) ? null : evalRpn(rpn, (k) => resolve(k) ?? 0);
    } catch {
      result[key] = null;
    } finally {
      visiting.delete(key);
    }
    return result[key];
  };
  for (const f of fields) resolve(f.key);
  return result;
}

/** Throws an Error if a formula is invalid, refers to unknown names, or creates a cycle. */
export function validateFormula(key, formula, fields, contextKeys = []) {
  const refs = formulaRefs(formula);
  const known = new Set([...fields.map((f) => f.key), ...contextKeys]);
  for (const r of refs) if (!known.has(r) && r !== key) throw new Error(`Formula refers to unknown field "${r}"`);
  if (refs.includes(key)) throw new Error('A formula cannot refer to itself');
  const safeRefs = (f) => {
    try {
      return formulaRefs(f);
    } catch {
      return [];
    }
  };
  const graph = new Map(fields.map((f) => [f.key, f.key === key ? refs : f.formula ? safeRefs(f.formula) : []]));
  if (!graph.has(key)) graph.set(key, refs);
  const done = new Set();
  const walk = (k, stack) => {
    if (stack.has(k)) throw new Error('Formula creates a circular reference');
    if (done.has(k)) return;
    stack.add(k);
    for (const r of graph.get(k) || []) walk(r, stack);
    stack.delete(k);
    done.add(k);
  };
  walk(key, new Set());
}
