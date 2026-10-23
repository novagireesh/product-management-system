// Build the web app and bundle everything the server needs into one file to upload.
//
//   npm run package                 app only (use this for updates — server data is kept)
//   npm run package -- --with-data  app + your data (products, images, users) for the FIRST deployment
//
// Output: deploy-package/pms-<date>[-with-data].tar.gz
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TarArchive } from 'archiver';
import { ROOT, config } from '../server/config.js';

const withData = process.argv.includes('--with-data');
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const outDir = path.join(ROOT, 'deploy-package');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `pms-${stamp}${withData ? '-with-data' : ''}.tar.gz`);

console.log('Building the web app…');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

const archive = new TarArchive({ gzip: true, gzipOptions: { level: 9 } });
const output = fs.createWriteStream(outFile);
const done = new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
});
archive.pipe(output);

for (const dir of ['client/dist', 'server', 'shared', 'scripts']) archive.directory(path.join(ROOT, dir), dir);
for (const f of ['package.json', 'package-lock.json', 'README.md', 'DEPLOY.md', '.env.example']) {
  if (fs.existsSync(path.join(ROOT, f))) archive.file(path.join(ROOT, f), { name: f });
}
for (const f of fs.readdirSync(path.join(ROOT, 'deploy'))) {
  archive.file(path.join(ROOT, 'deploy', f), { name: `deploy/${f}`, mode: f.endsWith('.sh') ? 0o755 : 0o644 });
}

let snapshot = null;
if (withData) {
  // Consistent copy of the database even if the app is running.
  const { db } = await import('../server/db/index.js');
  snapshot = path.join(config.dataDir, 'tmp', `package-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  archive.file(snapshot, { name: 'data/app.db' });
  for (const dir of ['uploads', 'catalogues']) {
    const full = path.join(config.dataDir, dir);
    if (fs.existsSync(full)) archive.directory(full, `data/${dir}`);
  }
}

await archive.finalize();
await done;
if (snapshot) fs.rmSync(snapshot, { force: true });
const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`\nPackage ready: ${path.relative(ROOT, outFile)} (${mb} MB)${withData ? ' — includes your data' : ' — app only, server data is not touched'}`);
