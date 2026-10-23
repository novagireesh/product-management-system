import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react';
import { Alert, Button, Card, Input, PageHeader } from '../components/ui.jsx';
import { useTitle } from '../lib/hooks.js';

/** Extract the product code from a scanned value: a /p/<code> URL, or the raw barcode text. */
function codeFrom(text) {
  const m = String(text).match(/\/p\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : String(text).trim();
}

export default function Scan() {
  useTitle('Scan');
  const navigate = useNavigate();
  const [manual, setManual] = useState('');
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const scanner = useRef(null);
  const secure = window.isSecureContext;

  const stop = async () => {
    try {
      if (scanner.current?.isScanning) await scanner.current.stop();
      scanner.current?.clear();
    } catch { /* already stopped */ }
    scanner.current = null;
    setActive(false);
  };

  const start = async () => {
    setError(null);
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
      const s = new Html5Qrcode('scanner-view', {
        formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.DATA_MATRIX],
        verbose: false,
      });
      scanner.current = s;
      await s.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.75, height: Math.min(w, h) * 0.75 }) },
        async (text) => {
          await stop();
          if (navigator.vibrate) navigator.vibrate(60);
          navigate(`/p/${encodeURIComponent(codeFrom(text))}`);
        },
        () => {},
      );
      setActive(true);
    } catch (err) {
      setError(err?.message || String(err));
      await stop();
    }
  };

  useEffect(() => () => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack-lg" style={{ maxWidth: 640, margin: '0 auto' }}>
      <PageHeader title="Scan a product" subtitle="Scan a product’s QR code or barcode to open its product page." />
      <Card>
        <div className="stack">
          <div className="scanner-box">
            <div id="scanner-view" style={{ width: '100%', height: '100%' }} />
            {!active && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#aab4c5' }}>
                <div className="stack" style={{ alignItems: 'center' }}><ScanLine size={48} /><span>Camera is off</span></div>
              </div>
            )}
          </div>
          {!secure && (
            <Alert tone="warn" title="Camera needs a secure connection">
              Browsers only allow camera access on https:// or on this computer (localhost). On a phone, simply open the phone’s camera app and point it at the QR code — the product page opens automatically.
            </Alert>
          )}
          {error && <Alert tone="error">{/NotAllowed|Permission/i.test(error) ? 'Camera access was blocked. Allow camera access for this site in your browser settings.' : error}</Alert>}
          {active ? <Button icon={CameraOff} onClick={stop} block>Stop camera</Button> : <Button variant="primary" size="lg" icon={Camera} onClick={start} block disabled={!secure}>Start camera</Button>}
        </div>
      </Card>
      <Card title="Enter a code manually" icon={Keyboard}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) navigate(`/p/${encodeURIComponent(codeFrom(manual))}`); }}>
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Product ID, e.g. PRD-10025 — or use a USB barcode scanner" className="mono" autoFocus />
          <Button type="submit" variant="primary">Open</Button>
        </form>
        <p className="tiny muted" style={{ marginTop: 8 }}>USB / Bluetooth barcode scanners type the code and press Enter — click the box and scan.</p>
      </Card>
    </div>
  );
}
