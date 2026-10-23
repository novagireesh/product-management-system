export function parseDate(v) {
  if (!v) return null;
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v, withTime = false) {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function timeAgo(v) {
  const d = parseDate(v);
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return fmtDate(v);
}

export function fmtMoney(v, currency = 'USD') {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCost(field, v, currency) {
  if (v === null || v === undefined) return '—';
  if (field.type === 'percent') return `${Number(v).toFixed(2)}%`;
  if (field.type === 'number') return Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return fmtMoney(v, currency);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export const plural = (n, word, many = `${word}s`) => `${fmtNum(n)} ${n === 1 ? word : many}`;
