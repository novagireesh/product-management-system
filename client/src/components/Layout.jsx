import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, Boxes, ChevronDown, FileSpreadsheet, History, Images, KeyRound, LayoutDashboard, LibraryBig, LogOut, Menu as MenuIcon,
  QrCode, ScanLine, Search, Settings, ShieldCheck, ShoppingBag, UserRound, Users, Wallet, ListChecks,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { initials } from '../lib/format.js';
import { useSelection } from '../lib/selection.jsx';
import { useToast } from '../lib/toast.jsx';
import { Button, Field, Input, Menu, Modal } from './ui.jsx';

const NAV = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', end: true }] },
  {
    title: 'Catalogue',
    items: [
      { to: '/products', label: 'Products', icon: Boxes, perm: 'products.view' },
      { to: '/import', label: 'Excel Import', icon: FileSpreadsheet, perm: 'products.import' },
      { to: '/images', label: 'Product Images', icon: Images, perm: 'images.manage' },
      { to: '/codes', label: 'Barcode / QR', icon: QrCode, perm: 'codes.manage' },
      { to: '/costing', label: 'Costing', icon: Wallet, perm: 'costing.view' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/buyers', label: 'Buyers & Collections', icon: ShoppingBag, perm: 'buyers.view' },
      { to: '/catalogues/new', label: 'Catalogue Generator', icon: BookOpen, perm: 'catalogues.generate' },
      { to: '/catalogues', label: 'Catalogue History', icon: LibraryBig, perm: ['catalogues.view', 'catalogues.generate'], end: true },
      { to: '/visitors', label: 'Scan Visitors', icon: UserRound, perm: 'visitors.view' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/users', label: 'Users & Permissions', icon: Users, perm: 'users.manage' },
      { to: '/activity', label: 'Activity Log', icon: History, perm: 'history.view' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings.manage' },
    ],
  },
];

function PasswordModal({ open, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) return toast.error('The new passwords do not match');
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: form });
      toast.success('Password changed');
      setForm({ current_password: '', new_password: '', confirm: '' });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change password">
      <form className="stack" onSubmit={submit}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} required /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} required minLength={8} /></Field>
        <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Change password</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Layout() {
  const { user, can, logout, branding } = useAuth();
  const selection = useSelection();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setOpen(false), [location.pathname]);

  const allowed = (perm) => (Array.isArray(perm) ? can(...perm) : can(perm));

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="logo-mark">{branding?.logo_url ? <img src={branding.logo_url} alt="" /> : <QrCode size={19} color="#fff" />}</div>
          <div className="truncate">
            <div className="name truncate">{branding?.company_name || 'Product Manager'}</div>
            <div className="sub">Product Management</div>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map((group) => {
            const items = group.items.filter((i) => allowed(i.perm));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.title}>
                <div className="nav-group-title">{group.title}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <i.icon />
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/scan" className="nav-link"><ScanLine /> <span>Scan a product</span></NavLink>
        </div>
      </aside>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <Button variant="ghost" icon={MenuIcon} className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu" />
          {can('products.view') && (
            <form
              className="topbar-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/products?search=${encodeURIComponent(search.trim())}`);
              }}
            >
              <Search />
              <Input placeholder="Search products by ID, name, material…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
            </form>
          )}
          <div className="grow" />
          {selection.count > 0 && (
            <Button variant="soft" size="sm" icon={ListChecks} onClick={() => navigate('/products?selected=1')} className="hide-sm">
              {selection.count} selected
            </Button>
          )}
          <Button icon={ScanLine} onClick={() => navigate('/scan')} className="hide-sm">Scan</Button>
          <Menu
            trigger={({ toggle }) => (
              <button type="button" className="btn btn-ghost" onClick={toggle} style={{ paddingLeft: 6 }} aria-label="Account menu">
                <span className="avatar">{initials(user?.name)}</span>
                <span className="hide-sm" style={{ textAlign: 'left', lineHeight: 1.2 }}>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>{user?.name}</span>
                  <span className="tiny muted">{user?.role}</span>
                </span>
                <ChevronDown size={15} />
              </button>
            )}
          >
            <div style={{ padding: '6px 10px 8px' }}>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <div className="small muted">@{user?.username} · <ShieldCheck size={12} style={{ verticalAlign: -2 }} /> {user?.role}</div>
            </div>
            <div className="divider" />
            <button type="button" onClick={() => setPwOpen(true)}><KeyRound /> Change password</button>
            <button type="button" onClick={async () => { await logout(); navigate('/login'); }}><LogOut /> Sign out</button>
          </Menu>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
