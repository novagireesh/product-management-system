import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { Alert, Button, Field, Input, Loading } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useTitle } from '../lib/hooks.js';
import AuthShell from './AuthShell.jsx';

export default function Setup() {
  useTitle('Welcome');
  const { loading, setupRequired, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ company_name: '', name: '', username: 'admin', email: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (!setupRequired) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('The passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/setup', { method: 'POST', body: form });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: 24 }}>Welcome — let’s set things up</h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 24 }}>Create the administrator account. You can add more users and roles afterwards.</p>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Company name"><Input value={form.company_name} onChange={set('company_name')} placeholder="e.g. Sunrise Woodcraft Exports" required /></Field>
        <Field label="Your name"><Input value={form.name} onChange={set('name')} autoComplete="name" required /></Field>
        <div className="grid-2">
          <Field label="Username"><Input value={form.username} onChange={set('username')} autoComplete="username" required minLength={3} /></Field>
          <Field label="Email (optional)"><Input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
        </div>
        <Field label="Password" hint="At least 8 characters"><Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required minLength={8} /></Field>
        <Field label="Confirm password"><Input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></Field>
        <Button type="submit" variant="primary" size="lg" icon={Rocket} loading={busy} block>Create account & start</Button>
      </form>
    </AuthShell>
  );
}
