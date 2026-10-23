import { DatabaseSync } from 'node:sqlite';
import { paths } from '../config.js';
import { migrations } from './schema.js';

export const db = new DatabaseSync(paths.db);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`);

const cache = new Map();
function prepare(sql) {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

// node:sqlite rejects undefined/boolean bindings; normalise them.
const norm = (params) =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const q = {
  all: (sql, ...params) => prepare(sql).all(...norm(params)),
  get: (sql, ...params) => prepare(sql).get(...norm(params)),
  run: (sql, ...params) => prepare(sql).run(...norm(params)),
  /** Value of the first column of the first row, or undefined. */
  value: (sql, ...params) => {
    const row = prepare(sql).get(...norm(params));
    return row ? Object.values(row)[0] : undefined;
  },
};

let depth = 0;
let savepointSeq = 0;
/** Run fn inside a transaction. Nested calls use savepoints. fn must be synchronous. */
export function tx(fn) {
  if (depth > 0) {
    const name = `sp_${++savepointSeq}`;
    db.exec(`SAVEPOINT ${name}`);
    depth++;
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (err) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw err;
    } finally {
      depth--;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const now = () => new Date().toISOString();

export function migrate() {
  const current = Number(q.value('PRAGMA user_version'));
  for (let v = current; v < migrations.length; v++) {
    tx(() => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  // Statements prepared before a migration (e.g. SELECT *) would not see new columns.
  if (current < migrations.length) cache.clear();
}

/** Escape a user string for use inside a LIKE pattern with ESCAPE '\'. */
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
