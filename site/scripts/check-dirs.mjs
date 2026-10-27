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

const HERE = dirname(fileURLToPath(import.meta.url));
const R18 = join(HERE, '../../docs/photos-source/r18-dirs');
const IMG = join(HERE, '../public/img');
const CSS = readFileSync(join(HERE, '../src/styles/sections.css'), 'utf8');
const ASTRO = readFileSync(join(HERE, '../src/pages/index.astro'), 'utf8');

const CAPS = {
  'tri-bg-2560': { avif: 130, webp: 150 }, 'tri-bg-960': { avif: 70, webp: 80 },
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
  'tri-bg-2560': [2560, 1440], 'tri-bg-960': [960, 540], 'tri-bg-m-900': [900, 1600],
  'tri-wheel-1600': [1600, 1067], 'tri-wheel-960': [960, 640], 'tri-wheel-640': [640, 427],
  'tri-serv-1600': [1600, 1067], 'tri-serv-960': [960, 640], 'tri-serv-640': [640, 427],
  'tri-diag-1600': [1600, 1067], 'tri-diag-960': [960, 640], 'tri-diag-640': [640, 427],
};
/* кропы §3.1: доля мастера, видимая в карточке/секции на каждой ширине */
const CARD_CROPS = [ /* [w, h, x0%, x1%, y0%, y1%] */
  [375, 369, .161, .839, 0, 1], [984, 269, 0, 1, .295, .705], [728, 287, 0, 1, .204, .796],
  [350, 386, .198, .802, 0, 1], [332, 387, .214, .786, 0, 1],
];
const SEC_CROPS = [
  [1440, 680, 0, 1, .08, .92], [1024, 1142, .248, .752, 0, 1], [768, 1111, .306, .694, 0, 1],
];
const SEC_M_CROPS = [[390, 1434, .258, .742, 0, 1]];

const zones = JSON.parse(readFileSync(join(R18, 'zones.json'), 'utf8'));

let fail = 0;
const row = (ok, msg) => { if (!ok) fail = 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* ---- базовые проверки (функция гейта over данные, чтобы мутанты гонялись ей же) ---- */
function gate({ css, astro, zones: z, files }) {
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
  /* зона внутри пересечения кропов */
  const inCard = z.card2400, inSec = z.secDesk2560, inMob = z.secMob900;
  let ix0 = 0, iy0 = 0, ix1 = 2400, iy1 = 1600;
  for (const [, , x0, x1, y0, y1] of CARD_CROPS) {
    ix0 = Math.max(ix0, x0 * 2400); ix1 = Math.min(ix1, x1 * 2400);
    iy0 = Math.max(iy0, y0 * 1600); iy1 = Math.min(iy1, y1 * 1600);
  }
  if (!(inCard.x >= ix0 && inCard.x + inCard.w <= ix1 && inCard.y >= iy0 && inCard.y + inCard.h <= iy1))
    bad.push(`zones.json card2400 вне пересечения кропов [${ix0.toFixed(0)},${iy0.toFixed(0)},${ix1.toFixed(0)},${iy1.toFixed(0)}]`);
  let sx0 = 0, sx1 = 2560, sy0 = 0, sy1 = 1440;
  for (const [, , x0, x1, y0, y1] of SEC_CROPS) {
    sx0 = Math.max(sx0, x0 * 2560); sx1 = Math.min(sx1, x1 * 2560);
    sy0 = Math.max(sy0, y0 * 1440); sy1 = Math.min(sy1, y1 * 1440);
  }
  if (!(inSec.x >= sx0 && inSec.x + inSec.w <= sx1 && inSec.y >= sy0 && inSec.y + inSec.h <= sy1))
    bad.push(`zones.json secDesk2560 вне пересечения кропов [${sx0.toFixed(0)},${sy0.toFixed(0)},${sx1.toFixed(0)},${sy1.toFixed(0)}]`);
  const mx0 = .258 * 900, mx1 = .742 * 900;
  if (!(inMob.x >= mx0 && inMob.x + inMob.w <= mx1)) bad.push('zones.json secMob900 вне мобильного кропа');
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
  /* разметка: фон — слой <picture>, не background-image на карточке */
  const pics = (astro.match(/<div class="tri-bg"[^>]*><picture>/g) || []).length;
  if (pics !== 3) bad.push(`разметка: слоёв .tri-bg c <picture> ${pics} ≠ 3`);
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
    const m = await sharp(p).metadata();
    files.master[f] = { width: m.width, height: m.height };
  }
  for (const name of Object.keys(DERIV)) {
    for (const fmt of ['avif', 'webp']) {
      const p = join(IMG, `${name}.${fmt}`);
      if (!existsSync(p)) continue;
      const [m, st] = [await sharp(p).metadata(), statSync(p)];
      files.deriv[`${name}.${fmt}`] = { width: m.width, height: m.height, kb: +(st.size / 1024).toFixed(1) };
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
  ['зона сдвинута за край кропа', () => gate({ css: CSS, astro: ASTRO, files, zones: { ...zones, card2400: { x: zones.card2400.x + 400, y: zones.card2400.y, w: zones.card2400.w, h: zones.card2400.h } } })],
  ['object-position: 0 0', () => gate({ css: CSS.replace('object-position:50% 50%', 'object-position:0 0'), astro: ASTRO, zones, files })],
  ['скрим ослаблен до 0,4', () => gate({ css: CSS.replace(/rgba\(11,20,16,var\(--sc1,[\d.]+\)\) 0%,rgba\(11,20,16,var\(--sc2,[\d.]+\)\) 38%,rgba\(11,20,16,var\(--sc3,[\d.]+\)\) 100%/, 'rgba(11,20,16,var(--sc1,.4)) 0%,rgba(11,20,16,var(--sc2,.4)) 38%,rgba(11,20,16,var(--sc3,.4)) 100%'), astro: ASTRO, zones, files })],
  ['плоский фон без <picture>', () => gate({ css: CSS, astro: ASTRO.replace(/<div class="tri-bg"[\s\S]*?<\/picture><\/div>/g, ''), zones, files })],
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
