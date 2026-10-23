import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Alert, Button, Field, Input, Loading } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTitle } from '../lib/hooks.js';
import AuthShell from './AuthShell.jsx';

export default function Login() {
  useTitle('Sign in');
  const { user, loading, setupRequired, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next') && params.get('next').startsWith('/') && !params.get('next').startsWith('//') ? params.get('next') : '/';

  if (loading) return <Loading />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={next} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.username, form.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: 24 }}>Sign in</h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 24 }}>Use the account your administrator created for you.</p>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Username" htmlFor="u">
          <Input id="u" autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </Field>
        <Field label="Password" htmlFor="p">
          <Input id="p" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        <Button type="submit" variant="primary" size="lg" icon={LogIn} loading={busy} block>Sign in</Button>
      </form>
    </AuthShell>
  );
}
