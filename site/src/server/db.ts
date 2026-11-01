import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function dataDir(): string {
  const d = process.env.DATA_DIR || join(process.cwd(), 'data');
  mkdirSync(d, { recursive: true });
  return resolve(d);
}
export function mediaDir(): string {
  const d = process.env.MEDIA_DIR || join(dataDir(), 'media');
  mkdirSync(d, { recursive: true });
  return resolve(d);
}

let _db: Database.Database | null = null;

/** Ленивый синглтон: DATA_DIR читается в момент первого обращения (тесты подменяют env до импорта). */
export function db(): Database.Database {
  if (!_db) {
    _db = new Database(join(dataDir(), 'site.sqlite3'));
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('busy_timeout = 5000');
  }
  return _db;
}

/** Только для тестов: закрыть соединение (временная БД). */
export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

export function isMigrated(): boolean {
  const t = db().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get();
  if (!t) return false;
  const n = db().prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number };
  return n.c > 0;
}

export { HERE };
