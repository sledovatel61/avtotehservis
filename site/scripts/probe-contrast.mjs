/* Круг 23, приёмка: быстрый пробник контраста ПО ГЛИФАМ (метод ревьюера A6).
   Рендерит /about, снимает кадр с текстом и без него, и меряет контраст только там,
   где текст реально есть: ядро глифа = сильная разница между кадрами.
   Запуск: node scripts/probe-contrast.mjs [1440,1024,390] */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'site', 'pages-dist');
const WIDTHS = (process.argv[2] || '1440,1024,390').split(',').map(Number);

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  let file = join(DIST, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  if (file.endsWith('/') || !file.includes('.')) file = join(file, 'index.html');
  try { const b = await readFile(file);
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.avif') ? 'image/avif' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
    res.end(b); }
  catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise((r) => server.listen(4326, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 600000 });

const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relLum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };
const parseRGB = (c) => { const m = String(c).match(/\d+(\.\d+)?/g) || ['255', '255', '255']; return m.slice(0, 3).map(Number); };

const HIDE = [
  '.page-head .eyebrow,.page-head h1,.page-head .lead',
  '.ab-feats .eyebrow,.ab-feats h2,.ab-feats .feat h3,.ab-feats .feat p,.ab-feats .feat-ic',
  'section[aria-labelledby="ab-text-h"] .container',
      'section[aria-labelledby="ab-cert-h"] .eyebrow,section[aria-labelledby="ab-cert-h"] h2,section[aria-labelledby="ab-cert-h"] .lead,.certs figcaption,.cert-note',
  'section[aria-labelledby="ab-b2b-h"] .container > div',
  '.est-aside > *:not(.est-aside-bg)',
].join(',') + '{visibility:hidden !important}';

const prep = async (page) => page.evaluate(async () => {
  const st = document.createElement('style');
  st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}';
  document.head.appendChild(st);
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; i.decoding = 'sync'; });
  for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
  await Promise.race([Promise.all([...document.images].map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 15000))]);
  window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 250));
});

const out = {};
for (const w of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4326/about/', { waitUntil: 'networkidle0' });
  await prep(page);
  const zones = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height }; };
    const z = (el) => { const b = box(el); b.col = getComputedStyle(el).color; return b; };
    const h = document.querySelector('.page-head');
    const t = document.querySelector('section[aria-labelledby="ab-text-h"]');
    return {
      h1: z(h.querySelector('h1')), lead: z(h.querySelector('.lead')),
      fh3: [...document.querySelectorAll('.ab-feats .feat h3')].map(z),
      fp: [...document.querySelectorAll('.ab-feats .feat p')].map(z),
      th2: z(t.querySelector('h2')), tlead: z(t.querySelector('.lead')),
      headBg: box(document.querySelector('.abh-bg')),
      featsBg: box(document.querySelector('.ab-feats-bg')),
      cards: [...document.querySelectorAll('.ab-feats .feat')].map(box),
    };
  });
  const shot = async (hide) => {
    if (hide) await page.addStyleTag({ content: HIDE });
    await new Promise((r) => setTimeout(r, 250));
    const buf = await page.screenshot({ fullPage: true });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    return { d: data, w: info.width, h: info.height, ch: info.channels };
  };
  const vis = await shot(false);
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('visibility:hidden !important') && s.textContent.includes('.page-head')) s.remove(); }));
  const nt = await shot(true);

  /* ядро глифа: |Δ| яркости между кадром с текстом и без него */
  const glyph = (zone) => {
    const x0 = Math.max(0, Math.round(zone.x)), x1 = Math.min(vis.w, Math.round(zone.x + zone.w));
    const y0 = Math.max(0, Math.round(zone.y)), y1 = Math.min(vis.h, Math.round(zone.y + zone.h));
    const pairs = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * vis.w + x) * vis.ch;
      const dv = 0.2126 * vis.d[i] + 0.7152 * vis.d[i + 1] + 0.0722 * vis.d[i + 2];
      const dn = 0.2126 * nt.d[i] + 0.7152 * nt.d[i + 1] + 0.0722 * nt.d[i + 2];
      if (Math.abs(dv - dn) >= 40) pairs.push([dv, dn]);       /* ядро глифа, без сглаженных краёв */
    }
    if (!pairs.length) return null;
    pairs.sort((a, b) => Math.abs(b[0] - b[1]) - Math.abs(a[0] - a[1]));
    const core = pairs.slice(0, Math.max(20, Math.round(pairs.length * 0.5)));
    let worst = Infinity, worstBg = 0;
    for (const [, dn] of core) {
      const r = ratio(relLum(...parseRGB(zone.col)), relLum(dn, dn, dn));
      if (r < worst) { worst = r; worstBg = dn; }
    }
    const bgs = core.map(([, dn]) => dn).sort((a, b) => a - b);
    return { v: +worst.toFixed(2), n: pairs.length, bg: Math.round(worstBg),
      p95: Math.round(bgs[Math.floor(bgs.length * 0.95)]) };
  };
  const stat = (zone) => {
    const x0 = Math.max(0, Math.round(zone.x)), x1 = Math.min(nt.w, Math.round(zone.x + zone.w));
    const y0 = Math.max(0, Math.round(zone.y)), y1 = Math.min(nt.h, Math.round(zone.y + zone.h));
    let sum = 0, n = 0, gx = 0, gxn = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * nt.w + x) * nt.ch;
      const v = 0.2126 * nt.d[i] + 0.7152 * nt.d[i + 1] + 0.0722 * nt.d[i + 2];
      sum += v; n++;
      if (x + 1 < x1) { const j = i + nt.ch; gx += Math.abs(v - (0.2126 * nt.d[j] + 0.7152 * nt.d[j + 1] + 0.0722 * nt.d[j + 2])); gxn++; }
    }
    return { mean: +(sum / Math.max(1, n)).toFixed(1), detX: +(gx / Math.max(1, gxn)).toFixed(2) };
  };
  out[w] = { stats: { head: stat(zones.headBg), feats: stat(zones.featsBg), cards: zones.cards.map(stat) },
    h1: glyph(zones.h1), lead: glyph(zones.lead),
    fh3: zones.fh3.map(glyph), fp: zones.fp.map(glyph),
    th2: glyph(zones.th2), tlead: glyph(zones.tlead),
  };
  await page.close();
}
await browser.close();
server.close();

for (const [w, r] of Object.entries(out)) {
  const n = (o) => (o ? `${o.v}(bg ${o.bg})` : 'none');
  console.log(`${w}: h1 ${n(r.h1)} | lead ${n(r.lead)} | h3 ${r.fh3.map(n).join('/')} | p ${r.fp.map(n).join('/')}`);
  const st = r.stats;
  console.log(`     фоны: head mean ${st.head.mean} det ${st.head.detX} | feats mean ${st.feats.mean} det ${st.feats.detX} | карточки mean ${st.cards.map((c) => c.mean).join('/')} det ${st.cards.map((c) => c.detX).join('/')}`);
}
console.log('пороги: h1/h3 ≥7, lead/p ≥4,5');
