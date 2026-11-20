/**
 * Раунд 17 (задание №19): МОК-рендеры секции «Три направления» и кропы с сеткой
 * безопасной зоны. В sandbox НЕТ браузера (Chromium/Puppeteer недоступны), поэтому
 * кадры собираются детерминированно по тем же CSS-формулам, что проверят гейты:
 * cover-кроп фона секции (background-position 50% 45%), cover-кроп карточек
 * (object-position 50% 50%), скрим .tri-bg::after (стопы из sections.css),
 * тонировка акцентной карточки (#1C3126, soft-light, 50%), скругление var(--r).
 * Текст рисуется SVG-блоками ПОД РЕАЛЬНЫЕ метрики (падинги 30/26/28, размеры шрифтов
 * из sections.css) — это макет для доказательства геометрии, не замена рендера:
 * оркестратор переснимает в Chromium. Файлы лежат в evaluation/assets/r18-mocks/.
 * Запуск: node site/scripts/mock-dirs-shots.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const R18 = join(HERE, '../../docs/photos-source/r18-dirs');
const IMG = join(HERE, '../public/img');
const OUT = join(HERE, '../../evaluation/assets/r18-mocks');
mkdirSync(OUT, { recursive: true });

const css = readFileSync(join(HERE, '../src/styles/sections.css'), 'utf8');
const m = css.match(/--sc1,([\d.]+)\)\) 0%,rgba\(11,20,16,var\(--sc2,([\d.]+)\)\) 38%,rgba\(11,20,16,var\(--sc3,([\d.]+)\)\)/);
const SC = m ? [+m[1], +m[2], +m[3]] : [.76, .84, .92];
const mSec = css.match(/\.dirs::before\{[^}]*rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 40%,rgba\(11,20,16,([\d.]+)\) 62%,rgba\(11,20,16,([\d.]+)\) 100%/);
const SEC = mSec ? [+mSec[1], +mSec[2], +mSec[3], +mSec[4]] : [.8, .72, .28, .12];
const RADIUS = 18;

const stopA = (stops, t) => {
  for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) {
    const [t0, a0] = stops[k - 1], [t1, a1] = stops[k];
    return a0 + (a1 - a0) * (t - t0) / (t1 - t0);
  }
  return stops[stops.length - 1][1];
};
const secStops = [[0, SEC[0]], [.4, SEC[1]], [.62, SEC[2]], [1, SEC[3]]];
const cardStops = [[0, SC[0]], [.38, SC[1]], [1, SC[2]]];
const OVER = [11, 20, 16];
const softLight = (b, s) => { const sb = s / 255, bb = b / 255; const r = sb <= .5 ? bb - (1 - 2 * sb) * bb * (1 - bb) : bb + (2 * sb - 1) * ((bb > .25 ? Math.sqrt(bb) : ((16 * bb - 12) * bb + 4) * bb) - bb); return Math.round(r * 255); };

/*_cover-кроп мастера в бокс W×H с вертикальной привязкой posY (0.5 = центр) */
async function cover(file, W, H, posY = 0.5) {
  const md = await sharp(file).metadata();
  const s = Math.max(W / md.width, H / md.height);
  const sw = Math.min(md.width, Math.round(W / s)), sh = Math.min(md.height, Math.round(H / s));
  const left = Math.round((md.width - sw) / 2), top = Math.round((md.height - sh) * posY);
  return sharp(file).extract({ left, top, width: sw, height: sh }).resize(W, H);
}
/* вертикальный градиент-скрим поверх raw */
async function scrim(pipe, stops, tint) {
  const r = await pipe.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = r.info; const d = Buffer.from(r.data);
  for (let y = 0; y < h; y++) {
    let a = stopA(stops, y / (h - 1));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      for (let k = 0; k < 3; k++) {
        let v = d[i + k];
        if (tint) v = softLight(v, tint[k]);   /* ::before тонировка — ПОД скримом, как в CSS */
        d[i + k] = v * (1 - a) + OVER[k] * a;
      }
    }
  }
  return sharp(d, { raw: { width: w, height: h, channels: c } });
}
const roundMask = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);

const CARDS = [
  { n: '01', t: 'Колёса', p: 'Шиномонтаж легковой и грузовой, балансировка, правка и прокатка дисков, ремонт порезов и грыж…', l: 'Шиномонтаж и диски →', f: join(R18, 'card-1-wheels-2400.jpg'), tag: 'wheel', accent: false },
  { n: '02', t: 'Ремонт и ТО', p: 'ТО и аппаратная замена масла, ходовая и тормоза, рулевые рейки, развал-схождение…', l: 'Ремонт и обслуживание →', f: join(R18, 'card-2-service-2400.jpg'), tag: 'serv', accent: true },
  { n: '03', t: 'Диагностика', p: 'Компьютерная диагностика, автоэлектрика, ремонт и заправка кондиционеров.…', l: 'Диагностика и электрика →', f: join(R18, 'card-3-diag-2400.jpg'), tag: 'diag', accent: false },
];
/* замеренные оркестратором боксы карточек (§3.1) */
const VPS = [
  { w: 1440, h: 900, cw: 375, ch: 369, cols: 3, head: 150, gap: 18 },
  { w: 1280, h: 800, cw: 375, ch: 369, cols: 3, head: 150, gap: 18 },
  { w: 1024, h: 600, cw: 984, ch: 269, cols: 1, head: 110, gap: 14 },
  { w: 768, h: 1024, cw: 728, ch: 287, cols: 1, head: 110, gap: 14 },
  { w: 390, h: 844, cw: 350, ch: 386, cols: 1, head: 140, gap: 14 },
  { w: 360, h: 800, cw: 332, ch: 387, cols: 1, head: 140, gap: 14 },
];

for (const vp of VPS) {
  const mob = vp.w <= 640;
  const innerW = vp.cols === 3 ? vp.cw * 3 + vp.gap * 2 : vp.cw;
  const rows = vp.cols === 3 ? 1 : 3;
  const triH = rows * vp.ch + (rows - 1) * vp.gap;
  const H = 72 + vp.head + triH + 72;
  const secFile = mob ? join(IMG, 'tri-bg-m-900.webp') : join(IMG, 'tri-bg-2560.webp');
  let bg = await cover(secFile, vp.w, H, 0.45);
  bg = await scrim(bg, secStops, null);
  const layers = [];
  const x0 = Math.round((vp.w - innerW) / 2);
  const yTop = 72 + vp.head;
  const boxes = [];
  for (let i = 0; i < 3; i++) {
    const cx = vp.cols === 3 ? x0 + i * (vp.cw + vp.gap) : x0;
    const cy = vp.cols === 3 ? yTop : yTop + i * (vp.ch + vp.gap);
    boxes.push([cx, cy, vp.cw, vp.ch]);
  }
  for (let i = 0; i < 3; i++) {
    const [cx, cy, cw, ch] = boxes[i];
    let card = await cover(CARDS[i].f, cw, ch, 0.5);
    card = await scrim(card, cardStops, CARDS[i].accent ? [0x1c, 0x31, 0x26] : null);
    const png = await card.png().toBuffer();
    const masked = await sharp(png).ensureAlpha().composite([{ input: await sharp(roundMask(cw, ch, RADIUS)).png().toBuffer(), blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: masked, left: cx, top: cy });
  }
  /* текст: SVG-блоки по метрикам карточки (padding 30/26/28) */
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vp.w}" height="${H}">`;
  svg += `<text x="${x0}" y="${46 + 14}" fill="#4E9E74" font-family="sans-serif" font-size="11.5" letter-spacing="2">ТРИ НАПРАВЛЕНИЯ</text>`;
  svg += `<text x="${x0}" y="${46 + 14 + 22 + 40}" fill="#F4EFE6" font-family="sans-serif" font-size="${mob ? 26 : 36.8}" font-weight="700">Чем сервис занимается каждый день</text>`;
  for (let i = 0; i < 3; i++) {
    const [cx, cy, cw] = boxes[i];
    svg += `<text x="${cx + 26}" y="${cy + 30 + 52}" fill="none" stroke="#C87F45" stroke-width="1.5" font-family="sans-serif" font-size="64" font-weight="600">${CARDS[i].n}</text>`;
    svg += `<text x="${cx + 26}" y="${cy + 30 + 52 + 18 + 22}" fill="#F4EFE6" font-family="sans-serif" font-size="20" font-weight="700">${CARDS[i].t}</text>`;
    svg += `<text x="${cx + 26}" y="${cy + 30 + 52 + 18 + 22 + 26}" fill="#B7C4BB" font-family="sans-serif" font-size="15.5">${CARDS[i].p.slice(0, Math.floor((cw - 52) / 7.8))}</text>`;
    svg += `<text x="${cx + 26}" y="${cy + 30 + 52 + 18 + 22 + 48}" fill="#B7C4BB" font-family="sans-serif" font-size="15.5">${CARDS[i].p.slice(Math.floor((cw - 52) / 7.8), Math.floor((cw - 52) / 3.9))}…</text>`;
    svg += `<text x="${cx + 26}" y="${cy + vp.ch - 28}" fill="#E0A96D" font-family="sans-serif" font-size="14.5">${CARDS[i].l}</text>`;
  }
  svg += `</svg>`;
  layers.push({ input: Buffer.from(svg) });
  await bg.png().composite(layers).jpeg({ quality: 88 }).toFile(join(OUT, `dirs-${vp.w}x${vp.h}.jpg`));
  console.log(`мок dirs-${vp.w}x${vp.h}.jpg: секция ${vp.w}×${H}, карточки ${boxes.map(b => b[2] + '×' + b[3]).join(', ')}`);
}

/* кропы ×2: мастер с сеткой окон §3.1 + безопасной зоной; и увеличенная безопасная зона */
const zones = JSON.parse(readFileSync(join(R18, 'zones.json'), 'utf8'));
const WINDOWS = [
  ['1440/1920', .161, .839, 0, 1, '#E0A96D'], ['1024', 0, 1, .295, .705, '#4E9E74'],
  ['768', 0, 1, .204, .796, '#F4EFE6'], ['390', .198, .802, 0, 1, '#C87F45'], ['360', .214, .786, 0, 1, '#8fd0ff'],
];
for (const c of CARDS) {
  const z = zones.card2400;
  let rects = `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="#00ff88" stroke-width="6"/>`;
  for (const [name, x0, x1, y0, y1, col] of WINDOWS) {
    rects += `<rect x="${x0 * 2400}" y="${y0 * 1600}" width="${(x1 - x0) * 2400}" height="${(y1 - y0) * 1600}" fill="none" stroke="${col}" stroke-width="4" stroke-dasharray="24 14"/>`;
    rects += `<text x="${x0 * 2400 + 12}" y="${y0 * 1600 + 44}" fill="${col}" font-family="sans-serif" font-size="34">${name}</text>`;
  }
  await sharp(c.f).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600">${rects}</svg>`) }])
    .jpeg({ quality: 88 }).toFile(join(OUT, `crop-${c.tag}-grid.jpg`));
  await sharp(c.f).extract({ left: z.x, top: z.y, width: z.w, height: z.h }).resize(1372, 656)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1372" height="656"><rect x="3" y="3" width="1366" height="650" fill="none" stroke="#00ff88" stroke-width="4"/></svg>`) }])
    .jpeg({ quality: 88 }).toFile(join(OUT, `crop-${c.tag}-zone.jpg`));
  console.log(`кропы crop-${c.tag}-grid.jpg / crop-${c.tag}-zone.jpg`);
}
console.log('МОК-RENDER: готово (без браузера, по CSS-формулам; скрим ' + SC.join('/') + ', секция ' + SEC.join('/') + ')');
