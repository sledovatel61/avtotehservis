/* Раунд 21 (задание №23): рендер-замеры секции «Услуги» ТОЛЬКО Chromium
   (puppeteer-core 23 + @sparticuz/chromium 131, headless shell).
   Пишет site/data/svc-geom.json и скрины в evaluation/assets/r21-svc/:
     svc-{1440,1280,1024,768,390}.png — секция целиком (DPR 2);
     svc-btn-1440.png / svc-btn-hover-1440.png — кнопка крупно DPR 2 (покой/hover);
     svc-hover-1440.png — карточка в hover;
     .notext-{w}.png — служебные кадры для фоновых метрик (текст скрыт).
   Метрики: фон секции (mean/разброс/трети/межстрочный перепад/профиль строк),
   верхние зоны карточек (mean/разброс/попарная Δ), кнопка (высота/ширина),
   стрелки vs h2 (centerY, right vs контейнер), тексты (scrollHeight/clientHeight),
   контрасты p/h3/кнопки по худшему пикселю подложки, веса CDP encodedDataLength DPR 1. */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'site', 'pages-dist');
const ASSETS = join(ROOT, 'evaluation', 'assets', 'r21-svc');
if (!existsSync(ASSETS)) await mkdir(ASSETS, { recursive: true });

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  const file = join(DIST, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  try { const b = await readFile(file);
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.avif') ? 'image/avif' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    res.end(b); }
  catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(4323, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023-libs/lib:/tmp/al2-libs/lib:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 600000 });

const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relLum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };

const geom = { widths: {}, contrast: {}, weights: {}, scroll: {} };

const prep = async (page) => page.evaluate(async () => {
  const st = document.createElement('style');
  st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}.hdr,.dock{display:none !important}';
  document.head.appendChild(st);
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]);
  await Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 10000))]);
  window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 250));
  window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 150));
});

for (const w of [1440, 1280, 1024, 768, 390]) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:4323/', { waitUntil: 'networkidle0' });
  await prep(page);

  const g = await page.evaluate(() => {
    const sec = document.querySelector('section[aria-labelledby="svc-h"]');
    const sb = sec.getBoundingClientRect();
    const cont = sec.querySelector('.container').getBoundingClientRect();
    const h2 = sec.querySelector('h2').getBoundingClientRect();
    const nav = sec.querySelector('.slider-nav').getBoundingClientRect();
    const head = sec.querySelector('.sec-head').getBoundingClientRect();
    const cards = [...sec.querySelectorAll('.svc-card')].map(c => {
      const b = c.getBoundingClientRect();
      const img = c.querySelector('.svc-img').getBoundingClientRect();
      const btnEl = c.querySelector('.link-more');
      const btn = btnEl.getBoundingClientRect();
      const h3 = c.querySelector('h3'), p = c.querySelector('.svc-body p');
      return { x: b.x - sb.x, y: b.y - sb.y, w: b.width, h: b.height,
        img: { x: img.x - sb.x, y: img.y - sb.y, w: img.width, h: img.height },
        btn: { x: btn.x - sb.x, y: btn.y - sb.y, w: btn.width, h: btn.height },
        h3Clip: h3.scrollHeight <= h3.clientHeight + 1, pClip: p.scrollHeight <= p.clientHeight + 1,
        h3z: (() => { const r = h3.getBoundingClientRect(); return { x: r.x - sb.x, y: r.y - sb.y, w: r.width, h: r.height }; })(),
        pz: (() => { const r = p.getBoundingClientRect(); return { x: r.x - sb.x, y: r.y - sb.y, w: r.width, h: r.height }; })(),
        btnz: (() => { const r = btnEl.getBoundingClientRect(); return { x: r.x - sb.x, y: r.y - sb.y, w: r.width, h: r.height }; })() };
    });
    /* покрытие фона: слой .svc-bg и его <img> должны совпадать с секцией (иначе — шов/поле) */
    const bgWrap = sec.querySelector('.svc-bg');
    const bgImg = bgWrap ? bgWrap.querySelector('img') : null;
    const br = bgWrap ? bgWrap.getBoundingClientRect() : null;
    const ir = bgImg ? bgImg.getBoundingClientRect() : null;
    const bgCover = br && ir ? { w: +(ir.width / sb.width * 100).toFixed(1), h: +(ir.height / sb.height * 100).toFixed(1),
      wrapW: +(br.width / sb.width * 100).toFixed(1), wrapH: +(br.height / sb.height * 100).toFixed(1) } : null;
    return { section: { w: sb.width, h: sb.height }, cont: { x: cont.x - sb.x, w: cont.width }, bgCover,
      h2: { y: h2.y - sb.y, h: h2.height, cy: h2.y + h2.height / 2 - sb.y },
      nav: { x: nav.x - sb.x, y: nav.y - sb.y, w: nav.width, h: nav.height, cy: nav.y + nav.height / 2 - sb.y, right: nav.right - sb.x },
      head: { y: head.y - sb.y, h: head.height }, cards,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  geom.scroll[w] = g.scrollW <= g.innerW;

  /* скрин секции */
  const sec = await page.$('section[aria-labelledby="svc-h"]');
  await sec.screenshot({ path: join(ASSETS, `svc-${w}.png`) });

  /* notext-кадр для фоновых метрик */
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = 'section[aria-labelledby="svc-h"] h2,section[aria-labelledby="svc-h"] .eyebrow,section[aria-labelledby="svc-h"] .svc-tag,section[aria-labelledby="svc-h"] .svc-body h3,section[aria-labelledby="svc-h"] .svc-body p,section[aria-labelledby="svc-h"] .link-more,section[aria-labelledby="svc-h"] .slider-hint{visibility:hidden !important}';
    document.head.appendChild(st);
  });
  await new Promise(r => setTimeout(r, 120));
  const ntPath = join(ASSETS, `.notext-${w}.png`);
  await sec.screenshot({ path: ntPath });

  /* фоновые метрики по notext-кадру (DPR2): исключаем боксы карточек и шапки секции */
  const img = await sharp(ntPath).raw().toBuffer({ resolveWithObject: true });
  const iw = img.info.width, ch = img.info.channels, d = img.data;
  /* зоны фона по спеке: левое поле 8 %, зазоры между карточками (−3 px AA с краёв),
     полоса над карточками и под ними */
  const cardsTop = Math.min(...g.cards.map(c => c.y)), cardsBot = Math.max(...g.cards.map(c => c.y + c.h));
  const leftW = Math.min(g.cont.x, g.section.w * 0.08);
  const stripA = [g.head.y + g.head.h + 8, cardsTop - 8];
  const stripB = [cardsBot + 8, g.section.h - 6];
  const gaps = [];
  for (let i = 0; i + 1 < g.cards.length; i++) {
    const a = g.cards[i], b = g.cards[i + 1];
    if (b.x - (a.x + a.w) > 8 && Math.abs(a.y - b.y) < 4) gaps.push([a.x + a.w + 3, b.x - 3]);
  }
  const isBg = (px, py) => {
    if (px < leftW) return true;
    if (py >= stripA[0] && py <= stripA[1]) return true;
    if (py >= stripB[0] && py <= stripB[1]) return true;
    if (py >= cardsTop && py <= cardsBot) for (const [gx0, gx1] of gaps) if (px >= gx0 && px <= gx1) return true;
    return false;
  };
  let s = 0, n = 0, lmn = 1, lmx = 0;
  const rows = new Map();
  for (let y = 0; y < img.info.height; y += 2) for (let x = 0; x < iw; x += 2) {
    const px = x / 2, py = y / 2;
    if (!isBg(px, py)) continue;
    const i = (y * iw + x) * ch;
    const v = LUM(d[i], d[i + 1], d[i + 2]) / 255;
    s += v; n++; lmn = Math.min(lmn, v); lmx = Math.max(lmx, v);
    { const band = Math.floor(py / 40); const key = px < leftW && leftW > 8 ? `L${band}` : (py >= stripB[0] ? `B${band}` : null);
      if (key) { const r = rows.get(key) ?? { s: 0, n: 0 }; r.s += v; r.n++; rows.set(key, r); }
      const ka = `A${band}`; const ra = rows.get(ka) ?? { s: 0, n: 0 }; ra.s += v; ra.n++; rows.set(ka, ra); }
  }
  const mean = (s / n) * 255, spread = (lmx - lmn) * 255;
  const third = (x0, x1) => { let ts = 0, tn = 0;
    for (let y = 0; y < img.info.height; y += 2) for (let x = Math.round(x0 * 2); x < Math.round(x1 * 2); x += 2) {
      const px = x / 2, py = y / 2; if (!isBg(px, py)) continue;
      const i = (y * iw + x) * ch; ts += LUM(d[i], d[i + 1], d[i + 2]); tn++; }
    return (ts / Math.max(1, tn)); };
  const tL = third(0, g.section.w / 3), tC = third(g.section.w / 3, 2 * g.section.w / 3), tR = third(2 * g.section.w / 3, g.section.w);
  /* ПРИЁМКА КРУГА 21: метрика «шва» переписана. Старая (перепад соседних 40-px полос ≤3)
     мерила фотографические детали кадра, а не шов: живая сцена даёт 15…19, поэтому исполнитель
     заменил каждый пиксель средним по столбцу — фото превратилось в вертикальные полосы.
     Теперь проверяются три честные вещи:
       1) detailX/detailY — средний градиент по X и по Y внутри фона. У живого кадра оба ≥1,5;
          у «полосатого» глитча detailY ≈ 0 (внутри столбца всё одинаково) — дефект ловится прямо;
       2) bandStep — максимальный перепад средних соседних полос 40 px по ВСЕЙ ширине фона
          (усреднение по ширине гасит детали, остаётся только реальная ступенька). */
  const series = {};
  for (const [k, r] of rows) { const g2 = k[0]; const b = +k.slice(1); (series[g2] = series[g2] || []).push([b, (r.s / r.n) * 255]); }
  let bandStep = 0, trend = 0;
  {
    const arr = (series.A ?? []).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    for (let i = 1; i < arr.length; i++) bandStep = Math.max(bandStep, Math.abs(arr[i] - arr[i - 1]));
    if (arr.length) trend = Math.abs(arr[0] - arr[arr.length - 1]);
  }
  let detailX = 0, nx = 0, detailY = 0, ny = 0;
  for (let y = 0; y < img.info.height; y += 2) for (let x = 0; x < iw - 2; x += 2) {
    const px = x / 2, py = y / 2; if (!isBg(px, py)) continue;
    const i = (y * iw + x) * ch, j = (y * iw + x + 2) * ch, k2 = ((y + 2) * iw + x) * ch;
    if (y + 2 >= img.info.height) continue;
    detailX += Math.abs(LUM(d[j], d[j + 1], d[j + 2]) - LUM(d[i], d[i + 1], d[i + 2])); nx++;
    detailY += Math.abs(LUM(d[k2], d[k2 + 1], d[k2 + 2]) - LUM(d[i], d[i + 1], d[i + 2])); ny++;
  }
  detailX = +(detailX / Math.max(1, nx)).toFixed(2); detailY = +(detailY / Math.max(1, ny)).toFixed(2);

  /* зоны карточек (верх .svc-img) — по notext-кадру */
  const zoneStat = (z) => { let zs = 0, zn = 0, zmn = 255, zmx = 0;
    const y0 = Math.max(0, Math.round(z.y * 2)), y1 = Math.min(img.info.height, Math.round((z.y + z.h) * 2));
    const x0 = Math.max(0, Math.round(z.x * 2)), x1 = Math.min(iw, Math.round((z.x + z.w) * 2));
    if (x1 <= x0 || y1 <= y0) return { mean: -1, spread: -1, off: true };
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * iw + x) * ch; const v = LUM(d[i], d[i + 1], d[i + 2]); zs += v; zn++; zmn = Math.min(zmn, v); zmx = Math.max(zmx, v); }
    return { mean: +(zs / Math.max(1, zn)).toFixed(1), spread: +(zmx - zmn).toFixed(1) }; };
  const cardZones = g.cards.map(c => zoneStat(c.img));
  /* контрасты: худший пиксель подложки под зонами h3/p/кнопки */
  const worstIn = (z) => { let wm = 1e9;
    const y0 = Math.max(0, Math.round(z.y * 2)), y1 = Math.min(img.info.height, Math.round((z.y + z.h) * 2));
    const x0 = Math.max(0, Math.round(z.x * 2)), x1 = Math.min(iw, Math.round((z.x + z.w) * 2));
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * iw + x) * ch; wm = Math.min(wm, LUM(d[i], d[i + 1], d[i + 2])); }
    return wm; };
  const c0 = g.cards[0];
  const pBg = worstIn(c0.pz), h3Bg = worstIn(c0.h3z), btnBg = worstIn(c0.btnz);
  geom.contrast[w] = {
    p: +ratio(relLum(0xB7, 0xC4, 0xBB), relLum(pBg, pBg, pBg)).toFixed(2),
    h3: +ratio(relLum(0xF4, 0xEF, 0xE6), relLum(h3Bg, h3Bg, h3Bg)).toFixed(2),
    btnRest: +ratio(relLum(0xE0, 0xA9, 0x6D), relLum(btnBg, btnBg, btnBg)).toFixed(2),
    btnHover: +ratio(relLum(0xE0, 0xA9, 0x6D), relLum(16, 32, 26)).toFixed(2),
    pBg: +pBg.toFixed(0), h3Bg: +h3Bg.toFixed(0), btnBg: +btnBg.toFixed(0),
  };
  geom.widths[w] = { section: g.section, cont: g.cont, h2: g.h2, nav: g.nav, strips: [stripA, stripB], leftW: +leftW.toFixed(1),
    cardsRel: g.cards.map(c => ({ x: +c.x.toFixed(1), y: +c.y.toFixed(1), w: +c.w.toFixed(1), h: +c.h.toFixed(1), img: c.img })), head: g.head,
    navDy: +(g.nav.cy - g.h2.cy).toFixed(1), navRightDx: +(g.nav.right - (g.cont.x + g.cont.w)).toFixed(1),
    cardH: g.cards.map(c => +c.h.toFixed(1)), btn: g.cards.map(c => ({ w: +c.btn.w.toFixed(1), h: +c.btn.h.toFixed(1) })),
    clip: g.cards.map(c => [c.h3Clip, c.pClip]),
    bg: { mean: +mean.toFixed(1), spread: +spread.toFixed(1), thirds: [+tL.toFixed(1), +tC.toFixed(1), +tR.toFixed(1)], bandStep: +bandStep.toFixed(2), trend: +trend.toFixed(2), detailX, detailY, cover: g.bgCover },
    cardZones };
  await page.close();
  console.log(`рендер ${w}: секция ${g.section.h.toFixed(0)} px, navΔY ${geom.widths[w].navDy}, фон mean ${mean.toFixed(1)} spread ${spread.toFixed(1)}, карточки ${cardZones.slice(0, 3).map(z => z.mean).join('/')}`);

  /* веса DPR1 отдельным прогоном + base-проход без svc-ассетов (дельта = вклад раунда) */
  const measure = async (abortSvc) => {
  const pw = await browser.newPage();
  const cdp2 = await pw.createCDPSession();
  await cdp2.send('Network.enable');
  if (abortSvc) { await pw.setRequestInterception(true);
    pw.on('request', (r) => { /\/img\/svc-/.test(r.url()) ? r.abort() : r.continue(); }); }
  let b2 = 0;
  cdp2.on('Network.loadingFinished', (e) => { b2 += e.encodedDataLength || 0; });
  await pw.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
  /* ПРИЁМКА КРУГА 21: методика веса приведена к спеке B7 — обычная загрузка + пауза,
     без ступенчатого скролла (он догружал все lazy-ассеты ниже первого экрана и завышал
     базу: 694/682/800/729/569 против 691/671/680/562/482 в задании, из-за чего дельта
     раунда «не влезала в запас» при фактическом соответствии потолкам). */
  await pw.goto('http://127.0.0.1:4323/', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  const total = Math.round(b2 / 1024);
  await pw.close();
  return total; };
  geom.weights[w] = await measure(false);
  geom.weightsBase = geom.weightsBase || {};
  geom.weightsBase[w] = await measure(true);
  console.log(`вес DPR1 ${w}: ${geom.weights[w]} КБ (base ${geom.weightsBase[w]}, дельта ${geom.weights[w] - geom.weightsBase[w]})`);
}

/* hover-скрины и кроп кнопки @1440 DPR2 */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:4323/', { waitUntil: 'networkidle0' });
  await prep(page);
  const card = await page.$('.svc-card');
  const btn = await page.$('.svc-card .link-more');
  const bb = await btn.boundingBox();
  await btn.screenshot({ path: join(ASSETS, 'svc-btn-1440.png') });
  await page.hover('.svc-card');
  await new Promise(r => setTimeout(r, 350));
  await btn.screenshot({ path: join(ASSETS, 'svc-btn-hover-1440.png') });
  const sec = await page.$('section[aria-labelledby="svc-h"]');
  await sec.screenshot({ path: join(ASSETS, 'svc-hover-1440.png') });
  void card; void bb;
  await page.close();
  console.log('hover-скрины готовы');
}

writeFileSync(join(ROOT, 'site', 'data', 'svc-geom.json'), JSON.stringify(geom, null, 1));
console.log('svc-geom.json записан');
await browser.close();
server.close();
