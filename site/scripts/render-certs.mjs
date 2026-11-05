/* Круг 26 (задание №30, §3): рендер ИЛЛЮСТРАЦИЙ сертификатов для блока «Сертификаты»
   на /about. Только Chromium (puppeteer-core 23 + @sparticuz/chromium 131, standing R20):
   оформленные документы собираются вёрсткой (Unbounded латиницей для брендов, Golos для
   кириллицы, латунь #E0A96D на тёмно-зелёном #0B1410→#10201A), затем снимок 1200×1600
   DPR1, детерминированное зерно (mulberry32, σ=6) и запись мастера JPEG q95 в
   docs/photos-source/r26-certs/cert-{lynxauto,sufix,korson,ngn}.jpg.
   Это НЕ сканы реальных документов (копировать docs/content-source/r26/cert-*.jpg нельзя
   по заданию) — стилизованные иллюстрации; сноска на странице это оговаривает.
   Производные 720×960 / 1200×1600 webp+avif делает build-images.mjs (блок 10c, круг 26).
   Запуск: node scripts/render-certs.mjs   (детерминированный: байт-в-байт при повторе) */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, renameSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'docs', 'photos-source', 'r26-certs');
if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

const CERTS = [
  { key: 'lynxauto', brand: 'LYNXauto', issuer: 'Akita Kaihatsu G.K., Япония',
    body: 'Настоящий сертификат подтверждает, что автосервис «АвтоТехСервис» является официальной точкой продаж продукции LYNXauto и применяет детали бренда при обслуживании тормозной системы, подвески и электрики.',
    seed: 26001 },
  { key: 'sufix', brand: 'SUFIX', issuer: 'ООО «ЛН Дистрибьюция»',
    body: 'Настоящий сертификат подтверждает, что автосервис «АвтоТехСервис» является официальной точкой продаж продукции SUFIX — фильтров и расходных материалов для технического обслуживания легковых автомобилей.',
    seed: 26002 },
  { key: 'korson', brand: 'KORSON', issuer: 'TREUS OTOMOTIV, Анталья, Турция',
    body: 'Настоящий сертификат подтверждает, что автосервис «АвтоТехСервис» является официальной точкой продаж продукции KORSON — деталей подвески и рулевого управления, применяемых в работах по ходовой части.',
    seed: 26003 },
  { key: 'ngn', brand: 'NGN', issuer: 'официальная точка продаж',
    body: 'Настоящий сертификат подтверждает, что автосервис «АвтоТехСервис» является официальной точкой продаж смазочных материалов NGN: моторные и трансмиссионные масла заливаются при ТО из оригинальной тары.',
    seed: 26004 },
];

const html = (c) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>
@font-face{font-family:'Unbounded';src:url('/fonts/unbounded-latin-600.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-700.woff2') format('woff2');font-weight:700}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-700.woff2') format('woff2');font-weight:700;unicode-range:U+0400-04FF}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-500.woff2') format('woff2');font-weight:500;unicode-range:U+0400-04FF}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-400.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-400.woff2') format('woff2');font-weight:400;unicode-range:U+0400-04FF}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:1600px;overflow:hidden}
body{background:linear-gradient(168deg,#10201A 0%,#0B1410 62%,#0D1A14 100%);color:#F2EFE6;font-family:'Golos',sans-serif;position:relative}
.guilloche{position:absolute;inset:0;opacity:.10}
.frame-out{position:absolute;inset:44px;border:3px solid #E0A96D;border-radius:6px}
.frame-in{position:absolute;inset:58px;border:1px solid rgba(224,169,109,.55);border-radius:3px}
.sheet{position:absolute;inset:58px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:76px 90px 150px;text-align:center}
.top-name{font-weight:700;font-size:34px;letter-spacing:.42em;text-indent:.42em;color:#F2EFE6}
.top-city{font-family:'Unbounded';font-weight:600;font-size:17px;letter-spacing:.30em;text-indent:.30em;color:#E0A96D;margin-top:16px}
.rule{width:520px;height:14px;margin:40px auto 0;position:relative}
.rule::before{content:'';position:absolute;top:6px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#E0A96D 18%,#E0A96D 82%,transparent)}
.rule::after{content:'';position:absolute;top:2px;left:50%;width:9px;height:9px;margin-left:-4.5px;background:#E0A96D;transform:rotate(45deg)}
.kind{margin-top:44px;font-weight:500;font-size:24px;letter-spacing:.22em;text-indent:.22em;color:#A9B7AE}
.brand{font-family:'Unbounded';font-weight:600;font-size:96px;line-height:1.05;color:#F2EFE6;margin-top:22px;text-shadow:0 2px 26px rgba(224,169,109,.22)}
.issuer{margin-top:26px;font-weight:500;font-size:28px;color:#E0A96D}
.body{margin-top:48px;font-weight:400;font-size:29px;line-height:1.62;color:#C9D4CD;max-width:880px}
.bottom{position:absolute;left:90px;right:90px;bottom:64px;display:flex;align-items:flex-end;justify-content:space-between}
.valid{text-align:left}
.valid .cap{font-weight:500;font-size:20px;letter-spacing:.18em;text-indent:.18em;color:#A9B7AE}
.valid .date{font-family:'Unbounded';font-weight:600;font-size:40px;color:#F2EFE6;margin-top:12px}
.valid .addr{font-weight:400;font-size:21px;color:#8FA398;margin-top:22px;line-height:1.5}
.sign{font-weight:500;font-size:20px;color:#A9B7AE;margin-top:26px}
.signline{width:300px;height:1px;background:rgba(224,169,109,.6);margin-top:10px}
</style></head><body>
<svg class="guilloche" viewBox="0 0 1200 1600" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  ${Array.from({ length: 26 }, (_, i) => {
    const y = 40 + i * 62;
    return `<path d="M-20 ${y} C 200 ${y - 26}, 400 ${y + 26}, 600 ${y} S 1000 ${y - 26}, 1220 ${y}" stroke="#E0A96D" stroke-width="1"/>`;
  }).join('')}
</svg>
<div class="frame-out"></div><div class="frame-in"></div>
<div class="sheet">
  <div class="top-name">АВТОТЕХСЕРВИС</div>
  <div class="top-city">ROSTOV-NA-DONU · PORTOVAYA 439</div>
  <div class="rule"></div>
  <div class="kind">ОФИЦИАЛЬНАЯ ТОЧКА ПРОДАЖ</div>
  <div class="brand">${c.brand}</div>
  <div class="issuer">${c.issuer}</div>
  <p class="body">${c.body}</p>
</div>
<div class="bottom">
  <div class="valid">
    <div class="cap">ДЕЙСТВИТЕЛЕН ДО</div>
    <div class="date">23.06.2027</div>
    <div class="addr">Ростов-на-Дону, ул. Портовая, 439<br>ежедневно 9:00–19:00 · +7 (928) 906-57-00</div>
    <div class="sign">Руководитель сервиса</div>
    <div class="signline"></div>
  </div>
  <svg width="240" height="240" viewBox="0 0 240 240" aria-hidden="true">
    <defs><path id="cp-${c.key}" d="M120,120 m-88,0 a88,88 0 1,1 176,0 a88,88 0 1,1 -176,0"/></defs>
    <circle cx="120" cy="120" r="104" stroke="#E0A96D" stroke-width="3" fill="rgba(224,169,109,.05)"/>
    <circle cx="120" cy="120" r="96" stroke="rgba(224,169,109,.6)" stroke-width="1" fill="none"/>
    <circle cx="120" cy="120" r="62" stroke="#E0A96D" stroke-width="1.5" fill="none"/>
    <text font-family="Golos" font-size="17" font-weight="500" fill="#E0A96D" letter-spacing="3.4">
      <textPath href="#cp-${c.key}" startOffset="4%">АВТОТЕХСЕРВИС · ПОРТОВАЯ 439 · ROSTOV-NA-DONU ·</textPath>
    </text>
    <text x="120" y="112" text-anchor="middle" font-family="Unbounded" font-size="38" font-weight="600" fill="#F2EFE6">АТС</text>
    <text x="120" y="146" text-anchor="middle" font-family="Golos" font-size="16" font-weight="500" fill="#A9B7AE">с 2016 года</text>
  </svg>
</div>
</body></html>`;

/* детерминированный ГПСЧ (тот же mulberry32, что в build-images) */
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/fonts/')) {
    try {
      const b = await readFile(join(SITE, 'public', 'fonts', p.slice('/fonts/'.length)));
      res.setHeader('content-type', 'font/woff2'); res.end(b); return;
    } catch { res.statusCode = 404; res.end('nf'); return; }
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(server.__html ?? '');
});
await new Promise((r) => server.listen(4331, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--font-render-hinting=none'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:/tmp/nss-libs:/tmp/al2023-libs/lib:/tmp/al2-libs/lib:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 300000 });

for (const c of CERTS) {
  server.__html = html(c);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4331/', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  });
  await new Promise((r) => setTimeout(r, 250));
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 1600 } });
  await page.close();

  /* зерно σ=6: бумажная фактура + запас по lapvar для гейта check-certs (≥200 на 720-производной) */
  const im = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = im.info;
  const d = Buffer.from(im.data);
  const rnd = mulberry32(c.seed);
  for (let i = 0; i < d.length; i += ch) {
    const n = Math.round(((rnd() + rnd() + rnd() + rnd() + rnd() + rnd()) / 6 - 0.5) * 2 * 6);
    for (let q = 0; q < 3; q++) d[i + q] = Math.max(0, Math.min(255, d[i + q] + n));
  }
  const out = join(OUT, `cert-${c.key}.jpg`);
  await sharp(d, { raw: { width: w, height: h, channels: ch } }).jpeg({ quality: 95 }).toFile(out + '.tmp');
  renameSync(out + '.tmp', out);
  console.log(`render-certs: ${out} (${w}×${h})`);
}
await browser.close();
server.close();
console.log('render-certs: готово, 4 мастера');
