/* Круг 27 (задание №31 §2.3): детерминированный рендер og.png 1200×630 (Chromium + локальные
   Unbounded/Golos + новый logo.svg). PNG ≤ 120 КБ. Запуск: node scripts/render-og.mjs */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SITE, 'public', 'img', 'og.png');

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
@font-face{font-family:'Unbounded';src:url('/fonts/unbounded-latin-600.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Unbounded';src:url('/fonts/unbounded-cyrillic-600.woff2') format('woff2');font-weight:600;unicode-range:U+0400-04FF}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-500.woff2') format('woff2');font-weight:500;unicode-range:U+0400-04FF}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-400.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-400.woff2') format('woff2');font-weight:400;unicode-range:U+0400-04FF}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:radial-gradient(1200px 620px at 78% 18%,#16302A 0%,#0F1F1A 46%,#0B1410 100%);
  font-family:'Golos',sans-serif;color:#F2EFE6;position:relative}
.rule{position:absolute;left:0;right:0;bottom:0;height:8px;background:linear-gradient(90deg,#F0C48D,#E0A96D 42%,#C87F45)}
.glow{position:absolute;right:-160px;top:-190px;width:760px;height:760px;border-radius:50%;
  background:radial-gradient(circle,rgba(224,169,109,.20),rgba(224,169,109,0) 62%)}
.wrap{position:absolute;inset:0;padding:64px 76px;display:flex;flex-direction:column;justify-content:center}
.top{display:flex;align-items:center;gap:26px}
.top img{width:132px;height:80px}
.name{font-family:'Unbounded';font-weight:600;font-size:62px;letter-spacing:.01em;line-height:1}
.sub{margin-top:22px;font-weight:500;font-size:30px;line-height:1.34;color:#C9D4CD;max-width:860px}
.plate{margin-top:38px;display:inline-flex;align-items:center;gap:14px;align-self:flex-start;
  padding:16px 26px;border:1px solid rgba(224,169,109,.55);border-radius:999px;background:rgba(224,169,109,.08);
  font-weight:500;font-size:27px;color:#F0C48D}
.dot{width:9px;height:9px;border-radius:50%;background:#E0A96D}
</style></head><body>
<div class="glow"></div>
<div class="wrap">
  <div class="top"><img src="/img/logo.svg" alt=""><div class="name">АвтоТехСервис</div></div>
  <div class="sub">Автосервис и шиномонтаж в Ростове-на-Дону · сначала смета, потом ремонт</div>
  <div class="plate"><span class="dot"></span>ул. Портовая, 439 · ежедневно 9:00–19:00 · +7 (928) 906-57-00</div>
</div>
<div class="rule"></div>
</body></html>`;

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const b = await readFile(join(SITE, 'public', p.replace(/^\//, '')));
    res.setHeader('content-type', p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
    res.end(b);
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise((r) => server.listen(4332, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--font-render-hinting=none'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 180000 });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
const srv = createServer(async (req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const b = await readFile(join(SITE, 'public', p.replace(/^\//, '')));
    res.setHeader('content-type', p.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2');
    res.end(b);
  } catch { res.statusCode = 404; res.end('nf'); }
});
server.close();
await new Promise((r) => srv.listen(4333, '127.0.0.1', r));
await page.goto('http://127.0.0.1:4333/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 6000))]); });
await new Promise((r) => setTimeout(r, 200));
const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close(); srv.close();

await writeFile(OUT, await sharp(shot).png({ compressionLevel: 9, palette: true, quality: 92, colours: 220 }).toBuffer());
const st = await sharp(OUT).metadata();
console.log(`render-og: ${OUT} ${st.width}×${st.height}, ${(await readFile(OUT)).length / 1024 | 0} КБ`);
