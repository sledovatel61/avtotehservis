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

function gate({ css: C, astro: A, zones: z, files, geom }) {
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
  if (!/\.fact-bg::after\{[^}]*background:rgba\(11,20,16,\.9\)/.test(C)) bad.push('CSS: скрим плашек ≠ сплошной rgba(11,20,16,.9)');
  if (!/\.btn-bg::after\{[^}]*background:rgba\(11,20,16,\.9\)/.test(C)) bad.push('CSS: скрим кнопки ≠ сплошной rgba(11,20,16,.9)');
  if (!/\.feat-bg::after\{[^}]*var\(--fc1,\.76\)/.test(C)) bad.push('CSS: скрим карточек ≠ .76/.84/.92');
  if (/\.btn\{[^}]*background-image/.test(C)) bad.push('CSS: у .btn появился background-image (запрещено §3.3)');
  if (/\.fact\{[^}]*background-image/.test(C)) bad.push('CSS: у .fact появился background-image (запрещено §3.3)');
  if (/\.about\{[^}]*background-image/.test(C)) bad.push('CSS: у .about появился background-image (запрещено §3.3)');
  if (!/\.about \.btn\{[^}]*position:relative;isolation:isolate;overflow:hidden/.test(C)) bad.push('CSS: .about .btn без position:relative;isolation:isolate;overflow:hidden');
  if (!/\.about \.btn--ghost\{border-color:rgba\(224,169,109,\.55\)\}/.test(C)) bad.push('CSS: .about .btn--ghost без рамки .55');
  if (/(?<!\.about )\.btn--ghost\{border-color:rgba\(224,169,109,\.55\)/.test(C)) bad.push('CSS: правка рамки .55 вышла за пределы .about (регресс первого экрана и 3 страниц)');
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
  const files = { master: {}, raw: {}, deriv: {} };
  for (const f of Object.keys(MASTERS)) {
    const p = join(R19, f);
    if (existsSync(p)) { const m = await sharp(p).metadata(); files.master[f] = { width: m.width, height: m.height }; }
    const rp = join(R19, f.replace('.jpg', '-raw.jpg'));
    if (existsSync(rp)) files.raw[f.replace('.jpg', '-raw.jpg')] = true;
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
const base = gate({ css, astro: ASTRO, zones, files, geom: GEOM });
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
  ['у .fact-bg скрим 0,5', () => gate({ css: css.replace('.fact-bg::after{content:\'\';position:absolute;inset:0;background:rgba(11,20,16,.9)}', '.fact-bg::after{content:\'\';position:absolute;inset:0;background:rgba(11,20,16,.5)}'), astro: ASTRO, zones, files })],
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
