/* Раунд 22 (задание №24): рендер-замеры страницы «О компании» ТОЛЬКО Chromium
   (puppeteer-core 23 + @sparticuz/chromium 131, headless shell, DPR 1 — методика приёмки).
   Пишет site/data/about-geom.json и скрины в evaluation/assets/r22-about/:
     about-{1440,1280,1024,768,390}.png — вся страница;
     about-head-1440.png, about-feats-1440.png — шапка и карточки крупно;
     services-page-1440.png — каталог /services с фото;
     .notext-{w}.png — служебные кадры (текст скрыт) для фоновых метрик.
   Метрики: фоны page-head и feats (mean/разброс/трети/деталь X-Y/покрытие),
   4 карточки .feat (mean/разброс/Δ), контрасты h1/lead/h3/p по худшему пикселю,
   .about-media (naturalWidth, ширина к колонке), высота текстовой секции на 390,
   overflow, вес страницы (load + пауза, как в спеке B7 круга 21). */
import { createServer } from 'node:http';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'site', 'pages-dist');
const ASSETS = join(ROOT, 'evaluation', 'assets', 'r22-about');
if (!existsSync(ASSETS)) await mkdir(ASSETS, { recursive: true });

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  let file = join(DIST, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  if (file.endsWith('/') || !file.includes('.')) file = join(file, 'index.html');
  try { const b = await readFile(file);
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.avif') ? 'image/avif' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
    res.end(b); }
  catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(4326, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023-libs/lib:/tmp/al2-libs/lib:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 600000 });

const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relLum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };
const IVORY = relLum(0xF4, 0xEF, 0xE6), MIST = relLum(0xB7, 0xC4, 0xBB);

const geom = { widths: {}, contrast: {}, weights: {}, page: {} };

const prep = async (page) => page.evaluate(async () => {
  const st = document.createElement('style');
  st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}';
  document.head.appendChild(st);
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]);
  await Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 10000))]);
  window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 250));
  window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 150));
});

for (const w of [1440, 1280, 1024, 768, 390]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4326/about/', { waitUntil: 'networkidle0' });
  await prep(page);

  const g = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height }; };
    const head = document.querySelector('.page-head');
    const feats = document.querySelector('.ab-feats');
    const text = document.querySelector('section[aria-labelledby="ab-text-h"]');
    const media = document.querySelector('.about-media img');
    const grid = document.querySelector('.about-grid');
    return {
      head: box(head), feats: box(feats), text: box(text),
      headText: [...head.querySelectorAll('.eyebrow,h1,.lead')].map(box),
      textMask: [...text.querySelectorAll('.container > *')].map(box),
      coverText: (() => { const i = text.querySelector('.ab-text-bg img'); if (!i) return null;
        const a = i.getBoundingClientRect(), b = text.getBoundingClientRect();
        return { w: +(a.width / b.width * 100).toFixed(1), h: +(a.height / b.height * 100).toFixed(1) }; })(),
      featCards: [...feats.querySelectorAll('.feat')].map(box),
      featsHead: [...feats.querySelectorAll('.sec-head')].map(box),
      media: box(media), mediaNat: media.naturalWidth,
      mediaSel: +((media.currentSrc || '').match(/ab-media-(\d+)\./) || [0, 0])[1],
      colW: grid ? box(grid.firstElementChild).w : 0,
      rateNotes: document.querySelectorAll('.rate-note').length,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      coverHead: (() => { const i = head.querySelector('.abh-bg img'); if (!i) return null;
        const a = i.getBoundingClientRect(), b = head.getBoundingClientRect();
        return { w: +(a.width / b.width * 100).toFixed(1), h: +(a.height / b.height * 100).toFixed(1) }; })(),
      coverFeats: (() => { const i = feats.querySelector('.ab-feats-bg img'); if (!i) return null;
        const a = i.getBoundingClientRect(), b = feats.getBoundingClientRect();
        return { w: +(a.width / b.width * 100).toFixed(1), h: +(a.height / b.height * 100).toFixed(1) }; })(),
      featImgs: [...feats.querySelectorAll('.feat-bg img')].map(i => i.currentSrc || ''),
    };
  });
  geom.widths[w] = { head: g.head, feats: g.feats, textH: +g.text.h.toFixed(0),
    media: { w: +g.media.w.toFixed(0), nat: g.mediaNat, sel: g.mediaSel, colRatio: +(g.media.w / g.colW).toFixed(2) },
    rateNotes: g.rateNotes, coverHead: g.coverHead, coverFeats: g.coverFeats, coverText: g.coverText };
  geom.scroll = geom.scroll || {};
  geom.scroll[w] = g.scrollW <= g.innerW;

  await page.screenshot({ path: join(ASSETS, `about-${w}.png`), fullPage: true });
  if (w === 1440) {
    await (await page.$('.page-head')).screenshot({ path: join(ASSETS, 'about-head-1440.png') });
    await (await page.$('.ab-feats')).screenshot({ path: join(ASSETS, 'about-feats-1440.png') });
  }

  /* notext-кадр: метрики фонов и подложек */
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.page-head .eyebrow,.page-head h1,.page-head .lead,.ab-feats .eyebrow,.ab-feats h2,.ab-feats .feat h3,.ab-feats .feat p,.ab-feats .feat-ic,section[aria-labelledby="ab-text-h"] .container > *{visibility:hidden !important}';
    document.head.appendChild(st);
  });
  await new Promise(r => setTimeout(r, 150));
  const nt = join(ASSETS, `.notext-${w}.png`);
  await page.screenshot({ path: nt, fullPage: true });

  const img = await sharp(nt).raw().toBuffer({ resolveWithObject: true });
  const iw = img.info.width, ch = img.info.channels, d = img.data;
  const stat = (zone, excl = []) => {
    let s = 0, n = 0, mn = 255, mx = 0, gx = 0, gy = 0, gxn = 0, gyn = 0;
    const t = [0, 0, 0], tn = [0, 0, 0];
    const y0 = Math.max(0, Math.round(zone.y)), y1 = Math.min(img.info.height, Math.round(zone.y + zone.h));
    const x0 = Math.max(0, Math.round(zone.x)), x1 = Math.min(iw, Math.round(zone.x + zone.w));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (excl.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) continue;
      const i = (y * iw + x) * ch; const v = LUM(d[i], d[i + 1], d[i + 2]);
      s += v; n++; mn = Math.min(mn, v); mx = Math.max(mx, v);
      const ti = Math.min(2, Math.floor((x - x0) / Math.max(1, (x1 - x0) / 3))); t[ti] += v; tn[ti]++;
      if (x + 1 < x1 && y + 1 < y1 && !excl.some(b => x + 1 >= b.x && x + 1 <= b.x + b.w && y >= b.y && y <= b.y + b.h)) {
        const j = i + ch; gx += Math.abs(v - LUM(d[j], d[j + 1], d[j + 2])); gxn++; }
      if (y + 1 < y1 && !excl.some(b => x >= b.x && x <= b.x + b.w && y + 1 >= b.y && y + 1 <= b.y + b.h)) {
        const k = i + iw * ch; gy += Math.abs(v - LUM(d[k], d[k + 1], d[k + 2])); gyn++; }
    }
    return { mean: +((s / Math.max(1, n))).toFixed(1), spread: +(mx - mn).toFixed(1),
      thirds: t.map((v, i2) => +(v / Math.max(1, tn[i2])).toFixed(1)),
      detailX: +(gx / Math.max(1, gxn)).toFixed(2), detailY: +(gy / Math.max(1, gyn)).toFixed(2) };
  };
  const worst = (zone, excl = []) => { let wm = 1e9;
    const y0 = Math.max(0, Math.round(zone.y)), y1 = Math.min(img.info.height, Math.round(zone.y + zone.h));
    const x0 = Math.max(0, Math.round(zone.x)), x1 = Math.min(iw, Math.round(zone.x + zone.w));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (excl.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) continue;
      const i = (y * iw + x) * ch; wm = Math.min(wm, LUM(d[i], d[i + 1], d[i + 2])); }
    return wm; };
  geom.widths[w].headBg = stat(g.head);
  geom.widths[w].featsBg = stat(g.feats, [...g.featCards, ...g.featsHead]);
  geom.widths[w].textBg = stat(g.text);
  geom.widths[w].featZones = g.featCards.map(c => stat(c));
  /* контрасты по худшему пикселю подложки */
  const h1z = await page.evaluate(() => { const b = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height }; };
    const h = document.querySelector('.page-head');
    return { h1: b(h.querySelector('h1')), lead: b(h.querySelector('.lead')),
      fh3: b(document.querySelector('.ab-feats .feat h3')), fp: b(document.querySelector('.ab-feats .feat p')),
      ash3: b(document.querySelector('.est-aside h3')), asp: b(document.querySelector('.est-aside p')) }; });
  geom.contrast[w] = {
    h1: +ratio(IVORY, relLum(...[worst(h1z.h1), worst(h1z.h1), worst(h1z.h1)])).toFixed(2),
    lead: +ratio(MIST, relLum(...[worst(h1z.lead), worst(h1z.lead), worst(h1z.lead)])).toFixed(2),
    featH3: +ratio(IVORY, relLum(...[worst(h1z.fh3), worst(h1z.fh3), worst(h1z.fh3)])).toFixed(2),
    featP: +ratio(MIST, relLum(...[worst(h1z.fp), worst(h1z.fp), worst(h1z.fp)])).toFixed(2),
    asideH3: +ratio(IVORY, relLum(...[worst(h1z.ash3), worst(h1z.ash3), worst(h1z.ash3)])).toFixed(2),
    asideP: +ratio(MIST, relLum(...[worst(h1z.asp), worst(h1z.asp), worst(h1z.asp)])).toFixed(2),
  };
  await page.close();
  console.log(`about ${w}: текст ${g.text.h.toFixed(0)} px, медиа ${g.media.w.toFixed(0)} (${(g.media.w / g.colW * 100).toFixed(0)} % колонки), head ${geom.widths[w].headBg.mean}/${geom.widths[w].headBg.detailX}/${geom.widths[w].headBg.detailY}, feats ${geom.widths[w].featsBg.mean}/${geom.widths[w].featsBg.detailX}/${geom.widths[w].featsBg.detailY}, text-bg ${geom.widths[w].textBg.mean}/${geom.widths[w].textBg.detailX}/${geom.widths[w].textBg.detailY}, карточки ${geom.widths[w].featZones.map(z => z.mean).join('/')}`);

  /* вес страницы: load + пауза (методика спеки B7) + base-проход без ab-* (дельта раунда) */
  const measure = async (abortAb) => {
  const pw = await browser.newPage();
  const cdp2 = await pw.createCDPSession(); await cdp2.send('Network.enable');
  if (abortAb) { await pw.setRequestInterception(true);
    pw.on('request', (r) => { /\/img\/ab-/.test(r.url()) ? r.abort() : r.continue(); }); }
  let b2 = 0; cdp2.on('Network.loadingFinished', (e) => { b2 += e.encodedDataLength || 0; });
  await pw.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
  await pw.goto('http://127.0.0.1:4326/about/', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  const total = Math.round(b2 / 1024);
  await pw.close();
  return total; };
  geom.weights[w] = await measure(false);
  geom.weightsBase = geom.weightsBase || {};
  geom.weightsBase[w] = await measure(true);
  console.log(`вес about ${w}: ${geom.weights[w]} КБ (base ${geom.weightsBase[w]}, дельта ${geom.weights[w] - geom.weightsBase[w]})`);
}

/* каталог /services с фото */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4326/services/', { waitUntil: 'networkidle0' });
  await prep(page);
  await page.screenshot({ path: join(ASSETS, 'services-page-1440.png'), fullPage: true });
  await page.close();
}
/* скрины фона «Услуг» после A1 — из прогона render-svc */
for (const w of [1024, 768]) {
  const src = join(ROOT, 'evaluation', 'assets', 'r21-svc', `svc-${w}.png`);
  if (existsSync(src)) await copyFile(src, join(ASSETS, `svc-${w}.png`));
}

writeFileSync(join(ROOT, 'site', 'data', 'about-geom.json'), JSON.stringify(geom, null, 1));
console.log('about-geom.json записан');
await browser.close();
server.close();
