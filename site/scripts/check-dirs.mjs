/**
 * Раунд 17 (задание №19): гейт фонов секции «Три направления».
 *  1) мастера r18-dirs существуют и совпадают с заявленными размерами;
 *  2) все производные avif/webp существуют, размеры и вес ≤ CAPS;
 *  3) сюжетная зона zones.json лежит ВНУТРИ пересечения кропов
 *     (1440 / 1024 / 768 / 390 / 360 — таблица §3.1 задания);
 *  4) CSS: .tri-bg c object-fit:cover, скрим ≥ рабочего диапазона (§4),
 *     радиус наследуется от карточки, карточка режет фото (overflow:hidden);
 *  5) разметка: фон карточки — слой <picture>, а не background-image;
 *  6) самопроверка на мутантах: 4 мутанта обязаны уронить гейт.
 * Запуск: node site/scripts/check-dirs.mjs (exit 1 при провале).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverWindow as libCover, commonWindow as libCommon, insideZone } from './lib/cover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const R18 = join(HERE, '../../docs/photos-source/r18-dirs');
const IMG = join(HERE, '../public/img');
const CSS = readFileSync(join(HERE, '../src/styles/sections.css'), 'utf8');
const ASTRO = readFileSync(join(HERE, '../src/pages/index.astro'), 'utf8');

const CAPS = {
  'tri-bg-2560': { avif: 130, webp: 150 },
  'tri-bg-m-900': { avif: 80, webp: 95 },
  'tri-wheel-1600': { avif: 70, webp: 80 }, 'tri-wheel-960': { avif: 45, webp: 50 }, 'tri-wheel-640': { avif: 28, webp: 32 },
  'tri-serv-1600': { avif: 70, webp: 80 }, 'tri-serv-960': { avif: 45, webp: 50 }, 'tri-serv-640': { avif: 28, webp: 32 },
  'tri-diag-1600': { avif: 70, webp: 80 }, 'tri-diag-960': { avif: 45, webp: 50 }, 'tri-diag-640': { avif: 28, webp: 32 },
};
const MASTERS = {
  'sec-bg-2560.jpg': [2560, 1440], 'sec-bg-m-900.jpg': [900, 1600],
  'card-1-wheels-2400.jpg': [2400, 1600], 'card-2-service-2400.jpg': [2400, 1600], 'card-3-diag-2400.jpg': [2400, 1600],
};
const DERIV = {
  'tri-bg-2560': [2560, 1440], 'tri-bg-m-900': [900, 1600],
  'tri-wheel-1600': [1600, 1067], 'tri-wheel-960': [960, 640], 'tri-wheel-640': [640, 427],
  'tri-serv-1600': [1600, 1067], 'tri-serv-960': [960, 640], 'tri-serv-640': [640, 427],
  'tri-diag-1600': [1600, 1067], 'tri-diag-960': [960, 640], 'tri-diag-640': [640, 427],
};
/* Кропы считаются ТЕМ ЖЕ правилом, что в CSS (object-fit:cover + object-position), а не
   берутся из вставленных процентов. Раньше здесь лежали готовые числа, совпадающие с
   zones.json, — гейт сравнивал источник сам с собой (ревью A6 §9.4–9.5). */
const VIEW = {
  card:  { W: 2400, H: 1600, px: 0.5, py: 0.5,  list: [[375, 369], [984, 269], [728, 287], [350, 386], [332, 387]] },
  sec:   { W: 2560, H: 1440, px: 0.5, py: 0.45, list: [[1440, 680], [1280, 800], [1024, 1142], [768, 1111]] },
  secM:  { W: 900,  H: 1600, px: 0.5, py: 0.40, list: [[390, 1434], [360, 1434]] },
};
/* раунд 18 (§5.1): кроп-математика живёт в lib/cover.mjs, здесь — тонкие обёртки
   поверх VIEW-таблицы, чтобы не дублировать формулы между чекерами */
const coverWindow = (view, cw, ch) => libCover({ W: view.W, H: view.H, px: view.px, py: view.py }, cw, ch);
const TOL = 1;   // px: допуск на округление долей
const commonWindow = (view) => libCommon(view.list.map(([w, h]) => coverWindow(view, w, h)));

const zones = JSON.parse(readFileSync(join(R18, 'zones.json'), 'utf8'));

let fail = 0;
const row = (ok, msg) => { if (!ok) fail = 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* ---- базовые проверки (функция гейта over данные, чтобы мутанты гонялись ей же) ---- */
function gate({ css, astro, zones: z, files, view = VIEW }) {
  const bad = [];
  for (const [f, [w, h]] of Object.entries(MASTERS)) {
    const m = files.master[f];
    if (!m) bad.push(`мастер ${f} отсутствует`);
    else if (m.width !== w || m.height !== h) bad.push(`мастер ${f}: ${m.width}×${m.height} ≠ ${w}×${h}`);
  }
  for (const [name, [w, h]] of Object.entries(DERIV)) {
    for (const fmt of ['avif', 'webp']) {
      const d = files.deriv[`${name}.${fmt}`];
      if (!d) { bad.push(`${name}.${fmt} отсутствует`); continue; }
      if (d.width !== w || d.height !== h) bad.push(`${name}.${fmt}: ${d.width}×${d.height} ≠ ${w}×${h}`);
      if (d.kb > CAPS[name][fmt]) bad.push(`${name}.${fmt}: ${d.kb} КБ > лимит ${CAPS[name][fmt]}`);
    }
  }
  /* зона внутри ПЕРЕСЕЧЕНИЯ окон, посчитанного из CSS-геометрии */
  const inside = (z, win, name) => {
    const okx = z.x >= win.x0 - TOL && z.x + z.w <= win.x1 + TOL;
    const oky = z.y >= win.y0 - TOL && z.y + z.h <= win.y1 + TOL;
    if (!okx || !oky) {
      bad.push(`zones.json ${name} [${z.x}…${z.x + z.w} × ${z.y}…${z.y + z.h}] вне окна [${win.x0.toFixed(0)}…${win.x1.toFixed(0)} × ${win.y0.toFixed(0)}…${win.y1.toFixed(0)}]`);
    }
  };
  inside(z.card2400, commonWindow(view.card), 'card2400');
  inside(z.secDesk2560, commonWindow(view.sec), 'secDesk2560');
  inside(z.secMob900, commonWindow(view.secM), 'secMob900');
  /* CSS */
  if (!/\.tri-bg\{[^}]*position:absolute/.test(css)) bad.push('CSS: нет слоя .tri-bg');
  if (!/\.tri-bg img\{[^}]*object-fit:cover/.test(css)) bad.push('CSS: .tri-bg img без object-fit:cover');
  if (!/\.tri-bg img\{[^}]*object-position:50% 50%/.test(css)) bad.push('CSS: object-position ≠ 50% 50% (кроп уедет)');
  if (!/\.tri-bg\{[^}]*border-radius:inherit/.test(css)) bad.push('CSS: .tri-bg не наследует радиус карточки');
  if (!/\.tri-card\{[^}]*overflow:hidden/.test(css)) bad.push('CSS: .tri-card не режет фото (overflow:hidden)');
  const scrim = css.match(/\.tri-bg::after\{[^}]*linear-gradient\(180deg,rgba\(11,20,16,var\(--sc1,([\d.]+)\)\) 0%,rgba\(11,20,16,var\(--sc2,([\d.]+)\)\) 38%,rgba\(11,20,16,var\(--sc3,([\d.]+)\)\) 100%\)/);
  if (!scrim) bad.push('CSS: нет скрима .tri-bg::after заявленной формы');
  else {
    const [, a0, a1, a2] = scrim.map(Number);
    /* §4: рабочий диапазон — скрим 0,72 и темнее в зоне текста (y≥38 % кадра);
       верхний стоп держим ≥0,55, средний ≥0,72, нижний ≥0,86 */
    if (a0 < 0.55 || a1 < 0.72 || a2 < 0.86) bad.push(`CSS: скрим ${a0}/${a1}/${a2} слабее рабочего диапазона (§4)`);
  }
  if (!/\.dirs\{[^}]*background-color:var\(--deep\)/.test(css)) bad.push('CSS: .dirs без сплошного --deep под фото');
  if (!/\.dirs::before\{[^}]*linear-gradient\(180deg/.test(css)) bad.push('CSS: нет затемняющего слоя .dirs::before под заголовком');
  /* РАУНД 17 / приёмка: фон секции обязан быть СЛОЕМ <picture> (иначе минцификатор ломает
     image-set и на Pages под /avtotehservis/ фон 404-ится — см. export-pages/check-pages) */
  if (!/\.dirs-bg\{[^}]*position:absolute/.test(css)) bad.push('CSS: нет слоя .dirs-bg');
  if (!/\.dirs-bg img\{[^}]*object-fit:cover/.test(css)) bad.push('CSS: .dirs-bg img без object-fit:cover');
  if (!/\.dirs-bg img\{[^}]*object-position:50% 45%/.test(css)) bad.push('CSS: .dirs-bg img не 50% 45%');
  if (/\.dirs\{[^}]*background-image/.test(css)) bad.push('CSS: фон секции через background-image (сломается на префиксе)');
  /* разметка: фон — слой <picture>, не background-image на карточке */
  const pics = (astro.match(/<div class="tri-bg"[^>]*><picture>/g) || []).length;
  if (pics !== 3) bad.push(`разметка: слоёв .tri-bg c <picture> ${pics} ≠ 3`);
  const bgPics = (astro.match(/<div class="dirs-bg"[^>]*>[\s\S]{0,900}?<picture>/g) || []).length;
  if (bgPics !== 1) bad.push(`разметка: слоя .dirs-bg c <picture> ${bgPics} ≠ 1`);
  if (!/class="dirs-bg"[\s\S]{0,900}?loading="lazy" decoding="async"/.test(astro))
    bad.push('разметка: фон секции без loading=lazy decoding=async');
  if (/\.tri-card\{[^}]*background-image/.test(css)) bad.push('CSS: фон карточки через background-image (нужен слой)');
  if (!/loading="lazy" decoding="async"/.test(astro) || (astro.match(/class="tri-bg"[\s\S]{0,700}?loading="lazy" decoding="async"/g) || []).length !== 3)
    bad.push('разметка: фоны карточек без loading=lazy decoding=async');
  return bad;
}

async function collectFiles() {
  const files = { master: {}, deriv: {} };
  for (const f of Object.keys(MASTERS)) {
    const p = join(R18, f);
    if (!existsSync(p)) continue;
    let m;
    try { m = await sharp(p).metadata(); } catch (e) {
      console.log(`FAIL мастер ${f}: не читается как изображение (${e.message.split('\n')[0]})`);
      process.exitCode = 1;
      fail = 1;
      continue;
    }
    files.master[f] = { width: m.width, height: m.height };
  }
  for (const name of Object.keys(DERIV)) {
    for (const fmt of ['avif', 'webp']) {
      const p = join(IMG, `${name}.${fmt}`);
      if (!existsSync(p)) continue;
      let m;
      try { m = await sharp(p).metadata(); } catch (e) {
        console.log(`FAIL ${name}.${fmt}: не читается как изображение (${e.message.split('\n')[0]})`);
        process.exitCode = 1;
        fail = 1;
        continue;
      }
      files.deriv[`${name}.${fmt}`] = { width: m.width, height: m.height, kb: +(statSync(p).size / 1024).toFixed(1) };
    }
  }
  return files;
}

const files = await collectFiles();
const base = gate({ css: CSS, astro: ASTRO, zones, files });
for (const b of base) row(false, b);
if (!base.length) row(true, `мастера (${Object.keys(MASTERS).length}), производные (${Object.keys(DERIV).length * 2}), зоны, CSS и разметка — совпадают с заявленными`);
for (const [name, [w, h]] of Object.entries(DERIV)) {
  for (const fmt of ['avif', 'webp']) {
    const d = files.deriv[`${name}.${fmt}`];
    if (d) row(true, `${name}.${fmt} ${d.width}×${d.height} ${d.kb} КБ / лимит ${CAPS[name][fmt]}`);
  }
}

/* ---- самопроверка на мутантах ---- */
console.log('--- мутанты (гейт обязан упасть) ---');
const mutants = [
  ['object-position секции 50% 45% → 50% 20%', () => gate({ css: CSS.replace('object-position:50% 45%', 'object-position:50% 20%'), astro: ASTRO, zones, files, view: { ...VIEW, sec: { ...VIEW.sec, py: 0.2 } } })],
  ['зона сдвинута за край кропа', () => gate({ css: CSS, astro: ASTRO, files, zones: { ...zones, card2400: { x: zones.card2400.x + 400, y: zones.card2400.y, w: zones.card2400.w, h: zones.card2400.h } } })],
  ['object-position: 0 0', () => gate({ css: CSS.replace('object-position:50% 50%', 'object-position:0 0'), astro: ASTRO, zones, files })],
  ['скрим ослаблен до 0,4', () => gate({ css: CSS.replace(/rgba\(11,20,16,var\(--sc1,[\d.]+\)\) 0%,rgba\(11,20,16,var\(--sc2,[\d.]+\)\) 38%,rgba\(11,20,16,var\(--sc3,[\d.]+\)\) 100%/, 'rgba(11,20,16,var(--sc1,.4)) 0%,rgba(11,20,16,var(--sc2,.4)) 38%,rgba(11,20,16,var(--sc3,.4)) 100%'), astro: ASTRO, zones, files })],
  ['плоский фон без <picture>', () => gate({ css: CSS, astro: ASTRO.replace(/<div class="tri-bg"[\s\S]*?<\/picture><\/div>/g, ''), zones, files })],
  ['фон секции через background-image', () => gate({ css: CSS.replace('.dirs{position:relative;background-color:var(--deep)}', '.dirs{position:relative;background-color:var(--deep);background-image:url(/img/tri-bg-2560.webp)}'), astro: ASTRO, zones, files })],
  ['слой .dirs-bg удалён', () => gate({ css: CSS, astro: ASTRO.replace(/<div class="dirs-bg"[\s\S]*?<\/picture>[\s\S]*?<\/div>/, ''), zones, files })],
];
let mOk = 0;
for (const [name, fn] of mutants) {
  const bad = fn();
  const fell = bad.length > 0;
  if (fell) mOk++;
  console.log(`${fell ? 'ok  ' : 'FAIL'} мутант «${name}»: гейт ${fell ? `упал (${bad.length} замечаний: ${bad[0]})` : 'НЕ УПАЛ — гейт бесполезен'}`);
}
row(mOk === mutants.length, `мутанты: упало ${mOk} из ${mutants.length}`);

console.log(fail ? 'CHECK-DIRS: ПРОВАЛ' : 'CHECK-DIRS: все нормы выполнены');
process.exit(fail);
