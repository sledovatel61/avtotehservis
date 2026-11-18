/* Круг 72: кадры трёх статей про Voyah Free из собранной статики pages-dist.
   Нужны ровно заявленные размеры: 1440×900 и 390×844 (обложка не растянута,
   заголовок не режется). Запуск: node scripts/r70-shots.mjs (после export-pages). */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const DIST = join(process.cwd(), 'pages-dist');
const OUT = join(process.cwd(), '..', 'evaluation', 'assets', 'r70');
await mkdir(OUT, { recursive: true });

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  const file = join(DIST, p === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(p) ? p : join(p, 'index.html'));
  try {
    const b = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html'
      : file.endsWith('.css') ? 'text/css'
      : file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.avif') ? 'image/avif'
      : file.endsWith('.webp') ? 'image/webp'
      : file.endsWith('.svg') ? 'image/svg+xml'
      : file.endsWith('.woff2') ? 'font/woff2'
      : 'application/octet-stream';
    res.setHeader('content-type', type);
    res.end(b);
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise((r) => server.listen(4336, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'],
  headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 600000,
});

const PAGES = [
  ['to-voyah-free-reglament', '/news/to-voyah-free-reglament/'],
  ['maslo-voyah-free', '/news/maslo-voyah-free/'],
  ['voyah-free-bolezni', '/news/voyah-free-bolezni/'],
];
const SIZES = [[1440, 900], [390, 844]];

for (const [name, path] of PAGES) {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:4336${path}`, { waitUntil: 'networkidle0' });
    /* анимации появления в статике должны быть уже в конечном состоянии */
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}';
      document.head.append(st);
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 250));
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      h1: (() => { const el = document.getElementById('post-title'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), w: Math.round(r.width) }; })(),
      img: (() => { const el = document.querySelector('#post-img img'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
    const file = join(OUT, `${name}-${w}x${h}.png`);
    await page.screenshot({ path: file });
    console.log(`${name} ${w}×${h}: ${overflow.scrollW <= overflow.clientW ? 'без горизонтального скролла' : `ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ ${overflow.scrollW}>${overflow.clientW}`}`,
      `| h1 ${overflow.h1?.height}px, обложка ${overflow.img?.w}×${overflow.img?.h}`, `→ ${file.replace(process.cwd() + '/../', '')}`);
    await page.close();
  }
}

await browser.close();
server.close();
