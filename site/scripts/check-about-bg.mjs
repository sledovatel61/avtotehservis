/**
 * Раунд 18 (задание №20): гейт фонов секции «О компании» (A секция, B карточки,
 * C плашки, D кнопка). Проверяет:
 *  1) 11 мастеров r19-about на месте, размеры совпадают, raw-исходники есть;
 *  2) 54 производных avif/webp: размеры + вес ≤ CAPS;
 *  3) сюжетные зоны zones.json лежат внутри пересечения окон кропа, посчитанных
 *     ОБЩЕЙ математикой lib/cover.mjs из размеров элемента и object-position,
 *     взятого ИЗ CSS (а не из zones.json и не из вставленных процентов);
 *  4) полоса текста карточки (zones.cardTextBand) — внутри карточки и внутри окна;
 *  5) маска яркости мастеров секции: средняя яркость по прямоугольникам текста
 *     (geometry.json, пересчитаны рендером оркестратора) ≤ 45, надзаголовок ≤ 30 —
 *     на всех 12 десктопных и 9 портретных ширинах + поля/низ десктопа (§2.2–2.3);
 *  6) CSS: слои .about-bg/.feat-bg/.fact-bg/.btn-bg, object-fit:cover,
 *     object-position 50% 45% / 50% 35% / 50% 50%, скримы §3.4, border-radius:inherit,
 *     у .btn и .fact нет background-image;
 *  7) разметка: 1 .about-bg + 4 .feat-bg + 4 .fact-bg + 1 .btn-bg, все <picture>,
 *     loading="lazy", alt="", aria-hidden="true";
 *  8) самопроверка: 10 мутантов, все обязаны уронить гейт.
 * Запуск: node site/scripts/check-about-bg.mjs (exit 1 при провале).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverWindow, commonWindow, insideZone } from './lib/cover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const R19 = join(HERE, '../../docs/photos-source/r19-about');
const IMG = join(HERE, '../public/img');
const GEOM = JSON.parse(readFileSync(join(HERE, '../../evaluation/assets/r19-about-current/geometry.json'), 'utf8'));
const CSS_SEC = readFileSync(join(HERE, '../src/styles/sections.css'), 'utf8');
const CSS_BTN = readFileSync(join(HERE, '../src/styles/buttons.css'), 'utf8');
const ASTRO = readFileSync(join(HERE, '../src/pages/index.astro'), 'utf8');
const css = CSS_SEC + '\n' + CSS_BTN;

const CAPS = {
  'about-bg-2560': { avif: 130, webp: 150 }, 'about-bg-1600': { avif: 80, webp: 95 },
  'about-bg-m-1200': { avif: 110, webp: 130 }, 'about-bg-m-640': { avif: 55, webp: 65 },
  ...Object.fromEntries([1, 2, 3, 4].flatMap(i => [
    [`about-c${i}-1080`, { avif: 50, webp: 58 }], [`about-c${i}-720`, { avif: 30, webp: 35 }], [`about-c${i}-480`, { avif: 18, webp: 22 }]])),
  ...Object.fromEntries([1, 2, 3, 4].flatMap(i => [
    [`about-f${i}-1280`, { avif: 34, webp: 40 }], [`about-f${i}-640`, { avif: 14, webp: 17 }]])),
  'about-btn-640': { avif: 14, webp: 17 }, 'about-btn-320': { avif: 7, webp: 9 },
};
const DERIV = {
  'about-bg-2560': [2560, 1440], 'about-bg-1600': [1600, 900],
  'about-bg-m-1200': [1200, 2700], 'about-bg-m-640': [640, 1440],
  ...Object.fromEntries([1, 2, 3, 4].flatMap(i => [
    [`about-c${i}-1080`, [1080, 720]], [`about-c${i}-720`, [720, 480]], [`about-c${i}-480`, [480, 320]]])),
  ...Object.fromEntries([1, 2, 3, 4].flatMap(i => [
    [`about-f${i}-1280`, [1280, 427]], [`about-f${i}-640`, [640, 213]]])),
  'about-btn-640': [640, 213], 'about-btn-320': [320, 107],
};
const MASTERS = {
  'sec-bg-2560.jpg': [2560, 1440], 'sec-bg-m-1200.jpg': [1200, 2700],
  'card-1-estimate-2400.jpg': [2400, 1600], 'card-2-warranty-2400.jpg': [2400, 1600],
  'card-3-schedule-2400.jpg': [2400, 1600], 'card-4-fleet-2400.jpg': [2400, 1600],
  'fact-1-address-1600.jpg': [1600, 533], 'fact-2-hours-1600.jpg': [1600, 533],
  'fact-3-warranty-1600.jpg': [1600, 533], 'fact-4-fleet-1600.jpg': [1600, 533],
  'btn-cta-1200.jpg': [1200, 400],
};
/* боксы элементов на ширинах из geometry.json (замер рендером оркестратора) */
const secBoxes = Object.entries(GEOM.section_height_by_width)
  .filter(([w]) => +w >= 1025).map(([w, h]) => [+w, h]);
const secPortBoxes = Object.entries(GEOM.section_height_by_width)
  .filter(([w]) => +w <= 1024).map(([w, h]) => [+w, h]);
const CARD_BOXES = [[278, 213], [484, 190], [356, 213], [350, 190], [350, 213], [332, 213]];
const FACT_BOXES = [[239, 108], [239, 110], [285, 108], [285, 83], [332, 81], [350, 81], [357, 83], [374, 81], [390, 81], [423, 83], [485, 83], [560, 81]];
const BTN_BOXES = [[252, 50]];

/* object-position читается ИЗ CSS: мутант «0 0» обязан сдвинуть окна и уронить зоны */
const posOf = (C, re, dflt) => { const m = C.match(re); return m ? m[1].split(' ').map(v => parseFloat(v) / 100) : dflt; };

const zones = JSON.parse(readFileSync(join(R19, 'zones.json'), 'utf8'));
let fail = 0;
const row = (ok, msg) => { if (!ok) fail = 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
async function meanInRect(file, r) {
  const im = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: w, channels: c } = im.info;
  let s = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) { s += luma(im.data, (y * w + x) * c); n++; }
  return s / n;
}

function gate({ css: C, astro: A, zones: z, files, geom, ...opts }) {
  const bad = [];
  for (const [f, [w, h]] of Object.entries(MASTERS)) {
    const m = files.master[f];
    if (!m) bad.push(`мастер ${f} отсутствует`);
    else if (m.width !== w || m.height !== h) bad.push(`мастер ${f}: ${m.width}×${m.height} ≠ ${w}×${h}`);
    if (!files.raw[f.replace('.jpg', '-raw.jpg')]) bad.push(`raw-исходник ${f.replace('.jpg', '-raw.jpg')} отсутствует`);
  }
  for (const [name, [w, h]] of Object.entries(DERIV)) for (const fmt of ['avif', 'webp']) {
    const d = files.deriv[`${name}.${fmt}`];
    if (!d) { bad.push(`${name}.${fmt} отсутствует`); continue; }
    if (d.width !== w || d.height !== h) bad.push(`${name}.${fmt}: ${d.width}×${d.height} ≠ ${w}×${h}`);
    if (d.kb > CAPS[name][fmt]) bad.push(`${name}.${fmt}: ${d.kb} КБ > лимит ${CAPS[name][fmt]}`);
  }
  /* окна кропа — из размеров элементов и object-position ИЗ CSS */
  const pD = posOf(C, /\.about-bg img\{object-fit:cover;object-position:([\d.]+% [\d.]+%)\}/, [.5, .45]);
  const pP = posOf(C, /@media \(max-width:1024px\)\{\.about-bg img\{object-position:([\d.]+% [\d.]+%)\}\}/, [.5, .35]);
  const pM = posOf(C, /\.feat-bg img\{object-fit:cover;object-position:([\d.]+% [\d.]+%)\}/, [.5, .5]);
  const wDesk = commonWindow(secBoxes.map(([w, h]) => coverWindow({ W: 2560, H: 1440, px: pD[0], py: pD[1] }, w, h)));
  const wPort = commonWindow(secPortBoxes.map(([w, h]) => coverWindow({ W: 1200, H: 2700, px: pP[0], py: pP[1] }, w, h)));
  const wCard = commonWindow(CARD_BOXES.map(([w, h]) => coverWindow({ W: 2400, H: 1600, px: pM[0], py: pM[1] }, w, h)));
  const wFact = commonWindow(FACT_BOXES.map(([w, h]) => coverWindow({ W: 1600, H: 533, px: .5, py: .5 }, w, h)));
  const wBtn = commonWindow(BTN_BOXES.map(([w, h]) => coverWindow({ W: 1200, H: 400, px: .5, py: .5 }, w, h)));
  if (!insideZone(z.secDesk2560, wDesk)) bad.push(`zones secDesk2560 вне пересечения окон [${wDesk.x0.toFixed(0)}…${wDesk.x1.toFixed(0)} × ${wDesk.y0.toFixed(0)}…${wDesk.y1.toFixed(0)}]`);
  if (!insideZone(z.secPort1200, wPort)) bad.push(`zones secPort1200 вне пересечения окон [${wPort.x0.toFixed(0)}…${wPort.x1.toFixed(0)} × ${wPort.y0.toFixed(0)}…${wPort.y1.toFixed(0)}]`);
  if (!insideZone(z.card2400, wCard)) bad.push(`zones card2400 вне пересечения окон [${wCard.x0.toFixed(0)}…${wCard.x1.toFixed(0)} × ${wCard.y0.toFixed(0)}…${wCard.y1.toFixed(0)}]`);
  if (!insideZone(z.fact1600, wFact)) bad.push(`zones fact1600 вне пересечения окон [${wFact.x0.toFixed(0)}…${wFact.x1.toFixed(0)} × ${wFact.y0.toFixed(0)}…${wFact.y1.toFixed(0)}]`);
  if (!insideZone(z.btn1200, wBtn)) bad.push(`zones btn1200 вне пересечения окон [${wBtn.x0.toFixed(0)}…${wBtn.x1.toFixed(0)} × ${wBtn.y0.toFixed(0)}…${wBtn.y1.toFixed(0)}]`);
  const band = z.cardTextBand;
  if (!(band.y0 >= 0 && band.y1 <= 1600 && band.y0 < band.y1)) bad.push('полоса текста карточки вне карточки 2400×1600');
  else if (!(band.y0 >= wCard.y0 - 1 && band.y1 <= wCard.y1 + 1)) bad.push(`полоса текста карточки ${band.y0}…${band.y1} вне общего окна кропа ${wCard.y0.toFixed(0)}…${wCard.y1.toFixed(0)}`);
  /* CSS */
  for (const sel of ['.about-bg', '.feat-bg', '.fact-bg', '.btn-bg']) {
    if (!new RegExp(sel.replace('.', '\\.') + '\\{[^}]*position:absolute').test(C)) bad.push(`CSS: нет слоя ${sel}`);
    if (sel !== '.about-bg' && !new RegExp(sel.replace('.', '\\.') + '\\{[^}]*border-radius:inherit').test(C)) bad.push(`CSS: ${sel} без border-radius:inherit`);
  }
  if (!/\.about-bg img\{object-fit:cover/.test(C)) bad.push('CSS: .about-bg img без object-fit:cover');
  if (!/\.about-bg img\{object-fit:cover;object-position:50% 45%/.test(C)) bad.push('CSS: object-position десктопа ≠ 50% 45%');
  if (!/object-position:50% 35%/.test(C)) bad.push('CSS: object-position портрета ≠ 50% 35%');
  if (!/\.feat-bg img\{object-fit:cover;object-position:50% 50%/.test(C)) bad.push('CSS: .feat-bg img object-position ≠ 50% 50%');
  if (!/\.fact-bg img\{object-fit:cover;object-position:50% 50%/.test(C)) bad.push('CSS: .fact-bg img object-position ≠ 50% 50%');
  if (!/\.btn-bg img\{object-fit:cover;object-position:50% 50%/.test(C)) bad.push('CSS: .btn-bg img object-position ≠ 50% 50%');
  const aS = C.match(/\.about::before\{[^}]*rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 12%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 75%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
  if (!aS) bad.push('CSS: нет скрима секции .about::before заявленной формы (§3.4)');
  else { const [, a0, a1, a2, a3, a4] = aS.map(Number); if (a0 < .88 || a1 < .86 || a2 < .8 || a3 < .62 || a4 < .45) bad.push(`CSS: скрим секции ${[a0, a1, a2, a3, a4].join('/')} слабее §3.4`); }
  const gF = C.match(/\.fact-bg::after\{[^}]*linear-gradient\(95deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
  if (!gF) bad.push('CSS: нет градиента скрима плашек .fact-bg::after (95deg, 3 стопа)');
  else { const [, a, b, c] = gF.map(Number);
    if (Math.min(a, b, c) < 0.68 || Math.max(a, b, c) > 0.84) bad.push(`CSS: скрим плашек ${a}/${b}/${c} вне диапазона 0,68…0,84 (§2.1)`); }
  const gB = C.match(/\.btn-bg::after\{[^}]*linear-gradient\(90deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 50%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
  if (!gB) bad.push('CSS: нет градиента скрима кнопки .btn-bg::after (90deg, 3 стопа)');
  else { const [, a, b, c] = gB.map(Number);
    if (Math.min(a, b, c) < 0.66 || Math.max(a, b, c) > 0.84) bad.push(`CSS: скрим кнопки ${a}/${b}/${c} вне диапазона 0,66…0,84 (§2.1)`); }
  /* скрим карточек: значения читаются из CSS, проверяется СМЫСЛ, а не магические числа.
     Требования: монотонное затемнение сверху вниз, верх ≤ .60 (фото у верха читается),
     низ ≤ .84 (фото не залито), шаг ≥ .18. */
  {
    const m = C.match(/\.feat-bg::after\{[^}]*var\(--fc1,([\d.]+)\)[^%]*%?,\s*rgba\(11,20,16,var\(--fc2,([\d.]+)\)/);
    if (!m) bad.push('CSS: нет скрима карточек .feat-bg::after на переменных --fc1/--fc2');
    else {
      const a1 = +m[1], a2 = +m[2];
      const m3 = C.match(/rgba\(11,20,16,var\(--fc3,([\d.]+)\)/);
      const a3 = m3 ? +m3[1] : NaN;
      if (!(a1 < a2 && a2 < a3)) bad.push(`CSS: скрим карточек не монотонный ${a1}/${a2}/${a3}`);
      if (a1 > 0.60) bad.push(`CSS: скрим карточек у верха ${a1} > 0,60 — фото залито (§2.1)`);
      if (a3 > 0.84) bad.push(`CSS: скрим карточек у низа ${a3} > 0,84 — фото залито (§2.1)`);
      if (a3 - a1 < 0.18) bad.push(`CSS: скрим карточек слишком плоский, шаг ${(a3 - a1).toFixed(2)} < 0,18`);
    }
  }
  /* A6 круг 19 (A): обход проверок через opacity/display:none/!important на слоях фона */
  for (const sel of ['feat-bg', 'fact-bg', 'btn-bg', 'about-bg']) {
    /* только одиночные селекторы: списки вида «.about-bg,.feat-bg{display:none}» в
       @media print / prefers-reduced-data законны */
    const re = new RegExp('(?:^|[}\\n])\\.' + sel + '(::after|\\s+img)?\\{[^}]*\\}', 'g');
    for (const decl of C.match(re) || []) {
      if (/!important/.test(decl)) bad.push(`CSS: !important внутри правила .${sel} — обход гейта (A6, круг 19)`);
      const op = decl.match(/(?:^|[;{])opacity:([\d.]+)/);
      if (op && +op[1] < 0.95) bad.push(`CSS: opacity ${op[1]} на .${sel} — слой фона погашен (A6, круг 19)`);
      if (/(?:^|[;{])display:none/.test(decl)) bad.push(`CSS: display:none на .${sel} — слой фона убран (A6, круг 19)`);
    }
  }
  if (/\.btn\{[^}]*background-image/.test(C)) bad.push('CSS: у .btn появился background-image (запрещено §3.3)');
  if (/\.fact\{[^}]*background-image/.test(C)) bad.push('CSS: у .fact появился background-image (запрещено §3.3)');
  if (/\.about\{[^}]*background-image/.test(C)) bad.push('CSS: у .about появился background-image (запрещено §3.3)');
  if (!/\.about \.btn\{[^}]*position:relative;isolation:isolate;overflow:hidden/.test(C)) bad.push('CSS: .about .btn без position:relative;isolation:isolate;overflow:hidden');
  if (!/\.about \.btn--ghost\{border-color:rgba\(224,169,109,\.55\)\}/.test(C)) bad.push('CSS: .about .btn--ghost без рамки .55');
  if (/(?<!\.about )\.btn--ghost\{border-color:rgba\(224,169,109,\.55\)/.test(C)) bad.push('CSS: правка рамки .55 вышла за пределы .about (регресс первого экрана и 3 страниц)');
  /* ---- раунд 19: ПОЛ видимости фона (средняя яркость и разброс деталей слоя) ---- */
  const stA = C.match(/\.about::before\{[^}]*rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 12%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 75%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
  const A_ST = stA ? [[0, +stA[1]], [.12, +stA[2]], [.45, +stA[3]], [.75, +stA[4]], [1, +stA[5]]] : [[0, .88], [.12, .86], [.45, .8], [.75, .62], [1, .45]];
  const stF = C.match(/\.feat-bg::after\{[^}]*var\(--fc1,([\d.]+)\)[^%]*%?,rgba\(11,20,16,var\(--fc2,([\d.]+)\)[^%]*%?,rgba\(11,20,16,var\(--fc3,([\d.]+)\)/);
  const F_ST = stF ? [[0, +stF[1]], [.38, +stF[2]], [1, +stF[3]]] : [[0, .76], [.38, .84], [1, .92]];
  const gF2 = C.match(/\.fact-bg::after\{[^}]*linear-gradient\(95deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
  const FC_ST = gF2 ? [[0, +gF2[1]], [.45, +gF2[2]], [1, +gF2[3]]] : [[0, .8], [.45, .76], [1, .78]];
  const gB2 = C.match(/\.btn-bg::after\{[^}]*linear-gradient\(90deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 50%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
  const BN_ST = gB2 ? [[0, +gB2[1]], [.5, +gB2[2]], [1, +gB2[3]]] : [[0, .76], [.5, .72], [1, .74]];
  const stopAt = (st, t) => { for (let k = 1; k < st.length; k++) if (t <= st[k][0]) { const [t0, a0] = st[k - 1], [t1, a1] = st[k]; return a0 + (a1 - a0) * (t - t0) / (t1 - t0); } return st[st.length - 1][1]; };
  const layerStats = (mp, stops, dir, bandMul) => {
    const { data: d, info } = mp; const w = info.width, h = info.height, c = info.channels;
    let sum = 0, n = 0, mn = 255, mx = 0, bandS = 0, bandN = 0, topS = 0, topN = 0, botS = 0, botN = 0;
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      const t = dir === 'x' ? x / (w - 1) : y / (h - 1);
      const a = stopAt(stops, t); const i = (y * w + x) * c;
      let v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (bandMul && y >= 791 && y <= 1147) v *= bandMul;
      const r = v * (1 - a) + 15.8 * a;
      sum += r; n++; if (r < mn) mn = r; if (r > mx) mx = r;
      if (y >= 791 && y <= 1147) { bandS += r; bandN++; } else if (y < 791) { topS += r; topN++; } else { botS += r; botN++; }
    }
    return { mean: sum / n, spread: mx - mn, band: bandS / Math.max(1, bandN), top: topS / Math.max(1, topN), bot: botS / Math.max(1, botN) };
  };
  const FLOOR_MEAN = 3.0, FLOOR_SPREAD = 40;
  const floorRows = [
    ['A секция', 'sec-bg-2560.jpg', A_ST, 'y'], ['B1', 'card-1-estimate-2400.jpg', F_ST, 'y'],
    ['B2', 'card-2-warranty-2400.jpg', F_ST, 'y'], ['B3', 'card-3-schedule-2400.jpg', F_ST, 'y'],
    ['B4', 'card-4-fleet-2400.jpg', F_ST, 'y'], ['C1', 'fact-1-address-1600.jpg', FC_ST, 'x'],
    ['C2', 'fact-2-hours-1600.jpg', FC_ST, 'x'], ['C3', 'fact-3-warranty-1600.jpg', FC_ST, 'x'],
    ['C4', 'fact-4-fleet-1600.jpg', FC_ST, 'x'], ['D кнопка', 'btn-cta-1200.jpg', BN_ST, 'x'],
  ];
  for (const [tag, f, st, dir] of floorRows) {
    const mp = files.mp[f]; if (!mp) { bad.push(`пол: мастер ${f} недоступен`); continue; }
    const ls = layerStats(mp, st, dir, 1);
    if (ls.mean - 17.8 < FLOOR_MEAN) bad.push(`пол видимости ${tag}: средняя ${ls.mean.toFixed(1)} − база 17,8 < ${FLOOR_MEAN} (фон не читается)`);
    if (ls.spread < FLOOR_SPREAD) bad.push(`пол видимости ${tag}: разброс деталей ${ls.spread.toFixed(0)} < ${FLOOR_SPREAD} (фон залит)`);
    if (opts.verbose) console.log(`info  пол ${tag}: средняя рендера ${ls.mean.toFixed(1)} (над базой +${(ls.mean - 17.8).toFixed(1)} ≥ ${FLOOR_MEAN}), разброс деталей ${ls.spread.toFixed(0)} ≥ ${FLOOR_SPREAD}`);
  }
  /* §2.5: полоса текста B1 темнее верха кадра ≥3 единицы на рендере */
  {
    const mp = files.mp['card-1-estimate-2400.jpg'];
    if (mp) { const ls = layerStats(mp, F_ST, 'y', opts.bandMul ?? 1);
      if (ls.band > ls.top - 3) bad.push(`§2.5: полоса текста B1 ${ls.band.toFixed(1)} не темнее верха ${ls.top.toFixed(1)} − 3`);
      if (ls.bot > ls.band + 3) bad.push(`§2.5: низ карточки B1 ${ls.bot.toFixed(1)} светлее полосы текста ${ls.band.toFixed(1)} + 3 (скрим не монотонный)`);
      if (opts.verbose) console.log(`info  §2.5 B1 рендер верх/полоса/низ: ${ls.top.toFixed(1)}/${ls.band.toFixed(1)}/${ls.bot.toFixed(1)} — полоса темнее верха на ${(ls.top - ls.band).toFixed(1)} (норма ≥3), низ темнее полосы на ${(ls.band - ls.bot).toFixed(1)}`); }
  }
  /* §2.2/2.3: сироты заголовка и плашки адреса — модель переносов, калиброванная
     по замерам оркестратора (760 px → 95/85/18, 820 px → 88/96; плашка 99/12 → 53/57) */
  const TITLE = '«АвтоТехСервис» на Западном: честно, по делу, с сметой до работ';
  const FACTB = 'Ростов-на-Дону, ул. Портовая, 439';
  const emW = (t, tab) => [...t].reduce((a, ch) => a + (ch === ' ' ? tab.sp : /[a-zа-яё]/i.test(ch) ? (ch === ch.toUpperCase() ? tab.up : tab.lo) : /\d/.test(ch) ? tab.dg : tab.pu), 0);
  const wrap = (text, maxEm, tab) => { const words = text.split(' '); const lines = []; let cur = 0;
    for (const w of words) { const we = emW(w, tab) + (cur ? tab.sp : 0);
      if (cur && cur + we > maxEm) { lines.push(cur); cur = emW(w, tab); } else cur += we; }
    lines.push(cur); return lines; };
  const headM = C.match(/\.about \.sec-head\{max-width:(\d+)px\}/);
  const headW = headM ? +headM[1] : 760;
  const T_TAB = { lo: .74, up: .85, sp: .35, dg: .72, pu: .42 };
  for (const vw of [1025, 1100, 1200, 1222, 1280, 1440, 1920]) {
    const block = Math.min(headW, vw - 40);
    const lines = wrap(TITLE, block / 36.8, T_TAB);
    const lastFill = lines[lines.length - 1] * 36.8 / block;
    if (lines.length > 2 || (lines.length === 2 && lastFill < 0.85) || (lines.length > 1 && lastFill < 0.45))
      bad.push(`§2.2 сирота заголовка @${vw}: строк ${lines.length}, заполнение последней ${(lastFill * 100).toFixed(0)} %`);
    if (opts.verbose && (vw === 1440 || vw === 1025)) console.log(`info  §2.2 @${vw}: строк ${lines.length}, заполнения ${lines.map(l => (l * 36.8 / block * 100).toFixed(0)).join('/')} %`);
  }
  const hasBal = /\.about \.fact b\{text-wrap:balance\}/.test(C);
  const gapM = C.match(/\.facts--strip\{grid-template-columns:repeat\(4,1fr\);gap:(\d+)px/);
  const gap = gapM ? +gapM[1] : 8;
  const F_TAB = { lo: .606, up: .704, sp: .293, dg: .587, pu: .352 };
  for (const [vw, plateW] of [[1025, (985 - 3 * gap) / 4], [1440, (1160 - 3 * gap) / 4]]) {
    const content = plateW - 28;
    if (hasBal) {
      const total = emW(FACTB, F_TAB); const half = total / 2;
      const words = FACTB.split(' '); let acc = 0, best = 0;
      for (const w of words) { acc += emW(w, F_TAB) + F_TAB.sp; if (Math.abs(acc - half) < Math.abs(best - half) || !best) best = acc; }
      const l1 = best, l2 = total - best;
      if (Math.min(l1, l2) * 16 / content < 0.45) bad.push(`§2.3 сирота плашки @${vw}: заполнение строк ${(l1 * 16 / content * 100).toFixed(0)}/${(l2 * 16 / content * 100).toFixed(0)} %`);
      else if (opts.verbose) console.log(`info  §2.3 @${vw} (плашка ${plateW.toFixed(0)} px, balance): заполнения строк ${(l1 * 16 / content * 100).toFixed(0)}/${(l2 * 16 / content * 100).toFixed(0)} % (норма ≥45)`);
    } else {
      const lines = wrap(FACTB, content / 16, F_TAB);
      const minFill = Math.min(...lines.map(l => l * 16 / content));
      if (minFill < 0.45) bad.push(`§2.3 сирота плашки @${vw}: строка с заполнением ${(minFill * 100).toFixed(0)} % (< 45, balance снят)`);
    }
  }
  /* §2.4: дыра под фото — facts полосой ПОД сеткой, ширины плашек */
  const gridStart = A.indexOf('class="about-grid"');
  const figEnd = A.indexOf('</figure>', gridStart);
  const stripPos = A.indexOf('facts--strip');
  if (stripPos < figEnd) bad.push('§2.4: .facts не вынесены полосой под .about-grid (дыра под фото вернётся)');
  const w1440 = (1160 - 3 * gap) / 4, w1025 = (985 - 3 * gap) / 4;
  if (stripPos < figEnd) { /* facts в колонке: плашки 2×2 узкие */ }
  else {
    if (w1440 < 280) bad.push(`§2.4: плашка на 1440 = ${w1440.toFixed(0)} px < 280`);
    if (w1025 < 240) bad.push(`§2.4: плашка на 1025 = ${w1025.toFixed(0)} px < 240`);
  }
  if (stripPos < figEnd) { const leftW = (985 - 48) * 1.05 / 2; const plate = (leftW - 14) / 2;
    if (plate < 240) bad.push(`§2.4: плашка в левой колонке на 1025 = ${plate.toFixed(0)} px < 240`); }
  if (!/\.facts--strip\{grid-template-columns:repeat\(4,1fr\)/.test(C)) bad.push('§2.4: .facts--strip не 4 в ряд при ≥1025');
  if (!/@media \(max-width:1024px\)\{\.facts--strip\{grid-template-columns:1fr 1fr/.test(C)) bad.push('§2.4: .facts--strip не 2×2 на 641…1024');
  if (!/@media \(max-width:640px\)\{\.facts--strip\{grid-template-columns:1fr\}/.test(C)) bad.push('§2.4: .facts--strip не 1 колонка на ≤640');

  /* разметка */
  const cnt = (re) => (A.match(re) || []).length;
  if (cnt(/<div class="about-bg" aria-hidden="true">\s*<picture>/g) !== 1) bad.push('разметка: .about-bg c <picture> ≠ 1');
  if (cnt(/<div class="feat-bg" aria-hidden="true"><picture>/g) !== 4) bad.push('разметка: .feat-bg c <picture> ≠ 4');
  if (cnt(/<div class="fact-bg" aria-hidden="true"><picture>/g) !== 4) bad.push('разметка: .fact-bg c <picture> ≠ 4');
  /* вложенность, а не счёт по документу: ровно один слой в КАЖДОЙ карточке и КАЖДОЙ плашке.
     Урок круга 18: четыре .fact-bg подряд лежали в первой плашке, а гейт считал их по документу
     и был зелёным. */
  for (const [cls, n] of [['feat', 4], ['fact', 4]]) {
    const open = new RegExp(`<div class="${cls}[ "][^>]*>`, 'g');
    const seg = A.split(open).slice(1);
    if (seg.length !== n) { bad.push(`разметка: .${cls} найдено ${seg.length}, ожидалось ${n}`); continue; }
    seg.forEach((chunk, i) => {
      const body = chunk.split(new RegExp(`<div class="${cls}[ "]`))[0];
      const got = (body.match(new RegExp(`class="${cls}-bg"`, 'g')) || []).length;
      if (got !== 1) bad.push(`разметка: в .${cls} №${i + 1} слоёв ${cls}-bg = ${got}, ожидался ровно 1`);
    });
  }
  if (cnt(/<span class="btn-bg" aria-hidden="true"><picture>/g) !== 1) bad.push('разметка: .btn-bg c <picture> ≠ 1');
  for (const sel of ['about-bg', 'feat-bg', 'fact-bg', 'btn-bg']) {
    const blocks = A.match(new RegExp(`class="${sel}"[\\s\\S]{0,900}?</picture>`, 'g')) || [];
    for (const b of blocks) if (!/loading="lazy" decoding="async"/.test(b)) bad.push(`разметка: ${sel} без loading=lazy decoding=async`);
    if (blocks.length && !/alt=""/.test(blocks[0])) bad.push(`разметка: ${sel} без alt=""`);
  }
  return bad;
}

async function collect() {
  const files = { master: {}, raw: {}, deriv: {}, mp: {} };
  for (const f of Object.keys(MASTERS)) {
    const p = join(R19, f);
    if (existsSync(p)) { const m = await sharp(p).metadata(); files.master[f] = { width: m.width, height: m.height }; }
    const rp = join(R19, f.replace('.jpg', '-raw.jpg'));
    if (existsSync(rp)) files.raw[f.replace('.jpg', '-raw.jpg')] = true;
    if (existsSync(p)) files.mp[f] = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  }
  for (const name of Object.keys(DERIV)) for (const fmt of ['avif', 'webp']) {
    const p = join(IMG, `${name}.${fmt}`);
    if (!existsSync(p)) continue;
    const m = await sharp(p).metadata(); const st = statSync(p);
    files.deriv[`${name}.${fmt}`] = { width: m.width, height: m.height, kb: +(st.size / 1024).toFixed(1) };
  }
  return files;
}

const files = await collect();
const base = gate({ css, astro: ASTRO, zones, files, geom: GEOM, verbose: true });
for (const b of base) row(false, b);
if (!base.length) row(true, `11 мастеров, ${Object.keys(DERIV).length * 2} производных, зоны, CSS и разметка — совпадают с заявленными`);

/* маска яркости мастеров секции (§2.2–2.3): среднее по прямоугольникам текста */
let maskBad = 0;
for (const [key, file, limitT, limitE] of [
  ['section_desktop', join(R19, 'sec-bg-2560.jpg'), 45, 30],
  ['section_portrait', join(R19, 'sec-bg-m-1200.jpg'), 45, 30],
]) {
  for (const [vp, w] of Object.entries(GEOM[key].windows)) {
    const t = w.text_master, e = w.eyebrow_master;
    const mt = await meanInRect(file, { x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0 });
    const me = await meanInRect(file, { x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0 });
    const ok = mt <= limitT && me <= limitE;
    if (!ok) maskBad++;
    row(ok, `маска ${key.slice(8)} ${vp}: текст ${mt.toFixed(1)} (≤${limitT}), надзаголовок ${me.toFixed(1)} (≤${limitE})`);
  }
}
for (const [r, lim, name] of [
  [{ x: 0, y: 0, w: 558, h: 1440 }, 120, 'поле слева'], [{ x: 1285, y: 0, w: 1275, h: 1440 }, 120, 'поле справа'],
  [{ x: 0, y: 1060, w: 2560, h: 380 }, 70, 'низ под колонкой'],
]) {
  const v = await meanInRect(join(R19, 'sec-bg-2560.jpg'), r);
  row(v <= lim, `маска десктопа ${name}: ${v.toFixed(1)} (≤${lim})`);
  if (v > lim) maskBad++;
}

console.log('--- мутанты (гейт обязан упасть) ---');
const mutants = [
  ['зона сдвинута за край кропа', () => gate({ css, astro: ASTRO, files, zones: { ...zones, card2400: { ...zones.card2400, x: zones.card2400.x + 400 } } })],
  ['object-position: 0 0', () => gate({ css: css.replaceAll('object-position:50% 45%', 'object-position:0% 0%').replaceAll('object-position:50% 50%', 'object-position:0% 0%'), astro: ASTRO, zones, files })],
  ['скрим секции ослаблен до 0,4', () => gate({ css: css.replace(/rgba\(11,20,16,\.88\) 0%,rgba\(11,20,16,\.86\) 12%,rgba\(11,20,16,\.8\) 45%,rgba\(11,20,16,\.62\) 75%,rgba\(11,20,16,\.45\) 100%/, 'rgba(11,20,16,.4) 0%,rgba(11,20,16,.4) 12%,rgba(11,20,16,.4) 45%,rgba(11,20,16,.4) 75%,rgba(11,20,16,.4) 100%'), astro: ASTRO, zones, files })],
  ['фон секции переведён на background-image', () => gate({ css: css.replace('.about{position:relative;background-color:var(--night)}', '.about{position:relative;background-color:var(--night);background-image:url("/img/about-bg-1600.webp")}'), astro: ASTRO, zones, files })],
  ['удалён .about-bg', () => gate({ css, astro: ASTRO.replace(/<div class="about-bg"[\s\S]*?<\/picture>\s*<\/div>/, ''), zones, files })],
  ['полоса текста карточки выведена за карточку', () => gate({ css, astro: ASTRO, zones: { ...zones, cardTextBand: { y0: zones.cardTextBand.y0 + 900, y1: zones.cardTextBand.y1 + 900 } }, files })],
  ['у .btn-bg убран border-radius:inherit', () => gate({ css: css.replace('.btn-bg{position:absolute;inset:0;z-index:-1;border-radius:inherit;', '.btn-bg{position:absolute;inset:0;z-index:-1;'), astro: ASTRO, zones, files })],
  ['все 4 .fact-bg свалены в первую плашку (блокер круга 18)', () => {
    const m = ASTRO.match(/<div class="fact-bg"[\s\S]*?<\/picture><\/div>/g) || [];
    if (m.length !== 4) return ['мутант не собрался'];
    let a = ASTRO;
    for (const blk of m) a = a.replace(blk, '');
    a = a.replace('<div class="fact"><b>{S.address_full}</b>', '<div class="fact">' + m.join('') + '<b>{S.address_full}</b>');
    return gate({ css, astro: a, zones, files });
  }],
  ['рамка .55 вынесена из .about в глобальный .btn--ghost', () => gate({ css: css + '\n.btn--ghost{border-color:rgba(224,169,109,.55)}', astro: ASTRO, zones, files })],
  ['у .fact-bg скрим 0,5', () => gate({ css: css.replace(/\.fact-bg::after\{[^}]*\}/, '.fact-bg::after{content:\'\';position:absolute;inset:0;background:rgba(11,20,16,.5)}'), astro: ASTRO, zones, files })],
  /* раунд 19: семь новых мутантов пола/сирот/дыры */
  ['скрим плашек обратно 0,90', () => gate({ css: css.replace(/\.fact-bg::after\{[^}]*\}/, '.fact-bg::after{content:\'\';position:absolute;inset:0;background:rgba(11,20,16,.9)}'), astro: ASTRO, zones, files })],
  ['скрим кнопки 0,95', () => gate({ css: css.replace(/\.btn-bg::after\{[^}]*\}/, '.btn-bg::after{content:\'\';position:absolute;inset:0;background:rgba(11,20,16,.95)}'), astro: ASTRO, zones, files })],
  ['object-position: 0 0 у плашек (C)', () => gate({ css: css.replace('.fact-bg img{object-fit:cover;object-position:50% 50%}', '.fact-bg img{object-fit:cover;object-position:0 0}'), astro: ASTRO, zones, files })],
  ['.sec-head возвращён к 760 px', () => gate({ css: css.replace('.about .sec-head{max-width:820px}', '.about .sec-head{max-width:760px}'), astro: ASTRO, zones, files })],
  ['.facts возвращены в левую колонку', () => { const m = ASTRO.match(/    <div class="facts facts--strip">[\s\S]*?<\/div>\n/); if (!m) return ['мутант не собрался'];
    const a = ASTRO.replace(m[0], '').replace('<p class="u-mt24">', m[0].trim() + '\n      <p class="u-mt24">');
    return gate({ css, astro: a, zones, files }); }],
  ['у .fact b убран text-wrap:balance', () => gate({ css: css.replace('.about .fact b{text-wrap:balance}', ''), astro: ASTRO, zones, files })],
  ['карточка B1 с полосой ярче верха', () => gate({ css, astro: ASTRO, zones, files, bandMul: 5 })],
];
let mOk = 0;
for (const [name, fn] of mutants) {
  const bad = fn();
  const fell = bad.length > 0;
  if (fell) mOk++;
  console.log(`${fell ? 'ok  ' : 'FAIL'} мутант «${name}»: гейт ${fell ? `упал (${bad.length}: ${bad[0]})` : 'НЕ УПАЛ — гейт бесполезен'}`);
}
row(mOk === mutants.length, `мутанты: упало ${mOk} из ${mutants.length}`);
if (maskBad) fail = 1;
console.log(fail ? 'CHECK-ABOUT-BG: ПРОВАЛ' : 'CHECK-ABOUT-BG: все нормы выполнены');
process.exit(fail);
