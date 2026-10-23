import { config, lanAddress } from '../config.js';
import { q } from '../db/index.js';

let cache = null;

export function getSettings() {
  if (!cache) {
    cache = {};
    for (const row of q.all('SELECT key, value FROM settings')) {
      try {
        cache[row.key] = JSON.parse(row.value);
      } catch {
        cache[row.key] = row.value;
      }
    }
  }
  return cache;
}

export function getSetting(key) {
  return getSettings()[key];
}

export function setSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    q.run(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, JSON.stringify(value ?? null),
    );
  }
  cache = null;
}

/** Base URL encoded into QR codes. Falls back to this machine's LAN address so phones can reach it. */
export function publicBaseUrl() {
  const configured = (getSetting('public_base_url') || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const ip = lanAddress()[0] || 'localhost';
  return `http://${ip}:${config.port}`;
}

/** Settings safe to expose to anyone (used by the public scan page). */
export function publicBranding() {
  const s = getSettings();
  return {
    company_name: s.company_name,
    company_tagline: s.company_tagline,
    company_email: s.company_email,
    company_phone: s.company_phone,
    company_whatsapp: s.company_whatsapp,
    company_website: s.company_website,
    company_address: s.company_address,
    brand_color: s.brand_color,
    currency: s.currency,
    logo_url: s.company_logo ? `/media/branding/${s.company_logo}` : null,
    costing_pin_enabled: Boolean(s.costing_pin_hash),
  };
}
