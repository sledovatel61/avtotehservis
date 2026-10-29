/**
 * Раунд 20 (задание №22, части B4/B5/B6/D): ЖИВЫЕ рендеры Chromium
 * (puppeteer-core@23 + @sparticuz/chromium@131, headless 'shell', DPR 2).
 * Снимает секцию «Как мы работаем» и панель на 5 ширинах, меряет геометрию,
 * контраст по худшему пикселю (отдельный прогон с прозрачным текстом),
 * веса ответов по CDP encodedDataLength и горизонтальную прокрутку 360…1920.
 * Результаты: evaluation/assets/r20-steps/*.png + site/data/steps-geom.json.
 * Запуск: node site/scripts/render-steps.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../pages-dist');
const OUT = join(HERE, '../../evaluation/assets/r20-steps');
const GEOM_OUT = join(HERE, '../data/steps-geom.json');
mkdirSync(OUT, { recursive: true }); mkdirSync(dirname(GEOM_OUT), { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  let f = join(DIST, normalize(p).replace(/^([/\\])+/, ''));
  if (p.endsWith('/')) f = join(f, 'index.html');
  try { const b = readFileSync(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(b); }
  catch { try { const b = readFileSync(join(f, 'index.html')); res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); } catch { res.writeHead(404); res.end('nf'); } }
});
await new Promise(r => server.listen(4321, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:4321/avtotehservis';

const puppeteer = (await import('puppeteer-core')).default;
const chromium = (await import('@sparticuz/chromium')).default;
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-gpu'],
  headless: 'shell',
  protocolTimeout: 600000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023-libs/lib:/tmp' },
});

const L = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const lum = (p) => .2126 * L(p[0]) + .7152 * L(p[1]) + .0722 * L(p[2]);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((u, v) => v - u); return (x + .05) / (y + .05); };
const INK = { p: [0x3F, 0x4E, 0x47], h3: [0x0B, 0x14, 0x10], h2: [0x0B, 0x14, 0x10], eye: [0x7A, 0x46, 0x20], mist: [0xB7, 0xC4, 0xBB], brass: [0xE0, 0xA9, 0x6D] };

const geom = { widths: {}, contrast: {}, weights: {}, scroll: {} };

async function prep(page) {
  await page.evaluate(async () => {
    const race = (pr, ms) => Promise.race([pr, new Promise(r => setTimeout(r, ms))]);
    await race(document.fonts.ready, 8000);
    for (let y = 0; y < document.body.scrollHeight; y += 900) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); }
    window.scrollTo(0, 0);
    await race(Promise.all([...document.images].map(i => (i.complete ? 1 : i.decode().catch(() => {})))), 10000);
    const st = document.createElement('style');
    st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}.hdr,.dock{display:none !important}';
    document.head.appendChild(st);
  });
}
const zoneSel = [
  ['eye', '.est-sec .eyebrow'], ['h2', '#est-h'],
  ['p1h', '.est-step:nth-child(1) h3'], ['p1p', '.est-step:nth-child(1) p'],
  ['p2h', '.est-step:nth-child(2) h3'], ['p2p', '.est-step:nth-child(2) p'],
  ['p3h', '.est-step:nth-child(3) h3'], ['p3p', '.est-step:nth-child(3) p'],
  ['p4h', '.est-step:nth-child(4) h3'], ['p4p', '.est-step:nth-child(4) p'],
  ['ah', '.est-aside h3'], ['ap', '.est-aside p'],
];

for (const w of [1440, 1280, 1200, 1024, 900, 768, 390]) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 2 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await prep(page);
  /* геометрия */
  const g = await page.evaluate((zoneSel) => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const sec = document.querySelector('.est-sec');
    const sb = sec.getBoundingClientRect();
    const panels = [...sec.querySelectorAll('.est-step')].map(r);
    const aside = r(sec.querySelector('.est-aside'));
    const zones = {};
    for (const [k, sel] of zoneSel) { const el = sec.querySelector(sel); if (el) { const b = el.getBoundingClientRect(); zones[k] = { x: b.x - sb.x, y: b.y - sb.y, w: b.width, h: b.height }; } }
    /* заливка строк h2 (A3) */
    const lines = (sel) => { const el = document.querySelector(sel); const rg = document.createRange(); rg.selectNodeContents(el);
      const rects = [...rg.getClientRects()].filter(x => x.width > 4); const bw = el.getBoundingClientRect().width;
      return rects.map(x => +(x.width / bw).toFixed(3)); };
    /* A2: about на этой ширине */
    const about = document.querySelector('.about');
    const media = about.querySelector('.about-media');
    const col = about.querySelector('.about-grid > div');
    const lead = about.querySelector('.lead');
    const cs = getComputedStyle(lead);
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const sample = 'Мы — автосервис и шиномонтаж на улице Портовой, 439: рядом с остановкой';
    const charsPerLine = Math.floor(lead.getBoundingClientRect().width / (cv.measureText(sample).width / sample.length));
    return {
      section: { w: sb.width, h: sb.height }, secOrigin: { x: sb.x, y: sb.y }, panels, aside, zones,
      panelsRel: panels.map(p => ({ x: +(p.x - sb.x).toFixed(1), y: +(p.y - sb.y).toFixed(1), w: +p.w.toFixed(1), h: +p.h.toFixed(1) })),
      asideRel: { x: +(aside.x - sb.x).toFixed(1), y: +(aside.y - sb.y).toFixed(1), w: +aside.w.toFixed(1), h: +aside.h.toFixed(1) },
      estLines: lines('#est-h'), aboutLines: lines('#about-h'),
      about: { media: r(media), col: r(col), sectionH: about.getBoundingClientRect().height, charsPerLine },
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    };
  }, zoneSel);
  if (w === 1200 || w === 900) {   /* только геометрия, без скринов и notext */
    geom.widths[w] = { section: g.section, panels: g.panels.map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), w: +p.w.toFixed(1), h: +p.h.toFixed(1) })),
      aside: { x: +g.aside.x.toFixed(1), y: +g.aside.y.toFixed(1), w: +g.aside.w.toFixed(1), h: +g.aside.h.toFixed(1) },
      panelsRel: g.panelsRel, asideRel: g.asideRel,
      gapTop: +(g.aside.y - g.panels[0].y).toFixed(1), gapBottom: +((g.panels[3].y + g.panels[3].h) - (g.aside.y + g.aside.h)).toFixed(1),
      panelHeights: g.panels.map(p => +p.h.toFixed(1)), estLines: g.estLines, aboutLines: g.aboutLines, about: g.about, zones: g.zones };
    await page.close();
    console.log(`рендер ${w}: геометрия only, aside-зазоры ${geom.widths[w].gapTop}/${geom.widths[w].gapBottom}`);
    continue;
  }
  /* скрины */
  const sec = await page.$('.est-sec');
  await sec.screenshot({ path: join(OUT, `steps-${w}.png`) });
  const pan = await page.$('.est-step');
  await pan.screenshot({ path: join(OUT, `panel-${w}.png`) });
  /* прогон без текста — для замера фона под текстом */
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.est-step h3,.est-step p,.est-sec .eyebrow,.est-sec h2,.est-aside h3,.est-aside p,.est-tel,.est-cta,.est-step .n{color:transparent !important;visibility:hidden}';
    document.head.appendChild(st);
  });
  await new Promise(r => setTimeout(r, 120));
  const secNT = await page.$('.est-sec');
  const ntPath = join(OUT, `.notext-${w}.png`);
  await secNT.screenshot({ path: ntPath });
  /* замер фона по зонам */
  const img = await sharp(ntPath).raw().toBuffer({ resolveWithObject: true });
  const iw = img.info.width, ch = img.info.channels, d = img.data;
  const stat = (z) => {
    const x0 = Math.max(0, Math.round(z.x * 2)), y0 = Math.max(0, Math.round(z.y * 2));
    const x1 = Math.min(iw - 1, Math.round((z.x + z.w) * 2)), y1 = Math.min(img.info.height - 1, Math.round((z.y + z.h) * 2));
    let mn = [255, 255, 255], mx = [0, 0, 0], s = 0, n = 0, lmn = 1e9, lmx = -1;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      const i = (y * iw + x) * ch; const px = [d[i], d[i + 1], d[i + 2]];
      const l = lum(px); if (l < lmn) { lmn = l; mn = px; } if (l > lmx) { lmx = l; mx = px; }
      s += (px[0] * .2126 + px[1] * .7152 + px[2] * .0722); n++;
    }
    return { mean: s / n, dark: mn, light: mx, lmn, lmx };
  };
  const cz = {};
  for (const [k, z] of Object.entries(g.zones)) cz[k] = stat(z);
  /* статистика секции и панелей (без текста) */
  /* средняя/трети секции — ТОЛЬКО по фону: панели и aside исключены (они не фон) */
  const boxes = [...g.panels.map(p => ({ x: p.x - g.secOrigin.x, y: p.y - g.secOrigin.y, w: p.w, h: p.h })), { x: g.aside.x - g.secOrigin.x, y: g.aside.y - g.secOrigin.y, w: g.aside.w, h: g.aside.h }];
  const inBox = (x, y) => boxes.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  let bs = 0, bn = 0, bmn = 255, bmx = 0;
  for (let y = 0; y < img.info.height; y += 2) for (let x = 0; x < iw; x += 2) {
    const px = x / 2, py = y / 2; if (inBox(px, py)) continue;
    const i = (y * iw + x) * ch; const v = d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722;
    bs += v; bn++; if (v < bmn) bmn = v; if (v > bmx) bmx = v; }
  const secStat = { mean: bs / bn, dark: [bmn, bmn, bmn], light: [bmx, bmx, bmx], lmn: bmn / 255, lmx: bmx / 255 };
  /* третьи доли — по чистой полосе фона НАД панелями (во всю ширину, без теней) */
  const bandY1 = Math.max(40, Math.round((g.panels[0].y - g.secOrigin.y - 8) * 2));
  const third = (x0, x1) => { let s = 0, n = 0; for (let y = 8; y < bandY1; y += 2) for (let x = Math.round(x0 * 2); x < Math.round(x1 * 2); x += 4) { const i = (y * iw + x) * ch; s += d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722; n++; } return s / Math.max(1, n); };
  const panelStats = g.panels.map(p => stat({ x: p.x - g.secOrigin.x, y: p.y - g.secOrigin.y, w: p.w, h: p.h }));
  geom.widths[w] = {
    section: g.section, panels: g.panels.map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), w: +p.w.toFixed(1), h: +p.h.toFixed(1) })),
    aside: { x: +g.aside.x.toFixed(1), y: +g.aside.y.toFixed(1), w: +g.aside.w.toFixed(1), h: +g.aside.h.toFixed(1) },
    gapTop: +(g.aside.y - g.panels[0].y).toFixed(1), gapBottom: +((g.panels[3].y + g.panels[3].h) - (g.aside.y + g.aside.h)).toFixed(1),
    panelHeights: g.panels.map(p => +p.h.toFixed(1)),
    panelsRel: g.panelsRel, asideRel: g.asideRel,
    estLines: g.estLines, aboutLines: g.aboutLines, about: g.about, zones: g.zones,
    render: {
      secMean: +secStat.mean.toFixed(1), secSpread: +((secStat.lmx - secStat.lmn) * 255).toFixed(1),
      secLumDark: +secStat.dark[1].toFixed(1), secLumLight: +secStat.light[1].toFixed(1),
      thirdL: +third(0, g.section.w / 3).toFixed(1), thirdR: +third(2 * g.section.w / 3, g.section.w).toFixed(1),
      panelMean: panelStats.map(p => +p.mean.toFixed(1)), panelSpread: panelStats.map(p => +((p.lmx - p.lmn) * 255).toFixed(1)),
    },
  };
  geom.contrast[w] = {
    p1: { p: +ratio(INK.p, cz.p1p.dark).toFixed(2), h3: +ratio(INK.h3, cz.p1h.dark).toFixed(2) },
    p2: { p: +ratio(INK.p, cz.p2p.dark).toFixed(2), h3: +ratio(INK.h3, cz.p2h.dark).toFixed(2) },
    p3: { p: +ratio(INK.p, cz.p3p.dark).toFixed(2), h3: +ratio(INK.h3, cz.p3h.dark).toFixed(2) },
    p4: { p: +ratio(INK.p, cz.p4p.dark).toFixed(2), h3: +ratio(INK.h3, cz.p4h.dark).toFixed(2) },
    h2: +ratio(INK.h2, cz.h2.dark).toFixed(2), eye: +ratio(INK.eye, cz.eye.dark).toFixed(2),
    asideP: +ratio(INK.mist, cz.ap.light).toFixed(2), asideH3: +ratio(INK.brass, cz.ah.light).toFixed(2),
    asideBgLight: +cz.ap.light[1].toFixed(1), asideH3BgLight: +cz.ah.light[1].toFixed(1),
    h2BgDark: +cz.h2.dark[1].toFixed(1), eyeBgDark: +cz.eye.dark[1].toFixed(1), pBgDark: +cz.p1p.dark[1].toFixed(1),
  };
  geom.weights[w] = Math.round(bytes / 1024);
  geom.scroll[w] = g.scrollW === g.innerW;
  await page.close();
  console.log(`рендер ${w}: секция ${g.section.h.toFixed(0)} px, панели ${g.panels.map(p => p.h.toFixed(0)).join('/')}, aside-зазоры ${geom.widths[w].gapTop}/${geom.widths[w].gapBottom}, вес ${geom.weights[w]} КБ`);
}
/* веса страницы (B6): DPR 1, как базовый замер оркестратора */
for (const w of [1440, 1024, 768, 390]) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 900) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
  await new Promise(r => setTimeout(r, 800));
  geom.weights[w] = Math.round(bytes / 1024);
  await page.close();
  console.log(`вес DPR1 ${w}: ${geom.weights[w]} КБ`);
}
/* горизонтальная прокрутка 360…1920 */
for (const w of [360, 414, 480, 640, 900, 1100, 1222, 1600, 1920]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 900 });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const ok = await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth);
  geom.scroll[w] = ok;
  await page.close();
}
writeFileSync(GEOM_OUT, JSON.stringify(geom, null, 1));
await browser.close(); server.close();
console.log('steps-geom.json записан; скроны в evaluation/assets/r20-steps/');
const badScroll = Object.entries(geom.scroll).filter(([, v]) => !v).map(([k]) => k);
console.log(badScroll.length ? `FAIL горизонтальная прокрутка на: ${badScroll.join(', ')}` : 'ok   горизонтальной прокрутки нет на 360…1920');
