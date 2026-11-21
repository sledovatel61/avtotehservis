/* Мини-сервер для просмотра архива сайта на своём компьютере.
 *
 * Зачем: сайт собран как статический, но все адреса в нём начинаются с корня
 * (`/img/...`, `/prices/`). Если открыть index.html двойным щелчком, браузер ищет
 * `C:\img\...` и страница остаётся без картинок и стилей. Поэтому архив смотрят
 * через этот файл: он раздаёт папку `site` по адресу http://localhost:8080.
 *
 * Запуск:  node serve.mjs        (или start.cmd — то же самое двойным щелчком)
 * Порт можно поменять:  set PORT=8081 && node serve.mjs
 *
 * Ничего не устанавливает, никуда не ходит в интернет, только читает файлы рядом.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(join(HERE, 'site')) ? join(HERE, 'site') : HERE;
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Безопасный путь внутри ROOT: `..` и абсолютные имена отбрасываем. */
function resolveInside(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = normalize(join(ROOT, clean));
  return target.startsWith(ROOT + sep) || target === ROOT ? target : null;
}

function send(res, file) {
  const ext = extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  let file = resolveInside(req.url || '/');
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }
  try {
    if (existsSync(file) && statSync(file).isDirectory()) {
      const index = join(file, 'index.html');
      if (existsSync(index)) {
        send(res, index);
        return;
      }
      file = file.replace(/[/\\]$/, '') + '.html';
      if (existsSync(file)) {
        send(res, file);
        return;
      }
    } else if (existsSync(file)) {
      send(res, file);
      return;
    }
  } catch {
    /* упадём в 404 ниже */
  }
  const notFound = join(ROOT, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  if (existsSync(notFound)) createReadStream(notFound).pipe(res);
  else res.end('404');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Архив сайта открыт:  http://localhost:' + PORT);
  console.log('  Папка с файлами:     ' + ROOT);
  console.log('');
  console.log('  Чтобы остановить — закройте это окно или нажмите Ctrl+C.');
  console.log('');
});
