import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen, Boxes, CheckCircle2, FileSpreadsheet, FolderTree, ImageOff, Images, LibraryBig, Plus, QrCode, ScanLine, Wallet,
} from 'lucide-react';
import HistoryTimeline from '../components/HistoryTimeline.jsx';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, StatCard, Thumb } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, timeAgo } from '../lib/format.js';
import { useApi, useTitle } from '../lib/hooks.js';

const TEMPLATE_LABEL = { simple: 'Simple', premium: 'Premium', buyer: 'Buyer specific' };

export default function Dashboard() {
  useTitle('Dashboard');
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi('/dashboard');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const { stats, byCategory, recentProducts, recentCatalogues, activity } = data;
  const maxCat = Math.max(1, ...byCategory.map((c) => c.count));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="stack-lg">
      <PageHeader
        title={`${greeting}, ${user.name.split(' ')[0]}`}
        subtitle="Here is what is happening across your product catalogue."
        actions={
          <>
            {can('products.import') && <Button icon={FileSpreadsheet} onClick={() => navigate('/import')}>Import Excel</Button>}
            {can('catalogues.generate') && <Button icon={BookOpen} onClick={() => navigate('/catalogues/new')}>New catalogue</Button>}
            {can('products.create') && <Button variant="primary" icon={Plus} onClick={() => navigate('/products/new')}>Add product</Button>}
          </>
        }
      />

      {stats.totalProducts === 0 && (
        <Card>
          <Empty
            icon={FileSpreadsheet}
            title="Start by importing your products"
            action={
              <div className="row">
                {can('products.import') && <Button variant="primary" icon={FileSpreadsheet} onClick={() => navigate('/import')}>Import from Excel</Button>}
                {can('products.create') && <Button icon={Plus} onClick={() => navigate('/products/new')}>Add manually</Button>}
              </div>
            }
          >
            Upload an Excel sheet with your product list. Columns are mapped automatically, pictures in the sheet are attached, and every product gets its own QR code and barcode.
          </Empty>
        </Card>
      )}

      <div className="stat-grid">
        <StatCard icon={Boxes} label="Total products" value={stats.totalProducts} tone="blue" />
        <StatCard icon={CheckCircle2} label="Active products" value={stats.activeProducts} tone="green" />
        <StatCard icon={FolderTree} label="Categories" value={stats.categories} hint={`${stats.subcategories} sub categories`} tone="violet" />
        <StatCard icon={Images} label="With images" value={stats.withImages} tone="wood" />
        <StatCard icon={ImageOff} label="Without images" value={stats.withoutImages} tone={stats.withoutImages ? 'amber' : 'slate'} />
        <StatCard icon={QrCode} label="With QR codes" value={stats.withCodes} tone="slate" />
        {stats.withCosting !== null && <StatCard icon={Wallet} label="With costing" value={stats.withCosting} tone="amber" />}
        <StatCard icon={LibraryBig} label="Catalogues generated" value={stats.cataloguesGenerated} tone="blue" />
      </div>

      <div className="grid-2">
        <Card title="Products by category" icon={FolderTree}>
          {byCategory.length ? (
            <div className="bars">
              {byCategory.map((c) => (
                <div className="bar-row" key={c.name}>
                  <span className="truncate" title={c.name}>{c.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.count / maxCat) * 100}%` }} /></div>
                  <span className="right small muted">{c.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No products yet.</p>
          )}
        </Card>

        <Card title="Recently updated" icon={Boxes} pad={false} actions={can('products.view') && <Link to="/products" className="small">View all</Link>}>
          {recentProducts.length ? (
            <div className="list">
              {recentProducts.map((p) => (
                <Link key={p.id} to={`/products/${p.id}`} className="list-item">
                  <Thumb src={p.thumb_url} size="sm" />
                  <div className="grow">
                    <div className="truncate" style={{ fontWeight: 560 }}>{p.name}</div>
                    <div className="tiny muted mono">{p.sku}</div>
                  </div>
                  <span className="tiny muted nowrap">{timeAgo(p.updated_at)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card-body muted">Nothing yet.</div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Recent catalogues" icon={LibraryBig} pad={false} actions={can('catalogues.view', 'catalogues.generate') && <Link to="/catalogues" className="small">History</Link>}>
          {recentCatalogues.length ? (
            <div className="list">
              {recentCatalogues.map((c) => (
                <Link key={c.id} to="/catalogues" className="list-item">
                  <div className="thumb thumb-sm tone-blue" style={{ border: 0 }}><BookOpen /></div>
                  <div className="grow">
                    <div className="truncate" style={{ fontWeight: 560 }}>{c.title}</div>
                    <div className="tiny muted">{c.buyer_name ? `For ${c.buyer_name} · ` : ''}{c.product_count} products · {fmtDate(c.created_at)}</div>
                  </div>
                  <Badge>{TEMPLATE_LABEL[c.template]}</Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card-body muted">No catalogues generated yet.</div>
          )}
        </Card>
        <Card title="Quick actions" icon={ScanLine}>
          <div className="grid-2" style={{ gap: 10 }}>
            <Button icon={ScanLine} onClick={() => navigate('/scan')}>Scan a product</Button>
            {can('codes.manage') && <Button icon={QrCode} onClick={() => navigate('/codes')}>Print labels</Button>}
            {can('images.manage') && <Button icon={Images} onClick={() => navigate('/images')}>Upload images</Button>}
            {can('costing.view') && <Button icon={Wallet} onClick={() => navigate('/costing')}>Review costing</Button>}
          </div>
        </Card>
      </div>

      {activity.length > 0 && (
        <Card title="Latest activity" actions={<Link to="/activity" className="small">Full log</Link>}>
          <HistoryTimeline items={activity} showProduct />
        </Card>
      )}
    </div>
  );
}
