/**
 * Раунд 19 (задание №21): МОК-рендеры секции «О компании» + монтажная сетка мастеров
 * + кропы ×2 с сеткой зон. В sandbox НЕТ браузера (Chromium/Puppeteer недоступны:
 * apt и CDN вне allow-list), поэтому секция собирается детерминированным композитом
 * sharp по тем же формулам, что проверяют гейты: cover-кроп фона (object-position
 * 50% 45% / 50% 35%), скрим .about::before (5 стопов из sections.css), слои
 * .feat-bg/.fact-bg/.btn-bg со своими скримами (раунд 19: у плашек градиент 95deg
 * по X, у кнопки 90deg по X — парсятся из CSS), скругления var(--r)/10px/999px.
 * Порядок r19: sec-head → about-grid (колонка lead+кнопка | фото) → .facts--strip
 * (4 в ряд ≥1025, 2×2 641…1024, 1 колонка ≤640) → .feats. Высоты секций считаются
 * по макетной модели (паддинги 72, margin-top 26/44, строки из clamp-размеров) —
 * это МАКЕТ-доказательство геометрии и света, финальные скрины снимает оркестратор
 * в Chromium. Запуск: node site/scripts/mock-about-shots.mjs
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
const Z = JSON.parse(readFileSync(join(R19, 'zones.json'), 'utf8'));
const css = readFileSync(join(HERE, '../src/styles/sections.css'), 'utf8')
  + readFileSync(join(HERE, '../src/styles/buttons.css'), 'utf8');
const mA = css.match(/rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 12%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 75%,rgba\(11,20,16,([\d.]+)\) 100%/);
const A = mA ? [+mA[1], +mA[2], +mA[3], +mA[4], +mA[5]] : [.88, .86, .8, .62, .45];
const A_STOPS = [[0, A[0]], [.12, A[1]], [.45, A[2]], [.75, A[3]], [1, A[4]]];
const F_STOPS = [[0, .76], [.38, .84], [1, .92]];
/* раунд 19 (§2.1): горизонтальные градиенты плашек и кнопки — из CSS */
const mC = css.match(/\.fact-bg::after\{[^}]*linear-gradient\(95deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
const C_STOPS = mC ? [[0, +mC[1]], [.45, +mC[2]], [1, +mC[3]]] : [[0, .8], [.45, .76], [1, .78]];
const mD = css.match(/\.btn-bg::after\{[^}]*linear-gradient\(90deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 50%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
const D_STOPS = mD ? [[0, +mD[1]], [.5, +mD[2]], [1, +mD[3]]] : [[0, .76], [.5, .72], [1, .74]];
const OVER = [11, 20, 16];
const stopA = (st, t) => { for (let k = 1; k < st.length; k++) if (t <= st[k][0]) { const [t0, a0] = st[k - 1], [t1, a1] = st[k]; return a0 + (a1 - a0) * (t - t0) / (t1 - t0); } return st[st.length - 1][1]; };

async function cover(file, W, H, px = .5, py = .5) {
  const md = await sharp(file).metadata();
  const s = Math.max(W / md.width, H / md.height);
  const sw = Math.min(md.width, Math.round(W / s)), sh = Math.min(md.height, Math.round(H / s));
  const left = Math.round((md.width - sw) * px), top = Math.round((md.height - sh) * py);
  return sharp(file).extract({ left, top, width: sw, height: sh }).resize(W, H);
}
async function scrimPipe(pipe, stops, opts = {}) {
  const r = await pipe.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = r.info; const d = Buffer.from(r.data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = opts.dirX ? x / (w - 1) : y / (h - 1);
    const a = opts.flat ?? stopA(stops, t);
    const i = (y * w + x) * c;
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * (1 - a) + OVER[k] * a;
  }
  return sharp(d, { raw: { width: w, height: h, channels: c } });
}
const mask = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
async function layer(file, x, y, w, h, opts = {}) {
  let p = await cover(file, w, h, opts.px ?? .5, opts.py ?? .5);
  p = await scrimPipe(p, opts.stops || F_STOPS, opts);
  const buf = await p.png().ensureAlpha().composite([{ input: await sharp(mask(w, h, opts.r ?? 0)).png().toBuffer(), blend: 'dest-in' }]).png().toBuffer();
  return { input: buf, left: x, top: y };
}

const FACTS = [['Ростов-на-Дону, ул. Портовая, 439', 'ост. «3-й Поселковый» ~330 м'], ['9:00–19:00', 'без выходных'], ['Гарантия на работы', 'условия фиксируем в заказ-наряде'], ['Легковые и грузовые', 'включая коммерческий транспорт']];
const FEATS = [['Смета до начала работ', 'Перечень и стоимость — до первого оборота ключа.'], ['Гарантия на работы', 'Условия и срок фиксируются в заказ-наряде.'], ['9:00–19:00', 'Один график всю неделю — удобно планировать.'], ['Легковые и коммерческие', 'Обслуживаем парк от седана до фургона.']];
const LEAD1 = ['Мы — автосервис и шиномонтаж на улице Портовой, 439: рядом', 'с остановкой «3-й Поселковый» и базой «Бум». Принимаем легковые', 'и коммерческие автомобили ежедневно, с 9:00 до 19:00.'];
const LEAD2 = ['За одним визитом здесь закрывают и «переобуться», и стук в подвеске,', 'и горящий «чек»: от балансировки до ремонта двигателя и АКПП.', 'Правило одно для всех работ — сначала показываем проблему', 'и называем стоимость, потом берёмся за инструмент.'];
const TITLE_L = { 2: ['«АвтоТехСервис» на Западном: честно,', 'по делу, с сметой до работ'], 4: ['«АвтоТехСервис» на', 'Западном: честно, по', 'делу, с сметой до', 'работ'] };

/* макетная модель: 6 окон из задания №21 (§3) */
const VPS = [
  { w: 1440, h: 900 }, { w: 1222, h: 601 }, { w: 1100, h: 800 },
  { w: 1024, h: 600, port: true }, { w: 768, h: 1024, port: true }, { w: 390, h: 844, port: true },
];
for (const vp of VPS) {
  const w = vp.w;
  const inner = Math.min(w, 1200) - 40, x0 = Math.round((w - inner) / 2);
  const desk = w >= 1025;
  /* sec-head: eyebrow 12,5 + h2 clamp(30,3.6vw,46), строки из модели гейта */
  const fs = Math.min(46, Math.max(30, 0.036 * w));
  const tLines = w <= 640 ? 4 : 2;
  const headH = Math.round(18 + 10 + tLines * fs * 1.08 + 30);
  /* about-grid */
  const gridY = 72 + headH;
  const figW = desk ? inner - Math.round((inner - 48) * 1.05 / 2) - 48 : inner;
  const figH = Math.round(figW * 10 / 16) + 44;
  const leadFs = desk ? 17.5 : w <= 640 ? 15.5 : 16.5;
  const leftH = Math.round(LEAD1.length * leadFs * 1.6 + 14 + LEAD2.length * leadFs * 1.6 + 24 + 50);
  const gridH = desk ? Math.max(leftH, figH) : leftH + 28 + figH;
  /* facts--strip: ≥1025 4 в ряд (gap 8), 641…1024 2×2 (gap 14), ≤640 1 колонка */
  const factsY = gridY + gridH + 26;
  const fCols = desk ? 4 : w > 640 ? 2 : 1;
  const fGap = desk ? 8 : 14;
  const fW = Math.round((inner - (fCols - 1) * fGap) / fCols);
  const fH = w <= 640 ? 81 : 83;
  const fRows = Math.ceil(4 / fCols);
  const factsH = fRows * fH + (fRows - 1) * fGap;
  /* feats */
  const featsY = factsY + factsH + 44;
  const bCols = desk ? 4 : w > 640 ? 2 : 1;
  const cw = Math.round((inner - (bCols - 1) * 16) / bCols);
  const bRows = Math.ceil(4 / bCols);
  const cardHs = w <= 640 ? [190, 213, 213, 213] : [213, 213, 213, 213];
  const featsH = cardHs.slice(0, bRows).reduce((a, b) => a + b, 0) + (bRows - 1) * 16 + (w <= 640 ? 14 * (bRows - 1) - 16 * (bRows - 1) : 0);
  const H = featsY + featsH + 72;

  const layers = [];
  /* фон секции A */
  const bgFile = vp.port ? join(R19, 'sec-bg-m-1200.jpg') : join(R19, 'sec-bg-2560.jpg');
  const bg = await scrimPipe(await cover(bgFile, w, H, .5, vp.port ? .35 : .45), A_STOPS);
  /* фото фасада (настоящее, не AI) */
  {
    const fx = desk ? x0 + inner - figW : x0, fy = desk ? gridY : gridY + leftH + 28;
    const photo = await (await cover(join(HERE, '../public/img/about-service-960.webp'), figW - 2, figH - 44 - 2, .5, .38)).jpeg({ quality: 88 }).toBuffer();
    layers.push({ input: photo, left: fx + 1, top: fy + 1 });
  }
  /* плашки C — полосой под сеткой, градиент 95deg по X */
  for (let i = 0; i < 4; i++) {
    const cx = x0 + (i % fCols) * (fW + fGap);
    const cy = factsY + Math.floor(i / fCols) * (fH + fGap);
    layers.push(await layer(join(R19, `fact-${i + 1}-${['address', 'hours', 'warranty', 'fleet'][i]}-1600.jpg`), cx, cy, fW, fH, { stops: C_STOPS, dirX: true, r: 10 }));
  }
  /* кнопка D — в левой колонке под lead, градиент 90deg по X */
  const btnX = x0, btnY = desk ? gridY + leftH - 50 : gridY + leftH - 50;
  layers.push(await layer(join(R19, 'btn-cta-1200.jpg'), btnX, btnY, 252, 50, { stops: D_STOPS, dirX: true, r: 25 }));
  /* карточки B */
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(i / bCols), ccol = i % bCols;
    const cx = x0 + ccol * (cw + 16), cy = featsY + r * (cardHs[i] + 16);
    layers.push(await layer(join(R19, `card-${i + 1}-${['estimate', 'warranty', 'schedule', 'fleet'][i]}-2400.jpg`), cx, cy, cw, cardHs[i], { r: 14 }));
  }
  /* текст */
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}">`;
  svg += `<text x="${x0}" y="${72 + 14}" fill="#C87F45" font-family="sans-serif" font-size="12.5" letter-spacing="2">О КОМПАНИИ</text>`;
  TITLE_L[tLines].forEach((t, k) => { svg += `<text x="${x0}" y="${72 + 18 + 10 + (k + 1) * fs * 1.08 - fs * 0.22}" fill="#F4EFE6" font-family="sans-serif" font-size="${fs.toFixed(1)}" font-weight="700">${t}</text>`; });
  const leadX = x0; let ly = gridY + leadFs * 1.7;
  for (const t of LEAD1) { svg += `<text x="${leadX}" y="${ly.toFixed(0)}" fill="#B7C4BB" font-family="sans-serif" font-size="${leadFs}">${t}</text>`; ly += leadFs * 1.7; }
  ly += 14;
  for (const t of LEAD2) { svg += `<text x="${leadX}" y="${ly.toFixed(0)}" fill="#B7C4BB" font-family="sans-serif" font-size="${leadFs}">${t}</text>`; ly += leadFs * 1.7; }
  for (let i = 0; i < 4; i++) {
    const cx = x0 + (i % fCols) * (fW + fGap) + 16;
    const cy = factsY + Math.floor(i / fCols) * (fH + fGap);
    svg += `<text x="${cx}" y="${cy + 34}" fill="#F4EFE6" font-family="sans-serif" font-size="16" font-weight="700">${FACTS[i][0]}</text>`;
    svg += `<text x="${cx}" y="${cy + 58}" fill="#B7C4BB" font-family="sans-serif" font-size="13.5">${FACTS[i][1]}</text>`;
  }
  svg += `<text x="${btnX + 26}" y="${btnY + 31}" fill="#F4EFE6" font-family="sans-serif" font-size="15" font-weight="600">Подробнее о сервисе</text>`;
  const figX = desk ? x0 + inner - figW : x0, figY = desk ? gridY : gridY + leftH + 28;
  svg += `<text x="${figX + 16}" y="${figY + figH - 16}" fill="#B7C4BB" font-family="sans-serif" font-size="13.5">Ростов-на-Дону, ул. Портовая, 439 — въезд со стороны Портовой</text>`;
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(i / bCols), ccol = i % bCols;
    const cx = x0 + ccol * (cw + 16), cy = featsY + r * (cardHs[i] + 16);
    svg += `<rect x="${cx + 20}" y="${cy + 24}" width="52" height="52" rx="12" fill="rgba(200,127,69,.14)" stroke="rgba(224,169,109,.35)"/>`;
    svg += `<text x="${cx + 20}" y="${cy + 112}" fill="#F4EFE6" font-family="sans-serif" font-size="16.5" font-weight="700">${FEATS[i][0]}</text>`;
    svg += `<text x="${cx + 20}" y="${cy + 136}" fill="#B7C4BB" font-family="sans-serif" font-size="14.5">${FEATS[i][1]}</text>`;
  }
  svg += '</svg>';
  layers.push({ input: Buffer.from(svg) });
  await bg.png().composite(layers).jpeg({ quality: 88 }).toFile(join(OUT, `about-${w}x${vp.h}.jpg`));
  console.log(`мок about-${w}x${vp.h}.jpg: H=${H} (макетная модель), плашек в ряду ${fCols} (${fW}px), карточек в ряду ${bCols}`);
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
  ['A-desk', 'sec-bg-2560.jpg', 2560, 1440, [['1440x1156', coverWindow({ W: 2560, H: 1440 }, 1440, 1156)], ['1025x1207', coverWindow({ W: 2560, H: 1440 }, 1025, 1207)]], Z.secDesk2560],
  ['A-port', 'sec-bg-m-1200.jpg', 1200, 2700, [['768x1764', coverWindow({ W: 1200, H: 2700 }, 768, 1764)], ['390x2392', coverWindow({ W: 1200, H: 2700 }, 390, 2392)]], Z.secPort1200],
  ...[1, 2, 3, 4].map(i => [`B${i}`, `card-${i}-${['estimate', 'warranty', 'schedule', 'fleet'][i - 1]}-2400.jpg`, 2400, 1600,
    [['278x213', coverWindow({ W: 2400, H: 1600 }, 278, 213)], ['484x213', coverWindow({ W: 2400, H: 1600 }, 484, 213)], ['350x190', coverWindow({ W: 2400, H: 1600 }, 350, 190)]], Z.card2400]),
  ...[1, 2, 3, 4].map(i => [`C${i}`, `fact-${i}-${['address', 'hours', 'warranty', 'fleet'][i - 1]}-1600.jpg`, 1600, 533,
    [['284x83', coverWindow({ W: 1600, H: 533 }, 284, 83)], ['357x83', coverWindow({ W: 1600, H: 533 }, 357, 83)], ['350x81', coverWindow({ W: 1600, H: 533 }, 350, 81)]], Z.fact1600]),
  ['D', 'btn-cta-1200.jpg', 1200, 400, [['252x50', coverWindow({ W: 1200, H: 400 }, 252, 50)]], Z.btn1200],
];
for (const [tag, file, W, H, wins, zone] of cropSets) {
  await sharp(join(R19, file)).composite([{ input: winSvg(W, H, wins, zone) }]).jpeg({ quality: 88 }).toFile(join(OUT, `crop-${tag}-grid.jpg`));
  await sharp(join(R19, file)).extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${zone.w}" height="${zone.h}"><rect x="3" y="3" width="${zone.w - 6}" height="${zone.h - 6}" fill="none" stroke="#00ff88" stroke-width="4"/></svg>`) }])
    .jpeg({ quality: 88 }).toFile(join(OUT, `crop-${tag}-zone.jpg`));
}
console.log('кропы ×2: ' + cropSets.map(c => c[0]).join(', '));
console.log('МОК-RENDER r19 готов (без браузера, по CSS-формулам и макетной модели)');
