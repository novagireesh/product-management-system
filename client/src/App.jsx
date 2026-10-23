import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { Empty, Loading } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import { ShieldOff } from 'lucide-react';

const Login = lazy(() => import('./pages/Login.jsx'));
const Setup = lazy(() => import('./pages/Setup.jsx'));
const PublicProduct = lazy(() => import('./pages/PublicProduct.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const ProductDetail = lazy(() => import('./pages/ProductDetail.jsx'));
const ProductForm = lazy(() => import('./pages/ProductForm.jsx'));
const Import = lazy(() => import('./pages/Import.jsx'));
const Images = lazy(() => import('./pages/Images.jsx'));
const Codes = lazy(() => import('./pages/Codes.jsx'));
const LabelsPrint = lazy(() => import('./pages/LabelsPrint.jsx'));
const Costing = lazy(() => import('./pages/Costing.jsx'));
const Buyers = lazy(() => import('./pages/Buyers.jsx'));
const Collection = lazy(() => import('./pages/Collection.jsx'));
const CatalogueGenerator = lazy(() => import('./pages/CatalogueGenerator.jsx'));
const Catalogues = lazy(() => import('./pages/Catalogues.jsx'));
const UsersPage = lazy(() => import('./pages/Users.jsx'));
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));
const Scan = lazy(() => import('./pages/Scan.jsx'));
const Visitors = lazy(() => import('./pages/Visitors.jsx'));

function Guard({ perm, children }) {
  const { can } = useAuth();
  const perms = Array.isArray(perm) ? perm : [perm];
  if (perm && !can(...perms)) {
    return (
      <Empty icon={ShieldOff} title="No access">
        Your role does not include access to this page. Ask an administrator if you need it.
      </Empty>
    );
  }
  return children;
}

function Protected() {
  const { user, loading, setupRequired } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Layout />;
}

/** Signed-in pages without the app chrome (e.g. printable labels). */
function Bare() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  if (can('products.view')) return <Navigate to="/products" replace />;
  return <Navigate to="/scan" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/p/:code" element={<PublicProduct />} />
        <Route element={<Bare />}>
          <Route path="/print/labels" element={<Guard perm="codes.manage"><LabelsPrint /></Guard>} />
        </Route>
        <Route element={<Protected />}>
          <Route index element={<Home />} />
          <Route path="products" element={<Guard perm="products.view"><Products /></Guard>} />
          <Route path="products/new" element={<Guard perm="products.create"><ProductForm /></Guard>} />
          <Route path="products/:id" element={<Guard perm="products.view"><ProductDetail /></Guard>} />
          <Route path="products/:id/edit" element={<Guard perm="products.edit"><ProductForm /></Guard>} />
          <Route path="import" element={<Guard perm="products.import"><Import /></Guard>} />
          <Route path="images" element={<Guard perm="images.manage"><Images /></Guard>} />
          <Route path="codes" element={<Guard perm="codes.manage"><Codes /></Guard>} />
          <Route path="costing" element={<Guard perm="costing.view"><Costing /></Guard>} />
          <Route path="buyers" element={<Guard perm="buyers.view"><Buyers /></Guard>} />
          <Route path="collections/:id" element={<Guard perm={['buyers.view', 'catalogues.generate']}><Collection /></Guard>} />
          <Route path="catalogues/new" element={<Guard perm="catalogues.generate"><CatalogueGenerator /></Guard>} />
          <Route path="catalogues" element={<Guard perm={['catalogues.view', 'catalogues.generate']}><Catalogues /></Guard>} />
          <Route path="users" element={<Guard perm="users.manage"><UsersPage /></Guard>} />
          <Route path="settings" element={<Guard perm="settings.manage"><SettingsPage /></Guard>} />
          <Route path="activity" element={<Guard perm="history.view"><Activity /></Guard>} />
          <Route path="visitors" element={<Guard perm="visitors.view"><Visitors /></Guard>} />
          <Route path="scan" element={<Scan />} />
          <Route path="*" element={<Empty title="Page not found">The page you are looking for does not exist.</Empty>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
