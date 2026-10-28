/**
 * Раунд 18 (задание №20): МОК-рендеры секции «О компании» + монтажная сетка мастеров
 * + кропы ×2 с сеткой зон. В sandbox НЕТ браузера (Chromium/Puppeteer недоступны:
 * apt и CDN вне allow-list), поэтому секция собирается детерминированным композитом
 * sharp по тем же формулам, что проверяют гейты: cover-кроп фона (object-position
 * 50% 45% / 50% 35%), скрим .about::before (5 стопов из sections.css), слои
 * .feat-bg/.fact-bg/.btn-bg со своими скримами, скругления var(--r)/10px/999px.
 * Высоты секций — из geometry.json (замер рендером оркестратора), боксы элементов —
 * из таблиц задания. Текст — SVG-блоки по метрикам; это МАКЕТ-доказательство
 * геометрии и света, финальные скрины снимает оркестратор в Chromium.
 * Запуск: node site/scripts/mock-about-shots.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverWindow } from './lib/cover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const R19 = join(HERE, '../../docs/photos-source/r19-about');
const OUT = join(HERE, '../../evaluation/assets/r19-mocks');
mkdirSync(OUT, { recursive: true });
const GEOM = JSON.parse(readFileSync(join(HERE, '../../evaluation/assets/r19-about-current/geometry.json'), 'utf8'));
const Z = JSON.parse(readFileSync(join(R19, 'zones.json'), 'utf8'));
const css = readFileSync(join(HERE, '../src/styles/sections.css'), 'utf8');
const mA = css.match(/rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 12%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 75%,rgba\(11,20,16,([\d.]+)\) 100%/);
const A = mA ? [+mA[1], +mA[2], +mA[3], +mA[4], +mA[5]] : [.88, .86, .8, .62, .45];
const A_STOPS = [[0, A[0]], [.12, A[1]], [.45, A[2]], [.75, A[3]], [1, A[4]]];
const F_STOPS = [[0, .76], [.38, .84], [1, .92]];
const OVER = [11, 20, 16];
const stopA = (st, t) => { for (let k = 1; k < st.length; k++) if (t <= st[k][0]) { const [t0, a0] = st[k - 1], [t1, a1] = st[k]; return a0 + (a1 - a0) * (t - t0) / (t1 - t0); } return st[st.length - 1][1]; };

async function cover(file, W, H, px = .5, py = .5) {
  const md = await sharp(file).metadata();
  const s = Math.max(W / md.width, H / md.height);
  const sw = Math.min(md.width, Math.round(W / s)), sh = Math.min(md.height, Math.round(H / s));
  const left = Math.round((md.width - sw) * px), top = Math.round((md.height - sh) * py);
  return sharp(file).extract({ left, top, width: sw, height: sh }).resize(W, H);
}
async function scrimPipe(pipe, stops, flat) {
  const r = await pipe.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = r.info; const d = Buffer.from(r.data);
  for (let y = 0; y < h; y++) { const a = flat ?? stopA(stops, y / (h - 1));
    for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
      for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * (1 - a) + OVER[k] * a; } }
  return sharp(d, { raw: { width: w, height: h, channels: c } });
}
const mask = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
async function layer(file, x, y, w, h, opts = {}) {
  let p = await cover(file, w, h, opts.px ?? .5, opts.py ?? .5);
  p = await scrimPipe(p, opts.stops || F_STOPS, opts.flat);
  const buf = await p.png().ensureAlpha().composite([{ input: await sharp(mask(w, h, opts.r ?? 0)).png().toBuffer(), blend: 'dest-in' }]).png().toBuffer();
  return { input: buf, left: x, top: y };
}

const FACTS = [['Портовая, 439', 'ост. «3-й Поселковый» ~330 м'], ['9:00–19:00', 'без выходных'], ['Гарантия на работы', 'условия фиксируем в заказ-наряде'], ['Легковые и грузовые', 'включая коммерческий транспорт']];
const FEATS = [['Смета до начала работ', 'Перечень и стоимость — до первого оборота ключа.'], ['Гарантия на работы', 'Условия и срок фиксируются в заказ-наряде.'], ['9:00–19:00', 'Один график всю неделю — удобно планировать.'], ['Легковые и коммерческие', 'Обслуживаем парк от седана до фургона.']];
const VPS = [
  { w: 1440, h: 900, cols: 4, factsCols: 2, head: 100 }, { w: 1280, h: 800, cols: 4, factsCols: 2, head: 100 },
  { w: 1024, h: 600, cols: 4, factsCols: 2, head: 130, port: true }, { w: 768, h: 1024, cols: 2, factsCols: 2, head: 130, port: true },
  { w: 390, h: 844, cols: 1, factsCols: 1, head: 150, port: true }, { w: 360, h: 800, cols: 1, factsCols: 1, head: 150, port: true },
];
const cardH = { 4: [213, 213, 213, 213], 2: [213, 213, 213, 213], 1: [190, 213, 213, 213] };
for (const vp of VPS) {
  const H = GEOM.section_height_by_width[String(vp.w)] || GEOM.section_height_by_width[String(vp.w === 1280 ? 1200 : vp.w)];
  const inner = Math.min(vp.w, 1200) - 40, x0 = Math.round((vp.w - inner) / 2);
  const layers = [];
  /* фон секции A */
  const bgFile = vp.port ? join(R19, 'sec-bg-m-1200.jpg') : join(R19, 'sec-bg-2560.jpg');
  const bg = await scrimPipe(await cover(bgFile, vp.w, H, .5, vp.port ? .35 : .45), A_STOPS);
  /* сетка */
  const gridY = 72 + vp.head;
  const featsH = cardH[vp.cols].reduce((a, b) => a + b, 0) + (vp.cols === 1 ? 3 : vp.cols === 2 ? 1 : 0) * 16 + (vp.cols === 4 ? 0 : 0);
  const featsRows = vp.cols === 4 ? 1 : vp.cols === 2 ? 2 : 4;
  const featsTotal = (vp.cols === 4 ? 213 : vp.cols === 2 ? 213 * 2 + 16 : 190 + 213 * 3 + 14 * 3);
  const featsY = H - 72 - featsTotal;
  let leftW = inner, mediaBox = null;
  if (!vp.port) { leftW = Math.round((inner - 48) * 1.05 / 2); mediaBox = [x0 + leftW + 48, gridY, inner - leftW - 48, Math.round((inner - leftW - 48) * 10 / 16) + 40]; }
  const colW = vp.port ? inner : leftW;
  /* плашки C */
  const fW = vp.factsCols === 1 ? colW : Math.round((colW - 14) / 2);
  const fH = vp.w <= 640 ? 81 : 83;
  const factsY = gridY + 210 + 26;
  for (let i = 0; i < 4; i++) {
    const cx = x0 + (vp.factsCols === 1 ? 0 : (i % 2) * (fW + 14));
    const cy = factsY + Math.floor(i / vp.factsCols) * (fH + 14);
    layers.push(await layer(join(R19, `fact-${i + 1}-${['address', 'hours', 'warranty', 'fleet'][i]}-1600.jpg`), cx, cy, fW, fH, { flat: .9, r: 10 }));
  }
  /* кнопка D */
  const btnY = factsY + (vp.factsCols === 1 ? 4 : 2) * (fH + 14) + 24;
  layers.push(await layer(join(R19, 'btn-cta-1200.jpg'), x0, btnY, 252, 50, { flat: .9, r: 25 }));
  /* карточки B */
  const cw = vp.cols === 4 ? Math.round((inner - 48) / 4) : vp.cols === 2 ? Math.round((inner - 16) / 2) : inner;
  for (let i = 0; i < 4; i++) {
    const r = vp.cols === 4 ? 0 : vp.cols === 2 ? Math.floor(i / 2) : i;
    const ccol = vp.cols === 4 ? i : vp.cols === 2 ? i % 2 : 0;
    const cx = x0 + ccol * (cw + 16), cy = featsY + r * (cardH[vp.cols][i] + 16);
    layers.push(await layer(join(R19, `card-${i + 1}-${['estimate', 'warranty', 'schedule', 'fleet'][i]}-2400.jpg`), cx, cy, cw, cardH[vp.cols][i], { r: 14 }));
  }
  /* текст */
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vp.w}" height="${H}">`;
  svg += `<text x="${x0}" y="${72 + 14}" fill="#C87F45" font-family="sans-serif" font-size="12.5" letter-spacing="2">О КОМПАНИИ</text>`;
  svg += `<text x="${x0}" y="${72 + 14 + 26 + (vp.port ? 26 : 38)}" fill="#F4EFE6" font-family="sans-serif" font-size="${vp.port ? 24 : 36.8}" font-weight="700">«АвтоТехСервис» на Западном: честно, по делу…</text>`;
  svg += `<text x="${x0}" y="${gridY + 30}" fill="#B7C4BB" font-family="sans-serif" font-size="${vp.port ? 15.5 : 17.5}">Мы — автосервис и шиномонтаж на улице Портовой, 439: рядом</text>`;
  svg += `<text x="${x0}" y="${gridY + 56}" fill="#B7C4BB" font-family="sans-serif" font-size="${vp.port ? 15.5 : 17.5}">с остановкой «3-й Поселковый» и базой «Бум»…</text>`;
  for (let i = 0; i < 4; i++) {
    const cx = x0 + (vp.factsCols === 1 ? 0 : (i % 2) * (fW + 14)) + 16;
    const cy = factsY + Math.floor(i / vp.factsCols) * (fH + 14);
    svg += `<text x="${cx}" y="${cy + 30}" fill="#F4EFE6" font-family="sans-serif" font-size="16" font-weight="700">${FACTS[i][0]}</text>`;
    svg += `<text x="${cx}" y="${cy + 52}" fill="#B7C4BB" font-family="sans-serif" font-size="13.5">${FACTS[i][1]}</text>`;
  }
  svg += `<text x="${x0 + 26}" y="${btnY + 31}" fill="#F4EFE6" font-family="sans-serif" font-size="15" font-weight="600" letter-spacing="1">ПОДРОБНЕЕ О СЕРВИСЕ</text>`;
  for (let i = 0; i < 4; i++) {
    const r = vp.cols === 4 ? 0 : vp.cols === 2 ? Math.floor(i / 2) : i;
    const ccol = vp.cols === 4 ? i : vp.cols === 2 ? i % 2 : 0;
    const cx = x0 + ccol * (cw + 16), cy = featsY + r * (cardH[vp.cols][i] + 16);
    svg += `<rect x="${cx + 20}" y="${cy + 24}" width="52" height="52" rx="12" fill="rgba(200,127,69,.14)" stroke="rgba(224,169,109,.35)"/>`;
    svg += `<text x="${cx + 20}" y="${cy + 24 + 52 + 32}" fill="#F4EFE6" font-family="sans-serif" font-size="16.5" font-weight="700">${FEATS[i][0]}</text>`;
    svg += `<text x="${cx + 20}" y="${cy + 24 + 52 + 54}" fill="#B7C4BB" font-family="sans-serif" font-size="14.5">${FEATS[i][1]}</text>`;
  }
  svg += '</svg>';
  layers.push({ input: Buffer.from(svg) });
  await bg.png().composite(layers).jpeg({ quality: 88 }).toFile(join(OUT, `about-${vp.w}x${vp.h}.jpg`));
  console.log(`мок about-${vp.w}x${vp.h}.jpg: H=${H} (geometry.json), колонок feats ${vp.cols}`);
}

/* монтажная сетка 11 мастеров рядом (§4.1 — единство серии) */
{
  const names = ['sec-bg-2560.jpg', 'sec-bg-m-1200.jpg', 'card-1-estimate-2400.jpg', 'card-2-warranty-2400.jpg', 'card-3-schedule-2400.jpg', 'card-4-fleet-2400.jpg', 'fact-1-address-1600.jpg', 'fact-2-hours-1600.jpg', 'fact-3-warranty-1600.jpg', 'fact-4-fleet-1600.jpg', 'btn-cta-1200.jpg'];
  const cellW = 420, cellH = 300, cols = 4;
  const rows = Math.ceil(names.length / cols);
  const tiles = [];
  for (let i = 0; i < names.length; i++) {
    const t = await (await cover(join(R19, names[i]), cellW - 8, cellH - 26, .5, .5)).jpeg({ quality: 85 }).toBuffer();
    tiles.push({ input: t, left: (i % cols) * cellW + 4, top: Math.floor(i / cols) * cellH + 22 });
  }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cellW}" height="${rows * cellH}"><rect width="100%" height="100%" fill="#0B1410"/>`;
  names.forEach((n, i) => { svg += `<text x="${(i % cols) * cellW + 8}" y="${Math.floor(i / cols) * cellH + 16}" fill="#B7C4BB" font-family="sans-serif" font-size="13">${n}</text>`; });
  svg += '</svg>';
  tiles.push({ input: Buffer.from(svg) });
  await sharp({ create: { width: cols * cellW, height: rows * cellH, channels: 3, background: '#0B1410' } })
    .composite(tiles).jpeg({ quality: 88 }).toFile(join(OUT, 'contact-sheet-11.jpg'));
  console.log('монтажная сетка contact-sheet-11.jpg');
}

/* кропы ×2: мастер с сеткой окон + зона; и зона крупно (A×2, B×4, C×4, D×1) */
const winSvg = (W, H, wins, zone, zoneCol = '#00ff88') => {
  let r = `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" fill="none" stroke="${zoneCol}" stroke-width="${Math.max(4, W / 400)}"/>`;
  for (const [name, w] of wins) {
    r += `<rect x="${w.x0}" y="${w.y0}" width="${w.x1 - w.x0}" height="${w.y1 - w.y0}" fill="none" stroke="#E0A96D" stroke-width="${Math.max(3, W / 600)}" stroke-dasharray="${W / 60} ${W / 100}"/>`;
    r += `<text x="${w.x0 + W / 200}" y="${w.y0 + H / 18}" fill="#E0A96D" font-family="sans-serif" font-size="${H / 16}">${name}</text>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${r}</svg>`);
};
const cropSets = [
  ['A-desk', 'sec-bg-2560.jpg', 2560, 1440, Object.entries(GEOM.section_desktop.windows).slice(0, 6).map(([k, v]) => [k, v.window]), Z.secDesk2560],
  ['A-port', 'sec-bg-m-1200.jpg', 1200, 2700, Object.entries(GEOM.section_portrait.windows).slice(0, 6).map(([k, v]) => [k, v.window]), Z.secPort1200],
  ...[1, 2, 3, 4].map(i => [`B${i}`, `card-${i}-${['estimate', 'warranty', 'schedule', 'fleet'][i - 1]}-2400.jpg`, 2400, 1600,
    [['278x213', coverWindow({ W: 2400, H: 1600 }, 278, 213)], ['484x190', coverWindow({ W: 2400, H: 1600 }, 484, 190)], ['332x213', coverWindow({ W: 2400, H: 1600 }, 332, 213)]], Z.card2400]),
  ...[1, 2, 3, 4].map(i => [`C${i}`, `fact-${i}-${['address', 'hours', 'warranty', 'fleet'][i - 1]}-1600.jpg`, 1600, 533,
    [['239x108', coverWindow({ W: 1600, H: 533 }, 239, 108)], ['285x83', coverWindow({ W: 1600, H: 533 }, 285, 83)], ['560x81', coverWindow({ W: 1600, H: 533 }, 560, 81)]], Z.fact1600]),
  ['D', 'btn-cta-1200.jpg', 1200, 400, [['252x50', coverWindow({ W: 1200, H: 400 }, 252, 50)]], Z.btn1200],
];
for (const [tag, file, W, H, wins, zone] of cropSets) {
  await sharp(join(R19, file)).composite([{ input: winSvg(W, H, wins, zone) }]).jpeg({ quality: 88 }).toFile(join(OUT, `crop-${tag}-grid.jpg`));
  await sharp(join(R19, file)).extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${zone.w}" height="${zone.h}"><rect x="3" y="3" width="${zone.w - 6}" height="${zone.h - 6}" fill="none" stroke="#00ff88" stroke-width="4"/></svg>`) }])
    .jpeg({ quality: 88 }).toFile(join(OUT, `crop-${tag}-zone.jpg`));
}
console.log('кропы ×2: ' + cropSets.map(c => c[0]).join(', '));
console.log('МОК-RENDER r19 готов (без браузера, по CSS-формулам и geometry.json)');
