/**
 * Раунд 12: пиксельный WCAG-контраст текста для трёх режимов компоновки.
 *  1) ≥1025 и 641…1024: текст героя стоит на сплошном --night (#0B1410) —
     подложек и scrim поверх фото нет (hero.css: .slide-bg::before/::after content:none).
 *  2) ≤640: текст героя на панели rgba(6,11,9,.82) поверх мобильного кадра 4:5
 *     (hero-service-m-640.webp) — худший пиксель кадра.
 *  3) Панель диагностики .est-aside: linear-gradient(rgba(11,20,16,.78) →
 *     rgba(11,20,16,.86)) поверх cta-diag-960.webp — худший пиксель фона;
 *     h3 (--brass) и p (--mist) обязаны дать ≥7:1 (задание §7).
 * Пороги: h1 крупный — 3:1, sub/p — 4.5:1, панель диагностики h3/p — 7:1.
 * Запуск: node site/scripts/measure-contrast.mjs (exit 1 при провале).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, '../public/img');

const NIGHT = [0x0b, 0x14, 0x10];
const IVORY = [0xf4, 0xef, 0xe6];
const MIST = [0xb7, 0xc4, 0xbb];
const BRASS = [0xe0, 0xa9, 0x6d];
const OVER = [6, 11, 9];

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const over = (bg, a, c) => bg.map((v, i) => v * (1 - a) + c[i] * a);

/* худший (самый светлый) пиксель фона после дима/панели */
async function worstAfter(file, dimAt, color = OVER) {
  const r = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = r.info.width, h = r.info.height, ch = r.info.channels;
  let worst = null, wl = -1;
  for (let y = 0; y < h; y += 2) {
    const a = dimAt(y / (h - 1));
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * ch;
      const px = over([r.data[i], r.data[i + 1], r.data[i + 2]], a, color);
      const l = lum(px);
      if (l > wl) { wl = l; worst = px; }
    }
  }
  return worst;
}

let fail = 0;
const row = (where, what, color, bg, need) => {
  const r = ratio(color, bg);
  const bad = r < need;
  if (bad) fail = 1;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${where}: ${what} ${r.toFixed(2)}:1 (норма ≥${need})`);
};

/* 1) РАУНД 14: десктоп и планшет — текст стоит на фото ПОД скримом
   (hero.css ::before — горизонтальный градиент, ::after/второй слой — вертикальный
   снизу). Худший пиксель ищем внутри зоны текстаSafe-zone (safe-zone-geom.json,
   мастер 2560×1440), компонуя фото + оба градиента; норма для заголовка И подзаголовка ≥4.5. */
const stopA = (stops, t) => {
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, a0] = stops[k - 1], [t1, a1] = stops[k];
      return a0 + (a1 - a0) * (t - t0) / (t1 - t0);
    }
  }
  return stops[stops.length - 1][1];
};
async function worstInZone(file, zone, stopsH, botA) {
  const r = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = r.info.width, h = r.info.height, ch = r.info.channels;
  const [x0, y0, x1, y1] = zone;
  let worst = null, wl = -1, wx = 0, wy = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const a1 = stopA(stopsH, x / (w - 1));
      const a2 = botA(y / (h - 1));
      const a = 1 - (1 - a1) * (1 - a2);
      const i = (y * w + x) * ch;
      const px = over([r.data[i], r.data[i + 1], r.data[i + 2]], a, OVER);
      const l = lum(px);
      if (l > wl) { wl = l; worst = px; wx = x; wy = y; }
    }
  }
  return { worst, wx, wy, wl };
}
/* десктоп ≥1024: зона текста из safe-zone-geom.json (title zone), скрим hero.css ≥1024 */
const desk = await worstInZone(join(IMG, 'hero-service-2560.webp'), [249, 344, 1126, 1098],
  [[0, .94], [.26, .90], [.44, .74], [.52, .34], [.60, 0]],
  (t) => (t > .74 ? .55 * (t - .74) / .26 : 0));
row('≥1025 герой', `h1 ivory по худшему пикселю зоны (${desk.wx},${desk.wy})`, IVORY, desk.worst, 4.5);
row('≥1025 герой', `sub mist по худшему пикселю зоны (${desk.wx},${desk.wy})`, MIST, desk.worst, 4.5);
/* планшет 1024×768: hero h=553, scale=.4, верх кропа 29 px мастера; текст x 4…62 % */
const tab = await worstInZone(join(IMG, 'hero-service-2560.webp'), [102, 244, 1126, 1194],
  [[0, .94], [.26, .90], [.44, .74], [.52, .34], [.60, 0]],
  (t) => { const ys = (t * 1440 - 29) / 1382; return ys > .68 ? .62 * (ys - .68) / .32 : 0; });
row('641…1024 герой', `h1 ivory по худшему пикселю зоны (${tab.wx},${tab.wy})`, IVORY, tab.worst, 4.5);
row('641…1024 герой', `sub mist по худшему пикселю зоны (${tab.wx},${tab.wy})`, MIST, tab.worst, 4.5);

/* 2) РАУНД 15: мобильные — текст ПОД полосой фото, на сплошном --night */
row('≤640 герой', 'h1 ivory на --night (текст под фото)', IVORY, NIGHT, 4.5);
row('≤640 герой', 'sub mist на --night (текст под фото)', MIST, NIGHT, 4.5);

/* 3) панель диагностики: градиент .78→.86 поверх cta-diag-960 */
const diagBg = await worstAfter(join(IMG, 'cta-diag-960.webp'), (t) => 0.78 + 0.08 * t, [11, 20, 16]);
row('панель диагностики', 'h3 brass по худшему пикселю фона', BRASS, diagBg, 7);
row('панель диагностики', 'p mist по худшему пикселю фона', MIST, diagBg, 7);


/* 4) РАУНД 17 (задание №19): карточки «Три направления» — худший пиксель В ЗОНЕ
   ТЕКСТА после скрима .tri-bg::after (стопы читаются из sections.css, единый
   источник). Зона текста карточки 375×369 @1440: x27…348, y113…340 (§5 задания),
   пересчёт в мастер 2400×1600 по кропу §3.1: видимая ширина 16,1…83,9 %.
   Акцентная карточка поверх получает тонировку #1C3126 soft-light — только
   темнее, в запас. Норма: h3/p/ссылка ≥4,5; заголовок секции — крупный, ≥3. */
import { readFileSync as readCss } from 'node:fs';
const R18 = join(HERE, '../../docs/photos-source/r18-dirs');
const cssTri = readCss(join(HERE, '../src/styles/sections.css'), 'utf8');
const mStops = cssTri.match(/\.tri-bg::after\{[^}]*rgba\(11,20,16,var\(--sc1,([\d.]+)\)\) 0%,rgba\(11,20,16,var\(--sc2,([\d.]+)\)\) 38%,rgba\(11,20,16,var\(--sc3,([\d.]+)\)\) 100%/);
const triStops = mStops ? [[0, +mStops[1]], [.38, +mStops[2]], [1, +mStops[3]]] : [[0, .55], [.38, .72], [1, .86]];
console.log(`скрим карточек из sections.css: ${triStops.map(s => s[1]).join(' / ')}`);
/* РАУНД 17 / приёмка (замечание A6 §9.6): проверяем ВСЕ пять окон карточки, а не одно.
   Окно мастера считается тем же правилом, что в CSS (cover + object-position 50% 50%);
   полоса текста по Y — по фактическим габаритам блоков в рендере Chromium
   (1440/1280: 113…352 из 369; 1024: 113…240 из 269; 768: 113…247 из 287;
    390/360: 113…358 из 387). Если вёрстка сдвинет текст, полоса пересчитывается. */
const CARD_MASTER = { W: 2400, H: 1600 };
const COVER_WINDOWS = [
  { vp: '375×369', cw: 375, ch: 369, band: [113 / 369, 352 / 369] },
  { vp: '984×269', cw: 984, ch: 269, band: [113 / 269, 240 / 269] },
  { vp: '728×287', cw: 728, ch: 287, band: [113 / 287, 247 / 287] },
  { vp: '350×387', cw: 350, ch: 387, band: [113 / 387, 358 / 387] },
  { vp: '332×387', cw: 332, ch: 387, band: [113 / 387, 358 / 387] },
];
function coverWindow(cw, ch, px = 0.5, py = 0.5) {
  const { W, H } = CARD_MASTER;
  const s = Math.max(cw / W, ch / H);
  const dw = W * s, dh = H * s;
  const ox = (dw - cw) * px, oy = (dh - ch) * py;
  return { x0: ox / s, x1: (ox + cw) / s, y0: oy / s, y1: (oy + ch) / s };
}
async function worstInWindow(file, win, band, stops) {
  const r = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = r.info.width, h = r.info.height, ch = r.info.channels;
  const y0 = Math.max(0, Math.round(win.y0 + (win.y1 - win.y0) * band[0]));
  const y1 = Math.min(h, Math.round(win.y0 + (win.y1 - win.y0) * band[1]));
  const x0 = Math.max(0, Math.round(win.x0)), x1 = Math.min(w, Math.round(win.x1));
  let worst = null, wl = -1, wx = 0, wy = 0;
  for (let y = y0; y < y1; y += 2) {
    const a = stopA(stops, (y - win.y0) / (win.y1 - win.y0));
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * ch;
      const px = over([r.data[i], r.data[i + 1], r.data[i + 2]], a, OVER);
      const l = lum(px);
      if (l > wl) { wl = l; worst = px; wx = x; wy = y; }
    }
  }
  return { worst, wx, wy };
}
const triCards2 = [['01 Колёса', 'card-1-wheels-2400.jpg'], ['02 Ремонт и ТО', 'card-2-service-2400.jpg'], ['03 Диагностика', 'card-3-diag-2400.jpg']];
let bandBad = 0;
for (const win of COVER_WINDOWS) if (!(win.band[0] > 0 && win.band[1] < 1)) bandBad++;
if (bandBad) { fail = 1; console.log(`FAIL полоса текста выходит за карточку в ${bandBad} окнах`); }
for (const [label, f] of triCards2) {
  for (const win of COVER_WINDOWS) {
    const z = await worstInWindow(join(R18, f), coverWindow(win.cw, win.ch), win.band, triStops);
    row(`карточка ${label} ${win.vp}`, `ссылка brass по худшему пикселю (${z.wx},${z.wy})`, BRASS, z.worst, 4.5);
    row(`карточка ${label} ${win.vp}`, `p mist по худшему пикселю (${z.wx},${z.wy})`, MIST, z.worst, 4.5);
  }
}
/* заголовок секции: крупный текст (36,8 px), норма 3:1, фон — фото секции без скрима;
   зона = верх кадра 1440×680 (css y 90…270 → мастер y 90…543), вся ширина */
const mSec = cssTri.match(/\.dirs::before\{[^}]*linear-gradient\(180deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 40%,rgba\(11,20,16,([\d.]+)\) 62%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
const secStops = mSec ? [[0, +mSec[1]], [.4, +mSec[2]], [.62, +mSec[3]], [1, +mSec[4]]] : [[0, 0], [1, 0]];
console.log(`скрим секции из sections.css: ${secStops.map(s => s[1]).join(' / ')}`);
const secZ = await worstInZone(join(IMG, 'tri-bg-2560.webp'), [0, 90, 2560, 543], [[0, 0], [1, 0]], (t) => stopA(secStops, t));
row('секция «Три направления»', `h2 ivory (крупный) по худшему пикселю зоны заголовка (${secZ.wx},${secZ.wy})`, IVORY, secZ.worst, 3);
/* мутант: убрать скрим карточек — гейт обязан упасть на brass */
{
  const win = COVER_WINDOWS[0];
  const z = await worstInWindow(join(R18, 'card-2-service-2400.jpg'), coverWindow(win.cw, win.ch), win.band, [[0, 0], [1, 0]]);
  const r = ratio(BRASS, z.worst);
  const fell = r < 4.5;
  if (!fell) fail = 1;
  console.log(`${fell ? 'ok  ' : 'FAIL'} мутант «скрим снят»: brass ${r.toFixed(2)}:1 — гейт ${fell ? 'упал, как должен' : 'НЕ УПАЛ'}`);
}

/* 5) РАУНД 18 (задание №20): секция «О компании» — A фон секции, B карточки,
   C плашки, D кнопка. Худший пиксель по прямоугольникам текста из geometry.json
   (union по всем ширинам) и по сюжетным зонам zones.json; скримы — из §3.4
   (стопы читаются из sections.css/buttons.css, единый источник). */
const R19 = join(HERE, '../../docs/photos-source/r19-about');
const GEOM19 = JSON.parse(readCss(join(HERE, '../../evaluation/assets/r19-about-current/geometry.json'), 'utf8'));
const Z19 = JSON.parse(readCss(join(R19, 'zones.json'), 'utf8'));
const css19 = readCss(join(HERE, '../src/styles/sections.css'), 'utf8') + readCss(join(HERE, '../src/styles/buttons.css'), 'utf8');
const mA = css19.match(/\.about::before\{[^}]*rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 12%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 75%,rgba\(11,20,16,([\d.]+)\) 100%/);
const A_STOPS = mA ? [[0, +mA[1]], [.12, +mA[2]], [.45, +mA[3]], [.75, +mA[4]], [1, +mA[5]]] : [[0, .88], [.12, .86], [.45, .8], [.75, .62], [1, .45]];
const mF = css19.match(/\.feat-bg::after\{[^}]*var\(--fc1,([\d.]+)\)[^,]*,rgba\(11,20,16,var\(--fc2,([\d.]+)\)[^,]*,rgba\(11,20,16,var\(--fc3,([\d.]+)\)/);
const F_STOPS = mF ? [[0, +mF[1]], [.38, +mF[2]], [1, +mF[3]]] : [[0, .76], [.38, .84], [1, .92]];
/* раунд 19 (§2.1): плашки и кнопка — горизонтальные градиенты, парсятся из CSS */
const mC = css19.match(/\.fact-bg::after\{[^}]*linear-gradient\(95deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 45%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
if (!mC) { console.log('FAIL: в CSS нет градиента скрима плашек (95deg, 3 стопа)'); process.exit(1); }
const C_STOPS = [[0, +mC[1]], [.45, +mC[2]], [1, +mC[3]]];
const mD = css19.match(/\.btn-bg::after\{[^}]*linear-gradient\(90deg,rgba\(11,20,16,([\d.]+)\) 0%,rgba\(11,20,16,([\d.]+)\) 50%,rgba\(11,20,16,([\d.]+)\) 100%\)/);
if (!mD) { console.log('FAIL: в CSS нет градиента скрима кнопки (90deg, 3 стопа)'); process.exit(1); }
const D_STOPS = [[0, +mD[1]], [.5, +mD[2]], [1, +mD[3]]];
console.log(`скримы: секция ${A_STOPS.map(x => x[1]).join('/')} (5 стопов), карточки ${F_STOPS.map(x => x[1]).join('/')}, плашки ${C_STOPS.map(x => x[1]).join('/')} (95deg по X), кнопка ${D_STOPS.map(x => x[1]).join('/')} (90deg по X)`);
const rect = (r) => [r.x0, r.y0, r.x1, r.y1];
/* A: надзаголовок (медь, 12,5 px — узкое место) и весь текст колонки */
for (const [key, file, H] of [['section_desktop', join(R19, 'sec-bg-2560.jpg'), 1440], ['section_portrait', join(R19, 'sec-bg-m-1200.jpg'), 2700]]) {
  const u = GEOM19[key], lab = key === 'section_desktop' ? 'A десктоп' : 'A портрет';
  const e = await worstInZone(file, rect(u.eyebrow_union_master), [[0, 0], [1, 0]], (t) => stopA(A_STOPS, t));
  row(`секция ${lab}`, `надзаголовок copper по худшему пикселю union (${e.wx},${e.wy})`, [0xc8, 0x7f, 0x45], e.worst, 4.5);
  const t = await worstInZone(file, rect(u.text_union_master), [[0, 0], [1, 0]], (tt) => stopA(A_STOPS, tt));
  row(`секция ${lab}`, `lead mist по худшему пикселю union текста (${t.wx},${t.wy})`, MIST, t.worst, 4.5);
  row(`секция ${lab}`, `h2 ivory (крупный) по худшему пикселю union текста (${t.wx},${t.wy})`, IVORY, t.worst, 3);
}
/* B: четыре карточки — полоса текста h3+p (y 791…1147 мастера) и иконка */
const cardFiles = ['card-1-estimate-2400.jpg', 'card-2-warranty-2400.jpg', 'card-3-schedule-2400.jpg', 'card-4-fleet-2400.jpg'];
const cardNames = ['B1 Смета', 'B2 Гарантия', 'B3 График', 'B4 Парк'];
for (let i = 0; i < 4; i++) {
  const f = join(R19, cardFiles[i]);
  const band = await worstInZone(f, [Z19.card2400.x, Z19.cardTextBand.y0, Z19.card2400.x + Z19.card2400.w, Z19.cardTextBand.y1], [[0, 0], [1, 0]], (t) => stopA(F_STOPS, t));
  row(`карточка ${cardNames[i]}`, `h3 ivory по худшему пикселю полосы текста (${band.wx},${band.wy})`, IVORY, band.worst, 4.5);
  row(`карточка ${cardNames[i]}`, `p mist по худшему пикселю полосы текста (${band.wx},${band.wy})`, MIST, band.worst, 4.5);
  const ic = await worstInZone(f, [335, 181, 726, 571], [[0, 0], [1, 0]], (t) => stopA(F_STOPS, t));
  row(`карточка ${cardNames[i]}`, `штрих иконки brass по худшему пикселю зоны иконки (${ic.wx},${ic.wy})`, BRASS, ic.worst, 3);
}
/* C: четыре плашки — зона x221…1379 y151…382, градиент 95deg по X */
const factFiles = ['fact-1-address-1600.jpg', 'fact-2-hours-1600.jpg', 'fact-3-warranty-1600.jpg', 'fact-4-fleet-1600.jpg'];
for (let i = 0; i < 4; i++) {
  const z = await worstInZone(join(R19, factFiles[i]), [Z19.fact1600.x, Z19.fact1600.y, Z19.fact1600.x + Z19.fact1600.w, Z19.fact1600.y + Z19.fact1600.h], C_STOPS, () => 0);
  row(`плашка C${i + 1}`, `b ivory по худшему пикселю зоны (${z.wx},${z.wy})`, IVORY, z.worst, 4.5);
  row(`плашка C${i + 1}`, `span mist по худшему пикселю зоны (${z.wx},${z.wy})`, MIST, z.worst, 4.5);
}
/* D: кнопка — полоса y81…319; текст ivory 15 px и рамка ghost .55 на 3:1 */
{
  const z = await worstInZone(join(R19, 'btn-cta-1200.jpg'), [0, 81, 1200, 319], D_STOPS, () => 0);
  row('кнопка D', `текст ivory по худшему пикселю пилюли (${z.wx},${z.wy})`, IVORY, z.worst, 4.5);
  const border = over(z.worst, 0.55, BRASS);
  const r = ratio(border, z.worst);
  const badB = r < 3; if (badB) fail = 1;
  console.log(`${badB ? 'FAIL' : 'ok  '} кнопка D: рамка ghost rgba(224,169,109,.55) на худшем фоне ${r.toFixed(2)}:1 (норма ≥3)`);
}
/* мутант: снять все скримы раунда 18 — гейт обязан упасть хотя бы по одной
   из узких точек: медь надзаголовка на секции и mist полосы текста карточки B1 */
{
  const e = await worstInZone(join(R19, 'sec-bg-2560.jpg'), rect(GEOM19.section_desktop.eyebrow_union_master), [[0, 0], [1, 0]], () => 0);
  const rE = ratio([0xc8, 0x7f, 0x45], e.worst);
  const b = await worstInZone(join(R19, cardFiles[0]), [Z19.card2400.x, Z19.cardTextBand.y0, Z19.card2400.x + Z19.card2400.w, Z19.cardTextBand.y1], [[0, 0], [1, 0]], () => 0);
  const rB = ratio(MIST, b.worst);
  const fell = rE < 4.5 || rB < 4.5; if (!fell) fail = 1;
  console.log(`${fell ? 'ok  ' : 'FAIL'} мутант «скримы раунда 18 сняты»: copper ${rE.toFixed(2)}:1, mist карточки ${rB.toFixed(2)}:1 — гейт ${fell ? 'упал' : 'НЕ УПАЛ'}`);
}

console.log(fail ? 'КОНТРАСТ: ПРОВАЛ' : 'КОНТРАСТ: все нормы выполнены');
process.exit(fail);
