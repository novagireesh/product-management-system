import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.PORT || 5050),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  isProd: process.env.NODE_ENV === 'production',
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  secureCookies: process.env.SECURE_COOKIES === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 15),
  maxImportMb: Number(process.env.MAX_IMPORT_MB || 50),
};

export const paths = {
  db: path.join(config.dataDir, 'app.db'),
  uploads: path.join(config.dataDir, 'uploads'),
  productImages: path.join(config.dataDir, 'uploads', 'products'),
  branding: path.join(config.dataDir, 'uploads', 'branding'),
  catalogues: path.join(config.dataDir, 'catalogues'),
  imports: path.join(config.dataDir, 'imports'),
  logs: path.join(config.dataDir, 'logs'),
  tmp: path.join(config.dataDir, 'tmp'),
  clientDist: path.join(ROOT, 'client', 'dist'),
};

for (const key of ['productImages', 'branding', 'catalogues', 'imports', 'logs', 'tmp']) {
  fs.mkdirSync(paths[key], { recursive: true });
}

/** First non-internal IPv4 address, used to build QR URLs that phones on the same network can open. */
export function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) candidates.push({ name, address: a.address });
    }
  }
  // Prefer typical home/office ranges over virtual adapters (WSL, Hyper-V, VPN).
  const score = (c) =>
    (/^192\.168\./.test(c.address) ? 3 : /^10\./.test(c.address) ? 2 : /^172\./.test(c.address) ? 1 : 0) -
    (/vEthernet|WSL|VirtualBox|VMware|Hyper-V/i.test(c.name) ? 5 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  return candidates.map((c) => c.address);
}
