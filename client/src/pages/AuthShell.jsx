import { BookOpen, FileSpreadsheet, Lock, QrCode } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export default function AuthShell({ children }) {
  const { branding } = useAuth();
  return (
    <div className="auth-wrap">
      <aside className="auth-side">
        <div className="row" style={{ gap: 12 }}>
          <div className="logo-mark" style={{ width: 38, height: 38, borderRadius: 10, background: '#2f6fed', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {branding?.logo_url ? <img src={branding.logo_url} alt="" style={{ background: '#fff', width: '100%', height: '100%', objectFit: 'contain' }} /> : <QrCode size={20} color="#fff" />}
          </div>
          <strong style={{ color: '#fff', fontSize: 16 }}>{branding?.company_name || 'Product Management'}</strong>
        </div>
        <div>
          <h1>Your complete product database, catalogues and costing in one place.</h1>
          <ul>
            <li><FileSpreadsheet /> <span>Import products from Excel with automatic column mapping and embedded pictures.</span></li>
            <li><QrCode /> <span>Every product gets a QR code and barcode that opens a mobile product page.</span></li>
            <li><BookOpen /> <span>Build buyer collections and export catalogues as PDF, PowerPoint or Excel.</span></li>
            <li><Lock /> <span>Costing stays protected behind role permissions, sign-in or PIN.</span></li>
          </ul>
        </div>
        <div className="small" style={{ opacity: 0.6 }}>Product Management System</div>
      </aside>
      <main className="auth-main">
        <div className="auth-box">{children}</div>
      </main>
    </div>
  );
}
