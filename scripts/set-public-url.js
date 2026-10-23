// Set the public address encoded into QR codes, e.g. after deploying to a server.
//
//   node scripts/set-public-url.js https://products.example.com
import { migrate } from '../server/db/index.js';
import { seed } from '../server/db/seed.js';
import { getSetting, setSettings } from '../server/lib/settings.js';

const url = String(process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^\s/]+$/i.test(url)) {
  console.error('Usage: node scripts/set-public-url.js https://your-address');
  process.exit(1);
}
migrate();
seed();
const before = getSetting('public_base_url') || '(automatic)';
setSettings({ public_base_url: url });
console.log(`QR code address: ${before} -> ${url}`);
