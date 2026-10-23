import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config, lanAddress, paths } from './config.js';
import { migrate } from './db/index.js';
import { seed } from './db/seed.js';
import { csrfGuard, loadSession, purgeExpiredSessions } from './lib/auth.js';
import { errorHandler, notFound } from './lib/http.js';
import { log, requestLogger } from './lib/logger.js';
import { publicBaseUrl } from './lib/settings.js';
import authRoutes from './routes/auth.js';
import buyerRoutes from './routes/buyers.js';
import catalogueRoutes from './routes/catalogues.js';
import codeRoutes from './routes/codes.js';
import costingRoutes from './routes/costing.js';
import dashboardRoutes from './routes/dashboard.js';
import imageRoutes from './routes/images.js';
import importRoutes from './routes/import.js';
import productRoutes from './routes/products.js';
import publicRoutes from './routes/public.js';
import settingsRoutes from './routes/settings.js';
import userRoutes from './routes/users.js';
import visitorRoutes from './routes/visitors.js';
import { cleanupOldImports } from './services/importer.js';
import { recalculateAll } from './services/products.js';

migrate();
seed();
// Keep system-calculated values (loadability) in line with the current rules after upgrades.
{
  const n = recalculateAll();
  if (n) log.info(`Calculation rules applied to ${n} product(s)`);
}
purgeExpiredSessions();
cleanupOldImports();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'script-src': ["'self'"],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'self'"],
        // The app is often reached over plain http on the local network (phones scanning QR codes).
        'upgrade-insecure-requests': null,
      },
    },
    strictTransportSecurity: config.secureCookies ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }),
);
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(loadSession);
app.use(requestLogger);

// --- API ---------------------------------------------------------------------------
const api = express.Router();
api.use(csrfGuard);
api.get('/health', (req, res) => res.json({ ok: true }));
api.use('/auth', authRoutes);
api.use('/public', publicRoutes);
api.use('/products', productRoutes);
api.use('/import', importRoutes);
api.use('/images', imageRoutes);
api.use('/codes', codeRoutes);
api.use('/costing', costingRoutes);
api.use('/catalogues', catalogueRoutes);
api.use('/users', userRoutes);
api.use('/settings', settingsRoutes);
api.use('/visitors', visitorRoutes);
api.use('/', buyerRoutes);
api.use('/', dashboardRoutes);
api.use((req, res, next) => next(notFound('API endpoint not found')));
app.use('/api', api);

// --- media (product images & logo; random file names, safe to serve publicly) ---------
app.use(
  '/media/products',
  express.static(paths.productImages, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', fallthrough: false }),
);
app.use('/media/branding', express.static(paths.branding, { maxAge: '7d', index: false, dotfiles: 'deny', fallthrough: false }));

// --- web app -----------------------------------------------------------------------------
if (fs.existsSync(path.join(paths.clientDist, 'index.html'))) {
  app.use(express.static(paths.clientDist, { index: false, maxAge: '1h', setHeaders: (res, file) => {
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get(/^\/(?!api\/|media\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(paths.clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res.type('text').send('The web app has not been built yet. Run "npm run build", or use "npm run dev" during development.'),
  );
}

app.use(errorHandler);

app.listen(config.port, config.host, () => {
  log.info(`Product Management System running on http://localhost:${config.port}`);
  for (const ip of lanAddress()) log.info(`  on your network: http://${ip}:${config.port}`);
  log.info(`  QR codes point to: ${publicBaseUrl()}/p/<code>`);
  log.info(`  data directory: ${config.dataDir}`);
});

setInterval(() => {
  purgeExpiredSessions();
  cleanupOldImports();
}, 6 * 3600 * 1000).unref();
