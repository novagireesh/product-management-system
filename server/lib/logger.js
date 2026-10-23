import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';

let currentDay = '';
let stream = null;

function out() {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== currentDay) {
    stream?.end();
    currentDay = day;
    stream = fs.createWriteStream(path.join(paths.logs, `app-${day}.log`), { flags: 'a' });
  }
  return stream;
}

function write(level, message, meta) {
  const entry = { time: new Date().toISOString(), level, message, ...(meta || {}) };
  out().write(JSON.stringify(entry) + '\n');
  if (level === 'error') console.error(`[${level}] ${message}`, meta?.stack || '');
  else if (level !== 'debug') console.log(`[${level}] ${message}`);
}

export const log = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  request: (meta) => out().write(JSON.stringify({ time: new Date().toISOString(), level: 'http', ...meta }) + '\n'),
};

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    log.request({
      method: req.method,
      url: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - start) / 1000000n),
      user: req.user?.username,
      ip: req.ip,
    });
  });
  next();
}

export function readRecentLogs(limit = 200) {
  const files = fs.readdirSync(paths.logs).filter((f) => f.endsWith('.log')).sort().reverse();
  const lines = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(paths.logs, f), 'utf8').trim().split('\n').reverse();
    for (const line of content) {
      try {
        const e = JSON.parse(line);
        if (e.level !== 'http') lines.push(e);
      } catch { /* ignore partial lines */ }
      if (lines.length >= limit) return lines;
    }
  }
  return lines;
}
