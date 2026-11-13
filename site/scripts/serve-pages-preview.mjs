#!/usr/bin/env node
/**
 * Локальная раздача собранного превью (`npm run build:pages`) ровно по тому же
 * адресу, что на GitHub Pages: корень сайта — `/avtotehservis/`, не `/`.
 *
 * Нужно, чтобы увидеть сборку в живом браузере до публикации и чтобы ссылки
 * в статике (`/avtotehservis/...`) не разъезжались с публикацией.
 *
 *   node scripts/serve-pages-preview.mjs [порт] [папка]
 *
 * По умолчанию порт 8080, папка `pages-dist`. Слушает 0.0.0.0, чтобы работал
 * внешний предпросмотр; каталоги без завершающего слэша редиректятся,
 * `404.html` отдаётся как страница ошибки.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const ROOT = resolve(process.argv[3] ?? process.env.PAGES_DIR ?? join(HERE, 'pages-dist'));
const BASE = '/avtotehservis';

const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
}));

function safePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const full = join(ROOT, clean);
  return full.startsWith(ROOT) ? full : null;
}

async function resolveFile(urlPath) {
  const full = safePath(urlPath);
  if (!full) return null;
  try {
    const st = await stat(full);
    if (st.isDirectory()) {
      const index = join(full, 'index.html');
      await stat(index);
      return { file: index, redirect: !urlPath.endsWith('/') };
    }
    if (st.isFile()) return { file: full, redirect: false };
  } catch {
    try {
      const html = await stat(`${full}.html`);
      if (html.isFile()) return { file: `${full}.html`, redirect: false };
    } catch { /* ниже отдадим 404 */ }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = url.pathname;
  if (path === '/' || path === BASE) {
    res.writeHead(302, { location: `${BASE}/` });
    res.end();
    return;
  }
  if (path.startsWith(`${BASE}/`)) path = path.slice(BASE.length);
  else if (path !== '/404.html') {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(ROOT, '404.html')).pipe(res);
    return;
  }

  const hit = await resolveFile(path);
  if (!hit) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(ROOT, '404.html')).pipe(res);
    return;
  }
  if (hit.redirect) {
    res.writeHead(301, { location: `${BASE}${path}/` });
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES.get(extname(hit.file)) ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(hit.file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`pages preview: http://0.0.0.0:${PORT}${BASE}/ ← ${ROOT}`);
});
