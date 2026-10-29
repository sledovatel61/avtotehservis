/* Раунд 20: союзные зоны текста и иконок карточек «О компании» в координатах мастеров
   card-*-2400.jpg. Зачем: measure-contrast (§B) раньше брал худший пиксель по всему
   прямоугольнику полосы/иконки — после принятых скримов приёмки (.52/.66/.81) туда
   попадают яркие пиксели фото, которые текст реально не покрывает. Зоны снимаются
   рендером Chromium @1440: лин-боксы h3/p через Range, bbox svg-иконки; пересчёт в
   мастер через cover-окно бокса .feat-bg (object-fit:cover, мастер 2400×1600).
   Результат дописывается в docs/photos-source/r19-about/zones.json ключом feats. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'site', 'pages-dist');
const ZF = join(ROOT, 'docs', 'photos-source', 'r19-about', 'zones.json');

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  const file = join(DIST, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  try { const b = await readFile(file); res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(b); }
  catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(4322, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023-libs/lib:${process.env.LD_LIBRARY_PATH || ''}` }, protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:4322/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const st = document.createElement('style');
  st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}';
  document.head.appendChild(st);
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]);
});

const feats = await page.evaluate(() => {
  const out = [];
  for (const f of document.querySelectorAll('.feat')) {
    const bg = f.querySelector('.feat-bg').getBoundingClientRect();
    const rects = (el) => { const rg = document.createRange(); rg.selectNodeContents(el);
      return [...rg.getClientRects()].filter(r => r.width > 4 && r.height > 2)
        .map(r => ({ x: r.x - bg.x, y: r.y - bg.y, w: r.width, h: r.height })); };
    const h3 = f.querySelector('h3'), p = f.querySelector('p'), ic = f.querySelector('.feat-ic svg');
    const ib = ic.getBoundingClientRect();
    out.push({ box: { w: bg.width, h: bg.height }, text: { h3: rects(h3), p: rects(p) },
      icon: { x: ib.x - bg.x, y: ib.y - bg.y, w: ib.width, h: ib.height } });
  }
  return out;
});

const MW = 2400, MH = 1600;
const mapped = feats.map(f => {
  const sc = Math.max(f.box.w / MW, f.box.h / MH);
  const sw = f.box.w / sc, sh = f.box.h / sc, ox = (MW - sw) / 2, oy = (MH - sh) / 2;
  const m = (r) => [Math.round(ox + r.x / sc), Math.round(oy + r.y / sc), Math.round(ox + (r.x + r.w) / sc), Math.round(oy + (r.y + r.h) / sc)];
  return { text: { h3: f.text.h3.map(m), p: f.text.p.map(m) }, icon: m(f.icon) };
});

const zones = JSON.parse(readFileSync(ZF, 'utf8'));
zones.feats = mapped;
writeFileSync(ZF, JSON.stringify(zones, null, 1));
console.log(`zones.json: feats — ${mapped.length} карточки, лин-боксов h3/p ${mapped.reduce((s, x) => s + x.text.h3.length + x.text.p.length, 0)}, иконки ${mapped.map(x => x.icon.join(',')).join(' | ')}`);
await browser.close();
server.close();
