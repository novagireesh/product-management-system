// Save a backup ZIP (database + product images + logo) in data/backups and keep the latest ones.
//
//   node scripts/backup.js            keeps the 14 most recent backups
//   node scripts/backup.js --keep 30
//
// Safe to run while the app is running (the server runs it every night).
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { config, paths } from '../server/config.js';
import { db } from '../server/db/index.js';

const keepArg = process.argv.indexOf('--keep');
const keep = keepArg > 0 ? Math.max(1, Number(process.argv[keepArg + 1]) || 14) : 14;
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const snapshot = path.join(paths.tmp, `backup-${Date.now()}.db`);
db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

const target = path.join(dir, `pms-backup-${stamp}.zip`);
const zip = new ZipArchive({ zlib: { level: 6 } });
const out = fs.createWriteStream(target);
const done = new Promise((resolve, reject) => {
  out.on('close', resolve);
  zip.on('error', reject);
});
zip.pipe(out);
zip.file(snapshot, { name: 'app.db' });
zip.directory(paths.uploads, 'uploads');
await zip.finalize();
await done;
fs.rmSync(snapshot, { force: true });

const old = fs.readdirSync(dir).filter((f) => /^pms-backup-.*\.zip$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
console.log(`${new Date().toISOString()} backup saved: ${target} (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB); removed ${old.length} old`);
