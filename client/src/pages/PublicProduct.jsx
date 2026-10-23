import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, ImageOff, Lock, Mail, MessageCircle, PackageX, ShieldCheck, UserRound, X } from 'lucide-react';
import CostingSimulator from '../components/CostingSimulator.jsx';
import { Alert, Button, Field, Input, Loading, Segmented } from '../components/ui.jsx';
import { api } from '../lib/api.js';

// Visitor details are optional. A token is kept in this browser after sharing them so the
// visitor is not asked again; "Skip" hides the prompt for a while.
const TOKEN_KEY = 'pm.visitor.token';
const SKIP_KEY = 'pm.visitor.skippedAt';
const SKIP_HOURS = 12;
const storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch { /* private mode */ }
  },
};
const recentlySkipped = () => Date.now() - Number(storage.get(SKIP_KEY) || 0) < SKIP_HOURS * 3600 * 1000;

function Gallery({ images }) {
  const ref = useRef(null);
  const [idx, setIdx] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
  };
  if (!images.length) {
    return <div className="pub-slide" style={{ color: 'var(--text-4)' }}><ImageOff size={40} /></div>;
  }
  return (
    <>
      <div className="pub-slides" ref={ref} onScroll={onScroll}>
        {images.map((img, i) => (
          <div className="pub-slide" key={img.id}><img src={img.url} alt="" loading={i ? 'lazy' : 'eager'} /></div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="pub-dots">
          {images.map((img, i) => (
            <span key={img.id} className={i === idx ? 'on' : ''} />
          ))}
        </div>
      )}
    </>
  );
}

function VisitorPrompt({ code, company, onDone }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const skip = () => {
    storage.set(SKIP_KEY, String(Date.now()));
    onDone(null);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() && !form.email.trim() && !form.phone.trim()) return skip();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/public/visitors', { method: 'POST', body: { ...form, code } });
      storage.set(TOKEN_KEY, r.token);
      onDone(form.name.trim() || 'there');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" style={{ alignItems: 'center' }}>
      <div className="modal visitor-card" role="dialog" aria-modal="true" aria-labelledby="visitor-title">
        <div className="modal-head">
          <h2 id="visitor-title" className="row"><UserRound size={19} /> Welcome to {company}</h2>
          <Button variant="ghost" size="sm" icon={X} onClick={skip} aria-label="Skip" />
        </div>
        <form className="modal-body stack" onSubmit={submit}>
          <span className="optional"><CheckCircle2 size={13} /> Completely optional</span>
          <p className="muted">
            Would you like to share your details? We will only use them to send you information about this and similar products.
            You can skip this and view the product straight away.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Name" htmlFor="v-name"><Input id="v-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} /></Field>
          <Field label="Email" htmlFor="v-email"><Input id="v-email" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={200} /></Field>
          <Field label="Mobile number" htmlFor="v-phone"><Input id="v-phone" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} placeholder="+91 …" /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Button onClick={skip} size="lg" block>Skip</Button>
            <Button type="submit" variant="primary" size="lg" loading={busy} block>Submit &amp; continue</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CostingSheet({ code, viewer, pinEnabled, onClose }) {
  const [mode, setMode] = useState(viewer?.canViewCosting ? 'session' : pinEnabled ? 'pin' : 'login');
  const [form, setForm] = useState({ username: '', password: '', pin: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const url = `/public/products/${encodeURIComponent(code)}/costing`;

  const unlock = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'pin' ? { pin: form.pin } : mode === 'login' ? { username: form.username, password: form.password } : {};
      setData(await api(url, { method: 'POST', body }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (mode === 'session') unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (payload) => {
    setData(await api(url, { method: 'PUT', body: payload }));
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ alignItems: 'end', padding: 0 }}>
      <div className="modal" style={{ maxWidth: 760, borderRadius: '18px 18px 0 0', maxHeight: '94vh' }} role="dialog" aria-modal="true" aria-label="Product costing">
        <div className="modal-head">
          <h2 className="row"><Lock size={18} /> Product costing</h2>
          <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
        </div>
        <div className="modal-body" style={{ background: 'var(--surface-2)' }}>
          {data ? (
            <div className="stack">
              <div className="row small muted"><ShieldCheck size={15} color="var(--success)" /> Authorised · this view has been logged</div>
              {saved && <Alert tone="success">Costing saved.</Alert>}
              <CostingSimulator data={data} onSave={data.can_edit || data.can_edit_defaults ? save : undefined} compact />
              {!data.can_edit && !data.can_edit_defaults && <p className="tiny muted">You can try different values here. Saving changes requires a staff account with costing edit rights.</p>}
            </div>
          ) : mode === 'session' && busy ? (
            <Loading />
          ) : (
            <form className="stack" onSubmit={unlock}>
              <p className="muted">Costing is confidential. Please verify that you are authorised to view it.</p>
              {pinEnabled && <Segmented value={mode} onChange={(m) => { setMode(m); setError(null); }} options={[{ value: 'pin', label: 'PIN' }, { value: 'login', label: 'Staff sign-in' }]} />}
              {error && <Alert tone="error">{error}</Alert>}
              {mode === 'pin' ? (
                <Field label="Costing PIN" htmlFor="cost-pin">
                  <Input id="cost-pin" type="password" inputMode="numeric" autoComplete="off" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} autoFocus style={{ fontSize: 20, letterSpacing: '.3em', height: 48 }} />
                </Field>
              ) : (
                <>
                  <Field label="Username" htmlFor="cost-user"><Input id="cost-user" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus /></Field>
                  <Field label="Password" htmlFor="cost-pass"><Input id="cost-pass" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
                </>
              )}
              <Button type="submit" variant="primary" size="lg" loading={busy} block disabled={mode === 'pin' ? form.pin.length < 4 : !form.username || !form.password}>Unlock costing</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PublicProduct() {
  const { code } = useParams();
  const [state, setState] = useState({ loading: true });
  const [costOpen, setCostOpen] = useState(false);
  const [askDetails, setAskDetails] = useState(false);
  const [thanks, setThanks] = useState(null);

  useEffect(() => {
    setState({ loading: true });
    const token = storage.get(TOKEN_KEY);
    api(`/public/products/${encodeURIComponent(code)}`, { headers: token ? { 'X-Visitor-Token': token } : undefined })
      .then((d) => {
        setState({ loading: false, ...d });
        setAskDetails(Boolean(d.askDetails) && !recentlySkipped());
        document.title = `${d.product.name || d.product.sku || d.product.code} · ${d.branding.company_name}`;
      })
      .catch((err) => setState({ loading: false, error: err }));
  }, [code]);

  if (state.loading) return <Loading />;
  if (state.error) {
    return (
      <div className="pub" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 360 }}>
          <div className="empty"><div className="icon"><PackageX /></div><h3>Product not found</h3><p>The code <span className="mono">{code}</span> does not match any product. It may have been removed.</p></div>
        </div>
      </div>
    );
  }

  // What is shown is decided in Settings › QR scan page; hidden items are not sent by the server at all.
  const { product: p, branding: b, viewer } = state;
  const show = state.display || {};
  const wide = (f) => f.value.length > 28 || /packing|description|notes/i.test(f.key);
  const ref = [p.name, p.sku || p.code].filter(Boolean).join(' · ') || 'this product';
  const wa = show.contact && b.company_whatsapp ? `https://wa.me/${b.company_whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello, I am interested in ${ref}.`)}` : null;
  const email = show.contact && b.company_email ? b.company_email : null;
  const hasHeader = p.sku || p.name || p.category || p.subcategory || p.description || p.price || p.status !== 'active';

  return (
    <div className="pub" style={{ '--brand': b.brand_color || '#1f3a5f' }}>
      <header className="pub-head">
        {b.logo_url && <img className="logo" src={b.logo_url} alt="" />}
        <div className="grow">
          <div className="cname">{b.company_name}</div>
          {b.company_tagline && <div className="tag">{b.company_tagline}</div>}
        </div>
        {viewer?.canOpenDashboard && <Link to={`/products/${viewer.productId}`} className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'rgba(255,255,255,.2)' }}><ExternalLink /> Open in app</Link>}
      </header>
      <div className="pub-wrap">
        {thanks && <div style={{ padding: '12px 12px 0' }}><Alert tone="success">Thank you{thanks !== 'there' ? `, ${thanks}` : ''}! We have received your details.</Alert></div>}
        <div className={`pub-body ${show.images === false ? 'no-gallery' : ''}`}>
          {show.images !== false && <div className="pub-gallery"><Gallery images={p.images} /></div>}
          <div>
            {hasHeader && (
              <div className="pub-card">
                {p.sku && <div className="pub-code"><span className="lbl">Product code</span>{p.sku}</div>}
                {p.name && <h1 className="pub-name">{p.name}</h1>}
                {(p.category || p.subcategory) && <div className="pub-cat">{[p.category, p.subcategory].filter(Boolean).join(' › ')}</div>}
                {p.price && (
                  <div className="pub-price"><span className="lbl">{p.price.label}</span><span className="amt">{p.price.text}</span></div>
                )}
                {p.status !== 'active' && <Alert tone="warn">This product is currently {p.status}.</Alert>}
                {p.description && <p className="pub-desc">{p.description}</p>}
              </div>
            )}
            {p.fields.length > 0 && (
              <div className="pub-card">
                <div className="pub-specs">
                  {p.fields.map((f) => (
                    <div key={f.key} className={`pub-spec ${wide(f) ? 'wide' : ''}`}>
                      <div className="k">{f.label}</div>
                      <div className="v" style={{ whiteSpace: 'pre-line' }}>{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(email || wa) && (
              <div className="pub-card">
                <div className="small muted" style={{ marginBottom: 10 }}>Interested in this product?</div>
                <div className="pub-contact">
                  {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a>}
                  {email && <a className="btn" href={`mailto:${email}?subject=${encodeURIComponent(`Enquiry: ${ref}`)}`}><Mail /> Email</a>}
                </div>
              </div>
            )}
            <p className="tiny muted" style={{ textAlign: 'center', padding: '8px 16px 0' }}>{[b.company_website, b.company_phone].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </div>
      {(show.costing_button !== false || viewer?.canViewCosting) && (
        <div className="pub-cta">
          <div className="pub-cta-inner">
            <button type="button" className="btn btn-cost" onClick={() => setCostOpen(true)}><Lock /> VIEW COSTING</button>
          </div>
        </div>
      )}
      {askDetails && !viewer && (
        <VisitorPrompt code={code} company={b.company_name} onDone={(name) => { setAskDetails(false); if (name) setThanks(name); }} />
      )}
      {costOpen && <CostingSheet code={code} viewer={viewer} pinEnabled={b.costing_pin_enabled} onClose={() => setCostOpen(false)} />}
    </div>
  );
}
