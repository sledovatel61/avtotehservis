/** Применение SQL-миграций из migrations/ (идемпотентно, журнал schema_migrations). */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dataDir } from '../src/server/db.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');

export function runMigrations(): string[] {
  const dbx = db();
  dbx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set((dbx.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const tx = dbx.transaction(() => {
      dbx.exec(sql);
      dbx.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run(f);
    });
    tx();
    done.push(f);
  }
  return done;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const done = runMigrations();
  console.log(`БД: ${join(dataDir(), 'site.sqlite3')}`);
  console.log(done.length ? `Применено миграций: ${done.join(', ')}` : 'Новых миграций нет — схема актуальна.');
}
