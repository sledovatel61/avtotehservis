import { mkdirSync, accessSync, constants } from 'node:fs';
import type { APIRoute } from 'astro';
import { db, isMigrated } from '../../server/db.ts';

/** /api/health — для мониторинга (M6 ревью): не только «файл БД открывается»,
 *  но и «схема накатана» и «каталоги данных/медиа записываемы». Любая проблема — 503 degraded. */
export const GET: APIRoute = async () => {
  const checks = { db: false, schema: false, data_writable: false, media_writable: false };

  try { db().prepare('SELECT 1 AS x').get(); checks.db = true; } catch { checks.db = false; }
  try { checks.schema = checks.db && isMigrated(); } catch { checks.schema = false; }

  const dirs: Array<[string, 'data_writable' | 'media_writable']> = [
    [process.env.DATA_DIR ?? './data', 'data_writable'],
    [process.env.MEDIA_DIR ?? './data/media', 'media_writable'],
  ];
  for (const [dir, key] of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      checks[key] = true;
    } catch { checks[key] = false; }
  }

  const ok = checks.db && checks.schema && checks.data_writable && checks.media_writable;
  return new Response(JSON.stringify({
    status: ok ? 'ok' : 'degraded',
    ...checks,
    time: new Date().toISOString(),
    version: process.env.npm_package_version ?? 'dev',
  }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
